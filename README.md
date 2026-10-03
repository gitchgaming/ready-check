# ready-check

Discord bot for WoW raid scheduling and one-click attendance call-outs.

Set a recurring raid schedule tied to a Discord role (attendance is assumed
**required** by default for everyone with that role). Each raid team gets one
persistent, auto-updating schedule message with a card per upcoming raid and
a button per date to toggle your own call-out. Raid leaders run
`/raid-status` for a quick ephemeral summary any time.

## How it works

- `/raid-setup` (Administrators only) — binds a role + channel + timezone as
  a "raid team". That team's schedule message posts and lives in that channel.
- `/raid-slot add|remove|list` (Administrators only) — manages the weekly
  recurring raid times for a team, e.g. Tuesday 20:00 and Thursday 20:00
  (times can differ per day — each instance keeps its own start time).
- The bot maintains **one message per team**, edited in place as time passes
  — it always shows the next 3 upcoming raids as cards (date, time, and
  who's called out), each with a date button below. Clicking a date toggles
  *your* call-out for that raid; nothing to click means you're in. Since a
  button's label/color is shared by everyone who sees the message, personal
  feedback comes back as an ephemeral reply rather than the button changing.
- **← Earlier / Later →** page the same 3-card window back and forth through
  the team's full raid timeline. Paging into the past shows closed, read-only
  raids (who missed what, no buttons — audit only); paging into the future
  shows further-out raids, still fully actionable. The bot keeps the next 12
  raids generated per team at all times, so you can page up to 4 windows
  into the future (longer for a team with fewer than 2 raids/week, since it's
  12 raids, not 12 weeks).
- Paging is shared, not personal — like the call-out buttons, the window
  position lives on the one message, so if someone pages forward to call out
  for a raid two months out, everyone sees that window until someone pages
  it back.
- A raid instance closes (drops into history) a few hours after its start
  time, the next time the bot re-syncs (hourly by default).
- `/raid-status` — a quick ephemeral list of upcoming raids and call-outs,
  independent of the persistent message and always showing the true next 3
  regardless of where the shared window is currently paged to.

## Development (GitHub Codespaces)

This repo has a `.devcontainer` so Codespaces gives you Node 20 + everything
needed, with no local setup.

1. On GitHub: **Code → Codespaces → Create codespace on main**.
2. Once it opens, copy the env template: `cp .env.example .env` and fill in
   `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` (see below) and, optionally,
   `DISCORD_GUILD_ID` for instant command updates in your test server.
3. First time only — create the database and its migration files:
   ```bash
   npx prisma migrate dev --name init
   ```
   This creates `prisma/migrations/`, which **must be committed** — production
   uses it to set up its own database.
4. Register slash commands: `npm run deploy-commands`
5. Run the bot: `npm run dev`

## Creating the Discord application

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → Reset Token, copy it into `.env` as `DISCORD_TOKEN`. Turn on
   the **Server Members Intent** (the bot needs it to check role membership).
3. **OAuth2 → General** → copy the **Client ID** into `.env` as
   `DISCORD_CLIENT_ID`.
4. **OAuth2 → URL Generator** → scopes: `bot` and `applications.commands`.
   Bot permissions: `Send Messages`, `Embed Links`, `Read Message History`.
   Open the generated URL to invite the bot to your server.

## Deploying (Railway)

1. New Railway project → **Deploy from GitHub repo** → pick this repo. It
   will build from the `Dockerfile` automatically.
2. Add a **volume**, mounted at `/data`.
3. Set environment variables: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and
   `DATABASE_URL=file:/data/prod.db`. Leave `DISCORD_GUILD_ID` unset so
   commands register globally.
4. Deploy. The container runs `prisma migrate deploy` on boot, applying the
   committed migrations to the fresh database automatically.
5. Run `npm run deploy-commands` once from Codespaces (pointed at production
   `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` via a temporary `.env`) to register the
   slash commands globally — this only needs to be re-run when commands change.

## Notes

- Everything lives in SQLite — fine at this scale (single guild, a
  few hundred interactions a week at most).
- Timezones are per raid team (set in `/raid-setup`), so a team's raid times
  stay correct across daylight saving changes.
