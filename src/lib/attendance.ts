import type { AutocompleteInteraction, ChatInputCommandInteraction, Client } from "discord.js";
import { MessageFlags } from "discord.js";
import { prisma } from "./db.js";
import { MAX_CHOICES, NO_CHOICE, formatRaidLabel, respondFiltered, teamDisplayName, teamsForMember } from "./pickers.js";
import { renderTeamMessage } from "./scheduler.js";

export type AttendanceStatus = "IN" | "OUT";

/** "TOGGLE" flips whatever the raider's current status is for the picked raid. */
export type AttendanceChange = AttendanceStatus | "TOGGLE";

/**
 * Date picker for the raids of whoever the attendance change is about. Calling
 * out or toggling lists every upcoming raid marked with their status (✅
 * attending / ❌ already out, plus what picking it does when toggling);
 * attending lists only their call-outs.
 */
export async function raidDateAutocomplete(
  interaction: AutocompleteInteraction,
  subjectId: string | undefined,
  status: AttendanceChange,
) {
  if (!interaction.guild) return;
  if (!subjectId) {
    await interaction.respond([{ name: "Pick a raider first", value: NO_CHOICE }]);
    return;
  }

  const teams = await teamsForMember(interaction.guild, subjectId);
  if (teams.length === 0) {
    await interaction.respond([{ name: "Not on any raid team", value: NO_CHOICE }]);
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
          : `${out ? "❌" : "✅"} ${date}${status === "TOGGLE" ? (out ? " — Attend" : " — Decline") : ""}`;
      return {
        name: showTeam ? `${label} · ${teamDisplayName(team, interaction.guild)}` : label,
        value: instance.id,
      };
    });

  await respondFiltered(
    interaction,
    choices,
    status === "IN" ? "No call-outs to undo" : "No upcoming raids",
  );
}

/** Sets (or toggles) a raider's attendance for one raid and refreshes the schedule message. */
export async function setAttendance(
  interaction: ChatInputCommandInteraction,
  client: Client,
  change: AttendanceChange,
  subjectId: string,
): Promise<void> {
  if (!interaction.guild) return;
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

  const dateLabel = formatRaidLabel(instance.startsAt, instance.raidTeam.timezone);
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

  await interaction.reply({
    content:
      status === "OUT"
        ? `❌ Marked ${who} as called out for ${dateLabel}.`
        : `✅ Marked ${who} as attending ${dateLabel}.`,
    flags: MessageFlags.Ephemeral,
  });
}
