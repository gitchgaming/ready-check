import { describe, expect, it } from "vitest";
import * as timezone from "../../src/commands/timezone.js";
import { RESET_ZONE } from "../../src/commands/timezone.js";
import { userTimezone } from "../../src/lib/userSettings.js";
import { fakeAutocomplete, fakeChatInput } from "../discord.js";
import { isEphemeral, onlyReply, useDbAndClock, world } from "./world.js";

useDbAndClock(); // Tue Oct 6 2026, 12:00Z: 7:00 AM in Chicago, 2:00 PM in Berlin

async function run(zone?: string, userId = "u-alice") {
  const { client } = world();
  const interaction = fakeChatInput({ commandName: "timezone", userId, options: zone === undefined ? {} : { zone } });
  await timezone.execute(interaction, client);
  expect(isEphemeral(interaction.replies[0])).toBe(true);
  return onlyReply(interaction);
}

describe("/timezone", () => {
  it("without a zone, says pickers use team time and how to set one", async () => {
    expect(await run()).toBe(
      "🕒 You haven't set a timezone, so pickers and dropdowns show each raid in its team's timezone, with the zone's name (like CDT). Set yours with `/timezone zone:`.",
    );
  });

  it("sets it, saying the time there now, then shows it", async () => {
    expect(await run("Europe/Berlin")).toBe(
      "✅ Your timezone is now **Central European Time** (Europe/Berlin), where it's 2:00 PM now. Raid times in pickers and dropdowns will show in it. Dates in messages already follow your device's clock.",
    );
    expect(await userTimezone("u-alice")).toBe("Europe/Berlin");
    expect(await userTimezone("u-bob")).toBeNull();
    expect(await run()).toMatch(/^🕒 Your timezone is \*\*Central European Time\*\* \(Europe\/Berlin\), where it's 2:00 PM now\./);

    expect(await run("America/Chicago")).toMatch(/^✅ Your timezone is now \*\*Central Time\*\* \(America\/Chicago\), where it's 7:00 AM now\./);
    expect(await userTimezone("u-alice")).toBe("America/Chicago");
  });

  it("clears it with the reset choice", async () => {
    await run("Europe/Berlin");
    expect(await run(RESET_ZONE)).toBe(
      "✅ Cleared your timezone. Now pickers and dropdowns show each raid in its team's timezone, with the zone's name (like CDT).",
    );
    expect(await userTimezone("u-alice")).toBeNull();
  });

  it("rejects a zone it doesn't know and keeps the old one", async () => {
    await run("Europe/Berlin");
    expect(await run("Mars/Olympus")).toBe('"Mars/Olympus" isn\'t a recognized timezone. Pick one from the suggestions as you type.');
    expect(await userTimezone("u-alice")).toBe("Europe/Berlin");
  });

  it("autocompletes the reset choice first, then timezones by what's typed", async () => {
    const all = fakeAutocomplete({ commandName: "timezone", focused: "zone" });
    await timezone.autocomplete(all);
    expect(all.responses[0]![0]).toEqual({ name: "Use each team's timezone (clear mine)", value: RESET_ZONE });
    expect(all.responses[0]).toHaveLength(25);

    const berlin = fakeAutocomplete({ commandName: "timezone", focused: "zone", options: { zone: "berl" } });
    await timezone.autocomplete(berlin);
    expect(berlin.responses).toEqual([[{ name: "Europe/Berlin", value: "Europe/Berlin" }]]);
  });
});
