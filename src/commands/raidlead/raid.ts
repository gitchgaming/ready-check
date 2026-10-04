import type { ChatInputCommandInteraction, Client } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { formatRaidLabel } from "../../lib/pickers.js";
import { renderTeamMessage } from "../../lib/scheduler.js";
import { parseHourMinute } from "../../lib/time.js";
import { requireTeam } from "./shared.js";

async function setCancelled(interaction: ChatInputCommandInteraction, client: Client, cancelled: boolean) {
  const team = await requireTeam(interaction);
  if (!team) return;

  const instanceId = interaction.options.getString("date", true);
  const instance = await prisma.raidInstance.findFirst({ where: { id: instanceId, raidTeamId: team.id } });
  if (!instance) {
    await interaction.reply({ content: "Couldn't find that raid. Pick one from the suggestions.", ephemeral: true });
    return;
  }
  if (instance.closed) {
    await interaction.reply({ content: "That raid has already started or passed.", ephemeral: true });
    return;
  }
  if (instance.cancelled === cancelled) {
    await interaction.reply({
      content: cancelled ? "That raid is already cancelled." : "That raid isn't cancelled.",
      ephemeral: true,
    });
    return;
  }

  await prisma.raidInstance.update({ where: { id: instance.id }, data: { cancelled } });
  await renderTeamMessage(client, team.id);

  const label = formatRaidLabel(instance.startsAt, team.timezone);
  await interaction.reply({
    content: cancelled ? `🚫 Cancelled the raid on ${label}.` : `✅ Restored the raid on ${label}.`,
    ephemeral: true,
  });
}

export async function cancel(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await setCancelled(interaction, client, true);
}

export async function restore(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  await setCancelled(interaction, client, false);
}

export async function remove(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const instanceId = interaction.options.getString("date", true);
  const instance = await prisma.raidInstance.findFirst({ where: { id: instanceId, raidTeamId: team.id } });
  if (!instance) {
    await interaction.reply({ content: "Couldn't find that raid. Pick one from the suggestions.", ephemeral: true });
    return;
  }
  if (!instance.oneOff) {
    await interaction.reply({
      content: "That raid is on a weekly raid night, so it would come back. Cancel it instead with `/raidlead raid cancel`.",
      ephemeral: true,
    });
    return;
  }

  // Attendance rows cascade with the raid.
  await prisma.raidInstance.delete({ where: { id: instance.id } });
  await renderTeamMessage(client, team.id);

  await interaction.reply({
    content: `🗑️ Removed the one-off raid on ${formatRaidLabel(instance.startsAt, team.timezone)}.`,
    ephemeral: true,
  });
}

export async function add(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const dateInput = interaction.options.getString("date", true);
  const timeInput = interaction.options.getString("time", true);
  const time = parseHourMinute(timeInput);
  const day = DateTime.fromFormat(dateInput, "yyyy-MM-dd", { zone: team.timezone });

  if (!day.isValid) {
    await interaction.reply({ content: "Pick a date from the suggestions as you type.", ephemeral: true });
    return;
  }
  if (!time) {
    await interaction.reply({
      content: `"${timeInput}" isn't a valid 24-hour time. Use \`HH:MM\`, e.g. \`20:00\`.`,
      ephemeral: true,
    });
    return;
  }

  const startsAt = day.set(time);
  if (startsAt <= DateTime.now()) {
    await interaction.reply({ content: "That time has already passed.", ephemeral: true });
    return;
  }

  const existing = await prisma.raidInstance.findUnique({
    where: { raidTeamId_startsAt: { raidTeamId: team.id, startsAt: startsAt.toJSDate() } },
  });
  if (existing && !existing.cancelled) {
    await interaction.reply({ content: "A raid is already scheduled at that time.", ephemeral: true });
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
    content: `✅ Added a raid on ${formatRaidLabel(startsAt.toJSDate(), team.timezone)} (${team.timezone}).`,
    ephemeral: true,
  });
}
