import { DateTime } from "luxon";

/** Parses a strict "HH:MM" 24-hour string. Returns null if invalid. */
export function parseHourMinute(input: string): { hour: number; minute: number } | null {
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(input.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Discord's timestamp styles, rendered by each viewer's client in their own timezone. */
export type TimestampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "s" | "S" | "R";

/**
 * A Discord timestamp (`<t:unix:style>`). Discord renders it in each viewer's own
 * timezone, but only in message text; select options, choices and button labels
 * show it raw, so those use `formatRaidLabel`'s team time with a zone instead.
 */
export function discordTime(date: Date, style: TimestampStyle): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/**
 * A raid's moment as message text, in the viewer's own timezone. Full ("Wednesday,
 * October 14, 2026 at 8:00 PM", the only style with a weekday) where a line has
 * room; short ("10/14/26, 8:00 PM") where it shares the line with a button, since the
 * full style wraps there on a phone. Tapping either shows the full date.
 */
export function raidTime(date: Date, size: "full" | "short" = "full"): string {
  return discordTime(date, size === "full" ? "F" : "s");
}

/**
 * The zone's short name at that moment, following daylight saving: `CDT`/`CST`,
 * `MST` (Phoenix); zones without a US-style abbreviation give an offset (`GMT+2`).
 */
export function zoneAbbrev(date: Date, timezone: string): string {
  const when = DateTime.fromJSDate(date, { zone: timezone }).setLocale("en-US");
  return when.isValid ? when.toFormat("ZZZZ") : timezone;
}

/** The zone's DST-neutral name, for weekly nights: `Central Time`, `Central European Time`. Falls back to the IANA name. */
export function zoneGenericName(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longGeneric" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone; // not a zone Intl knows
  }
}
