import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Attendance, RaidInstance, RaidTeam } from "../generated/prisma/client.js";
import { DateTime } from "luxon";
import { formatRaidLabel } from "./pickers.js";

type InstanceWithAttendance = RaidInstance & { attendance: Attendance[] };

export interface NavState {
  canEarlier: boolean;
  canLater: boolean;
}

/** Discord's cap on options in one select menu. */
export const MAX_SELECT_OPTIONS = 25;

/** Select value on the public message that opens the personal full schedule. */
export const MORE_DATES_VALUE = "more";

/**
 * Discord caps a Components V2 message at 40 components, nested ones included.
 * Each day on the public message costs 5 components (divider, section, two text
 * blocks, button), plus 1 for the "Next raid" label; the header, closing divider,
 * select row and container cost 5. So it fits (40 - 5 - 1) / 5 = 6.8 → 6 days.
 */
export const MAX_PUBLIC_DAYS = 6;

const V2_FLAGS = [MessageFlags.IsComponentsV2] as const;

/** Mentions in Components V2 text ping people, unlike in embeds, so never ping. */
const NO_PINGS = { parse: [] as [] };

/** A schedule message as a private reply. */
export function asEphemeral<T extends { flags: readonly MessageFlags[] }>(message: T) {
  return { ...message, flags: [...message.flags, MessageFlags.Ephemeral] };
}

function text(content: string) {
  return new TextDisplayBuilder().setContent(content);
}

function divider() {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
}

/** A day's two text blocks: date and time (tight), then attendance, a little apart. */
function dayBlocks(instance: InstanceWithAttendance, rosterIds: Set<string>) {
  const unix = Math.floor(instance.startsAt.getTime() / 1000);
  const when = text(`**<t:${unix}:D>**\n<t:${unix}:t> · <t:${unix}:R>`);
  if (instance.cancelled) return [when, text("🚫 **Cancelled**")];

  const calledOutIds = instance.attendance
    .filter((a) => a.status === "OUT" && rosterIds.has(a.userId))
    .map((a) => a.userId);
  const total = rosterIds.size;
  const attending = total - calledOutIds.length;
  const dot = attending === total ? "🟢" : attending * 2 >= total ? "🟡" : "🔴";
  const calledOut = calledOutIds.map((id) => `\n❌ <@${id}>`).join("");
  return [when, text(`${dot} **${attending} of ${total} attending**${calledOut}`)];
}

/**
 * The schedule card: a header, then each raid day between dividers. When
 * `dayButton` is given, open days get it beside them; other days are text only.
 */
function buildScheduleContainer(
  team: RaidTeam,
  instances: InstanceWithAttendance[],
  rosterIds: Set<string>,
  openPrompt: string,
  dayButton?: (instance: InstanceWithAttendance) => ButtonBuilder,
) {
  const anyOpen = instances.some((i) => !i.closed);
  const intro =
    instances.length === 0
      ? "No raids to show here yet. Officers can add weekly raid nights with `/raidlead nights add`."
      : anyOpen
        ? openPrompt
        : "These raids already happened — attendance is locked.";

  const container = new ContainerBuilder()
    .setAccentColor(instances.length > 0 && !anyOpen ? 0x6b7280 : 0x5865f2)
    .addTextDisplayComponents(text(`## ${team.name ?? "Raid"} — schedule\n${intro}`));

  const next = instances.find((i) => !i.closed);
  for (const instance of instances) {
    container.addSeparatorComponents(divider());
    // The label sits above the day's section, not in it, so the button still
    // lines up with the date and time.
    if (instance === next) container.addTextDisplayComponents(text("**NEXT RAID**"));
    const blocks = dayBlocks(instance, rosterIds);
    if (dayButton && !instance.closed && !instance.cancelled) {
      container.addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(blocks).setButtonAccessory(dayButton(instance)),
      );
    } else {
      container.addTextDisplayComponents(blocks);
    }
  }

  container.addSeparatorComponents(divider());
  return container;
}

function selectableInstances(instances: InstanceWithAttendance[]) {
  return instances.filter((i) => !i.closed && !i.cancelled).slice(0, MAX_SELECT_OPTIONS);
}

function selectRow(select: StringSelectMenuBuilder) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
}

/**
 * The public, non-scrolling team message: always the next N upcoming raids, no nav.
 * Each day's button toggles the clicker's call-out. It's shared, so it can't show
 * anyone's own status; the select at the bottom only opens the personal schedule.
 */
export function buildPublicMessage(team: RaidTeam, instances: InstanceWithAttendance[], rosterIds: Set<string>) {
  const container = buildScheduleContainer(
    team,
    instances.slice(0, MAX_PUBLIC_DAYS),
    rosterIds,
    "Click a date ⇄ to call out or switch back.",
    (instance) =>
      new ButtonBuilder()
        .setCustomId(`attendance:btn:${team.id}:${instance.id}`)
        .setLabel(`${shortDateLabel(instance.startsAt, team.timezone)} ⇄`) // ⇄ marks it as a toggle
        .setStyle(ButtonStyle.Primary),
  );

  container.addActionRowComponents(
    selectRow(
      new StringSelectMenuBuilder()
        .setCustomId(`attendance:pub:${team.id}`)
        .setPlaceholder("📅 See more dates…")
        .addOptions({
          label: "See more dates",
          description: "Privately see your full schedule and call out further ahead",
          value: MORE_DATES_VALUE,
          emoji: "📅",
        }),
    ),
  );

  return { flags: V2_FLAGS, components: [container], allowedMentions: NO_PINGS };
}

/**
 * The personal, ephemeral schedule. The card pages PAGE_SIZE raids at a time
 * (state in the customIds); the select lists every open raid with the viewer's
 * own status, so any date is one pick away without paging.
 */
export function buildCalendarMessage(
  team: RaidTeam,
  instances: InstanceWithAttendance[],
  offset: number,
  nav: NavState,
  rosterIds: Set<string>,
  openInstances: InstanceWithAttendance[],
  viewerId: string,
) {
  const container = buildScheduleContainer(team, instances, rosterIds, "Pick any date below to call out or switch back.");

  const dates = selectableInstances(openInstances);
  if (dates.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`attendance:cal:${team.id}:${offset}`)
      .setPlaceholder("Call out or switch back…")
      .addOptions(
        dates.map((instance) => {
          const out = instance.attendance.some((a) => a.userId === viewerId && a.status === "OUT");
          return {
            label: formatRaidLabel(instance.startsAt, team.timezone),
            description: out ? "You're called out — pick to switch back in" : "You're attending — pick to call out",
            value: instance.id,
            emoji: out ? "❌" : "✅",
          };
        }),
      );
    container.addActionRowComponents(selectRow(select));
  }

  container.addActionRowComponents(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
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

  return { flags: V2_FLAGS, components: [container], allowedMentions: NO_PINGS };
}

function shortDateLabel(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat("MMM d");
}
