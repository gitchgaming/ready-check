/**
 * Discord rejects over-limit payloads with "Invalid Form Body", which only shows up
 * in production. These tests build the real payloads at their worst case and check
 * them against Discord's documented limits.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Collection, ComponentType, type Client, type GuildMember } from "discord.js";
import { commands } from "../../src/commands/index.js";
import {
  MAX_COMING_UP,
  MAX_PUBLIC_DAYS,
  MAX_SELECT_OPTIONS,
  buildCalendarMessage,
  buildPublicMessage,
  buildRaidRosterCard,
} from "../../src/lib/embeds.js";
import { CLASSES, RAID_TYPES } from "../../src/lib/classes.js";
import { EMOJI_DIR, loadAppEmojis } from "../../src/lib/emojis.js";
import { PAGE_SIZE } from "../../src/lib/scheduler.js";
import { flattenComponents, raider } from "../discord.js";
import { cuid, freezeTime, team, weeklyRaids, type RaidRow } from "./fixtures.js";

// Discord's limits (https://discord.com/developers/docs).
const MAX_COMPONENTS = 40; // per Components V2 message, nested ones included
const MAX_TEXT = 4000; // all text displays in one V2 message
const MAX_CUSTOM_ID = 100;
const MAX_OPTION_TEXT = 100; // select option label, value, description
const MAX_BUTTON_LABEL = 80;
const MAX_PLACEHOLDER = 150;
const MAX_COMMAND_CHARS = 4000; // a command's names, descriptions and choice names/values combined

// ---------------------------------------------------------------- worst-case data

/** Every application emoji deploy-emojis uploads, with realistic 19-digit ids (longest markup). */
async function loadAllEmojisWithLongIds() {
  const names = readdirSync(EMOJI_DIR)
    .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    .map((f) => path.parse(f).name);
  const emojis = new Collection(
    names.map((name, i) => {
      const id = String(1234567890123456000n + BigInt(i));
      return [id, { id, name, toString: () => `<:${name}:${id}>` }];
    }),
  );
  const client = { application: { emojis: { fetch: async () => emojis } } } as unknown as Client<true>;
  await loadAppEmojis(client);
  return names;
}

/** Real Discord user ids are 17–19 digit snowflakes; mentions of them are the longest. */
const userId = (i: number) => String(1100000000000000000n + BigInt(i));

/**
 * A big guild roster: `size` raiders spread over every class and type, each with a
 * 32-character display name (Discord's max) full of markdown that escaping lengthens.
 */
function worstRoster(size: number): GuildMember[] {
  const types = ["Tanks", "Healers", "DPS", "Wizards", "Phys"];
  return Array.from({ length: size }, (_, i) => {
    const cls = CLASSES[i % CLASSES.length]!;
    const name = `*_${String(i).padStart(3, "0")}_*`.padEnd(32, "_");
    return raider(name, [cls.roles[0]!, types[i % types.length]!], userId(i));
  });
}

/** `days` raids, each with roughly `outShare` of the roster called out (varied per raid). */
function worstRaids(days: number, roster: GuildMember[], outShare = 0.4): RaidRow[] {
  return weeklyRaids(days, (i) => ({
    id: cuid(`raid${i}`),
    out: roster.filter((_, j) => (j + i) % Math.round(1 / outShare) === 0).map((m) => m.id),
  }));
}

/** Components Discord counts: every node, including rows, sections and their accessories. */
const componentCount = (p: { components: unknown[] }) => flattenComponents(p).length;
const textLength = (p: { components: unknown[] }) =>
  flattenComponents(p)
    .filter((c) => c.type === ComponentType.TextDisplay)
    .reduce((n, c) => n + c.content.length, 0);

beforeEach(async () => {
  freezeTime("2026-10-06T12:00:00Z");
  await loadAllEmojisWithLongIds();
});

// ---------------------------------------------------------------- slash commands

type CommandJson = {
  name: string;
  description: string;
  options?: OptionJson[];
};
type OptionJson = CommandJson & {
  type: number;
  choices?: { name: string; value: string | number }[];
  max_value?: number;
  min_value?: number;
};

function walkOptions(options: OptionJson[] | undefined, visit: (o: OptionJson, path: string) => void, prefix: string) {
  for (const option of options ?? []) {
    const p = `${prefix} ${option.name}`;
    visit(option, p);
    walkOptions(option.options, visit, p);
  }
}

function commandChars(json: CommandJson): number {
  let total = json.name.length + json.description.length;
  walkOptions(
    json.options as OptionJson[],
    (o) => {
      total += o.name.length + o.description.length;
      for (const c of o.choices ?? []) total += c.name.length + String(c.value).length;
    },
    "",
  );
  return total;
}

describe("slash commands", () => {
  const built = commands.map((c) => c.data.toJSON() as CommandJson);

  it("all build, with unique names", () => {
    expect(built.map((c) => c.name).sort()).toEqual(["callout", "raidlead", "roster", "schedule"]);
  });

  it.each(built.map((c) => [c.name, c] as const))("/%s respects Discord's name, description and count limits", (_, json) => {
    const problems: string[] = [];
    const checkNamed = (o: { name: string; description: string }, where: string) => {
      if (!/^[-_'\p{L}\p{N}]{1,32}$/u.test(o.name)) problems.push(`${where}: invalid name`);
      if (o.name !== o.name.toLowerCase()) problems.push(`${where}: name not lowercase`);
      if (o.description.length < 1 || o.description.length > 100) problems.push(`${where}: description length ${o.description.length}`);
    };
    const checkOptions = (options: OptionJson[] | undefined, where: string) => {
      if ((options?.length ?? 0) > 25) problems.push(`${where}: ${options!.length} options`);
      const names = (options ?? []).map((o) => o.name);
      if (new Set(names).size !== names.length) problems.push(`${where}: duplicate option names`);
    };

    checkNamed(json, `/${json.name}`);
    checkOptions(json.options as OptionJson[], `/${json.name}`);
    walkOptions(
      json.options as OptionJson[],
      (o, where) => {
        checkNamed(o, where);
        checkOptions(o.options, where);
        if ((o.choices?.length ?? 0) > 25) problems.push(`${where}: ${o.choices!.length} choices`);
        for (const c of o.choices ?? []) {
          if (c.name.length < 1 || c.name.length > 100) problems.push(`${where}: choice name ${JSON.stringify(c.name)}`);
          if (typeof c.value === "string" && c.value.length > 100) problems.push(`${where}: choice value too long`);
        }
        // Required options must come before optional ones.
        const flags = (o.options ?? []).filter((x) => x.type > 2).map((x) => (x as { required?: boolean }).required ?? false);
        if (flags.some((r, i) => r && flags.slice(0, i).includes(false))) problems.push(`${where}: required after optional`);
      },
      `/${json.name}`,
    );
    expect(commandChars(json)).toBeLessThanOrEqual(MAX_COMMAND_CHARS);
    expect(problems).toEqual([]);
  });

  it("caps every `coming-up` option at MAX_COMING_UP, which fits the public message's day budget", () => {
    const comingUp: OptionJson[] = [];
    for (const json of built) walkOptions(json.options as OptionJson[], (o) => o.name === "coming-up" && comingUp.push(o), "");
    expect(comingUp.length).toBeGreaterThan(0);
    for (const o of comingUp) {
      expect(o.min_value).toBe(0);
      expect(o.max_value).toBe(MAX_COMING_UP);
    }
    // Next Up plus the maximum Coming Up raids is exactly what the public message shows.
    expect(1 + MAX_COMING_UP).toBe(MAX_PUBLIC_DAYS);
  });
});

// ---------------------------------------------------------------- public message

describe("public message at its worst case", () => {
  const roster = worstRoster(120);

  it("the worst-case roster covers every class and raid type", () => {
    // A 40-raider card isn't truncated, so every class line and role shows up.
    const members = worstRoster(40);
    const text = flattenComponents(buildRaidRosterCard(team(), weeklyRaids(1)[0]!, members))
      .map((c) => c.content ?? "")
      .join("\n");
    for (const c of CLASSES) expect(text).toMatch(new RegExp(`\\*\\*${c.label}\\*\\* [^—]`));
    for (const t of RAID_TYPES) expect(text).toMatch(new RegExp(`${t.label} \\*\\*[1-9]`));
  });

  it(`at MAX_PUBLIC_DAYS (${MAX_PUBLIC_DAYS}) raids stays within ${MAX_COMPONENTS} components`, () => {
    const p = buildPublicMessage(team(), worstRaids(MAX_PUBLIC_DAYS, roster), roster);
    expect(componentCount(p)).toBeLessThanOrEqual(MAX_COMPONENTS);
  });

  it("has no room for one more raid: MAX_PUBLIC_DAYS is the largest count that fits", () => {
    // Measure what one more Coming Up raid costs from the real layout, then show
    // that adding it to the full message would break the limit.
    const atMax = componentCount(buildPublicMessage(team(), worstRaids(MAX_PUBLIC_DAYS, roster), roster));
    const oneLess = componentCount(buildPublicMessage(team(), worstRaids(MAX_PUBLIC_DAYS - 1, roster), roster));
    const perRaid = atMax - oneLess;
    expect(perRaid).toBeGreaterThan(0);
    expect(atMax + perRaid).toBeGreaterThan(MAX_COMPONENTS);
  });

  it("never shows more than MAX_PUBLIC_DAYS raids however many are passed", () => {
    const atMax = buildPublicMessage(team(), worstRaids(MAX_PUBLIC_DAYS, roster), roster);
    const over = buildPublicMessage(team(), worstRaids(MAX_PUBLIC_DAYS + 5, roster), roster);
    expect(componentCount(over)).toBe(componentCount(atMax));
  });

  it(`with a few raiders it stays within ${MAX_TEXT} text characters`, () => {
    const members = worstRoster(5);
    for (const days of [1, MAX_PUBLIC_DAYS]) {
      expect(textLength(buildPublicMessage(team(), worstRaids(days, members, 0.5), members))).toBeLessThanOrEqual(MAX_TEXT);
    }
  });

  // Regression: the Status note and the "…and N more" lines once went unbudgeted,
  // pushing a 40-player team with long names to 4,028 characters.
  it.each([
    ["a 40-player raid team", 40, 0.25],
    ["a large guild roster", 120, 0.4],
    ["a huge roster, half called out", 300, 0.5],
  ])(`with %s it stays within ${MAX_TEXT} text characters`, (_, size, share) => {
    const members = worstRoster(size);
    for (const days of [1, 2, MAX_PUBLIC_DAYS]) {
      const p = buildPublicMessage(team(), worstRaids(days, members, share), members);
      expect(textLength(p), `${days} raids`).toBeLessThanOrEqual(MAX_TEXT);
    }
  });

  it("the read-only roster card stays within the limits when nothing truncates", () => {
    const members = worstRoster(40);
    const p = buildRaidRosterCard(team(), worstRaids(1, members, 0.5)[0]!, members);
    expect(textLength(p)).toBeLessThanOrEqual(MAX_TEXT);
    expect(componentCount(p)).toBeLessThanOrEqual(MAX_COMPONENTS);
  });

  it("the read-only roster card stays within the text limit with a truncated roster", () => {
    for (const [size, share] of [[120, 0.5], [120, 0.25], [300, 0.5]] as const) {
      const members = worstRoster(size);
      const p = buildRaidRosterCard(team(), worstRaids(1, members, share)[0]!, members);
      expect(textLength(p), `${size} raiders`).toBeLessThanOrEqual(MAX_TEXT);
    }
  });

  it("stays within the text limit at every roster size and call-out share", () => {
    for (let size = 1; size <= 160; size += 3) {
      const members = worstRoster(size);
      for (const share of [0, 0.1, 0.25, 0.5, 0.9]) {
        const raids = worstRaids(MAX_PUBLIC_DAYS, members, share);
        const label = `${size} raiders, ${share * 100}% out`;
        expect(textLength(buildPublicMessage(team(), raids, members)), label).toBeLessThanOrEqual(MAX_TEXT);
        expect(textLength(buildRaidRosterCard(team(), raids[0]!, members)), label).toBeLessThanOrEqual(MAX_TEXT);
      }
    }
  });

  it("keeps every customId, label and select option within limits with cuid-length ids", () => {
    const p = buildPublicMessage(team(), worstRaids(MAX_PUBLIC_DAYS, roster), roster);
    for (const c of flattenComponents(p)) {
      if (c.custom_id) expect(c.custom_id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID);
      if (c.type === ComponentType.Button) expect(c.label.length).toBeLessThanOrEqual(MAX_BUTTON_LABEL);
      if (c.placeholder) expect(c.placeholder.length).toBeLessThanOrEqual(MAX_PLACEHOLDER);
      for (const o of c.options ?? []) {
        expect(o.label.length).toBeLessThanOrEqual(MAX_OPTION_TEXT);
        expect(o.description.length).toBeLessThanOrEqual(MAX_OPTION_TEXT);
      }
    }
  });
});

// ---------------------------------------------------------------- personal message

describe("personal schedule at its worst case", () => {
  const roster = worstRoster(40);
  const rosterIds = new Set(roster.map((m) => m.id));
  const open = worstRaids(MAX_SELECT_OPTIONS + 10, roster);

  const build = (offset: number, shown: RaidRow[]) =>
    buildCalendarMessage(team(), shown, offset, { canEarlier: true, canLater: true }, rosterIds, open, roster[0]!.id);

  it(`lists at most ${MAX_SELECT_OPTIONS} options, each within Discord's text limits`, () => {
    const p = build(0, open.slice(0, PAGE_SIZE));
    const [select] = flattenComponents(p).filter((c) => c.type === ComponentType.StringSelect);
    expect(select.options).toHaveLength(MAX_SELECT_OPTIONS);
    for (const o of select.options) {
      expect(o.label.length).toBeLessThanOrEqual(MAX_OPTION_TEXT);
      expect(o.description.length).toBeLessThanOrEqual(MAX_OPTION_TEXT);
      expect(o.value.length).toBeLessThanOrEqual(MAX_OPTION_TEXT);
    }
    expect(select.placeholder.length).toBeLessThanOrEqual(MAX_PLACEHOLDER);
  });

  it("keeps customIds within 100 characters even at large paging offsets", () => {
    for (const offset of [0, -9999, 9999]) {
      for (const c of flattenComponents(build(offset, open.slice(0, PAGE_SIZE)))) {
        if (c.custom_id) expect(c.custom_id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID);
      }
    }
  });

  it(`a full page of ${PAGE_SIZE} raids stays within the component and text limits for a 40-player team`, () => {
    // Everyone called out of every shown raid: the longest attendance blocks.
    const allOut = weeklyRaids(PAGE_SIZE, () => ({ out: [...rosterIds] }));
    const p = build(0, allOut);
    expect(componentCount(p)).toBeLessThanOrEqual(MAX_COMPONENTS);
    expect(textLength(p)).toBeLessThanOrEqual(MAX_TEXT);
  });
});
