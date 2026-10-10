# ready-check

Discord bot for WoW raid scheduling and one-click attendance call-outs.

Each raid team is a Discord role. Everyone with the role is assumed to be
attending every raid unless they call out. The bot keeps one auto-updating
schedule message per team: the next raid up top with its full roster, then
the following raids, each with a **Status ⇄** button to toggle your own
call-out. Its **See more dates** menu opens your full schedule privately, for
calling out further ahead.

## Who can do what

- **Raiders** (anyone with a team's role) see three commands and the
  schedule message's Status buttons. They can only change their own attendance.
- **Officers** are the server owner and anyone with Discord's **Manage
  Events** permission. Give that permission to your officer role. Officers
  also see `/raidlead`, which is hidden from everyone else. Server admins can
  adjust who sees it under Server Settings → Integrations → ready-check.

## Raider commands

All dates are picked from a list of your team's actual raids.

- `/callout date:` — toggle your attendance for a raid. The picker lists
  every upcoming raid marked ✅ (attending — "Decline") or ❌ (called
  out — "Attend"), so the same command calls out and switches back.
- `/schedule` — a private, scrollable view of your team's raids, past and
  future. Its date menu lists every upcoming raid with your own status
  (✅ attending / ❌ called out), so you can toggle any date without paging.
  Only you see it, so paging it doesn't affect anyone else. The optional `team:` picker is only needed if
  you're on more than one raid team (or are an officer viewing another team).
- `/roster [date:]` — read-only, only you see it. With a date: that raid's
  card, like the schedule's Next Up (attendance bar, role counts, everyone
  attending in Tanks / Healers / Damage sections, who's called out), without a
  Status button. Without a date: the whole roster split into Tanks / Healers /
  Damage columns with class icons. Types and classes come from roles named
  `Tanks`, `Healers`, `Damage` (or `DPS`, `Wizards`/`Wizard`, `Phys`/`Physical`),
  and `Warriors`, `Mages`, etc.; a raider with several type roles counts once,
  as Tank, then Healer, then Damage. `Offtank` and `Offheals` mark a damage
  main's off-spec (a raider with only one of those counts as Damage).

## Officer commands (`/raidlead`)

Every subcommand takes the team's `role:` first.

**`team`** — create and manage raid teams
- `setup channel: timezone: [name:] [coming-up:]` — create a team and post
  its schedule message in `channel`. The name defaults to the
  role's name.
- `edit [channel:] [timezone:] [name:] [coming-up:]` — change settings.
  Changing the channel moves the schedule message.
- `publish` — post the schedule message in the current channel, replacing
  the old one. Use it if the message was deleted.
- `delete` — permanently delete the team after a confirmation: its weekly
  nights, raids, call-outs, and its schedule message. The Discord
  role is left alone.

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
- `add date: time:` — a one-off raid outside the weekly nights. The picker
  offers the next few weeks, or type any date up to two years out, like
  `3/15/2027`, `Mar 15 2027`, or `2027-03-15`, and pick it from the list.
- `remove date:` — delete a one-off raid entirely, along with its call-outs.
  Only one-off raids are listed. Raids on weekly nights would be recreated by
  the next sync, so use `cancel` for those.

**On behalf of a raider**
- `callout user: date:` and `attend user: date:`

## How it works

- The schedule message shows the next raid, then `coming-up` more raids
  (default 3, at most 8). It never scrolls, since paging it would change it for everyone.
  - **Next Up**: the next raid, with a 10-segment attendance bar, role counts
    by icon (🛡️ tanks, ➕ healers, ⚔️ damage) with an off-spec key under them,
    everyone attending in Tanks / Healers / Damage sections (one line per
    class, each name a chip; off-tanks and off-healers marked in Damage), and
    who's out, each with their role. Its accent color is the raid's status.
  - **Coming Up**: one line per later raid with its count, then its role counts.
  - Role counts are kept short enough to fit on one line on a phone.
  - Raid status (accent bar and the dot before each Coming Up date): 🟢 everyone
    in, 🟡 at least half in, 🔴 fewer. A role gets no dot
    when it's fine — all of that role in, or at least the minimum (Tanks 2,
    Healers 3, Damage 10) — then 🟡 one short, 🔴 more.
- Call-outs only count while the raider still holds the team's role. Records
  are kept for people who lose the role, but they no longer show.
- The schedule message (and the roster in it) refreshes when members gain or lose roles,
  join, or leave, and hourly as a safety net.
- A raid moves into history a few hours after its start time.

## Development (GitHub Codespaces)

This repo has a `.devcontainer` so Codespaces gives you Node 26 + everything
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
5. Run the tests: `npm test` (Vitest; `npm run test:coverage` for coverage).
6. Run the bot: `npm run dev`. It first checks that Railway staging, which
   runs the same dev bot, is stopped (see `docs/releasing.md` → Environments).
   To test a branch on staging instead, `npm run deploy:branch` (see
   `docs/releasing.md` → Testing a branch on staging).

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

Releases are cut by the **Release** GitHub Actions workflow, which tags
`main` and moves the `production` branch that Railway deploys. See
[docs/releasing.md](docs/releasing.md) for the branching model, releases, and
rollbacks. First-time setup:

1. New Railway project → **Deploy from GitHub repo** → pick this repo. It
   will build from the `Dockerfile` automatically.
2. Add a **volume**, mounted at `/data`.
3. Set environment variables: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and
   `DATABASE_URL=file:/data/prod.db`, and `DISCORD_GUILD_ID` set to the raid
   guild so commands register there instantly.
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
