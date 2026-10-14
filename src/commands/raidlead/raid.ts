import type { ChatInputCommandInteraction, Client } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { formatRaidLabel, parseTypedDate } from "../../lib/pickers.js";
import { formatFinalRaidDate, renderTeamMessage, scheduleCutoff } from "../../lib/scheduler.js";
import { parseHourMinute, raidTime } from "../../lib/time.js";
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

  const cancelled = !instance.cancelled;
  await prisma.raidInstance.update({ where: { id: instance.id }, data: { cancelled } });
  await renderTeamMessage(client, team.id);
  await interaction.reply({ ...cancelReply(instance.id, instance.startsAt, cancelled), flags: MessageFlags.Ephemeral });
}

export async function add(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const dateInput = interaction.options.getString("date", true);
  const timeInput = interaction.options.getString("time", true);
  const time = parseHourMinute(timeInput);
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
      content: `"${timeInput}" isn't a valid 24-hour time. Use \`HH:MM\`, e.g. \`20:00\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const startsAt = day.set(time);
  if (startsAt <= DateTime.now()) {
    await interaction.reply({ content: "That time has already passed.", flags: MessageFlags.Ephemeral });
    return;
  }

  const cutoff = scheduleCutoff(team);
  if (cutoff && startsAt >= cutoff) {
    await interaction.reply({
      content:
        `That's after the team's final raid date, ${formatFinalRaidDate(team)}. ` +
        "Move or clear it with `/raidlead team settings final-raid:`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = await prisma.raidInstance.findUnique({
    where: { raidTeamId_startsAt: { raidTeamId: team.id, startsAt: startsAt.toJSDate() } },
  });
  if (existing && !existing.cancelled) {
    await interaction.reply({ content: "A raid is already scheduled at that time.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (existing) {
    await prisma.raidInstance.update({ where: { id: existing.id }, data: { cancelled: false } });
  } else {
    await prisma.raidInstance.create({
      data: { raidTeamId: team.id, startsAt: startsAt.toJSDate(), oneOff: true },
    });
  }
  await renderTeamMessage(client, team.id);

  await interaction.reply({
    content: `✅ Added a raid on ${raidTime(startsAt.toJSDate())} (${formatRaidLabel(startsAt.toJSDate(), team.timezone)} in team time).`,
    flags: MessageFlags.Ephemeral,
  });
}
