# ready-check

Discord bot for WoW raid scheduling and one-click attendance call-outs.

Each raid team is a Discord role. Everyone with the role is assumed to be
attending every raid unless they call out. The bot keeps one auto-updating
schedule message per team: the next raid up top with its full roster, then
the following raids, each with a **Status ⇄** button to toggle your own
call-out. Its menu opens your full schedule privately (**See more dates**), for
calling out further ahead or seeing any raid's roster.

## Who can do what

- **Raiders** (anyone with a team's role) see three commands and the
  schedule message's Status buttons. They can only change their own attendance,
  and everything the commands show is private to them.
- **Officers** are the server owner and anyone with Discord's **Manage
  Events** permission. Give that permission to your officer role. Officers
  also see `/raidlead`, which is hidden from everyone else. Server admins can
  adjust who sees it under Server Settings → Integrations → ready-check.

## Raider commands

All dates are picked from a list of your team's actual raids.

- `/attendance [date:] [team:]` — only you see it. Without a date: how many upcoming
  raids you're in for on each of your teams, and every raid you're called out
  of (shown like Coming Up) with a **Back in** button. With a date: toggles
  you for that raid and shows the same view under a ✅/❌ confirmation. The
  picker lists every upcoming raid in the schedule menu's words (✅ "You're
  in. Pick to call out" / ❌ "You're called out. Pick to switch back in"), so
  the same command calls out and switches back. The optional `team:` picker
  narrows the view and the date picker to one team; it's only needed if
  you're on more than one.
- `/schedule [team:]` — a private, pageable view of your team's raids, past
  and future, three at a time (**← Earlier** / **Later →**). Each raid shows
  like the schedule message's Coming Up (status dot, date, attendance, role
  counts), plus whether you're in and who's called out, with a **Roster**
  button that privately shows that raid's roster card (as `/roster` with that
  date does). Its date menu lists every upcoming raid with your own status
  (✅ in / ❌ called out), so you can toggle any date without paging; the
  view then shows the same ✅/❌ confirmation on top, with **Undo**. Only you
  see it, so paging it doesn't affect anyone else. The schedule message's
  **See more dates** opens the same view. The optional `team:` picker is only
  needed if you're on more than one raid team, or are an officer viewing
  another team (view-only, without the date menu; officers get their own team
  by default).
- `/roster [date:] [team:]` — read-only, only you see it. With a date: that raid's
  card, like the schedule's Next Up (attendance bar, role counts, everyone
  attending in Tanks / Healers / Damage sections, who's called out), without a
  Status button. Without a date: the team's whole roster, laid out like Next Up's
  (role counts, then Tanks / Healers / Damage sections). The optional
  `team:` picker is only needed if you're on more than one raid team (or are an
  officer viewing another team); it also narrows the date picker, which lists
  every upcoming raid with its attendance (cancelled ones aren't listed). Types and classes come from roles named
  `Tanks`, `Healers`, `Damage` (or `DPS`, `Wizards`/`Wizard`, `Phys`/`Physical`),
  and `Warriors`, `Mages`, etc.; a raider with several type roles counts once,
  as Tank, then Healer, then Damage. `Offtank` and `Offheals` mark a damage
  main's off-spec (a raider with only one of those counts as Damage). On the
  schedule and in `/roster`, a raider with no type role counts as Damage, and one with no class
  role is listed at the end of their section without an icon.
- `/timezone [zone:]` — only you see it. Sets your timezone, so the raid times
  in pickers and dropdowns show in it (dates in messages already follow your
  device). Without a zone it shows your current one; pick **Use each team's
  timezone** to clear it. The reply says what time it is there now, so a wrong
  pick is easy to spot. It applies on every server and team.
- `/howitworks` — only you see it. A short guide to the bot: you're in unless
  you call out, what the schedule post's buttons do, and every raider command.
  The schedule post's **How it works** menu, under Next Up's Status button,
  shows the same guide.

## Officer commands (`/raidlead`)

Every subcommand takes the team's `role:` first.

**`team`** — create and manage raid teams
- `setup channel: timezone: [name:] [coming-up:] [size:]` — create a team and post
  its schedule message in `channel`. The name defaults to the
  role's name; `size` is the raid size, 20 or 25 players (default 25).
- `edit [channel:] [timezone:] [name:] [coming-up:] [size:]` — change settings.
  Changing the channel moves the schedule message.
- `publish` — post the schedule message in the current channel, replacing
  the old one. Use it if the message was deleted.
- `final-raid date:` — end the team after this day (in team time): raids
  after it are removed along with their call-outs, and no new raids are
  scheduled past it, so the weekly nights stop. Past raids and their
  attendance stay. The picker lists the days of upcoming raids, or type any
  date like `3/15/2027`. Run it again to move the date; `raid add` refuses
  dates after it.
- `resume` — clear the final raid date, so the weekly nights schedule raids
  again. Call-outs on raids it removed don't come back.
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
  call-outs hidden and no Status button.
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

- Clicking a **Status ⇄** button toggles you for that raid and privately
  confirms it (✅ back in / ❌ out, with the raid's date and time), in the same
  words as `/attendance`. Every attendance change a raider makes (Status, the
  `/schedule` menu, `/attendance date:`, Back in) gets this private
  confirmation with an **Undo** button that switches it straight back, so a
  misclick is one click to fix.
- Every view is labelled with the team's name (or its role's name, for a team
  created without one).
- The schedule message shows the next raid, then `coming-up` more raids
  (default 3, at most 8). It never scrolls, since paging it would change it for everyone.
  - **Next Up**: the next raid, with a 10-segment attendance bar (raiders in
    out of the raid size, in the raid's status color, outlined for open spots), role counts
    by icon (🛡️ tanks, ➕ healers, ⚔️ damage) with an off-spec key under them,
    everyone attending in Tanks / Healers / Damage sections (one line per
    class, each name a chip; off-tanks and off-healers marked in Damage), and
    who's out, by class. Its accent color is the raid's status.
  - **Coming Up**: one line per later raid with its count, then its role counts
    (no role dots; the raid's own dot covers it).
  - Role counts are kept short enough to fit on one line on a phone.
  - Raid status (accent bar, attendance bar and the dot before each Coming Up
    date): 🟢 at least the raid size in, 🟡 one or two short, 🔴 more.
  - Role counts read as in/target. Targets by raid size: Tanks need 2 / want 3,
    Healers need 4 / want 5, and Damage wants the rest (17 in a 25, 12 in a
    20) and needs 2 fewer. Each Next Up role gets a dot: 🟢 at its want, 🟡 at
    its need, 🔴 below.
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
   Bot permissions: `Send Messages`, `Read Message History`.
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
   `DATABASE_URL=file:/data/prod.db`. Leave `DISCORD_GUILD_ID` unset, so
   commands register globally.
4. Deploy. On every boot the container applies the committed migrations
   (`prisma migrate deploy`), registers the slash commands
   (`deploy-commands`) and syncs the icons (`deploy-emojis`) before starting
   the bot, so command changes go live with the deploy.

## Notes

- Everything lives in SQLite — fine at this scale (single guild, a
  few hundred interactions a week at most).
- Timezones are per raid team (set in `/raidlead team setup`), so a team's raid times
  stay correct across daylight saving changes.
- Every date and time in a message is a Discord timestamp, so each person sees
  it in their own timezone. Discord can't do that in pickers and dropdown
  options, and never tells a bot a user's timezone, so those show the time in
  the zone set with `/timezone`, or else the team's, with the zone's short name
  (`Tue, Oct 6 · 8:00 PM CDT`). Weekly nights are labelled with the
  team zone's name (`Central Time`), plus their next raid in yours if you set one.
