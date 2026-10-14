import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { RaidTeam } from "../../generated/prisma/client.js";
import { MessageFlags } from "discord.js";
import { prisma } from "../../lib/db.js";
import { formatNight } from "../../lib/pickers.js";
import { DateTime } from "luxon";
import { formatFinalRaidDate, nextOccurrence, scheduleCutoff, syncRaidTeam } from "../../lib/scheduler.js";
import { parseHourMinute, raidTime, zoneGenericName } from "../../lib/time.js";
import { requireTeam } from "./shared.js";

/**
 * A night's next raid as a timestamp, which each viewer sees in their own timezone,
 * or a note that the team's final raid date comes first.
 */
function nextRaid(team: RaidTeam, night: { dayOfWeek: number; hour: number; minute: number }): string {
  const next = nextOccurrence(night.dayOfWeek, night.hour, night.minute, team.timezone, DateTime.now());
  const cutoff = scheduleCutoff(team);
  return cutoff && next >= cutoff ? "none before the final raid date" : raidTime(next.toJSDate());
}

/** A line about the team's final raid date, if it has one. */
function finalRaidNote(team: RaidTeam): string {
  return team.finalRaidDate
    ? `\n-# Final raid date: ${formatFinalRaidDate(team)}. No raids are scheduled after it; clear it with \`/raidlead team resume\`.`
    : "";
}

/** Team time, named for a weekly night: `Central Time (America/Chicago)`. */
function teamTime(team: RaidTeam): string {
  return `${zoneGenericName(team.timezone)} (${team.timezone})`;
}

export async function add(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const day = Number(interaction.options.getString("day", true));
  const timeInput = interaction.options.getString("time", true);
  const time = parseHourMinute(timeInput);
  if (!time) {
    await interaction.reply({
      content: `"${timeInput}" isn't a valid 24-hour time. Use \`HH:MM\`, e.g. \`20:00\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await prisma.raidSlot.upsert({
    where: {
      raidTeamId_dayOfWeek_hour_minute: { raidTeamId: team.id, dayOfWeek: day, ...time },
    },
    create: { raidTeamId: team.id, dayOfWeek: day, ...time },
    update: {},
  });

  await interaction.reply({
    content:
      `✅ Added ${formatNight(day, time.hour, time.minute)} ${teamTime(team)} as a weekly raid night. ` +
      `Next: ${nextRaid(team, { dayOfWeek: day, ...time })}.${finalRaidNote(team)}`,
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

/**
 * Removes a weekly night along with its upcoming raids (and their call-outs), since
 * nothing would generate them again. Raids under way stay until they close, and
 * one-off raids at the same time stay.
 */
export async function remove(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const nightId = interaction.options.getString("night", true);
  const night = await prisma.raidSlot.findFirst({ where: { id: nightId, raidTeamId: team.id } });
  if (!night) {
    await interaction.reply({ content: "Couldn't find that raid night. Pick one from the suggestions.", flags: MessageFlags.Ephemeral });
    return;
  }

  const upcoming = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false, oneOff: false, startsAt: { gt: new Date() } },
    include: { _count: { select: { attendance: true } } },
  });
  const fromNight = upcoming.filter((raid) => {
    const local = DateTime.fromJSDate(raid.startsAt).setZone(team.timezone);
    return local.weekday === night.dayOfWeek && local.hour === night.hour && local.minute === night.minute;
  });
  const callOuts = fromNight.reduce((sum, raid) => sum + raid._count.attendance, 0);

  // Attendance rows cascade with the raids.
  await prisma.$transaction([
    prisma.raidSlot.delete({ where: { id: night.id } }),
    prisma.raidInstance.deleteMany({ where: { id: { in: fromNight.map((raid) => raid.id) } } }),
  ]);

  const removed =
    fromNight.length === 0
      ? ""
      : `, along with its ${plural(fromNight.length, "upcoming raid")}` + (callOuts > 0 ? ` and ${plural(callOuts, "call-out")}` : "");
  await interaction.reply({
    content: `🗑️ Removed ${formatNight(night.dayOfWeek, night.hour, night.minute, team.timezone)} as a weekly raid night${removed}.`,
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export async function list(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const nights = await prisma.raidSlot.findMany({
    where: { raidTeamId: team.id },
    orderBy: [{ dayOfWeek: "asc" }, { hour: "asc" }, { minute: "asc" }],
  });

  await interaction.reply({
    content:
      nights.length === 0
        ? "No weekly raid nights yet. Add one with `/raidlead nights add`."
        : nights.map((n) => `• ${formatNight(n.dayOfWeek, n.hour, n.minute)} · next ${nextRaid(team, n)}`).join("\n") +
          `\n-# Nights are in team time, ${teamTime(team)}.${finalRaidNote(team)}`,
    flags: MessageFlags.Ephemeral,
  });
}
