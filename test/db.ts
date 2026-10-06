import { DateTime } from "luxon";
import { prisma } from "../src/lib/db.js";
import type { RaidTeam } from "../src/generated/prisma/client.js";

export { prisma };

export const GUILD_ID = "guild-1";
export const ROLE_ID = "role-team";
export const CHANNEL_ID = "channel-1";

/** Empties every table, children first. Call in `beforeEach` of any DB test. */
export async function resetDb(): Promise<void> {
  await prisma.attendance.deleteMany();
  await prisma.raidInstance.deleteMany();
  await prisma.raidSlot.deleteMany();
  await prisma.raidTeam.deleteMany();
}

export async function makeTeam(overrides: Partial<Omit<RaidTeam, "id" | "createdAt">> = {}): Promise<RaidTeam> {
  return prisma.raidTeam.create({
    data: {
      guildId: GUILD_ID,
      roleId: ROLE_ID,
      channelId: CHANNEL_ID,
      timezone: "America/Chicago",
      name: "Main Raid",
      ...overrides,
    },
  });
}

export async function makeSlot(teamId: string, dayOfWeek: number, hour = 20, minute = 0) {
  return prisma.raidSlot.create({ data: { raidTeamId: teamId, dayOfWeek, hour, minute } });
}

/** A raid instance; `startsAt` may be a Date, an ISO string, or a Luxon DateTime. */
export async function makeRaid(
  teamId: string,
  startsAt: Date | string | DateTime,
  overrides: { closed?: boolean; cancelled?: boolean; oneOff?: boolean } = {},
) {
  const date =
    startsAt instanceof Date ? startsAt : typeof startsAt === "string" ? new Date(startsAt) : startsAt.toJSDate();
  return prisma.raidInstance.create({ data: { raidTeamId: teamId, startsAt: date, ...overrides } });
}

export async function callOut(raidInstanceId: string, userId: string) {
  return prisma.attendance.create({ data: { raidInstanceId, userId, status: "OUT" } });
}

/** A raid row with its attendance included, the shape the message builders take. */
export async function raidWithAttendance(id: string) {
  return prisma.raidInstance.findUniqueOrThrow({ where: { id }, include: { attendance: true } });
}
