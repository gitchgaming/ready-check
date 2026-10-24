import type { ChatInputCommandInteraction, Client } from "discord.js";
import { MessageFlags } from "discord.js";
import { chip } from "../../lib/embeds.js";
import { teamDisplayName } from "../../lib/pickers.js";
import { RESET_NAME, cleanName, setTeamName } from "../../lib/raiderNames.js";
import { ensureMembersCached } from "../../lib/roster.js";
import { renderTeamMessage } from "../../lib/scheduler.js";
import { requireTeam } from "./shared.js";

/** `/raidlead name`: sets the name a raider shows as on one team, or clears it back to their Discord name. */
export async function set(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const reply = (content: string) =>
    interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const team = await requireTeam(interaction);
  if (!team) return;
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user", true);
  const teamName = teamDisplayName(team, guild);

  await ensureMembersCached(guild);
  const member = guild.members.cache.get(user.id);
  if (!member?.roles.cache.has(team.roleId)) {
    await reply(`<@${user.id}> isn't on **${teamName}**.`);
    return;
  }

  const typed = interaction.options.getString("name", true);
  const name = typed === RESET_NAME ? null : cleanName(typed);
  if (typed !== RESET_NAME && name === null) {
    await reply("Type the name to show, or pick “Use their Discord name” to clear it.");
    return;
  }
  await setTeamName([team.id], user.id, name);
  await renderTeamMessage(client, team.id);
  await reply(
    name
      ? `✅ <@${user.id}> now shows as ${chip(name)} on **${teamName}**.`
      : `✅ <@${user.id}> shows as their Discord name, ${chip(member.displayName)}, on **${teamName}** again.`,
  );
}
