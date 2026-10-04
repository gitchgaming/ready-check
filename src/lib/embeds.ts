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
  ComponentType,
  escapeMarkdown,
  type GuildMember,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Attendance, RaidInstance, RaidTeam } from "../generated/prisma/client.js";
import { DateTime } from "luxon";
import { CLASSES, RAID_TYPES, memberClass, memberRaidType, raidTypeIcon } from "./classes.js";
import { appEmoji } from "./emojis.js";
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
 * The public message's Next Up container costs up to 11 (container, 5 text
 * blocks, divider, and a section with a blank text block beside the button) and
 * the Coming Up container 4 (container, header, select row, select) plus 3 per
 * later raid (section, text, button). So it fits 15 + 3 × (days − 1) ≤ 40 →
 * 9 days.
 */
export const MAX_PUBLIC_DAYS = 9;

/** The team's `coming-up` setting (`displayCount`) counts raids after Next Up. */
export const MAX_COMING_UP = MAX_PUBLIC_DAYS - 1;

/** Discord caps the text of all text blocks in one V2 message at 4,000 characters. */
const MAX_MESSAGE_TEXT = 4000;

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

/** The personal schedule card: a header, then each raid day between dividers. */
function buildScheduleContainer(
  team: RaidTeam,
  instances: InstanceWithAttendance[],
  rosterIds: Set<string>,
  openPrompt: string,
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

  for (const instance of instances) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(dayBlocks(instance, rosterIds));
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

const STATUS_COLORS = { green: 0x3ba55c, yellow: 0xf0b232, red: 0xed4245, grey: 0x6b7280 } as const;
const DOT_FALLBACKS = { green: "🟢", yellow: "🟡", red: "🔴", grey: "⚪" } as const;
type Status = keyof typeof DOT_FALLBACKS;

const BAR_SEGMENTS = 10;
const GAP = "\u2003\u2003"; // two em spaces between role summary items
// Discord has no indent and strips leading whitespace, so the line starts with
// an invisible braille blank (U+2800) that keeps the spaces after it. Together
// they're about the width of the large status dot plus its space above.
const INDENT = "\u2800\u2003";

/** Small status dot (padded image) for use beside text; `large` for the raid's own status. */
function dot(status: Status, large = false): string {
  return appEmoji(large ? `dot_lg_${status}` : `dot_${status}`, DOT_FALLBACKS[status]);
}

/** Whole-raid status: everyone in → green, at least half → yellow, else red. */
function raidStatus(attending: number, total: number): Status {
  return attending === total ? "green" : attending * 2 >= total ? "yellow" : "red";
}

/** Role status: enough (or all of that role) in → grey, one short → yellow, else red. */
function roleStatus(inCount: number, rosterCount: number, min: number): Status {
  if (inCount === rosterCount || inCount >= min) return "grey";
  return inCount === min - 1 ? "yellow" : "red";
}

/**
 * Small status dots stay grey when things are fine, so only problems draw the
 * eye. The large dot before each Coming Up date keeps green: it stands in for
 * the accent bar the Next Up container has.
 */
function statusDot(status: Status): string {
  return dot(status === "green" ? "grey" : status);
}

/** 10 segments; any call-out shows at least one red one. */
function attendanceBar(attending: number, total: number): string {
  const green = attending === total ? BAR_SEGMENTS : Math.min(BAR_SEGMENTS - 1, Math.floor((BAR_SEGMENTS * attending) / total));
  return appEmoji("seg_green", "🟩").repeat(green) + appEmoji("seg_red", "🟥").repeat(BAR_SEGMENTS - green);
}

/** Who's in and out of one raid, and per-role counts, from the current roster. */
function raidAttendance(instance: InstanceWithAttendance, members: GuildMember[]) {
  const outIds = new Set(instance.attendance.filter((a) => a.status === "OUT").map((a) => a.userId));
  const attending = members.filter((m) => !outIds.has(m.id));
  const out = members.filter((m) => outIds.has(m.id));
  const roles = RAID_TYPES.map((type) => {
    const rosterCount = members.filter((m) => memberRaidType(m) === type).length;
    const inCount = attending.filter((m) => memberRaidType(m) === type).length;
    return { type, inCount, rosterCount, status: roleStatus(inCount, rosterCount, type.min) };
  });
  return { attending, out, total: members.length, roles, status: raidStatus(attending.length, members.length) };
}

function raidDate(instance: InstanceWithAttendance, timezone: string) {
  return DateTime.fromJSDate(instance.startsAt).setZone(timezone);
}

/**
 * One line per class, in CLASSES order, always shown ("—" when no one of that
 * class is attending), then "Other" for raiders with no class role, if any. Within a line: tanks (🛡️), healers (healer icon),
 * then everyone else, each alphabetical. Stops with "…and N more" past `budget`.
 */
function classLines(attending: GuildMember[], budget: number): string[] {
  const typeRank = (m: GuildMember) => {
    const type = memberRaidType(m);
    return type ? RAID_TYPES.indexOf(type) : RAID_TYPES.length;
  };
  const marker = (m: GuildMember) => {
    const type = memberRaidType(m);
    return type?.marker ? appEmoji(type.marker, raidTypeIcon(type)) : "";
  };

  const others = attending.filter((m) => !memberClass(m));
  const groups: { heading: string; members: GuildMember[] }[] = [
    ...CLASSES.map((c) => ({
      heading: `${appEmoji(c.emoji)} **${c.label}**`.trim(),
      members: attending.filter((m) => memberClass(m) === c),
    })),
    ...(others.length > 0 ? [{ heading: "**Other**", members: others }] : []),
  ];

  const lines: string[] = [];
  let length = 0;
  let shown = 0;
  for (const group of groups) {
    const entries = [...group.members]
      .sort((a, b) => typeRank(a) - typeRank(b) || a.displayName.localeCompare(b.displayName))
      .map((m) => `${marker(m)}${escapeMarkdown(m.displayName)}`);
    let line = entries.length > 0 ? group.heading : `${group.heading} —`;
    for (const [i, entry] of entries.entries()) {
      const piece = `${i === 0 ? " " : ", "}${entry}`;
      if (length + line.length + piece.length + 1 > budget) {
        lines.push(line, `-# …and ${attending.length - shown} more`);
        return lines;
      }
      line += piece;
      shown++;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines;
}

/** Called-out raiders as class icon + mention, grouped in CLASSES order then by name. */
function outEntries(out: GuildMember[]): string[] {
  const classOrder = (m: GuildMember) => {
    const c = memberClass(m);
    return c ? CLASSES.indexOf(c) : CLASSES.length;
  };
  return [...out]
    .sort((a, b) => classOrder(a) - classOrder(b) || a.displayName.localeCompare(b.displayName))
    .map((m) => {
      const c = memberClass(m);
      const icon = c ? appEmoji(c.emoji) : "";
      return icon ? `${icon} <@${m.id}>` : `<@${m.id}>`;
    });
}

/** Total characters in a component tree's text blocks (what Discord's 4,000 limit counts). */
function textLength(component: { toJSON(): unknown }): number {
  let total = 0;
  const walk = (c: { type?: number; content?: string; components?: unknown[]; accessory?: unknown }) => {
    if (c.type === ComponentType.TextDisplay) total += c.content?.length ?? 0;
    for (const child of c.components ?? []) walk(child as typeof c);
  };
  walk(component.toJSON() as Parameters<typeof walk>[0]);
  return total;
}

/** Joins as many entries as fit in `max` characters, ending with "…and N more" if some don't. */
function fitEntries(entries: string[], separator: string, max: number): string {
  let result = "";
  for (const [i, entry] of entries.entries()) {
    const next = (i === 0 ? "" : separator) + entry;
    if (result.length + next.length + 20 > max && i < entries.length - 1) return `${result} …and ${entries.length - i} more`;
    result += next;
  }
  return result;
}

function statusButton(team: RaidTeam, instance: InstanceWithAttendance) {
  return new ButtonBuilder()
    .setCustomId(`attendance:btn:${team.id}:${instance.id}`)
    .setLabel("Status ⇄") // ⇄ marks it as a toggle; it's shared, so it can't show the clicker's state
    .setStyle(ButtonStyle.Secondary);
}

interface RaidCardOptions {
  /** Small label after the team name, e.g. "NEXT UP". */
  label: string;
  /** Whether to include the Status ⇄ button (the public post) or not (read-only views). */
  withButton: boolean;
}

/**
 * One raid as a card: date, attendance bar, role summary and full roster. Used as
 * the public post's Next Up hero and for the read-only /roster view.
 * `textBudget` is what's left of Discord's message text limit.
 */
function raidCard(
  team: RaidTeam,
  instance: InstanceWithAttendance,
  members: GuildMember[],
  textBudget: number,
  { label, withButton }: RaidCardOptions,
) {
  const when = raidDate(instance, team.timezone);
  const unix = Math.floor(instance.startsAt.getTime() / 1000);
  const header = text(
    `-# **${(team.name ?? "Raid").toUpperCase()} · ${label}**\n## ${when.toFormat("ccc, LLL d · h:mm a")}\n-# <t:${unix}:R>`,
  );

  if (instance.cancelled) {
    return new ContainerBuilder()
      .setAccentColor(STATUS_COLORS.grey)
      .addTextDisplayComponents(header, text("🚫 **Cancelled**"));
  }

  const raid = raidAttendance(instance, members);
  const bar = text(`${attendanceBar(raid.attending.length, raid.total)}  **${raid.attending.length}/${raid.total} ready**`);
  const summary = text(
    raid.roles
      .map((r) => `${raidTypeIcon(r.type)} ${r.type.label} **${r.inCount}/${r.rosterCount}** ${statusDot(r.status)}`)
      .join(GAP),
  );
  const fixedText = [header, bar, summary].reduce((n, t) => n + (t.data.content?.length ?? 0), 0);
  const rosterBudget = textBudget - fixedText;

  // Its own text block, so Discord leaves a gap above it. Gets up to a third of
  // the roster budget; the class lines get the rest.
  const outHeading = `-# **CALLED OUT (${raid.out.length})**\n`;
  const calledOut =
    raid.out.length > 0
      ? outHeading + fitEntries(outEntries(raid.out), "  ", Math.floor(rosterBudget / 3) - outHeading.length)
      : "";
  const roster = classLines(raid.attending, rosterBudget - calledOut.length).join("\n");

  const card = new ContainerBuilder()
    .setAccentColor(STATUS_COLORS[raid.status])
    .addTextDisplayComponents(header, bar, summary)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(roster || "-# No one on the roster yet."), ...(calledOut ? [text(calledOut)] : []));
  if (!withButton) return card;
  return card
    // Buttons in a row always sit on the left; as a section's accessory the button
    // sits on the right, lined up with the Coming Up buttons. Its section's text is
    // a short note on what the button does, so the button always gets its own line
    // instead of floating beside a long Called Out list.
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text("-# Can't make it, or back in? **Status** switches you between in and out."))
        .setButtonAccessory(statusButton(team, instance)),
    );
}

/** Coming Up: each later raid on one line with its role counts, plus the "See more dates" select. */
function comingUpContainer(team: RaidTeam, later: InstanceWithAttendance[], members: GuildMember[]) {
  const container = new ContainerBuilder();
  if (later.length > 0) container.addTextDisplayComponents(text("-# **COMING UP**"));

  for (const instance of later) {
    const when = raidDate(instance, team.timezone);
    if (instance.cancelled) {
      container.addTextDisplayComponents(text(`🚫 **${when.toFormat("ccc, LLL d")}** · Cancelled`));
      continue;
    }
    const raid = raidAttendance(instance, members);
    const roles = raid.roles.map((r) => `${statusDot(r.status)} ${r.type.short} ${r.inCount}/${r.rosterCount}`).join("\u2003");
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            `${dot(raid.status, true)} **${when.toFormat("ccc, LLL d")}** ${when.toFormat("h:mm a")} · ${raid.attending.length}/${raid.total}\n-# ${INDENT}${roles}`,
          ),
        )
        .setButtonAccessory(statusButton(team, instance)),
    );
  }

  return container.addActionRowComponents(
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
}

/**
 * The public, non-scrolling team message: the next raid as a Next Up hero with the
 * full roster, then the following raids under Coming Up. Every raid's "Status ⇄"
 * button toggles the clicker's call-out. It's shared, so it can't show anyone's own
 * status; the select at the bottom opens the personal schedule for that.
 */
export function buildPublicMessage(team: RaidTeam, instances: InstanceWithAttendance[], members: GuildMember[]) {
  const shown = instances.slice(0, MAX_PUBLIC_DAYS);
  const [next, ...later] = shown;

  const comingUp = comingUpContainer(team, later, members);
  const components = next
    ? [
        raidCard(team, next, members, MAX_MESSAGE_TEXT - textLength(comingUp), { label: "NEXT UP", withButton: true }),
        comingUp,
      ]
    : [
        new ContainerBuilder().addTextDisplayComponents(
          text(
            `## ${team.name ?? "Raid"} — schedule\nNo raids to show here yet. Officers can add weekly raid nights with \`/raidlead nights add\`.`,
          ),
        ),
      ];

  return { flags: V2_FLAGS, components, allowedMentions: NO_PINGS };
}

/** A read-only card for one raid (the /roster view): like Next Up, without the Status button. */
export function buildRaidRosterCard(team: RaidTeam, instance: InstanceWithAttendance, members: GuildMember[]) {
  const card = raidCard(team, instance, members, MAX_MESSAGE_TEXT, { label: "ROSTER", withButton: false });
  return { flags: V2_FLAGS, components: [card], allowedMentions: NO_PINGS };
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
