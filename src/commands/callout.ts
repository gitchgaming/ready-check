import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client } from "discord.js";
import { raidDateAutocomplete, setAttendance } from "../lib/attendance.js";

export const data = new SlashCommandBuilder()
  .setName("callout")
  .setDescription("Call out of a raid, or switch a call-out back to attending.")
  .addStringOption((opt) =>
    opt.setName("date").setDescription("The raid to toggle — ✅ attending, ❌ called out").setRequired(true).setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await raidDateAutocomplete(interaction, interaction.user.id, "TOGGLE");
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await setAttendance(interaction, client, "TOGGLE", interaction.user.id);
}
