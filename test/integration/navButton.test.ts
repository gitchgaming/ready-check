import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { handleNavButton, isNavButton } from "../../src/interactions/navButton.js";
import { makeRaid, makeTeam } from "../db.js";
import { fakeButton, flattenComponents, payloadText } from "../discord.js";
import { NOW, useDbAndClock, world } from "./world.js";

useDbAndClock();

const now = () => DateTime.fromJSDate(NOW);

/** 4 closed raids, then 5 open ones. */
async function seed() {
  const team = await makeTeam();
  for (let i = 4; i >= 1; i--) await makeRaid(team.id, now().minus({ weeks: i }), { closed: true });
  for (let i = 1; i <= 5; i++) await makeRaid(team.id, now().plus({ days: i }));
  return team;
}

function navState(payload: any, teamId: string) {
  const all = flattenComponents(payload);
  const earlier = all.find((c) => c.custom_id?.startsWith(`mynav:earlier:${teamId}:`));
  const later = all.find((c) => c.custom_id?.startsWith(`mynav:later:${teamId}:`));
  return {
    offset: Number(earlier.custom_id.split(":")[3]),
    earlierDisabled: earlier.disabled,
    laterDisabled: later.disabled,
  };
}

describe("isNavButton", () => {
  it("claims mynav: customIds only", () => {
    expect(isNavButton("mynav:later:t:0")).toBe(true);
    expect(isNavButton("attendance:btn:t:r")).toBe(false);
  });
});

describe("handleNavButton", () => {
  it("pages later and earlier by PAGE_SIZE, updating the personal view in place", async () => {
    const team = await seed();
    const { client, guild } = world();

    const later = fakeButton(`mynav:later:${team.id}:0`, { guild });
    await handleNavButton(later, client);
    expect(later.replies).toHaveLength(0);
    expect(navState(later.updates[0], team.id)).toEqual({ offset: 3, earlierDisabled: false, laterDisabled: true });

    const earlier = fakeButton(`mynav:earlier:${team.id}:0`, { guild });
    await handleNavButton(earlier, client);
    expect(navState(earlier.updates[0], team.id)).toEqual({ offset: -3, earlierDisabled: false, laterDisabled: false });
    expect(payloadText(earlier.updates[0])).toContain("These raids already happened");
  });

  it("clamps at both ends", async () => {
    const team = await seed();
    const { client, guild } = world();

    const first = fakeButton(`mynav:earlier:${team.id}:-3`, { guild });
    await handleNavButton(first, client);
    expect(navState(first.updates[0], team.id)).toEqual({ offset: -4, earlierDisabled: true, laterDisabled: false });

    const last = fakeButton(`mynav:later:${team.id}:3`, { guild });
    await handleNavButton(last, client);
    expect(navState(last.updates[0], team.id)).toMatchObject({ offset: 4, laterDisabled: true });
  });

  it("treats a garbled offset as 0", async () => {
    const team = await seed();
    const { client, guild } = world();
    const click = fakeButton(`mynav:later:${team.id}:abc`, { guild });
    await handleNavButton(click, client);
    expect(navState(click.updates[0], team.id).offset).toBe(3);
  });

  it("ignores unknown directions, missing team ids and deleted teams", async () => {
    const team = await seed();
    const { client, guild } = world();
    for (const id of [`mynav:sideways:${team.id}:0`, "mynav:later", "mynav:later:gone-team:0"]) {
      const click = fakeButton(id, { guild });
      await handleNavButton(click, client);
      expect(click.updates).toHaveLength(0);
      expect(click.replies).toHaveLength(0);
    }
  });
});
