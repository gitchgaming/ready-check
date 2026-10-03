import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { assertCanManage } from "../lib/access.js";
import { prisma } from "../lib/db.js";

const MAX_DESCRIPTION = 4000; // Discord caps embed descriptions at 4096

export const data = new SlashCommandBuilder()
  .setName("raid-roster")
  .setDescription("Officers: post the current roster for a raid team as its own message.")
  .addRoleOption((opt) => opt.setName("role").setDescription("The raid team's role").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction, _client: Client): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  if (!(await assertCanManage(interaction))) return;

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

  const members = await interaction.guild.members.fetch();
  const names = members
    .filter((m) => !m.user.bot && m.roles.cache.has(role.id))
    .map((m) => m.displayName)
    .sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  let length = 0;
  for (const name of names) {
    if (length + name.length + 1 > MAX_DESCRIPTION) break;
    lines.push(name);
    length += name.length + 1;
  }
  const hidden = names.length - lines.length;
  const description =
    names.length === 0
      ? "No one has this role yet."
      : lines.join("\n") + (hidden > 0 ? `\n…and ${hidden} more` : "");

  const embed = new EmbedBuilder()
    .setTitle(`${team.name ?? role.name} — roster (${names.length})`)
    .setDescription(description)
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed] });
}
