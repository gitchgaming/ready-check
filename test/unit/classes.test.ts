import { beforeEach, describe, expect, it } from "vitest";
import {
  CLASSES,
  OFF_SPECS,
  RAID_TYPES,
  memberClass,
  memberOffSpecs,
  memberRaidType,
  offSpecMarker,
  raidTypeIcon,
} from "../../src/lib/classes.js";
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
    ["Damage", "Damage"],
    ["DPS", "Damage"],
    ["dps", "Damage"],
    ["Wizards", "Damage"],
    ["Wizard", "Damage"],
    ["Phys", "Damage"],
    ["Physical", "Damage"],
  ])("maps role %j to %s", (role, label) => {
    expect(memberRaidType(member(role))).toBe(type(label));
  });

  it("counts a raider once by priority Tank > Healer > Damage", () => {
    expect(memberRaidType(member("DPS", "Healers", "Tanks"))).toBe(type("Tanks"));
    expect(memberRaidType(member("Wizards", "Healer"))).toBe(type("Healers"));
    expect(memberRaidType(member("Phys", "Wizards"))).toBe(type("Damage"));
  });

  it.each(["Offtank", "Offheals", "offheal"])("counts a raider with only the %j off-spec role as Damage", (role) => {
    expect(memberRaidType(member(role))).toBe(type("Damage"));
  });

  it("keeps a tank or healer in their main role whatever off-spec roles they hold", () => {
    expect(memberRaidType(member("Tanks", "Offheals"))).toBe(type("Tanks"));
    expect(memberRaidType(member("Healer", "Offtank"))).toBe(type("Healers"));
  });

  it("returns undefined with no type role", () => {
    expect(memberRaidType(member("Warriors"))).toBeUndefined();
  });
});

describe("raidTypeIcon", () => {
  it("uses Unicode icons when no application emoji is loaded", () => {
    expect(raidTypeIcon(type("Tanks"))).toBe("🛡️");
    expect(raidTypeIcon(type("Healers"))).toBe("➕");
    expect(raidTypeIcon(type("Damage"))).toBe("⚔️");
  });

  it("uses each type's application emoji once it's loaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["tank", "healer", "dps"] }));
    expect(raidTypeIcon(type("Tanks"))).toBe("<:tank:9000>");
    expect(raidTypeIcon(type("Healers"))).toBe("<:healer:9001>");
    expect(raidTypeIcon(type("Damage"))).toBe("<:dps:9002>");
  });
});

describe("memberOffSpecs", () => {
  const off = (label: string) => OFF_SPECS.find((o) => o.label === label)!;

  it.each([
    ["Offtank", "Offtank"],
    ["Offtanks", "Offtank"],
    ["Offheals", "Offheals"],
    ["Offhealer", "Offheals"],
  ])("maps role %j to %s", (role, label) => {
    expect(memberOffSpecs(member("Wizards", role))).toEqual([off(label)]);
  });

  it("lists both off-specs in OFF_SPECS order", () => {
    expect(memberOffSpecs(member("DPS", "Offheals", "Offtank"))).toEqual([off("Offtank"), off("Offheals")]);
  });

  it("is empty for tanks and healers, whose main role already says it", () => {
    expect(memberOffSpecs(member("Tanks", "Offheals"))).toEqual([]);
    expect(memberOffSpecs(member("Healers", "Offtank"))).toEqual([]);
  });

  it("uses the marker app emoji when uploaded, else the Unicode icon", async () => {
    expect(offSpecMarker(off("Offtank"))).toBe("🛡️");
    await loadAppEmojis(fakeClient({ emojis: ["mark_offtank"] }));
    expect(offSpecMarker(off("Offtank"))).toBe("<:mark_offtank:9000>");
  });
});
