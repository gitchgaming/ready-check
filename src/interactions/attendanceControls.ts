import type { ButtonInteraction, Client, StringSelectMenuInteraction } from "discord.js";
import { prisma } from "../lib/db.js";
import { MORE_DATES_VALUE, asEphemeral } from "../lib/embeds.js";
import { formatRaidLabel } from "../lib/pickers.js";
import { personalCalendar, renderTeamMessage } from "../lib/scheduler.js";

type AttendanceInteraction = ButtonInteraction | StringSelectMenuInteraction;

/**
 * customId shape:
 *   "attendance:btn:<raidTeamId>:<raidInstanceId>" — a date button on the public message
 *   "attendance:pub:<raidTeamId>"                  — the "See more dates" select on the public message
 *   "attendance:cal:<raidTeamId>:<offset>"         — the date select on a personal schedule
 * A date button or a picked raid id toggles the user's own call-out;
 * MORE_DATES_VALUE opens the personal schedule.
 */
export function isAttendanceControl(customId: string): boolean {
  return customId.startsWith("attendance:");
}

export async function handleAttendanceControl(interaction: AttendanceInteraction, client: Client): Promise<void> {
  const [, source, teamId, extra] = interaction.customId.split(":");
  if ((source !== "btn" && source !== "pub" && source !== "cal") || !teamId || !interaction.guild) return;

  const value = interaction.isStringSelectMenu() ? interaction.values[0] : extra;
  if (!value) return;

  try {
    await applySelection(interaction, client, source, teamId, Number(extra) || 0, value);
  } finally {
    // Refreshes the public counts, and clears its select so "See more dates"
    // can be picked again.
    if (source !== "cal") await renderTeamMessage(client, teamId);
  }
}

async function applySelection(
  interaction: AttendanceInteraction,
  client: Client,
  source: "btn" | "pub" | "cal",
  teamId: string,
  offset: number,
  value: string,
): Promise<void> {
  const guild = interaction.guild!;

  if (value === MORE_DATES_VALUE) {
    const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
    if (!team) return;
    await interaction.reply(asEphemeral(await personalCalendar(team, guild, 0, interaction.user.id)));
    return;
  }

  const instance = await prisma.raidInstance.findUnique({
    where: { id: value },
    include: { raidTeam: true, attendance: { where: { userId: interaction.user.id } } },
  });

  if (!instance || instance.raidTeamId !== teamId) {
    await interaction.reply({ content: "This raid no longer exists.", ephemeral: true });
    return;
  }

  if (instance.cancelled) {
    await interaction.reply({ content: "This raid has been cancelled.", ephemeral: true });
    return;
  }

  if (instance.closed) {
    await interaction.reply({ content: "This raid has already started or passed.", ephemeral: true });
    return;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !member.roles.cache.has(instance.raidTeam.roleId)) {
    await interaction.reply({
      content: `You're not on <@&${instance.raidTeam.roleId}>'s roster, so there's nothing to update here.`,
      ephemeral: true,
    });
    return;
  }

  const currentlyOut = instance.attendance.length > 0;
  if (currentlyOut) {
    await prisma.attendance.deleteMany({ where: { raidInstanceId: instance.id, userId: interaction.user.id } });
  } else {
    await prisma.attendance.create({
      data: { raidInstanceId: instance.id, userId: interaction.user.id, status: "OUT" },
    });
  }

  if (source === "cal") {
    await interaction.update(await personalCalendar(instance.raidTeam, guild, offset, interaction.user.id));
    await renderTeamMessage(client, instance.raidTeamId);
    return;
  }

  const dateLabel = formatRaidLabel(instance.startsAt, instance.raidTeam.timezone);
  await interaction.reply({
    content: currentlyOut ? `✅ Marked you as in for ${dateLabel}.` : `❌ Marked you as called out for ${dateLabel}.`,
    ephemeral: true,
  });
}
