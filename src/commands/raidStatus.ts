import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../lib/db.js";
import { rosterMemberIds } from "../lib/roster.js";

export const data = new SlashCommandBuilder()
  .setName("raid-status")
  .setDescription("Show upcoming raids and who's called out for a raid team.")
  .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  const role = interaction.options.getRole("role", true);
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

  const instances = await prisma.raidInstance.findMany({
    where: { raidTeamId: team.id, closed: false, cancelled: false },
    include: { attendance: true },
    orderBy: { startsAt: "asc" },
  });

  if (instances.length === 0) {
    await interaction.reply({
      content: `No upcoming raids scheduled for <@&${role.id}> yet. Add times with \`/raid-slot add\`.`,
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder().setTitle(`📅 Upcoming raids — ${team.name ?? role.name}`);
  const rosterIds = await rosterMemberIds(interaction.guild, team.roleId);

  for (const instance of instances) {
    const unixSeconds = Math.floor(instance.startsAt.getTime() / 1000);
    const calledOut = instance.attendance
      .filter((a) => a.status === "OUT" && rosterIds.has(a.userId))
      .map((a) => `<@${a.userId}>`);
    embed.addFields({
      name: `<t:${unixSeconds}:F>`,
      value: calledOut.length > 0 ? `❌ Called out: ${calledOut.join(", ")}` : "✅ Everyone's in",
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
