import { beforeEach, describe, expect, it } from "vitest";
import { appEmoji, emojiBaseName, loadAppEmojis, planEmojiSync, versionedEmojiName } from "../../src/lib/emojis.js";
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

describe("versioned emoji names", () => {
  it("add 8 hex of the image's hash, which changes with the image", () => {
    const a = versionedEmojiName("mark_healer", new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^mark_healer_[0-9a-f]{8}$/);
    expect(versionedEmojiName("mark_healer", new Uint8Array([1, 2, 3]))).toBe(a);
    expect(versionedEmojiName("mark_healer", new Uint8Array([1, 2, 4]))).not.toBe(a);
  });

  it("strip back to the file name, leaving unversioned names alone", () => {
    expect(emojiBaseName("mark_healer_0a1b2c3d")).toBe("mark_healer");
    expect(emojiBaseName("mark_healer")).toBe("mark_healer");
    expect(emojiBaseName("dot_lg_green")).toBe("dot_lg_green");
  });

  it("are looked up by file name", async () => {
    await loadAppEmojis(fakeClient({ emojis: ["healer_0a1b2c3d"] }));
    expect(appEmoji("healer")).toBe("<:healer_0a1b2c3d:9000>");
  });
});

describe("planEmojiSync", () => {
  const images = [
    { file: "healer.png", name: "healer_bbbbbbbb" },
    { file: "warrior.jpg", name: "warrior_cccccccc" },
    { file: "mage.jpg", name: "mage_dddddddd" },
  ];

  it("uploads new and changed images and removes old versions and unused emojis", () => {
    const existing = [
      { id: "1", name: "healer_aaaaaaaa" }, // changed image
      { id: "2", name: "warrior_cccccccc" }, // unchanged
      { id: "3", name: "dot_blue_eeeeeeee" }, // image deleted
      { id: "4", name: "warrior" }, // uploaded before names were versioned
    ];
    const { upload, remove } = planEmojiSync(images, existing);
    expect(upload.map((i) => i.name)).toEqual(["healer_bbbbbbbb", "mage_dddddddd"]);
    expect(remove.map((e) => e.id)).toEqual(["1", "3", "4"]);
  });

  it("does nothing when everything is up to date", () => {
    const existing = images.map((i, n) => ({ id: String(n), name: i.name }));
    expect(planEmojiSync(images, existing)).toEqual({ upload: [], remove: [] });
  });
});
