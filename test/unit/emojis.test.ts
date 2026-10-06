import { beforeEach, describe, expect, it } from "vitest";
import { appEmoji, loadAppEmojis } from "../../src/lib/emojis.js";
import { fakeClient } from "../discord.js";

beforeEach(async () => {
  await loadAppEmojis(fakeClient({ emojis: [] }));
});

describe("appEmoji", () => {
  it("returns the fallback (empty by default) when the emoji isn't loaded", () => {
    expect(appEmoji("warrior")).toBe("");
    expect(appEmoji("dot_green", "🟢")).toBe("🟢");
  });

  it("returns the emoji's message markup by name after loading", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior", "mage"] }));
    expect(appEmoji("warrior")).toBe("<:warrior:9000>");
    expect(appEmoji("mage", "?")).toBe("<:mage:9001>");
    expect(appEmoji("rogue", "?")).toBe("?");
  });

  it("matches names exactly", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior"] }));
    expect(appEmoji("Warrior", "x")).toBe("x");
  });
});

describe("loadAppEmojis", () => {
  it("replaces the previous set, so removed emojis fall back again", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["warrior", "mage"] }));
    await loadAppEmojis(fakeClient({ emojis: ["mage"] }));
    expect(appEmoji("warrior", "fallback")).toBe("fallback");
    expect(appEmoji("mage")).toBe("<:mage:9000>");
  });

  it("skips emojis without a name", async () => {
    const client = fakeClient({ emojis: ["warrior"] });
    const emojis = await client.application.emojis.fetch();
    emojis.set("1", { id: "1", name: null, toString: () => "<:_:1>" } as never);
    client.application.emojis.fetch = (async () => emojis) as never;
    await loadAppEmojis(client);
    expect(appEmoji("warrior")).toBe("<:warrior:9000>");
    expect(appEmoji("null", "none")).toBe("none");
  });
});
