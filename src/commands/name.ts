import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import type { RaidTeam } from "../generated/prisma/client.js";
import { chip } from "../lib/embeds.js";
import { respondFiltered, teamDisplayName, viewableTeams } from "../lib/pickers.js";
import { MAX_NAME_LENGTH, RESET_NAME, cleanName, nameChoices, setTeamName, teamNames } from "../lib/raiderNames.js";
import { renderTeamMessage } from "../lib/scheduler.js";

export const data = new SlashCommandBuilder()
  .setName("name")
  .setDescription("Privately set the name you show as on your raid team, like your character's.")
  .addStringOption((opt) =>
    opt
      .setName("name")
      .setDescription("The name to show; leave it out to see your current one")
      .setRequired(false)
      .setMaxLength(MAX_NAME_LENGTH)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("team")
      .setDescription("Only this team (default: every team you're on)")
      .setRequired(false)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) return;
  const focused = interaction.options.getFocused(true);
  if (focused.name === "name") {
    await interaction.respond(nameChoices(focused.value, "Use my Discord name (clear mine)"));
    return;
  }
  const teams = await viewableTeams(interaction.guild, interaction.user.id, false);
  const choices = teams.map((t) => ({ name: teamDisplayName(t, interaction.guild), value: t.id }));
  await respondFiltered(interaction, choices, "You're not on any raid team");
}

/** "**Main Raid**", "**Main Raid** and **Alt Raid**", "**A**, **B** and **C**". */
function teamList(teams: RaidTeam[], guild: ChatInputCommandInteraction["guild"]): string {
  const names = teams.map((t) => `**${teamDisplayName(t, guild)}**`);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
}

export async function execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const reply = (content: string) =>
    interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const guild = interaction.guild;
  if (!guild) {
    await reply("This command only works in a server.");
    return;
  }

  const userId = interaction.user.id;
  const memberOf = await viewableTeams(guild, userId, false);
  if (memberOf.length === 0) {
    await reply("You're not on any raid team.");
    return;
  }
  const teamId = interaction.options.getString("team");
  const teams = teamId ? memberOf.filter((t) => t.id === teamId) : memberOf;
  if (teams.length === 0) {
    await reply("You're not on that team. Pick one from the suggestions.");
    return;
  }
  const discordName = guild.members.cache.get(userId)?.displayName ?? interaction.user.username;

  const typed = interaction.options.getString("name");
  if (typed === null) {
    const lines = await Promise.all(
      teams.map(async (team) => {
        const name = (await teamNames(team.id)).get(userId);
        return `🏷️ On ${teamList([team], guild)} you show as ${name ? chip(name) : `your Discord name, ${chip(discordName)}`}.`;
      }),
    );
    await reply(`${lines.join("\n")}\nChange it with \`/name name:\`.`);
    return;
  }

  const name = typed === RESET_NAME ? null : cleanName(typed);
  if (typed !== RESET_NAME && name === null) {
    await reply("Type the name to show, or pick “Use my Discord name” to clear yours.");
    return;
  }
  await setTeamName(
    teams.map((t) => t.id),
    userId,
    name,
  );
  for (const team of teams) await renderTeamMessage(client, team.id);
  await reply(
    name
      ? `✅ You now show as ${chip(name)} on ${teamList(teams, guild)}.`
      : `✅ You show as your Discord name, ${chip(discordName)}, on ${teamList(teams, guild)} again.`,
  );
}
