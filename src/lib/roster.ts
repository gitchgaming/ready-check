import type { Guild, GuildMember } from "discord.js";
import type { RaidTeam } from "../generated/prisma/client.js";
import { teamNames } from "./raiderNames.js";

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
  return new Set(guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(roleId)).map((m) => m.id));
}

/**
 * Non-bot members currently holding the team's role, each under the name set for
 * this team (`/name`, `/raidlead name`) where there is one. A renamed raider is a
 * copy whose `displayName` is that name and whose everything else is the cached
 * member's, so the cache itself never changes.
 */
export async function fetchRosterMembers(guild: Guild, team: Pick<RaidTeam, "id" | "roleId">): Promise<GuildMember[]> {
  await ensureMembersCached(guild);
  const names = await teamNames(team.id);
  return [...guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(team.roleId)).values()].map((m) => {
    const name = names.get(m.id);
    return name ? (Object.create(m, { displayName: { value: name } }) as GuildMember) : m;
  });
}
