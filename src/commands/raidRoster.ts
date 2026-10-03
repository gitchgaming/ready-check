import { SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { assertCanManage } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { buildRosterEmbed, fetchRosterNames } from "../lib/roster.js";

export const data = new SlashCommandBuilder()
  .setName("raid-roster")
  .setDescription("Officers: post an auto-updating roster for a raid team in this channel.")
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

  if (team.rosterChannelId && team.rosterMessageId) {
    const previousChannel = await client.channels.fetch(team.rosterChannelId).catch(() => null);
    if (previousChannel?.isTextBased()) {
      const previous = await previousChannel.messages.fetch(team.rosterMessageId).catch(() => null);
      await previous?.delete().catch(() => null);
    }
  }

  const names = await fetchRosterNames(interaction.guild, role.id);
  const embed = buildRosterEmbed(team.name ?? role.name, names);
  const message = await channel.send({ embeds: [embed] });

  await prisma.raidTeam.update({
    where: { id: team.id },
    data: { rosterChannelId: channel.id, rosterMessageId: message.id },
  });

  await interaction.reply({
    content: `✅ Roster will now stay up to date in <#${channel.id}>.`,
    ephemeral: true,
  });
}
