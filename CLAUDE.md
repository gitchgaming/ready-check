# ready-check

Discord bot for WoW raid attendance. A raid team is a Discord role; everyone with
the role is assumed to attend every raid unless they call out. See README.md for
the user-facing command reference.

## Stack and commands

TypeScript (ESM, NodeNext) + discord.js v14 + Prisma 5 on SQLite + Luxon.

- `npm run dev` — run the bot with `tsx watch`
- `npx tsc --noEmit` — type-check; run before every commit
- `npx prisma migrate dev --name <change>` — after any schema change; commit the
  new folder under `prisma/migrations/` (production applies them on boot)
- `npm run deploy-commands` — re-register slash commands after any change to a
  command's name, options, or descriptions. Uses `DISCORD_GUILD_ID` if set
  (instant, one guild), otherwise global.
- `npm run clear-global-commands` — remove stale global registrations

## Layout

- `src/commands/` — `callout`, `attend`, `schedule` (raider), and
  `raidlead/` (officer): `index.ts` builds the command and routes by
  "group sub" key; `team.ts`, `nights.ts`, `raid.ts` hold the handlers.
- `src/interactions/` — button handlers. Button state lives in the customId:
  `attendance:<id>[:cal:<offset>]`, `mynav:<dir>:<teamId>:<offset>`,
  `teamdelete:<confirm|abort>:<teamId>`.
- `src/lib/` — `scheduler.ts` (instance generation, hourly sync, schedule
  message render), `embeds.ts`, `roster.ts`, `attendance.ts`, `pickers.ts`
  (all autocomplete), `access.ts`.

## Decisions to keep

- Officers = guild owner or anyone with Manage Events. `/raidlead` uses that as
  its default member permission so Discord hides it from raiders; handlers and
  buttons re-check with `isOfficer` because admins can override visibility.
- Raider commands take only a date. The team comes from the user's roles.
- Discord can't personalize a shared message, so the public schedule message
  never pages or shows per-viewer state. Personal views (`/schedule`) are
  ephemeral and carry their state in customIds.
- Default `displayCount` is 3: Discord caps inline embed fields at 3 per row.
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
  rosters and schedule messages.

## Gotchas

- Prisma resolves a relative SQLite `file:` URL against `prisma/`, so `.env`
  uses `DATABASE_URL="file:./dev.db"` (→ `prisma/dev.db`). If a
  `prisma/prisma/dev.db` appears, a stale `DATABASE_URL` env var is overriding
  `.env` (dotenv never overrides existing vars). Check `echo $DATABASE_URL`.
- In discord.js 14.16+, `isTextBased()` includes group DMs, which have no
  `send`; also check `"send" in channel` before sending.
- During autocomplete, read other options as raw values
  (`options.get("role")?.value`); only the focused option is fully resolved.

## Pending: production hosting (Railway)

Agreed plan, not yet done:
1. Move `prisma` from devDependencies to dependencies (runtime stage runs
   `npm ci --omit=dev` but needs the CLI for `postinstall` and `migrate deploy`).
2. Add `RUN apk add --no-cache openssl` to both Dockerfile stages (Prisma's
   engine needs it on Alpine).
3. Register commands on container start, after migrations
   (`node dist/deploy-commands.js`).
4. Production uses a separate Discord application from the dev bot, so the
   same token never runs in two places.
5. Railway: deploy from GitHub, volume at `/data`, `DATABASE_URL=file:/data/prod.db`,
   production `DISCORD_TOKEN`/`DISCORD_CLIENT_ID`/`DISCORD_GUILD_ID`, one instance.
6. Open question for the user: deploy from `main`, or from a `production` branch.
