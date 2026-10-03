import type { ButtonInteraction, Client } from "discord.js";
import { prisma } from "../lib/db.js";
import { refreshInstanceMessage } from "../lib/scheduler.js";

/** customId shape: "attendance:<in|out>:<raidInstanceId>" */
export function isAttendanceButton(customId: string): boolean {
  return customId.startsWith("attendance:");
}

export async function handleAttendanceButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const [, action, instanceId] = interaction.customId.split(":");
  if ((action !== "in" && action !== "out") || !instanceId) return;

  const instance = await prisma.raidInstance.findUnique({
    where: { id: instanceId },
    include: { raidTeam: true },
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

  if (action === "in") {
    // Default state is IN, so "I'm in" just clears any prior call-out.
    await prisma.attendance.deleteMany({ where: { raidInstanceId: instance.id, userId: interaction.user.id } });
  } else {
    await prisma.attendance.upsert({
      where: { raidInstanceId_userId: { raidInstanceId: instance.id, userId: interaction.user.id } },
      create: { raidInstanceId: instance.id, userId: interaction.user.id, status: "OUT" },
      update: { status: "OUT" },
    });
  }

  await refreshInstanceMessage(client, instance.id);

  await interaction.reply({
    content: action === "in" ? "✅ Marked you as in." : "❌ Marked you as called out for this raid.",
    ephemeral: true,
  });
}
