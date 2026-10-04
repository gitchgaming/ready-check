import type { GuildMember } from "discord.js";
import { appEmoji } from "./emojis.js";

/**
 * Class and raid-type roles are matched by role name (case-insensitive), so the
 * same code works in any server whose roles use these names. A class's `emoji` is
 * the name of an application emoji (see emojis.ts) and of its file in
 * assets/emojis/; raid types use Unicode icons unless they name an emoji.
 */
export interface WowClass {
  label: string;
  emoji: string;
  roles: string[];
}

export const CLASSES: WowClass[] = [
  { label: "Warrior", emoji: "warrior", roles: ["Warriors", "Warrior"] },
  { label: "Paladin", emoji: "paladin", roles: ["Paladins", "Paladin"] },
  { label: "Hunter", emoji: "hunter", roles: ["Hunters", "Hunter"] },
  { label: "Rogue", emoji: "rogue", roles: ["Rogues", "Rogue"] },
  { label: "Priest", emoji: "priest", roles: ["Priests", "Priest"] },
  { label: "Shaman", emoji: "shaman", roles: ["Shamans", "Shaman"] },
  { label: "Mage", emoji: "mage", roles: ["Mages", "Mage"] },
  { label: "Warlock", emoji: "warlock", roles: ["Warlocks", "Warlock"] },
  { label: "Druid", emoji: "druid", roles: ["Druids", "Druid"] },
];

export interface RaidType {
  label: string;
  /** Short label for the compact per-raid summary on the schedule. */
  short: string;
  icon: string;
  /** Application emoji used instead of `icon` when it's been uploaded. */
  emoji?: string;
  /**
   * How many of this role a raid needs. Drives the role status dots on the
   * schedule. A design assumption for now; could become a per-team setting.
   */
  min: number;
  roles: string[];
}

/** In priority order: a raider with several type roles counts as their first match. */
export const RAID_TYPES: RaidType[] = [
  { label: "Tanks", short: "Tanks", icon: "🛡️", min: 2, roles: ["Tanks", "Tank"] },
  { label: "Healers", short: "Heals", icon: "➕", emoji: "healer", min: 3, roles: ["Healers", "Healer"] },
  { label: "DPS", short: "DPS", icon: "⚔️", min: 10, roles: ["DPS", "Wizards", "Phys"] },
];

function hasRoleNamed(member: GuildMember, names: string[]): boolean {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return member.roles.cache.some((role) => wanted.has(role.name.toLowerCase()));
}

export function memberClass(member: GuildMember): WowClass | undefined {
  return CLASSES.find((c) => hasRoleNamed(member, c.roles));
}

/** The icon for a raid type: its application emoji if uploaded, else the Unicode icon. */
export function raidTypeIcon(type: RaidType): string {
  return type.emoji ? appEmoji(type.emoji, type.icon) : type.icon;
}

export function memberRaidType(member: GuildMember): RaidType | undefined {
  return RAID_TYPES.find((t) => hasRoleNamed(member, t.roles));
}
