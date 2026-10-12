import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { asEphemeral } from "../lib/embeds.js";
import { attendanceView, raidDateAutocomplete, setAttendance } from "../lib/attendance.js";

export const data = new SlashCommandBuilder()
  .setName("attendance")
  .setDescription("Privately see the raids you're called out of, or pick a date to call out or switch back in.")
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("The raid to toggle — ✅ attending, ❌ called out")
      .setRequired(false)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await raidDateAutocomplete(interaction, interaction.user.id, "TOGGLE");
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.options.getString("date")) {
    await setAttendance(interaction, client, "TOGGLE", interaction.user.id, true);
    return;
  }
  const view = await attendanceView(interaction.guild, interaction.user.id);
  if (view.components.length === 0) {
    await interaction.reply({ content: "You're not on any raid team.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply(asEphemeral(view));
}
