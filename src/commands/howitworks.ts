import { SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { asEphemeral, buildHowItWorksMessage } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("howitworks")
  .setDescription("Privately see how the bot works: calling out, your schedule, and every command.");

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  await interaction.reply(asEphemeral(buildHowItWorksMessage()));
}
