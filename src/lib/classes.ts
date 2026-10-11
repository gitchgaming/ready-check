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
  icon: string;
  /** Application emoji used instead of `icon` when it's been uploaded. */
  emoji?: string;
  /** Small padded app emoji marking this role beside a called-out raider's name. */
  marker?: string;
  /**
   * How many of this role a raid needs. Drives the role status dots on the
   * schedule. A design assumption for now; could become a per-team setting.
   */
  min: number;
  roles: string[];
}

/**
 * In priority order: a raider with several type roles counts as their first match.
 * A raider with only an off-spec role (see OFF_SPECS) counts as Damage.
 */
export const RAID_TYPES: RaidType[] = [
  { label: "Tanks", icon: "🛡️", emoji: "tank", marker: "mark_tank", min: 2, roles: ["Tanks", "Tank"] },
  { label: "Healers", icon: "➕", emoji: "healer", marker: "mark_healer", min: 3, roles: ["Healers", "Healer"] },
  {
    label: "Damage",
    icon: "⚔️",
    emoji: "dps",
    marker: "mark_dps",
    min: 10,
    roles: ["Damage", "DPS", "Wizards", "Wizard", "Phys", "Physical"],
  },
];

const DAMAGE = RAID_TYPES[2]!;

/**
 * Secondary roles of damage mains, shown as a marker beside their name in the
 * Damage section and counted in the schedule's off-spec key. Ignored for tanks
 * and healers, whose main role already says it.
 */
export interface OffSpec {
  label: string;
  /** Small padded app emoji beside the name; `icon` if it isn't uploaded. */
  marker: string;
  icon: string;
  roles: string[];
}

export const OFF_SPECS: OffSpec[] = [
  { label: "Offtank", marker: "mark_offtank", icon: "🛡️", roles: ["Offtank", "Offtanks", "Off-tank", "Off tank"] },
  {
    label: "Offheals",
    marker: "mark_offheal",
    icon: "➕",
    roles: ["Offheals", "Offheal", "Offhealer", "Offhealers", "Off-heals", "Off heals"],
  },
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
  const type = RAID_TYPES.find((t) => hasRoleNamed(member, t.roles));
  if (type) return type;
  return OFF_SPECS.some((o) => hasRoleNamed(member, o.roles)) ? DAMAGE : undefined;
}

/** A damage main's off-specs, in OFF_SPECS order; none for tanks and healers. */
export function memberOffSpecs(member: GuildMember): OffSpec[] {
  if (memberRaidType(member) !== DAMAGE) return [];
  return OFF_SPECS.filter((o) => hasRoleNamed(member, o.roles));
}

/** An off-spec's marker: its application emoji if uploaded, else the Unicode icon. */
export function offSpecMarker(offSpec: OffSpec): string {
  return appEmoji(offSpec.marker, offSpec.icon);
}
