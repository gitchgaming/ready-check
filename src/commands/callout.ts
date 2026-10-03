import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { DateTime } from "luxon";
import { accessLevel, canCalloutForOthers } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

const MAX_CHOICES = 25; // Discord's limit on autocomplete results

export const data = new SlashCommandBuilder()
  .setName("callout")
  .setDescription("Call out for a future raid date without using the schedule message.")
  .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true))
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("Pick the raid date from the suggestions")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("Officers only: call out on behalf of another raider")
      .setRequired(false),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  // Discord only guarantees a fully-resolved object for the currently-focused
  // option during autocomplete — getRole() can come back empty even when a
  // role was already picked. The raw snowflake is still there, so read that
  // directly instead; it's all the DB lookup needs anyway.
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

  const focused = interaction.options.getFocused().toLowerCase();
  const instances = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false },
    orderBy: { startsAt: "asc" },
    take: MAX_CHOICES,
  });

  if (instances.length === 0) {
    await interaction.respond([{ name: "No upcoming raids found for this team", value: "none" }]);
    return;
  }

  const allChoices = instances.map((instance) => ({
    name: formatLabel(instance.startsAt, team.timezone),
    value: instance.id,
  }));

  // Only narrow by the typed text when it actually matches something —
  // otherwise an unexpected format (e.g. "10/5") would dead-end to nothing
  // even though valid dates exist.
  const filtered = focused ? allChoices.filter((c) => c.name.toLowerCase().includes(focused)) : allChoices;

  await interaction.respond(filtered.length > 0 ? filtered : allChoices);
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  const role = interaction.options.getRole("role", true);
  const instanceId = interaction.options.getString("date", true);

  const instance = await prisma.raidInstance.findUnique({
    where: { id: instanceId },
    include: { raidTeam: true },
  });

  if (!instance || instance.raidTeam.guildId !== interaction.guildId || instance.raidTeam.roleId !== role.id) {
    await interaction.reply({
      content: "Couldn't find that raid date — please pick one from the suggestions as you type.",
      ephemeral: true,
    });
    return;
  }

  if (instance.closed) {
    await interaction.reply({ content: "This raid has already started or passed.", ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser("user");
  const onBehalf = targetUser !== null && targetUser.id !== interaction.user.id;
  const subjectId = onBehalf ? targetUser.id : interaction.user.id;

  if (onBehalf) {
    const level = await accessLevel(interaction.guild, interaction.user.id);
    if (!canCalloutForOthers(level)) {
      await interaction.reply({
        content: "Only officers can call out on behalf of other raiders.",
        ephemeral: true,
      });
      return;
    }
  }

  const subject = await interaction.guild.members.fetch(subjectId).catch(() => null);
  if (!subject || !subject.roles.cache.has(instance.raidTeam.roleId)) {
    await interaction.reply({
      content: onBehalf
        ? `<@${subjectId}> isn't on <@&${instance.raidTeam.roleId}>'s roster.`
        : `You're not on <@&${instance.raidTeam.roleId}>'s roster, so there's nothing to update here.`,
      ephemeral: true,
    });
    return;
  }

  await prisma.attendance.upsert({
    where: { raidInstanceId_userId: { raidInstanceId: instance.id, userId: subjectId } },
    create: { raidInstanceId: instance.id, userId: subjectId, status: "OUT" },
    update: { status: "OUT" },
  });

  await renderTeamMessage(client, instance.raidTeamId);

  const dateLabel = formatLabel(instance.startsAt, instance.raidTeam.timezone);
  await interaction.reply({
    content: onBehalf
      ? `❌ Marked <@${subjectId}> as called out for ${dateLabel}.`
      : `❌ Marked you as called out for ${dateLabel}.`,
    ephemeral: true,
  });
}

function formatLabel(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat("MMM d, yyyy h:mm a");
}
