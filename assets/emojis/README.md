# Application emojis

`npm run deploy-emojis` makes the bot's application emojis match this folder.
Each image is uploaded under its file name plus 8 hex characters of its hash
(`warrior.jpg` → `:warrior_1a2b3c4d:`), and the bot looks emojis up by the part
before the hash. So a changed image gets a new name and is uploaded on the next
run, and the old version, along with any emoji whose image was deleted, is
removed. Every container start runs it (staging and production); run it
yourself only for local dev, then restart the bot, which loads emojis at
startup. Staging and local dev share the dev bot's emojis, so running it from a
branch with different images swaps them for staging too.

Application emojis belong to the bot, so they work in any server without using
server emoji slots, and the dev and production apps each have their own set.

Discord limits: 2–32 characters of letters, digits and `_` for the name
(file names up to 23, leaving room for the hash), and 256 KB per image. Square
128×128 PNGs work best.

Class icons (from Wowhead's CDN, `classicon_<class>.jpg`): `warrior` `paladin`
`hunter` `rogue` `priest` `shaman` `mage` `warlock` `druid`. A missing one just
shows no icon. Raid types use Unicode 🛡️ and ⚔️; `healer` is an original green
plus, because Unicode ➕ is too dark on Discord's dark theme (➕ is its fallback).

Schedule status (from the schedule-post design handoff): `dot_green`
`dot_yellow` `dot_red` `dot_grey` (raid and role status) and `seg_green`
`seg_red` (the 10-segment attendance bar). Fallbacks: 🟢 🟡 🔴 ⚪ 🟩 🟥.
Discord draws every custom emoji at the same size, so the dots are drawn at
about half the canvas with transparent padding to sit smaller than the text.
`dot_lg_*` are the same dots at 75%, for each raid's own status.

Roster markers: `mark_tank` (an original flat shield) and `mark_healer` (the
healer plus), both at 65% with padding so they sit smaller than the names they
mark. Fallbacks: 🛡️ and the healer icon.
