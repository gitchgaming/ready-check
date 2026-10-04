import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client } from "discord.js";
import { raidDateAutocomplete, setAttendance } from "../lib/attendance.js";

export const data = new SlashCommandBuilder()
  .setName("callout")
  .setDescription("Let your raid team know you can't make a raid.")
  .addStringOption((opt) =>
    opt.setName("date").setDescription("The raid you'll miss").setRequired(true).setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await raidDateAutocomplete(interaction, interaction.user.id, "OUT");
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await setAttendance(interaction, client, "OUT", interaction.user.id);
}
