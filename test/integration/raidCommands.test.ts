import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import * as raidlead from "../../src/commands/raidlead/index.js";
import { CHANNEL_ID, GUILD_ID, ROLE_ID, callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { fakeChannel, fakeChatInput, fakeClient, fakeGuild, payloadText, teamRole, type FakeChannel } from "../discord.js";
import { onlyReply, useDbAndClock } from "./world.js";

useDbAndClock(); // Tue Oct 6 2026, 7:00 AM in Chicago

const TZ = "America/Chicago";
const TUE_8PM = "2026-10-07T01:00:00Z";

function setup(extraChannels: FakeChannel[] = []) {
  const guild = fakeGuild({ roles: [teamRole] });
  const channel = fakeChannel();
  const client = fakeClient({ guilds: [guild], channels: [channel, ...extraChannels] });
  /** Runs `/raidlead <group> <sub>` as an officer. */
  const run = async (group: string, subcommand: string, options: Record<string, unknown> = {}, extra: { channel?: FakeChannel | null } = {}) => {
    const interaction = fakeChatInput({ commandName: "raidlead", group, subcommand, guild, officer: true, options, ...extra });
    await raidlead.execute(interaction, client);
    return interaction;
  };
  return { guild, channel, client, run };
}

const raids = (teamId: string) => prisma.raidInstance.findMany({ where: { raidTeamId: teamId }, orderBy: { startsAt: "asc" } });
const team = (id: string) => prisma.raidTeam.findUniqueOrThrow({ where: { id } });

describe("raid add", () => {
  it("adds a one-off raid from a typed date and time, in the team's timezone", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    const reply = onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/9", time: "20:00" }));
    expect(reply).toBe("✅ Added a raid on Fri, Oct 9 · 8:00 PM (America/Chicago).");
    expect(await raids(t.id)).toEqual([
      expect.objectContaining({ startsAt: new Date("2026-10-10T01:00:00Z"), oneOff: true, cancelled: false }),
    ]);
    expect(channel.sent).toHaveLength(1);
  });

  it("accepts the picker's yyyy-MM-dd value and a single-digit hour", async () => {
    const t = await makeTeam();
    const { run } = setup();
    onlyReply(await run("raid", "add", { role: ROLE_ID, date: "2027-03-15", time: "9:05" }));
    const [raid] = await raids(t.id);
    expect(DateTime.fromJSDate(raid!.startsAt).setZone(TZ).toFormat("yyyy-MM-dd HH:mm")).toBe("2027-03-15 09:05");
  });

  it("rejects unreadable dates and times", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "someday", time: "20:00" }))).toBe(
      'Couldn\'t read "someday" as an upcoming date. Pick one from the suggestions, or type it like `3/15/2027`.',
    );
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/9", time: "8pm" }))).toBe(
      '"8pm" isn\'t a valid 24-hour time. Use `HH:MM`, e.g. `20:00`.',
    );
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "1/1/2020", time: "20:00" }))).toMatch(/^Couldn't read/);
    expect(await raids(t.id)).toEqual([]);
  });

  it("rejects a time that has already passed today, but accepts one later today", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "2026-10-06", time: "06:59" }))).toBe(
      "That time has already passed.",
    );
    expect(await raids(t.id)).toEqual([]);
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "2026-10-06", time: "07:01" }))).toMatch(/^✅ Added/);
    expect(await raids(t.id)).toHaveLength(1);
  });

  it("refuses to add a raid at the same time as an existing one", async () => {
    const t = await makeTeam();
    const existing = await makeRaid(t.id, TUE_8PM);
    const { run, channel } = setup();
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/6", time: "20:00" }))).toBe(
      "A raid is already scheduled at that time.",
    );
    expect((await raids(t.id)).map((r) => r.id)).toEqual([existing.id]);
    expect(channel.sent).toHaveLength(0);
  });

  it("restores a cancelled raid at that time instead of adding a second one", async () => {
    const t = await makeTeam();
    const cancelled = await makeRaid(t.id, TUE_8PM, { cancelled: true });
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/6", time: "20:00" }))).toMatch(/^✅ Added a raid on Tue, Oct 6/);
    expect(await raids(t.id)).toEqual([expect.objectContaining({ id: cancelled.id, cancelled: false, oneOff: false })]);
  });

  it("needs a role that's a raid team", async () => {
    await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { role: "role-x", date: "10/9", time: "20:00" }))).toBe(
      "<@&role-x> isn't a raid team yet. Create it with `/raidlead team setup`.",
    );
    expect(await prisma.raidInstance.count()).toBe(0);
  });
});

describe("raid cancel / restore", () => {
  it("cancels an open raid and restores it, re-rendering each time and keeping call-outs", async () => {
    const t = await makeTeam();
    const raid = await makeRaid(t.id, TUE_8PM);
    await callOut(raid.id, "u-bob");
    const { run, channel } = setup();

    expect(onlyReply(await run("raid", "cancel", { role: ROLE_ID, date: raid.id }))).toBe(
      "🚫 Cancelled the raid on Tue, Oct 6 · 8:00 PM.",
    );
    expect((await raids(t.id))[0]!.cancelled).toBe(true);
    expect(payloadText(channel.sent[0]!.payloads[0] as any)).toContain("🚫 **Cancelled**");

    expect(onlyReply(await run("raid", "restore", { role: ROLE_ID, date: raid.id }))).toBe(
      "✅ Restored the raid on Tue, Oct 6 · 8:00 PM.",
    );
    expect((await raids(t.id))[0]!.cancelled).toBe(false);
    expect(channel.sent[0]!.payloads).toHaveLength(2);
    expect(await prisma.attendance.count()).toBe(1);
  });

  it("refuses to cancel twice, restore an uncancelled raid, or touch a closed one", async () => {
    const t = await makeTeam();
    const open = await makeRaid(t.id, TUE_8PM);
    const cancelled = await makeRaid(t.id, "2026-10-08T01:00:00Z", { cancelled: true });
    const closed = await makeRaid(t.id, "2026-09-30T01:00:00Z", { closed: true });
    const { run, channel } = setup();
    expect(onlyReply(await run("raid", "cancel", { role: ROLE_ID, date: cancelled.id }))).toBe("That raid is already cancelled.");
    expect(onlyReply(await run("raid", "restore", { role: ROLE_ID, date: open.id }))).toBe("That raid isn't cancelled.");
    expect(onlyReply(await run("raid", "cancel", { role: ROLE_ID, date: closed.id }))).toBe("That raid has already started or passed.");
    expect(onlyReply(await run("raid", "restore", { role: ROLE_ID, date: closed.id }))).toBe("That raid has already started or passed.");
    expect((await raids(t.id)).map((r) => r.cancelled)).toEqual([false, false, true]);
    expect(channel.sent).toHaveLength(0);
  });

  it("only finds raids of the role's team", async () => {
    await makeTeam();
    const other = await makeTeam({ roleId: "role-other" });
    const otherRaid = await makeRaid(other.id, TUE_8PM);
    const { run } = setup();
    expect(onlyReply(await run("raid", "cancel", { role: ROLE_ID, date: otherRaid.id }))).toBe(
      "Couldn't find that raid. Pick one from the suggestions.",
    );
    expect((await raids(other.id))[0]!.cancelled).toBe(false);
  });
});

describe("raid remove", () => {
  it("deletes a one-off raid and its call-outs", async () => {
    const t = await makeTeam();
    const raid = await makeRaid(t.id, TUE_8PM, { oneOff: true });
    await callOut(raid.id, "u-bob");
    const { run, channel } = setup();
    expect(onlyReply(await run("raid", "remove", { role: ROLE_ID, date: raid.id }))).toBe(
      "🗑️ Removed the one-off raid on Tue, Oct 6 · 8:00 PM.",
    );
    expect(await prisma.raidInstance.count()).toBe(0);
    expect(await prisma.attendance.count()).toBe(0);
    expect(channel.sent).toHaveLength(1);
  });

  it("refuses to delete a raid generated from a weekly night", async () => {
    const t = await makeTeam();
    const raid = await makeRaid(t.id, TUE_8PM);
    const { run } = setup();
    expect(onlyReply(await run("raid", "remove", { role: ROLE_ID, date: raid.id }))).toBe(
      "That raid is on a weekly raid night, so it would come back. Cancel it instead with `/raidlead raid cancel`.",
    );
    expect(await prisma.raidInstance.count()).toBe(1);
  });

  it("can't find unknown raids", async () => {
    await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("raid", "remove", { role: ROLE_ID, date: "nope" }))).toBe(
      "Couldn't find that raid. Pick one from the suggestions.",
    );
  });
});

describe("nights", () => {
  it("add creates the night, replies, and generates the schedule", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    expect(onlyReply(await run("nights", "add", { role: ROLE_ID, day: "3", time: "20:00" }))).toBe(
      "✅ Added Wednesday 8:00 PM (America/Chicago) as a weekly raid night.",
    );
    expect(await prisma.raidSlot.findMany()).toEqual([expect.objectContaining({ raidTeamId: t.id, dayOfWeek: 3, hour: 20, minute: 0 })]);
    expect(await raids(t.id)).toHaveLength(12);
    expect(channel.sent).toHaveLength(1);

    // Adding the same night again is harmless.
    onlyReply(await run("nights", "add", { role: ROLE_ID, day: "3", time: "20:00" }));
    expect(await prisma.raidSlot.count()).toBe(1);
    expect(await raids(t.id)).toHaveLength(12);
  });

  it("add rejects a bad time", async () => {
    await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("nights", "add", { role: ROLE_ID, day: "3", time: "24:00" }))).toBe(
      '"24:00" isn\'t a valid 24-hour time. Use `HH:MM`, e.g. `20:00`.',
    );
    expect(await prisma.raidSlot.count()).toBe(0);
  });

  it("add still replies when generating the schedule fails", async () => {
    await makeTeam({ timezone: "Not/AZone" }); // generating raids in a bad zone throws
    const { run } = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const interaction = await run("nights", "add", { role: ROLE_ID, day: "3", time: "20:00" });
    expect(onlyReply(interaction)).toMatch(/^✅ Added Wednesday 8:00 PM/);
    expect(errors).toHaveBeenCalled();
  });

  it("remove deletes the night but keeps its raids", async () => {
    const t = await makeTeam();
    const slot = await makeSlot(t.id, 3);
    const raid = await makeRaid(t.id, "2026-10-08T01:00:00Z");
    const { run } = setup();
    expect(onlyReply(await run("nights", "remove", { role: ROLE_ID, night: slot.id }))).toBe(
      "🗑️ Removed Wednesday 8:00 PM as a weekly raid night. Raids already on the schedule stay; cancel them with `/raidlead raid cancel` if needed.",
    );
    expect(await prisma.raidSlot.count()).toBe(0);
    expect((await raids(t.id)).map((r) => r.id)).toEqual([raid.id]);
  });

  it("remove only finds the role's team's nights", async () => {
    await makeTeam();
    const other = await makeTeam({ roleId: "role-other" });
    const slot = await makeSlot(other.id, 3);
    const { run } = setup();
    expect(onlyReply(await run("nights", "remove", { role: ROLE_ID, night: slot.id }))).toBe(
      "Couldn't find that raid night. Pick one from the suggestions.",
    );
    expect(await prisma.raidSlot.count()).toBe(1);
  });

  it("list shows the nights in order with the timezone, or how to add one", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("nights", "list", { role: ROLE_ID }))).toBe(
      "No weekly raid nights yet. Add one with `/raidlead nights add`.",
    );
    await makeSlot(t.id, 6, 19, 30);
    await makeSlot(t.id, 2, 20, 0);
    expect(onlyReply(await run("nights", "list", { role: ROLE_ID }))).toBe(
      "• Tuesday 8:00 PM\n• Saturday 7:30 PM\n(America/Chicago)",
    );
  });
});

describe("team setup", () => {
  it("creates the team, named after the role by default, and posts its schedule", async () => {
    const { run, channel } = setup();
    const reply = onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: " Europe/London " }));
    expect(reply).toBe(
      `✅ Created raid team **Main Raid** for <@&${ROLE_ID}>, posting its schedule in <#${CHANNEL_ID}>.\n` +
        "Next, add its weekly raid nights with `/raidlead nights add`.",
    );
    const [created] = await prisma.raidTeam.findMany();
    expect(created).toMatchObject({ guildId: GUILD_ID, roleId: ROLE_ID, channelId: CHANNEL_ID, timezone: "Europe/London", name: "Main Raid", displayCount: 3 });
    expect(channel.sent).toHaveLength(1);
    expect(created!.messageId).toBe(channel.sent[0]!.id);
  });

  it("takes a name and a coming-up count, including 0", async () => {
    const { run } = setup();
    onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: TZ, name: "Weekend", "coming-up": 0 }));
    expect(await prisma.raidTeam.findFirst()).toMatchObject({ name: "Weekend", displayCount: 0 });
  });

  it("rejects an unknown timezone and a role that's already a team", async () => {
    const { run } = setup();
    expect(onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: "Mars/Olympus" }))).toBe(
      '"Mars/Olympus" isn\'t a recognized timezone. Pick one from the suggestions as you type.',
    );
    expect(await prisma.raidTeam.count()).toBe(0);

    await makeTeam();
    expect(onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: TZ }))).toBe(
      `<@&${ROLE_ID}> is already a raid team. Change its settings with \`/raidlead team edit\`.`,
    );
    expect(await prisma.raidTeam.count()).toBe(1);
  });
});

describe("team edit", () => {
  it("needs at least one setting, and a valid timezone", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("team", "edit", { role: ROLE_ID }))).toBe("Pick at least one setting to change.");
    expect(onlyReply(await run("team", "edit", { role: ROLE_ID, timezone: "Nowhere/Land" }))).toMatch(/isn't a recognized timezone/);
    expect(await team(t.id)).toMatchObject({ timezone: TZ, name: "Main Raid" });
  });

  it("updates name, timezone and coming-up, and re-renders in place", async () => {
    const t = await makeTeam({ messageId: "public" });
    const { run, channel } = setup();
    const existing = channel.seedMessage("public");
    const reply = onlyReply(await run("team", "edit", { role: ROLE_ID, name: "Core", timezone: "Europe/Paris", "coming-up": 5 }));
    expect(reply).toBe(`✅ Updated **Core**.\n• Channel: <#${CHANNEL_ID}>\n• Timezone: Europe/Paris\n• Coming Up raids: 5`);
    expect(await team(t.id)).toMatchObject({ name: "Core", timezone: "Europe/Paris", displayCount: 5, messageId: "public" });
    expect(existing.payloads).toHaveLength(2);
    expect(channel.sent).toHaveLength(0);
  });

  it("moving the channel deletes the old message and posts in the new channel", async () => {
    const t = await makeTeam({ messageId: "public" });
    const newChannel = fakeChannel("channel-2");
    const { run, channel } = setup([newChannel]);
    const old = channel.seedMessage("public");
    onlyReply(await run("team", "edit", { role: ROLE_ID, channel: "channel-2" }));
    expect(old.deleted).toBe(true);
    expect(newChannel.sent).toHaveLength(1);
    expect(await team(t.id)).toMatchObject({ channelId: "channel-2", messageId: newChannel.sent[0]!.id });
  });

  it("naming the current channel is not a move", async () => {
    await makeTeam({ messageId: "public" });
    const { run, channel } = setup();
    const existing = channel.seedMessage("public");
    onlyReply(await run("team", "edit", { role: ROLE_ID, channel: CHANNEL_ID }));
    expect(existing.deleted).toBe(false);
    expect(existing.payloads).toHaveLength(2);
  });

  it("falls back to the role's name in the reply for an unnamed team", async () => {
    await makeTeam({ name: null });
    const { run } = setup();
    expect(onlyReply(await run("team", "edit", { role: ROLE_ID, "coming-up": 1 }))).toMatch(/^✅ Updated \*\*Main Raid\*\*\./);
  });
});

describe("team publish", () => {
  it("posts the schedule in the current channel, replacing the old message", async () => {
    const t = await makeTeam({ messageId: "public" });
    const here = fakeChannel("channel-here");
    const { run, channel } = setup([here]);
    const old = channel.seedMessage("public");
    expect(onlyReply(await run("team", "publish", { role: ROLE_ID }, { channel: here }))).toBe(
      "✅ Schedule posted in <#channel-here>.",
    );
    expect(old.deleted).toBe(true);
    expect(here.sent).toHaveLength(1);
    expect(await team(t.id)).toMatchObject({ channelId: "channel-here", messageId: here.sent[0]!.id });
  });

  it("re-publishing in the same channel replaces the message rather than editing it", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    await run("team", "publish", { role: ROLE_ID }, { channel });
    await run("team", "publish", { role: ROLE_ID }, { channel });
    expect(channel.sent).toHaveLength(2);
    expect(channel.sent[0]!.deleted).toBe(true);
    expect((await team(t.id)).messageId).toBe(channel.sent[1]!.id);
  });

  it("needs a text channel", async () => {
    const t = await makeTeam();
    const voice = Object.assign(fakeChannel("voice"), { isTextBased: () => false });
    const { run } = setup([voice]);
    expect(onlyReply(await run("team", "publish", { role: ROLE_ID }, { channel: voice }))).toBe("Run this in a text channel.");
    expect(onlyReply(await run("team", "publish", { role: ROLE_ID }, { channel: null }))).toBe("Run this in a text channel.");
    expect((await team(t.id)).channelId).toBe(CHANNEL_ID);
  });
});
