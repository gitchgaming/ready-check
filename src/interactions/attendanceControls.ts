import type { ButtonInteraction, Client, StringSelectMenuInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { prisma } from "../lib/db.js";
import { isOfficer } from "../lib/access.js";
import {
  MORE_DATES_VALUE,
  ROSTER_VALUE_PREFIX,
  asEphemeral,
  buildHowItWorksMessage,
  buildNoticeMessage,
  buildRaidRosterCard,
  confirmation,
  timezoneTip,
  type Notice,
  type UndoView,
} from "../lib/embeds.js";
import { attendanceView, setOut } from "../lib/attendance.js";
import { teamDisplayName } from "../lib/pickers.js";
import { raidTime } from "../lib/time.js";
import { userTimezone } from "../lib/userSettings.js";
import { fetchRosterMembers } from "../lib/roster.js";
import { personalCalendar, renderTeamMessage } from "../lib/scheduler.js";

type AttendanceInteraction = ButtonInteraction | StringSelectMenuInteraction;

/**
 * customId shape:
 *   "attendance:btn:<raidTeamId>:<raidInstanceId>" — a date button on the public message
 *   "attendance:pub:<raidTeamId>"                  — the "See more dates" select on the public message
 *   "attendance:help:<raidTeamId>"                 — Next Up's "How it works" select (the /howitworks guide)
 *   "attendance:cal:<raidTeamId>:<offset>"         — the date select on a personal schedule
 *   "attendance:ros:<raidTeamId>:<raidInstanceId>" — a Roster button on a personal schedule
 *   "attendance:in:<raidTeamId>:<raidInstanceId>[:t]" — a Back in button on /attendance
 *                                                  (":t" when it showed only that team)
 *   "attendance:undo:<raidTeamId>:<raidInstanceId>:<in|out>:<view>"
 *                                                  — the Undo button on a confirmation
 * A date button or a picked raid id toggles the user's own call-out;
 * MORE_DATES_VALUE opens the personal schedule; "roster:<raidInstanceId>" and a
 * Roster button privately show that raid's roster card, as /roster with a date does.
 * Back in only ever switches the user back in, so a stale view can't call them out.
 * Undo sets the user to the state it names (never toggles) and redraws where it
 * was clicked: the Status reply ("s"), /attendance ("a", or "t" for one team) or /schedule ("c<offset>").
 */
export function isAttendanceControl(customId: string): boolean {
  return customId.startsWith("attendance:");
}

export async function handleAttendanceControl(interaction: AttendanceInteraction, client: Client): Promise<void> {
  const [, source, teamId, extra] = interaction.customId.split(":");
  if (!teamId || !interaction.guild) return;
  if (source === "help") {
    try {
      await interaction.reply(asEphemeral(buildHowItWorksMessage()));
    } finally {
      await renderTeamMessage(client, teamId); // clears the select so it can be picked again
    }
    return;
  }
  if (source === "ros") {
    if (extra) await showRoster(interaction, teamId, extra);
    return;
  }
  if (source === "in") {
    if (extra) await backIn(interaction, client, teamId, extra, interaction.customId.split(":")[4] === "t");
    return;
  }
  if (source === "undo") {
    const [, , , , target, view] = interaction.customId.split(":");
    if (extra && (target === "in" || target === "out") && view && /^(s|a|t|c-?\d+)$/.test(view)) {
      await undo(interaction, client, teamId, extra, target === "out", view as UndoView);
    }
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

  // The public select no longer offers rosters, but a post drawn before that change
  // still can until it's next re-rendered.
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

  const nowOut = instance.attendance.length === 0;
  await setOut(instance.id, interaction.user.id, nowOut);

  if (source === "cal") {
    const notice = confirmation(nowOut, instance.startsAt, teamId, instance.id, `c${offset}`);
    await interaction.update(await personalCalendar(instance.raidTeam, guild, offset, interaction.user.id, notice));
    await renderTeamMessage(client, instance.raidTeamId);
    return;
  }

  const tip = await statusReplyTip(interaction.user.id, instance.raidTeam.timezone);
  await interaction.reply(asEphemeral(buildNoticeMessage(confirmation(nowOut, instance.startsAt, teamId, instance.id, "s"), tip)));
}

/** The /timezone pointer under a Status reply, only for raiders who haven't set a zone. */
async function statusReplyTip(userId: string, teamZone: string): Promise<string | undefined> {
  return (await userTimezone(userId)) ? undefined : timezoneTip(teamZone);
}

/**
 * The Undo button on a confirmation: sets the user's attendance for one raid to
 * `out`, then redraws the view it sits on with a fresh confirmation (whose Undo
 * switches back again).
 */
async function undo(
  interaction: AttendanceInteraction,
  client: Client,
  teamId: string,
  raidId: string,
  out: boolean,
  view: UndoView,
): Promise<void> {
  const guild = interaction.guild!;
  const userId = interaction.user.id;
  const raid = await prisma.raidInstance.findUnique({ where: { id: raidId }, include: { raidTeam: true } });

  const redraw = async (notice: Notice) => {
    if (view === "s") {
      const tip = raid && typeof notice !== "string" ? await statusReplyTip(userId, raid.raidTeam.timezone) : undefined;
      await interaction.update(buildNoticeMessage(notice, tip));
    }
    else if (view === "a" || view === "t") {
      await interaction.update(await attendanceView(guild, userId, notice, view === "t" ? teamId : undefined));
    }
    else if (raid) await interaction.update(await personalCalendar(raid.raidTeam, guild, Number(view.slice(1)) || 0, userId, notice));
  };

  if (!raid || raid.raidTeamId !== teamId) {
    // /schedule can't be redrawn without its team, so it gets a plain reply.
    if (view.startsWith("c")) await interaction.reply({ content: "This raid no longer exists.", flags: MessageFlags.Ephemeral });
    else await redraw("This raid no longer exists.");
    return;
  }
  const dateLabel = raidTime(raid.startsAt);
  if (raid.closed || raid.cancelled) {
    await redraw(`**${dateLabel}** ${raid.closed ? "has already started or passed" : "has been cancelled"}.`);
    return;
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.roles.cache.has(raid.raidTeam.roleId)) {
    await redraw(`You're not on <@&${raid.raidTeam.roleId}>'s roster.`);
    return;
  }

  const changed = await setOut(raid.id, userId, out);
  await redraw(confirmation(out, raid.startsAt, teamId, raid.id, view));
  if (changed) await renderTeamMessage(client, teamId);
}

/** Switches the user back in for one raid from /attendance and redraws the view in place. */
async function backIn(
  interaction: AttendanceInteraction,
  client: Client,
  teamId: string,
  raidId: string,
  oneTeam: boolean,
): Promise<void> {
  const guild = interaction.guild!;
  const only = oneTeam ? teamId : undefined;
  const raid = await prisma.raidInstance.findUnique({ where: { id: raidId }, include: { raidTeam: true } });
  if (!raid || raid.raidTeamId !== teamId) {
    await interaction.update(await attendanceView(guild, interaction.user.id, "This raid no longer exists.", only));
    return;
  }
  const dateLabel = raidTime(raid.startsAt);
  if (raid.closed || raid.cancelled) {
    const why = raid.closed ? "has already started or passed" : "has been cancelled";
    await interaction.update(await attendanceView(guild, interaction.user.id, `**${dateLabel}** ${why}.`, only));
    return;
  }

  const changed = await setOut(raid.id, interaction.user.id, false);
  const notice = confirmation(false, raid.startsAt, teamId, raid.id, oneTeam ? "t" : "a");
  await interaction.update(await attendanceView(guild, interaction.user.id, notice, only));
  if (changed) await renderTeamMessage(client, teamId);
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
