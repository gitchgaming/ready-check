# ready-check

Discord bot for WoW raid scheduling and one-click attendance call-outs.

Each raid team is a Discord role. Everyone with the role is assumed to be
attending every raid unless they call out. The bot keeps one auto-updating
schedule message per team, with a card for each upcoming raid and a date
button to toggle your own call-out.

## Who can do what

- **Raiders** (anyone with a team's role) see three commands and the
  schedule message's buttons. They can only change their own attendance.
- **Officers** are the server owner and anyone with Discord's **Manage
  Events** permission. Give that permission to your officer role. Officers
  also see `/raidlead`, which is hidden from everyone else. Server admins can
  adjust who sees it under Server Settings → Integrations → ready-check.

## Raider commands

All dates are picked from a list of your team's actual raids.

- `/callout date:` — call out for a raid.
- `/attend date:` — undo a call-out.
- `/schedule` — a private, scrollable view of your team's raids, past and
  future, with the same call-out buttons. Only you see it, so paging it
  doesn't affect anyone else. The optional `team:` picker is only needed if
  you're on more than one raid team (or are an officer viewing another team).

## Officer commands (`/raidlead`)

Every subcommand takes the team's `role:` first.

**`team`** — create and manage raid teams
- `setup channel: timezone: [name:] [raids-shown:]` — create a team and post
  its roster and schedule message in `channel`. The name defaults to the
  role's name.
- `edit [channel:] [timezone:] [name:] [raids-shown:]` — change settings.
  Changing the channel moves the schedule message.
- `publish` — post the schedule message in the current channel, replacing
  the old one. Use it if the message was deleted.
- `roster` — post an auto-updating roster in the current channel.

**`nights`** — weekly recurring raid nights
- `add day: time:` — e.g. Wednesday, `20:00`. Times are 24-hour, in the
  team's timezone.
- `remove night:` — pick from the team's existing nights. Raids already on
  the schedule stay.
- `list`

**`raid`** — change individual raids
- `cancel date:` — the raid stays on the schedule as 🚫 Cancelled, with its
  call-outs hidden and no date button.
- `restore date:` — undo a cancel. Call-outs come back as they were.
- `add date: time:` — a one-off raid outside the weekly nights.

**On behalf of a raider**
- `callout user: date:` and `attend user: date:`

## How it works

- The schedule message shows the next `raids-shown` raids (default 3). Discord
  caps embed cards at 3 per row, so 3 is the largest count that fits on one
  row. The message never scrolls, since paging it would change it for everyone.
- Each card shows an attendance count (🟢 everyone in, 🟡 some out, 🔴 more
  than half out) and who called out.
- Call-outs only count while the raider still holds the team's role. Records
  are kept for people who lose the role, but they no longer show.
- The schedule message and roster refresh when members gain or lose roles,
  join, or leave, and hourly as a safety net.
- A raid moves into history a few hours after its start time.

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

If old or duplicate commands linger in Discord after a reload, they may have
been registered globally at some point. `npm run clear-global-commands` lists
and removes all global commands. Production uses global commands, so if your
test and production bots share one Discord application, run
`npm run deploy-commands` without `DISCORD_GUILD_ID` afterward to restore them.

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
- Timezones are per raid team (set in `/raidlead team setup`), so a team's raid times
  stay correct across daylight saving changes.
