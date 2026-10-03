import type { ButtonInteraction, Client } from "discord.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

/** customId shape: "attendance:<raidInstanceId>" — clicking toggles the clicker's own status. */
export function isAttendanceButton(customId: string): boolean {
  return customId.startsWith("attendance:");
}

export async function handleAttendanceButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const [, instanceId] = interaction.customId.split(":");
  if (!instanceId) return;

  const instance = await prisma.raidInstance.findUnique({
    where: { id: instanceId },
    include: { raidTeam: true, attendance: { where: { userId: interaction.user.id } } },
  });

  if (!instance) {
    await interaction.reply({ content: "This raid no longer exists.", ephemeral: true });
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
  const dateLabel = instance.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (currentlyOut) {
    await prisma.attendance.deleteMany({ where: { raidInstanceId: instance.id, userId: interaction.user.id } });
  } else {
    await prisma.attendance.create({
      data: { raidInstanceId: instance.id, userId: interaction.user.id, status: "OUT" },
    });
  }

  await renderTeamMessage(client, instance.raidTeamId);

  await interaction.reply({
    content: currentlyOut ? `✅ Marked you as in for ${dateLabel}.` : `❌ Marked you as called out for ${dateLabel}.`,
    ephemeral: true,
  });
}
