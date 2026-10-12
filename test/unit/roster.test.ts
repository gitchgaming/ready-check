import { describe, expect, it } from "vitest";
import { ensureMembersCached, fetchRosterMembers, rosterMemberIds } from "../../src/lib/roster.js";
import { fakeGuild, fakeMember, raider, teamRole } from "../discord.js";

describe("roster membership", () => {
  const alice = raider("Alice", [], "u-alice");
  const bob = raider("Bob", [], "u-bob");
  const bot = fakeMember({ id: "u-bot", name: "Bot", roles: [teamRole], bot: true });
  const outsider = fakeMember({ id: "u-out", name: "Outsider", roles: ["Warriors"] });
  const members = [alice, bob, bot, outsider];

  it("rosterMemberIds lists non-bot holders of the role", async () => {
    const guild = fakeGuild({ members });
    expect(await rosterMemberIds(guild, teamRole.id)).toEqual(new Set(["u-alice", "u-bob"]));
  });

  it("fetchRosterMembers returns the same members as objects", async () => {
    const guild = fakeGuild({ members });
    expect(await fetchRosterMembers(guild, teamRole.id)).toEqual([alice, bob]);
  });

  it("doesn't fetch the member list when the cache is complete", async () => {
    const guild = fakeGuild({ members });
    await rosterMemberIds(guild, teamRole.id);
    await fetchRosterMembers(guild, teamRole.id);
    await ensureMembersCached(guild);
    expect(guild.fullFetches).toBe(0);
  });

  it("fetches the full member list when the cache is missing members", async () => {
    const guild = fakeGuild({ members, memberCount: 10 });
    await ensureMembersCached(guild);
    expect(guild.fullFetches).toBe(1);
    await fetchRosterMembers(guild, teamRole.id);
    expect(guild.fullFetches).toBe(2);
  });
});
