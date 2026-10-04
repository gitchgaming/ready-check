import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from "discord.js";
import { isOfficer } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { asEphemeral, buildRaidRosterCard } from "../lib/embeds.js";
import { MAX_CHOICES, formatRaidLabel, respondFiltered, teamDisplayName, viewableTeams } from "../lib/pickers.js";
import { buildRosterEmbed, fetchRosterMembers, rosterMemberIds } from "../lib/roster.js";

/** Discord's cap on embeds in one message. */
const MAX_EMBEDS = 10;

export const data = new SlashCommandBuilder()
  .setName("roster")
  .setDescription("Privately see your team's roster, or who's in and out for one raid.")
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("A raid to see who's in and out; leave empty for the whole roster")
      .setRequired(false)
      .setAutocomplete(true),
  );

/**
 * Upcoming raids (cancelled ones included) of every team the user can view, each
 * with its current attendance, e.g. "Wed, Oct 7 · 8:00 PM · 17/20".
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) return;
  const teams = await viewableTeams(interaction.guild, interaction.user.id, isOfficer(interaction));
  if (teams.length === 0) {
    await respondFiltered(interaction, [], "You're not on any raid team");
    return;
  }

  // Split the choice budget evenly so one busy team can't push the others off the list.
  const perTeam = Math.max(1, Math.floor(MAX_CHOICES / teams.length));
  const showTeam = teams.length > 1;
  const choices = (
    await Promise.all(
      teams.map(async (team) => {
        const [raids, rosterIds] = await Promise.all([
          prisma.raidInstance.findMany({
            where: { raidTeamId: team.id, closed: false },
            include: { attendance: { where: { status: "OUT" } } },
            orderBy: { startsAt: "asc" },
            take: perTeam,
          }),
          rosterMemberIds(interaction.guild!, team.roleId),
        ]);
        return raids.map((raid) => {
          // Only current role holders count, as on the schedule post.
          const out = raid.attendance.filter((a) => rosterIds.has(a.userId)).length;
          const status = raid.cancelled ? "cancelled" : `${rosterIds.size - out}/${rosterIds.size}`;
          const label = `${formatRaidLabel(raid.startsAt, team.timezone)} · ${status}`;
          return {
            startsAt: raid.startsAt,
            name: showTeam ? `${label} · ${teamDisplayName(team, interaction.guild)}` : label,
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
 * Status button). Without one: the full roster of each team you can view, split
 * into Tanks / Healers / DPS.
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
    const embeds = await Promise.all(
      teams.slice(0, MAX_EMBEDS).map(async (team) =>
        buildRosterEmbed(teamDisplayName(team, guild), await fetchRosterMembers(guild, team.roleId)),
      ),
    );
    await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
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

  const members = await fetchRosterMembers(guild, team.roleId);
  await interaction.reply(asEphemeral(buildRaidRosterCard(team, raid, members)));
}
