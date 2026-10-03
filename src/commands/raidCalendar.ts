import { SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../lib/db.js";
import { buildCalendarMessage } from "../lib/embeds.js";
import { instancesForWindow } from "../lib/scheduler.js";

export const data = new SlashCommandBuilder()
  .setName("raid-calendar")
  .setDescription("Open a private, scrollable view of a raid team's schedule — past and future.")
  .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
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

  const { instances, canEarlier, canLater } = await instancesForWindow(team.id, 0);
  await interaction.reply({
    ...buildCalendarMessage(team, instances, 0, { canEarlier, canLater }),
    ephemeral: true,
  });
}
