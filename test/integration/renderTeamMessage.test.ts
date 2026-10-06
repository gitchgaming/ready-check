import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { renderTeamMessage } from "../../src/lib/scheduler.js";
import { callOut, makeRaid, makeTeam, prisma, resetDb } from "../db.js";
import { fakeChannel, fakeClient, fakeGuild, payloadText, raider } from "../discord.js";

const NOW = new Date("2026-10-06T12:00:00Z"); // a Tuesday

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("renderTeamMessage", () => {
  it("posts a V2 message once, then edits it in place", async () => {
    const team = await makeTeam();
    const raid = await makeRaid(team.id, "2026-10-07T01:00:00Z");
    const alice = raider("Alice", ["Warriors", "Tanks"], "u-alice");
    const bob = raider("Bob", ["Mages", "Wizards"], "u-bob");
    await callOut(raid.id, bob.id);
    const guild = fakeGuild({ members: [alice, bob] });
    const channel = fakeChannel();
    const client = fakeClient({ guilds: [guild], channels: [channel] });

    await renderTeamMessage(client, team.id);
    expect(channel.sent).toHaveLength(1);
    const posted = channel.sent[0]!;
    expect(posted.flags.has(MessageFlags.IsComponentsV2)).toBe(true);
    expect(payloadText(posted.payloads[0] as any)).toContain("**1/2 ready**");
    expect((await prisma.raidTeam.findUniqueOrThrow({ where: { id: team.id } })).messageId).toBe(posted.id);

    await renderTeamMessage(client, team.id);
    expect(channel.sent).toHaveLength(1);
    expect(posted.payloads).toHaveLength(2);
    expect(guild.fullFetches).toBe(0);
  });
});
