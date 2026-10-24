import type { Choice } from "./pickers.js";
import { prisma } from "./db.js";

/** Discord's own limit on a nickname, so a team name fits wherever a Discord name does. */
export const MAX_NAME_LENGTH = 32;

/** The `name` value that clears a team name, so the raider shows as their Discord name again. */
export const RESET_NAME = "<reset>";

/** A typed name on one line, with runs of whitespace collapsed; null when nothing's left. */
export function cleanName(typed: string): string | null {
  const name = typed.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
  return name || null;
}

/** Each raider's team name on one team, by user id. Raiders without one aren't in the map. */
export async function teamNames(teamId: string): Promise<Map<string, string>> {
  const rows = await prisma.raiderName.findMany({ where: { raidTeamId: teamId } });
  return new Map(rows.map((r) => [r.userId, r.name]));
}

/** Sets a raider's name on the given teams, or clears it (back to their Discord name) with null. */
export async function setTeamName(teamIds: string[], userId: string, name: string | null): Promise<void> {
  if (name === null) {
    await prisma.raiderName.deleteMany({ where: { userId, raidTeamId: { in: teamIds } } });
    return;
  }
  await prisma.$transaction(
    teamIds.map((raidTeamId) =>
      prisma.raiderName.upsert({
        where: { raidTeamId_userId: { raidTeamId, userId } },
        create: { raidTeamId, userId, name },
        update: { name },
      }),
    ),
  );
}

/**
 * The `name` picker: what's typed, first so Enter keeps it, then the choice that
 * clears it. `clearLabel` says whose Discord name that goes back to.
 */
export function nameChoices(typed: string, clearLabel: string): Choice[] {
  const name = cleanName(typed);
  const clear = { name: clearLabel, value: RESET_NAME };
  return name ? [{ name: `Show as “${name}”`, value: name }, clear] : [clear];
}
