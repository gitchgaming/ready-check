import path from "node:path";
import type { Client } from "discord.js";

/** Images here are uploaded as application emojis by `npm run deploy-emojis`. */
export const EMOJI_DIR = path.resolve("assets/emojis");

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
    if (emoji.name) emojiByName.set(emoji.name, emoji.toString());
  }
}

/** The emoji's message markup, or `fallback` if no emoji with that name exists. */
export function appEmoji(name: string, fallback = ""): string {
  return emojiByName.get(name) ?? fallback;
}
