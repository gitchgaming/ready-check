import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  MessageFlags,
} from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import type { RaidTeam } from "../../generated/prisma/client.js";
import { formatNight, parseTypedDate, teamDisplayName } from "../../lib/pickers.js";
import {
  changeTeamTimezone,
  formatFinalRaidDate,
  renderTeamMessage,
  scheduleCutoff,
  syncRaidTeam,
} from "../../lib/scheduler.js";
import { zoneGenericName } from "../../lib/time.js";
import { nextRaid, teamTime } from "./nights.js";
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

/** The `final-raid:` choice that clears the final raid date. */
export const NO_FINAL_RAID = "clear";

export async function setup(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const role = interaction.options.getRole("role", true);
  const channel = interaction.options.getChannel("channel") ?? (interaction.channel?.isTextBased() ? interaction.channel : null);
  const timezone = interaction.options.getString("timezone", true).trim();
  const name = interaction.options.getString("name");
  const comingUp = interaction.options.getInteger("coming-up");
  const size = interaction.options.getInteger("size");

  if (!channel) {
    await interaction.reply({ content: "Pick a `channel:` for the schedule, or run this in one.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (invalidTimezone(timezone)) {
    await replyBadTimezone(interaction, timezone);
    return;
  }

  const existing = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guildId!, roleId: role.id } },
  });
  if (existing) {
    await interaction.reply({
      content: `<@&${role.id}> is already a raid team. Change its settings with \`/raidlead team settings\`.`,
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

/** Everything about a team at a glance: its settings, then its weekly nights. */
async function overview(team: RaidTeam, guild: Guild | null): Promise<string> {
  const nights = await prisma.raidSlot.findMany({
    where: { raidTeamId: team.id },
    orderBy: [{ dayOfWeek: "asc" }, { hour: "asc" }, { minute: "asc" }],
  });
  const nightLines =
    nights.length === 0
      ? ["• None yet. Add one with `/raidlead nights add`."]
      : nights.map((n) => `• ${formatNight(n.dayOfWeek, n.hour, n.minute)} · next ${nextRaid(team, n)}`);
  return [
    `**${teamDisplayName(team, guild)}** · <@&${team.roleId}>`,
    `• Schedule: <#${team.channelId}>`,
    `• Timezone: ${teamTime(team)}`,
    `• Raid size: ${team.raidSize}-player`,
    `• Coming Up raids: ${team.displayCount}`,
    `• Final raid date: ${team.finalRaidDate ? `${formatFinalRaidDate(team)}; no raids are scheduled after it` : "none"}`,
    "**Weekly nights**, in team time",
    ...nightLines,
  ].join("\n");
}

/**
 * Shows the team's settings and weekly nights; with options, changes them first.
 * A new timezone rewrites the nights so no raid moves. `final-raid:` sets the last
 * raid day (later open raids go, with their call-outs) or, as `NO_FINAL_RAID`,
 * clears it so the weekly nights schedule raids again.
 */
export async function settings(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const timezone = interaction.options.getString("timezone")?.trim() || null;
  const name = interaction.options.getString("name")?.trim() || null;
  const comingUp = interaction.options.getInteger("coming-up");
  const size = interaction.options.getInteger("size");
  const finalInput = interaction.options.getString("final-raid")?.trim() || null;

  if (timezone && invalidTimezone(timezone)) {
    await replyBadTimezone(interaction, timezone);
    return;
  }
  const finalDay = finalInput && finalInput !== NO_FINAL_RAID ? parseTypedDate(finalInput, timezone ?? team.timezone) : null;
  if (finalInput && finalInput !== NO_FINAL_RAID && !finalDay) {
    await interaction.reply({
      content: `Couldn't read "${finalInput}" as an upcoming date. Pick one from the suggestions, or type it like \`3/15/2027\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const notes: string[] = [];
  if (timezone && timezone !== team.timezone) {
    // Raids stay put: the weekly nights are rewritten into the new zone.
    const nights = await changeTeamTimezone(team, timezone);
    if (nights.length > 0) notes.push(`The weekly nights are now in ${zoneGenericName(timezone)}, and no raid moved.`);
  }
  if (name !== null || comingUp !== null || size !== null) {
    await prisma.raidTeam.update({
      where: { id: team.id },
      data: {
        ...(name !== null ? { name } : {}),
        ...(comingUp !== null ? { displayCount: comingUp } : {}),
        ...(size !== null ? { raidSize: size } : {}),
      },
    });
  }
  if (finalInput === NO_FINAL_RAID) {
    notes.push(await clearFinalRaid(team.id));
  } else if (finalDay) {
    notes.push(await setFinalRaid(team.id, finalDay.toFormat("yyyy-MM-dd")));
  }

  const changed = timezone !== null || name !== null || comingUp !== null || size !== null || finalInput !== null;
  const updated = await prisma.raidTeam.findUniqueOrThrow({ where: { id: team.id } });
  await interaction.reply({
    content: (changed ? ["✅ Saved.", ...notes].join(" ") + "\n\n" : "") + (await overview(updated, interaction.guild)),
    flags: MessageFlags.Ephemeral,
  });

  if (changed) await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

/**
 * Sets the team's last raid day. Open raids after it are removed with their
 * call-outs, and the sync schedules nothing past it; closed raids stay as history.
 */
async function setFinalRaid(teamId: string, finalRaidDate: string): Promise<string> {
  const team = await prisma.raidTeam.update({ where: { id: teamId }, data: { finalRaidDate } });
  const later = { raidTeamId: team.id, closed: false, startsAt: { gte: scheduleCutoff(team)!.toJSDate() } };
  const [removedRaids, removedCallOuts] = await Promise.all([
    prisma.raidInstance.count({ where: later }),
    prisma.attendance.count({ where: { raidInstance: later } }),
  ]);
  await prisma.raidInstance.deleteMany({ where: later });
  const removed =
    removedRaids === 0
      ? ""
      : ` Removed ${plural(removedRaids, "raid")} after it` +
        (removedCallOuts > 0 ? `, with ${plural(removedCallOuts, "call-out")}.` : ".");
  return `🏁 The final raid date is ${formatFinalRaidDate(team)} (team time).${removed} Past raids and their attendance stay.`;
}

/** Clears the final raid date, so the weekly nights generate raids again. */
async function clearFinalRaid(teamId: string): Promise<string> {
  const team = await prisma.raidTeam.findUniqueOrThrow({ where: { id: teamId } });
  if (!team.finalRaidDate) return "There was no final raid date to clear.";
  await prisma.raidTeam.update({ where: { id: teamId }, data: { finalRaidDate: null } });
  return "Cleared the final raid date, so the weekly nights schedule raids again; call-outs on removed raids don't come back.";
}

/** Posts the team's schedule message in a channel (this one by default), removing the old one. */
export async function post(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const channel = interaction.options.getChannel("channel") ?? (interaction.channel?.isTextBased() ? interaction.channel : null);
  if (!channel) {
    await interaction.reply({ content: "Pick a `channel:`, or run this in a text channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (team.messageId) await deleteMessage(client, team.channelId, team.messageId);
  await prisma.raidTeam.update({ where: { id: team.id }, data: { channelId: channel.id, messageId: null } });
  await renderTeamMessage(client, team.id);

  await interaction.reply({ content: `✅ Schedule posted in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
