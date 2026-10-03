import type { ButtonInteraction, Client } from "discord.js";
import { prisma } from "../lib/db.js";
import { buildCalendarMessage } from "../lib/embeds.js";
import { rosterMemberIds } from "../lib/roster.js";
import { PAGE_SIZE, clampOffset, instancesForWindow } from "../lib/scheduler.js";

/**
 * customId shape: "mynav:<earlier|later>:<raidTeamId>:<currentOffset>"
 * Personal /raid-calendar paging only — nothing persisted, state lives in the
 * customId itself, so it never affects the public message or other viewers.
 */
export function isNavButton(customId: string): boolean {
  return customId.startsWith("mynav:");
}

export async function handleNavButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const [, direction, teamId, currentOffsetRaw] = interaction.customId.split(":");
  if ((direction !== "earlier" && direction !== "later") || !teamId) return;

  const currentOffset = Number(currentOffsetRaw) || 0;
  const requestedOffset = currentOffset + (direction === "earlier" ? -PAGE_SIZE : PAGE_SIZE);

  const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
  if (!team) return;

  const newOffset = await clampOffset(team.id, requestedOffset);
  const { instances, canEarlier, canLater } = await instancesForWindow(team.id, newOffset);
  const guild = await client.guilds.fetch(team.guildId);
  const rosterIds = await rosterMemberIds(guild, team.roleId);
  await interaction.update(
    buildCalendarMessage(team, instances, newOffset, { canEarlier, canLater }, rosterIds),
  );
}
