import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import * as callout from "../../src/commands/callout.js";
import * as raidlead from "../../src/commands/raidlead/index.js";
import * as roster from "../../src/commands/roster.js";
import * as schedule from "../../src/commands/schedule.js";
import { ROLE_ID, callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { fakeAutocomplete, fakeChatInput, fakeRole, flattenComponents, payloadText, raider, teamRole } from "../discord.js";
import { isEphemeral, onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock();

const TUE_8PM = "2026-10-07T01:00:00Z"; // Tue Oct 6, 8:00 PM in Chicago
const TUE_LABEL = "Tue, Oct 6 · 8:00 PM";

const altRole = fakeRole("Alt Raid", "role-alt");

/** Alice raids on Main; Bob on Main and Alt; Carol on no team. Alt has no display name. */
async function twoTeams() {
  const main = await makeTeam();
  const alt = await makeTeam({ roleId: altRole.id, name: null });
  const alice = raider("Alice", ["Warriors", "Tanks"], "u-alice");
  const bob = raider("Bob", ["Mages"], "u-bob");
  bob.roles.cache.set(altRole.id, altRole as never);
  const carol = raider("Carol", [], "u-carol");
  carol.roles.cache.delete(ROLE_ID);
  const w = world({ members: [alice, bob, carol], roles: [teamRole, altRole], ownerId: "u-owner" });
  return { main, alt, ...w };
}

describe("/callout", () => {
  it("toggles your own call-out for the picked raid", async () => {
    const { main, guild, client, channel } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    const run = fakeChatInput({ commandName: "callout", guild, userId: "u-alice", options: { date: raid.id } });
    await callout.execute(run, client);
    expect(onlyReply(run)).toBe(`❌ Marked you as called out for ${TUE_LABEL}.`);
    expect(await prisma.attendance.count({ where: { userId: "u-alice" } })).toBe(1);
    expect(channel.sent).toHaveLength(1);
  });

  it("autocompletes your own raids with toggle labels", async () => {
    const { main, guild } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    const ac = fakeAutocomplete({ commandName: "callout", guild, userId: "u-alice", focused: "date" });
    await callout.autocomplete(ac);
    expect(ac.responses).toEqual([[{ name: `✅ ${TUE_LABEL} — Decline`, value: raid.id }]]);
  });

  it("replies when used outside a server", async () => {
    const { client } = world();
    const run = fakeChatInput({ commandName: "callout", guild: null, userId: "u-alice", options: { date: "x" } });
    await callout.execute(run, client);
    expect(run.replies).toEqual([{ content: "This command only works in a server.", flags: MessageFlags.Ephemeral }]);
  });
});

describe("/schedule", () => {
  it("privately shows your team's personal schedule", async () => {
    const { main, guild, client } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    const run = fakeChatInput({ commandName: "schedule", guild, userId: "u-alice" });
    await schedule.execute(run, client);
    const reply = run.replies[0];
    expect(isEphemeral(reply)).toBe(true);
    expect(reply.flags).toContain(MessageFlags.IsComponentsV2);
    expect(payloadText(reply)).toContain("## Main Raid — schedule");
    expect(flattenComponents(reply).find((c) => c.custom_id === `attendance:cal:${main.id}:0`).options[0].value).toBe(raid.id);
  });

  it("uses the team option to pick between your teams, and refuses teams you can't view", async () => {
    const { alt, guild, client } = await twoTeams();
    const bobAlt = fakeChatInput({ commandName: "schedule", guild, userId: "u-bob", options: { team: alt.id } });
    await schedule.execute(bobAlt, client);
    expect(payloadText(bobAlt.replies[0])).toContain("## Raid — schedule"); // unnamed team

    const aliceAlt = fakeChatInput({ commandName: "schedule", guild, userId: "u-alice", options: { team: alt.id } });
    await schedule.execute(aliceAlt, client);
    expect(onlyReply(aliceAlt)).toBe("Couldn't find that team. Pick one from the suggestions.");

    const officer = fakeChatInput({ commandName: "schedule", guild, userId: "u-carol", officer: true, options: { team: alt.id } });
    await schedule.execute(officer, client);
    expect(payloadText(officer.replies[0])).toContain("## Raid — schedule");
  });

  it("tells raiders without a team, and refuses outside a server", async () => {
    const { guild, client } = await twoTeams();
    const carol = fakeChatInput({ commandName: "schedule", guild, userId: "u-carol" });
    await schedule.execute(carol, client);
    expect(onlyReply(carol)).toBe("You're not on any raid team.");

    const dm = fakeChatInput({ commandName: "schedule", guild: null });
    await schedule.execute(dm, client);
    expect(onlyReply(dm)).toBe("This command only works in a server.");
  });

  it("autocompletes the teams you can view, by display name", async () => {
    const { main, alt, guild } = await twoTeams();
    const bob = fakeAutocomplete({ commandName: "schedule", guild, userId: "u-bob", focused: "team" });
    await schedule.autocomplete(bob);
    expect(bob.responses[0]).toEqual(
      expect.arrayContaining([
        { name: "Main Raid", value: main.id },
        { name: "Alt Raid", value: alt.id },
      ]),
    );
    expect(bob.responses[0]).toHaveLength(2);

    const carol = fakeAutocomplete({ commandName: "schedule", guild, userId: "u-carol", focused: "team" });
    await schedule.autocomplete(carol);
    expect(carol.responses).toEqual([[{ name: "You're not on any raid team", value: "none" }]]);

    const dm = fakeAutocomplete({ commandName: "schedule", guild: null, focused: "team" });
    await schedule.autocomplete(dm);
    expect(dm.responses).toHaveLength(0);
  });
});

describe("/roster", () => {
  it("without a date, privately shows one roster embed per team you can view", async () => {
    const { guild, client } = await twoTeams();
    const bob = fakeChatInput({ commandName: "roster", guild, userId: "u-bob" });
    await roster.execute(bob, client);
    const reply = bob.replies[0];
    expect(isEphemeral(reply)).toBe(true);
    expect(reply.embeds.map((e: any) => e.data.title).sort()).toEqual(["Alt Raid — roster (1)", "Main Raid — roster (2)"]);

    const alice = fakeChatInput({ commandName: "roster", guild, userId: "u-alice" });
    await roster.execute(alice, client);
    expect(alice.replies[0].embeds.map((e: any) => e.data.title)).toEqual(["Main Raid — roster (2)"]);
  });

  it("caps the reply at 10 embeds", async () => {
    const roles = Array.from({ length: 12 }, (_, i) => fakeRole(`Team ${i}`, `role-t${i}`));
    for (const r of roles) await makeTeam({ roleId: r.id, name: r.name });
    const { guild, client } = world({ roles });
    const run = fakeChatInput({ commandName: "roster", guild, userId: "u-officer", officer: true });
    await roster.execute(run, client);
    expect(run.replies[0].embeds).toHaveLength(10);
  });

  it("with a date, shows that raid's card without a Status button", async () => {
    const { main, guild, client } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    await callOut(raid.id, "u-bob");
    const run = fakeChatInput({ commandName: "roster", guild, userId: "u-alice", options: { date: raid.id } });
    await roster.execute(run, client);
    const reply = run.replies[0];
    expect(isEphemeral(reply)).toBe(true);
    const text = payloadText(reply);
    expect(text).toContain("MAIN RAID · ROSTER");
    expect(text).toContain("**1/2 ready**");
    expect(text).toContain("CALLED OUT · 1");
    expect(flattenComponents(reply).some((c) => c.custom_id?.startsWith("attendance:btn:"))).toBe(false);
  });

  it("refuses a raid from a team you can't view, or one that doesn't exist", async () => {
    const { alt, guild, client } = await twoTeams();
    const altRaid = await makeRaid(alt.id, TUE_8PM);
    for (const date of [altRaid.id, "nope"]) {
      const run = fakeChatInput({ commandName: "roster", guild, userId: "u-alice", options: { date } });
      await roster.execute(run, client);
      expect(onlyReply(run)).toBe("Couldn't find that raid. Pick one from the suggestions as you type.");
    }
  });

  it("tells raiders without a team, and refuses outside a server", async () => {
    const { guild, client } = await twoTeams();
    const carol = fakeChatInput({ commandName: "roster", guild, userId: "u-carol" });
    await roster.execute(carol, client);
    expect(onlyReply(carol)).toBe("You're not on any raid team.");
    const dm = fakeChatInput({ commandName: "roster", guild: null });
    await roster.execute(dm, client);
    expect(onlyReply(dm)).toBe("This command only works in a server.");
  });

  it("autocompletes upcoming raids, cancelled included, with current-roster attendance", async () => {
    const { main, guild } = await twoTeams();
    await makeRaid(main.id, "2026-09-30T01:00:00Z", { closed: true });
    const raid = await makeRaid(main.id, TUE_8PM);
    const cancelled = await makeRaid(main.id, "2026-10-08T01:00:00Z", { cancelled: true });
    await callOut(raid.id, "u-bob");
    await callOut(raid.id, "u-left"); // no longer on the roster: not counted
    const ac = fakeAutocomplete({ commandName: "roster", guild, userId: "u-alice", focused: "date" });
    await roster.autocomplete(ac);
    expect(ac.responses).toEqual([
      [
        { name: `${TUE_LABEL} · 1/2`, value: raid.id },
        { name: "Wed, Oct 7 · 8:00 PM · cancelled", value: cancelled.id },
      ],
    ]);
  });

  it("autocomplete names the team when you can view several, and handles no team or no raids", async () => {
    const { main, alt, guild } = await twoTeams();
    const a = await makeRaid(alt.id, TUE_8PM);
    const m = await makeRaid(main.id, "2026-10-08T01:00:00Z");
    const bob = fakeAutocomplete({ commandName: "roster", guild, userId: "u-bob", focused: "date" });
    await roster.autocomplete(bob);
    expect(bob.responses[0]).toEqual([
      { name: `${TUE_LABEL} · 1/1 · Alt Raid`, value: a.id },
      { name: "Wed, Oct 7 · 8:00 PM · 2/2 · Main Raid", value: m.id },
    ]);

    const carol = fakeAutocomplete({ commandName: "roster", guild, userId: "u-carol", focused: "date" });
    await roster.autocomplete(carol);
    expect(carol.responses).toEqual([[{ name: "You're not on any raid team", value: "none" }]]);

    await prisma.raidInstance.deleteMany();
    const empty = fakeAutocomplete({ commandName: "roster", guild, userId: "u-alice", focused: "date" });
    await roster.autocomplete(empty);
    expect(empty.responses).toEqual([[{ name: "No upcoming raids", value: "none" }]]);

    const dm = fakeAutocomplete({ commandName: "roster", guild: null, focused: "date" });
    await roster.autocomplete(dm);
    expect(dm.responses).toHaveLength(0);
  });
});

describe("/raidlead execute", () => {
  it("refuses non-officers and DMs", async () => {
    const { guild, client } = await twoTeams();
    const raiderRun = fakeChatInput({ commandName: "raidlead", group: "nights", subcommand: "list", guild, userId: "u-alice", options: { role: ROLE_ID } });
    await raidlead.execute(raiderRun, client);
    expect(onlyReply(raiderRun)).toBe("Only officers can use /raidlead.");

    const dm = fakeChatInput({ commandName: "raidlead", group: "nights", subcommand: "list", guild: null, officer: true });
    await raidlead.execute(dm, client);
    expect(onlyReply(dm)).toBe("This command only works in a server.");
  });

  it('routes by "group sub" key, for officers and the server owner', async () => {
    const { main, guild, client } = await twoTeams();
    await makeSlot(main.id, 3);
    const officer = fakeChatInput({ commandName: "raidlead", group: "nights", subcommand: "list", guild, officer: true, options: { role: ROLE_ID } });
    await raidlead.execute(officer, client);
    expect(onlyReply(officer)).toBe("• Wednesday 8:00 PM\n(America/Chicago)");

    const owner = fakeChatInput({ commandName: "raidlead", group: "team", subcommand: "delete", guild, userId: "u-owner", options: { role: ROLE_ID } });
    await raidlead.execute(owner, client);
    expect(owner.replies[0].content).toMatch(/^Delete \*\*Main Raid\*\*\?/);
    expect(owner.replies[0].components[0].toJSON().components.map((b: any) => b.custom_id)).toEqual([
      `teamdelete:confirm:${main.id}`,
      `teamdelete:abort:${main.id}`,
    ]);
  });

  it("routes top-level callout/attend to set someone else's attendance", async () => {
    const { main, guild, client } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    const out = fakeChatInput({ commandName: "raidlead", subcommand: "callout", guild, userId: "u-officer", officer: true, options: { user: "u-bob", date: raid.id } });
    await raidlead.execute(out, client);
    expect(onlyReply(out)).toBe(`❌ Marked <@u-bob> as called out for ${TUE_LABEL}.`);
    expect(await prisma.attendance.count({ where: { userId: "u-bob" } })).toBe(1);

    const back = fakeChatInput({ commandName: "raidlead", subcommand: "attend", guild, userId: "u-officer", officer: true, options: { user: "u-bob", date: raid.id } });
    await raidlead.execute(back, client);
    expect(onlyReply(back)).toBe(`✅ Marked <@u-bob> as attending ${TUE_LABEL}.`);
    expect(await prisma.attendance.count()).toBe(0);
  });

  it("ignores an unknown subcommand", async () => {
    const { guild, client } = await twoTeams();
    const run = fakeChatInput({ commandName: "raidlead", group: "nights", subcommand: "explode", guild, officer: true });
    await raidlead.execute(run, client);
    expect(run.replies).toHaveLength(0);
  });
});

describe("/raidlead autocomplete", () => {
  async function respond(opts: { group?: string; subcommand: string; focused: string; options?: Record<string, unknown>; officer?: boolean; guildless?: boolean }) {
    const w = await twoTeams();
    const ac = fakeAutocomplete({
      commandName: "raidlead",
      guild: opts.guildless ? null : w.guild,
      userId: "u-officer",
      officer: opts.officer ?? true,
      group: opts.group,
      subcommand: opts.subcommand,
      focused: opts.focused,
      options: opts.options ?? {},
    });
    await raidlead.autocomplete(ac);
    return { ...w, responses: ac.responses };
  }

  it("responds with nothing to non-officers and in DMs", async () => {
    expect((await respond({ group: "raid", subcommand: "cancel", focused: "date", options: { role: ROLE_ID }, officer: false })).responses).toEqual([[]]);
    await prisma.raidTeam.deleteMany();
    expect((await respond({ group: "raid", subcommand: "cancel", focused: "date", guildless: true })).responses).toEqual([[]]);
  });

  it("lists timezones, common ones first, filtered by what's typed", async () => {
    const all = (await respond({ group: "team", subcommand: "setup", focused: "timezone", options: { timezone: "" } })).responses[0]!;
    expect(all).toHaveLength(25);
    expect(all[0]).toEqual({ name: "America/New York", value: "America/New_York" });
    await prisma.raidTeam.deleteMany();
    const typed = (await respond({ group: "team", subcommand: "edit", focused: "timezone", options: { timezone: "helsinki" } })).responses[0]!;
    expect(typed).toEqual([{ name: "Europe/Helsinki", value: "Europe/Helsinki" }]);
  });

  it("callout lists the picked user's raids; attend lists only their call-outs", async () => {
    const w = await twoTeams();
    const r1 = await makeRaid(w.main.id, TUE_8PM);
    const r2 = await makeRaid(w.main.id, "2026-10-08T01:00:00Z");
    await callOut(r2.id, "u-bob");
    const ask = async (subcommand: string, user?: string) => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, subcommand, focused: "date", options: user ? { user } : {} });
      await raidlead.autocomplete(ac);
      return ac.responses[0];
    };
    // Bob is on two teams, so labels carry the team name.
    expect(await ask("callout", "u-bob")).toEqual([
      { name: `✅ ${TUE_LABEL} · Main Raid`, value: r1.id },
      { name: "❌ Wed, Oct 7 · 8:00 PM · Main Raid", value: r2.id },
    ]);
    expect(await ask("attend", "u-bob")).toEqual([{ name: "Wed, Oct 7 · 8:00 PM · Main Raid", value: r2.id }]);
    expect(await ask("callout", "u-alice")).toEqual([
      { name: `✅ ${TUE_LABEL}`, value: r1.id },
      { name: "✅ Wed, Oct 7 · 8:00 PM", value: r2.id },
    ]);
    expect(await ask("callout")).toEqual([{ name: "Pick a raider first", value: "none" }]);
  });

  it("asks for the role first when it's missing or not a team", async () => {
    const none = await respond({ group: "raid", subcommand: "cancel", focused: "date" });
    expect(none.responses).toEqual([[{ name: "Pick a raid team role first", value: "none" }]]);
    await prisma.raidTeam.deleteMany();
    const notTeam = await respond({ group: "raid", subcommand: "cancel", focused: "date", options: { role: "role-random" } });
    expect(notTeam.responses).toEqual([[{ name: "Pick a raid team role first", value: "none" }]]);
  });

  it("lists nights for nights remove", async () => {
    const w = await twoTeams();
    const slot = await makeSlot(w.main.id, 5, 21, 15);
    const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "nights", subcommand: "remove", focused: "night", options: { role: ROLE_ID } });
    await raidlead.autocomplete(ac);
    expect(ac.responses).toEqual([[{ name: "Friday 9:15 PM", value: slot.id }]]);

    await prisma.raidSlot.deleteMany();
    const empty = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "nights", subcommand: "remove", focused: "night", options: { role: ROLE_ID } });
    await raidlead.autocomplete(empty);
    expect(empty.responses).toEqual([[{ name: "No weekly raid nights yet", value: "none" }]]);
  });

  it("lists the right raids for raid cancel, restore and remove", async () => {
    const w = await twoTeams();
    const open = await makeRaid(w.main.id, TUE_8PM);
    const cancelled = await makeRaid(w.main.id, "2026-10-08T01:00:00Z", { cancelled: true });
    const oneOff = await makeRaid(w.main.id, "2026-10-09T01:00:00Z", { oneOff: true });
    const ask = async (subcommand: string) => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "raid", subcommand, focused: "date", options: { role: ROLE_ID } });
      await raidlead.autocomplete(ac);
      return ac.responses[0]!.map((c) => c.value);
    };
    expect(await ask("cancel")).toEqual([open.id, oneOff.id]);
    expect(await ask("restore")).toEqual([cancelled.id]);
    expect(await ask("remove")).toEqual([oneOff.id]);

    await prisma.raidInstance.deleteMany();
    const names = async (subcommand: string) => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "raid", subcommand, focused: "date", options: { role: ROLE_ID } });
      await raidlead.autocomplete(ac);
      return ac.responses[0]!.map((c) => c.name);
    };
    expect(await names("cancel")).toEqual(["No upcoming raids to cancel"]);
    expect(await names("restore")).toEqual(["No cancelled raids to restore"]);
    expect(await names("remove")).toEqual(["No upcoming one-off raids"]);
  });

  it("raid add offers a typed date as-is, else upcoming dates in the team's timezone", async () => {
    const w = await twoTeams();
    const ask = async (date: string) => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "raid", subcommand: "add", focused: "date", options: { role: ROLE_ID, date } });
      await raidlead.autocomplete(ac);
      return ac.responses[0]!;
    };
    expect(await ask("3/15/2027")).toEqual([{ name: "Monday, Mar 15, 2027", value: "2027-03-15" }]);
    const upcoming = await ask("");
    expect(upcoming).toHaveLength(25);
    expect(upcoming[0]).toEqual({ name: "Tuesday, Oct 6, 2026", value: "2026-10-06" });
    // Unreadable text falls back to the list rather than a dead end.
    expect((await ask("zzz"))[0]).toEqual({ name: "Tuesday, Oct 6, 2026", value: "2026-10-06" });
    expect(await ask("Friday")).toEqual(expect.arrayContaining([{ name: "Friday, Oct 9, 2026", value: "2026-10-09" }]));
  });

});
