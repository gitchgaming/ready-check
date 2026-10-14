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
import { formatNight, parseTypedDate, teamDisplayName } from "../../lib/pickers.js";
import {
  changeTeamTimezone,
  formatFinalRaidDate,
  renderTeamMessage,
  scheduleCutoff,
  syncRaidTeam,
} from "../../lib/scheduler.js";
import { zoneGenericName } from "../../lib/time.js";
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
  const size = interaction.options.getInteger("size");

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
      ...(size !== null ? { raidSize: size } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Created ${team.raidSize}-player raid team **${team.name}** for <@&${role.id}>, posting its schedule in <#${channel.id}>.\n` +
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
  const size = interaction.options.getInteger("size");

  if (!channel && !timezone && !name && comingUp === null && size === null) {
    await interaction.reply({ content: "Pick at least one setting to change.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (timezone && invalidTimezone(timezone)) {
    await replyBadTimezone(interaction, timezone);
    return;
  }

  const movingChannel = channel && channel.id !== team.channelId;
  if (movingChannel && team.messageId) await deleteMessage(client, team.channelId, team.messageId);

  // Raids stay put: the weekly nights are rewritten into the new zone.
  const nights = timezone && timezone !== team.timezone ? await changeTeamTimezone(team, timezone) : null;

  const updated = await prisma.raidTeam.update({
    where: { id: team.id },
    data: {
      ...(channel ? { channelId: channel.id } : {}),
      ...(movingChannel ? { messageId: null } : {}),
      ...(name ? { name } : {}),
      ...(comingUp !== null ? { displayCount: comingUp } : {}),
      ...(size !== null ? { raidSize: size } : {}),
    },
  });

  await interaction.reply({
    content:
      `✅ Updated **${teamDisplayName(updated, interaction.guild)}**.\n` +
      `• Channel: <#${updated.channelId}>\n` +
      `• Timezone: ${updated.timezone}\n` +
      `• Raid size: ${updated.raidSize}-player\n` +
      `• Coming Up raids: ${updated.displayCount}` +
      (updated.finalRaidDate ? `\n• Final raid date: ${formatFinalRaidDate(updated)}` : "") +
      (nights && nights.length > 0
        ? `\n• Weekly nights, now in ${zoneGenericName(updated.timezone)}: ` +
          nights.map((n) => formatNight(n.dayOfWeek, n.hour, n.minute)).join(", ") +
          ". The raids didn't move."
        : ""),
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

/**
 * Sets the team's last raid day. Open raids after it are removed with their
 * call-outs, and the sync schedules nothing past it; closed raids stay as history.
 */
export async function finalRaid(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const dateInput = interaction.options.getString("date", true);
  const day = parseTypedDate(dateInput, team.timezone);
  if (!day) {
    await interaction.reply({
      content: `Couldn't read "${dateInput}" as an upcoming date. Pick one from the suggestions, or type it like \`3/15/2027\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updated = { ...team, finalRaidDate: day.toFormat("yyyy-MM-dd") };
  const cutoff = scheduleCutoff(updated)!.toJSDate();
  const later = { raidTeamId: team.id, closed: false, startsAt: { gte: cutoff } };
  const [removedRaids, removedCallOuts] = await Promise.all([
    prisma.raidInstance.count({ where: later }),
    prisma.attendance.count({ where: { raidInstance: later } }),
  ]);

  await prisma.raidTeam.update({ where: { id: team.id }, data: { finalRaidDate: updated.finalRaidDate } });
  await prisma.raidInstance.deleteMany({ where: later });

  const removed =
    removedRaids === 0
      ? "There were no raids after it."
      : `Removed ${plural(removedRaids, "raid")} after it` +
        (removedCallOuts > 0 ? `, with ${plural(removedCallOuts, "call-out")}.` : ".");
  await interaction.reply({
    content:
      `🏁 **${team.name ?? "This team"}**'s final raid date is ${formatFinalRaidDate(updated)} (team time). ${removed}\n` +
      "No new raids will be scheduled after it; past raids and their attendance stay. " +
      "To schedule the weekly nights again, use `/raidlead team resume`.",
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

/** Clears the final raid date, so the weekly nights generate raids again. */
export async function resume(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  if (!team.finalRaidDate) {
    await interaction.reply({
      content: `**${team.name ?? "This team"}** has no final raid date, so its weekly nights are already scheduling raids.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await prisma.raidTeam.update({ where: { id: team.id }, data: { finalRaidDate: null } });

  await interaction.reply({
    content:
      `✅ Cleared **${team.name ?? "this team"}**'s final raid date (${formatFinalRaidDate(team)}). ` +
      "Its weekly nights are scheduling raids again; call-outs on removed raids don't come back.",
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
