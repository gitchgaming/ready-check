import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { DateTime } from "luxon";
import { assertCanManage } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

const MAX_CHOICES = 25;

export const data = new SlashCommandBuilder()
  .setName("raid-uncancel")
  .setDescription("Officers: restore a cancelled raid to normal.")
  .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true))
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("Pick the cancelled raid to restore")
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const roleId = interaction.options.get("role")?.value as string | undefined;
  if (!roleId || !interaction.guildId) {
    await interaction.respond([{ name: "Pick a role above first", value: "none" }]);
    return;
  }

  const team = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guildId, roleId } },
  });
  if (!team) {
    await interaction.respond([{ name: "That role isn't set up as a raid team yet", value: "none" }]);
    return;
  }

  const instances = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false, cancelled: true },
    orderBy: { startsAt: "asc" },
    take: MAX_CHOICES,
  });

  if (instances.length === 0) {
    await interaction.respond([{ name: "No cancelled raids to restore", value: "none" }]);
    return;
  }

  const choices = instances.map((instance) => ({
    name: formatLabel(instance.startsAt, team.timezone),
    value: instance.id,
  }));
  const focused = interaction.options.getFocused().toLowerCase();
  const filtered = focused ? choices.filter((c) => c.name.toLowerCase().includes(focused)) : choices;
  await interaction.respond(filtered.length > 0 ? filtered : choices);
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  if (!(await assertCanManage(interaction))) return;

  const role = interaction.options.getRole("role", true);
  const instanceId = interaction.options.getString("date", true);

  const instance = await prisma.raidInstance.findUnique({
    where: { id: instanceId },
    include: { raidTeam: true },
  });

  if (!instance || instance.raidTeam.guildId !== interaction.guild.id || instance.raidTeam.roleId !== role.id) {
    await interaction.reply({
      content: "Couldn't find that raid — please pick one from the suggestions as you type.",
      ephemeral: true,
    });
    return;
  }

  if (!instance.cancelled) {
    await interaction.reply({ content: "That raid isn't cancelled.", ephemeral: true });
    return;
  }

  await prisma.raidInstance.update({ where: { id: instance.id }, data: { cancelled: false } });
  await renderTeamMessage(client, instance.raidTeamId);

  const dateLabel = formatLabel(instance.startsAt, instance.raidTeam.timezone);
  await interaction.reply({ content: `✅ Restored the raid on ${dateLabel}.`, ephemeral: true });
}

function formatLabel(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat("MMM d, yyyy h:mm a");
}
