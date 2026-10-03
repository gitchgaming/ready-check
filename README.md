# ready-check

Discord bot for WoW raid scheduling and one-click attendance call-outs.

Set a recurring raid schedule tied to a Discord role (attendance is assumed
**required** by default for everyone with that role). Each raid team gets one
fixed, auto-updating schedule message with a card per upcoming raid and a
button per date to toggle your own call-out. `/raid-calendar` gives anyone a
private, scrollable view of the full past/future timeline, and `/callout`
lets you call out for a specific future date without touching any buttons.

## Access

- **Server owner** — always has full access. Runs `/access officer-role:<role>`
  once to designate the officer role.
- **Officer role** — can create and edit raid teams (`/raid-setup`,
  `/raid-slot add|remove`) and call out on behalf of other raiders
  (`/callout user:<member>`).
- **Raider role** (a team's own role) — read-only everywhere except calling
  out for themselves, via the schedule message's buttons or `/callout`.
- Everyone can read: `/raid-status`, `/raid-calendar`, `/raid-slot list`.
- `/raid-cancel role:<role> date:<date>` (officers only) cancels an upcoming
  raid. It stays on the schedule with a 🚫 Cancelled status in place of the
  attendance count, and its call-outs are hidden. Nobody can call out for it.
- `/raid-uncancel role:<role> date:<date>` (officers only) restores a cancelled
  raid. Everything comes back as it was, including any call-outs.
- `/raid-extra role:<role> when:<YYYY-MM-DD HH:MM>` (officers only) adds a
  one-off raid in the team's timezone. Adding one at the time of a cancelled
  raid restores that raid.
- `/raid-publish role:<role>` (officers only) reposts a team's schedule message
  in the channel where it's run, removing the old one if it still exists. Use
  it if the schedule message was deleted.
- `/raid-roster role:<role>` (officers only) posts an auto-updating roster for
  that team in the channel where it's run. It refreshes when members gain or
  lose the role, join, or leave (batched a few seconds apart), and again every
  hour as a safety net. Running it again moves the roster to the new channel
  and removes the old message.

## How it works

- `/raid-setup` (Administrators only) — binds a role + channel + timezone as
  a "raid team". The role is the only required option and also the team's
  identifier (one team per role), so re-running this later to tweak a
  setting — `raids-shown`, the channel, the timezone, the name — only needs
  `role` plus whichever field you're changing; anything left out keeps its
  current value. `channel` and `timezone` are required only the first time,
  since a new team can't exist without them. `raids-shown` (1–10, default 3)
  sets how many upcoming raids the message displays at once — **3 is the
  sweet spot**: Discord caps inline embed cards at 3 per row (not
  configurable by the bot), so 3 is the largest count guaranteed to render
  as a single tidy row. Anything higher wraps to extra rows.
- `/raid-slot add|remove|list` (Administrators only) — manages the weekly
  recurring raid times for a team, e.g. Tuesday 20:00 and Thursday 20:00
  (times can differ per day — each instance keeps its own start time).
- The bot maintains **one public message per team**, edited in place as time
  passes — it always shows the next `raids-shown` upcoming raids as cards
  (date, time, who's called out), each with a date button below. Clicking a
  date toggles *your* call-out for that raid; nothing to click means you're
  in. Since a button's label/color is shared by everyone who sees the
  message, personal feedback comes back as an ephemeral reply rather than
  the button changing. **This message never scrolls** — it's a fixed, shared
  view, so one person can't change what everyone else sees.
- `/raid-calendar` — anyone can run this for a private, scrollable view of a
  team's full timeline (past and future), with its own ← Earlier / Later →
  buttons. Since it's ephemeral, only the person who ran it sees it or can
  page it — it never affects the public message or other viewers. The bot
  keeps at least 12 future raids generated per team so there's always
  several pages to page forward into. Officers can use it to review history;
  raiders can use it to call out further ahead than the public message
  currently shows.
- `/callout date:<date>` — call out for a future raid without touching any
  buttons. The only argument is the date: the bot works out which raid team(s)
  you're on from your Discord roles, and the autocomplete lists only those
  teams' upcoming raids (each labeled with its team name).
- `/callin date:<date>` — the reverse: mark yourself back in for a raid you
  previously called out for. Same date picker.
- `/callout-for user:<member> date:<date>` and `/callin-for user:<member>
  date:<date>` — officers only. Same as above, but for another raider. The
  date picker shows that raider's raids.
- Call-outs only count while the raider still holds the team's role. If
  someone loses the role, their past call-outs stay in the database for
  audit but no longer show on the schedule message, `/raid-status`, or the
  calendar. Schedule messages refresh when members gain or lose roles, join,
  or leave.
- A raid instance closes (drops into history) a few hours after its start
  time, the next time the bot re-syncs (hourly by default).
- `/raid-status` — a quick ephemeral list of upcoming raids and call-outs,
  independent of everything above.

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
