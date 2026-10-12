import type { ButtonInteraction, Client, StringSelectMenuInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { prisma } from "../lib/db.js";
import { isOfficer } from "../lib/access.js";
import { MORE_DATES_VALUE, ROSTER_VALUE_PREFIX, asEphemeral, buildRaidRosterCard } from "../lib/embeds.js";
import { attendanceView } from "../lib/attendance.js";
import { formatRaidLabel, teamDisplayName } from "../lib/pickers.js";
import { fetchRosterMembers } from "../lib/roster.js";
import { personalCalendar, renderTeamMessage } from "../lib/scheduler.js";

type AttendanceInteraction = ButtonInteraction | StringSelectMenuInteraction;

/**
 * customId shape:
 *   "attendance:btn:<raidTeamId>:<raidInstanceId>" — a date button on the public message
 *   "attendance:pub:<raidTeamId>"                  — the "See more dates" select on the public message
 *   "attendance:cal:<raidTeamId>:<offset>"         — the date select on a personal schedule
 *   "attendance:ros:<raidTeamId>:<raidInstanceId>" — a Roster button on a personal schedule
 *   "attendance:in:<raidTeamId>:<raidInstanceId>"  — a Back in button on /attendance
 * A date button or a picked raid id toggles the user's own call-out;
 * MORE_DATES_VALUE opens the personal schedule; "roster:<raidInstanceId>" and a
 * Roster button privately show that raid's roster card, as /roster with a date does.
 * Back in only ever switches the user back in, so a stale view can't call them out.
 */
export function isAttendanceControl(customId: string): boolean {
  return customId.startsWith("attendance:");
}

export async function handleAttendanceControl(interaction: AttendanceInteraction, client: Client): Promise<void> {
  const [, source, teamId, extra] = interaction.customId.split(":");
  if (!teamId || !interaction.guild) return;
  if (source === "ros") {
    if (extra) await showRoster(interaction, teamId, extra);
    return;
  }
  if (source === "in") {
    if (extra) await backIn(interaction, client, teamId, extra);
    return;
  }
  if (source !== "btn" && source !== "pub" && source !== "cal") return;

  const value = interaction.isStringSelectMenu() ? interaction.values[0] : extra;
  if (!value) return;

  try {
    await applySelection(interaction, client, source, teamId, Number(extra) || 0, value);
  } finally {
    // Refreshes the public counts, and clears its select so "See more dates"
    // can be picked again.
    if (source !== "cal") await renderTeamMessage(client, teamId);
  }
}

async function applySelection(
  interaction: AttendanceInteraction,
  client: Client,
  source: "btn" | "pub" | "cal",
  teamId: string,
  offset: number,
  value: string,
): Promise<void> {
  const guild = interaction.guild!;

  if (value === MORE_DATES_VALUE) {
    const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
    if (!team) return;
    await interaction.reply(asEphemeral(await personalCalendar(team, guild, 0, interaction.user.id)));
    return;
  }

  if (value.startsWith(ROSTER_VALUE_PREFIX)) {
    await showRoster(interaction, teamId, value.slice(ROSTER_VALUE_PREFIX.length));
    return;
  }

  const instance = await prisma.raidInstance.findUnique({
    where: { id: value },
    include: { raidTeam: true, attendance: { where: { userId: interaction.user.id } } },
  });

  if (!instance || instance.raidTeamId !== teamId) {
    await interaction.reply({ content: "This raid no longer exists.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (instance.cancelled) {
    await interaction.reply({ content: "This raid has been cancelled.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (instance.closed) {
    await interaction.reply({ content: "This raid has already started or passed.", flags: MessageFlags.Ephemeral });
    return;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !member.roles.cache.has(instance.raidTeam.roleId)) {
    await interaction.reply({
      content: `You're not on <@&${instance.raidTeam.roleId}>'s roster, so there's nothing to update here.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentlyOut = instance.attendance.length > 0;
  if (currentlyOut) {
    await prisma.attendance.deleteMany({ where: { raidInstanceId: instance.id, userId: interaction.user.id } });
  } else {
    await prisma.attendance.create({
      data: { raidInstanceId: instance.id, userId: interaction.user.id, status: "OUT" },
    });
  }

  // The same words as /attendance's confirmation, with how to undo it.
  const dateLabel = formatRaidLabel(instance.startsAt, instance.raidTeam.timezone);
  const confirmation = currentlyOut ? `✅ You're back in for **${dateLabel}**.` : `❌ You're out for **${dateLabel}**.`;

  if (source === "cal") {
    const notice = `${confirmation} Pick it again to undo.`;
    await interaction.update(await personalCalendar(instance.raidTeam, guild, offset, interaction.user.id, notice));
    await renderTeamMessage(client, instance.raidTeamId);
    return;
  }

  await interaction.reply({
    content: currentlyOut ? confirmation : `${confirmation} Click **Status** again to undo.`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Switches the user back in for one raid from /attendance and redraws the view in place. */
async function backIn(interaction: AttendanceInteraction, client: Client, teamId: string, raidId: string): Promise<void> {
  const guild = interaction.guild!;
  const raid = await prisma.raidInstance.findUnique({ where: { id: raidId }, include: { raidTeam: true } });
  if (!raid || raid.raidTeamId !== teamId) {
    await interaction.update(await attendanceView(guild, interaction.user.id, "This raid no longer exists."));
    return;
  }
  const dateLabel = formatRaidLabel(raid.startsAt, raid.raidTeam.timezone);
  if (raid.closed || raid.cancelled) {
    const why = raid.closed ? "has already started or passed" : "has been cancelled";
    await interaction.update(await attendanceView(guild, interaction.user.id, `**${dateLabel}** ${why}.`));
    return;
  }

  const { count } = await prisma.attendance.deleteMany({ where: { raidInstanceId: raid.id, userId: interaction.user.id } });
  await interaction.update(await attendanceView(guild, interaction.user.id, `✅ You're back in for **${dateLabel}**.`));
  if (count > 0) await renderTeamMessage(client, teamId);
}

/** One raid's roster card, privately. Like /roster, only for the team's raiders and officers. */
async function showRoster(interaction: AttendanceInteraction, teamId: string, raidId: string): Promise<void> {
  const guild = interaction.guild!;
  const raid = await prisma.raidInstance.findUnique({
    where: { id: raidId },
    include: { raidTeam: true, attendance: true },
  });
  if (!raid || raid.raidTeamId !== teamId) {
    await interaction.reply({ content: "This raid no longer exists.", flags: MessageFlags.Ephemeral });
    return;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isOfficer(interaction) && !member?.roles.cache.has(raid.raidTeam.roleId)) {
    await interaction.reply({
      content: `Only <@&${raid.raidTeam.roleId}> and officers can see this roster.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const members = await fetchRosterMembers(guild, raid.raidTeam.roleId);
  await interaction.reply(asEphemeral(buildRaidRosterCard(raid.raidTeam, teamDisplayName(raid.raidTeam, guild), raid, members)));
}
