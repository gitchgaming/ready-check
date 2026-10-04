import "dotenv/config";
import { REST, Routes } from "discord.js";

// Removes every globally registered command for this application. Guild commands
// don't need this: deploy-commands replaces a guild's whole list each time it runs.
// Production registers its commands globally, so for an application shared between
// testing and production, rerun deploy-commands without DISCORD_GUILD_ID afterward.

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set (see .env.example).");
}

const rest = new REST().setToken(token);

async function main() {
  const existing = (await rest.get(Routes.applicationCommands(clientId!))) as { name: string }[];
  if (existing.length === 0) {
    console.log("No global commands registered. Nothing to clear.");
    return;
  }

  console.log(`Clearing ${existing.length} global commands: ${existing.map((c) => `/${c.name}`).join(", ")}`);
  await rest.put(Routes.applicationCommands(clientId!), { body: [] });
  console.log("Done. Discord clients may take a few minutes, or a reload (Ctrl+R), to drop them.");
}

main().catch((err) => {
  console.error("Failed to clear global commands:", err);
  process.exit(1);
});
