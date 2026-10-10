import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REST, Routes, type RESTGetAPIApplicationEmojisResult } from "discord.js";
import { EMOJI_DIR, planEmojiSync, versionedEmojiName } from "./lib/emojis.js";

/**
 * Makes the bot's application emojis match the images in assets/emojis/:
 * uploads new and changed images (named `warrior.png` → `:warrior_<hash>:`), then
 * removes old versions and emojis whose image is gone.
 *
 *   npm run deploy-emojis
 */

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set (see .env.example).");
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const rest = new REST().setToken(token);

async function main() {
  const files = (await readdir(EMOJI_DIR)).filter((f) => path.extname(f).toLowerCase() in MIME_TYPES);
  // With no images every emoji would count as unused; refuse rather than delete them all.
  if (files.length === 0) throw new Error(`No emoji images found in ${EMOJI_DIR}.`);

  const data = new Map<string, Buffer>();
  const images = await Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(path.join(EMOJI_DIR, file));
      data.set(file, bytes);
      return { file, name: versionedEmojiName(path.parse(file).name, bytes) };
    }),
  );

  const { items } = (await rest.get(Routes.applicationEmojis(clientId!))) as RESTGetAPIApplicationEmojisResult;
  const { upload, remove } = planEmojiSync(images, items);

  // Upload before removing, so a failed upload leaves the old version in place.
  for (const { file, name } of upload) {
    const image = `data:${MIME_TYPES[path.extname(file).toLowerCase()]};base64,${data.get(file)!.toString("base64")}`;
    await rest.post(Routes.applicationEmojis(clientId!), { body: { name, image } });
    console.log(`Uploaded :${name}:`);
  }
  for (const emoji of remove) {
    if (!emoji.id) continue;
    await rest.delete(Routes.applicationEmoji(clientId!, emoji.id));
    console.log(`Removed :${emoji.name}:`);
  }

  console.log(`${upload.length} uploaded, ${remove.length} removed, ${images.length - upload.length} already up to date.`);
}

main().catch((err) => {
  console.error("Failed to deploy emojis:", err);
  process.exit(1);
});
