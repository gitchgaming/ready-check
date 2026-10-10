import "dotenv/config";
import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import { routeInteraction } from "./interactions/router.js";
import { backupConfig, dailyKeys, runBackup } from "./lib/backup.js";
import { prisma } from "./lib/db.js";
import { loadAppEmojis } from "./lib/emojis.js";
import { deployLabel, lanesEnabled, readDeployInfo } from "./lib/lanes.js";
import { readReleaseInfo, releaseLabel } from "./lib/release.js";
import { ensureMembersCached } from "./lib/roster.js";
import { renderTeamMessage, syncAllRaidTeams } from "./lib/scheduler.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN must be set (see .env.example).");
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // re-check schedules hourly
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // back up the database daily, and on each boot

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
  // On staging, show which lane is live, e.g. "🧪 my-branch @ 1a2b3c4";
  // in production, the release, e.g. "v0.1.0".
  if (lanesEnabled()) {
    const info = readDeployInfo();
    const state = `${info ? "🧪" : "🌿"} ${deployLabel(process.env, info)}`;
    readyClient.user.setActivity({ type: ActivityType.Custom, name: state, state });
  } else {
    const release = readReleaseInfo();
    if (release) {
      const state = releaseLabel(release);
      readyClient.user.setActivity({ type: ActivityType.Custom, name: state, state });
    }
  }
  await loadAppEmojis(readyClient).catch((err) => console.error("Loading application emojis failed:", err));
  for (const guild of readyClient.guilds.cache.values()) {
    await ensureMembersCached(guild).catch((err) => console.error("Member cache warmup failed:", err));
  }
  await syncAllRaidTeams(readyClient).catch((err) => console.error("Initial raid sync failed:", err));
  setInterval(() => {
    syncAllRaidTeams(readyClient).catch((err) => console.error("Scheduled raid sync failed:", err));
  }, SYNC_INTERVAL_MS);
  startBackups();
});

// Production only: set the BACKUP_* variables to a Railway bucket (docs/releasing.md).
function startBackups() {
  const config = backupConfig(process.env);
  if (!config) return;
  const backUp = () => {
    const keys = dailyKeys(config.prefix, new Date());
    return runBackup(config, process.env.DATABASE_URL!, keys)
      .then(() => console.log(`Database backed up to ${keys.join(", ")}`))
      .catch((err) => console.error("Database backup failed:", err));
  };
  void backUp();
  setInterval(backUp, BACKUP_INTERVAL_MS);
}

client.on(Events.InteractionCreate, (interaction) => routeInteraction(interaction, client));

client.login(token);
