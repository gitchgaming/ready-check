import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../lib/db.js";
import { syncRaidTeam } from "../lib/scheduler.js";

export const data = new SlashCommandBuilder()
  .setName("raid-setup")
  .setDescription("Create a raid team, or update an existing one's settings.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((opt) =>
    opt
      .setName("role")
      .setDescription("The raid team's role — identifies which team to create or update")
      .setRequired(true),
  )
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("Channel to post the schedule message in (required for first-time setup)")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName("timezone")
      .setDescription('IANA timezone, e.g. "America/New_York" (required for first-time setup)')
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt.setName("name").setDescription('Display name for this raid team, e.g. "Main Raid"').setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("raids-shown")
      .setDescription("How many upcoming raids the schedule message shows (default 3 — more wraps to extra rows)")
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  const role = interaction.options.getRole("role", true);
  const channel = interaction.options.getChannel("channel");
  const timezoneInput = interaction.options.getString("timezone");
  const name = interaction.options.getString("name");
  const raidsShown = interaction.options.getInteger("raids-shown");

  const timezone = timezoneInput?.trim();
  if (timezone && !DateTime.now().setZone(timezone).isValid) {
    await interaction.reply({
      content: `"${timezone}" isn't a recognized IANA timezone. Try something like \`America/New_York\`, \`Europe/London\`, or \`Australia/Sydney\`.`,
      ephemeral: true,
    });
    return;
  }

  const existing = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guildId, roleId: role.id } },
  });

  if (!existing && (!channel || !timezone)) {
    await interaction.reply({
      content: `<@&${role.id}> isn't set up yet — \`channel\` and \`timezone\` are required the first time.`,
      ephemeral: true,
    });
    return;
  }

  const team = await prisma.raidTeam.upsert({
    where: { guildId_roleId: { guildId: interaction.guildId, roleId: role.id } },
    create: {
      guildId: interaction.guildId,
      roleId: role.id,
      channelId: channel!.id,
      timezone: timezone!,
      name,
      ...(raidsShown ? { displayCount: raidsShown } : {}),
    },
    update: {
      ...(channel ? { channelId: channel.id } : {}),
      ...(timezone ? { timezone } : {}),
      ...(name ? { name } : {}),
      ...(raidsShown ? { displayCount: raidsShown } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Raid team **${team.name ?? role.name}** is set up.\n` +
      `• Role: <@&${role.id}>\n` +
      `• Channel: <#${team.channelId}>\n` +
      `• Timezone: ${team.timezone}\n` +
      `• Raids shown: ${team.displayCount}\n\n` +
      (existing ? "" : "Next, add raid times with `/raid-slot add`."),
    ephemeral: true,
  });

  await syncRaidTeam(client, team.id).catch((err) => {
    console.error(`Failed to sync raid team ${team.id} after setup:`, err);
  });
}
