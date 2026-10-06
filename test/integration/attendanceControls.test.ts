import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { handleAttendanceControl, isAttendanceControl } from "../../src/interactions/attendanceControls.js";
import { ROLE_ID, callOut, makeRaid, makeTeam, prisma } from "../db.js";
import { fakeButton, fakeSelect, flattenComponents, payloadText, raider } from "../discord.js";
import { isEphemeral, onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock();

const TUE_8PM = "2026-10-07T01:00:00Z"; // Tue Oct 6, 8:00 PM in Chicago; Wed Oct 7 in UTC

async function setup({ onRoster = true } = {}) {
  const team = await makeTeam();
  const raid = await makeRaid(team.id, TUE_8PM);
  const alice = raider("Alice", ["Warriors"], "u-alice");
  if (!onRoster) alice.roles.cache.delete(ROLE_ID);
  const w = world({ members: [alice, raider("Bob", [], "u-bob")] });
  // An existing public message, so re-renders show up as edits.
  const publicMessage = w.channel.seedMessage("public", { v2: true });
  await prisma.raidTeam.update({ where: { id: team.id }, data: { messageId: "public" } });
  const base = { guild: w.guild, userId: "u-alice" };
  return { team, raid, ...w, publicMessage, base, renders: () => publicMessage.payloads.length - 1 };
}

async function isOut(raidId: string) {
  return (await prisma.attendance.count({ where: { raidInstanceId: raidId, userId: "u-alice" } })) > 0;
}

describe("isAttendanceControl", () => {
  it("claims attendance: customIds only", () => {
    expect(isAttendanceControl("attendance:btn:t:r")).toBe(true);
    expect(isAttendanceControl("mynav:later:t:0")).toBe(false);
    expect(isAttendanceControl("teamdelete:confirm:t")).toBe(false);
  });
});

describe("public date button", () => {
  it("toggles your call-out with a confirmation in the team's timezone, re-rendering the public message", async () => {
    const { team, raid, client, base, renders, publicMessage } = await setup();
    const id = `attendance:btn:${team.id}:${raid.id}`;

    const first = fakeButton(id, base);
    await handleAttendanceControl(first, client);
    expect(onlyReply(first)).toBe("You're out for Tue, Oct 6. Click again to undo.");
    expect(await isOut(raid.id)).toBe(true);
    expect(renders()).toBe(1);
    expect(payloadText(publicMessage.payloads[1] as any)).toContain("**1/2 ready**");

    const second = fakeButton(id, base);
    await handleAttendanceControl(second, client);
    expect(onlyReply(second)).toBe("You're back in for Tue, Oct 6.");
    expect(await isOut(raid.id)).toBe(false);
    expect(renders()).toBe(2);
  });

  it("only touches the clicker's own call-out", async () => {
    const { team, raid, client, base } = await setup();
    await callOut(raid.id, "u-bob");
    await handleAttendanceControl(fakeButton(`attendance:btn:${team.id}:${raid.id}`, base), client);
    expect(await prisma.attendance.count({ where: { userId: "u-bob" } })).toBe(1);
    expect(await isOut(raid.id)).toBe(true);
  });

  it.each([
    ["a raid that no longer exists", "gone", "This raid no longer exists."],
    ["another team's raid", "other", "This raid no longer exists."],
    ["a cancelled raid", "cancelled", "This raid has been cancelled."],
    ["a closed raid", "closed", "This raid has already started or passed."],
  ])("rejects %s, still re-rendering the public message", async (_name, kind, message) => {
    const { team, client, base, renders } = await setup();
    const other = await makeTeam({ roleId: "role-other" });
    const target =
      kind === "gone"
        ? "deleted-raid"
        : kind === "other"
          ? (await makeRaid(other.id, TUE_8PM)).id
          : (await makeRaid(team.id, "2026-10-14T01:00:00Z", { [kind]: true })).id;

    const click = fakeButton(`attendance:btn:${team.id}:${target}`, base);
    await handleAttendanceControl(click, client);
    expect(onlyReply(click)).toBe(message);
    expect(await prisma.attendance.count()).toBe(0);
    expect(renders()).toBe(1);
  });

  it("rejects someone who isn't on the roster", async () => {
    const { team, raid, client, base } = await setup({ onRoster: false });
    const click = fakeButton(`attendance:btn:${team.id}:${raid.id}`, base);
    await handleAttendanceControl(click, client);
    expect(onlyReply(click)).toBe(`You're not on <@&${ROLE_ID}>'s roster, so there's nothing to update here.`);
    expect(await prisma.attendance.count()).toBe(0);
  });

  it("re-renders the public message even when handling the click throws", async () => {
    const { team, raid, client, base, renders } = await setup();
    const click = fakeButton(`attendance:btn:${team.id}:${raid.id}`, base);
    (click as unknown as { replied: boolean }).replied = true; // the reply will fail
    await expect(handleAttendanceControl(click, client)).rejects.toThrow("already been acknowledged");
    expect(renders()).toBe(1);
  });
});

describe('public "See more dates" select', () => {
  it("replies with your personal schedule, privately, and resets the public select", async () => {
    const { team, raid, client, base, renders } = await setup();
    await callOut(raid.id, "u-alice");
    const pick = fakeSelect(`attendance:pub:${team.id}`, ["more"], base);
    await handleAttendanceControl(pick, client);

    expect(pick.replies).toHaveLength(1);
    const reply = pick.replies[0];
    expect(isEphemeral(reply)).toBe(true);
    expect(reply.flags).toContain(MessageFlags.IsComponentsV2);
    const select = flattenComponents(reply).find((c) => c.custom_id === `attendance:cal:${team.id}:0`);
    expect(select.options).toEqual([expect.objectContaining({ value: raid.id, emoji: expect.objectContaining({ name: "❌" }) })]);
    expect(await isOut(raid.id)).toBe(true); // opening the view changes nothing
    expect(renders()).toBe(1);
  });

  it("does nothing when the team is gone", async () => {
    const { client, base, channel } = await setup();
    const pick = fakeSelect("attendance:pub:missing-team", ["more"], base);
    await handleAttendanceControl(pick, client);
    expect(pick.replies).toHaveLength(0);
    expect(channel.sent).toHaveLength(0);
  });
});

describe("personal schedule select", () => {
  it("toggles the picked raid and updates the personal view in place, keeping its offset", async () => {
    const { team, raid, client, base, renders } = await setup();
    const pick = fakeSelect(`attendance:cal:${team.id}:-3`, [raid.id], base);
    await handleAttendanceControl(pick, client);

    expect(pick.replies).toHaveLength(0);
    expect(pick.updates).toHaveLength(1);
    const options = flattenComponents(pick.updates[0]).find((c) => c.custom_id === `attendance:cal:${team.id}:-3`).options;
    expect(options[0]).toMatchObject({ value: raid.id, emoji: { name: "❌" } });
    expect(await isOut(raid.id)).toBe(true);
    // The public counts change too.
    expect(renders()).toBe(1);

    const back = fakeSelect(`attendance:cal:${team.id}:-3`, [raid.id], base);
    await handleAttendanceControl(back, client);
    expect(await isOut(raid.id)).toBe(false);
    expect(flattenComponents(back.updates[0]).find((c) => c.custom_id?.startsWith("attendance:cal:")).options[0].emoji.name).toBe("✅");
  });

  it("does not re-render the public message when a personal pick is rejected", async () => {
    const { team, client, base, renders } = await setup();
    const pick = fakeSelect(`attendance:cal:${team.id}:0`, ["deleted-raid"], base);
    await handleAttendanceControl(pick, client);
    expect(onlyReply(pick)).toBe("This raid no longer exists.");
    expect(renders()).toBe(0);
  });
});

describe("malformed customIds", () => {
  it.each([
    ["attendance:xyz:team:raid", []],
    ["attendance:btn", []],
    ["attendance:btn:TEAM", []], // no raid id
    ["attendance:pub:TEAM", []], // select with no value
  ])("ignores %s", async (customId, values) => {
    const { team, client, base, renders } = await setup();
    const id = customId.replace("TEAM", team.id);
    const interaction = customId.startsWith("attendance:pub") ? fakeSelect(id, values, base) : fakeButton(id, base);
    await handleAttendanceControl(interaction, client);
    expect(interaction.replies).toHaveLength(0);
    expect(interaction.updates).toHaveLength(0);
    expect(renders()).toBe(0);
  });

  it("ignores controls outside a server", async () => {
    const { team, raid, client, renders } = await setup();
    const click = fakeButton(`attendance:btn:${team.id}:${raid.id}`, { userId: "u-alice", guild: null });
    await handleAttendanceControl(click, client);
    expect(click.replies).toHaveLength(0);
    expect(renders()).toBe(0);
  });
});
