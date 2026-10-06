/** Shared setup for the integration tests: a fake clock and a guild/channel/client trio. */
import { afterEach, beforeEach, vi } from "vitest";
import { MessageFlags, type GuildMember } from "discord.js";
import { resetDb } from "../db.js";
import { fakeChannel, fakeClient, fakeGuild, teamRole, type FakeRole } from "../discord.js";

/** A Tuesday, 7:00 AM in America/Chicago (CDT, UTC−5). */
export const NOW = new Date("2026-10-06T12:00:00Z");

/** Resets the DB and pins `Date` to `at` around every test in the file. */
export function useDbAndClock(at: Date = NOW): void {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}

export interface WorldOptions {
  members?: GuildMember[];
  roles?: FakeRole[];
  ownerId?: string;
  memberCount?: number;
}

/** One guild (with the team role) whose schedule channel is `CHANNEL_ID`, and a client that sees both. */
export function world({ members = [], roles = [teamRole], ownerId, memberCount }: WorldOptions = {}) {
  const guild = fakeGuild({ members, roles, ownerId, memberCount });
  const channel = fakeChannel();
  const client = fakeClient({ guilds: [guild], channels: [channel] });
  return { guild, channel, client };
}

/** Whether a reply payload is ephemeral (flags as a number or an array of flags). */
export function isEphemeral(payload: { flags?: unknown }): boolean {
  const flags = payload.flags;
  if (Array.isArray(flags)) return flags.includes(MessageFlags.Ephemeral);
  return typeof flags === "number" && (flags & MessageFlags.Ephemeral) !== 0;
}

/** The single reply's text, asserting there was exactly one ephemeral reply. */
export function onlyReply(interaction: { replies: any[] }): string {
  if (interaction.replies.length !== 1) throw new Error(`Expected 1 reply, got ${interaction.replies.length}`);
  const reply = interaction.replies[0];
  if (!isEphemeral(reply)) throw new Error("Expected an ephemeral reply");
  return reply.content as string;
}
