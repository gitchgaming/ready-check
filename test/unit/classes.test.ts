import { beforeEach, describe, expect, it } from "vitest";
import { CLASSES, RAID_TYPES, memberClass, memberRaidType, raidTypeIcon } from "../../src/lib/classes.js";
import { loadAppEmojis } from "../../src/lib/emojis.js";
import { fakeClient, fakeMember } from "../discord.js";

const member = (...roles: string[]) => fakeMember({ name: "Someone", roles });
const type = (label: string) => RAID_TYPES.find((t) => t.label === label)!;
const cls = (label: string) => CLASSES.find((c) => c.label === label)!;

beforeEach(async () => {
  await loadAppEmojis(fakeClient({ emojis: [] }));
});

describe("memberClass", () => {
  it.each(["Warriors", "Warrior", "warriors", "WARRIOR"])("matches the Warrior class from a role named %j", (role) => {
    expect(memberClass(member(role))?.label).toBe("Warrior");
  });

  it("recognises every class by its plural and singular role name", () => {
    for (const c of CLASSES) {
      expect(memberClass(member(`${c.label}s`))).toBe(c);
      expect(memberClass(member(c.label))).toBe(c);
    }
  });

  it("ignores unrelated roles and returns undefined without a class role", () => {
    expect(memberClass(member())).toBeUndefined();
    expect(memberClass(member("Main Raid", "Tanks", "Officer"))).toBeUndefined();
    // Near misses don't count: the whole name must match.
    expect(memberClass(member("Warriorz", "Mage Tower"))).toBeUndefined();
  });

  it("finds the class among other roles", () => {
    expect(memberClass(member("Main Raid", "Druids", "Healers"))).toBe(cls("Druid"));
  });

  it("picks the first class in CLASSES order when a member has two", () => {
    expect(memberClass(member("Mages", "Warriors"))).toBe(cls("Warrior"));
  });
});

describe("memberRaidType", () => {
  it.each([
    ["Tanks", "Tanks"],
    ["tank", "Tanks"],
    ["Healers", "Healers"],
    ["HEALER", "Healers"],
    ["DPS", "DPS"],
    ["dps", "DPS"],
    ["Wizards", "DPS"],
    ["Phys", "DPS"],
  ])("maps role %j to %s", (role, label) => {
    expect(memberRaidType(member(role))).toBe(type(label));
  });

  it("counts a raider once by priority Tank > Healer > DPS", () => {
    expect(memberRaidType(member("DPS", "Healers", "Tanks"))).toBe(type("Tanks"));
    expect(memberRaidType(member("Wizards", "Healer"))).toBe(type("Healers"));
    expect(memberRaidType(member("Phys", "Wizards"))).toBe(type("DPS"));
  });

  it("returns undefined with no type role", () => {
    expect(memberRaidType(member("Warriors"))).toBeUndefined();
  });
});

describe("raidTypeIcon", () => {
  it("uses Unicode icons when no application emoji is loaded", () => {
    expect(raidTypeIcon(type("Tanks"))).toBe("🛡️");
    expect(raidTypeIcon(type("Healers"))).toBe("➕");
    expect(raidTypeIcon(type("DPS"))).toBe("⚔️");
  });

  it("uses each type's application emoji once it's loaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["tank", "healer", "dps"] }));
    expect(raidTypeIcon(type("Tanks"))).toBe("<:tank:9000>");
    expect(raidTypeIcon(type("Healers"))).toBe("<:healer:9001>");
    expect(raidTypeIcon(type("DPS"))).toBe("<:dps:9002>");
  });
});
