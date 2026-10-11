import { describe, expect, it } from "vitest";
import { describeGuild, describeGuilds } from "../../src/lib/guilds.js";

const guild = (name: string, id: string, joinedAt: string | null, memberCount = 10) => ({
  id,
  name,
  memberCount,
  joinedAt: joinedAt ? new Date(joinedAt) : null,
});

describe("describeGuild", () => {
  it("names the server with its id, size and join date", () => {
    expect(describeGuild(guild("Raid Guild", "123", "2026-10-04T18:30:00Z", 42))).toBe(
      '"Raid Guild" (123) · 42 members · joined 2026-10-04',
    );
  });

  it("says when the join date is unknown", () => {
    expect(describeGuild(guild("Mystery", "9", null))).toContain("joined unknown");
  });
});

describe("describeGuilds", () => {
  it("lists every server under a count, oldest join first", () => {
    const text = describeGuilds([guild("New", "2", "2026-10-10T00:00:00Z"), guild("Old", "1", "2026-10-04T00:00:00Z")]);
    expect(text.split("\n")).toEqual([
      "Servers (2):",
      '  "Old" (1) · 10 members · joined 2026-10-04',
      '  "New" (2) · 10 members · joined 2026-10-10',
    ]);
  });
});
