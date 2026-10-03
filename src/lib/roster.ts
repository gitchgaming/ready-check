import { EmbedBuilder, type Client, type Guild } from "discord.js";
import { prisma } from "./db.js";

const MAX_DESCRIPTION = 4000; // Discord caps embed descriptions at 4096

export async function fetchRosterNames(guild: Guild, roleId: string): Promise<string[]> {
  const members = await guild.members.fetch();
  return members
    .filter((m) => !m.user.bot && m.roles.cache.has(roleId))
    .map((m) => m.displayName)
    .sort((a, b) => a.localeCompare(b));
}

export function buildRosterEmbed(teamName: string, names: string[]): EmbedBuilder {
  const lines: string[] = [];
  let length = 0;
  for (const name of names) {
    if (length + name.length + 1 > MAX_DESCRIPTION) break;
    lines.push(name);
    length += name.length + 1;
  }
  const hidden = names.length - lines.length;
  const description =
    names.length === 0
      ? "No one has this role yet."
      : lines.join("\n") + (hidden > 0 ? `\n…and ${hidden} more` : "");

  return new EmbedBuilder()
    .setTitle(`${teamName} — roster (${names.length})`)
    .setDescription(description)
    .setColor(0x5865f2);
}

/** Re-renders a team's roster message from current Discord role membership. */
export async function renderRoster(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
  if (!team?.rosterChannelId || !team.rosterMessageId) return;

  const guild = await client.guilds.fetch(team.guildId).catch(() => null);
  if (!guild) return;

  const names = await fetchRosterNames(guild, team.roleId);
  const roleName = guild.roles.cache.get(team.roleId)?.name ?? "Raid";
  const embed = buildRosterEmbed(team.name ?? roleName, names);

  const channel = await client.channels.fetch(team.rosterChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(team.rosterMessageId).catch(() => null);
  if (message) await message.edit({ embeds: [embed] });
}
