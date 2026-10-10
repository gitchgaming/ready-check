import { beforeEach, describe, expect, it } from "vitest";
import { ButtonStyle, ComponentType, MessageFlags, type GuildMember } from "discord.js";
import {
  MAX_PUBLIC_DAYS,
  MAX_SELECT_OPTIONS,
  MORE_DATES_VALUE,
  asEphemeral,
  buildCalendarMessage,
  buildPublicMessage,
  buildRaidRosterCard,
} from "../../src/lib/embeds.js";
import { loadAppEmojis } from "../../src/lib/emojis.js";
import { fakeClient, flattenComponents, payloadText, raider } from "../discord.js";
import { TEAM_ID, cuid, freezeTime, raid, team, weeklyRaids, type RaidRow } from "./fixtures.js";

const NOW = "2026-10-06T12:00:00Z"; // Tue 7 AM in Chicago; first raid is Wed Oct 7, 8 PM.

beforeEach(async () => {
  freezeTime(NOW);
  await loadAppEmojis(fakeClient({ emojis: [] }));
});

type Payload = { flags: readonly MessageFlags[]; components: { toJSON(): unknown }[]; allowedMentions: unknown };

/** The payload with every builder turned into its API JSON. */
const json = (p: Payload) => ({ ...p, components: p.components.map((c) => c.toJSON() as any) });
const containers = (p: Payload) => json(p).components;
const texts = (container: any): string[] =>
  flattenComponents({ components: [container] })
    .filter((c) => c.type === ComponentType.TextDisplay)
    .map((c) => c.content);
const buttons = (p: Payload) => flattenComponents(p).filter((c) => c.type === ComponentType.Button);
const selects = (p: Payload) => flattenComponents(p).filter((c) => c.type === ComponentType.StringSelect);

/** `n` raiders u0..u(n-1), all DPS, no class. */
const squad = (n: number, roles: string[] = ["DPS"]) =>
  Array.from({ length: n }, (_, i) => raider(`Raider ${String(i).padStart(2, "0")}`, roles, `u${i}`));
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `u${from + i}`);

const ROSTER: GuildMember[] = [
  raider("Tankalot", ["Warriors", "Tanks"], "u-tank1"),
  raider("Shieldy", ["Paladins", "Tanks"], "u-tank2"),
  raider("Mendy", ["Priests", "Healers"], "u-heal1"),
  raider("Lightbringer", ["Paladins", "Healers"], "u-heal2"),
  raider("Totem", ["Shamans", "Healers"], "u-heal3"),
  raider("Zap", ["Mages", "Wizards"], "u-mage"),
  raider("Stabby", ["Rogues", "Phys"], "u-rogue"),
  raider("Arrow", ["Hunters", "DPS"], "u-hunter"),
  raider("Axe", ["Warriors", "Phys"], "u-warr"),
  raider("Newbie", [], "u-new"),
];

function nextUp(p: Payload) {
  return containers(p)[0];
}

describe("buildPublicMessage — envelope", () => {
  it("is a Components V2 message that never pings, with or without raids", () => {
    for (const p of [buildPublicMessage(team(), weeklyRaids(3), ROSTER), buildPublicMessage(team(), [], ROSTER)]) {
      expect(p.flags).toEqual([MessageFlags.IsComponentsV2]);
      expect(p.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("has a Next Up container then a Coming Up container", () => {
    const [first, second, ...rest] = containers(buildPublicMessage(team(), weeklyRaids(3), ROSTER));
    expect(first.type).toBe(ComponentType.Container);
    expect(second.type).toBe(ComponentType.Container);
    expect(rest).toEqual([]);
    expect(texts(first)[0]).toContain("NEXT UP");
    expect(texts(second)[0]).toBe("-# **COMING UP**");
  });

  it("shows an empty state with no raids: one container, no buttons or select", () => {
    const p = buildPublicMessage(team(), [], ROSTER);
    expect(containers(p)).toHaveLength(1);
    expect(payloadText(p)).toBe(
      "## Main Raid — schedule\nNo raids to show here yet. Officers can add weekly raid nights with `/raidlead nights add`.",
    );
    expect(buttons(p)).toEqual([]);
    expect(selects(p)).toEqual([]);
  });

  it("calls an unnamed team 'Raid'", () => {
    expect(payloadText(buildPublicMessage(team({ name: null }), [], []))).toContain("## Raid — schedule");
    expect(texts(nextUp(buildPublicMessage(team({ name: null }), weeklyRaids(1), ROSTER)))[0]).toContain("**RAID · NEXT UP**");
  });

  it(`shows at most MAX_PUBLIC_DAYS (${MAX_PUBLIC_DAYS}) raids, soonest first`, () => {
    const raids = weeklyRaids(MAX_PUBLIC_DAYS + 3);
    const p = buildPublicMessage(team(), raids, ROSTER);
    const raidIds = buttons(p).map((b) => b.custom_id.split(":")[3]);
    expect(raidIds).toEqual(raids.slice(0, MAX_PUBLIC_DAYS).map((r) => r.id));
  });
});

describe("buildPublicMessage — Next Up", () => {
  it("heads the card with the team name, label and date in the team's timezone", () => {
    const [first] = weeklyRaids(1);
    const unix = first!.startsAt.getTime() / 1000;
    expect(texts(nextUp(buildPublicMessage(team(), [first!], ROSTER)))[0]).toBe(
      `-# **MAIN RAID · NEXT UP**\n## Wed, Oct 7 · 8:00 PM\n-# <t:${unix}:R>`,
    );
    const berlin = buildPublicMessage(team({ timezone: "Europe/Berlin" }), [first!], ROSTER);
    expect(texts(nextUp(berlin))[0]).toContain("## Thu, Oct 8 · 3:00 AM");
  });

  it.each([
    [20, 0, 10, "green", 0x3ba55c],
    [20, 1, 9, "yellow", 0xf0b232], // any call-out shows at least one red segment
    [20, 10, 5, "yellow", 0xf0b232], // exactly half in is still yellow
    [20, 11, 4, "red", 0xed4245],
    [3, 2, 3, "red", 0xed4245],
    [3, 3, 0, "red", 0xed4245],
  ])("with %i raiders and %i out: %i green segments, %s accent", (size, outCount, green, _status, accent) => {
    const p = buildPublicMessage(team(), [raid("2026-10-08T01:00:00Z", { out: ids(outCount) })], squad(size));
    const card = nextUp(p);
    expect(card.accent_color).toBe(accent);
    expect(texts(card)[1]).toBe(`${"🟩".repeat(green)}${"🟥".repeat(10 - green)}  **${size - outCount}/${size} ready**`);
  });

  it("draws the bar with the segment app emojis when they're uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["seg_green", "seg_red"] }));
    const p = buildPublicMessage(team(), [raid("2026-10-08T01:00:00Z", { out: ["u0"] })], squad(2));
    expect(texts(nextUp(p))[1]).toBe(`${"<:seg_green:9000>".repeat(5)}${"<:seg_red:9001>".repeat(5)}  **1/2 ready**`);
  });

  it("summarises each role as in/roster by icon, with a dot only when short of RAID_TYPES minimums", () => {
    // Full ROSTER: 2 tanks (min 2), 3 healers (min 3), 4 DPS (min 10, but all are in).
    const all = buildPublicMessage(team(), weeklyRaids(1), ROSTER);
    expect(texts(nextUp(all))[2]).toBe("🛡️ **2/2**\u2003➕ **3/3**\u2003⚔️ **4/4**");

    // One tank out → one short (yellow); two healers out → red; one DPS out, 3 < 10 → red.
    const short = buildPublicMessage(
      team(),
      weeklyRaids(1, () => ({ out: ["u-tank1", "u-heal1", "u-heal2", "u-mage"] })),
      ROSTER,
    );
    expect(texts(nextUp(short))[2]).toBe("🛡️ **1/2** 🟡\u2002➕ **1/3** 🔴\u2002⚔️ **3/4** 🔴");
  });

  it("shows no dot on a role once its minimum is met, even with call-outs", () => {
    const tanks = squad(4, ["Tanks"]);
    const p = buildPublicMessage(team(), [raid("2026-10-08T01:00:00Z", { out: ["u0", "u1"] })], tanks);
    expect(texts(nextUp(p))[2]).toBe("🛡️ **2/4**\u2003➕ **0/0**\u2003⚔️ **0/0**");
  });

  it("uses the dot app emojis when uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["dot_grey", "dot_yellow", "dot_red", "healer"] }));
    const p = buildPublicMessage(team(), weeklyRaids(1, () => ({ out: ["u-tank1", "u-heal1", "u-heal2"] })), ROSTER);
    expect(texts(nextUp(p))[2]).toBe(
      "🛡️ **1/2** <:dot_yellow:9001>\u2002<:healer:9003> **1/3** <:dot_red:9002>\u2002⚔️ **4/4**",
    );
  });

  it("splits attending raiders into Tanks, Healers and Damage, one line per class in CLASSES order", () => {
    const roster = [
      raider("Zed", ["Paladins", "Phys"], "p1"),
      raider("Holy", ["Paladins", "Healers"], "p2"),
      raider("Wall", ["Paladins", "Tanks"], "p3"),
      raider("Alpha", ["Paladins", "Phys"], "p4"),
      raider("Cleave", ["Warriors", "Phys"], "w1"),
      raider("Brick", ["Warriors", "Tanks"], "w2"),
    ];
    const lines = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), roster)))[3]!.split("\n");
    expect(lines).toEqual([
      "-# **TANKS · 2**",
      "**Warrior** `Brick`",
      "**Paladin** `Wall`",
      "-# **HEALERS · 1**",
      "**Paladin** `Holy`",
      "-# **DAMAGE · 3**",
      "**Warrior** `Cleave`",
      "**Paladin** `Alpha` `Zed`",
    ]);
  });

  it("uses class emojis in place of class names when uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior"] }));
    const roster = [raider("Wall", ["Warriors", "Tanks"], "a"), raider("Holy", ["Mages", "DPS"], "b")];
    const lines = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), roster)))[3]!.split("\n");
    expect(lines[1]).toBe("<:warrior:9000> `Wall`");
    expect(lines.at(-1)).toBe("**Mage** `Holy`");
  });

  it("marks damage mains' off-specs, offtanks first, then offheals, then the rest", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["mark_offtank", "mark_offheal"] }));
    const roster = [
      raider("Axe", ["Warriors", "DPS"], "a"),
      raider("Heals", ["Warriors", "DPS", "Offheals"], "b"),
      raider("Both", ["Warriors", "Offheals", "Offtank"], "c"),
      raider("Wall", ["Warriors", "Offtank"], "d"),
      raider("Main", ["Warriors", "Tanks", "Offheals"], "e"),
    ];
    const lines = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), roster)))[3]!.split("\n");
    expect(lines).toContain("-# **TANKS · 1**");
    expect(lines).toContain("**Warrior** `Main`");
    expect(lines.at(-1)).toBe(
      "**Warrior** <:mark_offtank:9000><:mark_offheal:9001>`Both` <:mark_offtank:9000>`Wall` <:mark_offheal:9001>`Heals` `Axe`",
    );
  });

  it("adds an off-spec key under the role counts only when the roster has off-specs, counting those attending", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["mark_offtank"] }));
    const roster = [...ROSTER, raider("Skarr", ["Warriors", "Offtank"], "u-ot"), raider("Fern", ["Druids", "DPS", "Offheals"], "u-oh")];
    const summary = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1, () => ({ out: ["u-oh"] })), roster)))[2]!;
    expect(summary.split("\n")[1]).toBe("-# <:mark_offtank:9000> Offtank 1 · ➕ Offheals 0");
    expect(texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), ROSTER)))[2]).not.toContain("\n");
  });

  it("shows raiders with no type role in a No Role section, and those with no class on an Other line", () => {
    const roster = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), ROSTER)))[3]!.split("\n");
    expect(roster.slice(-2)).toEqual(["-# **NO ROLE · 1**", "**Other** `Newbie`"]);
    const p = buildPublicMessage(team(), weeklyRaids(1, () => ({ out: ["u-new"] })), ROSTER);
    expect(texts(nextUp(p))[3]).not.toContain("NO ROLE");
  });

  it("shows names as chips, as typed, with backticks swapped so a chip can't break", () => {
    const p = buildPublicMessage(team(), weeklyRaids(1), [raider("*Star*_`Lord`_", ["Mages", "DPS"], "x")]);
    expect(texts(nextUp(p))[3]).toContain("`*Star*_ˋLordˋ_`");
  });

  it("moves called-out raiders into a Called Out block by class, each with their main role's marker", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior", "mark_tank", "mark_dps"] }));
    const out = ["u-new", "u-warr", "u-tank1", "u-mage", "u-heal1"];
    const p = buildPublicMessage(team(), weeklyRaids(1, () => ({ out })), ROSTER);
    const t = texts(nextUp(p));
    expect(t[3]).not.toMatch(/Tankalot|Axe|Zap|Newbie|Mendy/);
    expect(t[4]!.split("\n")).toEqual([
      "-# **CALLED OUT · 5**",
      "<:warrior:9000> <:mark_tank:9001>`Tankalot` <:mark_dps:9002>`Axe`",
      "**Priest** ➕`Mendy`",
      "**Mage** <:mark_dps:9002>`Zap`",
      "**Other** `Newbie`",
    ]);
  });

  it("leaves off-spec markers out of Called Out", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["mark_offtank"] }));
    const roster = [raider("Skarr", ["Warriors", "DPS", "Offtank"], "u-ot")];
    const t = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1, () => ({ out: ["u-ot"] })), roster)));
    expect(t.at(-1)).not.toContain("mark_offtank");
    expect(t.find((x) => x.startsWith("-# **CALLED OUT"))).toContain("⚔️`Skarr`");
  });

  it("has no Called Out block when everyone is in", () => {
    const t = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), ROSTER)));
    expect(t.join("\n")).not.toContain("CALLED OUT");
  });

  it("only counts call-outs from current roster members, and ignores IN rows", () => {
    const p = buildPublicMessage(
      team(),
      weeklyRaids(1, () => ({ out: ["u-mage", "someone-who-left"], in: ["u-rogue"] })),
      ROSTER,
    );
    const t = texts(nextUp(p));
    expect(t[1]).toContain("**9/10 ready**");
    expect(t[4]).toBe("-# **CALLED OUT · 1**\n**Mage** ⚔️`Zap`");
    expect(t[3]).toContain("Stabby");
  });

  it("ends with the Status ⇄ button for the next raid, on its own line as a section accessory", () => {
    const [first] = weeklyRaids(1);
    const card = nextUp(buildPublicMessage(team(), [first!], ROSTER));
    const last = card.components.at(-1);
    expect(last.type).toBe(ComponentType.Section);
    expect(last.components[0].content).toContain("**Status** switches you between in and out");
    expect(last.accessory).toEqual({
      type: ComponentType.Button,
      custom_id: `attendance:btn:${TEAM_ID}:${first!.id}`,
      label: "Status ⇄",
      style: ButtonStyle.Secondary,
    });
  });

  it("separates the summary from the roster with a divider", () => {
    const types = nextUp(buildPublicMessage(team(), weeklyRaids(1), ROSTER)).components.map((c: any) => c.type);
    expect(types).toEqual([
      ComponentType.TextDisplay,
      ComponentType.TextDisplay,
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.TextDisplay,
      ComponentType.Section,
    ]);
  });

  it("keeps a cancelled next raid in the Next Up spot, grey, without stats or a button", () => {
    const raids = weeklyRaids(3, (i) => ({ cancelled: i === 0 }));
    const p = buildPublicMessage(team(), raids, ROSTER);
    const card = nextUp(p);
    expect(card.accent_color).toBe(0x6b7280);
    expect(texts(card)).toEqual([expect.stringContaining("## Wed, Oct 7 · 8:00 PM"), "🚫 **Cancelled**"]);
    expect(buttons(p).map((b) => b.custom_id.split(":")[3])).toEqual([raids[1]!.id, raids[2]!.id]);
  });

  it("always shows the Tanks, Healers and Damage headings, with a dash when a section is empty", () => {
    const t = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), [raider("Wall", ["Warriors", "Tanks"], "a")])));
    expect(t[3]!.split("\n")).toEqual([
      "-# **TANKS · 1**",
      "**Warrior** `Wall`",
      "-# **HEALERS · 0** —",
      "-# **DAMAGE · 0** —",
    ]);
  });

  it("says so when the role has no members", () => {
    const t = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), [])));
    expect(t[3]).toBe("-# **TANKS · 0** —\n-# **HEALERS · 0** —\n-# **DAMAGE · 0** —");
  });

  it("truncates the roster with '…and N more' when it's too long", () => {
    const longRoster = Array.from({ length: 300 }, (_, i) =>
      raider(`Raider-${String(i).padStart(3, "0")}-${"n".repeat(20)}`, ["Warriors", "DPS"], `u${i}`),
    );
    const t = texts(nextUp(buildPublicMessage(team(), weeklyRaids(1), longRoster)));
    const lines = t[3]!.split("\n");
    const more = /^-# …and (\d+) more$/.exec(lines.at(-1)!);
    expect(more).not.toBeNull();
    const shown = (t[3]!.match(/`Raider-/g) ?? []).length;
    expect(shown + Number(more![1])).toBe(300);
  });

  it("truncates a long Called Out block with '…and N more'", () => {
    const roster = squad(400);
    const p = buildPublicMessage(team(), [raid("2026-10-08T01:00:00Z", { out: ids(380) })], roster);
    const block = texts(nextUp(p)).find((x) => x.startsWith("-# **CALLED OUT"))!;
    expect(block.startsWith("-# **CALLED OUT · 380**\n")).toBe(true);
    const more = /\n-# …and (\d+) more$/.exec(block);
    expect(more).not.toBeNull();
    const shown = (block.match(/`Raider \d+`/g) ?? []).length;
    expect(shown + Number(more![1])).toBe(380);
  });
});

describe("buildPublicMessage — Coming Up", () => {
  it("gives each later raid a section with its date, count, role line and own button", () => {
    const raids = weeklyRaids(3, (i) => ({ out: i === 1 ? ["u-tank1"] : [] }));
    const comingUp = containers(buildPublicMessage(team(), raids, ROSTER))[1];
    const sections = comingUp.components.filter((c: any) => c.type === ComponentType.Section);
    expect(sections).toHaveLength(2);
    expect(sections[0].components[0].content).toBe(
      "🟡 **Wed, Oct 14** 8:00 PM · 9/10\n-# \u2800\u2003🛡️ 1/2 🟡\u2002➕ 3/3\u2003⚔️ 4/4",
    );
    expect(sections[1].components[0].content).toMatch(/^🟢 \*\*Wed, Oct 21\*\* 8:00 PM · 10\/10\n/);
    expect(sections.map((s: any) => s.accessory.custom_id)).toEqual([
      `attendance:btn:${TEAM_ID}:${raids[1]!.id}`,
      `attendance:btn:${TEAM_ID}:${raids[2]!.id}`,
    ]);
  });

  it("formats Coming Up dates in the team's timezone across DST", () => {
    // weeklyRaids keeps 8 PM Chicago; the Nov 4 raid is after DST ends.
    const comingUp = containers(buildPublicMessage(team(), weeklyRaids(5), ROSTER))[1];
    expect(texts(comingUp).at(-1)).toMatch(/^🟢 \*\*Wed, Nov 4\*\* 8:00 PM/);
  });

  it("uses the large dot app emojis for each raid's status when uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["dot_lg_green", "dot_lg_red"] }));
    const raids = weeklyRaids(3, (i) => ({ out: i === 2 ? ids(3) : [] }));
    const t = texts(containers(buildPublicMessage(team(), raids, squad(4)))[1]);
    expect(t[1]).toMatch(/^<:dot_lg_green:9000> /);
    expect(t[2]).toMatch(/^<:dot_lg_red:9001> .* · 1\/4/);
  });

  it("shows a cancelled later raid as one line with no button", () => {
    const raids = weeklyRaids(3, (i) => ({ cancelled: i === 1 }));
    const p = buildPublicMessage(team(), raids, ROSTER);
    const comingUp = containers(p)[1];
    expect(comingUp.components[1]).toEqual({ type: ComponentType.TextDisplay, content: "🚫 **Wed, Oct 14** · Cancelled" });
    expect(buttons(p).map((b) => b.custom_id.split(":")[3])).toEqual([raids[0]!.id, raids[2]!.id]);
  });

  it("ends with the See more dates select, whose only option opens the personal view", () => {
    const comingUp = containers(buildPublicMessage(team(), weeklyRaids(3), ROSTER))[1];
    const row = comingUp.components.at(-1);
    expect(row.type).toBe(ComponentType.ActionRow);
    const [select] = row.components;
    expect(select.custom_id).toBe(`attendance:pub:${TEAM_ID}`);
    expect(select.options).toHaveLength(1);
    expect(select.options[0]).toMatchObject({ label: "See more dates", value: MORE_DATES_VALUE });
  });

  it("with only one raid, Coming Up holds just the select", () => {
    const comingUp = containers(buildPublicMessage(team(), weeklyRaids(1), ROSTER))[1];
    expect(comingUp.components.map((c: any) => c.type)).toEqual([ComponentType.ActionRow]);
  });
});

describe("buildRaidRosterCard", () => {
  it("is the Next Up card labelled ROSTER, without the Status button", () => {
    const raids = weeklyRaids(1, () => ({ out: ["u-mage"] }));
    const card = buildRaidRosterCard(team(), raids[0]!, ROSTER);
    expect(card.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(card.allowedMentions).toEqual({ parse: [] });
    expect(card.components).toHaveLength(1);
    expect(buttons(card)).toEqual([]);

    const publicTexts = texts(nextUp(buildPublicMessage(team(), raids, ROSTER)));
    const cardTexts = texts(containers(card)[0]);
    expect(cardTexts[0]).toBe(publicTexts[0]!.replace("NEXT UP", "ROSTER"));
    // Same bar, summary, roster and Called Out block; only the button's section is missing.
    expect(cardTexts.slice(1)).toEqual(publicTexts.slice(1, -1));
  });

  it("shows a cancelled raid as cancelled", () => {
    const card = buildRaidRosterCard(team(), raid("2026-10-08T01:00:00Z", { cancelled: true }), ROSTER);
    expect(texts(containers(card)[0])[1]).toBe("🚫 **Cancelled**");
  });
});

describe("buildCalendarMessage", () => {
  const nav = { canEarlier: true, canLater: true };
  const rosterIds = new Set(ROSTER.map((m) => m.id));
  const build = (
    instances: RaidRow[],
    { offset = 0, open = instances, viewer = "u-tank1", navState = nav, roster = rosterIds } = {},
  ) => buildCalendarMessage(team(), instances, offset, navState, roster, open, viewer);

  it("is one V2 container that never pings", () => {
    const p = build(weeklyRaids(3));
    expect(p.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(p.allowedMentions).toEqual({ parse: [] });
    expect(p.components).toHaveLength(1);
  });

  it("puts each day between dividers: date/time block then attendance block", () => {
    const raids = weeklyRaids(2);
    const container = containers(build(raids))[0];
    const types = container.components.map((c: any) => c.type);
    const { TextDisplay: T, Separator: S, ActionRow: R } = ComponentType;
    expect(types).toEqual([T, S, T, T, S, T, T, S, R, R]);
    const unix = raids[0]!.startsAt.getTime() / 1000;
    expect(container.components[2].content).toBe(`**<t:${unix}:D>**\n<t:${unix}:t> · <t:${unix}:R>`);
  });

  it.each([
    [[], "🟢 **10 of 10 attending**"],
    [["u-mage"], "🟡 **9 of 10 attending**\n❌ <@u-mage>"],
    [ids(6).map((_, i) => ROSTER[i]!.id), "🔴 **4 of 10 attending**"],
  ])("shows attendance and call-outs (out: %j)", (out, expected) => {
    const t = texts(containers(build([raid("2026-10-08T01:00:00Z", { out })]))[0]);
    expect(t[2]!.startsWith(expected)).toBe(true);
  });

  it("only counts call-outs from current roster members", () => {
    const t = texts(containers(build([raid("2026-10-08T01:00:00Z", { out: ["gone", "u-mage"], in: ["u-rogue"] })]))[0]);
    expect(t[2]).toBe("🟡 **9 of 10 attending**\n❌ <@u-mage>");
  });

  it("shows a cancelled day as cancelled", () => {
    const t = texts(containers(build([raid("2026-10-08T01:00:00Z", { cancelled: true })]))[0]);
    expect(t[2]).toBe("🚫 **Cancelled**");
  });

  it("calls an unnamed team 'Raid'", () => {
    const p = buildCalendarMessage(team({ name: null }), [], 0, nav, rosterIds, [], "v");
    expect(texts(containers(p)[0])[0]).toMatch(/^## Raid — schedule\n/);
  });

  it("explains how to use it when any shown raid is open", () => {
    const container = containers(build(weeklyRaids(2)))[0];
    expect(container.components[0].content).toBe("## Main Raid — schedule\nPick any date below to call out or switch back.");
    expect(container.accent_color).toBe(0x5865f2);
  });

  it("says attendance is locked, in grey, when every shown raid is past", () => {
    const past = [raid("2026-09-24T01:00:00Z", { closed: true }), raid("2026-10-01T01:00:00Z", { closed: true })];
    const container = containers(build(past, { open: weeklyRaids(2) }))[0];
    expect(container.components[0].content).toBe("## Main Raid — schedule\nThese raids already happened — attendance is locked.");
    expect(container.accent_color).toBe(0x6b7280);
  });

  it("has an empty state with no raids and no select", () => {
    const p = build([], { open: [] });
    const container = containers(p)[0];
    expect(container.components[0].content).toContain("No raids to show here yet.");
    expect(container.accent_color).toBe(0x5865f2);
    expect(selects(p)).toEqual([]);
  });

  it("lists every open raid in the select with the viewer's own status", () => {
    const open = weeklyRaids(3, (i) => ({ out: i === 1 ? ["u-tank1", "u-mage"] : i === 2 ? ["u-mage"] : [] }));
    const [select] = selects(build(open.slice(0, 1), { open, offset: 2 }));
    expect(select.custom_id).toBe(`attendance:cal:${TEAM_ID}:2`);
    expect(select.options.map((o: any) => [o.label, o.value, o.emoji.name, o.description])).toEqual([
      ["Wed, Oct 7 · 8:00 PM", open[0]!.id, "✅", "You're attending — pick to call out"],
      ["Wed, Oct 14 · 8:00 PM", open[1]!.id, "❌", "You're called out — pick to switch back in"],
      ["Wed, Oct 21 · 8:00 PM", open[2]!.id, "✅", "You're attending — pick to call out"],
    ]);
  });

  it("labels select options in the team's timezone", () => {
    const p = buildCalendarMessage(team({ timezone: "Asia/Tokyo" }), [], 0, nav, rosterIds, weeklyRaids(1), "v");
    expect(selects(p)[0].options[0].label).toBe("Thu, Oct 8 · 10:00 AM");
  });

  it("leaves cancelled and closed raids out of the select and caps it at 25", () => {
    const open = weeklyRaids(30, (i) => ({ cancelled: i === 0, closed: i === 1 }));
    const [select] = selects(build([], { open }));
    expect(select.options).toHaveLength(MAX_SELECT_OPTIONS);
    expect(select.options.map((o: any) => o.value)).toEqual(open.slice(2, 2 + MAX_SELECT_OPTIONS).map((r) => r.id));
  });

  it("drops the select when nothing is selectable", () => {
    const p = build(weeklyRaids(1), { open: weeklyRaids(2, () => ({ cancelled: true })) });
    expect(selects(p)).toEqual([]);
  });

  it.each([
    [{ canEarlier: false, canLater: true }, [true, false]],
    [{ canEarlier: true, canLater: false }, [false, true]],
    [{ canEarlier: false, canLater: false }, [true, true]],
    [{ canEarlier: true, canLater: true }, [false, false]],
  ])("nav buttons with %j are disabled %j", (navState, disabled) => {
    const navButtons = buttons(build(weeklyRaids(1), { navState, offset: -3 }));
    expect(navButtons.map((b) => b.custom_id)).toEqual([`mynav:earlier:${TEAM_ID}:-3`, `mynav:later:${TEAM_ID}:-3`]);
    expect(navButtons.map((b) => b.disabled ?? false)).toEqual(disabled);
  });
});

describe("asEphemeral", () => {
  it("adds the Ephemeral flag, keeps V2, and leaves the original untouched", () => {
    const original = buildPublicMessage(team(), weeklyRaids(1), ROSTER);
    const ephemeral = asEphemeral(original);
    expect(ephemeral.flags).toEqual([MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
    expect(original.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(ephemeral.components).toBe(original.components);
    expect(ephemeral.allowedMentions).toEqual({ parse: [] });
  });
});

describe("snapshots", () => {
  // Fixed ids (cuid helper), fixed raid dates and clock, a fixed emoji set.
  beforeEach(async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior", "priest", "mark_tank", "mark_healer", "dot_lg_green"] }));
  });
  const raids = weeklyRaids(4, (i) => ({
    out: i === 0 ? ["u-mage", "u-heal2"] : i === 1 ? ["u-tank1"] : [],
    cancelled: i === 2,
  }));

  it("public message", () => {
    expect(json(buildPublicMessage(team(), raids, ROSTER))).toMatchSnapshot();
  });

  it("raid roster card", () => {
    expect(json(buildRaidRosterCard(team(), raids[0]!, ROSTER))).toMatchSnapshot();
  });

  it("personal schedule", () => {
    const past = raid("2026-10-01T01:00:00Z", { id: cuid("past0"), closed: true, out: ["u-tank1"] });
    const p = buildCalendarMessage(
      team(),
      [past, raids[0]!, raids[1]!],
      -1,
      { canEarlier: false, canLater: true },
      new Set(ROSTER.map((m) => m.id)),
      raids,
      "u-tank1",
    );
    expect(json(asEphemeral(p))).toMatchSnapshot();
  });
});
