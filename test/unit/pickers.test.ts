import { describe, expect, it } from "vitest";
import {
  MAX_CHOICES,
  NO_CHOICE,
  dateChoice,
  formatNight,
  formatRaidLabel,
  parseTypedDate,
  respondFiltered,
  teamDisplayName,
  timezoneChoices,
  upcomingDateChoices,
} from "../../src/lib/pickers.js";
import { DateTime } from "luxon";
import { fakeAutocomplete, fakeGuild, fakeRole, teamRole } from "../discord.js";
import { freezeTime, team } from "./fixtures.js";

const CHICAGO = "America/Chicago";
const iso = (d: DateTime | null) => d?.toISODate() ?? null;

describe("parseTypedDate", () => {
  // Tue Oct 6 2026, 7 AM in Chicago.
  const NOW = "2026-10-06T12:00:00Z";

  it.each([
    ["2026-10-20"],
    ["10/20/2026"],
    ["10/20/26"],
    ["Oct 20 2026"],
    ["Oct 20, 2026"],
    ["October 20 2026"],
    ["October 20, 2026"],
    ["  10/20/2026  "],
  ])("reads %j as Oct 20 2026", (typed) => {
    freezeTime(NOW);
    expect(iso(parseTypedDate(typed, CHICAGO))).toBe("2026-10-20");
  });

  it.each([["10/20"], ["Oct 20"], ["October 20"], ["oct 20"]])("reads year-less %j as this year's date", (typed) => {
    freezeTime(NOW);
    expect(iso(parseTypedDate(typed, CHICAGO))).toBe("2026-10-20");
  });

  it("returns midnight in the team's timezone", () => {
    freezeTime(NOW);
    const date = parseTypedDate("10/20/2026", "Europe/Berlin")!;
    expect(date.zoneName).toBe("Europe/Berlin");
    expect(date.toISO()).toBe("2026-10-20T00:00:00.000+02:00");
  });

  it("rolls a year-less date that already passed this year to next year", () => {
    freezeTime(NOW);
    expect(iso(parseTypedDate("3/1", CHICAGO))).toBe("2027-03-01");
    expect(iso(parseTypedDate("Jan 5", CHICAGO))).toBe("2027-01-05");
  });

  it("accepts today, typed with or without the year", () => {
    freezeTime(NOW);
    expect(iso(parseTypedDate("10/6", CHICAGO))).toBe("2026-10-06");
    expect(iso(parseTypedDate("2026-10-06", CHICAGO))).toBe("2026-10-06");
  });

  it("rejects a past date that has a year", () => {
    freezeTime(NOW);
    expect(parseTypedDate("10/5/2026", CHICAGO)).toBeNull();
    expect(parseTypedDate("2025-12-31", CHICAGO)).toBeNull();
  });

  it("accepts up to two years ahead and rejects anything later", () => {
    freezeTime(NOW);
    expect(iso(parseTypedDate("2028-10-06", CHICAGO))).toBe("2028-10-06");
    expect(parseTypedDate("2028-10-07", CHICAGO)).toBeNull();
  });

  it.each(["", "   ", "tomorrow", "13/1/2026", "2026-02-30", "20/10", "10-20"])("rejects %j", (typed) => {
    freezeTime(NOW);
    expect(parseTypedDate(typed, CHICAGO)).toBeNull();
  });

  it("decides 'today' in the team's timezone, not the server's UTC clock", () => {
    // 10 PM Tue Oct 6 in Chicago, already Wed Oct 7 in UTC.
    freezeTime("2026-10-07T03:00:00Z");
    expect(iso(parseTypedDate("10/6/2026", CHICAGO))).toBe("2026-10-06");
    expect(parseTypedDate("10/6/2026", "UTC")).toBeNull();
    // Year-less: still today in Chicago, already past (so next year) in UTC.
    expect(iso(parseTypedDate("10/6", CHICAGO))).toBe("2026-10-06");
    expect(iso(parseTypedDate("10/6", "UTC"))).toBe("2027-10-06");
  });
});

describe("dateChoice", () => {
  it("shows the full weekday and date, with an ISO date value", () => {
    const date = DateTime.fromISO("2026-11-01", { zone: CHICAGO });
    expect(dateChoice(date)).toEqual({ name: "Sunday, Nov 1, 2026", value: "2026-11-01" });
  });
});

describe("upcomingDateChoices", () => {
  it("lists one choice per day from today, MAX_CHOICES of them when nothing is typed", () => {
    freezeTime("2026-10-06T12:00:00Z");
    const choices = upcomingDateChoices(CHICAGO, "");
    expect(choices).toHaveLength(MAX_CHOICES);
    expect(choices[0]).toEqual({ name: "Tuesday, Oct 6, 2026", value: "2026-10-06" });
    expect(choices[1]!.value).toBe("2026-10-07");
    expect(choices.at(-1)!.value).toBe("2026-10-30");
  });

  it("looks further ahead (120 days) once the user types, for filtering", () => {
    freezeTime("2026-10-06T12:00:00Z");
    const choices = upcomingDateChoices(CHICAGO, "feb");
    expect(choices).toHaveLength(120);
    expect(choices.at(-1)!.value).toBe("2027-02-02");
    expect(new Set(choices.map((c) => c.value)).size).toBe(120);
  });

  it("starts from today in the team's timezone", () => {
    // Late Tuesday evening in Chicago is already Wednesday in UTC and Tokyo.
    freezeTime("2026-10-07T03:00:00Z");
    expect(upcomingDateChoices(CHICAGO, "")[0]!.value).toBe("2026-10-06");
    expect(upcomingDateChoices("UTC", "")[0]!.value).toBe("2026-10-07");
    expect(upcomingDateChoices("Asia/Tokyo", "")[0]!.value).toBe("2026-10-07");
  });

  it("steps by calendar day across a DST change", () => {
    freezeTime("2026-10-30T12:00:00Z");
    const values = upcomingDateChoices(CHICAGO, "").slice(0, 4).map((c) => c.value);
    expect(values).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("formatRaidLabel", () => {
  // 8 PM Wed Oct 7 in Chicago = 01:00 Thu Oct 8 UTC.
  const start = new Date("2026-10-08T01:00:00Z");

  it("formats in the team's timezone, not UTC", () => {
    expect(formatRaidLabel(start, CHICAGO)).toBe("Wed, Oct 7 · 8:00 PM");
    expect(formatRaidLabel(start, "UTC")).toBe("Thu, Oct 8 · 1:00 AM");
    expect(formatRaidLabel(start, "Europe/London")).toBe("Thu, Oct 8 · 2:00 AM");
  });

  it("follows the zone's DST offset", () => {
    // After Nov 1 Chicago is UTC-6, so 8 PM local is 02:00Z.
    expect(formatRaidLabel(new Date("2026-11-05T02:00:00Z"), CHICAGO)).toBe("Wed, Nov 4 · 8:00 PM");
  });
});

describe("formatNight", () => {
  it.each([
    [2, 20, 0, "Tuesday 8:00 PM"],
    [7, 9, 5, "Sunday 9:05 AM"],
    [1, 0, 0, "Monday 12:00 AM"],
    [5, 12, 30, "Friday 12:30 PM"],
  ])("day %i at %i:%i is %j", (day, hour, minute, expected) => {
    expect(formatNight(day, hour, minute)).toBe(expected);
  });

  it("names an out-of-range day rather than throwing", () => {
    expect(formatNight(8, 20, 0)).toBe("Day 8 8:00 PM");
  });
});

describe("teamDisplayName", () => {
  const guild = fakeGuild({ roles: [teamRole, fakeRole("Other")] });

  it("uses the team's own name first", () => {
    expect(teamDisplayName(team({ name: "Alt Raid" }), guild)).toBe("Alt Raid");
  });

  it("falls back to the team role's name", () => {
    expect(teamDisplayName(team({ name: null }), guild)).toBe(teamRole.name);
  });

  it("falls back to 'Raid' when the role is gone or there's no guild", () => {
    expect(teamDisplayName(team({ name: null, roleId: "deleted-role" }), guild)).toBe("Raid");
    expect(teamDisplayName(team({ name: null }), null)).toBe("Raid");
  });
});

describe("timezoneChoices", () => {
  const choices = timezoneChoices();

  it("lists common zones first, in a fixed order", () => {
    expect(choices.slice(0, 3).map((c) => c.value)).toEqual(["America/New_York", "America/Chicago", "America/Denver"]);
    const london = choices.findIndex((c) => c.value === "Europe/London");
    const africa = choices.findIndex((c) => c.value.startsWith("Africa/"));
    expect(london).toBeLessThan(MAX_CHOICES);
    expect(africa).toBeGreaterThan(london);
  });

  it("covers every zone the runtime supports, each once", () => {
    const values = choices.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(values)).toEqual(new Set(Intl.supportedValuesOf("timeZone")));
  });

  it("shows underscores as spaces but keeps the IANA name as the value", () => {
    expect(choices.find((c) => c.value === "America/Los_Angeles")!.name).toBe("America/Los Angeles");
    expect(choices.every((c) => !c.name.includes("_"))).toBe(true);
  });

  it("only offers zones Luxon accepts", () => {
    expect(choices.every((c) => DateTime.now().setZone(c.value).isValid)).toBe(true);
  });
});

describe("respondFiltered", () => {
  const choices = [
    { name: "Wed, Oct 7 · 8:00 PM", value: "raid-a" },
    { name: "Thu, Oct 8 · 8:00 PM", value: "raid-b" },
    { name: "Wed, Oct 14 · 8:00 PM", value: "raid-c" },
  ];
  const autocomplete = (typed: string) => fakeAutocomplete({ focused: "date", options: { date: typed } });

  it("responds with everything when nothing is typed", async () => {
    const interaction = autocomplete("");
    await respondFiltered(interaction, choices, "none");
    expect(interaction.responses).toEqual([choices]);
  });

  it("filters by name, case-insensitively", async () => {
    const interaction = autocomplete("WED");
    await respondFiltered(interaction, choices, "none");
    expect(interaction.responses[0]!.map((c) => c.value)).toEqual(["raid-a", "raid-c"]);
  });

  it("also matches the value", async () => {
    const interaction = autocomplete("raid-b");
    await respondFiltered(interaction, choices, "none");
    expect(interaction.responses[0]!.map((c) => c.value)).toEqual(["raid-b"]);
  });

  it("falls back to the full list when nothing matches", async () => {
    const interaction = autocomplete("10/5");
    await respondFiltered(interaction, choices, "none");
    expect(interaction.responses).toEqual([choices]);
  });

  it("shows the empty message as a placeholder choice when there are no choices", async () => {
    const interaction = autocomplete("anything");
    await respondFiltered(interaction, [], "No raids coming up");
    expect(interaction.responses).toEqual([[{ name: "No raids coming up", value: NO_CHOICE }]]);
  });

  it("caps the response at Discord's 25 choices, keeping the first ones", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Raid ${i}`, value: `r${i}` }));
    const unfiltered = autocomplete("");
    await respondFiltered(unfiltered, many, "none");
    expect(unfiltered.responses[0]).toEqual(many.slice(0, MAX_CHOICES));

    const filtered = autocomplete("raid 1");
    await respondFiltered(filtered, many, "none");
    // "Raid 1" and "Raid 10".."Raid 19": 11 matches, under the cap.
    expect(filtered.responses[0]).toHaveLength(11);

    const fallback = autocomplete("zzz");
    await respondFiltered(fallback, many, "none");
    expect(fallback.responses[0]).toHaveLength(MAX_CHOICES);
  });
});
