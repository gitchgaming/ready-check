import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { RaidTeam } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";

/** Looks up the team for the command's role option, replying with an error if there isn't one. */
export async function requireTeam(interaction: ChatInputCommandInteraction): Promise<RaidTeam | null> {
  const role = interaction.options.getRole("role", true);
  const team = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guildId!, roleId: role.id } },
  });
  if (!team) {
    await interaction.reply({
      content: `<@&${role.id}> isn't a raid team yet. Create it with \`/raidlead team setup\`.`,
      ephemeral: true,
    });
  }
  return team;
}

export async function deleteMessage(client: Client, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  await message?.delete().catch(() => null);
}
