# Plan: staging environment

> **Status (2026-10-06): repo side done, Railway side not started.** The guard
> (`npm run check-staging`), docs and CLAUDE.md rules merged in #5. The user
> still has to create the Railway environment and its token (steps 1–2 below);
> Claude verifies after (step 3). Remove this file once staging is live and
> verified, and drop its entry from `docs/future-features.md`.

## Context

Production deploys only on a release (`production` branch). Nothing runs `main`
between releases, so merged changes are first seen live in the raid guild.
Goal: a staging bot in the private test server that deploys every commit to
`main`, so changes can be tested as they land, before a release.

## Decisions

- **Staging is the dev bot.** It runs the existing dev Discord app
  (`ready-check#7940`), already confined to the test server, instead of a third
  app. One developer, so the simpler setup wins.
- **Staging and local dev take turns.** They share the dev bot's token, and
  Discord silently accepts two connections with one token: both copies would
  answer every interaction (double replies, "interaction failed", duplicate
  posts) and both would run the hourly sync. So only one runs at a time:
  - `npm run dev` runs `npm run check-staging` first and refuses to start while
    staging is up (running, building, or waiting on CI). It needs
    `RAILWAY_STAGING_TOKEN`; without it, it only warns. `SKIP_STAGING_CHECK=1`
    bypasses it.
  - Stop staging with `railway down` in the staging environment (or remove its
    active deployment in the dashboard); bring it back with `railway redeploy`.
- **Claude's rules** (in CLAUDE.md): a request to run dev is permission to stop
  staging, check, stop if up, then start the local bot, and offer to redeploy
  staging afterwards. Before merging a PR into `main`, stop the local bot if it
  ran that session, because the merge redeploys staging. Every other Railway
  change, in either environment, still needs the user's OK.
- **Wait for CI** on staging too, so a red `main` commit never deploys.

## Steps

### 1. Railway staging environment (user, dashboard)
- In the **Ready Check** project, create an environment named `staging`
  (copying the `ready-check` service from production is fine).
- Service → Settings → Source: branch `main`, **Wait for CI** on.
- A volume mounted at `/data` (its own; never production's).
- Variables (replace any copied from production):
  - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`: the dev bot's, as in your local `.env`
  - `DISCORD_GUILD_ID`: the test server's ID (instant command updates)
  - `DATABASE_URL`: `file:/data/staging.db`
- No code changes: the container already migrates, registers commands, uploads
  emojis and starts the bot on boot.

### 2. Staging token (user)
- Create a Railway project token scoped to `staging`.
- Set it as `RAILWAY_STAGING_TOKEN` in your local `.env` and in the Claude Code
  cloud environment's settings.

### 3. Verify (Claude)
- `RAILWAY_TOKEN=$RAILWAY_STAGING_TOKEN railway status`: the service is online
  on `main`'s latest commit; logs show the dev bot logged in and commands
  registered to the test server.
- `npm run check-staging` reports staging up and exits 1.
- With the user's OK: stop staging, confirm `check-staging` reports it stopped
  (the one guard path not yet tested), then redeploy and confirm it's back.
- Smoke test in the test server: set up a team, check the schedule post renders.

### 4. Clean up (Claude)
- Update the CLAUDE.md "Production hosting" section if anything differed from
  the plan, then delete this file and its `future-features.md` entry.

## Things to know

- **Two databases.** Staging (`/data/staging.db`) and local (`prisma/dev.db`)
  each have their own teams. If both post a schedule to the same channel,
  there are two messages and the stopped bot's one goes stale. Use a separate
  channel for local testing to avoid confusion.
- **Slash commands follow whichever copy started last.** Both register to the
  test server on boot; restarting staging restores `main`'s commands.
- **Cost.** A second always-on service adds a little to the Hobby plan's usage.

## Alternatives considered

- **A separate staging Discord app.** No coordination, at the cost of a third
  app to manage. Switch to this if the stop/start routine becomes a nuisance.
- **No staging** (test locally, treat `main` as the release candidate). What we
  had; it leaves merged changes untested until a release.
