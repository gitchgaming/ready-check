import { type ButtonInteraction, type Client } from "discord.js";
import { DateTime } from "luxon";
import { cancelReply, placeOneOff, setCancelled } from "../commands/raidlead/raid.js";
import { isOfficer } from "../lib/access.js";
import { officerAttendanceReply, setOut } from "../lib/attendance.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

/**
 * The Undo buttons on /raidlead replies. Each names the state to set, never a
 * toggle, so a double click can't flip it back:
 * "raidlead:cancel:<raidId>:<1|0>" (cancelled or not; cancelling a one-off
 * removes it), "raidlead:readd:<teamId>:<unix seconds>" (a removed one-off,
 * back without its call-outs) and "raidlead:att:<raidId>:<userId>:<out|in>"
 * (someone's attendance).
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

  if (kind === "readd") {
    const team = await prisma.raidTeam.findUnique({ where: { id: raidId } });
    if (!team) {
      await interaction.update({ content: "That raid team has been deleted.", components: [] });
      return;
    }
    const startsAt = DateTime.fromSeconds(Number(rest[0]));
    const placed = await placeOneOff(team, startsAt);
    if ("problem" in placed) {
      await interaction.update({ content: placed.problem, components: [] });
      return;
    }
    await renderTeamMessage(client, team.id);
    await interaction.update(cancelReply(placed.id, startsAt.toJSDate(), false));
    return;
  }

  const raid = await prisma.raidInstance.findUnique({ where: { id: raidId } });
  if (!raid || raid.closed) {
    await interaction.update({ content: "That raid has already started, passed, or been removed.", components: [] });
    return;
  }

  if (kind === "cancel") {
    const reply = await setCancelled(raid, rest[0] === "1");
    await renderTeamMessage(client, raid.raidTeamId);
    await interaction.update(reply);
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
