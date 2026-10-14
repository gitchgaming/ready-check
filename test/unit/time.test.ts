import { describe, expect, it } from "vitest";
import { discordTime, formatClock, parseTime, raidTime, readTimes, timeValue, zoneAbbrev, zoneGenericName } from "../../src/lib/time.js";

describe("readTimes and parseTime", () => {
  it.each([
    ["20:00", [[20, 0]]],
    ["0:00", [[0, 0]]],
    ["23:59", [[23, 59]]],
    ["2030", [[20, 30]]],
    ["20", [[20, 0]]],
    ["8pm", [[20, 0]]],
    ["8 PM", [[20, 0]]],
    ["8:30 p.m.", [[20, 30]]],
    ["12am", [[0, 0]]],
    ["12pm", [[12, 0]]],
    ["11a", [[11, 0]]],
    ["07:05", [[7, 5]]],
    // A bare hour from 1 to 11 could be either: evening first.
    ["7:05", [[19, 5], [7, 5]]],
    ["830", [[20, 30], [8, 30]]],
    ["12", [[12, 0]]],
  ])("reads %s", (input, expected) => {
    const times = expected.map(([hour, minute]) => ({ hour, minute }));
    expect(readTimes(input)).toEqual(times);
    expect(parseTime(input)).toEqual(times[0]);
  });

  it.each(["24:00", "12:60", "7:5", "", "noon", "13pm", "0am", "-1:00"])("rejects %j", (input) => {
    expect(readTimes(input)).toEqual([]);
    expect(parseTime(input)).toBeNull();
  });

  it("formats a clock time and a choice value", () => {
    expect(formatClock({ hour: 20, minute: 5 })).toBe("8:05 PM");
    expect(timeValue({ hour: 7, minute: 5 })).toBe("07:05");
  });
});

describe("discordTime and raidTime", () => {
  // 8 PM Wed Oct 7 in Chicago = 01:00 Thu Oct 8 UTC.
  const start = new Date("2026-10-08T01:00:00Z");

  it("writes Discord's timestamp markup for the moment, in whole seconds", () => {
    expect(discordTime(start, "R")).toBe("<t:1791421200:R>");
    expect(discordTime(new Date(start.getTime() + 999), "t")).toBe("<t:1791421200:t>");
  });

  it("shows a raid with its weekday, date and time", () => {
    expect(raidTime(start)).toBe("<t:1791421200:F>");
  });
});

describe("zoneAbbrev", () => {
  it.each([
    ["America/Chicago", "2026-07-01T12:00:00Z", "CDT"],
    ["America/Chicago", "2026-12-01T12:00:00Z", "CST"],
    ["America/New_York", "2026-07-01T12:00:00Z", "EDT"],
    ["America/Phoenix", "2026-07-01T12:00:00Z", "MST"],
    ["America/Phoenix", "2026-12-01T12:00:00Z", "MST"],
    ["Europe/Berlin", "2026-07-01T12:00:00Z", "GMT+2"],
    ["Europe/Berlin", "2026-12-01T12:00:00Z", "GMT+1"],
    ["Asia/Tokyo", "2026-07-01T12:00:00Z", "GMT+9"],
    ["UTC", "2026-07-01T12:00:00Z", "UTC"],
  ])("%s at %s is %s", (zone, iso, expected) => {
    expect(zoneAbbrev(new Date(iso), zone)).toBe(expected);
  });

  it("falls back to the zone as given if it isn't valid", () => {
    expect(zoneAbbrev(new Date(), "Not/AZone")).toBe("Not/AZone");
  });
});

describe("zoneGenericName", () => {
  it.each([
    ["America/Chicago", "Central Time"],
    ["America/Phoenix", "Mountain Standard Time"],
    ["Europe/Berlin", "Central European Time"],
    ["Asia/Tokyo", "Japan Standard Time"],
  ])("%s is %s", (zone, expected) => {
    expect(zoneGenericName(zone)).toBe(expected);
  });

  it("falls back to the zone as given if it isn't valid", () => {
    expect(zoneGenericName("Not/AZone")).toBe("Not/AZone");
  });
});
