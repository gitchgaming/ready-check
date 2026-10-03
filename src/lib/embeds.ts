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

const MAX_DATE_BUTTONS_PER_ROW = 5; // Discord's limit per action row
const MAX_DATE_ROWS = 4; // leaves one row free for the nav row when present

function buildScheduleEmbed(team: RaidTeam, instances: InstanceWithAttendance[], rosterIds: Set<string>) {
  const anyOpen = instances.some((i) => !i.closed);

  const embed = new EmbedBuilder()
    .setTitle(`${team.name ?? "Raid"} — schedule`)
    .setColor(instances.length > 0 && !anyOpen ? 0x6b7280 : 0x5865f2);

  if (instances.length === 0) {
    embed.setDescription("No raids to show here yet. Add times with `/raid-slot add`.");
    return embed;
  }

  embed.setDescription(
    anyOpen
      ? "Click a date to call out — it's toggleable, so click again anytime to switch back."
      : "These raids already happened — attendance is locked.",
  );

  for (const instance of instances) {
    const unix = Math.floor(instance.startsAt.getTime() / 1000);
    const header = `<t:${unix}:t> · <t:${unix}:R>\n\n`;

    if (instance.cancelled) {
      embed.addFields({
        name: `<t:${unix}:D>`,
        value: `${header}🚫 **Cancelled**`,
        inline: true,
      });
      continue;
    }

    const calledOutIds = instance.attendance
      .filter((a) => a.status === "OUT" && rosterIds.has(a.userId))
      .map((a) => a.userId);
    const calledOut = calledOutIds.map((id) => `❌ <@${id}>`);
    const total = rosterIds.size;
    const attending = total - calledOutIds.length;
    const dot = attending === total ? "🟢" : attending * 2 >= total ? "🟡" : "🔴";
    embed.addFields({
      name: `<t:${unix}:D>`,
      value:
        header +
        `${dot} **${attending} of ${total} attending**\n\n` +
        (calledOut.length > 0 ? calledOut.join("\n") : "—"),
      inline: true,
    });
  }

  return embed;
}

function dateButtonRows(instances: InstanceWithAttendance[], customId: (instanceId: string) => string) {
  const openInstances = instances.filter((i) => !i.closed && !i.cancelled);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < openInstances.length && rows.length < MAX_DATE_ROWS; i += MAX_DATE_BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const instance of openInstances.slice(i, i + MAX_DATE_BUTTONS_PER_ROW)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(customId(instance.id))
          .setLabel(shortDateLabel(instance.startsAt))
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }

  return rows;
}

/** The public, non-scrolling team message: always the next N upcoming raids, no nav. */
export function buildPublicMessage(team: RaidTeam, instances: InstanceWithAttendance[], rosterIds: Set<string>) {
  const embed = buildScheduleEmbed(team, instances, rosterIds);
  const rows = dateButtonRows(instances, (id) => `attendance:${id}`);
  return { embeds: [embed], components: rows };
}

/** The personal, ephemeral /raid-calendar view: scrollable, state carried in customIds. */
export function buildCalendarMessage(
  team: RaidTeam,
  instances: InstanceWithAttendance[],
  offset: number,
  nav: NavState,
  rosterIds: Set<string>,
) {
  const embed = buildScheduleEmbed(team, instances, rosterIds);
  const rows = dateButtonRows(instances, (id) => `attendance:${id}:cal:${offset}`);

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`mynav:earlier:${team.id}:${offset}`)
        .setLabel("← Earlier")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!nav.canEarlier),
      new ButtonBuilder()
        .setCustomId(`mynav:later:${team.id}:${offset}`)
        .setLabel("Later →")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!nav.canLater),
    ),
  );

  return { embeds: [embed], components: rows };
}

function shortDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
