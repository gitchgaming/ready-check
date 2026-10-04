import { EmbedBuilder, type Client, type Guild, type GuildMember } from "discord.js";
import { CLASSES, RAID_TYPES, memberClass, memberRaidType, type RaidType } from "./classes.js";
import { prisma } from "./db.js";
import { appEmoji } from "./emojis.js";

const MAX_FIELD_VALUE = 1024; // Discord's cap on one embed field's text

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

/** Non-bot members currently holding the role. */
export async function fetchRosterMembers(guild: Guild, roleId: string): Promise<GuildMember[]> {
  await ensureMembersCached(guild);
  return [...guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(roleId)).values()];
}

/** Joins as many entries as fit in `max` characters, ending with "…and N more" if some don't. */
function fitEntries(entries: string[], separator: string, max: number): string {
  if (entries.length === 0) return "—";
  const kept: string[] = [];
  let length = 0;
  for (const [i, entry] of entries.entries()) {
    const reserve = i < entries.length - 1 ? 20 : 0; // room for the "…and N more" line
    if (length + entry.length + separator.length + reserve > max) {
      kept.push(`…and ${entries.length - i} more`);
      break;
    }
    kept.push(entry);
    length += entry.length + separator.length;
  }
  return kept.join(separator);
}

/** Class icon + name, grouped by class (in CLASSES order) and then alphabetically. */
function memberEntries(members: GuildMember[]): string[] {
  const classOrder = (m: GuildMember) => {
    const c = memberClass(m);
    return c ? CLASSES.indexOf(c) : CLASSES.length;
  };
  return [...members]
    .sort((a, b) => classOrder(a) - classOrder(b) || a.displayName.localeCompare(b.displayName))
    .map((m) => {
      const c = memberClass(m);
      const icon = c ? appEmoji(c.emoji) : "";
      return icon ? `${icon} ${m.displayName}` : m.displayName;
    });
}

/**
 * Tanks | Healers | DPS columns, each raider counted once under their highest-priority
 * type role, plus a full-width line for raiders with no type role yet.
 */
export function buildRosterEmbed(teamName: string, members: GuildMember[]): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`${teamName} — roster (${members.length})`).setColor(0x5865f2);
  if (members.length === 0) return embed.setDescription("No one has this role yet.");

  const byType = new Map<RaidType | undefined, GuildMember[]>();
  for (const member of members) {
    const type = memberRaidType(member);
    byType.set(type, [...(byType.get(type) ?? []), member]);
  }

  for (const type of RAID_TYPES) {
    const group = byType.get(type) ?? [];
    embed.addFields({
      name: `${type.emoji ? appEmoji(type.emoji, type.icon) : type.icon} ${type.label} (${group.length})`,
      value: fitEntries(memberEntries(group), "\n", MAX_FIELD_VALUE),
      inline: true,
    });
  }

  const untyped = byType.get(undefined) ?? [];
  if (untyped.length > 0) {
    embed.addFields({
      name: `No type role (${untyped.length})`,
      value: fitEntries(memberEntries(untyped), ", ", MAX_FIELD_VALUE),
    });
  }

  return embed;
}

/** Re-renders a team's roster message from current Discord role membership. */
export async function renderRoster(client: Client, teamId: string): Promise<void> {
  const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
  if (!team?.rosterChannelId || !team.rosterMessageId) return;

  const guild = await client.guilds.fetch(team.guildId).catch(() => null);
  if (!guild) return;

  const members = await fetchRosterMembers(guild, team.roleId);
  const roleName = guild.roles.cache.get(team.roleId)?.name ?? "Raid";
  const embed = buildRosterEmbed(team.name ?? roleName, members);

  const channel = await client.channels.fetch(team.rosterChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(team.rosterMessageId).catch(() => null);
  if (message) await message.edit({ embeds: [embed] });
}
