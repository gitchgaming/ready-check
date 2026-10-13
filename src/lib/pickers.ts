import type { AutocompleteInteraction, Guild } from "discord.js";
import type { RaidTeam } from "../generated/prisma/client.js";
import { DateTime } from "luxon";
import { prisma } from "./db.js";
import { nextOccurrence, zoneAbbrev, zoneGenericName } from "./time.js";
import { weekdayName } from "./weekdays.js";

export const MAX_CHOICES = 25; // Discord's limit on autocomplete results
const MAX_CHOICE_NAME = 100; // Discord's limit on an autocomplete choice's name

/** Cuts a choice name to Discord's limit with an ellipsis; a long team name could push one over. */
export function fitChoiceName(name: string): string {
  return name.length > MAX_CHOICE_NAME ? `${name.slice(0, MAX_CHOICE_NAME - 1)}…` : name;
}

/** Placeholder value for an informational choice that isn't a real selection. */
export const NO_CHOICE = "none";

interface Choice {
  name: string;
  value: string;
}

/**
 * A raid's moment as plain text, in team time with its zone: `Tue, Oct 6 · 8:00 PM CDT`.
 * Only for places Discord shows text as is (autocomplete choices, select options);
 * message text uses `raidTime`, which each viewer sees in their own timezone.
 */
export function formatRaidLabel(date: Date, timezone: string): string {
  return `${DateTime.fromJSDate(date).setZone(timezone).toFormat("ccc, MMM d · h:mm a")} ${zoneAbbrev(date, timezone)}`;
}

/** A weekly night, a wall-clock rule in team time; with a timezone, labelled with its zone: `Tuesday 8:00 PM Central Time`. */
export function formatNight(dayOfWeek: number, hour: number, minute: number, timezone?: string): string {
  const night = `${weekdayName(dayOfWeek)} ${DateTime.fromObject({ hour, minute }).toFormat("h:mm a")}`;
  return timezone ? `${night} ${zoneGenericName(timezone)}` : night;
}

export function teamDisplayName(team: RaidTeam, guild: Guild | null): string {
  return team.name ?? guild?.roles.cache.get(team.roleId)?.name ?? "Raid";
}

/**
 * Narrows choices by the typed text, but never to nothing: an unexpected format
 * (e.g. "10/5") falls back to the full list instead of a dead end.
 */
export async function respondFiltered(
  interaction: AutocompleteInteraction,
  choices: Choice[],
  emptyMessage: string,
): Promise<void> {
  if (choices.length === 0) {
    await interaction.respond([{ name: emptyMessage, value: NO_CHOICE }]);
    return;
  }
  const focused = interaction.options.getFocused().toLowerCase();
  const filtered = focused
    ? choices.filter((c) => c.name.toLowerCase().includes(focused) || c.value.toLowerCase().includes(focused))
    : choices;
  await interaction.respond((filtered.length > 0 ? filtered : choices).slice(0, MAX_CHOICES));
}

/**
 * Reads the role option during autocomplete. Discord only guarantees a resolved
 * object for the focused option, so this uses the raw snowflake instead.
 */
export async function teamFromRoleOption(interaction: AutocompleteInteraction): Promise<RaidTeam | null> {
  const roleId = interaction.options.get("role")?.value as string | undefined;
  if (!roleId || !interaction.guildId) return null;
  return prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guildId, roleId } },
  });
}

/** Upcoming raids for one team, filtered by cancelled state. */
/** `zone` is the viewer's own timezone if they set one (`userTimezone`), else the team's. */
export async function teamRaidChoices(team: RaidTeam, cancelled: boolean, zone = team.timezone): Promise<Choice[]> {
  const instances = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false, cancelled },
    orderBy: { startsAt: "asc" },
    take: MAX_CHOICES,
  });
  return instances.map((i) => ({ name: formatRaidLabel(i.startsAt, zone), value: i.id }));
}

/**
 * The days of a team's upcoming raids, in team time, as date choices (a final raid
 * date is a day, not a raid). Cancelled raids count, so the last one can be one.
 */
export async function raidDayChoices(team: RaidTeam): Promise<Choice[]> {
  const instances = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false },
    orderBy: { startsAt: "asc" },
  });
  const days = new Map<string, Choice>();
  for (const i of instances) {
    const choice = dateChoice(DateTime.fromJSDate(i.startsAt, { zone: team.timezone }));
    days.set(choice.value, choice);
  }
  return [...days.values()].slice(0, MAX_CHOICES);
}

/** Upcoming one-off raids for a team, including cancelled ones. */
export async function oneOffRaidChoices(team: RaidTeam, zone = team.timezone): Promise<Choice[]> {
  const instances = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false, oneOff: true },
    orderBy: { startsAt: "asc" },
    take: MAX_CHOICES,
  });
  return instances.map((i) => ({
    name: formatRaidLabel(i.startsAt, zone) + (i.cancelled ? " (cancelled)" : ""),
    value: i.id,
  }));
}

/**
 * A team's weekly nights, in team time (a night is a rule there). For a viewer who
 * set a different timezone, each also shows its next raid in theirs:
 * `Tuesday 8:00 PM Central Time · Wed 3:00 AM GMT+2 for you`.
 */
export async function nightChoices(team: RaidTeam, viewerZone: string | null = null): Promise<Choice[]> {
  const nights = await prisma.raidSlot.findMany({
    where: { raidTeamId: team.id },
    orderBy: [{ dayOfWeek: "asc" }, { hour: "asc" }, { minute: "asc" }],
  });
  const forViewer = viewerZone && zoneGenericName(viewerZone) !== zoneGenericName(team.timezone);
  return nights.map((n) => {
    const night = formatNight(n.dayOfWeek, n.hour, n.minute, team.timezone);
    if (!forViewer) return { name: night, value: n.id };
    const next = nextOccurrence(n.dayOfWeek, n.hour, n.minute, team.timezone, DateTime.now()).setZone(viewerZone);
    return { name: `${night} · ${next.toFormat("ccc h:mm a")} ${zoneAbbrev(next.toJSDate(), viewerZone)} for you`, value: n.id };
  });
}

const FULL_DATE_FORMATS = ["yyyy-MM-dd", "M/d/yyyy", "M/d/yy", "MMM d yyyy", "MMM d, yyyy", "MMMM d yyyy", "MMMM d, yyyy"];
const YEARLESS_DATE_FORMATS = ["M/d", "MMM d", "MMMM d"];
const MAX_YEARS_AHEAD = 2;

/**
 * Reads a typed date (US month/day order) in the team's timezone. Year-less input
 * means the next occurrence of that date. Returns null for past or far-off dates.
 */
export function parseTypedDate(typed: string, timezone: string): DateTime | null {
  const text = typed.trim();
  if (!text) return null;
  const today = DateTime.now().setZone(timezone).startOf("day");

  let date: DateTime | null = null;
  for (const format of FULL_DATE_FORMATS) {
    const parsed = DateTime.fromFormat(text, format, { zone: timezone, locale: "en-US" });
    if (parsed.isValid) {
      date = parsed;
      break;
    }
  }
  if (!date) {
    for (const format of YEARLESS_DATE_FORMATS) {
      const parsed = DateTime.fromFormat(text, format, { zone: timezone, locale: "en-US" });
      if (parsed.isValid) {
        date = parsed < today ? parsed.plus({ years: 1 }) : parsed;
        break;
      }
    }
  }

  if (!date || date < today || date > today.plus({ years: MAX_YEARS_AHEAD })) return null;
  return date;
}

export function dateChoice(date: DateTime): Choice {
  return { name: date.toFormat("cccc, MMM d, yyyy"), value: date.toFormat("yyyy-MM-dd") };
}

/** The next few weeks of calendar dates, in the team's timezone, as "yyyy-MM-dd" values. */
export function upcomingDateChoices(timezone: string, typed: string): Choice[] {
  const today = DateTime.now().setZone(timezone).startOf("day");
  const days = typed ? 120 : MAX_CHOICES;
  const choices: Choice[] = [];
  for (let i = 0; i < days; i++) {
    choices.push(dateChoice(today.plus({ days: i })));
  }
  return choices;
}

// Shown first so the picker opens on likely choices instead of "Africa/…".
const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Halifax",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Helsinki",
  "Europe/Moscow",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const ALL_TIMEZONES: string[] = [
  ...COMMON_TIMEZONES,
  ...Intl.supportedValuesOf("timeZone").filter((tz) => !COMMON_TIMEZONES.includes(tz)),
];

export function timezoneChoices(): Choice[] {
  return ALL_TIMEZONES.map((tz) => ({ name: tz.replace(/_/g, " "), value: tz }));
}

/** Teams a member can view, oldest first: all teams for officers, otherwise the teams their roles place them on. */
export async function viewableTeams(guild: Guild, userId: string, officer: boolean): Promise<RaidTeam[]> {
  const teams = await prisma.raidTeam.findMany({
    where: { guildId: guild.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const mine = await teamsForMember(guild, userId, teams);
  if (!officer) return mine;
  // Officers see every team, their own first, so commands default to a team they're on.
  return [...mine, ...teams.filter((t) => !mine.includes(t))];
}

/** Raid teams in this guild whose role the given member holds. */
export async function teamsForMember(guild: Guild, userId: string, teams?: RaidTeam[]): Promise<RaidTeam[]> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return [];
  const all = teams ?? (await prisma.raidTeam.findMany({ where: { guildId: guild.id } }));
  return all.filter((t) => member.roles.cache.has(t.roleId));
}
