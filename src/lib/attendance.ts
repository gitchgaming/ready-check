import type { AutocompleteInteraction, ChatInputCommandInteraction, Client } from "discord.js";
import { prisma } from "./db.js";
import { MAX_CHOICES, NO_CHOICE, formatRaidLabel, respondFiltered, teamDisplayName, teamsForMember } from "./pickers.js";
import { renderTeamMessage } from "./scheduler.js";

export type AttendanceStatus = "IN" | "OUT";

/** Date picker for the raids of whoever the attendance change is about. */
export async function raidDateAutocomplete(interaction: AutocompleteInteraction, subjectId: string | undefined) {
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

  // Split the choice budget evenly so one busy team can't push the others off the list.
  const perTeam = Math.max(1, Math.floor(MAX_CHOICES / teams.length));
  const perTeamInstances = await Promise.all(
    teams.map((team) =>
      prisma.raidInstance.findMany({
        where: { raidTeamId: team.id, closed: false, cancelled: false },
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
      const label = formatRaidLabel(instance.startsAt, team.timezone);
      return {
        name: showTeam ? `${label} · ${teamDisplayName(team, interaction.guild)}` : label,
        value: instance.id,
      };
    });

  await respondFiltered(interaction, choices, "No upcoming raids found");
}

/** Sets a raider's attendance for one raid and refreshes the schedule message. */
export async function setAttendance(
  interaction: ChatInputCommandInteraction,
  client: Client,
  status: AttendanceStatus,
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
      ephemeral: true,
    });
    return;
  }

  if (instance.closed) {
    await interaction.reply({ content: "That raid has already started or passed.", ephemeral: true });
    return;
  }

  if (instance.cancelled) {
    await interaction.reply({ content: "That raid has been cancelled.", ephemeral: true });
    return;
  }

  const subject = await interaction.guild.members.fetch(subjectId).catch(() => null);
  if (!subject || !subject.roles.cache.has(instance.raidTeam.roleId)) {
    await interaction.reply({
      content: onBehalf
        ? `<@${subjectId}> isn't on <@&${instance.raidTeam.roleId}>'s roster.`
        : `You're not on <@&${instance.raidTeam.roleId}>'s roster.`,
      ephemeral: true,
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

  const dateLabel = formatRaidLabel(instance.startsAt, instance.raidTeam.timezone);
  const who = onBehalf ? `<@${subjectId}>` : "you";
  await interaction.reply({
    content:
      status === "OUT"
        ? `❌ Marked ${who} as called out for ${dateLabel}.`
        : `✅ Marked ${who} as attending ${dateLabel}.`,
    ephemeral: true,
  });
}
