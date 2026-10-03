import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { Attendance, RaidInstance, RaidTeam } from "@prisma/client";

type InstanceWithAttendance = RaidInstance & { attendance: Attendance[] };

export interface NavState {
  canEarlier: boolean;
  canLater: boolean;
}

const MAX_DATE_BUTTONS = 5; // Discord's limit per action row

export function buildTeamMessage(team: RaidTeam, instances: InstanceWithAttendance[], nav: NavState) {
  const anyOpen = instances.some((i) => !i.closed);

  const embed = new EmbedBuilder()
    .setTitle(`${team.name ?? "Raid"} — schedule`)
    .setColor(instances.length > 0 && !anyOpen ? 0x6b7280 : 0x5865f2);

  if (instances.length === 0) {
    embed.setDescription("No raids to show here yet. Add times with `/raid-slot add`.");
  } else {
    embed.setDescription(
      anyOpen
        ? "Click a date to call out — it's toggleable, so click again anytime to switch back."
        : "These raids already happened — attendance is locked.",
    );
    for (const instance of instances) {
      const unix = Math.floor(instance.startsAt.getTime() / 1000);
      const calledOut = instance.attendance.filter((a) => a.status === "OUT").map((a) => `❌ <@${a.userId}>`);
      embed.addFields({
        name: `<t:${unix}:D>`,
        value: `<t:${unix}:t> · <t:${unix}:R>\n\n${calledOut.length > 0 ? calledOut.join("\n") : "—"}`,
        inline: true,
      });
    }
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  const openInstances = instances.filter((i) => !i.closed);
  if (openInstances.length > 0) {
    const dateRow = new ActionRowBuilder<ButtonBuilder>();
    for (const instance of openInstances.slice(0, MAX_DATE_BUTTONS)) {
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
      .setDisabled(!nav.canEarlier),
    new ButtonBuilder()
      .setCustomId(`nav:later:${team.id}`)
      .setLabel("Later →")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!nav.canLater),
  );
  rows.push(navRow);

  return { embeds: [embed], components: rows };
}

function shortDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
