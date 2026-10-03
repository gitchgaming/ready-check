import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { Attendance, RaidInstance, RaidTeam } from "@prisma/client";

export type ViewMode = "upcoming" | "history";

type InstanceWithAttendance = RaidInstance & { attendance: Attendance[] };

const MAX_DATE_BUTTONS = 5; // Discord's limit per action row

export function buildTeamMessage(
  team: RaidTeam,
  instances: InstanceWithAttendance[],
  mode: ViewMode,
) {
  const isHistory = mode === "history";

  const embed = new EmbedBuilder()
    .setTitle(`${team.name ?? "Raid"} — ${isHistory ? "past raids" : "upcoming schedule"}`)
    .setColor(isHistory ? 0x6b7280 : 0x5865f2);

  if (instances.length === 0) {
    embed.setDescription(
      isHistory ? "No past raids yet." : "No raids scheduled yet. Add times with `/raid-slot add`.",
    );
  } else {
    embed.setDescription(
      isHistory
        ? "These raids already happened — attendance is locked."
        : "Click a date to call out — it's toggleable, so click again anytime to switch back.",
    );
    for (const instance of instances) {
      const unix = Math.floor(instance.startsAt.getTime() / 1000);
      const calledOut = instance.attendance.filter((a) => a.status === "OUT").map((a) => `<@${a.userId}>`);
      embed.addFields({
        name: `<t:${unix}:D>`,
        value: `<t:${unix}:t> · <t:${unix}:R>\n${calledOut.length > 0 ? calledOut.join(", ") : "—"}`,
        inline: true,
      });
    }
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (!isHistory && instances.length > 0) {
    const dateRow = new ActionRowBuilder<ButtonBuilder>();
    for (const instance of instances.slice(0, MAX_DATE_BUTTONS)) {
      dateRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`attendance:${instance.id}`)
          .setLabel(shortDateLabel(instance.startsAt))
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(dateRow);
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`nav:earlier:${team.id}`)
      .setLabel("← Earlier")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isHistory),
    new ButtonBuilder()
      .setCustomId(`nav:later:${team.id}`)
      .setLabel("Later →")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isHistory),
  );
  rows.push(navRow);

  return { embeds: [embed], components: rows };
}

function shortDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
