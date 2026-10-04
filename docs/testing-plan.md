# Plan: automated test suite

> **Status (2026-10-04): not started.** Agreed with the user, then deferred. The
> plan below assumes Vitest; adding it as a devDependency hasn't been approved
> yet, so confirm the runner with the user before installing (Node's built-in
> `node:test` via `tsx` is the no-new-dependency alternative). Follow the commit
> order at the end, one commit per step.


## Context
Everything so far has been verified by hand in the Discord test server. That's right
for look and feel, but behavior has regressed silently along the way (e.g. Discord
rejecting an over-limit message with "Invalid Form Body", a half-edited reload).
Goal: an automated suite that pins down the bot's behavior — attendance rules, raid
generation, paging, roster grouping, and Discord's hard limits — runs locally with
`npm test`, runs on every push in GitHub Actions, and gates Railway production
deploys. Manual Discord testing stays for visual review only.

## Approach

### Tooling
- **Vitest** (devDependency): native ESM + TypeScript, resolves our NodeNext `./x.js`
  imports to `.ts`, built-in mocks and fake clock. No ts-jest/babel setup.
- `vitest.config.ts`: `test.env.DATABASE_URL = "file:./prisma/test.db"` (gitignored by
  `prisma/*.db`), `fileParallelism: false` (one shared SQLite
  file), `globalSetup` that runs `prisma migrate reset --force --skip-seed` once.
- Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
- Fake clock: `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` —
  Luxon's `DateTime.now()` follows it; only `Date` is faked so Prisma's timers work.

### Test helpers (`test/`)
- `test/db.ts` — `resetDb()` (deleteMany Attendance → RaidInstance → RaidSlot →
  RaidTeam) called in `beforeEach`; factories `makeTeam()`, `makeRaid()`,
  `callOut()` using the real `prisma` from `src/lib/db.ts`.
- `test/discord.ts` — minimal fakes built on discord.js `Collection`, cast with
  `as unknown as …`:
  - `fakeGuild({ roles, members })` (members with `roles.cache`, `displayName`,
    `user.bot`; `members.fetch(id)` resolving from the cache; `memberCount`).
  - `fakeClient(guild)` (`guilds.fetch`, `channels.fetch` → fake channel that records
    `send`/`messages.fetch().edit`; `application.emojis.fetch`).
  - `fakeChatInput({ user, guild, options })`, `fakeButton(customId)`,
    `fakeSelect(customId, values)` — record `reply`/`update` payloads for assertions.

### Small refactors for testability (no behavior change)
- `src/lib/scheduler.ts`: export `nextOccurrence`/`nextOccurrences` (currently private).
- `src/index.ts`: move the `InteractionCreate` routing into
  `src/interactions/router.ts` (`routeInteraction(interaction, client)`) so routing by
  customId prefix is testable without logging in. `index.ts` keeps only client setup.
- Reuse as-is: `buildPublicMessage`/`buildCalendarMessage` (`src/lib/embeds.ts`),
  `buildRosterEmbed` (`src/lib/roster.ts`), `memberClass`/`memberRaidType`
  (`src/lib/classes.ts`), `parseTypedDate`/`formatRaidLabel`/`upcomingDateChoices`
  (`src/lib/pickers.ts`), `parseHourMinute` (`src/lib/time.ts`), `loadAppEmojis`
  (`src/lib/emojis.ts`, seeded via `fakeClient`).

### Layer 1 — pure unit tests (fast, no DB)
- `time.test.ts`: `parseHourMinute` valid/invalid (`24:00`, `7:5`, spaces).
- `pickers.test.ts`: `parseTypedDate` formats, yearless dates rolling to next year,
  past/too-far rejected; `upcomingDateChoices` count and timezone; `formatRaidLabel`
  in team timezone (never server UTC).
- `recurrence.test.ts`: `nextOccurrence(s)` — same-day before/after start, week wrap,
  and **DST** (America/Chicago Nov 1 2026: raids stay 8:00 PM local across the change).
- `classes.test.ts`: role-name matching (case, singular), Tank > Healer > DPS
  priority, Wizards/Phys → DPS, no class → undefined.
- `roster.test.ts` (`buildRosterEmbed`): counts per column sum to roster size,
  class grouping then alphabetical, class emoji vs no-emoji, healer emoji fallback
  `➕`, "No type role" line, `…and N more` truncation keeps fields ≤ 1024 chars,
  empty roster text.
- `scheduleMessage.test.ts` (`buildPublicMessage`/`buildCalendarMessage`, asserting on
  `.toJSON()`): attendance count + 🟢🟡🔴 thresholds, only current roster members'
  call-outs counted, NEXT RAID above the first open day and outside its section,
  buttons only on open non-cancelled days with `attendance:btn:<team>:<raid>`,
  "See more dates" select, personal select ✅/❌ per viewer and cancelled/closed
  excluded, nav buttons disabled at the ends, `allowedMentions.parse` empty,
  ephemeral flag via `asEphemeral`. One **snapshot** each of the public and personal
  message for layout regressions (update intentionally with `vitest -u`).

### Layer 2 — Discord limits (regression for "Invalid Form Body")
- `discordLimits.test.ts`:
  - every slash command `data.toJSON()` builds; names/descriptions/choices within
    Discord limits (description ≤ 100, ≤ 25 options, etc.).
  - public message at `MAX_PUBLIC_DAYS` with the NEXT RAID label stays ≤ 40
    components (count nested); `MAX_PUBLIC_DAYS + 1` would exceed it — so a future
    layout change that breaks the budget fails here, not in production.
  - personal select ≤ 25 options; labels ≤ 100, customIds ≤ 100 chars;
    `coming-up` option max equals `MAX_COMING_UP` (`MAX_PUBLIC_DAYS` − 1).

### Layer 3 — integration with a real SQLite DB
- `scheduler.test.ts`: `syncRaidTeam` creates 12 future raids, is idempotent, merges
  multiple nights in order, closes raids 3h after start, never deletes, keeps
  `cancelled`; `nextOpenInstances`; `instancesForWindow`/`clampOffset` paging across
  closed/open boundaries and ends; `renderTeamMessage` edits a V2 message in place
  and replaces a non-V2 one once (fake channel records it).
- `attendance.test.ts`: `setAttendance` TOGGLE flips, OUT/IN "already" replies,
  closed/cancelled/non-roster/wrong-guild rejections, on-behalf wording;
  `raidDateAutocomplete` `✅ … — Decline` / `❌ … — Attend` labels, IN lists only
  call-outs, multi-team budget split.
- `attendanceControls.test.ts`: date button toggles + confirmation; "See more dates"
  replies with an ephemeral personal schedule; personal select toggles and `update`s
  in place; rejections; public message re-rendered for `btn`/`pub` only.
- `raidCommands.test.ts`: `raid add` (typed date, past time, collision, restores a
  cancelled raid), `cancel`/`restore` state rules, `remove` only for one-offs;
  `nights add` triggers generation.
- `router.test.ts`: customId prefixes reach the right handler; unknown ids ignored;
  handler errors produce the "Something went wrong" reply.

### CI and deploy gate
- `.github/workflows/ci.yml` on push and PR: Node 26, `npm ci` (its postinstall runs `prisma generate`),
  `npx tsc --noEmit`, `npm test`.
- Railway (user, in dashboard when setting up the service): enable **Wait for CI**
  on the `production` deploy so it only deploys commits whose checks passed.
- CLAUDE.md: add `npm test` to commands ("run with tsc before every commit"), a
  short Testing section (layers, fakes, `vitest -u` for intended snapshot changes),
  and the Railway Wait-for-CI step to the user's to-do list.

### Order (one commit per step, per commit-as-you-go)
1. Vitest + config + `test/` helpers + Layer 1 + Layer 2 (no refactors needed beyond
   exporting `nextOccurrence(s)`).
2. Layer 3 DB integration tests.
3. Router extraction + router tests.
4. CI workflow + CLAUDE.md/README updates.
Bugs the tests uncover get fixed in their own commits, called out to the user.

## Verification
- `npm test` passes locally; `npx tsc --noEmit` clean.
- Sanity-check the suite catches breakage: temporarily set `MAX_PUBLIC_DAYS = 7`
  (limits test fails), flip the TOGGLE logic (attendance tests fail), revert.
- `npm run dev` still boots and the schedule/roster render in the test server
  (router refactor must not change behavior).
- Push to `main`; the GitHub Actions run goes green on the commit.
