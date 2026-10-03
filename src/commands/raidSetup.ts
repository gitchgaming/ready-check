import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../lib/db.js";

export const data = new SlashCommandBuilder()
  .setName("raid-setup")
  .setDescription("Create or update a raid team: the role that's required, and where to post raids.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((opt) =>
    opt.setName("role").setDescription("Role whose members are assumed required for this raid team").setRequired(true),
  )
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("Channel to post raid schedules and call-out buttons in")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("timezone")
      .setDescription('IANA timezone for this team\'s raid times, e.g. "America/New_York"')
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName("name").setDescription('Display name for this raid team, e.g. "Main Raid"').setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  const role = interaction.options.getRole("role", true);
  const channel = interaction.options.getChannel("channel", true);
  const timezone = interaction.options.getString("timezone", true).trim();
  const name = interaction.options.getString("name");

  if (!DateTime.now().setZone(timezone).isValid) {
    await interaction.reply({
      content: `"${timezone}" isn't a recognized IANA timezone. Try something like \`America/New_York\`, \`Europe/London\`, or \`Australia/Sydney\`.`,
      ephemeral: true,
    });
    return;
  }

  const team = await prisma.raidTeam.upsert({
    where: { guildId_roleId: { guildId: interaction.guildId, roleId: role.id } },
    create: {
      guildId: interaction.guildId,
      roleId: role.id,
      channelId: channel.id,
      timezone,
      name,
    },
    update: {
      channelId: channel.id,
      timezone,
      ...(name ? { name } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Raid team **${team.name ?? role.name}** is set up.\n` +
      `• Role: <@&${role.id}>\n` +
      `• Channel: <#${channel.id}>\n` +
      `• Timezone: ${timezone}\n\n` +
      "Next, add raid times with `/raid-slot add`.",
    ephemeral: true,
  });
}
