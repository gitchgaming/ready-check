import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import * as raidlead from "../../src/commands/raidlead/index.js";
import { CHANNEL_ID, GUILD_ID, ROLE_ID, callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { fakeChannel, fakeChatInput, fakeClient, fakeGuild, payloadText, teamRole, type FakeChannel } from "../discord.js";
import { onlyReply, useDbAndClock } from "./world.js";
import { syncRaidTeam } from "../../src/lib/scheduler.js";

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

describe("role option that isn't a raid team", () => {
  it.each([
    ["nights", "add", { day: "3", time: "20:00" }],
    ["nights", "remove", { night: "x" }],
    ["nights", "list", {}],
    ["raid", "cancel", { date: "x" }],
    ["raid", "restore", { date: "x" }],
    ["raid", "remove", { date: "x" }],
    ["team", "edit", { name: "New" }],
    ["team", "delete", {}],
    ["team", "publish", {}],
    ["team", "final-raid", { date: "2026-10-20" }],
    ["team", "resume", {}],
  ])("%s %s says how to create the team and changes nothing", async (group, sub, options) => {
    const t = await makeTeam();
    const { run, channel } = setup();
    const reply = onlyReply(await run(group, sub, { role: "role-x", ...options }, { channel }));
    expect(reply).toBe("<@&role-x> isn't a raid team yet. Create it with `/raidlead team setup`.");
    expect(await prisma.raidSlot.count()).toBe(0);
    expect(await team(t.id)).toMatchObject({ name: "Main Raid", messageId: null });
    expect(channel.sent).toHaveLength(0);
  });
});

describe("raid add", () => {
  it("adds a one-off raid from a typed date and time, in the team's timezone", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    const reply = onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/9", time: "20:00" }));
    expect(reply).toBe("✅ Added a raid on <t:1791594000:F> (Fri, Oct 9 · 8:00 PM CDT in team time).");
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
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/6", time: "20:00" }))).toMatch(/^✅ Added a raid on <t:1791334800:F> \(Tue, Oct 6/);
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
      "🚫 Cancelled the raid on <t:1791334800:F>.",
    );
    expect((await raids(t.id))[0]!.cancelled).toBe(true);
    expect(payloadText(channel.sent[0]!.payloads[0] as any)).toContain("🚫 **Cancelled**");

    expect(onlyReply(await run("raid", "restore", { role: ROLE_ID, date: raid.id }))).toBe(
      "✅ Restored the raid on <t:1791334800:F>.",
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
      "🗑️ Removed the one-off raid on <t:1791334800:F>.",
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
      "✅ Added Wednesday 8:00 PM Central Time (America/Chicago) as a weekly raid night. Next: <t:1791421200:F>.",
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

  it("remove deletes the night with its upcoming raids and their call-outs", async () => {
    const t = await makeTeam({ messageId: "public" });
    const slot = await makeSlot(t.id, 3); // Wednesdays, 8:00 PM Central
    await makeSlot(t.id, 2);
    const wed = await makeRaid(t.id, "2026-10-08T01:00:00Z");
    await callOut(wed.id, "raider-1");
    await makeRaid(t.id, "2026-10-15T01:00:00Z", { cancelled: true });
    const oneOff = await makeRaid(t.id, "2026-10-22T01:00:00Z", { oneOff: true });
    const closed = await makeRaid(t.id, "2026-09-24T01:00:00Z", { closed: true });
    const tue = await makeRaid(t.id, TUE_8PM);
    const { run, channel } = setup();
    channel.seedMessage("public");

    expect(onlyReply(await run("nights", "remove", { role: ROLE_ID, night: slot.id }))).toBe(
      "🗑️ Removed Wednesday 8:00 PM Central Time as a weekly raid night, along with its 2 upcoming raids and 1 call-out.",
    );
    expect(await prisma.raidSlot.count()).toBe(1);
    const left = (await raids(t.id)).map((r) => r.id);
    expect(left).toEqual(expect.arrayContaining([closed.id, tue.id, oneOff.id]));
    expect(left).not.toContain(wed.id);
    expect(await prisma.attendance.count()).toBe(0);
    // The sync adds nothing back on Wednesdays.
    expect((await raids(t.id)).filter((r) => r.startsAt.getUTCDay() === 4 && !r.oneOff && !r.closed)).toEqual([]);
  });

  it("remove keeps a raid that's already under way", async () => {
    const t = await makeTeam();
    const slot = await makeSlot(t.id, 2, 6); // Tuesdays, 6:00 AM Central: an hour ago
    const started = await makeRaid(t.id, "2026-10-06T11:00:00Z");
    const { run } = setup();
    expect(onlyReply(await run("nights", "remove", { role: ROLE_ID, night: slot.id }))).toBe(
      "🗑️ Removed Tuesday 6:00 AM Central Time as a weekly raid night.",
    );
    expect((await raids(t.id)).map((r) => r.id)).toEqual([started.id]);
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

  it("list shows the nights in order with each one's next raid and the timezone, or how to add one", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("nights", "list", { role: ROLE_ID }))).toBe(
      "No weekly raid nights yet. Add one with `/raidlead nights add`.",
    );
    await makeSlot(t.id, 6, 19, 30);
    await makeSlot(t.id, 2, 20, 0);
    expect(onlyReply(await run("nights", "list", { role: ROLE_ID }))).toBe(
      "• Tuesday 8:00 PM · next <t:1791334800:F>\n• Saturday 7:30 PM · next <t:1791678600:F>\n-# Nights are in team time, Central Time (America/Chicago).",
    );
  });
});

describe("team setup", () => {
  it("creates the team, named after the role by default, and posts its schedule", async () => {
    const { run, channel } = setup();
    const reply = onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: " Europe/London " }));
    expect(reply).toBe(
      `✅ Created 25-player raid team **Main Raid** for <@&${ROLE_ID}>, posting its schedule in <#${CHANNEL_ID}>.\n` +
        "Next, add its weekly raid nights with `/raidlead nights add`.",
    );
    const [created] = await prisma.raidTeam.findMany();
    expect(created).toMatchObject({ guildId: GUILD_ID, roleId: ROLE_ID, channelId: CHANNEL_ID, timezone: "Europe/London", name: "Main Raid", displayCount: 3, raidSize: 25 });
    expect(channel.sent).toHaveLength(1);
    expect(created!.messageId).toBe(channel.sent[0]!.id);
  });

  it("takes a name and a coming-up count, including 0", async () => {
    const { run } = setup();
    onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: TZ, name: "Weekend", "coming-up": 0 }));
    expect(await prisma.raidTeam.findFirst()).toMatchObject({ name: "Weekend", displayCount: 0 });
  });

  it("takes a raid size", async () => {
    const { run } = setup();
    expect(onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: TZ, size: 20 }))).toMatch(
      /^✅ Created 20-player raid team/,
    );
    expect(await prisma.raidTeam.findFirst()).toMatchObject({ raidSize: 20 });
  });

  it("still creates the team and replies when the schedule can't be posted (e.g. no Send Messages)", async () => {
    const { run, channel } = setup();
    channel.send = async () => {
      throw new Error("Missing Permissions");
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: TZ }))).toMatch(/^✅ Created 25-player raid team/);
    expect(await prisma.raidTeam.count()).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("Failed to sync raid team"), expect.any(Error));
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
    expect(reply).toBe(`✅ Updated **Core**.\n• Channel: <#${CHANNEL_ID}>\n• Timezone: Europe/Paris\n• Raid size: 25-player\n• Coming Up raids: 5`);
    expect(await team(t.id)).toMatchObject({ name: "Core", timezone: "Europe/Paris", displayCount: 5, messageId: "public" });
    expect(existing.payloads).toHaveLength(2);
    expect(channel.sent).toHaveLength(0);
  });

  it("changes the raid size alone, and re-renders against it", async () => {
    const t = await makeTeam({ messageId: "public" });
    const { run, channel } = setup();
    const existing = channel.seedMessage("public");
    expect(onlyReply(await run("team", "edit", { role: ROLE_ID, size: 20 }))).toContain("• Raid size: 20-player");
    expect(await team(t.id)).toMatchObject({ raidSize: 20 });
    expect(existing.payloads).toHaveLength(2);
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

  it("moves away from a channel that no longer exists", async () => {
    const t = await makeTeam({ channelId: "deleted-channel", messageId: "lost" });
    const newChannel = fakeChannel("channel-2");
    const { run } = setup([newChannel]);
    onlyReply(await run("team", "edit", { role: ROLE_ID, channel: "channel-2" }));
    expect(newChannel.sent).toHaveLength(1);
    expect(await team(t.id)).toMatchObject({ channelId: "channel-2", messageId: newChannel.sent[0]!.id });
  });

  it("still saves and replies when re-rendering fails", async () => {
    const t = await makeTeam({ messageId: "public" });
    const { run, channel } = setup();
    channel.seedMessage("public").edit = async () => {
      throw new Error("Missing Access");
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(onlyReply(await run("team", "edit", { role: ROLE_ID, name: "Core" }))).toMatch(/^✅ Updated \*\*Core\*\*/);
    expect((await team(t.id)).name).toBe("Core");
    expect(errors).toHaveBeenCalled();
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

describe("team final-raid / resume", () => {
  const day = (r: { startsAt: Date }) => DateTime.fromJSDate(r.startsAt).setZone(TZ).toISODate();

  /** A Tuesday 8 PM team with its 12 weekly raids generated: Oct 6 through Dec 22. */
  async function weeklyTeam() {
    const t = await makeTeam();
    await makeSlot(t.id, 2);
    const w = setup();
    await w.run("nights", "add", { role: ROLE_ID, day: "2", time: "20:00" });
    return { t, ...w };
  }

  it("removes later raids with their call-outs, keeps earlier and past ones, and stops generating", async () => {
    const { t, run, channel } = await weeklyTeam();
    const past = await makeRaid(t.id, "2026-09-30T01:00:00Z", { closed: true });
    await callOut(past.id, "u-alice");
    const all = await raids(t.id);
    expect(all).toHaveLength(13);
    await callOut(all.find((r) => day(r) === "2026-10-13")!.id, "u-alice");
    await callOut(all.find((r) => day(r) === "2026-10-27")!.id, "u-alice");
    await callOut(all.find((r) => day(r) === "2026-11-03")!.id, "u-bob");

    expect(onlyReply(await run("team", "final-raid", { role: ROLE_ID, date: "2026-10-20" }))).toBe(
      "🏁 **Main Raid**'s final raid date is Tuesday, Oct 20, 2026 (team time). Removed 9 raids after it, with 2 call-outs.\n" +
        "No new raids will be scheduled after it; past raids and their attendance stay. " +
        "To schedule the weekly nights again, use `/raidlead team resume`.",
    );
    expect((await team(t.id)).finalRaidDate).toBe("2026-10-20");
    expect((await raids(t.id)).map(day)).toEqual(["2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20"]);
    expect(await prisma.attendance.count()).toBe(2);
    expect(payloadText(channel.sent.at(-1)!.payloads.at(-1) as any)).toContain("COMING UP");

    // The hourly sync keeps to it, a week on as well.
    await syncRaidTeam(fakeClient(), t.id);
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    await syncRaidTeam(fakeClient(), t.id);
    expect((await raids(t.id)).map(day)).toEqual(["2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20"]);
  });

  it("takes a typed date, and moving it later only stops what's past the new date", async () => {
    const { t, run } = await weeklyTeam();
    onlyReply(await run("team", "final-raid", { role: ROLE_ID, date: "10/13" }));
    expect(await raids(t.id)).toHaveLength(2);

    // Moving it later lets the sync fill in up to the new date.
    expect(onlyReply(await run("team", "final-raid", { role: ROLE_ID, date: "11/3" }))).toMatch(
      /^🏁 \*\*Main Raid\*\*'s final raid date is Tuesday, Nov 3, 2026 \(team time\)\. There were no raids after it\.\n/,
    );
    expect((await raids(t.id)).map(day).at(-1)).toBe("2026-11-03");
    expect(await raids(t.id)).toHaveLength(5);
  });

  it("rejects dates it can't read or that have passed", async () => {
    const { t, run } = await weeklyTeam();
    for (const date of ["someday", "1/1/2020", "none"]) {
      expect(onlyReply(await run("team", "final-raid", { role: ROLE_ID, date }))).toBe(
        `Couldn't read "${date}" as an upcoming date. Pick one from the suggestions, or type it like \`3/15/2027\`.`,
      );
    }
    expect((await team(t.id)).finalRaidDate).toBeNull();
    expect(await raids(t.id)).toHaveLength(12);
  });

  it("today ends the team after today's raid; with none left the schedule says so", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    expect(onlyReply(await run("team", "final-raid", { role: ROLE_ID, date: "2026-10-06" }))).toMatch(/There were no raids after it\./);
    await run("nights", "add", { role: ROLE_ID, day: "3", time: "20:00" });
    expect(await raids(t.id)).toHaveLength(0);
    const text = payloadText(channel.sent.at(-1)!.payloads.at(-1) as any);
    expect(text).toContain("## No more raids");
    expect(text).toContain("final raid date has passed");
  });

  it("raid add refuses a raid after the final raid date, but not one on it", async () => {
    const t = await makeTeam({ finalRaidDate: "2026-10-09" });
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/10", time: "00:30" }))).toBe(
      "That's after the team's final raid date, Friday, Oct 9, 2026. Move it with `/raidlead team final-raid`, or clear it with `/raidlead team resume`.",
    );
    onlyReply(await run("raid", "add", { role: ROLE_ID, date: "10/9", time: "23:30" }));
    expect(await raids(t.id)).toHaveLength(1);
  });

  it("nights list and add note the final raid date", async () => {
    const t = await makeTeam({ finalRaidDate: "2026-10-06" });
    await makeSlot(t.id, 2);
    const { run } = setup();
    const note = "\n-# Final raid date: Tuesday, Oct 6, 2026. No raids are scheduled after it; clear it with `/raidlead team resume`.";
    expect(onlyReply(await run("nights", "list", { role: ROLE_ID }))).toBe(
      "• Tuesday 8:00 PM · next <t:1791334800:F>\n-# Nights are in team time, Central Time (America/Chicago)." + note,
    );
    expect(onlyReply(await run("nights", "add", { role: ROLE_ID, day: "3", time: "20:00" }))).toBe(
      "✅ Added Wednesday 8:00 PM Central Time (America/Chicago) as a weekly raid night. Next: none before the final raid date." + note,
    );
  });

  it("resume clears the date and the weekly nights schedule again", async () => {
    const { t, run } = await weeklyTeam();
    expect(onlyReply(await run("team", "resume", { role: ROLE_ID }))).toBe(
      "**Main Raid** has no final raid date, so its weekly nights are already scheduling raids.",
    );
    await run("team", "final-raid", { role: ROLE_ID, date: "2026-10-06" });
    expect(await raids(t.id)).toHaveLength(1);

    expect(onlyReply(await run("team", "resume", { role: ROLE_ID }))).toBe(
      "✅ Cleared **Main Raid**'s final raid date (Tuesday, Oct 6, 2026). Its weekly nights are scheduling raids again; call-outs on removed raids don't come back.",
    );
    expect((await team(t.id)).finalRaidDate).toBeNull();
    expect(await raids(t.id)).toHaveLength(12);
  });

  it("team edit lists the final raid date", async () => {
    await makeTeam({ finalRaidDate: "2026-12-01" });
    const { run } = setup();
    expect(onlyReply(await run("team", "edit", { role: ROLE_ID, name: "Mythic" }))).toMatch(/\n• Final raid date: Tuesday, Dec 1, 2026$/);
  });
});
