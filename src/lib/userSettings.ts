import { prisma } from "./db.js";

/**
 * The timezone a raider set with /timezone, or null. Discord never tells a bot a
 * user's timezone, so plain-text dates (autocomplete choices, select options) use
 * this where it's set and the team's timezone otherwise. Message text needs
 * neither: it uses <t:…> timestamps, which every viewer's client converts.
 */
export async function userTimezone(userId: string): Promise<string | null> {
  const setting = await prisma.userSetting.findUnique({ where: { userId } });
  return setting?.timezone ?? null;
}

export async function setUserTimezone(userId: string, timezone: string): Promise<void> {
  await prisma.userSetting.upsert({ where: { userId }, create: { userId, timezone }, update: { timezone } });
}

export async function clearUserTimezone(userId: string): Promise<void> {
  await prisma.userSetting.deleteMany({ where: { userId } });
}
