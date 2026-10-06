import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { routeInteraction } from "./interactions/router.js";
import { prisma } from "./lib/db.js";
import { loadAppEmojis } from "./lib/emojis.js";
import { ensureMembersCached } from "./lib/roster.js";
import { renderTeamMessage, syncAllRaidTeams } from "./lib/scheduler.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN must be set (see .env.example).");
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // re-check schedules hourly

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const MEMBER_REFRESH_DEBOUNCE_MS = 3000;
const memberRefreshTimers = new Map<string, NodeJS.Timeout>();

// Role changes often arrive in bursts, so refresh each guild's schedule posts (which show the roster) once things settle.
function scheduleMemberRefresh(guildId: string) {
  const existing = memberRefreshTimers.get(guildId);
  if (existing) clearTimeout(existing);

  memberRefreshTimers.set(
    guildId,
    setTimeout(async () => {
      memberRefreshTimers.delete(guildId);
      const teams = await prisma.raidTeam.findMany({ where: { guildId }, select: { id: true } });
      for (const team of teams) {
        await renderTeamMessage(client, team.id).catch((err) =>
          console.error("Schedule refresh failed:", err),
        );
      }
    }, MEMBER_REFRESH_DEBOUNCE_MS),
  );
}

client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => scheduleMemberRefresh(newMember.guild.id));
client.on(Events.GuildMemberAdd, (member) => scheduleMemberRefresh(member.guild.id));
client.on(Events.GuildMemberRemove, (member) => scheduleMemberRefresh(member.guild.id));

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

client.on(Events.InteractionCreate, (interaction) => routeInteraction(interaction, client));

client.login(token);
