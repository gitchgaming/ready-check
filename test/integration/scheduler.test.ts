import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { MessageFlags } from "discord.js";
import {
  PAGE_SIZE,
  clampOffset,
  instancesForWindow,
  nextOpenInstances,
  personalCalendar,
  renderTeamMessage,
  syncAllRaidTeams,
  syncRaidTeam,
} from "../../src/lib/scheduler.js";
import { CHANNEL_ID, callOut, makeRaid, makeSlot, makeTeam, prisma } from "../db.js";
import { fakeChannel, fakeClient, fakeGuild, fakeMember, flattenComponents, payloadText, raider, teamRole } from "../discord.js";
import { NOW, useDbAndClock, world } from "./world.js";

useDbAndClock();

const TZ = "America/Chicago";
const now = () => DateTime.fromJSDate(NOW);

async function raidsOf(teamId: string) {
  return prisma.raidInstance.findMany({ where: { raidTeamId: teamId }, orderBy: { startsAt: "asc" } });
}

const local = (d: Date) => DateTime.fromJSDate(d).setZone(TZ);

/** The attendance:btn customIds on a public payload, in order. */
function statusButtons(payload: any): string[] {
  return flattenComponents(payload)
    .map((c) => c.custom_id as string | undefined)
    .filter((id): id is string => !!id?.startsWith("attendance:btn:"));
}

describe("syncRaidTeam", () => {
  it("generates 12 future raids for one night, at the night's local time in the team's timezone", async () => {
    const team = await makeTeam();
    await makeSlot(team.id, 3, 20, 0); // Wednesday 8:00 PM
    const { client } = world();

    await syncRaidTeam(client, team.id);

    const raids = await raidsOf(team.id);
    expect(raids).toHaveLength(12);
    expect(raids.every((r) => !r.closed && !r.cancelled && !r.oneOff)).toBe(true);
    // Crosses the Nov 1 DST change; every raid stays Wednesday 8:00 PM Chicago time.
    for (const r of raids) expect(local(r.startsAt).toFormat("ccc HH:mm")).toBe("Wed 20:00");
    expect(local(raids[0]!.startsAt).toISODate()).toBe("2026-10-07");
    expect(local(raids[11]!.startsAt).toISODate()).toBe("2026-12-23");
  });

  it("includes tonight's raid when it's still ahead, and skips to next week when today's has passed", async () => {
    // It's 7:00 AM Tuesday in Chicago.
    const later = await makeTeam();
    await makeSlot(later.id, 2, 20, 0);
    const earlier = await makeTeam({ roleId: "role-early" });
    await makeSlot(earlier.id, 2, 6, 30);
    const { client } = world();
    await syncRaidTeam(client, later.id);
    await syncRaidTeam(client, earlier.id);

    expect(local((await raidsOf(later.id))[0]!.startsAt).toISO()).toBe("2026-10-06T20:00:00.000-05:00");
    expect(local((await raidsOf(earlier.id))[0]!.startsAt).toISO()).toBe("2026-10-13T06:30:00.000-05:00");
  });

  it("is idempotent: a second sync at the same time adds nothing and keeps the same rows", async () => {
    const team = await makeTeam();
    await makeSlot(team.id, 3);
    const { client } = world();

    await syncRaidTeam(client, team.id);
    const first = (await raidsOf(team.id)).map((r) => r.id);
    await syncRaidTeam(client, team.id);
    expect((await raidsOf(team.id)).map((r) => r.id)).toEqual(first);
  });

  it("merges several nights in chronological order and keeps 12 in total, not 12 per night", async () => {
    const team = await makeTeam();
    await makeSlot(team.id, 6, 19, 30); // Saturday 7:30 PM, created first
    await makeSlot(team.id, 3, 20, 0); // Wednesday 8:00 PM
    const { client } = world();

    await syncRaidTeam(client, team.id);

    const raids = await raidsOf(team.id);
    expect(raids).toHaveLength(12);
    expect(raids.map((r) => local(r.startsAt).toFormat("ccc HH:mm"))).toEqual(
      Array.from({ length: 6 }, () => ["Wed 20:00", "Sat 19:30"]).flat(),
    );
    expect(local(raids[11]!.startsAt).toISODate()).toBe("2026-11-14");
  });

  it("generates displayCount + 1 raids when that's more than 12", async () => {
    const team = await makeTeam({ displayCount: 15 });
    await makeSlot(team.id, 3);
    await syncRaidTeam(world().client, team.id);
    expect(await raidsOf(team.id)).toHaveLength(16);
  });

  it("closes raids more than 3 hours after their start, and only those", async () => {
    const team = await makeTeam();
    const old = await makeRaid(team.id, now().minus({ hours: 3, minutes: 1 }));
    const recent = await makeRaid(team.id, now().minus({ hours: 2, minutes: 59 }));
    await syncRaidTeam(world().client, team.id);

    const byId = new Map((await raidsOf(team.id)).map((r) => [r.id, r]));
    expect(byId.get(old.id)!.closed).toBe(true);
    expect(byId.get(recent.id)!.closed).toBe(false);
  });

  it("tops the schedule back up as time passes, closing the raids that happened", async () => {
    const team = await makeTeam();
    await makeSlot(team.id, 3);
    const { client } = world();
    await syncRaidTeam(client, team.id);

    vi.setSystemTime(now().plus({ weeks: 1 }).toJSDate());
    await syncRaidTeam(client, team.id);

    const raids = await raidsOf(team.id);
    expect(raids).toHaveLength(13);
    expect(raids.filter((r) => r.closed).map((r) => local(r.startsAt).toISODate())).toEqual(["2026-10-07"]);
    expect(raids.filter((r) => !r.closed)).toHaveLength(12);
  });

  it("never deletes raids: past ones, ones beyond the window, and ones whose night was removed stay", async () => {
    const team = await makeTeam();
    const slot = await makeSlot(team.id, 3);
    const past = await makeRaid(team.id, "2026-09-01T01:00:00Z", { closed: true });
    const farFuture = await makeRaid(team.id, "2027-06-01T01:00:00Z");
    const { client } = world();
    await syncRaidTeam(client, team.id);
    const generated = await raidsOf(team.id);

    await prisma.raidSlot.delete({ where: { id: slot.id } });
    await syncRaidTeam(client, team.id);

    const ids = (await raidsOf(team.id)).map((r) => r.id);
    expect(ids).toEqual(generated.map((r) => r.id));
    expect(ids).toContain(past.id);
    expect(ids).toContain(farFuture.id);
  });

  it("keeps a cancelled generated raid cancelled and leaves one-off raids alone", async () => {
    const team = await makeTeam();
    await makeSlot(team.id, 3);
    const cancelled = await makeRaid(team.id, "2026-10-08T01:00:00Z", { cancelled: true }); // Wed Oct 7, 8 PM CDT
    const oneOff = await makeRaid(team.id, "2026-10-10T18:00:00Z", { oneOff: true });
    await syncRaidTeam(world().client, team.id);

    const raids = await raidsOf(team.id);
    expect(raids).toHaveLength(13);
    expect(raids.find((r) => r.id === cancelled.id)).toMatchObject({ cancelled: true, oneOff: false });
    expect(raids.find((r) => r.id === oneOff.id)).toMatchObject({ cancelled: false, oneOff: true });
  });

  it("generates nothing without nights, but still closes old raids and renders the message", async () => {
    const team = await makeTeam();
    const old = await makeRaid(team.id, "2026-10-01T01:00:00Z");
    const { client, channel } = world();

    await syncRaidTeam(client, team.id);

    expect(await raidsOf(team.id)).toEqual([expect.objectContaining({ id: old.id, closed: true })]);
    expect(channel.sent).toHaveLength(1);
    expect(payloadText(channel.sent[0]!.payloads[0] as any)).toContain("No raids to show here yet");
  });

  it("does nothing for a team that doesn't exist", async () => {
    const { client, channel } = world();
    await expect(syncRaidTeam(client, "missing")).resolves.toBeUndefined();
    expect(channel.sent).toHaveLength(0);
    expect(await prisma.raidInstance.count()).toBe(0);
  });
});

describe("syncAllRaidTeams", () => {
  it("syncs every team and carries on past one team's failure", async () => {
    const broken = await makeTeam({ roleId: "role-broken", timezone: "Not/AZone", name: "Broken" });
    await makeSlot(broken.id, 3);
    const healthy = await makeTeam({ roleId: "role-healthy", name: "Healthy" });
    await makeSlot(healthy.id, 3);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncAllRaidTeams(world().client)).resolves.toBeUndefined();

    expect(await raidsOf(healthy.id)).toHaveLength(12);
    expect(await raidsOf(broken.id)).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(broken.id), expect.anything());
  });
});

describe("nextOpenInstances", () => {
  it("returns open raids soonest first, cancelled included, closed excluded, with attendance", async () => {
    const team = await makeTeam();
    const other = await makeTeam({ roleId: "role-other" });
    await makeRaid(other.id, "2026-10-07T00:00:00Z");
    await makeRaid(team.id, "2026-10-01T01:00:00Z", { closed: true });
    const c = await makeRaid(team.id, "2026-10-14T01:00:00Z");
    const a = await makeRaid(team.id, "2026-10-08T01:00:00Z", { cancelled: true });
    const b = await makeRaid(team.id, "2026-10-10T01:00:00Z");
    await makeRaid(team.id, "2026-10-21T01:00:00Z");
    await callOut(b.id, "u-1");

    const open = await nextOpenInstances(team.id, 3);
    expect(open.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(open[1]!.attendance).toEqual([expect.objectContaining({ userId: "u-1", status: "OUT" })]);
  });
});

describe("instancesForWindow / clampOffset", () => {
  // 4 closed raids (indices -4..-1) then 5 open ones (0..4).
  async function seed() {
    const team = await makeTeam();
    const closed = [];
    for (let i = 4; i >= 1; i--) closed.push(await makeRaid(team.id, now().minus({ weeks: i }), { closed: true }));
    const open = [];
    for (let i = 1; i <= 5; i++) open.push(await makeRaid(team.id, now().plus({ days: i })));
    return { team, closed: closed.map((r) => r.id), open: open.map((r) => r.id) };
  }
  const ids = (w: { instances: { id: string }[] }) => w.instances.map((i) => i.id);

  it("shows the first PAGE_SIZE open raids at offset 0, with paging both ways", async () => {
    const { team, open } = await seed();
    const w = await instancesForWindow(team.id, 0);
    expect(ids(w)).toEqual(open.slice(0, PAGE_SIZE));
    expect(w).toMatchObject({ canEarlier: true, canLater: true });
  });

  it("pages back into closed raids, and spans the closed/open boundary in order", async () => {
    const { team, closed, open } = await seed();
    expect(ids(await instancesForWindow(team.id, -3))).toEqual(closed.slice(1, 4));
    expect(ids(await instancesForWindow(team.id, -2))).toEqual([closed[2], closed[3], open[0]]);
    expect(ids(await instancesForWindow(team.id, -1))).toEqual([closed[3], open[0], open[1]]);
  });

  it("stops at the earliest raid", async () => {
    const { team, closed } = await seed();
    const w = await instancesForWindow(team.id, -10);
    expect(ids(w)).toEqual(closed.slice(0, 3));
    expect(w).toMatchObject({ canEarlier: false, canLater: true });
    expect(await clampOffset(team.id, -10)).toBe(-4);
    expect(await clampOffset(team.id, -4)).toBe(-4);
  });

  it("stops at the latest raid", async () => {
    const { team, open } = await seed();
    const w = await instancesForWindow(team.id, 3);
    expect(ids(w)).toEqual(open.slice(3));
    expect(w).toMatchObject({ canEarlier: true, canLater: false });
    // Past the end, the window shrinks to the last raid rather than going empty.
    const beyond = await instancesForWindow(team.id, 100);
    expect(ids(beyond)).toEqual([open[4]]);
    expect(beyond.canLater).toBe(false);
    expect(await clampOffset(team.id, 100)).toBe(4);
    expect(await clampOffset(team.id, 3)).toBe(3);
  });

  it("handles a team with no raids at all", async () => {
    const team = await makeTeam();
    expect(await instancesForWindow(team.id, 0)).toEqual({ instances: [], canEarlier: false, canLater: false });
    expect(await instancesForWindow(team.id, -3)).toEqual({ instances: [], canEarlier: false, canLater: false });
    expect(await clampOffset(team.id, 6)).toBe(0);
    expect(await clampOffset(team.id, -6)).toBe(0);
  });

  it("with only open raids, offset 0 can't go earlier", async () => {
    const team = await makeTeam();
    for (let i = 1; i <= 2; i++) await makeRaid(team.id, now().plus({ days: i }));
    expect(await instancesForWindow(team.id, 0)).toMatchObject({ canEarlier: false, canLater: false });
    expect(await clampOffset(team.id, -3)).toBe(0);
  });
});

describe("personalCalendar", () => {
  it("builds the viewer's page with their own status per open raid and nav state for the offset", async () => {
    const team = await makeTeam();
    await makeRaid(team.id, now().minus({ weeks: 1 }), { closed: true });
    const r1 = await makeRaid(team.id, "2026-10-07T01:00:00Z"); // Tue Oct 6, 8 PM CDT
    const r2 = await makeRaid(team.id, "2026-10-08T01:00:00Z");
    const cancelled = await makeRaid(team.id, "2026-10-09T01:00:00Z", { cancelled: true });
    const alice = raider("Alice", [], "u-alice");
    const bob = raider("Bob", [], "u-bob");
    await callOut(r2.id, alice.id);
    await callOut(r1.id, bob.id);
    await callOut(r1.id, "u-gone"); // not on the roster any more: not counted
    const { guild } = world({ members: [alice, bob] });

    const msg = await personalCalendar(team, guild, 0, alice.id);
    const all = flattenComponents(msg);
    const select = all.find((c) => c.custom_id === `attendance:cal:${team.id}:0`);
    expect(select.options.map((o: any) => [o.value, o.emoji.name, o.label])).toEqual([
      [r1.id, "✅", "Tue, Oct 6 · 8:00 PM"],
      [r2.id, "❌", "Wed, Oct 7 · 8:00 PM"],
    ]);
    expect(all.find((c) => c.custom_id === `mynav:earlier:${team.id}:0`).disabled).toBe(false);
    expect(all.find((c) => c.custom_id === `mynav:later:${team.id}:0`).disabled).toBe(true);
    const text = payloadText(msg);
    expect(text).toContain("**1 of 2 attending**\n❌ <@u-bob>");
    expect(text).not.toContain("u-gone");
    expect(text).toContain("🚫 **Cancelled**");
    expect(select.options.map((o: any) => o.value)).not.toContain(cancelled.id);
  });

  it("carries a negative offset into its customIds and shows the past page", async () => {
    const team = await makeTeam();
    await makeRaid(team.id, now().minus({ weeks: 1 }), { closed: true });
    await makeRaid(team.id, now().plus({ days: 1 }));
    const { guild } = world();

    const msg = await personalCalendar(team, guild, -1, "u-1");
    const all = flattenComponents(msg);
    expect(all.some((c) => c.custom_id === `attendance:cal:${team.id}:-1`)).toBe(true);
    expect(all.find((c) => c.custom_id === `mynav:earlier:${team.id}:-1`).disabled).toBe(true);
  });
});

describe("renderTeamMessage", () => {
  it("posts a V2 message once, then edits it in place", async () => {
    const team = await makeTeam();
    const raid = await makeRaid(team.id, "2026-10-07T01:00:00Z");
    const alice = raider("Alice", ["Warriors", "Tanks"], "u-alice");
    const bob = raider("Bob", ["Mages", "Wizards"], "u-bob");
    await callOut(raid.id, bob.id);
    const { guild, channel, client } = world({ members: [alice, bob] });

    await renderTeamMessage(client, team.id);
    expect(channel.sent).toHaveLength(1);
    const posted = channel.sent[0]!;
    expect(posted.flags.has(MessageFlags.IsComponentsV2)).toBe(true);
    expect(payloadText(posted.payloads[0] as any)).toContain("**1/2 ready**");
    expect((posted.payloads[0] as any).allowedMentions).toEqual({ parse: [] });
    expect((await prisma.raidTeam.findUniqueOrThrow({ where: { id: team.id } })).messageId).toBe(posted.id);

    await prisma.attendance.deleteMany();
    await renderTeamMessage(client, team.id);
    expect(channel.sent).toHaveLength(1);
    expect(posted.payloads).toHaveLength(2);
    expect(payloadText(posted.payloads[1] as any)).toContain("**2/2 ready**");
    expect(guild.fullFetches).toBe(0);
  });

  it("shows Next Up plus displayCount raids, with a Status button for each open one", async () => {
    const team = await makeTeam({ displayCount: 2 });
    const raids = [];
    for (let i = 1; i <= 5; i++) raids.push(await makeRaid(team.id, now().plus({ days: i })));
    const { channel, client } = world();

    await renderTeamMessage(client, team.id);
    expect(statusButtons(channel.sent[0]!.payloads[0])).toEqual(
      raids.slice(0, 3).map((r) => `attendance:btn:${team.id}:${r.id}`),
    );
  });

  it("keeps a cancelled raid in the Next Up spot until it closes", async () => {
    const team = await makeTeam({ displayCount: 1 });
    const cancelled = await makeRaid(team.id, now().minus({ hours: 1 }), { cancelled: true });
    const later = await makeRaid(team.id, now().plus({ days: 1 }));
    const { channel, client } = world();

    await renderTeamMessage(client, team.id);
    const payload = channel.sent[0]!.payloads[0] as any;
    const nextUp = payloadText({ components: [payload.components[0]] });
    expect(nextUp).toContain("NEXT UP");
    expect(nextUp).toContain("🚫 **Cancelled**");
    expect(statusButtons(payload)).toEqual([`attendance:btn:${team.id}:${later.id}`]);
    expect(statusButtons(payload)).not.toContain(`attendance:btn:${team.id}:${cancelled.id}`);
  });

  it("replaces a pre-V2 message once with a fresh post, deleting the old one", async () => {
    const team = await makeTeam({ messageId: "old-msg" });
    const { channel, client } = world();
    const old = channel.seedMessage("old-msg", { v2: false });

    await renderTeamMessage(client, team.id);
    expect(old.deleted).toBe(true);
    expect(old.payloads).toHaveLength(1); // never edited
    expect(channel.sent).toHaveLength(1);
    const fresh = channel.sent[0]!;
    expect((await prisma.raidTeam.findUniqueOrThrow({ where: { id: team.id } })).messageId).toBe(fresh.id);

    await renderTeamMessage(client, team.id);
    expect(channel.sent).toHaveLength(1);
    expect(fresh.payloads).toHaveLength(2);
  });

  it("edits an existing V2 message that it didn't post this run", async () => {
    const team = await makeTeam({ messageId: "v2-msg" });
    const { channel, client } = world();
    const existing = channel.seedMessage("v2-msg", { v2: true });

    await renderTeamMessage(client, team.id);
    expect(channel.sent).toHaveLength(0);
    expect(existing.payloads).toHaveLength(2);
    expect(existing.deleted).toBe(false);
  });

  it("posts a new message when the stored one is gone", async () => {
    const team = await makeTeam({ messageId: "deleted-msg" });
    const { channel, client } = world();

    await renderTeamMessage(client, team.id);
    expect(channel.sent).toHaveLength(1);
    expect((await prisma.raidTeam.findUniqueOrThrow({ where: { id: team.id } })).messageId).toBe(channel.sent[0]!.id);
  });

  it("does nothing when the team, guild or channel is missing, or the channel can't take messages", async () => {
    const team = await makeTeam();
    const channel = fakeChannel();
    const guild = fakeGuild();

    await renderTeamMessage(fakeClient({ guilds: [guild], channels: [channel] }), "missing");
    await renderTeamMessage(fakeClient({ guilds: [], channels: [channel] }), team.id);
    await renderTeamMessage(fakeClient({ guilds: [guild], channels: [fakeChannel("elsewhere")] }), team.id);
    const voice = Object.assign(fakeChannel(CHANNEL_ID), { isTextBased: () => false });
    await renderTeamMessage(fakeClient({ guilds: [guild], channels: [voice] }), team.id);

    expect(channel.sent).toHaveLength(0);
    expect(voice.sent).toHaveLength(0);
    expect((await prisma.raidTeam.findUniqueOrThrow({ where: { id: team.id } })).messageId).toBeNull();
  });

  it("fetches the member list only when the cache is incomplete", async () => {
    const team = await makeTeam();
    const alice = raider("Alice", [], "u-alice");
    const warm = world({ members: [alice] });
    await renderTeamMessage(warm.client, team.id);
    expect(warm.guild.fullFetches).toBe(0);

    await prisma.raidTeam.update({ where: { id: team.id }, data: { messageId: null } });
    const cold = world({ members: [alice], memberCount: 5 });
    await renderTeamMessage(cold.client, team.id);
    expect(cold.guild.fullFetches).toBe(1);
  });

  it("counts only current role holders, not bots or members without the role", async () => {
    const team = await makeTeam();
    await makeRaid(team.id, now().plus({ days: 1 }));
    const members = [
      raider("Alice", [], "u-alice"),
      fakeMember({ id: "u-bot", name: "Bot", roles: [teamRole], bot: true }),
      fakeMember({ id: "u-guest", name: "Guest" }),
    ];
    const { channel, client } = world({ members });
    await renderTeamMessage(client, team.id);
    expect(payloadText(channel.sent[0]!.payloads[0] as any)).toContain("**1/1 ready**");
  });
});
