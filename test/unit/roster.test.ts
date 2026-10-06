import { beforeEach, describe, expect, it } from "vitest";
import { buildRosterEmbed, ensureMembersCached, fetchRosterMembers, rosterMemberIds } from "../../src/lib/roster.js";
import { loadAppEmojis } from "../../src/lib/emojis.js";
import { fakeClient, fakeGuild, fakeMember, raider, teamRole } from "../discord.js";

beforeEach(async () => {
  await loadAppEmojis(fakeClient({ emojis: [] }));
});

const fields = (members: Parameters<typeof buildRosterEmbed>[1]) => buildRosterEmbed("Main Raid", members).toJSON().fields ?? [];
const countIn = (name: string) => Number(/\((\d+)\)$/.exec(name)![1]);

describe("buildRosterEmbed", () => {
  const roster = [
    raider("Tankalot", ["Warriors", "Tanks"]),
    raider("Bubbles", ["Paladins", "Tanks", "Healers"]), // Tank wins over Healer
    raider("Mendy", ["Priests", "Healers"]),
    raider("Zap", ["Mages", "Wizards"]),
    raider("Stabby", ["Rogues", "Phys"]),
    raider("Arrow", ["Hunters", "DPS"]),
    raider("Newbie", ["Druids"]), // no type role
    raider("Mystery", []), // no class or type role
  ];

  it("titles the embed with the team name and roster size", () => {
    expect(buildRosterEmbed("Main Raid", roster).toJSON().title).toBe("Main Raid — roster (8)");
  });

  it("has Tanks | Healers | DPS inline columns, then a full-width No type role line", () => {
    const f = fields(roster);
    expect(f.map((x) => x.name)).toEqual(["🛡️ Tanks (2)", "➕ Healers (1)", "⚔️ DPS (3)", "No type role (2)"]);
    expect(f.map((x) => x.inline ?? false)).toEqual([true, true, true, false]);
  });

  it("counts every raider exactly once across the columns", () => {
    const f = fields(roster);
    expect(f.reduce((n, x) => n + countIn(x.name), 0)).toBe(roster.length);
    expect(f[0]!.value.split("\n")).toEqual(["Tankalot", "Bubbles"]);
    expect(f[1]!.value).toBe("Mendy");
  });

  it("groups by class in CLASSES order, then alphabetically within a class", () => {
    const dps = [
      raider("Zed", ["Rogues", "DPS"]),
      raider("Brian", ["Warlocks", "DPS"]),
      raider("Amy", ["Rogues", "DPS"]),
      raider("Carl", ["Warriors", "DPS"]),
      raider("Aaron", ["DPS"]), // classless sorts last
    ];
    // CLASSES order: Warrior, ..., Rogue, ..., Warlock.
    expect(fields(dps)[2]!.value.split("\n")).toEqual(["Carl", "Amy", "Zed", "Brian", "Aaron"]);
  });

  it("puts the class emoji before the name when it's uploaded, and nothing otherwise", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior", "mage"] }));
    const f = fields([raider("Tankalot", ["Warriors", "Tanks"]), raider("Zap", ["Mages", "Wizards"]), raider("Stabby", ["Rogues", "DPS"])]);
    expect(f[0]!.value).toBe("<:warrior:9000> Tankalot");
    // Rogue comes before Mage in CLASSES; no rogue emoji is loaded, so no icon.
    expect(f[2]!.value).toBe("Stabby\n<:mage:9001> Zap");
  });

  it("shows the healer application emoji in the column header when uploaded, else ➕", async () => {
    expect(fields(roster)[1]!.name).toBe("➕ Healers (1)");
    await loadAppEmojis(fakeClient({ emojis: ["healer"] }));
    expect(fields(roster)[1]!.name).toBe("<:healer:9000> Healers (1)");
  });

  it("shows an empty column as a dash and omits No type role when everyone has one", () => {
    const f = fields([raider("Tankalot", ["Warriors", "Tanks"])]);
    expect(f.map((x) => [x.name, x.value])).toEqual([
      ["🛡️ Tanks (1)", "Tankalot"],
      ["➕ Healers (0)", "—"],
      ["⚔️ DPS (0)", "—"],
    ]);
  });

  it("joins the No type role line with commas", () => {
    expect(fields(roster)[3]!.value).toBe("Newbie, Mystery");
  });

  it("says so when no one has the role", () => {
    const embed = buildRosterEmbed("Main Raid", []).toJSON();
    expect(embed.title).toBe("Main Raid — roster (0)");
    expect(embed.description).toBe("No one has this role yet.");
    expect(embed.fields).toBeUndefined();
  });

  it("truncates a long column with '…and N more', keeping every field within 1024 characters", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior", "rogue", "mage"] }));
    const longName = (i: number) => `Raider${String(i).padStart(3, "0")}-${"x".repeat(24)}`;
    const many = Array.from({ length: 120 }, (_, i) => raider(longName(i), [["Warriors", "Rogues", "Mages"][i % 3]!, "DPS"]));
    const untyped = Array.from({ length: 80 }, (_, i) => raider(longName(500 + i), ["Warriors"]));
    const f = fields([...many, ...untyped]);

    for (const field of f) expect(field.value.length).toBeLessThanOrEqual(1024);

    const dps = f[2]!;
    expect(countIn(dps.name)).toBe(120);
    const dpsLines = dps.value.split("\n");
    const more = Number(/^…and (\d+) more$/.exec(dpsLines.at(-1)!)![1]);
    expect(dpsLines.length - 1 + more).toBe(120);

    const other = f[3]!;
    const otherEntries = other.value.split(", ");
    const otherMore = Number(/^…and (\d+) more$/.exec(otherEntries.at(-1)!)![1]);
    expect(otherEntries.length - 1 + otherMore).toBe(80);
  });

  it("keeps the last entry when it fits exactly without the '…and N more' reserve", () => {
    // 40 names of 24 chars + newline = 1000 chars: all fit, no truncation line.
    const names = Array.from({ length: 40 }, (_, i) => `R${String(i).padStart(2, "0")}${"y".repeat(21)}`);
    const value = fields(names.map((n) => raider(n, ["DPS"])))[2]!.value;
    expect(value.split("\n")).toHaveLength(40);
    expect(value).not.toContain("more");
  });
});

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
