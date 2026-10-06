import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { nextOccurrence, nextOccurrences } from "../../src/lib/scheduler.js";
import { freezeTime } from "./fixtures.js";

const CHICAGO = "America/Chicago";
const at = (isoLocal: string, zone = CHICAGO) => DateTime.fromISO(isoLocal, { zone });
const local = (d: DateTime) => d.toISO({ suppressMilliseconds: true, includeOffset: true });

// Luxon weekdays: 1 = Monday ... 7 = Sunday. Oct 6 2026 is a Tuesday.
const TUESDAY = 2;
const WEDNESDAY = 3;
const MONDAY = 1;

describe("nextOccurrence", () => {
  it("is later the same day when the start time hasn't come yet", () => {
    const next = nextOccurrence(TUESDAY, 20, 0, CHICAGO, at("2026-10-06T19:59"));
    expect(local(next)).toBe("2026-10-06T20:00:00-05:00");
  });

  it("is next week when today's start time has passed", () => {
    const next = nextOccurrence(TUESDAY, 20, 0, CHICAGO, at("2026-10-06T20:01"));
    expect(local(next)).toBe("2026-10-13T20:00:00-05:00");
  });

  it("is next week when called exactly at the start time", () => {
    const next = nextOccurrence(TUESDAY, 20, 0, CHICAGO, at("2026-10-06T20:00"));
    expect(local(next)).toBe("2026-10-13T20:00:00-05:00");
  });

  it("finds a later weekday in the same week", () => {
    const next = nextOccurrence(WEDNESDAY, 19, 30, CHICAGO, at("2026-10-06T23:00"));
    expect(local(next)).toBe("2026-10-07T19:30:00-05:00");
  });

  it("wraps past Sunday to an earlier weekday next week", () => {
    const next = nextOccurrence(MONDAY, 20, 0, CHICAGO, at("2026-10-06T12:00"));
    expect(local(next)).toBe("2026-10-12T20:00:00-05:00");
  });

  it("decides the weekday in the team's zone, not the caller's", () => {
    // 03:00Z Wed is still Tuesday 10 PM in Chicago: Tuesday's 8 PM raid has passed.
    const from = DateTime.fromISO("2026-10-07T03:00:00Z", { zone: "utc" });
    const next = nextOccurrence(WEDNESDAY, 20, 0, CHICAGO, from);
    expect(local(next)).toBe("2026-10-07T20:00:00-05:00");
    expect(next.zoneName).toBe(CHICAGO);
  });

  it("drops seconds and milliseconds", () => {
    const next = nextOccurrence(TUESDAY, 20, 0, CHICAGO, at("2026-10-06T08:15:42.123"));
    expect(next.second).toBe(0);
    expect(next.millisecond).toBe(0);
  });
});

describe("nextOccurrences", () => {
  it("returns `count` weekly dates starting from the next one", () => {
    freezeTime("2026-10-06T12:00:00Z"); // Tue 7 AM in Chicago
    const dates = nextOccurrences(TUESDAY, 20, 0, CHICAGO, 4).map(local);
    expect(dates).toEqual([
      "2026-10-06T20:00:00-05:00",
      "2026-10-13T20:00:00-05:00",
      "2026-10-20T20:00:00-05:00",
      "2026-10-27T20:00:00-05:00",
    ]);
  });

  it("returns nothing for a count of 0", () => {
    freezeTime("2026-10-06T12:00:00Z");
    expect(nextOccurrences(TUESDAY, 20, 0, CHICAGO, 0)).toEqual([]);
  });

  it("keeps 8:00 PM local across the November DST change (America/Chicago)", () => {
    // DST ends Sun Nov 1 2026: CDT (UTC-5) → CST (UTC-6).
    freezeTime("2026-10-20T12:00:00Z");
    const dates = nextOccurrences(WEDNESDAY, 20, 0, CHICAGO, 3);
    expect(dates.map(local)).toEqual([
      "2026-10-21T20:00:00-05:00",
      "2026-10-28T20:00:00-05:00",
      "2026-11-04T20:00:00-06:00",
    ]);
    expect(dates.map((d) => d.toUTC().toISO())).toEqual([
      "2026-10-22T01:00:00.000Z",
      "2026-10-29T01:00:00.000Z",
      "2026-11-05T02:00:00.000Z",
    ]);
  });

  it("keeps 8:00 PM local across the March DST change (America/Chicago)", () => {
    // DST starts Sun Mar 14 2027 (2 AM): CST (UTC-6) → CDT (UTC-5).
    freezeTime("2027-02-28T12:00:00Z");
    const dates = nextOccurrences(7, 20, 0, CHICAGO, 3); // Sundays, including the change day
    expect(dates.map(local)).toEqual([
      "2027-02-28T20:00:00-06:00",
      "2027-03-07T20:00:00-06:00",
      "2027-03-14T20:00:00-05:00",
    ]);
    vi.setSystemTime(new Date("2027-03-14T12:00:00Z")); // the change day itself, after 2 AM
    expect(nextOccurrences(7, 20, 0, CHICAGO, 2).map(local)).toEqual([
      "2027-03-14T20:00:00-05:00",
      "2027-03-21T20:00:00-05:00",
    ]);
  });

  it("keeps the local time across a Europe DST change (Europe/Berlin)", () => {
    // DST ends Sun Oct 25 2026: CEST (UTC+2) → CET (UTC+1).
    freezeTime("2026-10-18T10:00:00Z");
    const dates = nextOccurrences(7, 19, 30, "Europe/Berlin", 3);
    expect(dates.map((d) => local(d))).toEqual([
      "2026-10-18T19:30:00+02:00",
      "2026-10-25T19:30:00+01:00",
      "2026-11-01T19:30:00+01:00",
    ]);
  });
});
