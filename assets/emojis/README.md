# Application emojis

`npm run deploy-emojis` uploads every image here as an application emoji named
after the file (`warrior.png` → `:warrior:`), skipping names the bot's
application already has. Application emojis belong to the bot, so they work in
any server without using server emoji slots. Dev and production are separate
applications: run the script locally for the dev bot; production runs it on
container start. Restart the bot afterwards so it picks up new emojis.

Discord limits: 2–32 characters of letters, digits and `_` for the name, and
256 KB per image. Square 128×128 PNGs work best.

To replace images after changing them, run
`npm run deploy-emojis -- --replace` (all) or `-- --replace mage druid` (some).

Class icons (from Wowhead's CDN, `classicon_<class>.jpg`): `warrior` `paladin`
`hunter` `rogue` `priest` `shaman` `mage` `warlock` `druid`. A missing one just
shows no icon. Raid types use Unicode 🛡️ and ⚔️; `healer` is an original green
plus, because Unicode ➕ is too dark on Discord's dark theme (➕ is its fallback).
