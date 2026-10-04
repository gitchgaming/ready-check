# ready-check

Discord bot for WoW raid attendance. A raid team is a Discord role; everyone with
the role is assumed to attend every raid unless they call out. See README.md for
the user-facing command reference.

## Stack and commands

Node 26 + TypeScript 7 (ESM, NodeNext) + discord.js v14 + Prisma 7 on SQLite
(`better-sqlite3` driver adapter) + Luxon.

- `npm run dev` — run the bot with `tsx watch`
- `npx tsc --noEmit` — type-check; run before every commit
- `npx prisma migrate dev --name <change>` — after any schema change; commit the
  new folder under `prisma/migrations/` (production applies them on boot)
- `npm run deploy-commands` — re-register slash commands after any change to a
  command's name, options, or descriptions. Uses `DISCORD_GUILD_ID` if set
  (instant, one guild), otherwise global.
- `npm run clear-global-commands` — remove stale global registrations
- `npm run deploy-emojis` — upload new images in `assets/emojis/` as
  application emojis (`-- --replace [names]` to re-upload changed ones), then
  restart the bot; it only loads emojis at startup.

## Layout

- `src/commands/` — `callout` (toggles), `schedule`, `roster` (read-only; raider), and
  `raidlead/` (officer): `index.ts` builds the command and routes by
  "group sub" key; `team.ts`, `nights.ts`, `raid.ts` hold the handlers.
- `src/interactions/` — select and button handlers. State lives in the customId:
  `attendance:btn:<teamId>:<raidId>` (public date buttons),
  `attendance:pub:<teamId>` (public "See more dates" select, value `more`),
  `attendance:cal:<teamId>:<offset>` (personal date select, value is a raid id),
  `mynav:<dir>:<teamId>:<offset>`,
  `teamdelete:<confirm|abort>:<teamId>`.
- `src/lib/` — `scheduler.ts` (instance generation, hourly sync, schedule
  message render), `embeds.ts`, `roster.ts`, `attendance.ts`, `pickers.ts`
  (all autocomplete), `access.ts`, `classes.ts` (class/type role names),
  `emojis.ts` (loads application emojis by name).
- `assets/emojis/` — images uploaded as application emojis by `deploy-emojis`.
- `branding/` — the app icon (PNG + SVG); upload it as each Discord app's icon.

## Decisions to keep

- Officers = guild owner or anyone with Manage Events. `/raidlead` uses that as
  its default member permission so Discord hides it from raiders; handlers and
  buttons re-check with `isOfficer` because admins can override visibility.
- Raider commands take only a date. The team comes from the user's roles.
- Discord can't personalize a shared message, so the public schedule message
  never pages or shows per-viewer state. Personal views (`/schedule`) are
  ephemeral and carry their state in customIds. The public message has one
  button per visible date for one-click toggling, plus a select whose only
  option, **See more dates**, opens the personal view. The personal select
  lists every open raid (cap 25) with the viewer's status. Re-rendering the
  public message after each interaction resets its select.
- Class and raid-type roles are matched by role name (`classes.ts`), not
  configured per team. The roster counts each raider once, by type priority
  Tank > Healer > DPS (Wizards and Phys count as DPS).
- Icons are application emojis (owned by the bot, not a server), uploaded from
  `assets/emojis/` by `deploy-emojis` and looked up by name — IDs differ between the
  dev and production apps, so never hard-code them.
- Schedule messages use Components V2. The public one (design 9a) is two
  containers: **Next Up** (next raid: attendance bar, role summary, attending
  roster by class, Called Out block, one Status ⇄ button on its own line;
  accent = raid status) and
  **Coming Up** (one section per later raid with its own button, then the
  "See more dates" select). The personal view is one container, days between
  dividers. V2 caps a message at 40 components and 4,000 text characters, so
  at most `MAX_PUBLIC_DAYS` = 9 raids show: Next Up plus `displayCount` (the
  `coming-up` option, default 3, max `MAX_COMING_UP` = 8) — and class lines
  truncate with "…and N more". V2 text pings mentions, so these messages always
  send `allowedMentions: { parse: [] }`.
- There's no roster post any more: the schedule post shows the next raid's
  roster. `/roster` is read-only and private for everyone: with a date it's that
  raid's card (`buildRaidRosterCard`, Next Up minus the button); without one it's
  the Tanks/Healers/DPS columns embed (`buildRosterEmbed`).
- Role status dots use per-type minimums in `RAID_TYPES` (`min`: Tanks 2,
  Healers 3, DPS 10). These are placeholders: the game has 40/20/10-player
  raids and the real minimums are undecided (see `docs/future-features.md`).
- A cancelled raid stays in the Next Up spot until it closes (a few hours
  after its start), rather than promoting the next raid.
- Attendance rows exist only for call-outs (status "OUT"); attending = no row.
  Call-outs are only displayed/counted for current role holders.
- Raids are generated from weekly nights (`RaidSlot`, called "nights" in the
  UI) and upserted hourly. Never delete a generated raid — the sync recreates
  it. `cancelled` keeps it visible as 🚫 Cancelled; only `oneOff` raids (from
  `/raidlead raid add`) can be hard-deleted with `raid remove`.
- Dates shown to users must be formatted in the team's timezone (or Discord
  `<t:...>` timestamps), never the server clock, which is UTC.
- Every date input is an autocomplete picker. Only `raid add` accepts free-typed
  dates (`parseTypedDate`); pickers for existing raids list real raids only.
- Role membership comes from the member cache (warmed once at startup, kept
  current by member events). Never `guild.members.fetch()` per render — it hits
  Discord's gateway rate limit. Member events trigger a debounced refresh of
  schedule messages.

## Gotchas

- A relative SQLite `file:` URL resolves from the repo root (Prisma 7 CLI and
  the runtime adapter both), so `.env` uses `DATABASE_URL="file:./prisma/dev.db"`.
  If the bot sees an empty database or a stray `dev.db` appears at the root, a
  stale `DATABASE_URL` env var may be overriding `.env` (dotenv never overrides
  existing vars). Check `echo $DATABASE_URL`.
- Prisma 7 generates the client into `src/generated/prisma/` (gitignored;
  `npm install` regenerates it). Import Prisma types from there, not
  `@prisma/client`. The CLI reads `prisma.config.ts`, which loads `.env` itself.
- In discord.js 14.16+, `isTextBased()` includes group DMs, which have no
  `send`; also check `"send" in channel` before sending.
- During autocomplete, read other options as raw values
  (`options.get("role")?.value`); only the focused option is fully resolved.

## Pending work

- `docs/future-features.md`: ideas and open questions to pick up later (role
  minimums per raid size, image size). Add new ones
  there; remove them once built.
- Automated tests: see `docs/testing-plan.md` (agreed plan, not started).

## Production hosting (Railway)

- Railway deploys the `production` branch. Work happens on `main`; release by
  fast-forwarding `production` to `main` and pushing
  (`git push origin main:production`). Only release when the user asks.
- The container runs `prisma migrate deploy`, then `deploy-commands`, then
  `deploy-emojis`, then the bot. A failed command registration stops boot
  (Railway retries); a failed emoji upload only logs, since icons are cosmetic.
- Production is a separate Discord application from the dev bot, so the same
  token never runs in two places and neither clobbers the other's commands.
  The dev bot lives only in a private test server; keep it out of the raid guild.
- Live since 2026-10-04 as `ready-check#2607` (production app; the dev bot is
  `ready-check#7940`). Railway: Hobby plan, Dockerfile build, volume at
  `/data`, `DATABASE_URL=file:/data/prod.db`, one replica, no public domain.
- Production leaves `DISCORD_GUILD_ID` unset, so commands register globally
  (the bot may serve a second server). Dev sets it for instant updates.
- Railway's **Wait for CI** is off until a GitHub Actions workflow exists
  (see `docs/testing-plan.md`); turn it on then.
