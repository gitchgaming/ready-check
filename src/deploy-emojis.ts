import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REST, Routes, type RESTGetAPIApplicationEmojisResult } from "discord.js";
import { EMOJI_DIR } from "./lib/emojis.js";

/**
 * Uploads the images in assets/emojis/ as application emojis, named after each
 * file (`warrior.png` → `:warrior:`).
 *
 *   npm run deploy-emojis                      upload any that are missing
 *   npm run deploy-emojis -- --replace         re-upload every image
 *   npm run deploy-emojis -- --replace mage    re-upload just these names
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

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const replaceOnly = new Set(args.filter((a) => a !== "--replace"));

const rest = new REST().setToken(token);

async function main() {
  const files = (await readdir(EMOJI_DIR)).filter((f) => path.extname(f).toLowerCase() in MIME_TYPES);
  const { items } = (await rest.get(Routes.applicationEmojis(clientId!))) as RESTGetAPIApplicationEmojisResult;
  const existing = new Map(items.map((e) => [e.name, e]));

  let uploaded = 0;
  for (const file of files) {
    const { name, ext } = path.parse(file);
    const current = existing.get(name);
    const shouldReplace = replace && (replaceOnly.size === 0 || replaceOnly.has(name));
    if (current && !shouldReplace) continue;

    if (current?.id) await rest.delete(Routes.applicationEmoji(clientId!, current.id));
    const data = await readFile(path.join(EMOJI_DIR, file));
    const image = `data:${MIME_TYPES[ext.toLowerCase()]};base64,${data.toString("base64")}`;
    await rest.post(Routes.applicationEmojis(clientId!), { body: { name, image } });
    console.log(`${current ? "Replaced" : "Uploaded"} :${name}:`);
    uploaded++;
  }

  console.log(`${uploaded} emoji(s) uploaded; ${files.length - uploaded} already up to date.`);
}

main().catch((err) => {
  console.error("Failed to deploy emojis:", err);
  process.exit(1);
});
