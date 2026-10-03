import { SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { assertCanManage } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

export const data = new SlashCommandBuilder()
  .setName("raid-publish")
  .setDescription("Officers: repost a raid team's schedule message in this channel.")
  .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  if (!(await assertCanManage(interaction))) return;

  const role = interaction.options.getRole("role", true);
  const team = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guild.id, roleId: role.id } },
  });

  if (!team) {
    await interaction.reply({
      content: `<@&${role.id}> isn't set up as a raid team yet. Run \`/raid-setup\` first.`,
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: "Run this in a text channel.", ephemeral: true });
    return;
  }

  if (team.messageId) {
    const previousChannel = await client.channels.fetch(team.channelId).catch(() => null);
    if (previousChannel?.isTextBased()) {
      const previous = await previousChannel.messages.fetch(team.messageId).catch(() => null);
      await previous?.delete().catch(() => null);
    }
  }

  await prisma.raidTeam.update({
    where: { id: team.id },
    data: { channelId: channel.id, messageId: null },
  });

  await renderTeamMessage(client, team.id);

  await interaction.reply({
    content: `✅ Schedule published in <#${channel.id}>.`,
    ephemeral: true,
  });
}
