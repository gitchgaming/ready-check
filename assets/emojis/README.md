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

Class icons, one flat two-tone shape per class in its official class color
(fill) with a darker edge of the same hue (the fill at 66%): `warrior` (axe,
`#C69B6D`), `paladin` (hammer, `#F48CBA`), `hunter` (bow, `#AAD372`), `rogue`
(crossed daggers, `#FFF468`), `priest` (sun, `#FFFFFF`, edge `#8E99AE`),
`shaman` (lightning, `#0070DD`), `mage` (wizard hat, `#3FC7EB`), `warlock`
(skull, `#8788EE`), `druid` (paw, `#FF7C0A`). A missing one just shows the
class name.

Raid types are one flat two-tone set in pale shades, kept clear of the class
colors (Mage and Shaman are blue, Warlock is lavender): `tank` (an ice-blue
shield, fill `#D6EBFF`, edge `#5F8FBF`), `healer` (a pale lilac plus, fill
`#ECE4FF`, edge `#8F78D6`) and `dps` (a steel sword, fill `#DBE1EA`, edge
`#66758C`). Fallbacks: 🛡️ ➕ ⚔️. Keep them off green, yellow, red and grey:
those are the status colors.

The SVG sources for the class, role and marker icons are in
`assets/icon-src/`; edit one there and render it to a 128×128 PNG here.

Schedule status (from the schedule-post design handoff): `dot_green`
`dot_yellow` `dot_red` `dot_grey` (raid and role status) and `seg_green`
`seg_red` (the 10-segment attendance bar). Fallbacks: 🟢 🟡 🔴 ⚪ 🟩 🟥.
Discord draws every custom emoji at the same size, so the dots are drawn at
about half the canvas with transparent padding to sit smaller than the text.
`dot_lg_*` are the same dots at 75%, for each raid's own status.

Role markers, beside names: `mark_tank`, `mark_healer` and `mark_dps`, the
role icons at 65% with transparent padding so they sit smaller than the names
they mark. Off-spec markers, beside damage mains in the roster: `mark_offtank`
and `mark_offheal`, outlines of the shield (`#7FA9D4`) and plus (`#A895E0`)
with no fill. Fallbacks: the type's icon, and 🛡️ ➕.
