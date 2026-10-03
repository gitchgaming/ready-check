import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { RaidInstance, RaidTeam } from "@prisma/client";

export function buildRaidMessage(
  team: RaidTeam,
  instance: RaidInstance,
  calledOutUserIds: string[],
) {
  const unixSeconds = Math.floor(instance.startsAt.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`📅 ${team.name ?? "Raid"} — <t:${unixSeconds}:F>`)
    .setDescription(
      `<t:${unixSeconds}:R> · <@&${team.roleId}> is assumed **in** by default.\n` +
        "Click below only if you can't make it.",
    )
    .setColor(instance.closed ? 0x6b7280 : calledOutUserIds.length > 0 ? 0xf59e0b : 0x22c55e)
    .addFields({
      name: `❌ Called out (${calledOutUserIds.length})`,
      value: calledOutUserIds.length > 0 ? calledOutUserIds.map((id) => `<@${id}>`).join(", ") : "Nobody — everyone's in!",
    });

  if (instance.closed) {
    return { embeds: [embed], components: [] };
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`attendance:in:${instance.id}`)
      .setLabel("I'm in")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(`attendance:out:${instance.id}`)
      .setLabel("Can't make it")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌"),
  );

  return { embeds: [embed], components: [row] };
}
