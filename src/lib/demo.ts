import { Collection, type GuildMember } from "discord.js";
import { prisma } from "./db.js";

// STAGING DEMO ONLY: never merged. Adds a fake 36-raider roster to every team and
// seeds varied call-outs, so the roster layout can be seen at realistic sizes.

type Spec = [name: string, cls: string, roles: string[]];
const SPECS: Spec[] = [
  ["Ironhide", "Warriors", ["Tanks"]],
  ["Grumblebeard - Stonewall", "Paladins", ["Tanks"]],
  ["Bulwark", "Paladins", ["Tanks"]],
  ["Thornhoof", "Druids", ["Tanks"]],
  ["Lumen (Brightmoor)", "Priests", ["Healers"]],
  ["Saintly", "Priests", ["Healers"]],
  ["ripple_", "Shamans", ["Healers"]],
  ["Tidecaller", "Shamans", ["Healers"]],
  ["Mossweaver/Fern", "Druids", ["Healers"]],
  ["Dawnmend", "Paladins", ["Healers"]],
  ["Skarr", "Warriors", ["DPS", "Offtank"]],
  ["Gorehowl", "Warriors", ["Phys"]],
  ["Cleaveland", "Warriors", ["Phys"]],
  ["Retbull", "Paladins", ["DPS", "Offheals"]],
  ["Arrowyn", "Hunters", ["Phys"]],
  ["Pelt - Beastmaster", "Hunters", ["Phys"]],
  ["Volley", "Hunters", ["Phys"]],
  ["Toeknife", "Rogues", ["Phys"]],
  ["Vex", "Rogues", ["Phys"]],
  ["Shivvy", "Rogues", ["Phys"]],
  ["Umbra", "Priests", ["Wizards", "Offheals"]],
  ["Voidwhisper", "Priests", ["Wizards"]],
  ["Stormfist", "Shamans", ["Phys", "Offheals"]],
  ["Chainlight (Zapzap)", "Shamans", ["Wizards"]],
  ["Frostbyte", "Mages", ["Wizards"]],
  ["Kindle", "Mages", ["Wizards"]],
  ["Polymorphine", "Mages", ["Wizard"]],
  ["Rubyweap0n", "Mages", ["Wizards"]],
  ["Hexa", "Warlocks", ["Wizards"]],
  ["Doomwhisper", "Warlocks", ["Wizards"]],
  ["Soulstone Steve", "Warlocks", ["Damage"]],
  ["Oakheart", "Druids", ["Phys", "Offtank"]],
  ["Moonfire Mo", "Druids", ["Wizards", "Offheals", "Offtank"]],
  ["Newguy", "Rogues", []],
  ["Whoami", "", ["DPS"]],
  ["Clueless", "", []],
];

const demoId = (i: number) => String(990000000000000000n + BigInt(i));

function demoMember(i: number, [name, cls, roles]: Spec): GuildMember {
  const roleObjects = [cls, ...roles].filter(Boolean).map((n) => ({ id: `demo-${n}`, name: n }));
  const cache = new Collection(roleObjects.map((r) => [r.id, r]));
  // Holds every team role, so each team shows the demo roster.
  const has = (id: string) => id.startsWith("demo-") ? cache.has(id) : true;
  const id = demoId(i);
  return {
    id,
    displayName: name,
    user: { id, bot: false, username: name, tag: name },
    roles: { cache: Object.assign(cache, { has }) },
    toString: () => `<@${id}>`,
  } as unknown as GuildMember;
}

export const DEMO_MEMBERS: GuildMember[] = SPECS.map((s, i) => demoMember(i, s));

/** Who's out for the i-th open raid of each team: a few patterns, then repeats. */
const PATTERNS: number[][] = [
  [27], // one mage out
  [], // everyone in
  [0, 4, 5, 11, 14, 20, 24], // a tank, two healers and a spread of damage
  [4, 5, 6, 7, 8, 9], // every healer out
  Array.from({ length: 18 }, (_, k) => k * 2), // half the raid
  [0, 1, 2, 3, 10, 31], // every tank and both offtanks
];

/** Re-seeds the demo raiders' call-outs on every open raid (idempotent per boot). */
export async function seedDemoAttendance(): Promise<void> {
  const teams = await prisma.raidTeam.findMany({ select: { id: true } });
  for (const team of teams) {
    const raids = await prisma.raidInstance.findMany({
      where: { raidTeamId: team.id, closed: false },
      orderBy: { startsAt: "asc" },
      select: { id: true },
    });
    for (const [i, raid] of raids.entries()) {
      const out = new Set(PATTERNS[i % PATTERNS.length]!.map(demoId));
      await prisma.attendance.deleteMany({ where: { raidInstanceId: raid.id, userId: { startsWith: "99" } } });
      await prisma.attendance.createMany({
        data: [...out].map((userId) => ({ raidInstanceId: raid.id, userId, status: "OUT" })),
      });
    }
  }
  console.log(`Demo: seeded call-outs for ${teams.length} team(s).`);
}
