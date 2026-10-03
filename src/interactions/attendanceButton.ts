import type { ButtonInteraction, Client } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../lib/db.js";
import { buildCalendarMessage } from "../lib/embeds.js";
import { rosterMemberIds } from "../lib/roster.js";
import { instancesForWindow, renderTeamMessage } from "../lib/scheduler.js";

/**
 * customId shape:
 *   "attendance:<raidInstanceId>"              — clicked from the public message
 *   "attendance:<raidInstanceId>:cal:<offset>" — clicked from a personal /raid-calendar
 * Either way, clicking toggles the clicker's own status for that raid.
 */
export function isAttendanceButton(customId: string): boolean {
  return customId.startsWith("attendance:");
}

export async function handleAttendanceButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const parts = interaction.customId.split(":");
  const instanceId = parts[1];
  const isCalendar = parts[2] === "cal";
  const calendarOffset = isCalendar ? Number(parts[3]) : null;
  if (!instanceId) return;

  const instance = await prisma.raidInstance.findUnique({
    where: { id: instanceId },
    include: { raidTeam: true, attendance: { where: { userId: interaction.user.id } } },
  });

  if (!instance) {
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

  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !member.roles.cache.has(instance.raidTeam.roleId)) {
    await interaction.reply({
      content: `You're not on <@&${instance.raidTeam.roleId}>'s roster, so there's nothing to update here.`,
      ephemeral: true,
    });
    return;
  }

  const currentlyOut = instance.attendance.length > 0;
  const dateLabel = DateTime.fromJSDate(instance.startsAt).setZone(instance.raidTeam.timezone).toFormat("MMM d");

  if (currentlyOut) {
    await prisma.attendance.deleteMany({ where: { raidInstanceId: instance.id, userId: interaction.user.id } });
  } else {
    await prisma.attendance.create({
      data: { raidInstanceId: instance.id, userId: interaction.user.id, status: "OUT" },
    });
  }

  await renderTeamMessage(client, instance.raidTeamId);

  if (isCalendar && calendarOffset !== null) {
    const team = await prisma.raidTeam.findUniqueOrThrow({ where: { id: instance.raidTeamId } });
    const { instances, canEarlier, canLater } = await instancesForWindow(team.id, calendarOffset);
    const guild = await client.guilds.fetch(team.guildId);
    const rosterIds = await rosterMemberIds(guild, team.roleId);
    await interaction.update(
      buildCalendarMessage(team, instances, calendarOffset, { canEarlier, canLater }, rosterIds),
    );
    return;
  }

  await interaction.reply({
    content: currentlyOut ? `✅ Marked you as in for ${dateLabel}.` : `❌ Marked you as called out for ${dateLabel}.`,
    ephemeral: true,
  });
}
