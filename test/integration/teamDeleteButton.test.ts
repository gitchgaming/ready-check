import { describe, expect, it } from "vitest";
import { handleTeamDeleteButton, isTeamDeleteButton } from "../../src/interactions/teamDeleteButton.js";
import { callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { fakeButton } from "../discord.js";
import { useDbAndClock, world } from "./world.js";

useDbAndClock();

async function setup() {
  const team = await makeTeam({ messageId: "public" });
  await makeSlot(team.id, 3);
  const raid = await makeRaid(team.id, "2026-10-07T01:00:00Z");
  await callOut(raid.id, "u-alice");
  const w = world({ ownerId: "u-owner" });
  const publicMessage = w.channel.seedMessage("public");
  return { team, ...w, publicMessage };
}

const counts = async () => ({
  teams: await prisma.raidTeam.count(),
  slots: await prisma.raidSlot.count(),
  raids: await prisma.raidInstance.count(),
  attendance: await prisma.attendance.count(),
});

describe("isTeamDeleteButton", () => {
  it("claims teamdelete: customIds only", () => {
    expect(isTeamDeleteButton("teamdelete:confirm:t")).toBe(true);
    expect(isTeamDeleteButton("mynav:later:t:0")).toBe(false);
  });
});

describe("handleTeamDeleteButton", () => {
  it("deletes the team, its nights, raids and call-outs, and its schedule message, for an officer", async () => {
    const { team, client, guild, publicMessage } = await setup();
    const click = fakeButton(`teamdelete:confirm:${team.id}`, { guild, officer: true });
    await handleTeamDeleteButton(click, client);

    expect(click.updates).toEqual([{ content: "🗑️ Deleted **Main Raid**.", components: [] }]);
    expect(await counts()).toEqual({ teams: 0, slots: 0, raids: 0, attendance: 0 });
    expect(publicMessage.deleted).toBe(true);
  });

  it("lets the server owner delete without Manage Events, and names an unnamed team generically", async () => {
    const { team, client, guild } = await setup();
    await prisma.raidTeam.update({ where: { id: team.id }, data: { name: null, messageId: null } });
    const click = fakeButton(`teamdelete:confirm:${team.id}`, { guild, userId: "u-owner" });
    await handleTeamDeleteButton(click, client);
    expect(click.updates[0].content).toBe("🗑️ Deleted **the team**.");
    expect(await prisma.raidTeam.count()).toBe(0);
  });

  it("re-checks officer status: a raider's confirm deletes nothing", async () => {
    const { team, client, guild, publicMessage } = await setup();
    const click = fakeButton(`teamdelete:confirm:${team.id}`, { guild, userId: "u-raider" });
    await handleTeamDeleteButton(click, client);
    expect(click.updates).toEqual([{ content: "Only officers can delete raid teams.", components: [] }]);
    expect(await counts()).toEqual({ teams: 1, slots: 1, raids: 1, attendance: 1 });
    expect(publicMessage.deleted).toBe(false);
  });

  it("keeps everything on abort", async () => {
    const { team, client, guild, publicMessage } = await setup();
    const click = fakeButton(`teamdelete:abort:${team.id}`, { guild, officer: true });
    await handleTeamDeleteButton(click, client);
    expect(click.updates).toEqual([{ content: "Kept the team. Nothing was deleted.", components: [] }]);
    expect(await counts()).toEqual({ teams: 1, slots: 1, raids: 1, attendance: 1 });
    expect(publicMessage.deleted).toBe(false);
  });

  it("says so when the team was already deleted", async () => {
    const { team, client, guild } = await setup();
    await handleTeamDeleteButton(fakeButton(`teamdelete:confirm:${team.id}`, { guild, officer: true }), client);
    const again = fakeButton(`teamdelete:confirm:${team.id}`, { guild, officer: true });
    await handleTeamDeleteButton(again, client);
    expect(again.updates).toEqual([{ content: "That team was already deleted.", components: [] }]);
  });

  it("still deletes the team when its schedule message is already gone", async () => {
    const { team, guild } = await setup();
    const { client } = world(); // a fresh channel that doesn't hold the stored message
    await handleTeamDeleteButton(fakeButton(`teamdelete:confirm:${team.id}`, { guild, officer: true }), client);
    expect(await prisma.raidTeam.count()).toBe(0);
  });
});
