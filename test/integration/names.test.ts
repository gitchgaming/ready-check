import { describe, expect, it } from "vitest";
import * as name from "../../src/commands/name.js";
import * as raidlead from "../../src/commands/raidlead/index.js";
import * as roster from "../../src/commands/roster.js";
import { RESET_NAME, teamNames } from "../../src/lib/raiderNames.js";
import { ROLE_ID, makeRaid, makeTeam } from "../db.js";
import { fakeAutocomplete, fakeChatInput, fakeRole, payloadText, raider, teamRole } from "../discord.js";
import { onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock();

const altRole = fakeRole("Alt Raid", "role-alt");

/** Alice raids on Main; Bob on Main and Alt; Carol on no team. */
async function twoTeams() {
  const main = await makeTeam();
  const alt = await makeTeam({ roleId: altRole.id, name: null });
  const alice = raider("Alice", ["Warriors", "Tanks"], "u-alice");
  const bob = raider("Bob", ["Mages"], "u-bob");
  bob.roles.cache.set(altRole.id, altRole as never);
  const carol = raider("Carol", [], "u-carol");
  carol.roles.cache.delete(ROLE_ID);
  const w = world({ members: [alice, bob, carol], roles: [teamRole, altRole], ownerId: "u-owner" });
  return { main, alt, bob, ...w };
}

async function runName(w: Awaited<ReturnType<typeof twoTeams>>, userId: string, options: Record<string, string>) {
  const interaction = fakeChatInput({ commandName: "name", guild: w.guild, userId, options });
  await name.execute(interaction, w.client);
  return onlyReply(interaction);
}

async function runRaidlead(w: Awaited<ReturnType<typeof twoTeams>>, options: Record<string, string>) {
  const interaction = fakeChatInput({ commandName: "raidlead", subcommand: "name", guild: w.guild, userId: "u-owner", officer: true, options });
  await raidlead.execute(interaction, w.client);
  return onlyReply(interaction);
}

async function teamRoster(w: Awaited<ReturnType<typeof twoTeams>>, teamId: string) {
  const interaction = fakeChatInput({ commandName: "roster", guild: w.guild, userId: "u-bob", options: { team: teamId } });
  await roster.execute(interaction, w.client);
  return onlyReply(interaction);
}

describe("/name", () => {
  it("sets your name on every team you're on, and every view shows it", async () => {
    const w = await twoTeams();
    await makeRaid(w.main.id, "2026-10-07T01:00:00Z");
    expect(await runName(w, "u-bob", { name: "  Frostbolt \n Bob " })).toBe(
      "✅ You now show as `Frostbolt Bob` on **Main Raid** and **Alt Raid**.",
    );
    expect((await teamNames(w.main.id)).get("u-bob")).toBe("Frostbolt Bob");
    expect((await teamNames(w.alt.id)).get("u-bob")).toBe("Frostbolt Bob");

    expect(await teamRoster(w, w.main.id)).toContain("`Frostbolt Bob`");
    expect(await teamRoster(w, w.main.id)).not.toContain("`Bob`");
    // Main's schedule post (the first one sent) was drawn with it.
    expect(payloadText(w.channel.sent[0]!.payloads.at(-1) as any)).toContain("`Frostbolt Bob`");
    // The cached member keeps their Discord name.
    expect(w.bob.displayName).toBe("Bob");
  });

  it("with team:, sets it on that team only", async () => {
    const w = await twoTeams();
    expect(await runName(w, "u-bob", { name: "Altbob", team: w.alt.id })).toBe("✅ You now show as `Altbob` on **Alt Raid**.");
    expect(await teamRoster(w, w.alt.id)).toContain("`Altbob`");
    expect(await teamRoster(w, w.main.id)).toContain("`Bob`");
  });

  it("without a name, shows each team's name", async () => {
    const w = await twoTeams();
    await runName(w, "u-bob", { name: "Altbob", team: w.alt.id });
    expect(await runName(w, "u-bob", {})).toBe(
      "🏷️ On **Main Raid** you show as your Discord name, `Bob`.\n" +
        "🏷️ On **Alt Raid** you show as `Altbob`.\n" +
        "Change it with `/name name:`.",
    );
  });

  it("clears it with the reset choice", async () => {
    const w = await twoTeams();
    await runName(w, "u-bob", { name: "Frostbolt" });
    expect(await runName(w, "u-bob", { name: RESET_NAME, team: w.main.id })).toBe(
      "✅ You show as your Discord name, `Bob`, on **Main Raid** again.",
    );
    expect((await teamNames(w.main.id)).has("u-bob")).toBe(false);
    expect((await teamNames(w.alt.id)).get("u-bob")).toBe("Frostbolt");
  });

  it("rejects a blank name, a team you're not on, and raiders on no team", async () => {
    const w = await twoTeams();
    expect(await runName(w, "u-bob", { name: "   " })).toBe("Type the name to show, or pick “Use my Discord name” to clear yours.");
    expect(await runName(w, "u-alice", { name: "Al", team: w.alt.id })).toBe("You're not on that team. Pick one from the suggestions.");
    expect(await runName(w, "u-carol", { name: "Caz" })).toBe("You're not on any raid team.");
    expect((await teamNames(w.main.id)).size).toBe(0);
  });

  it("autocompletes what's typed first, then the reset choice", async () => {
    const w = await twoTeams();
    const typed = fakeAutocomplete({ commandName: "name", guild: w.guild, userId: "u-bob", focused: "name", options: { name: "Frost" } });
    await name.autocomplete(typed);
    expect(typed.responses).toEqual([
      [
        { name: "Show as “Frost”", value: "Frost" },
        { name: "Use my Discord name (clear mine)", value: RESET_NAME },
      ],
    ]);
    const teams = fakeAutocomplete({ commandName: "name", guild: w.guild, userId: "u-alice", focused: "team" });
    await name.autocomplete(teams);
    expect(teams.responses).toEqual([[{ name: "Main Raid", value: w.main.id }]]);
  });
});

describe("/raidlead name", () => {
  it("sets a raider's name on one team, and clears it", async () => {
    const w = await twoTeams();
    expect(await runRaidlead(w, { user: "u-bob", name: "Frostbolt", team: w.main.id })).toBe(
      "✅ <@u-bob> now shows as `Frostbolt` on **Main Raid**.",
    );
    expect((await teamNames(w.main.id)).get("u-bob")).toBe("Frostbolt");
    expect((await teamNames(w.alt.id)).has("u-bob")).toBe(false);

    expect(await runRaidlead(w, { user: "u-bob", name: RESET_NAME, team: w.main.id })).toBe(
      "✅ <@u-bob> shows as their Discord name, `Bob`, on **Main Raid** again.",
    );
    expect((await teamNames(w.main.id)).size).toBe(0);
  });

  it("refuses someone who isn't on the team, and asks which team when there are several", async () => {
    const w = await twoTeams();
    expect(await runRaidlead(w, { user: "u-alice", name: "Al", team: w.alt.id })).toBe("<@u-alice> isn't on **Alt Raid**.");
    expect(await runRaidlead(w, { user: "u-bob", name: "Frostbolt" })).toBe("Pick which team in the `team:` option.");
    expect((await teamNames(w.alt.id)).size).toBe(0);
  });

  it("autocompletes the name with the reset choice", async () => {
    const w = await twoTeams();
    const typed = fakeAutocomplete({
      commandName: "raidlead",
      subcommand: "name",
      guild: w.guild,
      userId: "u-owner",
      officer: true,
      focused: "name",
      options: { user: "u-bob", name: "" },
    });
    await raidlead.autocomplete(typed);
    expect(typed.responses).toEqual([[{ name: "Use their Discord name (clear it)", value: RESET_NAME }]]);
  });
});
