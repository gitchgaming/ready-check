import { createHash } from "node:crypto";
import path from "node:path";
import type { Client } from "discord.js";

/** Images here are uploaded as application emojis by `npm run deploy-emojis`. */
export const EMOJI_DIR = path.resolve("assets/emojis");

/**
 * Uploaded emojis are named `<file name>_<8 hex of the image's hash>`, so a changed
 * image gets a new name and `deploy-emojis` can tell it apart from the old one
 * without downloading anything. The bot looks emojis up by the part before it.
 */
const VERSION_SUFFIX = /_[0-9a-f]{8}$/;

/** The name an image is uploaded under: its file name plus a short hash of its bytes. */
export function versionedEmojiName(baseName: string, image: Uint8Array): string {
  return `${baseName}_${createHash("sha256").update(image).digest("hex").slice(0, 8)}`;
}

/** The file name an uploaded emoji came from (names without a hash pass through). */
export function emojiBaseName(name: string): string {
  return name.replace(VERSION_SUFFIX, "");
}

export interface EmojiImage {
  /** The versioned name it should be uploaded under. */
  name: string;
  file: string;
}

/**
 * What `deploy-emojis` does to make the application's emojis match the images:
 * upload each image whose versioned name isn't there yet (new or changed), and
 * remove every emoji no image wants (old versions, deleted images).
 */
export function planEmojiSync<E extends { name: string | null }>(images: EmojiImage[], existing: E[]) {
  const wanted = new Set(images.map((i) => i.name));
  const present = new Set(existing.map((e) => e.name));
  return {
    upload: images.filter((i) => !present.has(i.name)),
    remove: existing.filter((e) => !e.name || !wanted.has(e.name)),
  };
}

const emojiByName = new Map<string, string>();

/**
 * Caches the bot's application emojis by name. Application emojis belong to the
 * bot, not a server, so the dev and production apps each have their own copy and
 * IDs differ between them — always look emojis up by name.
 */
export async function loadAppEmojis(client: Client<true>): Promise<void> {
  const emojis = await client.application.emojis.fetch();
  emojiByName.clear();
  for (const emoji of emojis.values()) {
    if (emoji.name) emojiByName.set(emojiBaseName(emoji.name), emoji.toString());
  }
}

/** The emoji's message markup, or `fallback` if no emoji with that name exists. */
export function appEmoji(name: string, fallback = ""): string {
  return emojiByName.get(name) ?? fallback;
}
