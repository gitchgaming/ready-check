import { SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { DateTime } from "luxon";
import { assertCanManage } from "../lib/access.js";
import { prisma } from "../lib/db.js";
import { renderTeamMessage } from "../lib/scheduler.js";

const WHEN_FORMAT = "yyyy-MM-dd HH:mm";

export const data = new SlashCommandBuilder()
  .setName("raid-adhoc")
  .setDescription("Officers: add a one-off raid that isn't on the weekly schedule.")
  .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true))
  .addStringOption((opt) =>
    opt
      .setName("when")
      .setDescription("Date and time in the team's timezone, e.g. 2026-10-12 19:30")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  if (!(await assertCanManage(interaction))) return;

  const role = interaction.options.getRole("role", true);
  const whenInput = interaction.options.getString("when", true).trim();

  const team = await prisma.raidTeam.findUnique({
    where: { guildId_roleId: { guildId: interaction.guild.id, roleId: role.id } },
  });

  if (!team) {
    await interaction.reply({
      content: `<@&${role.id}> isn't set up as a raid team yet. Run \`/raid-setup\` first.`,
      ephemeral: true,
    });
    return;
  }

  const startsAt = DateTime.fromFormat(whenInput, WHEN_FORMAT, { zone: team.timezone });
  if (!startsAt.isValid) {
    await interaction.reply({
      content: `Couldn't read "${whenInput}". Use the format \`YYYY-MM-DD HH:MM\`, e.g. \`2026-10-12 19:30\`.`,
      ephemeral: true,
    });
    return;
  }

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
      data: { raidTeamId: team.id, startsAt: startsAt.toJSDate() },
    });
  }

  await renderTeamMessage(client, team.id);

  await interaction.reply({
    content: `✅ Added a raid on ${startsAt.toFormat("MMM d, yyyy h:mm a")} (${team.timezone}).`,
    ephemeral: true,
  });
}
