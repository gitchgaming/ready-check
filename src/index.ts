import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { commands } from "./commands/index.js";
import { isAttendanceControl, handleAttendanceControl } from "./interactions/attendanceControls.js";
import { isNavButton, handleNavButton } from "./interactions/navButton.js";
import { isTeamDeleteButton, handleTeamDeleteButton } from "./interactions/teamDeleteButton.js";
import { prisma } from "./lib/db.js";
import { loadAppEmojis } from "./lib/emojis.js";
import { ensureMembersCached, renderRoster } from "./lib/roster.js";
import { renderTeamMessage, syncAllRaidTeams } from "./lib/scheduler.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN must be set (see .env.example).");
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // re-check schedules hourly

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const commandsByName = new Map(commands.map((c) => [c.data.name, c]));

const ROSTER_DEBOUNCE_MS = 3000;
const rosterRefreshTimers = new Map<string, NodeJS.Timeout>();

// Role changes often arrive in bursts, so refresh each guild's rosters once things settle.
function scheduleRosterRefresh(guildId: string) {
  const existing = rosterRefreshTimers.get(guildId);
  if (existing) clearTimeout(existing);

  rosterRefreshTimers.set(
    guildId,
    setTimeout(async () => {
      rosterRefreshTimers.delete(guildId);
      const teams = await prisma.raidTeam.findMany({ where: { guildId }, select: { id: true } });
      for (const team of teams) {
        await renderRoster(client, team.id).catch((err) => console.error("Roster refresh failed:", err));
        await renderTeamMessage(client, team.id).catch((err) =>
          console.error("Schedule refresh failed:", err),
        );
      }
    }, ROSTER_DEBOUNCE_MS),
  );
}

client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => scheduleRosterRefresh(newMember.guild.id));
client.on(Events.GuildMemberAdd, (member) => scheduleRosterRefresh(member.guild.id));
client.on(Events.GuildMemberRemove, (member) => scheduleRosterRefresh(member.guild.id));

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await loadAppEmojis(readyClient).catch((err) => console.error("Loading application emojis failed:", err));
  for (const guild of readyClient.guilds.cache.values()) {
    await ensureMembersCached(guild).catch((err) => console.error("Member cache warmup failed:", err));
  }
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

    if (interaction.isAutocomplete()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command?.autocomplete) return;
      await command.autocomplete(interaction);
      return;
    }

    if ((interaction.isButton() || interaction.isStringSelectMenu()) && isAttendanceControl(interaction.customId)) {
      await handleAttendanceControl(interaction, client);
      return;
    }

    if (interaction.isButton() && isNavButton(interaction.customId)) {
      await handleNavButton(interaction, client);
      return;
    }

    if (interaction.isButton() && isTeamDeleteButton(interaction.customId)) {
      await handleTeamDeleteButton(interaction, client);
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
