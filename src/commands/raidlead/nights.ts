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
export function nextRaid(team: RaidTeam, night: { dayOfWeek: number; hour: number; minute: number }): string {
  const next = nextOccurrence(night.dayOfWeek, night.hour, night.minute, team.timezone, DateTime.now());
  const cutoff = scheduleCutoff(team);
  return cutoff && next >= cutoff ? "none before the final raid date" : raidTime(next.toJSDate());
}

/** A line about the team's final raid date, if it has one. */
function finalRaidNote(team: RaidTeam): string {
  return team.finalRaidDate
    ? `\n-# Final raid date: ${formatFinalRaidDate(team)}. No raids are scheduled after it; clear it with \`/raidlead team settings final-raid:\`.`
    : "";
}

/** Team time, named for a weekly night: `Central Time (America/Chicago)`. */
export function teamTime(team: RaidTeam): string {
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

/**
 * Moves a weekly night to a new time on the same day, and its upcoming raids with it,
 * keeping their call-outs. A raid whose new time has already passed, or lands on
 * another raid, is removed instead. Moving a night to another day is a remove and
 * an add, since call-outs for one day don't carry to another.
 */
export async function edit(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const nightId = interaction.options.getString("night", true);
  const night = await prisma.raidSlot.findFirst({ where: { id: nightId, raidTeamId: team.id } });
  if (!night) {
    await interaction.reply({ content: "Couldn't find that raid night. Pick one from the suggestions.", flags: MessageFlags.Ephemeral });
    return;
  }

  const timeInput = interaction.options.getString("time", true);
  const time = parseHourMinute(timeInput);
  if (!time) {
    await interaction.reply({
      content: `"${timeInput}" isn't a valid 24-hour time. Use \`HH:MM\`, e.g. \`20:00\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const moved = { dayOfWeek: night.dayOfWeek, ...time };
  const before = formatNight(night.dayOfWeek, night.hour, night.minute);
  const after = formatNight(moved.dayOfWeek, moved.hour, moved.minute);
  if (before === after) {
    await interaction.reply({ content: `${before} is already this night's time.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const clash = await prisma.raidSlot.findUnique({ where: { raidTeamId_dayOfWeek_hour_minute: { raidTeamId: team.id, ...moved } } });
  if (clash) {
    await interaction.reply({
      content: `${after} is already a weekly raid night. Remove this one with \`/raidlead nights remove\` instead.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const now = DateTime.now();
  const open = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false },
    include: { _count: { select: { attendance: true } } },
  });
  const taken = new Set(open.map((raid) => raid.startsAt.getTime()));
  const moves: { id: string; startsAt: Date }[] = [];
  const dropped: string[] = [];
  let droppedCallOuts = 0;
  for (const raid of open) {
    const local = DateTime.fromJSDate(raid.startsAt).setZone(team.timezone);
    const fromNight = local.weekday === night.dayOfWeek && local.hour === night.hour && local.minute === night.minute;
    if (raid.oneOff || !fromNight || local <= now) continue;
    const target = local.set(time);
    if (target <= now || taken.has(target.toMillis())) {
      dropped.push(raid.id);
      droppedCallOuts += raid._count.attendance;
      continue;
    }
    taken.delete(raid.startsAt.getTime());
    taken.add(target.toMillis());
    moves.push({ id: raid.id, startsAt: target.toJSDate() });
  }

  await prisma.$transaction([
    prisma.raidSlot.update({ where: { id: night.id }, data: moved }),
    prisma.raidInstance.deleteMany({ where: { id: { in: dropped } } }),
    ...moves.map((m) => prisma.raidInstance.update({ where: { id: m.id }, data: { startsAt: m.startsAt } })),
  ]);

  const raids =
    moves.length === 0
      ? ""
      : ` Its ${plural(moves.length, "upcoming raid")} moved with it, keeping their call-outs.`;
  const removed =
    dropped.length === 0
      ? ""
      : ` Removed ${plural(dropped.length, "raid")} whose new time has passed` +
        (droppedCallOuts > 0 ? `, with ${plural(droppedCallOuts, "call-out")}.` : ".");
  await interaction.reply({
    content:
      `✅ Moved ${before} to ${after} ${zoneGenericName(team.timezone)}.${raids}${removed} ` +
      `Next: ${nextRaid(team, moved)}.${finalRaidNote(team)}`,
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
