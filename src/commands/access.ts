import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../lib/db.js";

export const data = new SlashCommandBuilder()
  .setName("access")
  .setDescription("Server owner only: set the officer role for raid management.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((opt) =>
    opt
      .setName("officer-role")
      .setDescription("Can manage raid teams and call out on behalf of other raiders")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  if (interaction.guild.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "Only the server owner can change access settings.", ephemeral: true });
    return;
  }

  const officerRole = interaction.options.getRole("officer-role", true);

  await prisma.guildConfig.upsert({
    where: { guildId: interaction.guild.id },
    create: { guildId: interaction.guild.id, officerRoleId: officerRole.id },
    update: { officerRoleId: officerRole.id },
  });

  await interaction.reply({
    content: `✅ Officer role set to <@&${officerRole.id}>.`,
    ephemeral: true,
  });
}
