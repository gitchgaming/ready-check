import { describe, expect, it, vi } from "vitest";
import type { Command } from "../../src/commands/index.js";
import { routeInteraction } from "../../src/interactions/router.js";
import { makeRaid, makeTeam, prisma } from "../db.js";
import { fakeAutocomplete, fakeButton, fakeChatInput, fakeSelect, raider } from "../discord.js";
import { isEphemeral, onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock();

const ERROR_TEXT = "Something went wrong handling that.";

function throwingCommand(name = "boom"): Command {
  return {
    data: { name, toJSON: () => ({}) },
    execute: async () => {
      throw new Error("kaboom");
    },
    autocomplete: async () => {
      throw new Error("kaboom");
    },
  };
}

const quietErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});

async function setup() {
  const team = await makeTeam();
  const raid = await makeRaid(team.id, "2026-10-07T01:00:00Z");
  const w = world({ members: [raider("Alice", [], "u-alice")] });
  return { team, raid, ...w, base: { guild: w.guild, userId: "u-alice" } };
}

describe("routeInteraction: commands", () => {
  it("sends a slash command to its command's execute", async () => {
    const { client, guild } = await setup();
    const run = fakeChatInput({ commandName: "schedule", guild, userId: "u-stranger" });
    await routeInteraction(run, client);
    expect(onlyReply(run)).toBe("You're not on any raid team.");
  });

  it("sends autocomplete to its command's autocomplete", async () => {
    const { client, guild, team } = await setup();
    const ac = fakeAutocomplete({ commandName: "schedule", guild, userId: "u-alice", focused: "team" });
    await routeInteraction(ac, client);
    expect(ac.responses).toEqual([[{ name: "Main Raid", value: team.id }]]);
  });

  it("ignores unknown commands, and autocomplete for commands without it", async () => {
    const { client, guild } = await setup();
    const run = fakeChatInput({ commandName: "nope", guild });
    await routeInteraction(run, client);
    expect(run.replies).toHaveLength(0);

    const executeOnly: Command = { data: { name: "plain", toJSON: () => ({}) }, execute: async () => {} };
    const ac = fakeAutocomplete({ commandName: "plain", guild, focused: "x" });
    await routeInteraction(ac, client, new Map([["plain", executeOnly]]));
    expect(ac.responses).toHaveLength(0);
  });

  it("uses the given command map instead of the registered commands", async () => {
    const { client, guild } = await setup();
    const run = fakeChatInput({ commandName: "schedule", guild });
    await routeInteraction(run, client, new Map());
    expect(run.replies).toHaveLength(0);
  });
});

describe("routeInteraction: components", () => {
  it("sends attendance buttons and selects to the attendance handler", async () => {
    const { client, team, raid, base } = await setup();
    const click = fakeButton(`attendance:btn:${team.id}:${raid.id}`, base);
    await routeInteraction(click, client);
    expect(onlyReply(click)).toBe("You're out for Tue, Oct 6. Click again to undo.");
    expect(await prisma.attendance.count()).toBe(1);

    const more = fakeSelect(`attendance:pub:${team.id}`, ["more"], base);
    await routeInteraction(more, client);
    expect(more.replies).toHaveLength(1);
    expect(isEphemeral(more.replies[0])).toBe(true);

    const pick = fakeSelect(`attendance:cal:${team.id}:0`, [raid.id], base);
    await routeInteraction(pick, client);
    expect(pick.updates).toHaveLength(1);
    expect(await prisma.attendance.count()).toBe(0);
  });

  it("sends mynav buttons to the nav handler, but not selects with that prefix", async () => {
    const { client, team, base } = await setup();
    const click = fakeButton(`mynav:later:${team.id}:0`, base);
    await routeInteraction(click, client);
    expect(click.updates).toHaveLength(1);

    const select = fakeSelect(`mynav:later:${team.id}:0`, ["x"], base);
    await routeInteraction(select, client);
    expect(select.updates).toHaveLength(0);
    expect(select.replies).toHaveLength(0);
  });

  it("sends teamdelete buttons to the team-delete handler, but not selects with that prefix", async () => {
    const { client, team, guild } = await setup();
    const select = fakeSelect(`teamdelete:confirm:${team.id}`, ["x"], { guild, officer: true });
    await routeInteraction(select, client);
    expect(select.updates).toHaveLength(0);
    expect(await prisma.raidTeam.count()).toBe(1);

    const click = fakeButton(`teamdelete:confirm:${team.id}`, { guild, officer: true });
    await routeInteraction(click, client);
    expect(click.updates[0].content).toBe("🗑️ Deleted **Main Raid**.");
    expect(await prisma.raidTeam.count()).toBe(0);
  });

  it("ignores unknown customIds", async () => {
    const { client, base } = await setup();
    for (const interaction of [fakeButton("other:thing", base), fakeSelect("other:thing", ["x"], base)]) {
      await routeInteraction(interaction, client);
      expect(interaction.replies).toHaveLength(0);
      expect(interaction.updates).toHaveLength(0);
    }
  });
});

describe("routeInteraction: errors", () => {
  it("replies privately with an error when a command throws", async () => {
    const { client, guild } = await setup();
    const errors = quietErrors();
    const run = fakeChatInput({ commandName: "boom", guild });
    await routeInteraction(run, client, new Map([["boom", throwingCommand()]]));
    expect(onlyReply(run)).toBe(ERROR_TEXT);
    expect(errors).toHaveBeenCalledWith("Error handling interaction:", expect.any(Error));
  });

  it("replies with an error when a component handler throws", async () => {
    const { client, base } = await setup();
    quietErrors();
    // The team's guild isn't one the client can fetch, so paging throws.
    const stray = await makeTeam({ guildId: "guild-unreachable" });
    const click = fakeButton(`mynav:later:${stray.id}:0`, base);
    await routeInteraction(click, client);
    expect(onlyReply(click)).toBe(ERROR_TEXT);
  });

  it("doesn't reply again when the handler already replied or deferred", async () => {
    const { client, guild } = await setup();
    quietErrors();
    const repliedFirst: Command = {
      data: { name: "late", toJSON: () => ({}) },
      execute: async (i) => {
        await i.reply({ content: "partial" });
        throw new Error("after reply");
      },
    };
    const replied = fakeChatInput({ commandName: "late", guild });
    const replySpy = vi.spyOn(replied, "reply");
    await routeInteraction(replied, client, new Map([["late", repliedFirst]]));
    expect(replySpy).toHaveBeenCalledTimes(1);
    expect(replied.replies).toEqual([{ content: "partial" }]);

    const deferred = fakeChatInput({ commandName: "boom", guild });
    (deferred as unknown as { deferred: boolean }).deferred = true;
    const deferSpy = vi.spyOn(deferred, "reply");
    await routeInteraction(deferred, client, new Map([["boom", throwingCommand()]]));
    expect(deferSpy).not.toHaveBeenCalled();
  });

  it("swallows errors from autocomplete, which can't be replied to", async () => {
    const { client, guild } = await setup();
    const errors = quietErrors();
    const ac = fakeAutocomplete({ commandName: "boom", guild, focused: "x" });
    const replySpy = vi.spyOn(ac as unknown as { reply: () => Promise<void> }, "reply");
    await expect(routeInteraction(ac, client, new Map([["boom", throwingCommand()]]))).resolves.toBeUndefined();
    expect(replySpy).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  });

  it("doesn't reject when the error reply itself fails", async () => {
    const { client, guild } = await setup();
    quietErrors();
    const run = fakeChatInput({ commandName: "boom", guild });
    vi.spyOn(run, "reply").mockRejectedValue(new Error("Unknown interaction"));
    await expect(routeInteraction(run, client, new Map([["boom", throwingCommand()]]))).resolves.toBeUndefined();
  });
});
