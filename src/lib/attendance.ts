import type { AutocompleteInteraction, ChatInputCommandInteraction, Client, Guild } from "discord.js";
import { MessageFlags } from "discord.js";
import { prisma } from "./db.js";
import {
  PICK_TO_CALL_OUT,
  PICK_TO_COME_BACK,
  asEphemeral,
  buildAttendanceMessage,
  confirmation,
  statusMark,
  type Notice,
} from "./embeds.js";
import { MAX_CHOICES, NO_CHOICE, fitChoiceName, formatRaidLabel, respondFiltered, teamDisplayName, teamsForMember } from "./pickers.js";
import { raidTime } from "./time.js";
import { fetchRosterMembers } from "./roster.js";
import { renderTeamMessage } from "./scheduler.js";

export type AttendanceStatus = "IN" | "OUT";

/** "TOGGLE" flips whatever the raider's current status is for the picked raid. */
export type AttendanceChange = AttendanceStatus | "TOGGLE";

/**
 * Date picker for the raids of whoever the attendance change is about, on every
 * team they're on, or only `onlyTeamId` when given. Calling
 * out or toggling lists every upcoming raid marked with their status (✅
 * attending / ❌ already out; toggling adds what picking it does, in the
 * schedule's date select's words); attending lists only their call-outs.
 */
export async function raidDateAutocomplete(
  interaction: AutocompleteInteraction,
  subjectId: string | undefined,
  status: AttendanceChange,
  onlyTeamId?: string,
) {
  if (!interaction.guild) return;
  if (!subjectId) {
    await interaction.respond([{ name: "Pick a raider first", value: NO_CHOICE }]);
    return;
  }

  const memberOf = await teamsForMember(interaction.guild, subjectId);
  const teams = onlyTeamId ? memberOf.filter((t) => t.id === onlyTeamId) : memberOf;
  if (teams.length === 0) {
    await interaction.respond([{ name: memberOf.length > 0 ? "Not on that team" : "Not on any raid team", value: NO_CHOICE }]);
    return;
  }

  const theirCallOut = { userId: subjectId, status: "OUT" };
  const attendanceFilter = status === "IN" ? { attendance: { some: theirCallOut } } : {};

  // Split the choice budget evenly so one busy team can't push the others off the list.
  const perTeam = Math.max(1, Math.floor(MAX_CHOICES / teams.length));
  const perTeamInstances = await Promise.all(
    teams.map((team) =>
      prisma.raidInstance.findMany({
        where: { raidTeamId: team.id, closed: false, cancelled: false, ...attendanceFilter },
        include: { attendance: { where: theirCallOut } },
        orderBy: { startsAt: "asc" },
        take: perTeam,
      }),
    ),
  );

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const showTeam = teams.length > 1;
  const choices = perTeamInstances
    .flat()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((instance) => {
      const team = teamById.get(instance.raidTeamId)!;
      const date = formatRaidLabel(instance.startsAt, team.timezone);
      const out = instance.attendance.length > 0;
      const label =
        status === "IN"
          ? date
          : `${out ? "❌" : "✅"} ${date}${status === "TOGGLE" ? ` — ${out ? PICK_TO_COME_BACK : PICK_TO_CALL_OUT}` : ""}`;
      const name = showTeam ? `${label} · ${teamDisplayName(team, interaction.guild)}` : label;
      return {
        name: fitChoiceName(name),
        value: instance.id,
      };
    });

  await respondFiltered(
    interaction,
    choices,
    status === "IN" ? "No call-outs to undo" : "No upcoming raids",
  );
}

/** Calls a raider out of one raid, or back in. Returns whether anything changed. */
export async function setOut(raidId: string, userId: string, out: boolean): Promise<boolean> {
  if (!out) {
    const { count } = await prisma.attendance.deleteMany({ where: { raidInstanceId: raidId, userId } });
    return count > 0;
  }
  const existing = await prisma.attendance.findUnique({
    where: { raidInstanceId_userId: { raidInstanceId: raidId, userId } },
  });
  if (existing?.status === "OUT") return false;
  await prisma.attendance.upsert({
    where: { raidInstanceId_userId: { raidInstanceId: raidId, userId } },
    create: { raidInstanceId: raidId, userId, status: "OUT" },
    update: { status: "OUT" },
  });
  return true;
}

/**
 * The /attendance view for one raider: each of their teams (or only `onlyTeamId`)
 * with every upcoming raid they're called out of. `notice` goes on top.
 */
export async function attendanceView(guild: Guild, userId: string, notice?: Notice, onlyTeamId?: string) {
  const memberOf = await teamsForMember(guild, userId);
  const teams = onlyTeamId ? memberOf.filter((t) => t.id === onlyTeamId) : memberOf;
  const blocks = await Promise.all(
    teams.map(async (team) => ({
      team,
      teamName: teamDisplayName(team, guild),
      instances: await prisma.raidInstance.findMany({
        where: { raidTeamId: team.id, closed: false },
        include: { attendance: true },
        orderBy: { startsAt: "asc" },
      }),
      members: await fetchRosterMembers(guild, team.roleId),
    })),
  );
  return buildAttendanceMessage(blocks, userId, notice, onlyTeamId !== undefined);
}

/**
 * Sets (or toggles) a raider's attendance for one raid and refreshes the schedule
 * message. `showView` replies with the raider's /attendance view under the
 * confirmation instead of the confirmation alone: every team, or with "team"
 * only the picked raid's team (as /attendance team: asked).
 */
export async function setAttendance(
  interaction: ChatInputCommandInteraction,
  client: Client,
  change: AttendanceChange,
  subjectId: string,
  showView: boolean | "team" = false,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  const onBehalf = subjectId !== interaction.user.id;
  const instanceId = interaction.options.getString("date", true);

  const instance = await prisma.raidInstance.findUnique({
    where: { id: instanceId },
    include: { raidTeam: true },
  });

  if (!instance || instance.raidTeam.guildId !== interaction.guild.id) {
    await interaction.reply({
      content: "Couldn't find that raid. Pick one from the suggestions as you type.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (instance.closed) {
    await interaction.reply({ content: "That raid has already started or passed.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (instance.cancelled) {
    await interaction.reply({ content: "That raid has been cancelled.", flags: MessageFlags.Ephemeral });
    return;
  }

  const subject = await interaction.guild.members.fetch(subjectId).catch(() => null);
  if (!subject || !subject.roles.cache.has(instance.raidTeam.roleId)) {
    await interaction.reply({
      content: onBehalf
        ? `<@${subjectId}> isn't on <@&${instance.raidTeam.roleId}>'s roster.`
        : `You're not on <@&${instance.raidTeam.roleId}>'s roster.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dateLabel = raidTime(instance.startsAt);
  const who = onBehalf ? `<@${subjectId}>` : "you";
  const alreadyOut = await prisma.attendance.findUnique({
    where: { raidInstanceId_userId: { raidInstanceId: instance.id, userId: subjectId } },
  });
  const status: AttendanceStatus = change === "TOGGLE" ? (alreadyOut ? "IN" : "OUT") : change;
  if ((status === "OUT") === (alreadyOut !== null)) {
    const isAre = onBehalf ? "is" : "are";
    await interaction.reply({
      content:
        status === "OUT"
          ? `${onBehalf ? who : "You"} ${isAre} already called out for ${dateLabel}.`
          : `${onBehalf ? who : "You"} ${isAre} already attending ${dateLabel}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (status === "OUT") {
    await prisma.attendance.upsert({
      where: { raidInstanceId_userId: { raidInstanceId: instance.id, userId: subjectId } },
      create: { raidInstanceId: instance.id, userId: subjectId, status: "OUT" },
      update: { status: "OUT" },
    });
  } else {
    await prisma.attendance.deleteMany({ where: { raidInstanceId: instance.id, userId: subjectId } });
  }

  await renderTeamMessage(client, instance.raidTeamId);

  if (showView) {
    const oneTeam = showView === "team" ? instance.raidTeamId : undefined;
    const notice = confirmation(status === "OUT", instance.startsAt, instance.raidTeamId, instance.id, oneTeam ? "t" : "a");
    await interaction.reply(asEphemeral(await attendanceView(interaction.guild, subjectId, notice, oneTeam)));
    return;
  }

  await interaction.reply({
    content:
      status === "OUT"
        ? `${statusMark(true)} Marked ${who} as called out for ${dateLabel}.`
        : `${statusMark(false)} Marked ${who} as attending ${dateLabel}.`,
    flags: MessageFlags.Ephemeral,
  });
}
