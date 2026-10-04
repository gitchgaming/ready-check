import type { ButtonInteraction, Client } from "discord.js";
import { deleteMessage } from "../commands/raidlead/shared.js";
import { isOfficer } from "../lib/access.js";
import { prisma } from "../lib/db.js";

/** customId shape: "teamdelete:<confirm|abort>:<raidTeamId>", from /raidlead team delete. */
export function isTeamDeleteButton(customId: string): boolean {
  return customId.startsWith("teamdelete:");
}

export async function handleTeamDeleteButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const [, action, teamId] = interaction.customId.split(":");

  if (action === "abort") {
    await interaction.update({ content: "Kept the team. Nothing was deleted.", components: [] });
    return;
  }

  if (!isOfficer(interaction)) {
    await interaction.update({ content: "Only officers can delete raid teams.", components: [] });
    return;
  }

  const team = await prisma.raidTeam.findUnique({ where: { id: teamId } });
  if (!team) {
    await interaction.update({ content: "That team was already deleted.", components: [] });
    return;
  }

  if (team.messageId) await deleteMessage(client, team.channelId, team.messageId);

  // Weekly nights, raids, and their call-outs cascade with the team.
  await prisma.raidTeam.delete({ where: { id: team.id } });

  await interaction.update({ content: `🗑️ Deleted **${team.name ?? "the team"}**.`, components: [] });
}
