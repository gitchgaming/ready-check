import type { ChatInputCommandInteraction, Client } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { buildRosterEmbed, fetchRosterNames } from "../../lib/roster.js";
import { renderTeamMessage, syncRaidTeam } from "../../lib/scheduler.js";
import { deleteMessage, requireTeam } from "./shared.js";

function invalidTimezone(timezone: string): boolean {
  return !DateTime.now().setZone(timezone).isValid;
}

async function replyBadTimezone(interaction: ChatInputCommandInteraction, timezone: string) {
  await interaction.reply({
    content: `"${timezone}" isn't a recognized timezone. Pick one from the suggestions as you type.`,
    ephemeral: true,
  });
}

export async function setup(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const role = interaction.options.getRole("role", true);
  const channel = interaction.options.getChannel("channel", true);
  const timezone = interaction.options.getString("timezone", true).trim();
  const name = interaction.options.getString("name");
  const raidsShown = interaction.options.getInteger("raids-shown");

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
      ephemeral: true,
    });
    return;
  }

  const team = await prisma.raidTeam.create({
    data: {
      guildId: interaction.guildId!,
      roleId: role.id,
      channelId: channel.id,
      timezone,
      name,
      ...(raidsShown ? { displayCount: raidsShown } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Created raid team **${team.name ?? role.name}** for <@&${role.id}>, posting in <#${channel.id}>.\n` +
      "Next, add its weekly raid times with `/raidlead nights add`.",
    ephemeral: true,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

export async function edit(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const channel = interaction.options.getChannel("channel");
  const timezone = interaction.options.getString("timezone")?.trim();
  const name = interaction.options.getString("name");
  const raidsShown = interaction.options.getInteger("raids-shown");

  if (!channel && !timezone && !name && !raidsShown) {
    await interaction.reply({ content: "Pick at least one setting to change.", ephemeral: true });
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
      ...(raidsShown ? { displayCount: raidsShown } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Updated **${updated.name ?? interaction.options.getRole("role", true).name}**.\n` +
      `• Channel: <#${updated.channelId}>\n` +
      `• Timezone: ${updated.timezone}\n` +
      `• Raids shown: ${updated.displayCount}`,
    ephemeral: true,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

export async function publish(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const channel = interaction.channel;
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: "Run this in a text channel.", ephemeral: true });
    return;
  }

  if (team.messageId) await deleteMessage(client, team.channelId, team.messageId);
  await prisma.raidTeam.update({ where: { id: team.id }, data: { channelId: channel.id, messageId: null } });
  await renderTeamMessage(client, team.id);

  await interaction.reply({ content: `✅ Schedule posted in <#${channel.id}>.`, ephemeral: true });
}

export async function roster(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const channel = interaction.channel;
  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.reply({ content: "Run this in a text channel.", ephemeral: true });
    return;
  }

  if (team.rosterChannelId && team.rosterMessageId) {
    await deleteMessage(client, team.rosterChannelId, team.rosterMessageId);
  }

  const role = interaction.options.getRole("role", true);
  const names = await fetchRosterNames(interaction.guild!, role.id);
  const message = await channel.send({ embeds: [buildRosterEmbed(team.name ?? role.name, names)] });

  await prisma.raidTeam.update({
    where: { id: team.id },
    data: { rosterChannelId: channel.id, rosterMessageId: message.id },
  });

  await interaction.reply({ content: `✅ Roster posted in <#${channel.id}> and will stay up to date.`, ephemeral: true });
}
