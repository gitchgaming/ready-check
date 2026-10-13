import { describe, expect, it } from "vitest";
import { discordTime, parseHourMinute, raidTime, zoneAbbrev, zoneGenericName } from "../../src/lib/time.js";

describe("parseHourMinute", () => {
  it.each([
    ["20:00", { hour: 20, minute: 0 }],
    ["0:00", { hour: 0, minute: 0 }],
    ["23:59", { hour: 23, minute: 59 }],
    ["7:05", { hour: 7, minute: 5 }],
  ])("parses %s", (input, expected) => {
    expect(parseHourMinute(input)).toEqual(expected);
  });

  it.each(["24:00", "12:60", "7:5", "", "noon", "20", "-1:00"])("rejects %j", (input) => {
    expect(parseHourMinute(input)).toBeNull();
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
