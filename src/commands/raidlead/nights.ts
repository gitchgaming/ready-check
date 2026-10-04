import type { ChatInputCommandInteraction, Client } from "discord.js";
import { MessageFlags } from "discord.js";
import { prisma } from "../../lib/db.js";
import { formatNight } from "../../lib/pickers.js";
import { syncRaidTeam } from "../../lib/scheduler.js";
import { parseHourMinute } from "../../lib/time.js";
import { requireTeam } from "./shared.js";

export async function add(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const day = Number(interaction.options.getString("day", true));
  const timeInput = interaction.options.getString("time", true);
  const time = parseHourMinute(timeInput);
  if (!time) {
    await interaction.reply({
      content: `"${timeInput}" isn't a valid 24-hour time. Use \`HH:MM\`, e.g. \`20:00\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await prisma.raidSlot.upsert({
    where: {
      raidTeamId_dayOfWeek_hour_minute: { raidTeamId: team.id, dayOfWeek: day, ...time },
    },
    create: { raidTeamId: team.id, dayOfWeek: day, ...time },
    update: {},
  });

  await interaction.reply({
    content: `✅ Added ${formatNight(day, time.hour, time.minute)} (${team.timezone}) as a weekly raid night.`,
    flags: MessageFlags.Ephemeral,
  });

  await syncRaidTeam(client, team.id).catch((err) => console.error(`Failed to sync raid team ${team.id}:`, err));
}

export async function remove(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const nightId = interaction.options.getString("night", true);
  const night = await prisma.raidSlot.findFirst({ where: { id: nightId, raidTeamId: team.id } });
  if (!night) {
    await interaction.reply({ content: "Couldn't find that raid night. Pick one from the suggestions.", flags: MessageFlags.Ephemeral });
    return;
  }

  await prisma.raidSlot.delete({ where: { id: night.id } });
  await interaction.reply({
    content:
      `🗑️ Removed ${formatNight(night.dayOfWeek, night.hour, night.minute)} as a weekly raid night. ` +
      "Raids already on the schedule stay; cancel them with `/raidlead raid cancel` if needed.",
    flags: MessageFlags.Ephemeral,
  });
}

export async function list(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  const team = await requireTeam(interaction);
  if (!team) return;

  const nights = await prisma.raidSlot.findMany({
    where: { raidTeamId: team.id },
    orderBy: [{ dayOfWeek: "asc" }, { hour: "asc" }, { minute: "asc" }],
  });

  await interaction.reply({
    content:
      nights.length === 0
        ? "No weekly raid nights yet. Add one with `/raidlead nights add`."
        : nights.map((n) => `• ${formatNight(n.dayOfWeek, n.hour, n.minute)}`).join("\n") + `\n(${team.timezone})`,
    flags: MessageFlags.Ephemeral,
  });
}
