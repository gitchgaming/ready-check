import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client } from "discord.js";
import { isOfficer } from "../lib/access.js";
import { buildCalendarMessage } from "../lib/embeds.js";
import { respondFiltered, teamDisplayName, viewableTeams } from "../lib/pickers.js";
import { rosterMemberIds } from "../lib/roster.js";
import { instancesForWindow } from "../lib/scheduler.js";

export const data = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("Privately view your raid schedule, past and future.")
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
  const choices = teams.map((t) => ({ name: teamDisplayName(t, interaction.guild), value: t.id }));
  await respondFiltered(interaction, choices, "You're not on any raid team");
}

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  const teams = await viewableTeams(interaction.guild, interaction.user.id, isOfficer(interaction));
  const teamId = interaction.options.getString("team");
  const team = teamId ? teams.find((t) => t.id === teamId) : teams[0];

  if (!team) {
    await interaction.reply({
      content: teamId ? "Couldn't find that team. Pick one from the suggestions." : "You're not on any raid team.",
      ephemeral: true,
    });
    return;
  }

  const { instances, canEarlier, canLater } = await instancesForWindow(team.id, 0);
  const rosterIds = await rosterMemberIds(interaction.guild, team.roleId);
  await interaction.reply({
    ...buildCalendarMessage(team, instances, 0, { canEarlier, canLater }, rosterIds),
    ephemeral: true,
  });
}
