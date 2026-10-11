// Logs which servers the bot is in, so a weekly check of the production logs
// can spot a server that added it (anyone with the invite link can).

type GuildInfo = { id: string; name: string; memberCount: number; joinedAt: Date | null };

/** One server, e.g. `"Raid Guild" (123) · 42 members · joined 2026-10-04`. */
export function describeGuild(guild: GuildInfo): string {
  const joined = guild.joinedAt ? guild.joinedAt.toISOString().slice(0, 10) : "unknown";
  return `"${guild.name}" (${guild.id}) · ${guild.memberCount} members · joined ${joined}`;
}

/** Every server the bot is in, oldest join first, one per line under a count. */
export function describeGuilds(guilds: Iterable<GuildInfo>): string {
  const sorted = [...guilds].sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0));
  return [`Servers (${sorted.length}):`, ...sorted.map((g) => `  ${describeGuild(g)}`)].join("\n");
}
