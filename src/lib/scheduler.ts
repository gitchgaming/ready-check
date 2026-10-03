import { DateTime } from "luxon";
import type { Client } from "discord.js";
import { prisma } from "./db.js";
import { buildTeamMessage, type ViewMode } from "./embeds.js";

/** How many future raid instances to keep generated/shown per team. */
const UPCOMING_WINDOW = 3;

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

/** Ensures the next N raid instances exist as DB rows, closes out expired ones, and re-renders the team's message. */
export async function syncRaidTeam(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId }, include: { slots: true } });
  if (!team) return;

  if (team.slots.length > 0) {
    const candidates = team.slots.flatMap((slot) =>
      nextOccurrences(slot.dayOfWeek, slot.hour, slot.minute, team.timezone, UPCOMING_WINDOW),
    );
    candidates.sort((a, b) => a.toMillis() - b.toMillis());
    const chosen = candidates.slice(0, UPCOMING_WINDOW);

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

/** Fetches the instances to display for a team's current view mode, in chronological order. */
export async function instancesForMode(teamId: string, mode: ViewMode) {
  const instances = await prisma.raidInstance.findMany({
    where: { raidTeamId: teamId, closed: mode === "history" },
    include: { attendance: true },
    orderBy: { startsAt: mode === "history" ? "desc" : "asc" },
    take: UPCOMING_WINDOW,
  });
  // Keep chronological order within the card grid even for history (most-recent-first query above).
  if (mode === "history") instances.reverse();
  return instances;
}

/** Re-renders a team's single persistent schedule message from current DB state. */
export async function renderTeamMessage(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
  if (!team) return;

  const mode = (team.viewMode as ViewMode) ?? "upcoming";
  const instances = await instancesForMode(team.id, mode);
  const content = buildTeamMessage(team, instances, mode);

  const channel = await client.channels.fetch(team.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  if (team.messageId) {
    const existing = await channel.messages.fetch(team.messageId).catch(() => null);
    if (existing) {
      await existing.edit(content);
      return;
    }
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
