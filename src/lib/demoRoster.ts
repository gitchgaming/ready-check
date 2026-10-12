// STAGING DEMO ONLY: drop this commit before merging.
// On a staging branch deploy, every team's roster gets these fake raiders on top
// of its real members, so the schedule post shows every class and role icon.
import { Collection, type GuildMember } from "discord.js";
import { prisma } from "./db.js";
import { lanesEnabled, readDeployInfo } from "./lanes.js";

export function demoRosterEnabled(): boolean {
  return lanesEnabled() && readDeployInfo() !== null;
}

const RAIDERS: [string, string, ...string[]][] = [
  ["Tankalot", "Warrior", "Tank"],
  ["Bulwark", "Warrior", "Tank"],
  ["Bearly", "Druid", "Tank"],
  ["Shieldy", "Paladin", "Tank"],
  ["Mendy", "Priest", "Healer"],
  ["Halo", "Priest", "Healer"],
  ["Lightwell", "Paladin", "Healer"],
  ["Totem", "Shaman", "Healer"],
  ["Bark", "Druid", "Healer"],
  ["Axe", "Warrior", "DPS", "Offtank"],
  ["Grunt", "Warrior", "DPS"],
  ["Retbro", "Paladin", "DPS", "Offtank", "Offheals"],
  ["Stabby", "Rogue", "DPS"],
  ["Shiv", "Rogue", "DPS"],
  ["Arrow", "Hunter", "DPS"],
  ["Volley", "Hunter", "DPS"],
  ["Zap", "Mage", "DPS"],
  ["Frosty", "Mage", "DPS"],
  ["Blink", "Mage", "DPS"],
  ["Doom", "Warlock", "DPS"],
  ["Fear", "Warlock", "DPS"],
  ["Enh", "Shaman", "DPS", "Offheals"],
  ["Moonkin", "Druid", "DPS", "Offheals"],
  ["Shadow", "Priest", "DPS"],
  ["Newbie", ""],
];
/** Called out of every open raid, so the Called Out block shows class icons too. */
const CALLED_OUT = ["Frosty", "Volley", "Lightwell"];

const demoId = (name: string) => `demo-${name.toLowerCase()}`;

const MEMBERS = RAIDERS.map(([name, ...roles]) => {
  const cache = new Collection(roles.filter(Boolean).map((r, i) => [`demo-role-${i}`, { name: r }]));
  return { id: demoId(name), displayName: name, user: { bot: false }, roles: { cache } } as unknown as GuildMember;
});

export function demoMembers(): GuildMember[] {
  return demoRosterEnabled() ? MEMBERS : [];
}

/** Marks the demo call-outs on every open raid. The branch lane's database is a throwaway copy. */
export async function seedDemoCallOuts(): Promise<void> {
  if (!demoRosterEnabled()) return;
  const raids = await prisma.raidInstance.findMany({ where: { startsAt: { gt: new Date() } }, select: { id: true } });
  for (const raid of raids) {
    for (const name of CALLED_OUT) {
      const userId = demoId(name);
      await prisma.attendance.upsert({
        where: { raidInstanceId_userId: { raidInstanceId: raid.id, userId } },
        create: { raidInstanceId: raid.id, userId, status: "OUT" },
        update: { status: "OUT" },
      });
    }
  }
}
