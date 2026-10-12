import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import { handleAttendanceControl, isAttendanceControl } from "../../src/interactions/attendanceControls.js";
import { ROLE_ID, callOut, makeRaid, makeTeam, prisma } from "../db.js";
import { fakeButton, fakeSelect, flattenComponents, payloadText, raider } from "../discord.js";
import { isEphemeral, onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock();

const TUE_8PM = "2026-10-07T01:00:00Z"; // Tue Oct 6, 8:00 PM in Chicago; Wed Oct 7 in UTC

/** The customIds of every button in a payload. */
function buttonIds(payload: any): string[] {
  return flattenComponents(payload)
    .filter((c) => c.type === 2)
    .map((c) => c.custom_id);
}

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
    expect(onlyReply(first)).toBe("❌ You're out for **Tue, Oct 6 · 8:00 PM**.");
    expect(buttonIds(first.replies[0])).toEqual([`attendance:undo:${team.id}:${raid.id}:in:s`]);
    expect(await isOut(raid.id)).toBe(true);
    expect(renders()).toBe(1);
    expect(payloadText(publicMessage.payloads[1] as any)).toContain("**1/2 ready**");

    const second = fakeButton(id, base);
    await handleAttendanceControl(second, client);
    expect(onlyReply(second)).toBe("✅ You're back in for **Tue, Oct 6 · 8:00 PM**.");
    expect(buttonIds(second.replies[0])).toEqual([`attendance:undo:${team.id}:${raid.id}:out:s`]);
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

  it("rejects someone who has left the server", async () => {
    const { team, raid, client, guild } = await setup();
    const click = fakeButton(`attendance:btn:${team.id}:${raid.id}`, { guild, userId: "u-gone" });
    await handleAttendanceControl(click, client);
    expect(onlyReply(click)).toMatch(/^You're not on <@&role-team>'s roster/);
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

describe("public roster shortcut", () => {
  it("privately shows that raid's roster card and resets the public select", async () => {
    const { team, raid, client, base, renders } = await setup();
    await callOut(raid.id, "u-bob");
    const pick = fakeSelect(`attendance:pub:${team.id}`, [`roster:${raid.id}`], base);
    await handleAttendanceControl(pick, client);

    expect(pick.replies).toHaveLength(1);
    const reply = pick.replies[0];
    expect(isEphemeral(reply)).toBe(true);
    expect(payloadText(reply as any)).toContain("ROSTER");
    expect(payloadText(reply as any)).toContain("**1/2 ready**");
    expect(await prisma.attendance.count()).toBe(1); // looking changes nothing
    expect(renders()).toBe(1);
  });

  it("lets an officer off the roster look", async () => {
    const { team, raid, client, guild } = await setup({ onRoster: false });
    const pick = fakeSelect(`attendance:pub:${team.id}`, [`roster:${raid.id}`], { guild, userId: "u-alice", officer: true });
    await handleAttendanceControl(pick, client);
    expect(payloadText(pick.replies[0] as any)).toContain("ROSTER");
  });

  it("turns away someone who isn't on the team", async () => {
    const { team, raid, client, base } = await setup({ onRoster: false });
    const pick = fakeSelect(`attendance:pub:${team.id}`, [`roster:${raid.id}`], base);
    await handleAttendanceControl(pick, client);
    expect(onlyReply(pick)).toBe(`Only <@&${ROLE_ID}> and officers can see this roster.`);
  });

  it("rejects another team's raid", async () => {
    const { team, client, base } = await setup();
    const other = await makeTeam({ roleId: "role-other" });
    const theirs = await makeRaid(other.id, TUE_8PM);
    const pick = fakeSelect(`attendance:pub:${team.id}`, [`roster:${theirs.id}`], base);
    await handleAttendanceControl(pick, client);
    expect(onlyReply(pick)).toBe("This raid no longer exists.");
  });
});

describe("personal schedule Roster button", () => {
  it("privately shows that raid's roster card as a new message, changing nothing", async () => {
    const { team, raid, client, base, renders } = await setup();
    await callOut(raid.id, "u-bob");
    const click = fakeButton(`attendance:ros:${team.id}:${raid.id}`, base);
    await handleAttendanceControl(click, client);

    expect(click.replies).toHaveLength(1);
    expect(click.updates).toHaveLength(0);
    expect(isEphemeral(click.replies[0])).toBe(true);
    expect(payloadText(click.replies[0] as any)).toContain("**1/2 ready**");
    expect(await prisma.attendance.count()).toBe(1);
    expect(renders()).toBe(0);
  });

  it("rejects another team's raid", async () => {
    const { team, client, base } = await setup();
    const other = await makeTeam({ roleId: "role-other" });
    const theirs = await makeRaid(other.id, TUE_8PM);
    const click = fakeButton(`attendance:ros:${team.id}:${theirs.id}`, base);
    await handleAttendanceControl(click, client);
    expect(onlyReply(click)).toBe("This raid no longer exists.");
  });
});

describe("personal schedule select", () => {
  it("toggles the picked raid and updates the personal view in place, keeping its offset, with a confirmation on top", async () => {
    const { team, raid, client, base, renders } = await setup();
    const pick = fakeSelect(`attendance:cal:${team.id}:-3`, [raid.id], base);
    await handleAttendanceControl(pick, client);

    expect(pick.replies).toHaveLength(0);
    expect(pick.updates).toHaveLength(1);
    const options = flattenComponents(pick.updates[0]).find((c) => c.custom_id === `attendance:cal:${team.id}:-3`).options;
    expect(options[0]).toMatchObject({ value: raid.id, emoji: { name: "❌" } });
    expect(payloadText(pick.updates[0] as any).startsWith("❌ You're out for **Tue, Oct 6 · 8:00 PM**.\n")).toBe(true);
    expect(buttonIds(pick.updates[0])).toContain(`attendance:undo:${team.id}:${raid.id}:in:c-3`);
    expect(await isOut(raid.id)).toBe(true);
    // The public counts change too.
    expect(renders()).toBe(1);

    const back = fakeSelect(`attendance:cal:${team.id}:-3`, [raid.id], base);
    await handleAttendanceControl(back, client);
    expect(await isOut(raid.id)).toBe(false);
    expect(payloadText(back.updates[0] as any).startsWith("✅ You're back in for **Tue, Oct 6 · 8:00 PM**.\n")).toBe(true);
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

describe("/attendance Back in button", () => {
  it("switches you back in and redraws the view in place, re-rendering the public message", async () => {
    const { team, raid, client, base, renders } = await setup();
    await callOut(raid.id, "u-alice");
    const click = fakeButton(`attendance:in:${team.id}:${raid.id}`, base);
    await handleAttendanceControl(click, client);
    expect(await isOut(raid.id)).toBe(false);
    expect(click.replies).toEqual([]);
    expect(click.updates).toHaveLength(1);
    expect(isEphemeral(click.updates[0])).toBe(false);
    const text = payloadText(click.updates[0]);
    expect(text).toContain("✅ You're back in for **Tue, Oct 6 · 8:00 PM**.");
    expect(text).toContain("✅ You're in for the next raid");
    expect(buttonIds(click.updates[0])).toContain(`attendance:undo:${team.id}:${raid.id}:out:a`);
    expect(renders()).toBe(1);
  });

  it("with :t, redraws only its own team, with an Undo that keeps it narrowed", async () => {
    const { team, raid, client, base } = await setup();
    await callOut(raid.id, "u-alice");
    const click = fakeButton(`attendance:in:${team.id}:${raid.id}:t`, base);
    await handleAttendanceControl(click, client);
    expect(await isOut(raid.id)).toBe(false);
    expect(buttonIds(click.updates[0])).toContain(`attendance:undo:${team.id}:${raid.id}:out:t`);

    const undo = fakeButton(`attendance:undo:${team.id}:${raid.id}:out:t`, base);
    await handleAttendanceControl(undo, client);
    expect(await isOut(raid.id)).toBe(true);
    expect(buttonIds(undo.updates[0])).toContain(`attendance:in:${team.id}:${raid.id}:t`);
  });

  it("never calls you out from a stale view, and skips the re-render when nothing changed", async () => {
    const { team, raid, client, base, renders } = await setup();
    await handleAttendanceControl(fakeButton(`attendance:in:${team.id}:${raid.id}`, base), client);
    expect(await isOut(raid.id)).toBe(false);
    expect(renders()).toBe(0);
  });

  it("leaves a closed or cancelled raid alone and says why", async () => {
    const { team, client, base } = await setup();
    const closed = await makeRaid(team.id, "2026-09-30T01:00:00Z", { closed: true });
    await callOut(closed.id, "u-alice");
    const click = fakeButton(`attendance:in:${team.id}:${closed.id}`, base);
    await handleAttendanceControl(click, client);
    expect(await isOut(closed.id)).toBe(true);
    expect(payloadText(click.updates[0])).toContain("has already started or passed.");
  });

  it("says when the raid is gone or belongs to another team", async () => {
    const { client, base, raid } = await setup();
    const click = fakeButton(`attendance:in:other-team:${raid.id}`, base);
    await handleAttendanceControl(click, client);
    expect(payloadText(click.updates[0])).toContain("This raid no longer exists.");
  });
});

describe("Undo button", () => {
  const undoId = (teamId: string, raidId: string, target: string, view: string) =>
    `attendance:undo:${teamId}:${raidId}:${target}:${view}`;

  it("switches a Status call-out back and redraws the reply with an Undo that switches it again", async () => {
    const { team, raid, client, base, renders } = await setup();
    await handleAttendanceControl(fakeButton(`attendance:btn:${team.id}:${raid.id}`, base), client);
    expect(await isOut(raid.id)).toBe(true);

    const click = fakeButton(undoId(team.id, raid.id, "in", "s"), base);
    await handleAttendanceControl(click, client);
    expect(await isOut(raid.id)).toBe(false);
    expect(click.replies).toEqual([]);
    expect(payloadText(click.updates[0])).toBe("✅ You're back in for **Tue, Oct 6 · 8:00 PM**.");
    expect(buttonIds(click.updates[0])).toEqual([undoId(team.id, raid.id, "out", "s")]);
    expect(renders()).toBe(2);

    const again = fakeButton(undoId(team.id, raid.id, "out", "s"), base);
    await handleAttendanceControl(again, client);
    expect(await isOut(raid.id)).toBe(true);
    expect(payloadText(again.updates[0])).toBe("❌ You're out for **Tue, Oct 6 · 8:00 PM**.");
  });

  it("redraws /schedule at its offset and /attendance in place", async () => {
    const { team, raid, client, base } = await setup();
    await callOut(raid.id, "u-alice");
    const cal = fakeButton(undoId(team.id, raid.id, "in", "c-3"), base);
    await handleAttendanceControl(cal, client);
    expect(await isOut(raid.id)).toBe(false);
    expect(payloadText(cal.updates[0])).toContain("YOUR SCHEDULE");
    expect(buttonIds(cal.updates[0])).toContain(`mynav:later:${team.id}:-3`);

    const att = fakeButton(undoId(team.id, raid.id, "out", "a"), base);
    await handleAttendanceControl(att, client);
    expect(await isOut(raid.id)).toBe(true);
    expect(payloadText(att.updates[0])).toContain("YOUR ATTENDANCE");
    expect(payloadText(att.updates[0])).toContain("❌ You're out for **Tue, Oct 6 · 8:00 PM**.");
  });

  it("sets the state it names, so a stale Undo never flips the wrong way, and skips the re-render then", async () => {
    const { team, raid, client, base, renders } = await setup();
    const click = fakeButton(undoId(team.id, raid.id, "in", "s"), base);
    await handleAttendanceControl(click, client);
    expect(await isOut(raid.id)).toBe(false);
    expect(payloadText(click.updates[0])).toBe("✅ You're back in for **Tue, Oct 6 · 8:00 PM**.");
    expect(renders()).toBe(0);
  });

  it("leaves a closed raid alone", async () => {
    const { team, client, base } = await setup();
    const closed = await makeRaid(team.id, "2026-09-30T01:00:00Z", { closed: true });
    const click = fakeButton(undoId(team.id, closed.id, "out", "s"), base);
    await handleAttendanceControl(click, client);
    expect(await isOut(closed.id)).toBe(false);
    expect(payloadText(click.updates[0])).toContain("has already started or passed.");
  });

  it("refuses someone no longer on the roster", async () => {
    const off = await setup({ onRoster: false });
    const stranger = fakeButton(undoId(off.team.id, off.raid.id, "out", "s"), off.base);
    await handleAttendanceControl(stranger, off.client);
    expect(await isOut(off.raid.id)).toBe(false);
    expect(payloadText(stranger.updates[0])).toBe(`You're not on <@&${ROLE_ID}>'s roster.`);
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
