import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { renderTeamMessage, syncRaidTeam } from "../../lib/scheduler.js";
import { deleteMessage, requireTeam } from "./shared.js";

function invalidTimezone(timezone: string): boolean {
  return !DateTime.now().setZone(timezone).isValid;
}

async function replyBadTimezone(interaction: ChatInputCommandInteraction, timezone: string) {
  await interaction.reply({
    content: `"${timezone}" isn't a recognized timezone. Pick one from the suggestions as you type.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function setup(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const role = interaction.options.getRole("role", true);
  const channel = interaction.options.getChannel("channel", true);
  const timezone = interaction.options.getString("timezone", true).trim();
  const name = interaction.options.getString("name");
  const comingUp = interaction.options.getInteger("coming-up");

  if (invalidTimezone(timezone)) {
    await replyBadTimezone(interaction, timezone);
    return;
  }

  const existing = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guildId!, roleId: role.id } },
  });
  if (existing) {
    await interaction.reply({
      content: `<@&${role.id}> is already a raid team. Change its settings with \`/raidlead team edit\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const team = await prisma.raidTeam.create({
    data: {
      guildId: interaction.guildId!,
      roleId: role.id,
      channelId: channel.id,
      timezone,
      name: name ?? role.name,
      ...(comingUp !== null ? { displayCount: comingUp } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Created raid team **${team.name}** for <@&${role.id}>, posting its schedule in <#${channel.id}>.\n` +
      "Next, add its weekly raid nights with `/raidlead nights add`.",
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

export async function edit(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const channel = interaction.options.getChannel("channel");
  const timezone = interaction.options.getString("timezone")?.trim();
  const name = interaction.options.getString("name");
  const comingUp = interaction.options.getInteger("coming-up");

  if (!channel && !timezone && !name && comingUp === null) {
    await interaction.reply({ content: "Pick at least one setting to change.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (timezone && invalidTimezone(timezone)) {
    await replyBadTimezone(interaction, timezone);
    return;
  }

  const movingChannel = channel && channel.id !== team.channelId;
  if (movingChannel && team.messageId) await deleteMessage(client, team.channelId, team.messageId);

  const updated = await prisma.raidTeam.update({
    where: { id: team.id },
    data: {
      ...(channel ? { channelId: channel.id } : {}),
      ...(movingChannel ? { messageId: null } : {}),
      ...(timezone ? { timezone } : {}),
      ...(name ? { name } : {}),
      ...(comingUp !== null ? { displayCount: comingUp } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Updated **${updated.name ?? interaction.options.getRole("role", true).name}**.\n` +
      `• Channel: <#${updated.channelId}>\n` +
      `• Timezone: ${updated.timezone}\n` +
      `• Coming Up raids: ${updated.displayCount}`,
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

export async function remove(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  await interaction.reply({
    content:
      `Delete **${team.name ?? "this team"}**? This permanently removes its weekly nights, raids, and ` +
      "call-outs, and deletes its schedule message. The Discord role is not affected.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`teamdelete:confirm:${team.id}`).setLabel("Delete team").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`teamdelete:abort:${team.id}`).setLabel("Keep team").setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function publish(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const channel = interaction.channel;
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: "Run this in a text channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (team.messageId) await deleteMessage(client, team.channelId, team.messageId);
  await prisma.raidTeam.update({ where: { id: team.id }, data: { channelId: channel.id, messageId: null } });
  await renderTeamMessage(client, team.id);

  await interaction.reply({ content: `✅ Schedule posted in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
}
