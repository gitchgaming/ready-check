import type { GuildMember } from "discord.js";

/**
 * Class and raid-type roles are matched by role name (case-insensitive), so the
 * same code works in any server whose roles use these names. A class's `emoji` is
 * the name of an application emoji (see emojis.ts) and of its file in
 * assets/emojis/; raid types use Unicode icons unless they name an emoji.
 */
export interface WowClass {
  emoji: string;
  roles: string[];
}

export const CLASSES: WowClass[] = [
  { emoji: "warrior", roles: ["Warriors", "Warrior"] },
  { emoji: "paladin", roles: ["Paladins", "Paladin"] },
  { emoji: "hunter", roles: ["Hunters", "Hunter"] },
  { emoji: "rogue", roles: ["Rogues", "Rogue"] },
  { emoji: "priest", roles: ["Priests", "Priest"] },
  { emoji: "shaman", roles: ["Shamans", "Shaman"] },
  { emoji: "mage", roles: ["Mages", "Mage"] },
  { emoji: "warlock", roles: ["Warlocks", "Warlock"] },
  { emoji: "druid", roles: ["Druids", "Druid"] },
];

export interface RaidType {
  label: string;
  icon: string;
  /** Application emoji used instead of `icon` when it's been uploaded. */
  emoji?: string;
  roles: string[];
}

/** In priority order: a raider with several type roles counts as their first match. */
export const RAID_TYPES: RaidType[] = [
  { label: "Tanks", icon: "🛡️", roles: ["Tanks", "Tank"] },
  { label: "Healers", icon: "➕", emoji: "healer", roles: ["Healers", "Healer"] },
  { label: "DPS", icon: "⚔️", roles: ["DPS", "Wizards", "Phys"] },
];

function hasRoleNamed(member: GuildMember, names: string[]): boolean {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return member.roles.cache.some((role) => wanted.has(role.name.toLowerCase()));
}

export function memberClass(member: GuildMember): WowClass | undefined {
  return CLASSES.find((c) => hasRoleNamed(member, c.roles));
}

export function memberRaidType(member: GuildMember): RaidType | undefined {
  return RAID_TYPES.find((t) => hasRoleNamed(member, t.roles));
}
