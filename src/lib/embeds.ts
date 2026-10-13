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
  type GuildMember,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Attendance, RaidInstance, RaidTeam } from "../generated/prisma/client.js";
import {
  CLASSES,
  OFF_SPECS,
  RAID_TYPES,
  SHORT_MARGIN,
  roleTargets,
  type RoleTarget,
  memberClass,
  memberOffSpecs,
  memberRaidType,
  offSpecMarker,
  raidTypeIcon,
  type RaidType,
} from "./classes.js";
import { appEmoji } from "./emojis.js";
import { formatRaidLabel } from "./pickers.js";
import { discordTime, raidTime } from "./time.js";

type InstanceWithAttendance = RaidInstance & { attendance: Attendance[] };

export interface NavState {
  canEarlier: boolean;
  canLater: boolean;
}

/** Discord's cap on options in one select menu. */
export const MAX_SELECT_OPTIONS = 25;

/** Select value on the public message that opens the personal full schedule. */
export const MORE_DATES_VALUE = "more";

/** Select values on the public message that privately show one raid's roster: "roster:<raidId>". */
export const ROSTER_VALUE_PREFIX = "roster:";

/** The schedule's date select and the /attendance date picker describe each raid the same way. */
export const PICK_TO_CALL_OUT = "You're in. Pick to call out";
export const PICK_TO_COME_BACK = "You're called out. Pick to switch back in";

/**
 * Discord caps a Components V2 message at 40 components, nested ones included.
 * The public message's Next Up container costs up to 10 (container, 5 text
 * blocks, divider, and a section with a short note beside the button) and the
 * Coming Up container 4 (container, header, select row, select) plus 3 per
 * later raid (section, text, button). So it fits 14 + 3 × (days − 1) ≤ 40 →
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

function selectableInstances(instances: InstanceWithAttendance[]) {
  return instances.filter((i) => !i.closed && !i.cancelled).slice(0, MAX_SELECT_OPTIONS);
}

function selectRow(select: StringSelectMenuBuilder) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
}

const STATUS_COLORS = { green: 0x3ba55c, yellow: 0xf0b232, red: 0xed4245, grey: 0x6b7280 } as const;
const DOT_FALLBACKS = { green: "🟢", yellow: "🟡", red: "🔴", grey: "⚪" } as const;
type Status = keyof typeof DOT_FALLBACKS;
const SEG_FALLBACKS: Record<Status, string> = { green: "🟩", yellow: "🟨", red: "🟥", grey: "⬛" };

const BAR_SEGMENTS = 10;
// Discord has no indent and strips leading whitespace, so the line starts with
// an invisible braille blank (U+2800) that keeps the spaces after it. Together
// they're about the width of the large status dot plus its space above.
const INDENT = "\u2800\u2003";

/** Small status dot (padded image) for use beside text; `large` for the raid's own status. */
function dot(status: Status, large = false): string {
  return appEmoji(large ? `dot_lg_${status}` : `dot_${status}`, DOT_FALLBACKS[status]);
}

/** A raider's own in/out mark: a small check or X, padded to sit smaller than the text like the role markers. */
export function statusMark(out: boolean): string {
  return out ? appEmoji("mark_out", "❌") : appEmoji("mark_in", "✅");
}

/** Whole-raid status against the raid size: full → green, up to SHORT_MARGIN under → yellow, else red. */
function raidStatus(attending: number, size: number): Status {
  return attending >= size ? "green" : attending >= size - SHORT_MARGIN ? "yellow" : "red";
}

/** Role status: at its want → green, at its need → yellow, else red. */
function roleStatus(inCount: number, target: RoleTarget): Status {
  return inCount >= target.want ? "green" : inCount >= target.need ? "yellow" : "red";
}

/**
 * 10 segments in the raid's status color, filled for raiders in out of the raid
 * size and outlined for open spots; any shortfall leaves at least one outlined.
 */
function attendanceBar(attending: number, size: number, status: Status): string {
  const filled = attending >= size ? BAR_SEGMENTS : Math.min(BAR_SEGMENTS - 1, Math.floor((BAR_SEGMENTS * attending) / size));
  return appEmoji(`seg_${status}`, SEG_FALLBACKS[status]).repeat(filled) + appEmoji("seg_empty", "⬜").repeat(BAR_SEGMENTS - filled);
}

/**
 * A raider's section on the schedule and in /roster: their type role, or Damage
 * without one (the usual case for an untagged raider).
 */
function rosterType(member: GuildMember): RaidType {
  return memberRaidType(member) ?? RAID_TYPES.at(-1)!;
}

/** Who's in and out of one raid, and per-role counts against the team's raid size. */
function raidAttendance(team: RaidTeam, instance: InstanceWithAttendance, members: GuildMember[]) {
  const outIds = new Set(instance.attendance.filter((a) => a.status === "OUT").map((a) => a.userId));
  const attending = members.filter((m) => !outIds.has(m.id));
  const out = members.filter((m) => outIds.has(m.id));
  const targets = roleTargets(team.raidSize);
  const roles = RAID_TYPES.map((type, i) => {
    const inCount = attending.filter((m) => rosterType(m) === type).length;
    return { type, inCount, want: targets[i]!.want, status: roleStatus(inCount, targets[i]!) };
  });
  return { attending, out, size: team.raidSize, roles, status: raidStatus(attending.length, team.raidSize) };
}

/**
 * Role counts by icon, each as raiders in out of the role's want. Next Up's are
 * bold with every role's dot, which still fits a phone line with double-digit
 * counts; Coming Up's are plain, since each raid's own dot covers it. Roles are
 * an em space apart; a dot is padded, so only an en space follows one.
 */
function roleCounts(roles: ReturnType<typeof raidAttendance>["roles"], nextUp = false): string {
  const b = nextUp ? "**" : "";
  return roles
    .map((r, i) => {
      const sep = i === 0 ? "" : nextUp ? "\u2002" : "\u2003";
      return `${sep}${raidTypeIcon(r.type)} ${b}${r.inCount}/${r.want}${b}${nextUp ? ` ${dot(r.status)}` : ""}`;
    })
    .join("");
}

/** A display name as an inline-code chip. A backtick would end the chip early, so it becomes a look-alike. */
function chip(name: string): string {
  return `\`${name.replaceAll("`", "ˋ")}\``;
}

/** One line: a class icon (or the class name if its emoji isn't uploaded), then chips. */
interface RosterLine {
  prefix: string;
  entries: string[];
}

interface RosterSection {
  heading: string;
  lines: RosterLine[];
}

/**
 * Members grouped one line per class, in CLASSES order, skipping empty classes,
 * then an unlabelled line for raiders with no class role. `rank` orders within a line, then name.
 */
function classLines(members: GuildMember[], entry: (m: GuildMember) => string, rank: (m: GuildMember) => number) {
  const line = (prefix: string, group: GuildMember[]): RosterLine => ({
    prefix,
    entries: [...group]
      .sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName))
      .map(entry),
  });
  const lines = CLASSES.map((c) =>
    line(appEmoji(c.emoji, `**${c.label}**`), members.filter((m) => memberClass(m) === c)),
  );
  lines.push(line("", members.filter((m) => !memberClass(m))));
  return lines.filter((l) => l.entries.length > 0);
}

/** A small-text section heading with its count, e.g. "TANKS · 4". */
function sectionHeading(label: string, count: number): string {
  return `-# **${label.toUpperCase()} · ${count}**`;
}

/**
 * The attending roster: Tanks, Healers and Damage sections, always shown so a
 * missing role stands out. Damage mains show their off-spec markers, which sort
 * them first in their class.
 */
function rosterSections(attending: GuildMember[]): RosterSection[] {
  const offSpecRank = (m: GuildMember) => {
    const first = memberOffSpecs(m)[0];
    return first ? OFF_SPECS.indexOf(first) : OFF_SPECS.length;
  };
  const damageEntry = (m: GuildMember) => memberOffSpecs(m).map(offSpecMarker).join("") + chip(m.displayName);
  const nameEntry = (m: GuildMember) => chip(m.displayName);

  return RAID_TYPES.map((type, i) => {
    const group = attending.filter((m) => rosterType(m) === type);
    const damage = i === RAID_TYPES.length - 1;
    return {
      heading: sectionHeading(type.label, group.length),
      lines: classLines(group, damage ? damageEntry : nameEntry, damage ? offSpecRank : () => 0),
    };
  });
}

/** Called-out raiders by class, names only (no role or off-spec markers), tanks first, then healers. */
function calledOutSection(out: GuildMember[]): RosterSection {
  const typeRank = (m: GuildMember) => RAID_TYPES.indexOf(rosterType(m));
  return {
    heading: sectionHeading("Called out", out.length),
    lines: classLines(out, (m) => chip(m.displayName), typeRank),
  };
}

/**
 * Sections as lines: a small-text heading, then one normal-size line per class
 * (small chips were too hard to read on desktop); a heading alone gets " —".
 * A blank line separates sections. Stops with "…and N more" before passing
 * `budget` characters.
 */
function fitSections(sections: RosterSection[], budget: number): string[] {
  const total = sections.reduce((n, s) => n + s.lines.reduce((k, l) => k + l.entries.length, 0), 0);
  const moreLine = (n: number) => `-# …and ${n} more`;
  // Room kept for the "…and N more" line (and its newline) while raiders remain unshown.
  const reserve = moreLine(total).length + 1;
  const lines: string[] = [];
  let length = 0; // the kept lines' text, plus a newline each
  let shown = 0;
  const fits = (extra: number) => length + extra + (shown < total ? reserve : 0) <= budget;
  const push = (line: string) => {
    lines.push(line);
    length += line.length + 1;
  };
  for (const [s, section] of sections.entries()) {
    const heading = section.lines.length > 0 ? section.heading : `${section.heading} —`;
    const gap = s > 0 ? 1 : 0; // the blank line before it
    if (!fits(gap + heading.length + 1)) break;
    if (gap) push("");
    push(heading);
    for (const { prefix, entries } of section.lines) {
      let line = prefix;
      for (const [i, entry] of entries.entries()) {
        const piece = `${i === 0 && !prefix ? "" : " "}${entry}`;
        shown++;
        if (!fits(line.length + piece.length + 1)) {
          shown--;
          if (i > 0) push(line);
          lines.push(moreLine(total - shown));
          return lines;
        }
        line += piece;
      }
      push(line);
    }
  }
  if (shown < total) lines.push(moreLine(total - shown));
  return lines;
}

/** The off-spec key under the role counts, e.g. "Offtank 1 · Offheals 2", when the roster has any. */
function offSpecKey(members: GuildMember[], attending: GuildMember[]): string {
  const present = OFF_SPECS.filter((o) => members.some((m) => memberOffSpecs(m).includes(o)));
  if (present.length === 0) return "";
  const count = (o: (typeof OFF_SPECS)[number]) => attending.filter((m) => memberOffSpecs(m).includes(o)).length;
  return `\n-# ${present.map((o) => `${offSpecMarker(o)} ${o.label} ${count(o)}`).join(" · ")}`;
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

/**
 * A line on top of a private view saying what just changed. A confirmation of an
 * attendance change carries an Undo button (its customId, from `undoCustomId`).
 */
export type Notice = string | { text: string; undoId: string };

/**
 * Where an Undo button redraws: the Status reply, /attendance (all teams, or "t"
 * for just the button's team), or /schedule at an offset.
 */
export type UndoView = "s" | "a" | "t" | `c${number}`;

/** Undo sets the raider to `target` explicitly (never toggles), so a stale click can't flip the wrong way. */
export function undoCustomId(teamId: string, raidId: string, target: "in" | "out", view: UndoView): string {
  return `attendance:undo:${teamId}:${raidId}:${target}:${view}`;
}

/** The one wording for an attendance change, with an Undo button that switches it back. */
export function confirmation(out: boolean, startsAt: Date, teamId: string, raidId: string, view: UndoView): Notice {
  return {
    text: `${statusMark(out)} ${out ? "You're out" : "You're back in"} for **${raidTime(startsAt, "short")}**.`, // beside its Undo button
    undoId: undoCustomId(teamId, raidId, out ? "in" : "out", view),
  };
}

/** Components a notice costs: a text block, or a section with its text and Undo button. */
function noticeCost(notice: Notice | undefined): number {
  return notice === undefined ? 0 : typeof notice === "string" ? 1 : 3;
}

function noticeComponents(notice: Notice | undefined) {
  if (notice === undefined) return [];
  if (typeof notice === "string") return [text(notice)];
  return [
    new SectionBuilder()
      .addTextDisplayComponents(text(notice.text))
      .setButtonAccessory(
        new ButtonBuilder().setCustomId(notice.undoId).setLabel("Undo").setStyle(ButtonStyle.Secondary),
      ),
  ];
}

/** A confirmation on its own, as the private reply to a Status click. */
export function buildNoticeMessage(notice: Notice) {
  return { flags: V2_FLAGS, components: noticeComponents(notice), allowedMentions: NO_PINGS };
}

/** What the schedule post and /schedule say before a team has any raids. */
const NO_RAIDS_YET = "No raids to show here yet. Officers can add weekly raid nights with `/raidlead nights add`.";

/** The text beside the Next Up Status button. */
const STATUS_NOTE = "-# Can't make it, or back in? **Status** toggles your attendance.";

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
  teamName: string,
  instance: InstanceWithAttendance,
  members: GuildMember[],
  textBudget: number,
  { label, withButton }: RaidCardOptions,
) {
  const header = text(
    `-# **${teamName.toUpperCase()} · ${label}**\n## ${raidTime(instance.startsAt)}\n-# ${discordTime(instance.startsAt, "R")}`,
  );

  if (instance.cancelled) {
    return new ContainerBuilder()
      .setAccentColor(STATUS_COLORS.grey)
      .addTextDisplayComponents(header, text("🚫 **Cancelled**"));
  }

  const raid = raidAttendance(team, instance, members);
  const bar = text(`${attendanceBar(raid.attending.length, raid.size, raid.status)}  **${raid.attending.length}/${raid.size} ready**`);
  const summary = text(roleCounts(raid.roles, true) + offSpecKey(members, raid.attending));
  const fixedText = [header, bar, summary].reduce((n, t) => n + (t.data.content?.length ?? 0), 0);
  const rosterBudget = textBudget - fixedText - (withButton ? STATUS_NOTE.length : 0);

  // Its own text block, so Discord leaves a gap above it. Gets up to a third of
  // the roster budget; the roster sections get the rest.
  const calledOut =
    raid.out.length > 0 ? fitSections([calledOutSection(raid.out)], Math.floor(rosterBudget / 3)).join("\n") : "";
  const roster = fitSections(rosterSections(raid.attending), rosterBudget - calledOut.length).join("\n");

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
        .addTextDisplayComponents(text(STATUS_NOTE))
        .setButtonAccessory(statusButton(team, instance)),
    );
}

/**
 * One raid as Coming Up shows it: status dot, date, time and attendance, then its
 * role counts, indented to line up under the date. A cancelled raid is one line.
 */
function raidLine(team: RaidTeam, instance: InstanceWithAttendance, members: GuildMember[]): string {
  const when = `**${raidTime(instance.startsAt, "short")}**`; // beside a button
  if (instance.cancelled) return `🚫 ${when} · Cancelled`;
  const raid = raidAttendance(team, instance, members);
  return `${dot(raid.status, true)} ${when} · ${raid.attending.length}/${raid.size}\n-# ${INDENT}${roleCounts(raid.roles)}`;
}

/**
 * Coming Up: each later raid on one line with its role counts, plus the select that
 * opens the personal schedule or privately shows one Coming Up raid's roster. A
 * section takes only one button, so the roster shortcuts live in the select.
 */
function comingUpContainer(team: RaidTeam, later: InstanceWithAttendance[], members: GuildMember[]) {
  const container = new ContainerBuilder();
  if (later.length > 0) container.addTextDisplayComponents(text("-# **COMING UP**"));

  for (const instance of later) {
    const line = raidLine(team, instance, members);
    if (instance.cancelled) {
      container.addTextDisplayComponents(text(line));
      continue;
    }
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(text(line)).setButtonAccessory(statusButton(team, instance)),
    );
  }

  const rosterOptions = later
    .filter((instance) => !instance.cancelled)
    .map((instance) => ({
      label: `Roster · ${formatRaidLabel(instance.startsAt, team.timezone)}`,
      description: "See who's in and out for this raid",
      value: `${ROSTER_VALUE_PREFIX}${instance.id}`,
      emoji: "ℹ️",
    }));

  return container.addActionRowComponents(
    selectRow(
      new StringSelectMenuBuilder()
        .setCustomId(`attendance:pub:${team.id}`)
        .setPlaceholder(rosterOptions.length > 0 ? "📅 See more dates or a roster…" : "📅 See more dates…")
        .addOptions(
          {
            label: "See more dates",
            description: "See your full schedule and call out further ahead",
            value: MORE_DATES_VALUE,
            emoji: "📅",
          },
          ...rosterOptions,
        ),
    ),
  );
}

/**
 * The public, non-scrolling team message: the next raid as a Next Up hero with the
 * full roster, then the following raids under Coming Up. Every raid's "Status ⇄"
 * button toggles the clicker's call-out. It's shared, so it can't show anyone's own
 * status; the select at the bottom opens the personal schedule for that.
 */
export function buildPublicMessage(
  team: RaidTeam,
  teamName: string,
  instances: InstanceWithAttendance[],
  members: GuildMember[],
) {
  const shown = instances.slice(0, MAX_PUBLIC_DAYS);
  const [next, ...later] = shown;

  const comingUp = comingUpContainer(team, later, members);
  const components = next
    ? [
        raidCard(team, teamName, next, members, MAX_MESSAGE_TEXT - textLength(comingUp), { label: "NEXT UP", withButton: true }),
        comingUp,
      ]
    : [
        new ContainerBuilder()
          .setAccentColor(0x5865f2)
          .addTextDisplayComponents(
            text(`-# **${teamName.toUpperCase()} · SCHEDULE**\n## No raids yet\n-# ${NO_RAIDS_YET}`),
          ),
      ];

  return { flags: V2_FLAGS, components, allowedMentions: NO_PINGS };
}

/** A read-only card for one raid (the /roster view): like Next Up, without the Status button. */
export function buildRaidRosterCard(
  team: RaidTeam,
  teamName: string,
  instance: InstanceWithAttendance,
  members: GuildMember[],
) {
  const card = raidCard(team, teamName, instance, members, MAX_MESSAGE_TEXT, { label: "ROSTER", withButton: false });
  return { flags: V2_FLAGS, components: [card], allowedMentions: NO_PINGS };
}

/**
 * A team's whole roster (the /roster view without a date): role counts, then
 * everyone in the same Tanks, Healers and Damage sections as Next Up.
 */
export function buildTeamRosterCard(teamName: string, members: GuildMember[]) {
  const header = text(
    `-# **${teamName.toUpperCase()} · ROSTER**\n## ${members.length} ${members.length === 1 ? "raider" : "raiders"}`,
  );
  const card = new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(header);

  if (members.length === 0) {
    card.addTextDisplayComponents(text("-# No one has this role yet."));
  } else {
    const counts = RAID_TYPES.map(
      (type) => `${raidTypeIcon(type)} **${members.filter((m) => rosterType(m) === type).length}**`,
    ).join("\u2003");
    const summary = text(counts + offSpecKey(members, members));
    const fixedText = [header, summary].reduce((n, t) => n + (t.data.content?.length ?? 0), 0);
    card
      .addTextDisplayComponents(summary)
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(text(fitSections(rosterSections(members), MAX_MESSAGE_TEXT - fixedText).join("\n")));
  }

  return { flags: V2_FLAGS, components: [card], allowedMentions: NO_PINGS };
}

/** Privately shows one raid's roster card, as /roster with that date does. */
function rosterButton(team: RaidTeam, instance: InstanceWithAttendance) {
  return new ButtonBuilder()
    .setCustomId(`attendance:ros:${team.id}:${instance.id}`)
    .setLabel("Roster")
    .setStyle(ButtonStyle.Secondary);
}

/**
 * About how many characters of small text fit on a line beside a button on
 * desktop, a chip counting three more for its padding and space. Chip lists break before
 * this themselves, since Discord can't indent a wrapped line. A phone is
 * narrower and still wraps its lines to the edge.
 */
const CHIP_LINE_WIDTH = 80;

/** Rough on-screen width of a line: a custom emoji is about two characters. */
function visibleWidth(line: string): number {
  return line.replace(/^-# /, "").replace(/<a?:\w+:\d+>/g, "xx").length;
}

/**
 * Names as chips after `prefix`, ending with "…and N more" before passing
 * `budget` characters. With `indent`, a line that would get too wide breaks
 * onto a new small-text line starting with `indent`, so the chips line up
 * under the text instead of wrapping to the edge.
 */
function chipList(prefix: string, names: string[], budget: number, indent?: string): string {
  let line = prefix;
  let width = visibleWidth(prefix.slice(prefix.lastIndexOf("\n") + 1));
  for (const [i, name] of names.entries()) {
    const chipWidth = name.length + 3;
    const wrap = indent !== undefined && width + chipWidth > CHIP_LINE_WIDTH;
    const piece = `${wrap ? `\n-# ${indent}` : " "}${chip(name)}`;
    const more = ` …and ${names.length - i} more`;
    if (line.length + piece.length + (i < names.length - 1 ? more.length : 0) > budget) return line + more;
    line += piece;
    width = wrap ? visibleWidth(indent) + chipWidth : width + chipWidth;
  }
  return line;
}

/**
 * One day of the personal schedule: the Coming Up line, then the viewer's own
 * status (when they're on the roster) and who's called out.
 */
function calendarDay(
  team: RaidTeam,
  instance: InstanceWithAttendance,
  members: GuildMember[],
  viewer: GuildMember | undefined,
  budget: number,
): string {
  const line = raidLine(team, instance, members);
  if (instance.cancelled) return line;

  const { out } = raidAttendance(team, instance, members);
  const viewerOut = viewer !== undefined && out.includes(viewer);
  const parts: string[] = [];
  if (viewer) {
    const tense = instance.closed ? " were" : "'re";
    parts.push(`${statusMark(viewerOut)} You${tense} ${viewerOut ? "out" : "in"}`);
  }
  const head = `${line}\n-# ${INDENT}${parts.join("")}`;
  const others = out
    .filter((m) => m !== viewer)
    .map((m) => m.displayName)
    .sort((a, b) => a.localeCompare(b));
  if (others.length === 0) return parts.length > 0 ? head : line;
  return chipList(`${head}${parts.length > 0 ? " · " : ""}Called out:`, others, budget, INDENT);
}

/**
 * The personal, ephemeral schedule, in the same style as the public post's
 * Coming Up. The card pages PAGE_SIZE raids at a time (state in the customIds);
 * the select lists every open raid with the viewer's own status, so any date is
 * one pick away without paging. Each raid but a cancelled one has a Roster button
 * that privately opens its roster card. Someone not on the roster (an officer looking at
 * another team) gets the card without the select. `notice` (what a pick just
 * changed, with Undo) goes on top.
 */
export function buildCalendarMessage(
  team: RaidTeam,
  teamName: string,
  instances: InstanceWithAttendance[],
  offset: number,
  nav: NavState,
  members: GuildMember[],
  openInstances: InstanceWithAttendance[],
  viewerId: string,
  notice?: Notice,
  viewerZone: string | null = null,
) {
  const viewer = members.find((m) => m.id === viewerId);
  const dates = viewer ? selectableInstances(openInstances) : [];
  // The select's labels are plain text: the viewer's own timezone if they set one.
  const zone = viewerZone ?? team.timezone;
  const anyOpen = instances.some((i) => !i.closed);
  const intro =
    instances.length === 0
      ? NO_RAIDS_YET
      : !anyOpen
        ? "These raids already happened, so attendance is locked."
        : dates.length > 0
          ? `Pick a date below to call out or switch back in.${viewerZone ? "" : " Set your timezone with `/timezone` to see its times in yours."}`
          : viewer
            ? "Nothing to call out of right now."
            : "You're not on this team's roster, so this is view-only.";
  const header = text(`-# **${teamName.toUpperCase()} · YOUR SCHEDULE**\n-# ${intro}`);

  const container = new ContainerBuilder()
    .setAccentColor(instances.length > 0 && !anyOpen ? STATUS_COLORS.grey : 0x5865f2)
    .addTextDisplayComponents(header);

  const dayBudget = Math.floor((MAX_MESSAGE_TEXT - (header.data.content?.length ?? 0)) / Math.max(1, instances.length));
  for (const instance of instances) {
    const day = text(calendarDay(team, instance, members, viewer, dayBudget));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    // A cancelled raid has no roster to show, so it's text alone, as in Coming Up.
    if (instance.cancelled) container.addTextDisplayComponents(day);
    else {
      container.addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(day).setButtonAccessory(rosterButton(team, instance)),
      );
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (dates.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`attendance:cal:${team.id}:${offset}`)
      .setPlaceholder("Call out or switch back in…")
      .addOptions(
        dates.map((instance) => {
          const out = instance.attendance.some((a) => a.userId === viewerId && a.status === "OUT");
          return {
            label: formatRaidLabel(instance.startsAt, zone),
            description: out ? PICK_TO_COME_BACK : PICK_TO_CALL_OUT,
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

  return { flags: V2_FLAGS, components: [...noticeComponents(notice), container], allowedMentions: NO_PINGS };
}

/**
 * Switches the viewer back in for one raid from /attendance, then redraws it;
 * ":t" redraws only this team, as /attendance team: showed it.
 */
function backInButton(team: RaidTeam, instance: InstanceWithAttendance, oneTeam: boolean) {
  return new ButtonBuilder()
    .setCustomId(`attendance:in:${team.id}:${instance.id}${oneTeam ? ":t" : ""}`)
    .setLabel("Back in")
    .setStyle(ButtonStyle.Secondary);
}

/** One team's block of the /attendance view. */
export interface AttendanceTeam {
  team: RaidTeam;
  teamName: string;
  /** The team's open raids, soonest first. */
  instances: InstanceWithAttendance[];
  members: GuildMember[];
}

/**
 * Components V2 caps a message at 40 components. A team's container costs 4
 * (container, header, divider, footer) and each call-out 4 (divider, section,
 * text, button), with up to 3 more for the confirmation and its Undo button. So
 * one team fits 3 + 4 + 4 × 8 = 39.
 */
const MAX_ATTENDANCE_COMPONENTS = 40;

/**
 * The /attendance view: per team, how many upcoming raids the viewer is in for,
 * then each raid they're called out of as a Coming Up line with a Back in
 * button. `notice` (e.g. what /attendance date: just changed) goes on top.
 * `oneTeam` marks a view narrowed by /attendance team:, so its buttons redraw it narrowed.
 */
export function buildAttendanceMessage(teams: AttendanceTeam[], viewerId: string, notice?: Notice, oneTeam = false) {
  const fixed = noticeCost(notice) + 4 * teams.length;
  const perTeam = Math.max(0, Math.floor((MAX_ATTENDANCE_COMPONENTS - fixed) / 4 / Math.max(1, teams.length)));

  const containers = teams.map(({ team, teamName, instances, members }) => {
    const upcoming = instances.filter((i) => !i.closed && !i.cancelled);
    const out = upcoming.filter((i) => i.attendance.some((a) => a.userId === viewerId && a.status === "OUT"));
    const shown = out.slice(0, perTeam);
    const n = upcoming.length;

    const headline =
      n === 0
        ? "No upcoming raids yet"
        : out.length === 0
          ? `${statusMark(false)} You're in for ${n === 1 ? "the next raid" : `all ${n} upcoming raids`}`
          : n === 1
            ? "You're out of the next raid"
            : `You're in for ${n - out.length} of the next ${n} raids`;
    const sub = out.length > 0 ? `\n-# Called out of ${out.length}. **Back in** switches you back.` : "";
    const container = new ContainerBuilder()
      .setAccentColor(0x5865f2)
      .addTextDisplayComponents(text(`-# **${teamName.toUpperCase()} · YOUR ATTENDANCE**\n## ${headline}${sub}`));

    for (const instance of shown) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(text(raidLine(team, instance, members)))
            .setButtonAccessory(backInButton(team, instance, oneTeam)),
        );
    }

    if (n === 0) return container;
    const hidden = out.length - shown.length;
    const more = hidden > 0 ? `-# …and ${hidden} more ${hidden === 1 ? "call-out" : "call-outs"}, all in \`/schedule\`.\n` : "";
    return container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(
        text(`${more}-# Call out of ${out.length > 0 ? "another raid" : "one"} with \`/attendance date:\``),
      );
  });

  return {
    flags: V2_FLAGS,
    components: [...noticeComponents(notice), ...containers],
    allowedMentions: NO_PINGS,
  };
}
