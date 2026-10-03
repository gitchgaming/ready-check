import type { ButtonInteraction, Client } from "discord.js";
import { prisma } from "../lib/db.js";
import { buildTeamMessage } from "../lib/embeds.js";
import { PAGE_SIZE, clampOffset, instancesForWindow } from "../lib/scheduler.js";

/** customId shape: "nav:<earlier|later>:<raidTeamId>" — pages the shared schedule window. */
export function isNavButton(customId: string): boolean {
  return customId.startsWith("nav:");
}

export async function handleNavButton(interaction: ButtonInteraction, _client: Client): Promise<void> {
  const [, direction, teamId] = interaction.customId.split(":");
  if ((direction !== "earlier" && direction !== "later") || !teamId) return;

  const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
  if (!team) return;

  const requestedOffset = team.windowOffset + (direction === "earlier" ? -PAGE_SIZE : PAGE_SIZE);
  const newOffset = await clampOffset(team.id, requestedOffset);

  const updated = await prisma.raidTeam.update({
    where: { id: team.id },
    data: { windowOffset: newOffset },
  });

  const { instances, canEarlier, canLater } = await instancesForWindow(updated.id, updated.windowOffset);
  const content = buildTeamMessage(updated, instances, { canEarlier, canLater });
  await interaction.update(content);
}
