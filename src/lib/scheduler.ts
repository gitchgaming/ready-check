import { DateTime } from "luxon";
import type { Client } from "discord.js";
import { prisma } from "./db.js";
import { buildRaidMessage } from "./embeds.js";

/** How many future raid instances to keep visible per team. */
const UPCOMING_WINDOW = 3;

/** How long after a raid's start time before its message is closed out. */
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

/** Ensures the next N raid instances exist (as DB rows + posted messages) for a team. */
export async function syncRaidTeam(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId }, include: { slots: true } });
  if (!team || team.slots.length === 0) return;

  const candidates = team.slots.flatMap((slot) =>
    nextOccurrences(slot.dayOfWeek, slot.hour, slot.minute, team.timezone, UPCOMING_WINDOW),
  );
  candidates.sort((a, b) => a.toMillis() - b.toMillis());
  const chosen = candidates.slice(0, UPCOMING_WINDOW);

  const channel = await client.channels.fetch(team.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  for (const startsAt of chosen) {
    const existing = await prisma.raidInstance.findUnique({
      where: { raidTeamId_startsAt: { raidTeamId: team.id, startsAt: startsAt.toJSDate() } },
    });
    if (existing) continue;

    const instance = await prisma.raidInstance.create({
      data: {
        raidTeamId: team.id,
        startsAt: startsAt.toJSDate(),
        channelId: team.channelId,
      },
    });

    const { embeds, components } = buildRaidMessage(team, instance, []);
    const message = await channel.send({ embeds, components });
    await prisma.raidInstance.update({ where: { id: instance.id }, data: { messageId: message.id } });
  }

  await closeExpiredInstances(client, team.id);
}

async function closeExpiredInstances(client: Client, raidTeamId: string): Promise<void> {
  const cutoff = DateTime.now().minus({ hours: CLOSE_GRACE_HOURS }).toJSDate();
  const expired = await prisma.raidInstance.findMany({
    where: { raidTeamId, closed: false, startsAt: { lt: cutoff } },
  });

  for (const instance of expired) {
    await prisma.raidInstance.update({ where: { id: instance.id }, data: { closed: true } });
    await refreshInstanceMessage(client, instance.id).catch((err) => {
      console.error(`Failed to close out message for raid instance ${instance.id}:`, err);
    });
  }
}

/** Re-renders a raid instance's embed/buttons from current DB state. */
export async function refreshInstanceMessage(client: Client, instanceId: string): Promise<void> {
  const instance = await prisma.raidInstance.findUnique({
    where: { id: instanceId },
    include: { raidTeam: true, attendance: true },
  });
  if (!instance || !instance.messageId) return;

  const channel = await client.channels.fetch(instance.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(instance.messageId).catch(() => null);
  if (!message) return;

  const calledOut = instance.attendance.filter((a) => a.status === "OUT").map((a) => a.userId);
  const { embeds, components } = buildRaidMessage(instance.raidTeam, instance, calledOut);
  await message.edit({ embeds, components });
}

export async function syncAllRaidTeams(client: Client): Promise<void> {
  const teams = await prisma.raidTeam.findMany({ select: { id: true } });
  for (const team of teams) {
    await syncRaidTeam(client, team.id).catch((err) => {
      console.error(`Failed to sync raid team ${team.id}:`, err);
    });
  }
}
