import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from "discord.js";
import type { RaidTeam } from "../generated/prisma/client.js";
import { isOfficer } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { asEphemeral, buildRaidRosterCard, buildTeamRosterCard } from "../lib/embeds.js";
import { MAX_CHOICES, fitChoiceName, formatRaidLabel, respondFiltered, teamDisplayName, viewableTeams } from "../lib/pickers.js";
import { fetchRosterMembers, rosterMemberIds } from "../lib/roster.js";
import { userTimezone } from "../lib/userSettings.js";

export const data = new SlashCommandBuilder()
  .setName("roster")
  .setDescription("Privately see your team's roster, or who's in and out for one raid.")
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("A raid to see who's in and out; leave empty for the whole roster")
      .setRequired(false)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("team")
      .setDescription("Only needed if you're on more than one raid team")
      .setRequired(false)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) return;
  const teams = await viewableTeams(interaction.guild, interaction.user.id, isOfficer(interaction));
  if (interaction.options.getFocused(true).name === "team") {
    const choices = teams.map((t) => ({ name: teamDisplayName(t, interaction.guild), value: t.id }));
    await respondFiltered(interaction, choices, "You're not on any raid team");
    return;
  }
  // Only the focused option is resolved during autocomplete, so read the team raw.
  const teamId = interaction.options.get("team")?.value;
  await dateAutocomplete(interaction, teamId ? teams.filter((t) => t.id === teamId) : teams);
}

/**
 * Upcoming raids of the given teams, each with its current attendance (not
 * cancelled ones, which have no roster to show, as on the schedule post),
 * e.g. "Wed, Oct 7 · 8:00 PM · 17/20".
 */
async function dateAutocomplete(interaction: AutocompleteInteraction, teams: RaidTeam[]): Promise<void> {
  if (teams.length === 0) {
    await respondFiltered(interaction, [], "You're not on any raid team");
    return;
  }

  // Split the choice budget evenly so one busy team can't push the others off the list.
  const perTeam = Math.max(1, Math.floor(MAX_CHOICES / teams.length));
  const showTeam = teams.length > 1;
  const viewerZone = await userTimezone(interaction.user.id);
  const choices = (
    await Promise.all(
      teams.map(async (team) => {
        const [raids, rosterIds] = await Promise.all([
          prisma.raidInstance.findMany({
            where: { raidTeamId: team.id, closed: false, cancelled: false },
            include: { attendance: { where: { status: "OUT" } } },
            orderBy: { startsAt: "asc" },
            take: perTeam,
          }),
          rosterMemberIds(interaction.guild!, team.roleId),
        ]);
        return raids.map((raid) => {
          // Only current role holders count, as on the schedule post.
          const out = raid.attendance.filter((a) => rosterIds.has(a.userId)).length;
          const label = `${formatRaidLabel(raid.startsAt, viewerZone ?? team.timezone)} · ${rosterIds.size - out}/${rosterIds.size}`;
          return {
            startsAt: raid.startsAt,
            name: fitChoiceName(showTeam ? `${label} · ${teamDisplayName(team, interaction.guild)}` : label),
            value: raid.id,
          };
        });
      }),
    )
  )
    .flat()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map(({ name, value }) => ({ name, value }));

  await respondFiltered(interaction, choices, "No upcoming raids");
}

/**
 * Read-only. With a date: that raid's card (like the schedule's Next Up, minus the
 * Status button). Without one: the whole roster of one team (the `team` option, or
 * your first), in the same style.
 */
export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  const teams = await viewableTeams(guild, interaction.user.id, isOfficer(interaction));
  if (teams.length === 0) {
    await interaction.reply({ content: "You're not on any raid team.", flags: MessageFlags.Ephemeral });
    return;
  }

  const raidId = interaction.options.getString("date");
  if (!raidId) {
    const teamId = interaction.options.getString("team");
    const team = teamId ? teams.find((t) => t.id === teamId) : teams[0];
    if (!team) {
      await interaction.reply({
        content: "Couldn't find that team. Pick one from the suggestions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const members = await fetchRosterMembers(guild, team);
    await interaction.reply(asEphemeral(buildTeamRosterCard(teamDisplayName(team, guild), members)));
    return;
  }

  const raid = await prisma.raidInstance.findUnique({ where: { id: raidId }, include: { attendance: true } });
  const team = raid && teams.find((t) => t.id === raid.raidTeamId);
  if (!raid || !team) {
    await interaction.reply({
      content: "Couldn't find that raid. Pick one from the suggestions as you type.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const members = await fetchRosterMembers(guild, team);
  await interaction.reply(asEphemeral(buildRaidRosterCard(team, teamDisplayName(team, guild), raid, members)));
}
