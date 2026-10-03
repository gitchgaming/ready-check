import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set (see .env.example).");
}

const rest = new REST().setToken(token);
const body = commands.map((c) => c.data.toJSON());

async function main() {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId!, guildId), { body });
    console.log(`Registered ${body.length} commands to guild ${guildId} (instant).`);
  } else {
    await rest.put(Routes.applicationCommands(clientId!), { body });
    console.log(`Registered ${body.length} commands globally (may take up to ~1 hour to propagate).`);
  }
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
