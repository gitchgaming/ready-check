import { DateTime } from "luxon";
import { MessageFlags, type Client, type Guild } from "discord.js";
import { prisma } from "./db.js";
import type { RaidTeam } from "../generated/prisma/client.js";
import { MAX_SELECT_OPTIONS, buildCalendarMessage, buildPublicMessage, type Notice } from "./embeds.js";
import { fetchRosterMembers } from "./roster.js";
import { teamDisplayName } from "./pickers.js";
import { nextOccurrence } from "./time.js";
import { userTimezone } from "./userSettings.js";

export { nextOccurrence };

/** How many raids /schedule pages through at a time. */
export const PAGE_SIZE = 3;

/** Minimum number of future raid instances to keep generated per team. */
const MIN_FUTURE_GENERATE_COUNT = 12;

/** How long after a raid's start time before it moves into history. */
const CLOSE_GRACE_HOURS = 3;


export function nextOccurrences(
  dayOfWeek: number,
  hour: number,
  minute: number,
  timezone: string,
  count: number,
): DateTime[] {
  const now = DateTime.now();
  const results: DateTime[] = [];
  let candidate = nextOccurrence(dayOfWeek, hour, minute, timezone, now);
  for (let i = 0; i < count; i++) {
    results.push(candidate);
    candidate = candidate.plus({ weeks: 1 });
  }
  return results;
}

/**
 * The first moment after a team's final raid date: the next midnight in team time.
 * Raids starting at or after it are never generated and are removed while open.
 * Null when the team has no final raid date.
 */
export function scheduleCutoff(team: Pick<RaidTeam, "finalRaidDate" | "timezone">): DateTime | null {
  if (!team.finalRaidDate) return null;
  const day = DateTime.fromISO(team.finalRaidDate, { zone: team.timezone });
  return day.isValid ? day.plus({ days: 1 }).startOf("day") : null;
}

/** The team's final raid date as plain text, in team time: `Tuesday, Oct 27, 2026`. */
export function formatFinalRaidDate(team: Pick<RaidTeam, "finalRaidDate">): string | null {
  if (!team.finalRaidDate) return null;
  return DateTime.fromISO(team.finalRaidDate).setLocale("en-US").toFormat("cccc, MMM d, yyyy");
}

/** Ensures enough future raid instances exist, closes out expired ones, and re-renders the team's message. */
export async function syncRaidTeam(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId }, include: { slots: true } });
  if (!team) return;

  const generateCount = Math.max(MIN_FUTURE_GENERATE_COUNT, team.displayCount + 1);
  const cutoff = scheduleCutoff(team);

  // Nothing runs after the final raid date: open raids past it go (their call-outs
  // cascade), and none are generated. Closed raids stay as attendance history.
  if (cutoff) {
    await prisma.raidInstance.deleteMany({
      where: { raidTeamId: team.id, closed: false, startsAt: { gte: cutoff.toJSDate() } },
    });
  }

  if (team.slots.length > 0) {
    const candidates = team.slots.flatMap((slot) =>
      nextOccurrences(slot.dayOfWeek, slot.hour, slot.minute, team.timezone, generateCount),
    );
    candidates.sort((a, b) => a.toMillis() - b.toMillis());
    const chosen = candidates.slice(0, generateCount).filter((startsAt) => !cutoff || startsAt < cutoff);

    for (const startsAt of chosen) {
      await prisma.raidInstance.upsert({
        where: { raidTeamId_startsAt: { raidTeamId: team.id, startsAt: startsAt.toJSDate() } },
        create: { raidTeamId: team.id, startsAt: startsAt.toJSDate() },
        update: {},
      });
    }
  }

  const closeBefore = DateTime.now().minus({ hours: CLOSE_GRACE_HOURS }).toJSDate();
  await prisma.raidInstance.updateMany({
    where: { raidTeamId: team.id, closed: false, startsAt: { lt: closeBefore } },
    data: { closed: true },
  });

  await renderTeamMessage(client, team.id);
}

/** The next `count` open (not-yet-closed) raid instances, soonest first. */
export async function nextOpenInstances(teamId: string, count: number) {
  return prisma.raidInstance.findMany({
    where: { raidTeamId: teamId, closed: false },
    include: { attendance: true },
    orderBy: { startsAt: "asc" },
    take: count,
  });
}

export interface WindowResult {
  instances: Awaited<ReturnType<typeof fetchWindowInstances>>;
  canEarlier: boolean;
  canLater: boolean;
}

async function fetchWindowInstances(teamId: string, closed: boolean, skip: number, take: number) {
  if (take <= 0) return [];
  return prisma.raidInstance.findMany({
    where: { raidTeamId: teamId, closed },
    include: { attendance: true },
    orderBy: { startsAt: "asc" },
    skip,
    take,
  });
}

/**
 * Fetches the PAGE_SIZE raids visible at a given offset from "now", for the personal
 * /schedule view — closed (past) raids occupy negative indices, open (future)
 * raids occupy indices starting at 0. Purely computed per-call; nothing is persisted.
 */
export async function instancesForWindow(teamId: string, offset: number): Promise<WindowResult> {
  const closedCount = await prisma.raidInstance.count({ where: { raidTeamId: teamId, closed: true } });
  const openCount = await prisma.raidInstance.count({ where: { raidTeamId: teamId, closed: false } });
  const totalCount = closedCount + openCount;
  const anchorIndex = closedCount;

  const windowStart = Math.max(0, Math.min(anchorIndex + offset, Math.max(0, totalCount - 1)));
  const windowEnd = Math.min(windowStart + PAGE_SIZE, totalCount);

  const closedFrom = windowStart;
  const closedTo = Math.min(windowEnd, anchorIndex);
  const closedTake = Math.max(0, closedTo - closedFrom);

  const openFrom = Math.max(0, windowStart - anchorIndex);
  const openTo = windowEnd - anchorIndex;
  const openTake = Math.max(0, openTo - openFrom);

  const [closedInstances, openInstances] = await Promise.all([
    fetchWindowInstances(teamId, true, closedFrom, closedTake),
    fetchWindowInstances(teamId, false, openFrom, openTake),
  ]);

  return {
    instances: [...closedInstances, ...openInstances],
    canEarlier: windowStart > 0,
    canLater: windowEnd < totalCount,
  };
}

/**
 * Builds one viewer's personal schedule: the paged window plus every open raid for
 * the select. `notice` goes on top.
 */
export async function personalCalendar(team: RaidTeam, guild: Guild, offset: number, viewerId: string, notice?: Notice) {
  const [{ instances, canEarlier, canLater }, openInstances, members, viewerZone] = await Promise.all([
    instancesForWindow(team.id, offset),
    nextOpenInstances(team.id, MAX_SELECT_OPTIONS),
    fetchRosterMembers(guild, team.roleId),
    userTimezone(viewerId),
  ]);
  return buildCalendarMessage(
    team,
    teamDisplayName(team, guild),
    instances,
    offset,
    { canEarlier, canLater },
    members,
    openInstances,
    viewerId,
    notice,
    viewerZone,
  );
}

/** Clamps a requested /schedule offset so the resulting window stays within available instances. */
export async function clampOffset(teamId: string, requestedOffset: number): Promise<number> {
  const closedCount = await prisma.raidInstance.count({ where: { raidTeamId: teamId, closed: true } });
  const openCount = await prisma.raidInstance.count({ where: { raidTeamId: teamId, closed: false } });
  const totalCount = closedCount + openCount;
  const anchorIndex = closedCount;

  const windowStart = Math.max(0, Math.min(anchorIndex + requestedOffset, Math.max(0, totalCount - 1)));
  return windowStart - anchorIndex;
}

/** Re-renders a team's single persistent, fixed-count public schedule message from current DB state. */
export async function renderTeamMessage(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
  if (!team) return;

  // Next Up plus `displayCount` raids under Coming Up.
  const instances = await nextOpenInstances(team.id, team.displayCount + 1);
  const guild = await client.guilds.fetch(team.guildId).catch(() => null);
  if (!guild) return;
  const members = await fetchRosterMembers(guild, team.roleId);
  const content = buildPublicMessage(team, teamDisplayName(team, guild), instances, members);

  const channel = await client.channels.fetch(team.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  if (team.messageId) {
    const existing = await channel.messages.fetch(team.messageId).catch(() => null);
    // A message posted before the Components V2 layout can't be edited into it,
    // so it's replaced once with a fresh post.
    if (existing?.flags.has(MessageFlags.IsComponentsV2)) {
      await existing.edit(content);
      return;
    }
    await existing?.delete().catch(() => null);
  }

  const message = await channel.send(content);
  await prisma.raidTeam.update({ where: { id: team.id }, data: { messageId: message.id } });
}

export async function syncAllRaidTeams(client: Client): Promise<void> {
  const teams = await prisma.raidTeam.findMany({ select: { id: true } });
  for (const team of teams) {
    await syncRaidTeam(client, team.id).catch((err) => {
      console.error(`Failed to sync raid team ${team.id}:`, err);
    });
  }
}
