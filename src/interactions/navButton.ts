import type { ButtonInteraction, Client } from "discord.js";
import { prisma } from "../lib/db.js";
import { buildTeamMessage, type ViewMode } from "../lib/embeds.js";
import { instancesForMode } from "../lib/scheduler.js";

/** customId shape: "nav:<earlier|later>:<raidTeamId>" — flips the shared upcoming/history view. */
export function isNavButton(customId: string): boolean {
  return customId.startsWith("nav:");
}

export async function handleNavButton(interaction: ButtonInteraction, _client: Client): Promise<void> {
  const [, direction, teamId] = interaction.customId.split(":");
  if ((direction !== "earlier" && direction !== "later") || !teamId) return;

  const mode: ViewMode = direction === "earlier" ? "history" : "upcoming";

  const team = await prisma.raidTeam.update({
    where: { id: teamId },
    data: { viewMode: mode },
  });

  const instances = await instancesForMode(team.id, mode);
  const content = buildTeamMessage(team, instances, mode);
  await interaction.update(content);
}
