import type { ChatInputCommandInteraction, Client, Guild } from "discord.js";
import { MessageFlags } from "discord.js";
import type { RaidTeam } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { teamDisplayName, teamsForMember } from "../../lib/pickers.js";

export type TeamPick = { team: RaidTeam } | { problem: string };

/**
 * The team a /raidlead command acts on: the one picked in `team:`, else the server's
 * only team, else the only team the officer is on. With several to choose from and
 * none picked it asks rather than guesses, since these commands change things.
 * `picked` is the option's value: a team id from the picker, or a typed name.
 */
export async function pickTeam(guild: Guild, userId: string, picked: string | null | undefined): Promise<TeamPick> {
  const teams = await prisma.raidTeam.findMany({
    where: { guildId: guild.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (teams.length === 0) return { problem: "There are no raid teams yet. Create one with `/raidlead team setup`." };

  const typed = picked?.trim();
  if (typed) {
    const name = typed.toLowerCase();
    const team = teams.find((t) => t.id === typed) ?? teams.find((t) => teamDisplayName(t, guild).toLowerCase() === name);
    return team ? { team } : { problem: "Couldn't find that team. Pick one from the `team:` suggestions." };
  }
  if (teams.length === 1) return { team: teams[0]! };
  const mine = await teamsForMember(guild, userId, teams);
  if (mine.length === 1) return { team: mine[0]! };
  return { problem: "Pick which team in the `team:` option." };
}

/** Finds the command's team (see `pickTeam`), replying with what's wrong if there isn't one. */
export async function requireTeam(interaction: ChatInputCommandInteraction): Promise<RaidTeam | null> {
  const pick = await pickTeam(interaction.guild!, interaction.user.id, interaction.options.getString("team"));
  if ("team" in pick) return pick.team;
  await interaction.reply({ content: pick.problem, flags: MessageFlags.Ephemeral });
  return null;
}

export async function deleteMessage(client: Client, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  await message?.delete().catch(() => null);
}
