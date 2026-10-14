import { type ButtonInteraction, type Client } from "discord.js";
import { cancelReply } from "../commands/raidlead/raid.js";
import { isOfficer } from "../lib/access.js";
import { officerAttendanceReply, setOut } from "../lib/attendance.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

/**
 * The Undo buttons on /raidlead replies. Each names the state to set, never a
 * toggle, so a double click can't flip it back:
 * "raidlead:cancel:<raidId>:<1|0>" (cancelled or not) and
 * "raidlead:att:<raidId>:<userId>:<out|in>" (someone's attendance).
 */
export function isRaidleadUndo(customId: string): boolean {
  return customId.startsWith("raidlead:");
}

export async function handleRaidleadUndo(interaction: ButtonInteraction, client: Client): Promise<void> {
  if (!isOfficer(interaction)) {
    await interaction.update({ content: "Only officers can change this.", components: [] });
    return;
  }

  const [, kind, raidId, ...rest] = interaction.customId.split(":");
  const raid = await prisma.raidInstance.findUnique({ where: { id: raidId } });
  if (!raid || raid.closed) {
    await interaction.update({ content: "That raid has already started, passed, or been removed.", components: [] });
    return;
  }

  if (kind === "cancel") {
    const cancelled = rest[0] === "1";
    await prisma.raidInstance.update({ where: { id: raid.id }, data: { cancelled } });
    await renderTeamMessage(client, raid.raidTeamId);
    await interaction.update(cancelReply(raid.id, raid.startsAt, cancelled));
    return;
  }

  if (kind === "att") {
    const [userId, state] = rest;
    if (raid.cancelled) {
      await interaction.update({ content: "That raid has been cancelled.", components: [] });
      return;
    }
    const out = state === "out";
    await setOut(raid.id, userId!, out);
    await renderTeamMessage(client, raid.raidTeamId);
    await interaction.update(officerAttendanceReply(userId!, raid.id, raid.startsAt, out));
  }
}
