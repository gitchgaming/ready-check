import { describe, expect, it } from "vitest";
import { MessageFlags } from "discord.js";
import * as attendance from "../../src/commands/attendance.js";
import * as howitworks from "../../src/commands/howitworks.js";
import * as raidlead from "../../src/commands/raidlead/index.js";
import * as roster from "../../src/commands/roster.js";
import * as schedule from "../../src/commands/schedule.js";
import { ROLE_ID, callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { setUserTimezone } from "../../src/lib/userSettings.js";
import { routeInteraction } from "../../src/interactions/router.js";
import { fakeAutocomplete, fakeButton, fakeChatInput, fakeRole, flattenComponents, payloadText, raider, teamRole } from "../discord.js";
import { isEphemeral, onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock();

const TUE_8PM = "2026-10-07T01:00:00Z"; // Tue Oct 6, 8:00 PM in Chicago
const TUE_LABEL = "Tue, Oct 6 · 8:00 PM CDT"; // pickers: team time, with its zone
const TUE_TIME = "<t:1791334800:F>"; // replies: a timestamp each viewer sees in their own zone
const TUE_SHORT = "<t:1791334800:s>"; // the same, short, beside a button

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

describe("/attendance", () => {
  it("with a date, toggles your own call-out and shows your attendance under a confirmation", async () => {
    const { main, guild, client, channel } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    const run = fakeChatInput({ commandName: "attendance", guild, userId: "u-alice", options: { date: raid.id } });
    await attendance.execute(run, client);
    expect(isEphemeral(run.replies[0])).toBe(true);
    const text = payloadText(run.replies[0] as any);
    expect(text).toContain(`❌ You're out for **${TUE_SHORT}**.`);
    expect(text).toContain("You're out of the next raid");
    expect(flattenComponents(run.replies[0] as any).filter((c) => c.label === "Back in")).toHaveLength(1);
    expect(flattenComponents(run.replies[0] as any).find((c) => c.label === "Undo").custom_id).toBe(
      `attendance:undo:${main.id}:${raid.id}:in:a`,
    );
    expect(await prisma.attendance.count({ where: { userId: "u-alice" } })).toBe(1);
    expect(channel.sent).toHaveLength(1);

    const again = fakeChatInput({ commandName: "attendance", guild, userId: "u-alice", options: { date: raid.id } });
    await attendance.execute(again, client);
    expect(payloadText(again.replies[0] as any)).toContain(`✅ You're back in for **${TUE_SHORT}**.`);
    expect(await prisma.attendance.count({ where: { userId: "u-alice" } })).toBe(0);
  });

  it("without a date, privately shows every team you're on and what you're called out of", async () => {
    const { main, alt, guild, client } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    await makeRaid(alt.id, TUE_8PM);
    await callOut(raid.id, "u-bob");
    const run = fakeChatInput({ commandName: "attendance", guild, userId: "u-bob" });
    await attendance.execute(run, client);
    expect(isEphemeral(run.replies[0])).toBe(true);
    const text = payloadText(run.replies[0] as any);
    expect(text).toContain("MAIN RAID · YOUR ATTENDANCE");
    expect(text).toContain("ALT RAID · YOUR ATTENDANCE");
    expect(text).toContain("✅ You're in for the next raid");
    expect(flattenComponents(run.replies[0] as any).filter((c) => c.label === "Back in").map((c) => c.custom_id)).toEqual([
      `attendance:in:${main.id}:${raid.id}`,
    ]);
  });

  it("without a date, says when you're not on any team", async () => {
    const { guild, client } = await twoTeams();
    const run = fakeChatInput({ commandName: "attendance", guild, userId: "u-carol" });
    await attendance.execute(run, client);
    expect(onlyReply(run)).toBe("You're not on any raid team.");
  });

  it("autocompletes your own raids in the schedule select's words", async () => {
    const { main, guild } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    const ac = fakeAutocomplete({ commandName: "attendance", guild, userId: "u-alice", focused: "date" });
    await attendance.autocomplete(ac);
    expect(ac.responses).toEqual([[{ name: `✅ ${TUE_LABEL} — You're in. Pick to call out`, value: raid.id }]]);
  });

  it("autocompletes dates in your own timezone once you've set one", async () => {
    const { main, guild } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    await setUserTimezone("u-alice", "Europe/Berlin");
    const ac = fakeAutocomplete({ commandName: "attendance", guild, userId: "u-alice", focused: "date" });
    await attendance.autocomplete(ac);
    expect(ac.responses).toEqual([[{ name: "✅ Wed, Oct 7 · 3:00 AM GMT+2 — You're in. Pick to call out", value: raid.id }]]);
  });

  it("with team:, shows only that team, and its buttons redraw it narrowed", async () => {
    const { main, alt, guild, client } = await twoTeams();
    const mainRaid = await makeRaid(main.id, TUE_8PM);
    const altRaid = await makeRaid(alt.id, TUE_8PM);
    await callOut(mainRaid.id, "u-bob");
    await callOut(altRaid.id, "u-bob");
    const run = fakeChatInput({ commandName: "attendance", guild, userId: "u-bob", options: { team: alt.id } });
    await attendance.execute(run, client);
    const text = payloadText(run.replies[0] as any);
    expect(text).toContain("ALT RAID · YOUR ATTENDANCE");
    expect(text).not.toContain("MAIN RAID");
    expect(flattenComponents(run.replies[0] as any).filter((c) => c.label === "Back in").map((c) => c.custom_id)).toEqual([
      `attendance:in:${alt.id}:${altRaid.id}:t`,
    ]);
  });

  it("with team: and a date, toggles and shows only that raid's team, with an Undo that keeps it narrowed", async () => {
    const { main, alt, guild, client } = await twoTeams();
    const raid = await makeRaid(alt.id, TUE_8PM);
    await makeRaid(main.id, TUE_8PM);
    const run = fakeChatInput({ commandName: "attendance", guild, userId: "u-bob", options: { date: raid.id, team: alt.id } });
    await attendance.execute(run, client);
    expect(payloadText(run.replies[0] as any)).not.toContain("MAIN RAID");
    expect(flattenComponents(run.replies[0] as any).find((c) => c.label === "Undo").custom_id).toBe(
      `attendance:undo:${alt.id}:${raid.id}:in:t`,
    );
  });

  it("with team:, refuses a team you're not on", async () => {
    const { alt, guild, client } = await twoTeams();
    const run = fakeChatInput({ commandName: "attendance", guild, userId: "u-alice", options: { team: alt.id } });
    await attendance.execute(run, client);
    expect(onlyReply(run)).toBe("You're not on that team. Pick one from the suggestions.");
  });

  it("autocompletes team: with your own teams, and narrows the date picker to it", async () => {
    const { main, alt, guild } = await twoTeams();
    await makeRaid(main.id, TUE_8PM);
    const altRaid = await makeRaid(alt.id, TUE_8PM);
    const teams = fakeAutocomplete({ commandName: "attendance", guild, userId: "u-bob", focused: "team" });
    await attendance.autocomplete(teams);
    expect(teams.responses[0]!.map((c) => c.value).sort()).toEqual([main.id, alt.id].sort());

    const dates = fakeAutocomplete({ commandName: "attendance", guild, userId: "u-bob", focused: "date", options: { team: alt.id } });
    await attendance.autocomplete(dates);
    expect(dates.responses).toEqual([[{ name: `✅ ${TUE_LABEL} — You're in. Pick to call out`, value: altRaid.id }]]);
  });

  it("replies when used outside a server", async () => {
    const { client } = world();
    const run = fakeChatInput({ commandName: "attendance", guild: null, userId: "u-alice", options: { date: "x" } });
    await attendance.execute(run, client);
    expect(run.replies).toEqual([{ content: "This command only works in a server.", flags: MessageFlags.Ephemeral }]);
  });
});

describe("/howitworks", () => {
  it("privately shows the same guide as Next Up's How it works select, listing every raider command", async () => {
    const { guild, client } = await twoTeams();
    const run = fakeChatInput({ commandName: "howitworks", guild, userId: "u-alice" });
    await howitworks.execute(run, client);
    const reply = run.replies[0];
    expect(isEphemeral(reply)).toBe(true);
    expect(reply.flags).toContain(MessageFlags.IsComponentsV2);
    const text = payloadText(reply);
    expect(text).toContain("**READY CHECK · HOW IT WORKS**");
    for (const cmd of ["/attendance", "/schedule", "/roster", "/timezone", "/howitworks"]) expect(text).toContain(`\`${cmd}\``);
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
    expect(payloadText(reply)).toContain("**MAIN RAID · YOUR SCHEDULE**");
    expect(flattenComponents(reply).find((c) => c.custom_id === `attendance:cal:${main.id}:0`).options[0].value).toBe(raid.id);
  });

  it("uses the team option to pick between your teams, and refuses teams you can't view", async () => {
    const { alt, guild, client } = await twoTeams();
    const bobAlt = fakeChatInput({ commandName: "schedule", guild, userId: "u-bob", options: { team: alt.id } });
    await schedule.execute(bobAlt, client);
    expect(payloadText(bobAlt.replies[0])).toContain("**ALT RAID · YOUR SCHEDULE**"); // unnamed team: the role name

    const aliceAlt = fakeChatInput({ commandName: "schedule", guild, userId: "u-alice", options: { team: alt.id } });
    await schedule.execute(aliceAlt, client);
    expect(onlyReply(aliceAlt)).toBe("Couldn't find that team. Pick one from the suggestions.");

    const officer = fakeChatInput({ commandName: "schedule", guild, userId: "u-carol", officer: true, options: { team: alt.id } });
    await schedule.execute(officer, client);
    expect(payloadText(officer.replies[0])).toContain("**ALT RAID · YOUR SCHEDULE**");
  });

  it("opens an officer's own team by default", async () => {
    await makeTeam();
    await makeTeam({ roleId: altRole.id, name: null });
    const dave = raider("Dave", [], "u-dave");
    dave.roles.cache.delete(ROLE_ID);
    dave.roles.cache.set(altRole.id, altRole as never);
    const { guild, client } = world({ members: [dave], roles: [teamRole, altRole], ownerId: "u-owner" });
    const run = fakeChatInput({ commandName: "schedule", guild, userId: "u-dave", officer: true });
    await schedule.execute(run, client);
    expect(payloadText(run.replies[0])).toContain("**ALT RAID · YOUR SCHEDULE**");
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
  it("without a date, privately shows your team's whole roster card", async () => {
    const { guild, client } = await twoTeams();
    const alice = fakeChatInput({ commandName: "roster", guild, userId: "u-alice" });
    await roster.execute(alice, client);
    const reply = alice.replies[0];
    expect(isEphemeral(reply)).toBe(true);
    const text = payloadText(reply);
    expect(text).toContain("MAIN RAID · ROSTER");
    expect(text).toContain("## 2 raiders");
    expect(text).toContain("TANKS · 1");
    expect(text).toContain("DAMAGE · 1");
    expect(flattenComponents(reply).some((c) => c.custom_id)).toBe(false);
  });

  it("without a date, shows the picked team, or says it can't find one you can't view", async () => {
    const { alt, guild, client } = await twoTeams();
    const bob = fakeChatInput({ commandName: "roster", guild, userId: "u-bob", options: { team: alt.id } });
    await roster.execute(bob, client);
    expect(payloadText(bob.replies[0])).toContain(`${altRole.name.toUpperCase()} · ROSTER`);

    const alice = fakeChatInput({ commandName: "roster", guild, userId: "u-alice", options: { team: alt.id } });
    await roster.execute(alice, client);
    expect(onlyReply(alice)).toBe("Couldn't find that team. Pick one from the suggestions.");
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
    expect(text).toContain("**1/25 ready**");
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

  it("autocompletes upcoming raids, not cancelled ones, with current-roster attendance", async () => {
    const { main, guild } = await twoTeams();
    await makeRaid(main.id, "2026-09-30T01:00:00Z", { closed: true });
    const raid = await makeRaid(main.id, TUE_8PM);
    await makeRaid(main.id, "2026-10-08T01:00:00Z", { cancelled: true });
    await callOut(raid.id, "u-bob");
    await callOut(raid.id, "u-left"); // no longer on the roster: not counted
    const ac = fakeAutocomplete({ commandName: "roster", guild, userId: "u-alice", focused: "date" });
    await roster.autocomplete(ac);
    expect(ac.responses).toEqual([[{ name: `${TUE_LABEL} · 1/2`, value: raid.id }]]);

    await setUserTimezone("u-alice", "America/Los_Angeles");
    const own = fakeAutocomplete({ commandName: "roster", guild, userId: "u-alice", focused: "date" });
    await roster.autocomplete(own);
    expect(own.responses).toEqual([[{ name: "Tue, Oct 6 · 6:00 PM PDT · 1/2", value: raid.id }]]);
  });

  it("autocomplete names the team when you can view several, and handles no team or no raids", async () => {
    const { main, alt, guild } = await twoTeams();
    const a = await makeRaid(alt.id, TUE_8PM);
    const m = await makeRaid(main.id, "2026-10-08T01:00:00Z");
    const bob = fakeAutocomplete({ commandName: "roster", guild, userId: "u-bob", focused: "date" });
    await roster.autocomplete(bob);
    expect(bob.responses[0]).toEqual([
      { name: `${TUE_LABEL} · 1/1 · Alt Raid`, value: a.id },
      { name: "Wed, Oct 7 · 8:00 PM CDT · 2/2 · Main Raid", value: m.id },
    ]);

    const altOnly = fakeAutocomplete({
      commandName: "roster",
      guild,
      userId: "u-bob",
      focused: "date",
      options: { team: alt.id },
    });
    await roster.autocomplete(altOnly);
    expect(altOnly.responses[0]).toEqual([{ name: `${TUE_LABEL} · 1/1`, value: a.id }]);

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

  it("autocompletes the teams you can view", async () => {
    const { main, alt, guild } = await twoTeams();
    const bob = fakeAutocomplete({ commandName: "roster", guild, userId: "u-bob", focused: "team" });
    await roster.autocomplete(bob);
    expect(bob.responses[0]).toEqual(
      expect.arrayContaining([
        { name: "Main Raid", value: main.id },
        { name: altRole.name, value: alt.id },
      ]),
    );
    expect(bob.responses[0]).toHaveLength(2);
  });
});

describe("/raidlead execute", () => {
  it("refuses non-officers and DMs", async () => {
    const { guild, client } = await twoTeams();
    const raiderRun = fakeChatInput({ commandName: "raidlead", group: "nights", subcommand: "list", guild, userId: "u-alice", options: { team: "Main Raid" } });
    await raidlead.execute(raiderRun, client);
    expect(onlyReply(raiderRun)).toBe("Only officers can use /raidlead.");

    const dm = fakeChatInput({ commandName: "raidlead", group: "nights", subcommand: "list", guild: null, officer: true });
    await raidlead.execute(dm, client);
    expect(onlyReply(dm)).toBe("This command only works in a server.");
  });

  it('routes by "group sub" key, for officers and the server owner', async () => {
    const { main, guild, client } = await twoTeams();
    await makeSlot(main.id, 3);
    const officer = fakeChatInput({ commandName: "raidlead", group: "team", subcommand: "settings", guild, officer: true, options: { team: "Main Raid" } });
    await raidlead.execute(officer, client);
    expect(onlyReply(officer)).toMatch(/\n• Wednesday 8:00 PM · next <t:1791421200:F>$/);

    const owner = fakeChatInput({ commandName: "raidlead", group: "team", subcommand: "delete", guild, userId: "u-owner", options: { team: "Main Raid" } });
    await raidlead.execute(owner, client);
    expect(owner.replies[0].content).toMatch(/^Delete \*\*Main Raid\*\*\?/);
    expect(owner.replies[0].components[0].toJSON().components.map((b: any) => b.custom_id)).toEqual([
      `teamdelete:confirm:${main.id}`,
      `teamdelete:abort:${main.id}`,
    ]);
  });

  it("routes top-level attendance to toggle someone else's attendance, with an Undo", async () => {
    const { main, guild, client } = await twoTeams();
    const raid = await makeRaid(main.id, TUE_8PM);
    const toggle = async () => {
      const run = fakeChatInput({ commandName: "raidlead", subcommand: "attendance", guild, userId: "u-officer", officer: true, options: { user: "u-bob", date: raid.id } });
      await raidlead.execute(run, client);
      return run;
    };
    const out = await toggle();
    expect(onlyReply(out)).toBe("❌ <@u-bob> is out for **<t:1791334800:s>**.");
    expect(out.replies[0].components[0].toJSON().components[0].custom_id).toBe(`raidlead:att:${raid.id}:u-bob:in`);
    expect(await prisma.attendance.count({ where: { userId: "u-bob" } })).toBe(1);

    expect(onlyReply(await toggle())).toBe("✅ <@u-bob> is back in for **<t:1791334800:s>**.");
    expect(await prisma.attendance.count()).toBe(0);

    // Undo sets the named state, so clicking it twice can't flip it back.
    for (let i = 0; i < 2; i++) {
      const undo = fakeButton(`raidlead:att:${raid.id}:u-bob:out`, { guild, officer: true });
      await routeInteraction(undo, client);
      expect(undo.updates[0].content).toBe("❌ <@u-bob> is out for **<t:1791334800:s>**.");
    }
    expect(await prisma.attendance.count()).toBe(1);
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
    expect((await respond({ group: "raid", subcommand: "cancel", focused: "date", options: { team: "Main Raid" }, officer: false })).responses).toEqual([[]]);
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

  it("attendance lists the picked user's raids with what picking each does", async () => {
    const w = await twoTeams();
    const r1 = await makeRaid(w.main.id, TUE_8PM);
    const r2 = await makeRaid(w.main.id, "2026-10-08T01:00:00Z");
    await callOut(r2.id, "u-bob");
    const ask = async (user?: string) => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, subcommand: "attendance", focused: "date", options: user ? { user } : {} });
      await raidlead.autocomplete(ac);
      return ac.responses[0];
    };
    // Bob is on two teams, so labels carry the team name.
    expect(await ask("u-bob")).toEqual([
      { name: `✅ ${TUE_LABEL} — In. Pick to call out · Main Raid`, value: r1.id },
      { name: "❌ Wed, Oct 7 · 8:00 PM CDT — Called out. Pick to switch back in · Main Raid", value: r2.id },
    ]);
    expect(await ask("u-alice")).toEqual([
      { name: `✅ ${TUE_LABEL} — In. Pick to call out`, value: r1.id },
      { name: "✅ Wed, Oct 7 · 8:00 PM CDT — In. Pick to call out", value: r2.id },
    ]);
    expect(await ask()).toEqual([{ name: "Pick a raider first", value: "none" }]);
  });

  it("asks for the team first when it's missing or unknown", async () => {
    const none = await respond({ group: "raid", subcommand: "cancel", focused: "date" });
    expect(none.responses).toEqual([[{ name: "Pick which team in the team: option.", value: "none" }]]);
    await prisma.raidTeam.deleteMany();
    const unknown = await respond({ group: "raid", subcommand: "cancel", focused: "date", options: { team: "nope" } });
    expect(unknown.responses).toEqual([[{ name: "Couldn't find that team. Pick one from the team: suggestions.", value: "none" }]]);
  });

  it("lists nights for nights remove", async () => {
    const w = await twoTeams();
    const slot = await makeSlot(w.main.id, 5, 21, 15);
    const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "nights", subcommand: "remove", focused: "night", options: { team: "Main Raid" } });
    await raidlead.autocomplete(ac);
    expect(ac.responses).toEqual([[{ name: "Friday 9:15 PM Central Time", value: slot.id }]]);

    // An officer elsewhere also sees the next one in their own timezone.
    await setUserTimezone("user-1", "Europe/Berlin");
    const own = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "nights", subcommand: "remove", focused: "night", options: { team: "Main Raid" } });
    await raidlead.autocomplete(own);
    expect(own.responses).toEqual([[{ name: "Friday 9:15 PM Central Time · Sat 4:15 AM GMT+2 for you", value: slot.id }]]);

    await prisma.raidSlot.deleteMany();
    const empty = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "nights", subcommand: "remove", focused: "night", options: { team: "Main Raid" } });
    await raidlead.autocomplete(empty);
    expect(empty.responses).toEqual([[{ name: "No weekly raid nights yet", value: "none" }]]);
  });

  it("lists every upcoming raid for raid cancel", async () => {
    const w = await twoTeams();
    const open = await makeRaid(w.main.id, TUE_8PM);
    const cancelled = await makeRaid(w.main.id, "2026-10-08T01:00:00Z", { cancelled: true });
    const ask = async () => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "raid", subcommand: "cancel", focused: "date", options: { team: "Main Raid" } });
      await raidlead.autocomplete(ac);
      return ac.responses[0]!;
    };
    expect((await ask()).map((c) => c.value)).toEqual([open.id, cancelled.id]);
    await prisma.raidInstance.deleteMany();
    expect((await ask()).map((c) => c.name)).toEqual(["No upcoming raids"]);
  });

  it("raid add offers a typed date as-is, else upcoming dates in the team's timezone", async () => {
    const w = await twoTeams();
    const ask = async (date: string) => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "raid", subcommand: "add", focused: "date", options: { team: "Main Raid", date } });
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

  it("team settings final-raid offers the days of upcoming raids in team time, else any date, and clearing it", async () => {
    const w = await twoTeams();
    const ask = async (date: string) => {
      const ac = fakeAutocomplete({ commandName: "raidlead", guild: w.guild, officer: true, group: "team", subcommand: "settings", focused: "final-raid", options: { team: "Main Raid", "final-raid": date } });
      await raidlead.autocomplete(ac);
      return ac.responses[0]!;
    };
    // No raids yet: the upcoming days, as for raid add.
    expect((await ask(""))[0]).toEqual({ name: "Tuesday, Oct 6, 2026", value: "2026-10-06" });

    await makeRaid(w.main.id, TUE_8PM); // Tue 8 PM Chicago, Wed in UTC
    await makeRaid(w.main.id, "2026-10-07T02:30:00Z"); // later the same day
    await makeRaid(w.main.id, "2026-10-09T01:00:00Z", { cancelled: true });
    await makeRaid(w.main.id, "2026-09-30T01:00:00Z", { closed: true });
    expect(await ask("")).toEqual([
      { name: "Tuesday, Oct 6, 2026", value: "2026-10-06" },
      { name: "Thursday, Oct 8, 2026", value: "2026-10-08" },
    ]);
    expect(await ask("3/15/2027")).toEqual([{ name: "Monday, Mar 15, 2027", value: "2027-03-15" }]);

    // With a final raid date set, the first choice clears it.
    await prisma.raidTeam.update({ where: { id: w.main.id }, data: { finalRaidDate: "2026-10-20" } });
    expect((await ask(""))[0]).toEqual({ name: "No final raid: keep scheduling the weekly nights", value: "clear" });
  });


});
