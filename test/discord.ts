/**
 * Minimal discord.js fakes: just the properties the bot reads, built on the real
 * `Collection` and bitfields, cast to the discord.js types with `as unknown as`.
 * Interactions record what the bot sends (`replies`, `updates`, `responses`) so
 * tests assert on payloads instead of mocking calls.
 */
import {
  Collection,
  MessageFlags,
  MessageFlagsBitField,
  PermissionsBitField,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Role,
  type StringSelectMenuInteraction,
} from "discord.js";
import { CHANNEL_ID, GUILD_ID, ROLE_ID } from "./db.js";

let nextId = 1000;
const snowflake = () => String(nextId++);

// ---------------------------------------------------------------- roles, members, guild

export interface FakeRole {
  id: string;
  name: string;
}

export function fakeRole(name: string, id: string = `role-${name.toLowerCase()}`): FakeRole {
  return { id, name };
}

/** The raid team's role (id `ROLE_ID`, matching `makeTeam()`'s default). */
export const teamRole = fakeRole("Main Raid", ROLE_ID);

export interface FakeMemberOptions {
  id?: string;
  name: string;
  /** Role objects, or role names (turned into roles with `fakeRole`). */
  roles?: (FakeRole | string)[];
  bot?: boolean;
}

export function fakeMember({ id = snowflake(), name, roles = [], bot = false }: FakeMemberOptions): GuildMember {
  const roleObjects = roles.map((r) => (typeof r === "string" ? fakeRole(r) : r));
  const member = {
    id,
    displayName: name,
    user: { id, bot, username: name, tag: name },
    roles: { cache: new Collection(roleObjects.map((r) => [r.id, r])) },
    toString: () => `<@${id}>`,
  };
  return member as unknown as GuildMember;
}

/** A raider on the team: holds `teamRole` plus the given class/type role names. */
export function raider(name: string, roles: string[] = [], id?: string): GuildMember {
  return fakeMember({ id, name, roles: [teamRole, ...roles] });
}

export interface FakeGuildOptions {
  id?: string;
  ownerId?: string;
  roles?: FakeRole[];
  members?: GuildMember[];
  /** Defaults to the number of members, i.e. a fully warmed cache. */
  memberCount?: number;
}

export type FakeGuild = Guild & { fullFetches: number };

export function fakeGuild({
  id = GUILD_ID,
  ownerId = "owner",
  roles = [teamRole],
  members = [],
  memberCount,
}: FakeGuildOptions = {}): FakeGuild {
  const cache = new Collection(members.map((m) => [m.id, m]));
  const guild = {
    id,
    ownerId,
    name: "Test Guild",
    memberCount: memberCount ?? members.length,
    roles: { cache: new Collection(roles.map((r) => [r.id, r as unknown as Role])) },
    /** How many times the whole member list was fetched (should stay 0 once warm). */
    fullFetches: 0,
    members: {
      cache,
      async fetch(memberId?: string) {
        if (memberId === undefined) {
          guild.fullFetches++;
          return cache;
        }
        const member = cache.get(memberId);
        if (!member) throw new Error(`Unknown Member ${memberId}`);
        return member;
      },
    },
  };
  return guild as unknown as FakeGuild;
}

// ---------------------------------------------------------------- channels, messages, client

export interface FakeMessage {
  id: string;
  /** Every payload this message has held: the send, then each edit. */
  payloads: unknown[];
  deleted: boolean;
  flags: MessageFlagsBitField;
  edit(payload: unknown): Promise<FakeMessage>;
  delete(): Promise<FakeMessage>;
}

function fakeMessage(payload: unknown, id: string = snowflake()): FakeMessage {
  const flagsOf = (p: unknown) => new MessageFlagsBitField((p as { flags?: number }).flags ?? 0);
  const message: FakeMessage = {
    id,
    payloads: [payload],
    deleted: false,
    flags: flagsOf(payload),
    async edit(next) {
      message.payloads.push(next);
      message.flags = flagsOf(next);
      return message;
    },
    async delete() {
      message.deleted = true;
      return message;
    },
  };
  return message;
}

export interface FakeChannel {
  id: string;
  /** Messages posted with `send`, oldest first. */
  sent: FakeMessage[];
  messages: { cache: Map<string, FakeMessage>; fetch(id: string): Promise<FakeMessage> };
  isTextBased(): boolean;
  send(payload: unknown): Promise<FakeMessage>;
  /** Seeds an existing message, e.g. one posted before Components V2 (`v2: false`). */
  seedMessage(id: string, opts?: { v2?: boolean }): FakeMessage;
}

export function fakeChannel(id: string = CHANNEL_ID): FakeChannel {
  const cache = new Map<string, FakeMessage>();
  const channel: FakeChannel = {
    id,
    sent: [],
    messages: {
      cache,
      async fetch(messageId) {
        const message = cache.get(messageId);
        if (!message || message.deleted) throw new Error(`Unknown Message ${messageId}`);
        return message;
      },
    },
    isTextBased: () => true,
    async send(payload) {
      const message = fakeMessage(payload);
      cache.set(message.id, message);
      channel.sent.push(message);
      return message;
    },
    seedMessage(messageId, { v2 = true } = {}) {
      const message = fakeMessage({ flags: v2 ? MessageFlags.IsComponentsV2 : 0 }, messageId);
      cache.set(messageId, message);
      return message;
    },
  };
  return channel;
}

export interface FakeClientOptions {
  guilds?: Guild[];
  channels?: FakeChannel[];
  /** Application emoji names; each renders as `<:name:id>`. */
  emojis?: string[];
}

export function fakeClient({ guilds = [], channels = [], emojis = [] }: FakeClientOptions = {}): Client<true> {
  const emojiCollection = new Collection(
    emojis.map((name, i) => {
      const id = String(9000 + i);
      return [id, { id, name, toString: () => `<:${name}:${id}>` }];
    }),
  );
  const client = {
    guilds: {
      cache: new Collection(guilds.map((g) => [g.id, g])),
      async fetch(id: string) {
        const guild = guilds.find((g) => g.id === id);
        if (!guild) throw new Error(`Unknown Guild ${id}`);
        return guild;
      },
    },
    channels: {
      async fetch(id: string) {
        const channel = channels.find((c) => c.id === id);
        if (!channel) throw new Error(`Unknown Channel ${id}`);
        return channel;
      },
    },
    application: { emojis: { fetch: async () => emojiCollection } },
  };
  return client as unknown as Client<true>;
}

// ---------------------------------------------------------------- interactions

interface Recorded {
  /** Payloads passed to `reply`, in order. */
  replies: any[];
  /** Payloads passed to `update`. */
  updates: any[];
  /** Choice lists passed to `respond` (autocomplete). */
  responses: { name: string; value: string | number }[][];
}

interface BaseOptions {
  userId?: string;
  guild?: Guild | null;
  /** Grants Manage Events (officer) when true. */
  officer?: boolean;
  channel?: FakeChannel | null;
}

function baseInteraction({ userId = "user-1", guild = null, officer = false, channel = null }: BaseOptions) {
  const recorded: Recorded & { replied: boolean; deferred: boolean } = {
    replies: [],
    updates: [],
    responses: [],
    replied: false,
    deferred: false,
  };
  return Object.assign(recorded, {
    user: { id: userId, bot: false, username: userId },
    guild,
    guildId: guild?.id ?? null,
    channel,
    memberPermissions: new PermissionsBitField(officer ? PermissionsBitField.Flags.ManageEvents : 0n),
    isRepliable: () => true,
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    async reply(payload: unknown) {
      if (recorded.replied) throw new Error("Interaction has already been acknowledged.");
      recorded.replied = true;
      recorded.replies.push(payload);
    },
    async update(payload: unknown) {
      if (recorded.replied) throw new Error("Interaction has already been acknowledged.");
      recorded.replied = true;
      recorded.updates.push(payload);
    },
    async respond(choices: { name: string; value: string | number }[]) {
      recorded.responses.push(choices);
    },
  });
}

/**
 * Option values by name. Role, user and channel options may be given as an id
 * string (resolved from the guild for roles) or as an object with an `id`.
 */
type OptionValues = Record<string, unknown>;

function fakeOptions(
  values: OptionValues,
  guild: Guild | null,
  { subcommand, group, focused }: { subcommand?: string; group?: string; focused?: string },
) {
  const has = (name: string) => values[name] !== undefined && values[name] !== null;
  const raw = (name: string, required?: boolean) => {
    if (!has(name)) {
      if (required) throw new Error(`Required option "${name}" not found.`);
      return null;
    }
    return values[name];
  };
  const idOf = (v: unknown) => (typeof v === "string" ? v : (v as { id: string }).id);
  return {
    getString: (name: string, required?: boolean) => raw(name, required) as string | null,
    getInteger: (name: string, required?: boolean) => raw(name, required) as number | null,
    getBoolean: (name: string, required?: boolean) => raw(name, required) as boolean | null,
    getRole(name: string, required?: boolean) {
      const v = raw(name, required);
      if (v === null) return null;
      if (typeof v !== "string") return v;
      return guild?.roles.cache.get(v) ?? { id: v, name: v };
    },
    getUser(name: string, required?: boolean) {
      const v = raw(name, required);
      return v === null ? null : typeof v === "string" ? { id: v, bot: false, username: v } : v;
    },
    getChannel(name: string, required?: boolean) {
      const v = raw(name, required);
      return v === null ? null : typeof v === "string" ? { id: v } : v;
    },
    /** Raw option, as Discord sends it during autocomplete (ids, not objects). */
    get: (name: string) => (has(name) ? { name, value: idOf(values[name]) } : null),
    getFocused(full?: boolean) {
      const value = focused ? String(values[focused] ?? "") : "";
      return full ? { name: focused, value } : value;
    },
    getSubcommand(required = true) {
      if (!subcommand && required) throw new Error("No subcommand");
      return subcommand ?? null;
    },
    getSubcommandGroup(required = false) {
      if (!group && required) throw new Error("No subcommand group");
      return group ?? null;
    },
  };
}

export interface FakeCommandOptions extends BaseOptions {
  commandName?: string;
  subcommand?: string;
  group?: string;
  options?: OptionValues;
}

export type FakeChatInput = ChatInputCommandInteraction & Recorded;

export function fakeChatInput({ commandName = "test", subcommand, group, options = {}, ...base }: FakeCommandOptions = {}) {
  const interaction = Object.assign(baseInteraction(base), {
    commandName,
    isChatInputCommand: () => true,
    options: fakeOptions(options, base.guild ?? null, { subcommand, group }),
  });
  return interaction as unknown as FakeChatInput;
}

export type FakeAutocomplete = AutocompleteInteraction & Recorded;

/** An autocomplete event; `focused` names the option being typed into. */
export function fakeAutocomplete({
  commandName = "test",
  subcommand,
  group,
  options = {},
  focused,
  ...base
}: FakeCommandOptions & { focused: string }) {
  const interaction = Object.assign(baseInteraction(base), {
    commandName,
    isAutocomplete: () => true,
    isRepliable: () => false,
    options: fakeOptions(options, base.guild ?? null, { subcommand, group, focused }),
  });
  return interaction as unknown as FakeAutocomplete;
}

export type FakeButton = ButtonInteraction & Recorded;

export function fakeButton(customId: string, base: BaseOptions = {}) {
  const interaction = Object.assign(baseInteraction(base), { customId, isButton: () => true });
  return interaction as unknown as FakeButton;
}

export type FakeSelect = StringSelectMenuInteraction & Recorded;

export function fakeSelect(customId: string, values: string[], base: BaseOptions = {}) {
  const interaction = Object.assign(baseInteraction(base), {
    customId,
    values,
    isStringSelectMenu: () => true,
  });
  return interaction as unknown as FakeSelect;
}

// ---------------------------------------------------------------- payload helpers

/** Every component in a Components V2 payload, depth-first (containers, sections, rows included). */
export function flattenComponents(payload: { components?: unknown[] }): any[] {
  const out: any[] = [];
  const walk = (c: any) => {
    const json = typeof c?.toJSON === "function" ? c.toJSON() : c;
    out.push(json);
    for (const child of json.components ?? []) walk(child);
    if (json.accessory) walk(json.accessory);
  };
  for (const c of payload.components ?? []) walk(c);
  return out;
}

/** All text in a V2 payload's text displays, joined by newlines. */
export function payloadText(payload: { components?: unknown[] }): string {
  return flattenComponents(payload)
    .filter((c) => typeof c.content === "string")
    .map((c) => c.content as string)
    .join("\n");
}
