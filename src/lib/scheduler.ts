import { DateTime } from "luxon";
import { MessageFlags, type Client, type Guild } from "discord.js";
import { prisma } from "./db.js";
import type { RaidTeam } from "../generated/prisma/client.js";
import { MAX_SELECT_OPTIONS, buildCalendarMessage, buildPublicMessage } from "./embeds.js";
import { fetchRosterMembers, rosterMemberIds } from "./roster.js";

/** How many raids /schedule pages through at a time. */
export const PAGE_SIZE = 3;

/** Minimum number of future raid instances to keep generated per team. */
const MIN_FUTURE_GENERATE_COUNT = 12;

/** How long after a raid's start time before it moves into history. */
const CLOSE_GRACE_HOURS = 3;

function nextOccurrence(
  dayOfWeek: number,
  hour: number,
  minute: number,
  timezone: string,
  from: DateTime,
): DateTime {
  let candidate = from.setZone(timezone).set({ hour, minute, second: 0, millisecond: 0 });
  const diff = (dayOfWeek - candidate.weekday + 7) % 7;
  candidate = candidate.plus({ days: diff });
  if (candidate <= from) candidate = candidate.plus({ weeks: 1 });
  return candidate;
}

function nextOccurrences(
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

/** Ensures enough future raid instances exist, closes out expired ones, and re-renders the team's message. */
export async function syncRaidTeam(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId }, include: { slots: true } });
  if (!team) return;

  const generateCount = Math.max(MIN_FUTURE_GENERATE_COUNT, team.displayCount + 1);

  if (team.slots.length > 0) {
    const candidates = team.slots.flatMap((slot) =>
      nextOccurrences(slot.dayOfWeek, slot.hour, slot.minute, team.timezone, generateCount),
    );
    candidates.sort((a, b) => a.toMillis() - b.toMillis());
    const chosen = candidates.slice(0, generateCount);

    for (const startsAt of chosen) {
      await prisma.raidInstance.upsert({
        where: { raidTeamId_startsAt: { raidTeamId: team.id, startsAt: startsAt.toJSDate() } },
        create: { raidTeamId: team.id, startsAt: startsAt.toJSDate() },
        update: {},
      });
    }
  }

  const cutoff = DateTime.now().minus({ hours: CLOSE_GRACE_HOURS }).toJSDate();
  await prisma.raidInstance.updateMany({
    where: { raidTeamId: team.id, closed: false, startsAt: { lt: cutoff } },
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

/** Builds one viewer's personal schedule: the paged window plus every open raid for the select. */
export async function personalCalendar(team: RaidTeam, guild: Guild, offset: number, viewerId: string) {
  const [{ instances, canEarlier, canLater }, openInstances, rosterIds] = await Promise.all([
    instancesForWindow(team.id, offset),
    nextOpenInstances(team.id, MAX_SELECT_OPTIONS),
    rosterMemberIds(guild, team.roleId),
  ]);
  return buildCalendarMessage(team, instances, offset, { canEarlier, canLater }, rosterIds, openInstances, viewerId);
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
  const content = buildPublicMessage(team, instances, members);

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
