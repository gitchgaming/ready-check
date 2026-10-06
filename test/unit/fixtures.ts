/**
 * Plain objects shaped like Prisma rows, for pure tests of the message builders.
 * Nothing here touches the database; ids and dates are fixed so output (and
 * snapshots) are deterministic.
 */
import { afterEach, vi } from "vitest";
import { DateTime } from "luxon";
import type { Attendance, RaidInstance, RaidTeam } from "../../src/generated/prisma/client.js";
import { GUILD_ID, ROLE_ID, CHANNEL_ID } from "../db.js";

export type RaidRow = RaidInstance & { attendance: Attendance[] };

/** A 25-character id, the length of a Prisma cuid, so customId lengths are realistic. */
export function cuid(seed: string | number): string {
  return `c${String(seed).padStart(24, "0")}`.slice(0, 25);
}

export const TEAM_ID = cuid("team");

export function team(overrides: Partial<RaidTeam> = {}): RaidTeam {
  return {
    id: TEAM_ID,
    guildId: GUILD_ID,
    roleId: ROLE_ID,
    channelId: CHANNEL_ID,
    timezone: "America/Chicago",
    name: "Main Raid",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    messageId: null,
    displayCount: 3,
    ...overrides,
  };
}

export interface RaidOptions {
  id?: string;
  closed?: boolean;
  cancelled?: boolean;
  oneOff?: boolean;
  /** User ids with an OUT row. */
  out?: string[];
  /** User ids with an explicit IN row (shouldn't count as call-outs). */
  in?: string[];
}

export function raid(startsAt: string | Date, opts: RaidOptions = {}): RaidRow {
  const date = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const id = opts.id ?? cuid(`r${date.getTime()}`);
  const row = (userId: string, status: string): Attendance => ({
    id: cuid(`a${id.slice(-6)}${userId}`),
    raidInstanceId: id,
    userId,
    status,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  return {
    id,
    raidTeamId: TEAM_ID,
    startsAt: date,
    closed: opts.closed ?? false,
    cancelled: opts.cancelled ?? false,
    oneOff: opts.oneOff ?? false,
    attendance: [...(opts.out ?? []).map((u) => row(u, "OUT")), ...(opts.in ?? []).map((u) => row(u, "IN"))],
  };
}

/** Weekly raids at 8:00 PM Chicago time, starting Wed Oct 7 2026; ids `cuid("raid<i>")`. */
export function weeklyRaids(count: number, opts: (i: number) => RaidOptions = () => ({})): RaidRow[] {
  const first = DateTime.fromISO("2026-10-07T20:00", { zone: "America/Chicago" });
  return Array.from({ length: count }, (_, i) =>
    raid(first.plus({ weeks: i }).toJSDate(), { id: cuid(`raid${i}`), ...opts(i) }),
  );
}

/** Fakes only `Date` (Luxon follows it) at `iso`, restored after each test. */
export function freezeTime(iso: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});
