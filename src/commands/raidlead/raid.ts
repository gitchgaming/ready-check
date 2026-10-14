import type { ChatInputCommandInteraction, Client } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { DateTime } from "luxon";
import type { RaidInstance, RaidTeam } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { formatRaidLabel, parseTypedDate } from "../../lib/pickers.js";
import { formatFinalRaidDate, renderTeamMessage, scheduleCutoff } from "../../lib/scheduler.js";
import { parseTime, raidTime } from "../../lib/time.js";
import { requireTeam } from "./shared.js";

/**
 * The reply to cancelling or restoring a raid, with an Undo button
 * (`raidlead:cancel:<raidId>:<1|0>`, the state to go back to).
 */
export function cancelReply(raidId: string, startsAt: Date, cancelled: boolean) {
  const label = raidTime(startsAt);
  return {
    content: cancelled ? `🚫 Cancelled the raid on ${label}.` : `✅ Restored the raid on ${label}.`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`raidlead:cancel:${raidId}:${cancelled ? 0 : 1}`)
          .setLabel("Undo")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/**
 * The reply to removing a one-off raid, with an Undo button that adds it back
 * (`raidlead:readd:<teamId>:<unix seconds>`; its call-outs are gone).
 */
export function removedReply(teamId: string, startsAt: Date) {
  return {
    content: `🗑️ Removed the one-off raid on ${raidTime(startsAt)}.`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`raidlead:readd:${teamId}:${Math.floor(startsAt.getTime() / 1000)}`)
          .setLabel("Undo")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/** Cancels or restores a raid and returns the reply. */
export async function setCancelled(raid: RaidInstance, cancelled: boolean) {
  await prisma.raidInstance.update({ where: { id: raid.id }, data: { cancelled } });
  return cancelReply(raid.id, raid.startsAt, cancelled);
}

/**
 * Deletes a one-off raid added by mistake, call-outs and all, and returns the
 * reply. A raid from a weekly night can only be cancelled: the sync would
 * bring it back.
 */
export async function removeOneOff(raid: RaidInstance) {
  await prisma.raidInstance.delete({ where: { id: raid.id } });
  return removedReply(raid.raidTeamId, raid.startsAt);
}

/**
 * Puts a one-off raid on the schedule at `startsAt` (restoring a cancelled raid
 * already there, `created` false). Returns its id, or why it can't.
 */
export async function placeOneOff(
  team: RaidTeam,
  startsAt: DateTime,
): Promise<{ id: string; created: boolean } | { problem: string }> {
  if (startsAt <= DateTime.now()) return { problem: "That time has already passed." };

  const cutoff = scheduleCutoff(team);
  if (cutoff && startsAt >= cutoff) {
    return {
      problem:
        `That's after the team's final raid date, ${formatFinalRaidDate(team)}. ` +
        "Move or clear it with `/raidlead team settings final-raid:`.",
    };
  }

  const existing = await prisma.raidInstance.findUnique({
    where: { raidTeamId_startsAt: { raidTeamId: team.id, startsAt: startsAt.toJSDate() } },
  });
  if (existing && !existing.cancelled) return { problem: "A raid is already scheduled at that time." };
  if (existing) {
    await prisma.raidInstance.update({ where: { id: existing.id }, data: { cancelled: false } });
    return { id: existing.id, created: false };
  }
  const created = await prisma.raidInstance.create({
    data: { raidTeamId: team.id, startsAt: startsAt.toJSDate(), oneOff: true },
  });
  return { id: created.id, created: true };
}

/** Cancels an upcoming raid, or restores a cancelled one: the picker says which. */
export async function cancel(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const instanceId = interaction.options.getString("date", true);
  const instance = await prisma.raidInstance.findFirst({ where: { id: instanceId, raidTeamId: team.id } });
  if (!instance) {
    await interaction.reply({ content: "Couldn't find that raid. Pick one from the suggestions.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (instance.closed) {
    await interaction.reply({ content: "That raid has already started or passed.", flags: MessageFlags.Ephemeral });
    return;
  }

  const reply = await setCancelled(instance, !instance.cancelled);
  await renderTeamMessage(client, team.id);
  await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
}

/** Removes a one-off raid added by mistake, with its call-outs. */
export async function remove(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const instanceId = interaction.options.getString("date", true);
  const instance = await prisma.raidInstance.findFirst({ where: { id: instanceId, raidTeamId: team.id } });
  if (!instance) {
    await interaction.reply({ content: "Couldn't find that raid. Pick one from the suggestions.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!instance.oneOff) {
    await interaction.reply({
      content: "Only one-off raids can be removed. Use `/raidlead raid cancel` for a weekly night's raid.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (instance.closed) {
    await interaction.reply({ content: "That raid has already started or passed.", flags: MessageFlags.Ephemeral });
    return;
  }

  const reply = await removeOneOff(instance);
  await renderTeamMessage(client, team.id);
  await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
}

export async function add(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const dateInput = interaction.options.getString("date", true);
  const timeInput = interaction.options.getString("time", true);
  const time = parseTime(timeInput);
  const day = parseTypedDate(dateInput, team.timezone);

  if (!day) {
    await interaction.reply({
      content: `Couldn't read "${dateInput}" as an upcoming date. Pick one from the suggestions, or type it like \`3/15/2027\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!time) {
    await interaction.reply({
      content: `Couldn't read "${timeInput}" as a time. Pick one from the suggestions, or type it like \`8pm\` or \`20:00\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const startsAt = day.set(time);
  const placed = await placeOneOff(team, startsAt);
  if ("problem" in placed) {
    await interaction.reply({ content: placed.problem, flags: MessageFlags.Ephemeral });
    return;
  }
  await renderTeamMessage(client, team.id);

  // Undo removes a new one-off, or re-cancels the cancelled raid this restored.
  const undo = placed.created ? `raidlead:remove:${placed.id}` : `raidlead:cancel:${placed.id}:1`;
  await interaction.reply({
    content: `✅ Added a raid on ${raidTime(startsAt.toJSDate())} (${formatRaidLabel(startsAt.toJSDate(), team.timezone)} in team time).`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(undo).setLabel("Undo").setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
