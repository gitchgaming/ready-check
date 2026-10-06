import { describe, expect, it } from "vitest";
import { isOfficer } from "../../src/lib/access.js";
import { WEEKDAY_CHOICES, weekdayName } from "../../src/lib/weekdays.js";
import { fakeButton, fakeChatInput, fakeGuild } from "../discord.js";

describe("isOfficer", () => {
  const guild = fakeGuild({ ownerId: "owner-1" });

  it("is true for the guild owner, even without Manage Events", () => {
    expect(isOfficer(fakeChatInput({ userId: "owner-1", guild }))).toBe(true);
  });

  it("is true for anyone with Manage Events", () => {
    expect(isOfficer(fakeChatInput({ userId: "officer", guild, officer: true }))).toBe(true);
    expect(isOfficer(fakeButton("x", { userId: "officer", guild, officer: true }))).toBe(true);
  });

  it("is false for a member who is neither", () => {
    expect(isOfficer(fakeChatInput({ userId: "raider", guild }))).toBe(false);
  });

  it("is false outside a guild, where there are no member permissions", () => {
    const dm = fakeChatInput({ userId: "owner-1" });
    (dm as unknown as { memberPermissions: unknown }).memberPermissions = null;
    expect(isOfficer(dm)).toBe(false);
  });
});

describe("weekdayName", () => {
  it("follows Luxon's numbering, 1 = Monday ... 7 = Sunday", () => {
    expect(weekdayName(1)).toBe("Monday");
    expect(weekdayName(3)).toBe("Wednesday");
    expect(weekdayName(7)).toBe("Sunday");
    expect(WEEKDAY_CHOICES.map((c) => c.value)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("names an unknown day instead of returning undefined", () => {
    expect(weekdayName(0)).toBe("Day 0");
  });
});
