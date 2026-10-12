import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { asEphemeral } from "../lib/embeds.js";
import { attendanceView, raidDateAutocomplete, setAttendance } from "../lib/attendance.js";
import { respondFiltered, teamDisplayName, teamsForMember } from "../lib/pickers.js";

export const data = new SlashCommandBuilder()
  .setName("attendance")
  .setDescription("Privately see the raids you're called out of, or pick a date to call out or switch back in.")
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("The raid to toggle — ✅ attending, ❌ called out")
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
  if (interaction.options.getFocused(true).name === "team") {
    const teams = await teamsForMember(interaction.guild, interaction.user.id);
    const choices = teams.map((t) => ({ name: teamDisplayName(t, interaction.guild), value: t.id }));
    await respondFiltered(interaction, choices, "You're not on any raid team");
    return;
  }
  // Only the focused option is resolved during autocomplete, so read the team raw.
  const teamId = interaction.options.get("team")?.value;
  await raidDateAutocomplete(interaction, interaction.user.id, "TOGGLE", typeof teamId === "string" ? teamId : undefined);
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  const teamId = interaction.options.getString("team") ?? undefined;
  if (teamId && !(await teamsForMember(interaction.guild, interaction.user.id)).some((t) => t.id === teamId)) {
    await interaction.reply({
      content: "You're not on that team. Pick one from the suggestions.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.options.getString("date")) {
    await setAttendance(interaction, client, "TOGGLE", interaction.user.id, teamId ? "team" : true);
    return;
  }
  const view = await attendanceView(interaction.guild, interaction.user.id, undefined, teamId);
  if (view.components.length === 0) {
    await interaction.reply({ content: "You're not on any raid team.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply(asEphemeral(view));
}
