import type { ChatInputCommandInteraction, Guild } from "discord.js";
import { prisma } from "./db.js";

export type AccessLevel = "owner" | "officer" | "member";

export async function accessLevel(guild: Guild, userId: string): Promise<AccessLevel> {
  if (guild.ownerId === userId) return "owner";

  const config = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
  if (!config?.officerRoleId) return "member";

  const member = await guild.members.fetch(userId).catch(() => null);
  if (member?.roles.cache.has(config.officerRoleId)) return "officer";
  return "member";
}

/** Replies with a denial and returns false unless the caller is the owner or officer. */
export async function assertCanManage(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  const level = await accessLevel(interaction.guild, interaction.user.id);
  if (level === "owner" || level === "officer") return true;

  await interaction.reply({
    content: "You need the officer role to manage raid teams.",
    ephemeral: true,
  });
  return false;
}

export function canCalloutForOthers(level: AccessLevel): boolean {
  return level === "owner" || level === "officer";
}
