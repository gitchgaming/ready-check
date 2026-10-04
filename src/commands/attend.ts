import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client } from "discord.js";
import { raidDateAutocomplete, setAttendance } from "../lib/attendance.js";

export const data = new SlashCommandBuilder()
  .setName("attend")
  .setDescription("Undo a call-out and mark yourself as attending a raid.")
  .addStringOption((opt) =>
    opt.setName("date").setDescription("The raid you'll attend").setRequired(true).setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await raidDateAutocomplete(interaction, interaction.user.id);
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await setAttendance(interaction, client, "IN", interaction.user.id);
}
