import { describe, expect, it } from "vitest";
import { raidDateAutocomplete, setAttendance, type AttendanceChange } from "../../src/lib/attendance.js";
import {
  nightChoices,
  oneOffRaidChoices,
  teamFromRoleOption,
  teamRaidChoices,
  teamsForMember,
  viewableTeams,
} from "../../src/lib/pickers.js";
import { DateTime } from "luxon";
import { ROLE_ID, callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { fakeAutocomplete, fakeChatInput, fakeRole, payloadText, raider, teamRole } from "../discord.js";
import { NOW, onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock();

const now = () => DateTime.fromJSDate(NOW);
// 8:00 PM Chicago on Tue Oct 6, which is already Wed Oct 7 in UTC.
const TUE_8PM = "2026-10-07T01:00:00Z";
const TUE_LABEL = "Tue, Oct 6 · 8:00 PM";

const alice = () => raider("Alice", ["Warriors", "Tanks"], "u-alice");
const bob = () => raider("Bob", ["Mages", "Wizards"], "u-bob");

async function isOut(raidId: string, userId: string) {
  return (await prisma.attendance.count({ where: { raidInstanceId: raidId, userId } })) > 0;
}

describe("setAttendance", () => {
  async function setup() {
    const team = await makeTeam();
    const raid = await makeRaid(team.id, TUE_8PM);
    const w = world({ members: [alice(), bob()] });
    const run = (change: AttendanceChange, subjectId = "u-alice", options: Record<string, unknown> = { date: raid.id }) => {
      const interaction = fakeChatInput({ guild: w.guild, userId: "u-alice", options });
      return setAttendance(interaction, w.client, change, subjectId).then(() => interaction);
    };
    return { team, raid, ...w, run };
  }

  it("TOGGLE calls you out, then back in, in the team's timezone, re-rendering the schedule", async () => {
    const { raid, channel, run } = await setup();

    expect(onlyReply(await run("TOGGLE"))).toBe(`❌ Marked you as called out for ${TUE_LABEL}.`);
    expect(await isOut(raid.id, "u-alice")).toBe(true);
    expect(channel.sent).toHaveLength(1);
    expect(payloadText(channel.sent[0]!.payloads[0] as any)).toContain("**1/2 ready**");

    expect(onlyReply(await run("TOGGLE"))).toBe(`✅ Marked you as attending ${TUE_LABEL}.`);
    expect(await isOut(raid.id, "u-alice")).toBe(false);
    expect(channel.sent[0]!.payloads).toHaveLength(2);
    expect(payloadText(channel.sent[0]!.payloads[1] as any)).toContain("**2/2 ready**");
  });

  it("OUT and IN say 'already' and change nothing when there's nothing to change", async () => {
    const { raid, channel, run } = await setup();
    expect(onlyReply(await run("IN"))).toBe(`You are already attending ${TUE_LABEL}.`);
    await callOut(raid.id, "u-alice");
    expect(onlyReply(await run("OUT"))).toBe(`You are already called out for ${TUE_LABEL}.`);
    expect(await prisma.attendance.count()).toBe(1);
    expect(channel.sent).toHaveLength(0);
  });

  it("OUT and IN set the status explicitly", async () => {
    const { raid, run } = await setup();
    expect(onlyReply(await run("OUT"))).toBe(`❌ Marked you as called out for ${TUE_LABEL}.`);
    expect(await isOut(raid.id, "u-alice")).toBe(true);
    expect(onlyReply(await run("IN"))).toBe(`✅ Marked you as attending ${TUE_LABEL}.`);
    expect(await isOut(raid.id, "u-alice")).toBe(false);
  });

  it("words replies for someone else when acting on their behalf", async () => {
    const { raid, run } = await setup();
    expect(onlyReply(await run("OUT", "u-bob"))).toBe(`❌ Marked <@u-bob> as called out for ${TUE_LABEL}.`);
    expect(await isOut(raid.id, "u-bob")).toBe(true);
    expect(await isOut(raid.id, "u-alice")).toBe(false);
    expect(onlyReply(await run("OUT", "u-bob"))).toBe(`<@u-bob> is already called out for ${TUE_LABEL}.`);
    expect(onlyReply(await run("IN", "u-bob"))).toBe(`✅ Marked <@u-bob> as attending ${TUE_LABEL}.`);
    expect(onlyReply(await run("IN", "u-bob"))).toBe(`<@u-bob> is already attending ${TUE_LABEL}.`);
  });

  it("rejects an unknown raid and a raid from another server's team", async () => {
    const { run, channel } = await setup();
    const foreign = await makeTeam({ guildId: "guild-2" });
    const foreignRaid = await makeRaid(foreign.id, TUE_8PM);
    const notFound = "Couldn't find that raid. Pick one from the suggestions as you type.";
    expect(onlyReply(await run("TOGGLE", "u-alice", { date: "nope" }))).toBe(notFound);
    expect(onlyReply(await run("TOGGLE", "u-alice", { date: foreignRaid.id }))).toBe(notFound);
    expect(await prisma.attendance.count()).toBe(0);
    expect(channel.sent).toHaveLength(0);
  });

  it("rejects closed and cancelled raids", async () => {
    const { team, run } = await setup();
    const closed = await makeRaid(team.id, "2026-09-30T01:00:00Z", { closed: true });
    const cancelled = await makeRaid(team.id, "2026-10-14T01:00:00Z", { cancelled: true });
    expect(onlyReply(await run("TOGGLE", "u-alice", { date: closed.id }))).toBe("That raid has already started or passed.");
    expect(onlyReply(await run("OUT", "u-bob", { date: cancelled.id }))).toBe("That raid has been cancelled.");
    expect(await prisma.attendance.count()).toBe(0);
  });

  it("rejects raiders who aren't on the team's roster", async () => {
    const team = await makeTeam();
    const raid = await makeRaid(team.id, TUE_8PM);
    const outsider = raider("Carol", [], "u-carol");
    outsider.roles.cache.delete(ROLE_ID);
    const w = world({ members: [alice(), outsider] });
    const self = fakeChatInput({ guild: w.guild, userId: "u-carol", options: { date: raid.id } });
    await setAttendance(self, w.client, "TOGGLE", "u-carol");
    expect(onlyReply(self)).toBe(`You're not on <@&${ROLE_ID}>'s roster.`);

    for (const subject of ["u-carol", "u-left-the-server"]) {
      const officer = fakeChatInput({ guild: w.guild, userId: "u-alice", options: { date: raid.id } });
      await setAttendance(officer, w.client, "OUT", subject);
      expect(onlyReply(officer)).toBe(`<@${subject}> isn't on <@&${ROLE_ID}>'s roster.`);
    }
    expect(await prisma.attendance.count()).toBe(0);
  });

  it("does nothing outside a server", async () => {
    const { raid, client } = await setup();
    const dm = fakeChatInput({ guild: null, userId: "u-alice", options: { date: raid.id } });
    await setAttendance(dm, client, "TOGGLE", "u-alice");
    expect(dm.replies).toHaveLength(0);
    expect(await prisma.attendance.count()).toBe(0);
  });
});

describe("raidDateAutocomplete", () => {
  async function choices(
    change: AttendanceChange,
    { subject = "u-alice", members = [alice()], roles = [teamRole], typed = "" } = {},
  ) {
    const { guild } = world({ members, roles });
    const interaction = fakeAutocomplete({ guild, userId: "u-alice", focused: "date", options: { date: typed } });
    await raidDateAutocomplete(interaction, subject, change);
    expect(interaction.responses).toHaveLength(1);
    return interaction.responses[0]!;
  }

  it("TOGGLE marks each raid with your status and what picking it does", async () => {
    const team = await makeTeam();
    const r1 = await makeRaid(team.id, TUE_8PM);
    const r2 = await makeRaid(team.id, "2026-10-08T01:00:00Z");
    await callOut(r2.id, "u-alice");
    await callOut(r1.id, "u-bob"); // someone else's call-out doesn't change yours
    expect(await choices("TOGGLE")).toEqual([
      { name: `✅ ${TUE_LABEL} — Decline`, value: r1.id },
      { name: "❌ Wed, Oct 7 · 8:00 PM — Attend", value: r2.id },
    ]);
  });

  it("OUT marks status without the action suffix", async () => {
    const team = await makeTeam();
    const r1 = await makeRaid(team.id, TUE_8PM);
    await callOut(r1.id, "u-alice");
    expect(await choices("OUT")).toEqual([{ name: `❌ ${TUE_LABEL}`, value: r1.id }]);
  });

  it("IN lists only the subject's call-outs, as plain dates", async () => {
    const team = await makeTeam();
    await makeRaid(team.id, TUE_8PM);
    const r2 = await makeRaid(team.id, "2026-10-08T01:00:00Z");
    await callOut(r2.id, "u-alice");
    expect(await choices("IN")).toEqual([{ name: "Wed, Oct 7 · 8:00 PM", value: r2.id }]);
  });

  it("says when there are no call-outs to undo or no upcoming raids", async () => {
    const team = await makeTeam();
    expect(await choices("IN")).toEqual([{ name: "No call-outs to undo", value: "none" }]);
    expect(await choices("TOGGLE")).toEqual([{ name: "No upcoming raids", value: "none" }]);
    await makeRaid(team.id, TUE_8PM);
    expect(await choices("IN")).toEqual([{ name: "No call-outs to undo", value: "none" }]);
  });

  it("leaves out closed and cancelled raids", async () => {
    const team = await makeTeam();
    await makeRaid(team.id, "2026-09-30T01:00:00Z", { closed: true });
    const cancelled = await makeRaid(team.id, "2026-10-14T01:00:00Z", { cancelled: true });
    await callOut(cancelled.id, "u-alice");
    const open = await makeRaid(team.id, TUE_8PM);
    expect((await choices("TOGGLE")).map((c) => c.value)).toEqual([open.id]);
    expect(await choices("IN")).toEqual([{ name: "No call-outs to undo", value: "none" }]);
  });

  it("asks for a raider first when there's no subject", async () => {
    await makeTeam();
    const { guild } = world({ members: [alice()] });
    const interaction = fakeAutocomplete({ guild, userId: "u-alice", focused: "date" });
    await raidDateAutocomplete(interaction, undefined, "OUT");
    expect(interaction.responses).toEqual([[{ name: "Pick a raider first", value: "none" }]]);
  });

  it("says when the subject isn't on any team, or isn't in the server", async () => {
    await makeTeam();
    const loner = raider("Loner", [], "u-alice");
    loner.roles.cache.delete(ROLE_ID);
    expect(await choices("TOGGLE", { members: [loner] })).toEqual([{ name: "Not on any raid team", value: "none" }]);
    expect(await choices("TOGGLE", { subject: "u-nobody" })).toEqual([{ name: "Not on any raid team", value: "none" }]);
  });

  it("labels raids with their team when the subject is on several, splitting the 25-choice budget", async () => {
    const altRole = fakeRole("Alt Raid", "role-alt");
    const main = await makeTeam();
    const alt = await makeTeam({ roleId: altRole.id, name: null }); // falls back to the role's name
    for (let i = 0; i < 20; i++) await makeRaid(main.id, now().plus({ days: 1, hours: i }));
    for (let i = 0; i < 20; i++) await makeRaid(alt.id, now().plus({ days: 2, hours: i }));
    const member = raider("Alice", [altRole.name], "u-alice");
    member.roles.cache.set(altRole.id, altRole as never);

    const list = await choices("TOGGLE", { members: [member], roles: [teamRole, altRole] });
    expect(list).toHaveLength(24); // 12 per team
    expect(list.filter((c) => c.name.endsWith(" · Main Raid"))).toHaveLength(12);
    expect(list.filter((c) => c.name.endsWith(" · Alt Raid"))).toHaveLength(12);
    // Sorted by date across teams: every Main Raid choice (day 1) precedes Alt Raid (day 2).
    expect(list.findIndex((c) => c.name.endsWith(" · Alt Raid"))).toBe(12);
  });

  it("narrows by the typed text, falling back to everything when nothing matches", async () => {
    const team = await makeTeam();
    const r1 = await makeRaid(team.id, TUE_8PM);
    const r2 = await makeRaid(team.id, "2026-10-08T01:00:00Z");
    expect((await choices("TOGGLE", { typed: "oct 7" })).map((c) => c.value)).toEqual([r2.id]);
    expect((await choices("TOGGLE", { typed: "10/7" })).map((c) => c.value)).toEqual([r1.id, r2.id]);
  });

  it("doesn't respond outside a server", async () => {
    const interaction = fakeAutocomplete({ guild: null, focused: "date" });
    await raidDateAutocomplete(interaction, "u-alice", "TOGGLE");
    expect(interaction.responses).toHaveLength(0);
  });
});

describe("DB-backed pickers", () => {
  it("teamFromRoleOption reads the raw role id during autocomplete", async () => {
    const team = await makeTeam();
    const { guild } = world();
    const pick = (options: Record<string, unknown>, g = guild as typeof guild | null) =>
      teamFromRoleOption(fakeAutocomplete({ guild: g, focused: "date", options }));
    expect((await pick({ role: ROLE_ID }))?.id).toBe(team.id);
    expect(await pick({ role: "role-not-a-team" })).toBeNull();
    expect(await pick({})).toBeNull();
    expect(await pick({ role: ROLE_ID }, null)).toBeNull();
  });

  it("teamRaidChoices lists upcoming raids by cancelled state, soonest first, in the team's timezone", async () => {
    const team = await makeTeam();
    await makeRaid(team.id, "2026-09-30T01:00:00Z", { closed: true });
    await makeRaid(team.id, "2026-09-29T01:00:00Z", { closed: true, cancelled: true });
    const later = await makeRaid(team.id, "2026-10-14T01:00:00Z");
    const first = await makeRaid(team.id, TUE_8PM);
    const cancelled = await makeRaid(team.id, "2026-10-08T01:00:00Z", { cancelled: true });
    expect(await teamRaidChoices(team, false)).toEqual([
      { name: TUE_LABEL, value: first.id },
      { name: "Tue, Oct 13 · 8:00 PM", value: later.id },
    ]);
    expect(await teamRaidChoices(team, true)).toEqual([{ name: "Wed, Oct 7 · 8:00 PM", value: cancelled.id }]);
  });

  it("teamRaidChoices caps at 25", async () => {
    const team = await makeTeam();
    for (let i = 1; i <= 30; i++) await makeRaid(team.id, now().plus({ hours: i }));
    expect(await teamRaidChoices(team, false)).toHaveLength(25);
  });

  it("oneOffRaidChoices lists upcoming one-offs only, marking cancelled ones", async () => {
    const team = await makeTeam();
    await makeRaid(team.id, "2026-10-08T01:00:00Z"); // generated
    await makeRaid(team.id, "2026-09-30T01:00:00Z", { oneOff: true, closed: true });
    const a = await makeRaid(team.id, TUE_8PM, { oneOff: true });
    const b = await makeRaid(team.id, "2026-10-14T01:00:00Z", { oneOff: true, cancelled: true });
    expect(await oneOffRaidChoices(team)).toEqual([
      { name: TUE_LABEL, value: a.id },
      { name: "Tue, Oct 13 · 8:00 PM (cancelled)", value: b.id },
    ]);
  });

  it("nightChoices lists a team's nights by weekday, then time", async () => {
    const team = await makeTeam();
    const other = await makeTeam({ roleId: "role-other" });
    await makeSlot(other.id, 1);
    const sat = await makeSlot(team.id, 6, 19, 30);
    const wedLate = await makeSlot(team.id, 3, 21, 0);
    const wedEarly = await makeSlot(team.id, 3, 9, 5);
    expect(await nightChoices(team)).toEqual([
      { name: "Wednesday 9:05 AM", value: wedEarly.id },
      { name: "Wednesday 9:00 PM", value: wedLate.id },
      { name: "Saturday 7:30 PM", value: sat.id },
    ]);
  });

  it("viewableTeams gives officers every team in this server, raiders only their own", async () => {
    const main = await makeTeam();
    const alt = await makeTeam({ roleId: "role-alt" });
    await makeTeam({ guildId: "guild-2" });
    const { guild } = world({ members: [alice()] });
    expect((await viewableTeams(guild, "u-alice", true)).map((t) => t.id).sort()).toEqual([main.id, alt.id].sort());
    expect((await viewableTeams(guild, "u-alice", false)).map((t) => t.id)).toEqual([main.id]);
    expect(await viewableTeams(guild, "u-stranger", false)).toEqual([]);
  });

  it("teamsForMember matches the member's roles, against a given list or this server's teams", async () => {
    const main = await makeTeam();
    const alt = await makeTeam({ roleId: "role-alt" });
    const elsewhere = await makeTeam({ guildId: "guild-2" });
    const { guild } = world({ members: [alice()] });
    // `elsewhere` uses the same role id in another server, so only the guild filter excludes it.
    expect((await teamsForMember(guild, "u-alice")).map((t) => t.id)).toEqual([main.id]);
    expect((await teamsForMember(guild, "u-alice", [main, elsewhere])).map((t) => t.id)).toEqual([main.id, elsewhere.id]);
    expect(await teamsForMember(guild, "u-alice", [alt])).toEqual([]);
    expect(await teamsForMember(guild, "u-missing")).toEqual([]);
  });
});
