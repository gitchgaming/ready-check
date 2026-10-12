import type { Guild, GuildMember } from "discord.js";
import { demoMembers } from "./demoRoster.js";

/**
 * Fetches the full member list only when the cache is incomplete. Discord's member
 * events keep the cache current after that, so repeated full fetches are avoided.
 */
export async function ensureMembersCached(guild: Guild): Promise<void> {
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch();
}

/** IDs of non-bot members currently holding the role. */
export async function rosterMemberIds(guild: Guild, roleId: string): Promise<Set<string>> {
  await ensureMembersCached(guild);
  const ids = guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(roleId)).map((m) => m.id);
  return new Set([...ids, ...demoMembers().map((m) => m.id)]);
}

/** Non-bot members currently holding the role. */
export async function fetchRosterMembers(guild: Guild, roleId: string): Promise<GuildMember[]> {
  await ensureMembersCached(guild);
  return [...guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(roleId)).values(), ...demoMembers()];
}
