import { DateTime } from "luxon";

export interface HourMinute {
  hour: number;
  minute: number;
}

/**
 * Reads a typed time of day: `20:00`, `8pm`, `8:30 PM`, `2030`. A bare hour from 1
 * to 11 with no am/pm could be either, so it reads as both, evening first, since
 * raids are in the evening (`08:30`, with its leading zero, is morning only).
 * Empty when it can't be read.
 */
export function readTimes(input: string): HourMinute[] {
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(input.trim());
  if (!match) return [];
  const [, hourText, minuteText, suffix] = match;
  const typedHour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (minute > 59) return [];
  if (suffix) {
    if (typedHour < 1 || typedHour > 12) return [];
    return [{ hour: (typedHour % 12) + (suffix.toLowerCase() === "p" ? 12 : 0), minute }];
  }
  if (typedHour > 23) return [];
  if (typedHour >= 1 && typedHour <= 11 && !hourText!.startsWith("0")) {
    return [{ hour: typedHour + 12, minute }, { hour: typedHour, minute }];
  }
  return [{ hour: typedHour, minute }];
}

/** A typed time as `readTimes` reads it first, or null. */
export function parseTime(input: string): HourMinute | null {
  return readTimes(input)[0] ?? null;
}

/** `20:30` → `8:30 PM`. */
export function formatClock({ hour, minute }: HourMinute): string {
  return DateTime.fromObject({ hour, minute }).toFormat("h:mm a");
}

/** `20:30`, the value a time choice carries. */
export function timeValue({ hour, minute }: HourMinute): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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

/** A weekly night's next start after `from`, in team time (a night is a wall-clock rule there). */
export function nextOccurrence(
  dayOfWeek: number,
  hour: number,
  minute: number,
  timezone: string,
  from: DateTime,
): DateTime {
  let candidate = from.setZone(timezone).set({ hour, minute, second: 0, millisecond: 0 });
  const diff = (dayOfWeek - candidate.weekday + 7) % 7;
  candidate = candidate.plus({ days: diff });
  if (candidate <= from) candidate = candidate.plus({ weeks: 1 });
  return candidate;
}
