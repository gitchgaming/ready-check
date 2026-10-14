import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import * as raidlead from "../../src/commands/raidlead/index.js";
import { CHANNEL_ID, GUILD_ID, ROLE_ID, callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { fakeAutocomplete, fakeButton, fakeChannel, fakeChatInput, fakeClient, fakeGuild, fakeMember, fakeRole, payloadText, teamRole, type FakeChannel } from "../discord.js";
import { onlyReply, useDbAndClock } from "./world.js";
import { syncRaidTeam } from "../../src/lib/scheduler.js";
import { routeInteraction } from "../../src/interactions/router.js";

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

describe("picking the team", () => {
  it.each([
    ["nights", "add", { day: "3", time: "20:00" }],
    ["nights", "remove", { night: "x" }],
    ["nights", "edit", { night: "x", time: "21:00" }],
    ["raid", "cancel", { date: "x" }],
    ["team", "settings", { name: "New" }],
    ["team", "delete", {}],
    ["team", "post", {}],
  ])("%s %s with a team that doesn't exist says so and changes nothing", async (group, sub, options) => {
    const t = await makeTeam();
    const { run, channel } = setup();
    const reply = onlyReply(await run(group, sub, { team: "nope", ...options }, { channel }));
    expect(reply).toBe("Couldn't find that team. Pick one from the `team:` suggestions.");
    expect(await prisma.raidSlot.count()).toBe(0);
    expect(await team(t.id)).toMatchObject({ name: "Main Raid", messageId: null });
    expect(channel.sent).toHaveLength(0);
  });

  it("with no teams yet, says how to create one", async () => {
    const { run } = setup();
    expect(onlyReply(await run("team", "settings"))).toBe("There are no raid teams yet. Create one with `/raidlead team setup`.");
  });

  it("uses the server's only team, else the officer's only team, else asks", async () => {
    const main = await makeTeam();
    const alts = await makeTeam({ roleId: "role-alts", name: "Alts" });
    await makeSlot(main.id, 2);
    await makeSlot(alts.id, 4);
    const { guild, client } = setup();
    const list = async (userId: string, options: Record<string, unknown> = {}) => {
      const interaction = fakeChatInput({ commandName: "raidlead", group: "team", subcommand: "settings", guild, officer: true, userId, options });
      await raidlead.execute(interaction, client);
      return onlyReply(interaction);
    };
    expect(await list("user-1")).toBe("Pick which team in the `team:` option.");
    guild.members.cache.set("u-alts", fakeMember({ id: "u-alts", name: "Ana", roles: [fakeRole("Alts", "role-alts")] }));
    expect(await list("u-alts")).toMatch(/^\*\*Alts\*\*/);
    // A pick wins over the default, by id or by typed name.
    expect(await list("u-alts", { team: main.id })).toMatch(/^\*\*Main Raid\*\*/);
    expect(await list("user-1", { team: " main raid " })).toMatch(/^\*\*Main Raid\*\*/);
  });

  it("the team picker lists every team, the officer's own first", async () => {
    await makeTeam();
    const alts = await makeTeam({ roleId: "role-alts", name: "Alts" });
    const { guild } = setup();
    guild.members.cache.set("u-alts", fakeMember({ id: "u-alts", name: "Ana", roles: [fakeRole("Alts", "role-alts")] }));
    const interaction = fakeAutocomplete({ commandName: "raidlead", group: "raid", subcommand: "cancel", guild, officer: true, userId: "u-alts", focused: "team", options: { team: "" } });
    await raidlead.autocomplete(interaction);
    expect(interaction.responses[0]).toEqual([
      { name: "Alts", value: alts.id },
      { name: "Main Raid", value: expect.any(String) },
    ]);
  });
});

describe("raid add", () => {
  it("adds a one-off raid from a typed date and time, in the team's timezone", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    const reply = onlyReply(await run("raid", "add", { date: "10/9", time: "20:00" }));
    expect(reply).toBe("✅ Added a raid on <t:1791594000:F> (Fri, Oct 9 · 8:00 PM CDT in team time).");
    expect(await raids(t.id)).toEqual([
      expect.objectContaining({ startsAt: new Date("2026-10-10T01:00:00Z"), oneOff: true, cancelled: false }),
    ]);
    expect(channel.sent).toHaveLength(1);
  });

  it("accepts the picker's yyyy-MM-dd value and a single-digit hour", async () => {
    const t = await makeTeam();
    const { run } = setup();
    onlyReply(await run("raid", "add", { date: "2027-03-15", time: "9:05" }));
    const [raid] = await raids(t.id);
    expect(DateTime.fromJSDate(raid!.startsAt).setZone(TZ).toFormat("yyyy-MM-dd HH:mm")).toBe("2027-03-15 09:05");
  });

  it("rejects unreadable dates and times", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { date: "someday", time: "20:00" }))).toBe(
      'Couldn\'t read "someday" as an upcoming date. Pick one from the suggestions, or type it like `3/15/2027`.',
    );
    expect(onlyReply(await run("raid", "add", { date: "10/9", time: "8pm" }))).toBe(
      '"8pm" isn\'t a valid 24-hour time. Use `HH:MM`, e.g. `20:00`.',
    );
    expect(onlyReply(await run("raid", "add", { date: "1/1/2020", time: "20:00" }))).toMatch(/^Couldn't read/);
    expect(await raids(t.id)).toEqual([]);
  });

  it("rejects a time that has already passed today, but accepts one later today", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { date: "2026-10-06", time: "06:59" }))).toBe(
      "That time has already passed.",
    );
    expect(await raids(t.id)).toEqual([]);
    expect(onlyReply(await run("raid", "add", { date: "2026-10-06", time: "07:01" }))).toMatch(/^✅ Added/);
    expect(await raids(t.id)).toHaveLength(1);
  });

  it("refuses to add a raid at the same time as an existing one", async () => {
    const t = await makeTeam();
    const existing = await makeRaid(t.id, TUE_8PM);
    const { run, channel } = setup();
    expect(onlyReply(await run("raid", "add", { date: "10/6", time: "20:00" }))).toBe(
      "A raid is already scheduled at that time.",
    );
    expect((await raids(t.id)).map((r) => r.id)).toEqual([existing.id]);
    expect(channel.sent).toHaveLength(0);
  });

  it("restores a cancelled raid at that time instead of adding a second one", async () => {
    const t = await makeTeam();
    const cancelled = await makeRaid(t.id, TUE_8PM, { cancelled: true });
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { date: "10/6", time: "20:00" }))).toMatch(/^✅ Added a raid on <t:1791334800:F> \(Tue, Oct 6/);
    expect(await raids(t.id)).toEqual([expect.objectContaining({ id: cancelled.id, cancelled: false, oneOff: false })]);
  });
});

describe("raid cancel", () => {
  const undoId = (interaction: { replies: any[] }) => interaction.replies[0].components[0].toJSON().components[0].custom_id;

  it("cancels an open raid and, picked again, restores it, re-rendering each time and keeping call-outs", async () => {
    const t = await makeTeam();
    const raid = await makeRaid(t.id, TUE_8PM, { oneOff: true });
    await callOut(raid.id, "u-bob");
    const { run, channel } = setup();

    const cancel = await run("raid", "cancel", { date: raid.id });
    expect(onlyReply(cancel)).toBe("🚫 Cancelled the raid on <t:1791334800:F>.");
    expect(undoId(cancel)).toBe(`raidlead:cancel:${raid.id}:0`);
    expect((await raids(t.id))[0]!.cancelled).toBe(true);
    expect(payloadText(channel.sent[0]!.payloads[0] as any)).toContain("🚫 **Cancelled**");

    const restore = await run("raid", "cancel", { date: raid.id });
    expect(onlyReply(restore)).toBe("✅ Restored the raid on <t:1791334800:F>.");
    expect(undoId(restore)).toBe(`raidlead:cancel:${raid.id}:1`);
    expect((await raids(t.id))[0]!.cancelled).toBe(false);
    expect(channel.sent[0]!.payloads).toHaveLength(2);
    expect(await prisma.attendance.count()).toBe(1);
  });

  it("Undo sets the state it names, for officers only", async () => {
    const t = await makeTeam({ messageId: "public" });
    const raid = await makeRaid(t.id, TUE_8PM);
    const { guild, client, channel } = setup();
    const existing = channel.seedMessage("public");
    const click = async (customId: string, officer = true) => {
      const button = fakeButton(customId, { guild, officer });
      await routeInteraction(button, client);
      return button.updates[0];
    };

    expect((await click(`raidlead:cancel:${raid.id}:1`)).content).toBe("🚫 Cancelled the raid on <t:1791334800:F>.");
    expect((await click(`raidlead:cancel:${raid.id}:1`)).content).toBe("🚫 Cancelled the raid on <t:1791334800:F>.");
    expect((await raids(t.id))[0]!.cancelled).toBe(true);
    expect(existing.payloads.length).toBeGreaterThan(1);
    expect((await click(`raidlead:cancel:${raid.id}:0`, false)).content).toBe("Only officers can change this.");
    expect((await raids(t.id))[0]!.cancelled).toBe(true);
    expect((await click(`raidlead:cancel:${raid.id}:0`)).content).toBe("✅ Restored the raid on <t:1791334800:F>.");
    expect((await click("raidlead:cancel:gone:0")).content).toBe("That raid has already started, passed, or been removed.");
  });

  it("refuses a closed raid", async () => {
    const t = await makeTeam();
    const closed = await makeRaid(t.id, "2026-09-30T01:00:00Z", { closed: true });
    const { run, channel } = setup();
    expect(onlyReply(await run("raid", "cancel", { date: closed.id }))).toBe("That raid has already started or passed.");
    expect((await raids(t.id))[0]!.cancelled).toBe(false);
    expect(channel.sent).toHaveLength(0);
  });

  it("only finds raids of the picked team", async () => {
    const main = await makeTeam();
    const other = await makeTeam({ roleId: "role-other" });
    const otherRaid = await makeRaid(other.id, TUE_8PM);
    const { run } = setup();
    expect(onlyReply(await run("raid", "cancel", { team: main.id, date: otherRaid.id }))).toBe(
      "Couldn't find that raid. Pick one from the suggestions.",
    );
    expect((await raids(other.id))[0]!.cancelled).toBe(false);
  });
});

describe("nights", () => {
  it("add creates the night, replies, and generates the schedule", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    expect(onlyReply(await run("nights", "add", { day: "3", time: "20:00" }))).toBe(
      "✅ Added Wednesday 8:00 PM Central Time (America/Chicago) as a weekly raid night. Next: <t:1791421200:F>.",
    );
    expect(await prisma.raidSlot.findMany()).toEqual([expect.objectContaining({ raidTeamId: t.id, dayOfWeek: 3, hour: 20, minute: 0 })]);
    expect(await raids(t.id)).toHaveLength(12);
    expect(channel.sent).toHaveLength(1);

    // Adding the same night again is harmless.
    onlyReply(await run("nights", "add", { day: "3", time: "20:00" }));
    expect(await prisma.raidSlot.count()).toBe(1);
    expect(await raids(t.id)).toHaveLength(12);
  });

  it("add rejects a bad time", async () => {
    await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("nights", "add", { day: "3", time: "24:00" }))).toBe(
      '"24:00" isn\'t a valid 24-hour time. Use `HH:MM`, e.g. `20:00`.',
    );
    expect(await prisma.raidSlot.count()).toBe(0);
  });

  it("add still replies when generating the schedule fails", async () => {
    await makeTeam({ timezone: "Not/AZone" }); // generating raids in a bad zone throws
    const { run } = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const interaction = await run("nights", "add", { day: "3", time: "20:00" });
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

    expect(onlyReply(await run("nights", "remove", { night: slot.id }))).toBe(
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
    expect(onlyReply(await run("nights", "remove", { night: slot.id }))).toBe(
      "🗑️ Removed Tuesday 6:00 AM Central Time as a weekly raid night.",
    );
    expect((await raids(t.id)).map((r) => r.id)).toEqual([started.id]);
  });

  it("edit moves the night and its upcoming raids, keeping their call-outs", async () => {
    const t = await makeTeam({ messageId: "public" });
    const slot = await makeSlot(t.id, 3); // Wednesdays, 8:00 PM Central
    const { run, client, channel } = setup();
    channel.seedMessage("public");
    await syncRaidTeam(client, t.id);
    const before = await raids(t.id);
    await callOut(before[0]!.id, "raider-1");
    const oneOff = await makeRaid(t.id, "2026-10-10T01:00:00Z", { oneOff: true });

    expect(onlyReply(await run("nights", "edit", { night: slot.id, time: "21:00" }))).toBe(
      "✅ Moved Wednesday 8:00 PM to Wednesday 9:00 PM Central Time. Its 12 upcoming raids moved with it, keeping their call-outs. Next: <t:1791424800:F>.",
    );
    expect(await prisma.raidSlot.findUniqueOrThrow({ where: { id: slot.id } })).toMatchObject({ dayOfWeek: 3, hour: 21, minute: 0 });
    const after = await raids(t.id);
    expect(after.find((r) => r.id === before[0]!.id)!.startsAt).toEqual(new Date("2026-10-08T02:00:00Z"));
    expect(await prisma.attendance.findMany({ where: { raidInstanceId: before[0]!.id } })).toHaveLength(1);
    expect(after.find((r) => r.id === oneOff.id)!.startsAt).toEqual(new Date("2026-10-10T01:00:00Z"));

    // The sync finds the moved raids rather than adding new ones.
    await syncRaidTeam(client, t.id);
    expect(await raids(t.id)).toHaveLength(13);
  });

  it("edit removes a raid whose new time has already passed", async () => {
    const t = await makeTeam();
    const slot = await makeSlot(t.id, 2); // Tuesdays, 8:00 PM Central: tonight
    const tonight = await makeRaid(t.id, TUE_8PM);
    await callOut(tonight.id, "raider-1");
    const nextWeek = await makeRaid(t.id, "2026-10-14T01:00:00Z");
    const { run } = setup();

    // 6:00 AM Central was an hour ago.
    expect(onlyReply(await run("nights", "edit", { night: slot.id, time: "06:00" }))).toMatch(
      /^✅ Moved Tuesday 8:00 PM to Tuesday 6:00 AM Central Time\. Its 1 upcoming raid moved with it, keeping their call-outs\. Removed 1 raid whose new time has passed, with 1 call-out\. Next: /,
    );
    const left = await prisma.raidInstance.findMany({ where: { raidTeamId: t.id } });
    expect(left.map((r) => r.id)).not.toContain(tonight.id);
    expect(left.find((r) => r.id === nextWeek.id)!.startsAt).toEqual(new Date("2026-10-13T11:00:00Z"));
  });

  it("edit needs a valid, different time that isn't already a night", async () => {
    const t = await makeTeam();
    const slot = await makeSlot(t.id, 3);
    await makeSlot(t.id, 3, 21);
    const { run } = setup();
    const edit = async (time: string) => onlyReply(await run("nights", "edit", { night: slot.id, time }));
    expect(await edit("25:00")).toBe('"25:00" isn\'t a valid 24-hour time. Use `HH:MM`, e.g. `20:00`.');
    expect(await edit("20:00")).toBe("Wednesday 8:00 PM is already this night's time.");
    expect(await edit("21:00")).toBe(
      "Wednesday 9:00 PM is already a weekly raid night. Remove this one with `/raidlead nights remove` instead.",
    );
    expect(await prisma.raidSlot.findUniqueOrThrow({ where: { id: slot.id } })).toMatchObject({ dayOfWeek: 3, hour: 20 });
  });

  it("remove only finds the picked team's nights", async () => {
    const main = await makeTeam();
    const other = await makeTeam({ roleId: "role-other" });
    const slot = await makeSlot(other.id, 3);
    const { run } = setup();
    expect(onlyReply(await run("nights", "remove", { team: main.id, night: slot.id }))).toBe(
      "Couldn't find that raid night. Pick one from the suggestions.",
    );
    expect(await prisma.raidSlot.count()).toBe(1);
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

  it("posts in the channel it's run in when no channel is picked", async () => {
    const here = fakeChannel("channel-here");
    const { run } = setup([here]);
    expect(onlyReply(await run("team", "setup", { role: ROLE_ID, timezone: TZ }, { channel: here }))).toMatch(/posting its schedule in <#channel-here>\./);
    expect(here.sent).toHaveLength(1);
    expect(onlyReply(await run("team", "setup", { role: "role-x", timezone: TZ }, { channel: null }))).toBe(
      "Pick a `channel:` for the schedule, or run this in one.",
    );
  });

  it("rejects an unknown timezone and a role that's already a team", async () => {
    const { run } = setup();
    expect(onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: "Mars/Olympus" }))).toBe(
      '"Mars/Olympus" isn\'t a recognized timezone. Pick one from the suggestions as you type.',
    );
    expect(await prisma.raidTeam.count()).toBe(0);

    await makeTeam();
    expect(onlyReply(await run("team", "setup", { role: ROLE_ID, channel: CHANNEL_ID, timezone: TZ }))).toBe(
      `<@&${ROLE_ID}> is already a raid team. Change its settings with \`/raidlead team settings\`.`,
    );
    expect(await prisma.raidTeam.count()).toBe(1);
  });
});

describe("team settings", () => {
  it("without options shows the team at a glance", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("team", "settings"))).toBe(
      `**Main Raid** · <@&${ROLE_ID}>\n• Schedule: <#${CHANNEL_ID}>\n• Timezone: Central Time (America/Chicago)\n` +
        "• Raid size: 25-player\n• Coming Up raids: 3\n• Final raid date: none\n**Weekly nights**, in team time\n" +
        "• None yet. Add one with `/raidlead nights add`.",
    );
    await makeSlot(t.id, 6, 19, 30);
    await makeSlot(t.id, 2, 20, 0);
    expect(onlyReply(await run("team", "settings"))).toMatch(
      /\n\*\*Weekly nights\*\*, in team time\n• Tuesday 8:00 PM · next <t:1791334800:F>\n• Saturday 7:30 PM · next <t:1791678600:F>$/,
    );
  });

  it("rejects an unknown timezone and changes nothing", async () => {
    const t = await makeTeam();
    const { run } = setup();
    expect(onlyReply(await run("team", "settings", { timezone: "Nowhere/Land", name: "X" }))).toMatch(/isn't a recognized timezone/);
    expect(await team(t.id)).toMatchObject({ timezone: TZ, name: "Main Raid" });
  });

  it("updates name, timezone and coming-up, and re-renders in place", async () => {
    const t = await makeTeam({ messageId: "public" });
    const { run, channel } = setup();
    const existing = channel.seedMessage("public");
    const reply = onlyReply(await run("team", "settings", { name: "Core", timezone: "Europe/Paris", "coming-up": 5 }));
    expect(reply).toMatch(/^✅ Saved\.\n\n\*\*Core\*\* · /);
    expect(reply).toContain("• Timezone: Central European Time (Europe/Paris)\n• Raid size: 25-player\n• Coming Up raids: 5\n");
    expect(await team(t.id)).toMatchObject({ name: "Core", timezone: "Europe/Paris", displayCount: 5, messageId: "public" });
    expect(existing.payloads).toHaveLength(2);
    expect(channel.sent).toHaveLength(0);
  });

  describe("changing the timezone", () => {
    const openRaids = (teamId: string) =>
      prisma.raidInstance.findMany({ where: { raidTeamId: teamId, closed: false }, orderBy: { startsAt: "asc" }, include: { attendance: true } });
    const nights = (teamId: string) => prisma.raidSlot.findMany({ where: { raidTeamId: teamId }, select: { dayOfWeek: true, hour: true, minute: true } });

    it("rewrites the weekly nights so no raid moves or doubles up", async () => {
      const t = await makeTeam({ messageId: "public" });
      await makeSlot(t.id, 2); // Tuesdays, 8:00 PM Central
      const { run, client, channel } = setup();
      channel.seedMessage("public");
      await syncRaidTeam(client, t.id);
      const before = await openRaids(t.id);
      await callOut(before[1]!.id, "raider-1");

      const reply = onlyReply(await run("team", "settings", { timezone: "America/New_York" }));
      expect(reply).toMatch(/^✅ Saved\. The weekly nights are now in Eastern Time, and no raid moved\.\n/);
      expect(reply).toContain("\n• Tuesday 9:00 PM · next <t:1791334800:F>");
      expect(await nights(t.id)).toEqual([{ dayOfWeek: 2, hour: 21, minute: 0 }]);

      await syncRaidTeam(client, t.id);
      const after = await openRaids(t.id);
      expect(after.map((r) => r.startsAt)).toEqual(before.map((r) => r.startsAt));
      expect(after[1]!.attendance.map((a) => a.userId)).toEqual(["raider-1"]);
    });

    it("shifts raids an hour, with their call-outs, where the zones change clocks on different dates", async () => {
      const t = await makeTeam({ messageId: "public" });
      await makeSlot(t.id, 2);
      const { run, client, channel } = setup();
      channel.seedMessage("public");
      await syncRaidTeam(client, t.id);
      // Oct 27: Britain is back on GMT, Chicago is still on daylight time.
      const oct27 = (await openRaids(t.id)).find((r) => r.startsAt.toISOString() === "2026-10-28T01:00:00.000Z")!;
      await callOut(oct27.id, "raider-1");

      onlyReply(await run("team", "settings", { timezone: "Europe/London" }));
      expect(await nights(t.id)).toEqual([{ dayOfWeek: 3, hour: 2, minute: 0 }]);
      await syncRaidTeam(client, t.id);

      const after = await openRaids(t.id);
      expect(after).toHaveLength(12);
      const moved = after.find((r) => r.id === oct27.id)!;
      expect(moved.startsAt.toISOString()).toBe("2026-10-28T02:00:00.000Z");
      expect(moved.attendance.map((a) => a.userId)).toEqual(["raider-1"]);
      expect(after[0]!.startsAt).toEqual(new Date(TUE_8PM));
    });

    it("moves the final raid date when the last raid would land after it", async () => {
      const t = await makeTeam({ messageId: "public", finalRaidDate: "2026-10-13" });
      await makeSlot(t.id, 2, 23); // Tuesdays, 11:00 PM Central: past midnight in Eastern
      const { run, client, channel } = setup();
      channel.seedMessage("public");
      await syncRaidTeam(client, t.id);
      expect(await openRaids(t.id)).toHaveLength(2);

      const reply = onlyReply(await run("team", "settings", { timezone: "America/New_York" }));
      expect(reply).toContain("• Final raid date: Wednesday, Oct 14, 2026");
      expect(reply).toContain("• Wednesday 12:00 AM");
      await syncRaidTeam(client, t.id);
      expect(await openRaids(t.id)).toHaveLength(2);
    });
  });

  it("changes the raid size alone, and re-renders against it", async () => {
    const t = await makeTeam({ messageId: "public" });
    const { run, channel } = setup();
    const existing = channel.seedMessage("public");
    expect(onlyReply(await run("team", "settings", { size: 20 }))).toContain("• Raid size: 20-player");
    expect(await team(t.id)).toMatchObject({ raidSize: 20 });
    expect(existing.payloads).toHaveLength(2);
  });

  it("still saves and replies when re-rendering fails", async () => {
    const t = await makeTeam({ messageId: "public" });
    const { run, channel } = setup();
    channel.seedMessage("public").edit = async () => {
      throw new Error("Missing Access");
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(onlyReply(await run("team", "settings", { name: "Core" }))).toMatch(/^✅ Saved\.\n\n\*\*Core\*\*/);
    expect((await team(t.id)).name).toBe("Core");
    expect(errors).toHaveBeenCalled();
  });

  it("falls back to the role's name for an unnamed team", async () => {
    await makeTeam({ name: null });
    const { run } = setup();
    expect(onlyReply(await run("team", "settings", { "coming-up": 1 }))).toMatch(/^✅ Saved\.\n\n\*\*Main Raid\*\* · /);
  });
});

describe("team post", () => {
  it("posts the schedule in the current channel, replacing the old message", async () => {
    const t = await makeTeam({ messageId: "public" });
    const here = fakeChannel("channel-here");
    const { run, channel } = setup([here]);
    const old = channel.seedMessage("public");
    expect(onlyReply(await run("team", "post", {}, { channel: here }))).toBe("✅ Schedule posted in <#channel-here>.");
    expect(old.deleted).toBe(true);
    expect(here.sent).toHaveLength(1);
    expect(await team(t.id)).toMatchObject({ channelId: "channel-here", messageId: here.sent[0]!.id });
  });

  it("posts in a picked channel instead, even away from one that no longer exists", async () => {
    const t = await makeTeam({ channelId: "deleted-channel", messageId: "lost" });
    const newChannel = fakeChannel("channel-2");
    const { run, channel } = setup([newChannel]);
    expect(onlyReply(await run("team", "post", { channel: "channel-2" }, { channel }))).toBe("✅ Schedule posted in <#channel-2>.");
    expect(newChannel.sent).toHaveLength(1);
    expect(channel.sent).toHaveLength(0);
    expect(await team(t.id)).toMatchObject({ channelId: "channel-2", messageId: newChannel.sent[0]!.id });
  });

  it("posting again in the same channel replaces the message rather than editing it", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    await run("team", "post", {}, { channel });
    await run("team", "post", {}, { channel });
    expect(channel.sent).toHaveLength(2);
    expect(channel.sent[0]!.deleted).toBe(true);
    expect((await team(t.id)).messageId).toBe(channel.sent[1]!.id);
  });

  it("needs a text channel", async () => {
    const t = await makeTeam();
    const voice = Object.assign(fakeChannel("voice"), { isTextBased: () => false });
    const { run } = setup([voice]);
    const needs = "Pick a `channel:`, or run this in a text channel.";
    expect(onlyReply(await run("team", "post", {}, { channel: voice }))).toBe(needs);
    expect(onlyReply(await run("team", "post", {}, { channel: null }))).toBe(needs);
    expect((await team(t.id)).channelId).toBe(CHANNEL_ID);
  });
});

describe("team settings final-raid", () => {
  const day = (r: { startsAt: Date }) => DateTime.fromJSDate(r.startsAt).setZone(TZ).toISODate();
  const finalRaid = (date: string) => ({ "final-raid": date });

  /** A Tuesday 8 PM team with its 12 weekly raids generated: Oct 6 through Dec 22. */
  async function weeklyTeam() {
    const t = await makeTeam();
    await makeSlot(t.id, 2);
    const w = setup();
    await w.run("nights", "add", { day: "2", time: "20:00" });
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

    const reply = onlyReply(await run("team", "settings", finalRaid("2026-10-20")));
    expect(reply).toMatch(
      /^✅ Saved\. 🏁 The final raid date is Tuesday, Oct 20, 2026 \(team time\)\. Removed 9 raids after it, with 2 call-outs\. Past raids and their attendance stay\.\n/,
    );
    expect(reply).toContain("• Final raid date: Tuesday, Oct 20, 2026; no raids are scheduled after it");
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
    onlyReply(await run("team", "settings", finalRaid("10/13")));
    expect(await raids(t.id)).toHaveLength(2);

    // Moving it later lets the sync fill in up to the new date.
    expect(onlyReply(await run("team", "settings", finalRaid("11/3")))).toMatch(
      /^✅ Saved\. 🏁 The final raid date is Tuesday, Nov 3, 2026 \(team time\)\. Past raids and their attendance stay\.\n/,
    );
    expect((await raids(t.id)).map(day).at(-1)).toBe("2026-11-03");
    expect(await raids(t.id)).toHaveLength(5);
  });

  it("rejects dates it can't read or that have passed", async () => {
    const { t, run } = await weeklyTeam();
    for (const date of ["someday", "1/1/2020", "none"]) {
      expect(onlyReply(await run("team", "settings", finalRaid(date)))).toBe(
        `Couldn't read "${date}" as an upcoming date. Pick one from the suggestions, or type it like \`3/15/2027\`.`,
      );
    }
    expect((await team(t.id)).finalRaidDate).toBeNull();
    expect(await raids(t.id)).toHaveLength(12);
  });

  it("today ends the team after today's raid; with none left the schedule says so", async () => {
    const t = await makeTeam();
    const { run, channel } = setup();
    expect(onlyReply(await run("team", "settings", finalRaid("2026-10-06")))).toMatch(/^✅ Saved\. 🏁 The final raid date is Tuesday, Oct 6, 2026/);
    await run("nights", "add", { day: "3", time: "20:00" });
    expect(await raids(t.id)).toHaveLength(0);
    const text = payloadText(channel.sent.at(-1)!.payloads.at(-1) as any);
    expect(text).toContain("## No more raids");
    expect(text).toContain("final raid date has passed");
  });

  it("raid add refuses a raid after the final raid date, but not one on it", async () => {
    const t = await makeTeam({ finalRaidDate: "2026-10-09" });
    const { run } = setup();
    expect(onlyReply(await run("raid", "add", { date: "10/10", time: "00:30" }))).toBe(
      "That's after the team's final raid date, Friday, Oct 9, 2026. Move or clear it with `/raidlead team settings final-raid:`.",
    );
    onlyReply(await run("raid", "add", { date: "10/9", time: "23:30" }));
    expect(await raids(t.id)).toHaveLength(1);
  });

  it("nights add notes the final raid date", async () => {
    await makeTeam({ finalRaidDate: "2026-10-06" });
    const { run } = setup();
    expect(onlyReply(await run("nights", "add", { day: "3", time: "20:00" }))).toBe(
      "✅ Added Wednesday 8:00 PM Central Time (America/Chicago) as a weekly raid night. Next: none before the final raid date." +
        "\n-# Final raid date: Tuesday, Oct 6, 2026. No raids are scheduled after it; clear it with `/raidlead team settings final-raid:`.",
    );
  });

  it("No final raid clears the date and the weekly nights schedule again", async () => {
    const { t, run } = await weeklyTeam();
    expect(onlyReply(await run("team", "settings", finalRaid("clear")))).toMatch(/^✅ Saved\. There was no final raid date to clear\.\n/);
    await run("team", "settings", finalRaid("2026-10-06"));
    expect(await raids(t.id)).toHaveLength(1);

    expect(onlyReply(await run("team", "settings", finalRaid("clear")))).toMatch(
      /^✅ Saved\. Cleared the final raid date, so the weekly nights schedule raids again; call-outs on removed raids don't come back\.\n/,
    );
    expect((await team(t.id)).finalRaidDate).toBeNull();
    expect(await raids(t.id)).toHaveLength(12);
  });
});
