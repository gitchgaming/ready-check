import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { prisma } from "../lib/db.js";
import { parseHourMinute } from "../lib/time.js";
import { WEEKDAY_CHOICES, weekdayName } from "../lib/weekdays.js";
import { syncRaidTeam } from "../lib/scheduler.js";

export const data = new SlashCommandBuilder()
  .setName("raid-slot")
  .setDescription("Manage the weekly recurring raid times for a raid team.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a weekly raid time to a team")
      .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("day").setDescription("Day of the week").setRequired(true).addChoices(...WEEKDAY_CHOICES),
      )
      .addStringOption((opt) =>
        opt.setName("time").setDescription('24-hour time in the team\'s timezone, e.g. "20:00"').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a weekly raid time from a team")
      .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("day").setDescription("Day of the week").setRequired(true).addChoices(...WEEKDAY_CHOICES),
      )
      .addStringOption((opt) =>
        opt.setName("time").setDescription('24-hour time in the team\'s timezone, e.g. "20:00"').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List the weekly raid times for a team")
      .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true)),
  );

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  const role = interaction.options.getRole("role", true);
  const team = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guildId, roleId: role.id } },
  });

  if (!team) {
    await interaction.reply({
      content: `<@&${role.id}> isn't set up as a raid team yet. Run \`/raid-setup\` first.`,
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const slots = await prisma.raidSlot.findMany({
      where: { raidTeamId: team.id },
      orderBy: [{ dayOfWeek: "asc" }, { hour: "asc" }, { minute: "asc" }],
    });
    if (slots.length === 0) {
      await interaction.reply({ content: `No raid times set yet for <@&${role.id}>.`, ephemeral: true });
      return;
    }
    const lines = slots.map(
      (s) => `• ${weekdayName(s.dayOfWeek)} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} (${team.timezone})`,
    );
    await interaction.reply({ content: lines.join("\n"), ephemeral: true });
    return;
  }

  const day = Number(interaction.options.getString("day", true));
  const timeInput = interaction.options.getString("time", true);
  const parsed = parseHourMinute(timeInput);
  if (!parsed) {
    await interaction.reply({
      content: `"${timeInput}" isn't a valid 24-hour time. Use \`HH:MM\`, e.g. \`20:00\`.`,
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "add") {
    await prisma.raidSlot.upsert({
      where: {
        raidTeamId_dayOfWeek_hour_minute: {
          raidTeamId: team.id,
          dayOfWeek: day,
          hour: parsed.hour,
          minute: parsed.minute,
        },
      },
      create: { raidTeamId: team.id, dayOfWeek: day, hour: parsed.hour, minute: parsed.minute },
      update: {},
    });

    await interaction.reply({
      content: `✅ Added ${weekdayName(day)} ${timeInput} (${team.timezone}) to <@&${role.id}>'s schedule.`,
      ephemeral: true,
    });

    await syncRaidTeam(client, team.id).catch((err) => {
      console.error(`Failed to sync raid team ${team.id} after adding a slot:`, err);
    });
    return;
  }

  // subcommand === "remove"
  const deleted = await prisma.raidSlot.deleteMany({
    where: { raidTeamId: team.id, dayOfWeek: day, hour: parsed.hour, minute: parsed.minute },
  });

  await interaction.reply({
    content:
      deleted.count > 0
        ? `🗑️ Removed ${weekdayName(day)} ${timeInput} from <@&${role.id}>'s schedule. (Already-posted raids aren't affected.)`
        : `No matching raid time found for ${weekdayName(day)} ${timeInput}.`,
    ephemeral: true,
  });
}
