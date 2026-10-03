import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { commands } from "./commands/index.js";
import { isAttendanceButton, handleAttendanceButton } from "./interactions/attendanceButton.js";
import { syncAllRaidTeams } from "./lib/scheduler.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN must be set (see .env.example).");
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // re-check schedules hourly

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const commandsByName = new Map(commands.map((c) => [c.data.name, c]));

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await syncAllRaidTeams(readyClient).catch((err) => console.error("Initial raid sync failed:", err));
  setInterval(() => {
    syncAllRaidTeams(readyClient).catch((err) => console.error("Scheduled raid sync failed:", err));
  }, SYNC_INTERVAL_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, client);
      return;
    }

    if (interaction.isButton() && isAttendanceButton(interaction.customId)) {
      await handleAttendanceButton(interaction, client);
      return;
    }
  } catch (err) {
    console.error("Error handling interaction:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong handling that.", ephemeral: true }).catch(() => null);
    }
  }
});

client.login(token);
