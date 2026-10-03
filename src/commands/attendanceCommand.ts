import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
} from "discord.js";
import { DateTime } from "luxon";
import { accessLevel, canCalloutForOthers } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

const MAX_CHOICES = 25; // Discord's limit on autocomplete results

interface AttendanceCommandConfig {
  name: string;
  description: string;
  status: "IN" | "OUT";
  /** Officer-only variant that acts on a chosen raider instead of the caller. */
  forOthers: boolean;
}

export function makeAttendanceCommand({ name, description, status, forOthers }: AttendanceCommandConfig) {
  const builder = new SlashCommandBuilder().setName(name).setDescription(description);

  if (forOthers) {
    builder.addUserOption((opt) =>
      opt.setName("user").setDescription("The raider to update").setRequired(true),
    );
  }

  builder.addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("Pick a raid date from the suggestions")
      .setRequired(true)
      .setAutocomplete(true),
  );

  // Discord only guarantees fully-resolved objects for the focused option during
  // autocomplete, so the subject is read as a raw snowflake and resolved from there.
  async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.respond([{ name: "Only available in a server", value: "none" }]);
      return;
    }

    const subjectId = forOthers
      ? (interaction.options.get("user")?.value as string | undefined)
      : interaction.user.id;
    if (!subjectId) {
      await interaction.respond([{ name: "Pick a raider above first", value: "none" }]);
      return;
    }

    const teams = await raidTeamsForUser(interaction.guild, subjectId);
    if (teams.length === 0) {
      await interaction.respond([{ name: "Not on any raid team", value: "none" }]);
      return;
    }

    // Split the choice budget evenly so one busy team can't push the others off the list.
    const perTeam = Math.max(1, Math.floor(MAX_CHOICES / teams.length));
    const perTeamInstances = await Promise.all(
      teams.map((team) =>
        prisma.raidInstance.findMany({
          where: { raidTeamId: team.id, closed: false, cancelled: false },
          orderBy: { startsAt: "asc" },
          take: perTeam,
        }),
      ),
    );

    const teamById = new Map(teams.map((t) => [t.id, t]));
    const instances = perTeamInstances
      .flat()
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, MAX_CHOICES);

    if (instances.length === 0) {
      await interaction.respond([{ name: "No upcoming raids found", value: "none" }]);
      return;
    }

    const allChoices = instances.map((instance) => {
      const team = teamById.get(instance.raidTeamId)!;
      const teamName = team.name ?? interaction.guild?.roles.cache.get(team.roleId)?.name ?? "Raid";
      return {
        name: `${formatLabel(instance.startsAt, team.timezone)} · ${teamName}`,
        value: instance.id,
      };
    });

    // Only narrow by the typed text when it actually matches something, so an
    // unexpected format (e.g. "10/5") never dead-ends to an empty list.
    const focused = interaction.options.getFocused().toLowerCase();
    const filtered = focused ? allChoices.filter((c) => c.name.toLowerCase().includes(focused)) : allChoices;

    await interaction.respond(filtered.length > 0 ? filtered : allChoices);
  }

  async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
      return;
    }

    const instanceId = interaction.options.getString("date", true);
    const targetUser = forOthers ? interaction.options.getUser("user", true) : null;
    const subjectId = targetUser?.id ?? interaction.user.id;

    if (forOthers) {
      const level = await accessLevel(interaction.guild, interaction.user.id);
      if (!canCalloutForOthers(level)) {
        await interaction.reply({
          content: "Only officers can change attendance on behalf of other raiders.",
          ephemeral: true,
        });
        return;
      }
    }

    const instance = await prisma.raidInstance.findUnique({
      where: { id: instanceId },
      include: { raidTeam: true },
    });

    if (!instance || instance.raidTeam.guildId !== interaction.guild.id) {
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

    if (instance.cancelled) {
      await interaction.reply({ content: "This raid has been cancelled.", ephemeral: true });
      return;
    }

    const subject = await interaction.guild.members.fetch(subjectId).catch(() => null);
    if (!subject || !subject.roles.cache.has(instance.raidTeam.roleId)) {
      await interaction.reply({
        content: forOthers
          ? `<@${subjectId}> isn't on <@&${instance.raidTeam.roleId}>'s roster.`
          : `You're not on <@&${instance.raidTeam.roleId}>'s roster, so there's nothing to update here.`,
        ephemeral: true,
      });
      return;
    }

    if (status === "OUT") {
      await prisma.attendance.upsert({
        where: { raidInstanceId_userId: { raidInstanceId: instance.id, userId: subjectId } },
        create: { raidInstanceId: instance.id, userId: subjectId, status: "OUT" },
        update: { status: "OUT" },
      });
    } else {
      await prisma.attendance.deleteMany({ where: { raidInstanceId: instance.id, userId: subjectId } });
    }

    await renderTeamMessage(client, instance.raidTeamId);

    const dateLabel = formatLabel(instance.startsAt, instance.raidTeam.timezone);
    const who = forOthers ? `<@${subjectId}>` : "you";
    const verb = status === "OUT" ? "called out" : "back in";
    await interaction.reply({
      content: `${status === "OUT" ? "❌" : "✅"} Marked ${who} as ${verb} for ${dateLabel}.`,
      ephemeral: true,
    });
  }

  return { data: builder, autocomplete, execute };
}

/** Raid teams in this guild whose role the given member holds. */
async function raidTeamsForUser(guild: Guild, userId: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return [];
  const teams = await prisma.raidTeam.findMany({ where: { guildId: guild.id } });
  return teams.filter((t) => member.roles.cache.has(t.roleId));
}

function formatLabel(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat("MMM d, yyyy h:mm a");
}
