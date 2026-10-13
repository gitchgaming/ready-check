import { beforeEach, describe, expect, it } from "vitest";
import { ButtonStyle, ComponentType, MessageFlags, type GuildMember } from "discord.js";
import {
  MAX_PUBLIC_DAYS,
  MAX_SELECT_OPTIONS,
  MORE_DATES_VALUE,
  ROSTER_VALUE_PREFIX,
  asEphemeral,
  buildAttendanceMessage,
  buildCalendarMessage,
  buildPublicMessage,
  buildRaidRosterCard,
  buildTeamRosterCard,
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
    for (const p of [buildPublicMessage(team(), "Main Raid", weeklyRaids(3), ROSTER), buildPublicMessage(team(), "Main Raid", [], ROSTER)]) {
      expect(p.flags).toEqual([MessageFlags.IsComponentsV2]);
      expect(p.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("has a Next Up container then a Coming Up container", () => {
    const [first, second, ...rest] = containers(buildPublicMessage(team(), "Main Raid", weeklyRaids(3), ROSTER));
    expect(first.type).toBe(ComponentType.Container);
    expect(second.type).toBe(ComponentType.Container);
    expect(rest).toEqual([]);
    expect(texts(first)[0]).toContain("NEXT UP");
    expect(texts(second)[0]).toBe("-# **COMING UP**");
  });

  it("shows an empty state with no raids: one container, no buttons or select", () => {
    const p = buildPublicMessage(team(), "Main Raid", [], ROSTER);
    expect(containers(p)).toHaveLength(1);
    expect(payloadText(p)).toBe(
      "-# **MAIN RAID · SCHEDULE**\n## No raids yet\n-# No raids to show here yet. Officers can add weekly raid nights with `/raidlead nights add`.",
    );
    expect(buttons(p)).toEqual([]);
    expect(selects(p)).toEqual([]);
  });

  it("labels both states with the team name it's given (the role's name for an unnamed team)", () => {
    expect(payloadText(buildPublicMessage(team({ name: null }), "Raiders", [], []))).toContain("**RAIDERS · SCHEDULE**");
    expect(texts(nextUp(buildPublicMessage(team({ name: null }), "Raiders", weeklyRaids(1), ROSTER)))[0]).toContain(
      "**RAIDERS · NEXT UP**",
    );
  });

  it(`shows at most MAX_PUBLIC_DAYS (${MAX_PUBLIC_DAYS}) raids, soonest first`, () => {
    const raids = weeklyRaids(MAX_PUBLIC_DAYS + 3);
    const p = buildPublicMessage(team(), "Main Raid", raids, ROSTER);
    const raidIds = buttons(p).map((b) => b.custom_id.split(":")[3]);
    expect(raidIds).toEqual(raids.slice(0, MAX_PUBLIC_DAYS).map((r) => r.id));
  });
});

describe("buildPublicMessage — Next Up", () => {
  it("heads the card with the team name, label and a timestamp each viewer sees in their own timezone", () => {
    const [first] = weeklyRaids(1);
    const unix = first!.startsAt.getTime() / 1000;
    expect(texts(nextUp(buildPublicMessage(team(), "Main Raid", [first!], ROSTER)))[0]).toBe(
      `-# **MAIN RAID · NEXT UP**\n## <t:${unix}:s>\n-# <t:${unix}:R>`,
    );
  });

  it.each([
    [25, 26, 0, 10, "🟩", 0x3ba55c], // more than the raid size is still a full green bar
    [25, 25, 0, 10, "🟩", 0x3ba55c],
    [25, 25, 1, 9, "🟨", 0xf0b232], // any shortfall leaves at least one empty segment
    [25, 25, 2, 9, "🟨", 0xf0b232],
    [25, 25, 3, 8, "🟥", 0xed4245],
    [25, 30, 30, 0, "🟥", 0xed4245],
    [20, 20, 2, 9, "🟨", 0xf0b232],
    [20, 20, 3, 8, "🟥", 0xed4245],
  ])("a %i-player raid with %i raiders and %i out: %i filled segments in %s", (raidSize, count, outCount, filled, seg, accent) => {
    const p = buildPublicMessage(
      team({ raidSize }),
      "Main Raid",
      [raid("2026-10-08T01:00:00Z", { out: ids(outCount) })],
      squad(count),
    );
    const card = nextUp(p);
    expect(card.accent_color).toBe(accent);
    expect(texts(card)[1]).toBe(`${seg.repeat(filled)}${"⬜".repeat(10 - filled)}  **${count - outCount}/${raidSize} ready**`);
  });

  it("draws the bar with the segment app emojis when they're uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["seg_yellow", "seg_empty"] }));
    const p = buildPublicMessage(team(), "Main Raid", [raid("2026-10-08T01:00:00Z", { out: ["u0"] })], squad(25));
    expect(texts(nextUp(p))[1]).toBe(`${"<:seg_yellow:9000>".repeat(9)}<:seg_empty:9001>  **24/25 ready**`);
  });

  /** `tanks` tanks, `healers` healers and `dps` damage raiders, with distinct ids. */
  const lineup = (tanks: number, healers: number, dps: number) => [
    ...Array.from({ length: tanks }, (_, i) => raider(`Tank ${i}`, ["Tanks"], `t${i}`)),
    ...Array.from({ length: healers }, (_, i) => raider(`Healer ${i}`, ["Healers"], `h${i}`)),
    ...Array.from({ length: dps }, (_, i) => raider(`Damage ${i}`, ["DPS"], `d${i}`)),
  ];

  it("summarises each role as in/want by icon with its dot: green at want, yellow at need, red below", () => {
    // 25-player: tanks need 2 / want 3, healers 4 / 5, damage 15 / 17.
    const full = buildPublicMessage(team(), "Main Raid", weeklyRaids(1), lineup(3, 5, 18));
    expect(texts(nextUp(full))[2]).toBe("🛡️ **3/3** 🟢\u2002➕ **5/5** 🟢\u2002⚔️ **18/17** 🟢");

    const thin = buildPublicMessage(team(), "Main Raid", weeklyRaids(1, () => ({ out: ["t0", "h0", "d0", "d1", "d2"] })), lineup(3, 5, 18));
    expect(texts(nextUp(thin))[2]).toBe("🛡️ **2/3** 🟡\u2002➕ **4/5** 🟡\u2002⚔️ **15/17** 🟡");

    const short = buildPublicMessage(team(), "Main Raid", weeklyRaids(1, () => ({ out: ["t0", "t1", "h0", "h1", "d0", "d1", "d2", "d3"] })), lineup(3, 5, 18));
    expect(texts(nextUp(short))[2]).toBe("🛡️ **1/3** 🔴\u2002➕ **3/5** 🔴\u2002⚔️ **14/17** 🔴");
  });

  it("gives Damage the rest of a 20-player raid", () => {
    const p = buildPublicMessage(team({ raidSize: 20 }), "Main Raid", weeklyRaids(1), lineup(3, 5, 10));
    expect(texts(nextUp(p))[2]).toBe("🛡️ **3/3** 🟢\u2002➕ **5/5** 🟢\u2002⚔️ **10/12** 🟡");
  });

  it("uses the dot app emojis when uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["dot_green", "dot_yellow", "dot_red", "healer"] }));
    const p = buildPublicMessage(team(), "Main Raid", weeklyRaids(1, () => ({ out: ["t0"] })), lineup(3, 5, 10));
    expect(texts(nextUp(p))[2]).toBe(
      "🛡️ **2/3** <:dot_yellow:9001>\u2002<:healer:9003> **5/5** <:dot_green:9000>\u2002⚔️ **10/17** <:dot_red:9002>",
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
    const lines = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), roster)))[3]!.split("\n");
    expect(lines).toEqual([
      "-# **TANKS · 2**",
      "**Warrior** `Brick`",
      "**Paladin** `Wall`",
      "",
      "-# **HEALERS · 1**",
      "**Paladin** `Holy`",
      "",
      "-# **DAMAGE · 3**",
      "**Warrior** `Cleave`",
      "**Paladin** `Alpha` `Zed`",
    ]);
  });

  it("uses class emojis in place of class names when uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior"] }));
    const roster = [raider("Wall", ["Warriors", "Tanks"], "a"), raider("Holy", ["Mages", "DPS"], "b")];
    const lines = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), roster)))[3]!.split("\n");
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
    const lines = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), roster)))[3]!.split("\n");
    expect(lines).toContain("-# **TANKS · 1**");
    expect(lines).toContain("**Warrior** `Main`");
    expect(lines.at(-1)).toBe(
      "**Warrior** <:mark_offtank:9000><:mark_offheal:9001>`Both` <:mark_offtank:9000>`Wall` <:mark_offheal:9001>`Heals` `Axe`",
    );
  });

  it("adds an off-spec key under the role counts only when the roster has off-specs, counting those attending", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["mark_offtank"] }));
    const roster = [...ROSTER, raider("Skarr", ["Warriors", "Offtank"], "u-ot"), raider("Fern", ["Druids", "DPS", "Offheals"], "u-oh")];
    const summary = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1, () => ({ out: ["u-oh"] })), roster)))[2]!;
    expect(summary.split("\n")[1]).toBe("-# <:mark_offtank:9000> Offtank 1 · ➕ Offheals 0");
    expect(texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER)))[2]).not.toContain("\n");
  });

  it("counts raiders with no type role as Damage, and ends their section with an unlabelled line for those with no class", () => {
    const roster = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER)))[3]!.split("\n");
    expect(roster.at(-1)).toBe("`Newbie`");
    expect(roster.join("\n")).not.toMatch(/NO ROLE|Other/);
  });

  it("shows names as chips, as typed, with backticks swapped so a chip can't break", () => {
    const p = buildPublicMessage(team(), "Main Raid", weeklyRaids(1), [raider("*Star*_`Lord`_", ["Mages", "DPS"], "x")]);
    expect(texts(nextUp(p))[3]).toContain("`*Star*_ˋLordˋ_`");
  });

  it("moves called-out raiders into a Called Out block by class, names only, tanks then healers then damage", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior", "mark_tank", "mark_dps"] }));
    const out = ["u-new", "u-warr", "u-tank1", "u-mage", "u-heal1"];
    const p = buildPublicMessage(team(), "Main Raid", weeklyRaids(1, () => ({ out })), ROSTER);
    const t = texts(nextUp(p));
    expect(t[3]).not.toMatch(/Tankalot|Axe|Zap|Newbie|Mendy/);
    expect(t[4]!.split("\n")).toEqual([
      "-# **CALLED OUT · 5**",
      "<:warrior:9000> `Tankalot` `Axe`",
      "**Priest** `Mendy`",
      "**Mage** `Zap`",
      "`Newbie`",
    ]);
  });

  it("leaves role and off-spec markers out of Called Out", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["mark_offtank", "mark_dps"] }));
    const roster = [raider("Skarr", ["Warriors", "DPS", "Offtank"], "u-ot")];
    const t = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1, () => ({ out: ["u-ot"] })), roster)));
    expect(t.find((x) => x.startsWith("-# **CALLED OUT"))).toBe("-# **CALLED OUT · 1**\n**Warrior** `Skarr`");
  });

  it("has no Called Out block when everyone is in", () => {
    const t = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER)));
    expect(t.join("\n")).not.toContain("CALLED OUT");
  });

  it("only counts call-outs from current roster members, and ignores IN rows", () => {
    const p = buildPublicMessage(
      team(),
      "Main Raid",
      weeklyRaids(1, () => ({ out: ["u-mage", "someone-who-left"], in: ["u-rogue"] })),
      ROSTER,
    );
    const t = texts(nextUp(p));
    expect(t[1]).toContain("**9/25 ready**");
    expect(t[4]).toBe("-# **CALLED OUT · 1**\n**Mage** `Zap`");
    expect(t[3]).toContain("Stabby");
  });

  it("ends with the Status ⇄ button for the next raid, on its own line as a section accessory", () => {
    const [first] = weeklyRaids(1);
    const card = nextUp(buildPublicMessage(team(), "Main Raid", [first!], ROSTER));
    const last = card.components.at(-1);
    expect(last.type).toBe(ComponentType.Section);
    expect(last.components[0].content).toContain("**Status** toggles your attendance");
    expect(last.accessory).toEqual({
      type: ComponentType.Button,
      custom_id: `attendance:btn:${TEAM_ID}:${first!.id}`,
      label: "Status ⇄",
      style: ButtonStyle.Secondary,
    });
  });

  it("separates the summary from the roster with a divider", () => {
    const types = nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER)).components.map((c: any) => c.type);
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
    const p = buildPublicMessage(team(), "Main Raid", raids, ROSTER);
    const card = nextUp(p);
    expect(card.accent_color).toBe(0x6b7280);
    expect(texts(card)).toEqual([expect.stringContaining("## <t:1791421200:s>"), "🚫 **Cancelled**"]);
    expect(buttons(p).map((b) => b.custom_id.split(":")[3])).toEqual([raids[1]!.id, raids[2]!.id]);
  });

  it("always shows the Tanks, Healers and Damage headings, with a dash when a section is empty", () => {
    const t = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), [raider("Wall", ["Warriors", "Tanks"], "a")])));
    expect(t[3]!.split("\n")).toEqual([
      "-# **TANKS · 1**",
      "**Warrior** `Wall`",
      "",
      "-# **HEALERS · 0** —",
      "",
      "-# **DAMAGE · 0** —",
    ]);
  });

  it("says so when the role has no members", () => {
    const t = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), [])));
    expect(t[3]).toBe("-# **TANKS · 0** —\n\n-# **HEALERS · 0** —\n\n-# **DAMAGE · 0** —");
  });

  it("truncates the roster with '…and N more' when it's too long", () => {
    const longRoster = Array.from({ length: 300 }, (_, i) =>
      raider(`Raider-${String(i).padStart(3, "0")}-${"n".repeat(20)}`, ["Warriors", "DPS"], `u${i}`),
    );
    const t = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), longRoster)));
    const lines = t[3]!.split("\n");
    const more = /^-# …and (\d+) more$/.exec(lines.at(-1)!);
    expect(more).not.toBeNull();
    const shown = (t[3]!.match(/`Raider-/g) ?? []).length;
    expect(shown + Number(more![1])).toBe(300);
  });

  it("truncates a long Called Out block with '…and N more'", () => {
    const roster = squad(400);
    const p = buildPublicMessage(team(), "Main Raid", [raid("2026-10-08T01:00:00Z", { out: ids(380) })], roster);
    const block = texts(nextUp(p)).find((x) => x.startsWith("-# **CALLED OUT"))!;
    expect(block.startsWith("-# **CALLED OUT · 380**\n")).toBe(true);
    const more = /\n-# …and (\d+) more$/.exec(block);
    expect(more).not.toBeNull();
    const shown = (block.match(/`Raider \d+`/g) ?? []).length;
    expect(shown + Number(more![1])).toBe(380);
  });
});

describe("buildPublicMessage — Coming Up", () => {
  it("gives each later raid a section with its date, count, a dotless role line and own button", () => {
    const raids = weeklyRaids(3, (i) => ({ out: i === 1 ? ["u-tank1"] : [] }));
    const comingUp = containers(buildPublicMessage(team({ raidSize: 20 }), "Main Raid", raids, [...ROSTER, ...squad(10)]))[1];
    const sections = comingUp.components.filter((c: any) => c.type === ComponentType.Section);
    expect(sections).toHaveLength(2);
    expect(sections[0].components[0].content).toBe(
      "🟡 **<t:1792026000:s>** · 19/20\n-# \u2800\u2003🛡️ 1/3\u2003➕ 3/5\u2003⚔️ 15/12",
    );
    expect(sections[1].components[0].content).toMatch(/^🟢 \*\*<t:1792630800:s>\*\* · 20\/20\n/);
    expect(sections.map((s: any) => s.accessory.custom_id)).toEqual([
      `attendance:btn:${TEAM_ID}:${raids[1]!.id}`,
      `attendance:btn:${TEAM_ID}:${raids[2]!.id}`,
    ]);
  });

  it("shows Coming Up dates as timestamps of each raid's moment, across DST", () => {
    // weeklyRaids keeps 8 PM Chicago; the Nov 4 raid is after DST ends, an hour later in UTC.
    const comingUp = containers(buildPublicMessage(team(), "Main Raid", weeklyRaids(5), ROSTER))[1];
    expect(texts(comingUp).at(-1)).toMatch(/^🔴 \*\*<t:1793844000:s>\*\* · /);
  });

  it("uses the large dot app emojis for each raid's status when uploaded", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["dot_lg_green", "dot_lg_red"] }));
    const raids = weeklyRaids(3, (i) => ({ out: i === 2 ? ids(3) : [] }));
    const t = texts(containers(buildPublicMessage(team(), "Main Raid", raids, squad(25)))[1]);
    expect(t[1]).toMatch(/^<:dot_lg_green:9000> /);
    expect(t[2]).toMatch(/^<:dot_lg_red:9001> .* · 22\/25/);
  });

  it("shows a cancelled later raid as one line with no button", () => {
    const raids = weeklyRaids(3, (i) => ({ cancelled: i === 1 }));
    const p = buildPublicMessage(team(), "Main Raid", raids, ROSTER);
    const comingUp = containers(p)[1];
    expect(comingUp.components[1]).toEqual({ type: ComponentType.TextDisplay, content: "🚫 **<t:1792026000:s>** · Cancelled" });
    expect(buttons(p).map((b) => b.custom_id.split(":")[3])).toEqual([raids[0]!.id, raids[2]!.id]);
  });

  it("ends with the select: See more dates, then a roster shortcut per Coming Up raid", () => {
    const raids = weeklyRaids(4, (i) => ({ cancelled: i === 2 }));
    const comingUp = containers(buildPublicMessage(team(), "Main Raid", raids, ROSTER))[1];
    const row = comingUp.components.at(-1);
    expect(row.type).toBe(ComponentType.ActionRow);
    const [select] = row.components;
    expect(select.custom_id).toBe(`attendance:pub:${TEAM_ID}`);
    expect(select.placeholder).toBe("📅 See more dates or a roster…");
    expect(select.options[0]).toMatchObject({ label: "See more dates", value: MORE_DATES_VALUE });
    // Not Next Up (its roster is already on show) nor the cancelled raid.
    expect(select.options.slice(1).map((o: any) => o.value)).toEqual([
      `${ROSTER_VALUE_PREFIX}${raids[1]!.id}`,
      `${ROSTER_VALUE_PREFIX}${raids[3]!.id}`,
    ]);
    expect(select.options[1]).toMatchObject({ label: "Roster · Wed, Oct 14 · 8:00 PM CDT", emoji: { name: "ℹ️" } });
  });

  it("with no Coming Up raids, the select only opens the personal view", () => {
    const comingUp = containers(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER))[1];
    const [select] = comingUp.components.at(-1).components;
    expect(select.placeholder).toBe("📅 See more dates…");
    expect(select.options).toHaveLength(1);
  });

  it("with only one raid, Coming Up holds just the select", () => {
    const comingUp = containers(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER))[1];
    expect(comingUp.components.map((c: any) => c.type)).toEqual([ComponentType.ActionRow]);
  });
});

describe("buildRaidRosterCard", () => {
  it("is the Next Up card labelled ROSTER, without the Status button", () => {
    const raids = weeklyRaids(1, () => ({ out: ["u-mage"] }));
    const card = buildRaidRosterCard(team(), "Main Raid", raids[0]!, ROSTER);
    expect(card.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(card.allowedMentions).toEqual({ parse: [] });
    expect(card.components).toHaveLength(1);
    expect(buttons(card)).toEqual([]);

    const publicTexts = texts(nextUp(buildPublicMessage(team(), "Main Raid", raids, ROSTER)));
    const cardTexts = texts(containers(card)[0]);
    expect(cardTexts[0]).toBe(publicTexts[0]!.replace("NEXT UP", "ROSTER"));
    // Same bar, summary, roster and Called Out block; only the button's section is missing.
    expect(cardTexts.slice(1)).toEqual(publicTexts.slice(1, -1));
  });

  it("shows a cancelled raid as cancelled", () => {
    const card = buildRaidRosterCard(team(), "Main Raid", raid("2026-10-08T01:00:00Z", { cancelled: true }), ROSTER);
    expect(texts(containers(card)[0])[1]).toBe("🚫 **Cancelled**");
  });
});

describe("buildTeamRosterCard", () => {
  const card = (members: GuildMember[] = ROSTER) => buildTeamRosterCard("Main Raid", members);

  it("is one read-only V2 container that never pings", () => {
    const p = card();
    expect(p.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(p.allowedMentions).toEqual({ parse: [] });
    expect(p.components).toHaveLength(1);
    expect(buttons(p)).toEqual([]);
    expect(selects(p)).toEqual([]);
  });

  it("heads the card with the team and roster size, then counts each role", () => {
    const [header, summary] = texts(containers(card())[0]);
    expect(header).toBe("-# **MAIN RAID · ROSTER**\n## 10 raiders");
    expect(summary).toBe("🛡️ **2**\u2003➕ **3**\u2003⚔️ **5**");
    expect(texts(containers(card([ROSTER[0]!]))[0])[0]).toContain("## 1 raider");
  });

  it("lists everyone once in Next Up's sections, with untyped raiders under Damage", () => {
    const roster = texts(containers(card())[0]).at(-1)!;
    expect(roster.split("\n").filter((l) => l.startsWith("-# **"))).toEqual([
      "-# **TANKS · 2**",
      "-# **HEALERS · 3**",
      "-# **DAMAGE · 5**",
    ]);
    for (const m of ROSTER) expect(roster.split(`\`${m.displayName}\``)).toHaveLength(2);
  });

  it("is Next Up's roster when everyone's attending", () => {
    const nextUpTexts = texts(nextUp(buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER)));
    expect(texts(containers(card())[0]).at(-1)).toBe(nextUpTexts.at(-2));
  });

  it("shows off-spec markers and the off-spec key", () => {
    const p = card([raider("Skarr", ["Warriors", "DPS", "Offtank"]), raider("Fern", ["Druids", "Offheals"])]);
    const [, summary, roster] = texts(containers(p)[0]);
    expect(summary).toBe("🛡️ **0**\u2003➕ **0**\u2003⚔️ **2**\n-# 🛡️ Offtank 1 · ➕ Offheals 1");
    expect(roster).toContain("🛡️`Skarr`");
    expect(roster).toContain("➕`Fern`");
  });

  it("says so when no one has the role", () => {
    expect(texts(containers(card([]))[0])).toEqual(["-# **MAIN RAID · ROSTER**\n## 0 raiders", "-# No one has this role yet."]);
  });
});

describe("buildCalendarMessage", () => {
  const nav = { canEarlier: true, canLater: true };
  const build = (
    instances: RaidRow[],
    { offset = 0, open = instances, viewer = "u-tank1", navState = nav, roster = ROSTER, name = "Main Raid" } = {},
  ) => buildCalendarMessage(team(), name, instances, offset, navState, roster, open, viewer);
  const days = (p: Payload) => texts(containers(p)[0]).slice(1);

  it("is one V2 container that never pings", () => {
    const p = build(weeklyRaids(3));
    expect(p.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(p.allowedMentions).toEqual({ parse: [] });
    expect(p.components).toHaveLength(1);
  });

  it("has a small-caps header like the public post, then each day between dividers", () => {
    const container = containers(build(weeklyRaids(2)))[0];
    const { TextDisplay: T, Separator: S, Section: X, ActionRow: R } = ComponentType;
    expect(container.components.map((c: any) => c.type)).toEqual([T, S, X, S, X, S, R, R]);
    expect(container.components[0].content).toBe(
      "-# **MAIN RAID · YOUR SCHEDULE**\n-# Pick a date below to call out or switch back in.",
    );
    expect(container.accent_color).toBe(0x5865f2);
  });

  it("shows each day as Coming Up does, then your own status", () => {
    const [comingUp] = texts(containers(buildPublicMessage(team(), "Main Raid", weeklyRaids(2), ROSTER))[1]).slice(1);
    const [day] = days(build(weeklyRaids(2).slice(1)));
    expect(day).toBe(`${comingUp}\n-# ⠀\u2003✅ You're in`);
  });

  it.each([
    ["u-tank1", ["u-mage"], "✅ You're in · Called out: `Zap`"],
    ["u-mage", ["u-mage", "u-heal2"], "❌ You're out · Called out: `Lightbringer`"],
    ["u-mage", ["u-mage"], "❌ You're out"],
  ])("as %s with %j out, ends the day with %j", (viewer, out, expected) => {
    const [day] = days(build([raid("2026-10-08T01:00:00Z", { out })], { viewer }));
    expect(day!.split("\n")[0]).toMatch(/^.+ \*\*<t:1791421200:s>\*\* · \d+\/25$/);
    expect(day!.endsWith(expected)).toBe(true);
  });

  it("gives each raid but a cancelled one a Roster button beside it", () => {
    const raids = [raid("2026-10-01T01:00:00Z", { closed: true }), ...weeklyRaids(2, (i) => ({ cancelled: i === 1 }))];
    const p = build(raids);
    const rosters = buttons(p).filter((b) => b.label === "Roster");
    expect(rosters.map((b) => b.custom_id)).toEqual([
      `attendance:ros:${TEAM_ID}:${raids[0]!.id}`,
      `attendance:ros:${TEAM_ID}:${raids[1]!.id}`,
    ]);
    expect(rosters.every((b) => b.style === ButtonStyle.Secondary)).toBe(true);
  });

  it("puts past raids in the past tense, locked and grey", () => {
    const past = [raid("2026-09-24T01:00:00Z", { closed: true, out: ["u-tank1"] }), raid("2026-10-01T01:00:00Z", { closed: true })];
    const p = build(past, { open: weeklyRaids(2) });
    const container = containers(p)[0];
    expect(container.components[0].content).toBe(
      "-# **MAIN RAID · YOUR SCHEDULE**\n-# These raids already happened, so attendance is locked.",
    );
    expect(container.accent_color).toBe(0x6b7280);
    expect(days(p).map((d) => d.split("\n").at(-1))).toEqual(["-# ⠀\u2003❌ You were out", "-# ⠀\u2003✅ You were in"]);
  });

  it("only counts call-outs from current roster members", () => {
    const [day] = days(build([raid("2026-10-08T01:00:00Z", { out: ["gone", "u-mage"], in: ["u-rogue"] })]));
    expect(day).toContain("· 9/25\n");
    expect(day!.endsWith("Called out: `Zap`")).toBe(true);
  });

  it("breaks a long called-out list onto indented lines instead of letting it wrap", () => {
    const names = ["Aegisa", "Arcanis", "Bulwark", "Frostbyte", "Gromwall", "Kneecap", "Lightwell", "Mendara", "Pyrel", "Shiv", "Solace"];
    const roster = [...names.map((n, i) => raider(n, ["DPS"], `x${i}`)), raider("Me", ["DPS"], "me")];
    const [day] = days(build([raid("2026-10-08T01:00:00Z", { out: names.map((_, i) => `x${i}`) })], { roster, viewer: "me" }));
    expect(day!.split("\n").slice(2)).toEqual([
      "-# ⠀\u2003✅ You're in · Called out: `Aegisa` `Arcanis` `Bulwark` `Frostbyte` `Gromwall`",
      "-# ⠀\u2003`Kneecap` `Lightwell` `Mendara` `Pyrel` `Shiv` `Solace`",
    ]);
  });

  it("shows a cancelled day as one line, like Coming Up", () => {
    expect(days(build([raid("2026-10-08T01:00:00Z", { cancelled: true })]))).toEqual(["🚫 **<t:1791421200:s>** · Cancelled"]);
  });

  it("uses the team name it's given", () => {
    expect(texts(containers(build([], { name: "Alt Raid" }))[0])[0]).toMatch(/^-# \*\*ALT RAID · YOUR SCHEDULE\*\*\n/);
  });

  it("has an empty state with no raids and no select", () => {
    const p = build([], { open: [] });
    const container = containers(p)[0];
    expect(container.components[0].content).toContain("No raids to show here yet.");
    expect(container.accent_color).toBe(0x5865f2);
    expect(selects(p)).toEqual([]);
  });

  it("is view-only, without a select or a status line, for someone not on the roster", () => {
    const p = build([raid("2026-10-08T01:00:00Z", { out: ["u-mage"] })], { viewer: "officer" });
    expect(selects(p)).toEqual([]);
    expect(texts(containers(p)[0])[0]).toContain("You're not on this team's roster, so this is view-only.");
    expect(days(p)[0]!.endsWith("\n-# ⠀\u2003Called out: `Zap`")).toBe(true);
  });

  it("lists every open raid in the select with the viewer's own status", () => {
    const open = weeklyRaids(3, (i) => ({ out: i === 1 ? ["u-tank1", "u-mage"] : i === 2 ? ["u-mage"] : [] }));
    const [select] = selects(build(open.slice(0, 1), { open, offset: 2 }));
    expect(select.custom_id).toBe(`attendance:cal:${TEAM_ID}:2`);
    expect(select.options.map((o: any) => [o.label, o.value, o.emoji.name, o.description])).toEqual([
      ["Wed, Oct 7 · 8:00 PM CDT", open[0]!.id, "✅", "You're in. Pick to call out"],
      ["Wed, Oct 14 · 8:00 PM CDT", open[1]!.id, "❌", "You're called out. Pick to switch back in"],
      ["Wed, Oct 21 · 8:00 PM CDT", open[2]!.id, "✅", "You're in. Pick to call out"],
    ]);
  });

  it("shows days as timestamps, and select options in team time with its zone", () => {
    const p = buildCalendarMessage(team({ timezone: "Asia/Tokyo" }), "Main Raid", weeklyRaids(1), 0, nav, ROSTER, weeklyRaids(1), "u-tank1");
    expect(selects(p)[0].options[0].label).toBe("Thu, Oct 8 · 10:00 AM GMT+9");
    expect(days(p)[0]).toContain("**<t:1791421200:s>**");
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
    expect(texts(containers(p)[0])[0]).toContain("Nothing to call out of right now.");
  });

  it.each([
    [{ canEarlier: false, canLater: true }, [true, false]],
    [{ canEarlier: true, canLater: false }, [false, true]],
    [{ canEarlier: false, canLater: false }, [true, true]],
    [{ canEarlier: true, canLater: true }, [false, false]],
  ])("nav buttons with %j are disabled %j", (navState, disabled) => {
    const navButtons = buttons(build(weeklyRaids(1), { navState, offset: -3 })).filter((b) => b.custom_id.startsWith("mynav:"));
    expect(navButtons.map((b) => b.custom_id)).toEqual([`mynav:earlier:${TEAM_ID}:-3`, `mynav:later:${TEAM_ID}:-3`]);
    expect(navButtons.map((b) => b.disabled ?? false)).toEqual(disabled);
  });
});

describe("asEphemeral", () => {
  it("adds the Ephemeral flag, keeps V2, and leaves the original untouched", () => {
    const original = buildPublicMessage(team(), "Main Raid", weeklyRaids(1), ROSTER);
    const ephemeral = asEphemeral(original);
    expect(ephemeral.flags).toEqual([MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
    expect(original.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(ephemeral.components).toBe(original.components);
    expect(ephemeral.allowedMentions).toEqual({ parse: [] });
  });
});

describe("dates in message text", () => {
  // A weekday-and-month date written out ("Tue, Oct 6") is in one zone; message
  // text should only carry <t:…> timestamps, which each viewer sees in their own.
  const PLAIN_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d/;

  it("are all timestamps, never plain dates, in every view", () => {
    const raids = weeklyRaids(5, (i) => ({ cancelled: i === 2, out: i === 3 ? ["u-mage"] : [] }));
    const views = [
      buildPublicMessage(team(), "Main Raid", raids, ROSTER),
      buildPublicMessage(team(), "Main Raid", weeklyRaids(2, (i) => ({ cancelled: i === 0 })), ROSTER),
      buildRaidRosterCard(team(), "Main Raid", raids[0]!, ROSTER),
      buildCalendarMessage(team(), "Main Raid", raids, 0, { canEarlier: true, canLater: true }, ROSTER, raids, "u-mage"),
      buildAttendanceMessage([{ team: team(), teamName: "Main Raid", instances: raids, members: ROSTER }], "u-mage"),
    ];
    for (const view of views) {
      const text = payloadText(view);
      expect(text).toMatch(/<t:\d+:[Fs]>/);
      expect(text).not.toMatch(PLAIN_DATE);
    }
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
    expect(json(buildPublicMessage(team(), "Main Raid", raids, ROSTER))).toMatchSnapshot();
  });

  it("raid roster card", () => {
    expect(json(buildRaidRosterCard(team(), "Main Raid", raids[0]!, ROSTER))).toMatchSnapshot();
  });

  it("personal schedule", () => {
    const past = raid("2026-10-01T01:00:00Z", { id: cuid("past0"), closed: true, out: ["u-tank1"] });
    const p = buildCalendarMessage(
      team(),
      "Main Raid",
      [past, raids[0]!, raids[1]!, raids[2]!],
      -1,
      { canEarlier: false, canLater: true },
      ROSTER,
      raids,
      "u-tank1",
    );
    expect(json(asEphemeral(p))).toMatchSnapshot();
  });
});

describe("buildAttendanceMessage", () => {
  const block = (instances: RaidRow[], name = "Main Raid") => ({ team: team(), teamName: name, instances, members: ROSTER });
  const build = (instances: RaidRow[], notice?: string) => buildAttendanceMessage([block(instances)], "u-mage", notice);
  const header = (p: Payload) => texts(containers(p)[0])[0];

  it("is one V2 container per team that never pings", () => {
    const p = buildAttendanceMessage([block(weeklyRaids(2)), block(weeklyRaids(2), "Alt Raid")], "u-mage");
    expect(p.flags).toEqual([MessageFlags.IsComponentsV2]);
    expect(p.allowedMentions).toEqual({ parse: [] });
    expect(containers(p).map((c: any) => texts(c)[0].split("\n")[0])).toEqual([
      "-# **MAIN RAID · YOUR ATTENDANCE**",
      "-# **ALT RAID · YOUR ATTENDANCE**",
    ]);
  });

  it("when you're in for everything, says so and how to call out, with no buttons", () => {
    const p = build(weeklyRaids(12));
    expect(header(p)).toBe("-# **MAIN RAID · YOUR ATTENDANCE**\n## ✅ You're in for all 12 upcoming raids");
    expect(texts(containers(p)[0]).at(-1)).toBe("-# Call out of one with `/attendance date:`");
    expect(buttons(p)).toEqual([]);
  });

  it("lists each raid you're called out of as Coming Up does, with a Back in button", () => {
    const raids = weeklyRaids(4, (i) => ({ out: i === 1 || i === 3 ? ["u-mage"] : i === 2 ? ["u-tank1"] : [] }));
    const p = build(raids);
    expect(header(p)).toBe(
      "-# **MAIN RAID · YOUR ATTENDANCE**\n## You're in for 2 of the next 4 raids\n-# Called out of 2. **Back in** switches you back.",
    );
    const comingUp = texts(containers(buildPublicMessage(team(), "Main Raid", raids, ROSTER))[1]).slice(1);
    expect(texts(containers(p)[0]).slice(1, 3)).toEqual([comingUp[0], comingUp[2]]);
    expect(buttons(p).map((b) => [b.label, b.custom_id])).toEqual([
      ["Back in", `attendance:in:${TEAM_ID}:${raids[1]!.id}`],
      ["Back in", `attendance:in:${TEAM_ID}:${raids[3]!.id}`],
    ]);
    expect(texts(containers(p)[0]).at(-1)).toBe("-# Call out of another raid with `/attendance date:`");
  });

  it("leaves out cancelled and closed raids, even ones you called out of", () => {
    const raids = weeklyRaids(3, (i) => ({ out: ["u-mage"], cancelled: i === 0, closed: i === 1 }));
    const p = build(raids);
    expect(header(p)).toBe("-# **MAIN RAID · YOUR ATTENDANCE**\n## You're out of the next raid\n-# Called out of 1. **Back in** switches you back.");
    expect(buttons(p).map((b) => b.custom_id)).toEqual([`attendance:in:${TEAM_ID}:${raids[2]!.id}`]);
  });

  it("says when there are no upcoming raids", () => {
    expect(texts(containers(build([]))[0])).toEqual(["-# **MAIN RAID · YOUR ATTENDANCE**\n## No upcoming raids yet"]);
  });

  it("puts the notice above the cards", () => {
    const p = build(weeklyRaids(1), "✅ You're back in.");
    expect(json(p).components[0]).toEqual({ type: ComponentType.TextDisplay, content: "✅ You're back in." });
    expect(json(p).components[1].type).toBe(ComponentType.Container);
  });

  it("caps the call-outs it shows and points at /schedule for the rest", () => {
    const p = build(weeklyRaids(12, () => ({ out: ["u-mage"] })));
    expect(buttons(p)).toHaveLength(9);
    expect(texts(containers(p)[0]).at(-1)).toBe(
      "-# …and 3 more call-outs, all in `/schedule`.\n-# Call out of another raid with `/attendance date:`",
    );
  });
});
