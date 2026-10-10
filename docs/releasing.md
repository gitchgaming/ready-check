# Branching and releases

ready-check uses **trunk-based development** (GitHub Flow) with **tagged,
semantically versioned releases**. There is no `develop` branch.

```
feature branch ──(npm run deploy:branch, ad hoc)──▶ staging bot, branch lane
      │
      └──PR──▶ main ──(auto)──▶ staging bot, main lane (test server)
                 │
                 └─ Release workflow: tag vX.Y.Z ──▶ production ──▶ Railway (raid guild)
```

## The manual flow, start to finish

1. **Try the branch on staging.** Stop the local bot if it's running, then
   `npm run deploy:branch`. Wait for the bot's status to read
   `🧪 <branch> @ <commit>` and test in the test server
   ([details](#testing-a-branch-on-staging)).
2. **Put staging back on main.** Merging the PR does it; if you abandon the
   branch, run `npm run deploy:staging`. Either way, wait for the status to
   read `🌿 main @ <commit>`.
3. **Check main on staging.** Once the merge is live there, give it a quick
   look in the test server. This is the code a release ships.
4. **Release to production** following [Releasing](#releasing): the checks
   before, the workflow, then the checks after.

## Branches

| Branch | What it is | Who moves it |
| --- | --- | --- |
| `main` | The trunk. Always type-checks and always deployable. Deploys to staging. | PR merges |
| short-lived branches (`feat/…`, `fix/…`, `claude/…`) | One change each, merged within days. | You |
| `production` | A pointer to the release that is live. Never committed to. | The Release and Rollback workflows only |

Every change goes through a pull request into `main`. CI (`.github/workflows/ci.yml`)
runs `prisma validate` and `tsc --noEmit` on the PR. Squash-merge so each PR is
one commit on `main`; the PR title becomes the commit message and the release note.

## Environments

- **Staging** — a Railway environment that tracks `main`, so every merge is live
  in the private test server within minutes. It runs the dev Discord app
  (`ready-check#7940`) with `DISCORD_GUILD_ID` set to the test server, and its
  own volume (`DATABASE_URL=file:/data/staging.db`, `DEPLOY_LANES=1`).
  Staging also takes ad hoc **branch deploys** (below).
- **Local** — `npm run dev` with the same dev app. A bot token must run in
  only one place, or both copies answer every interaction, so stop staging
  first (`npm run stop-staging`) and bring it back when you're done
  (`npm run deploy:staging`). `npm run dev` runs `npm run check-staging` first
  and refuses to start while staging is up. A merge to `main` redeploys
  staging, so stop the local bot before merging.
- **Production** — the Railway environment that tracks `production`, in the raid
  guild. Only a release changes it.

The staging scripts need `RAILWAY_STAGING_TOKEN` (a Railway project token for
staging) in `.env` or the environment; `check-staging` only warns without it
(`SKIP_STAGING_CHECK=1` bypasses it). `STAGING_SERVICE` overrides the service
name if it isn't `ready-check`.

### Testing a branch on staging

Staging is one Railway service that runs in one of two **lanes**, and a
service has one active deployment, so the lanes can never run at once:

| Lane | Deployed by | Database |
| --- | --- | --- |
| main | a merge to `main`, or `npm run deploy:staging` | `/data/staging.db` |
| branch | `npm run deploy:branch` (any working tree, uncommitted changes included) | `/data/dev.db`, a fresh copy of `staging.db` |

1. On your branch, `npm run deploy:branch`. It type-checks, runs the tests
   (`-- --skip-checks` skips them; `railway up` bypasses Wait for CI), then
   uploads the tree. The bot's status shows `🧪 <branch> @ <commit>` once it's
   live (`🌿 main @ <commit>` on the main lane).
2. Test in the test server. The branch starts from staging's teams and nights,
   and edits the same schedule posts, since it's the same Discord app.
3. Fix and redeploy as often as needed. Each new deploy recopies `staging.db`,
   so test data from the previous deploy is gone; a restart of the same
   deploy keeps it.
4. Merge the PR (the merge puts staging back on main), or abandon the branch
   and run `npm run deploy:staging`.

Branch migrations only ever run on the copy, so editing or squashing them
mid-branch is safe, and `staging.db` only sees migrations that reached `main`.
If `staging.db` has a migration the branch lacks (the branch is behind
`main`), the branch lane starts with an empty database; merge `main` in to test
with staging's data. Changes made on the branch lane (call-outs, new teams) are
discarded when main comes back, and main re-renders the schedule posts.

How the container picks the lane (`src/lib/lanes.ts`, run by `docker-start.sh`
before migrations): `deploy:branch` uploads a `deploy-info.json` marker; the
main lane needs a GitHub deploy of `main` (`RAILWAY_GIT_BRANCH=main`) and no
marker, and anything else runs on the copy, so a misdetection can only cost
test data. Production doesn't set `DEPLOY_LANES` and always uses its
`DATABASE_URL`.

Local `npm run dev` keeps its own `prisma/dev.db`, so a team set up there
doesn't exist on staging. If both post a schedule to the same channel, the
stopped bot's post goes stale, so use a separate channel for local testing.
Slash commands follow whichever copy started last (each registers to the
test server on boot); `npm run deploy:staging` restores `main`'s.

If the stop/start routine between staging and local dev becomes a nuisance,
the alternative is a separate staging Discord app, at the cost of a third app
to manage.

## Releasing

### Before you run it

1. See what will ship: `git fetch --tags && git log --oneline $(git describe
   --tags --abbrev=0 origin/main)..origin/main` (on the first release, all of
   `main`).
2. Check for migrations: `git diff --stat <last tag>..origin/main --
   prisma/migrations`. Migrations run on boot against `/data/prod.db` and
   don't roll back.
3. If there are migrations, or you're unsure, take a backup first
   ([Copy the database out](#database-backup-and-restore)). It's the only way
   back from a migration that goes wrong. A release with no migrations
   doesn't touch the schema, and the volume keeps the data across the
   redeploy either way.
4. Pick a quiet time: with a volume attached, Railway stops the old
   container before starting the new one, so the bot is briefly offline and
   buttons pressed then fail.

### Run it

Actions → **Release** → Run workflow (from `main`), pick `patch`, `minor`, or
`major`, or type an exact version. The workflow:

1. Re-runs CI on the exact `main` commit.
2. Works out the next version from the latest `v*` tag and refuses if there's
   nothing new, the tag exists, or `production` has commits that aren't on `main`.
3. Tags the commit `vX.Y.Z` and fast-forwards `production` to it. Railway
   deploys `production`.
4. Publishes a GitHub Release with notes generated from the merged PRs.

### After it finishes

1. Watch the deploy: Railway → production → Deployments, or
   `railway logs -s ready-check` (the cloud session's `RAILWAY_TOKEN` is the
   production project token). Boot logs show `prisma migrate deploy`
   applying any migrations, `Registered N commands globally`, then
   `Logged in as ready-check#2607`. A failed command registration makes
   Railway retry the boot.
2. In the raid guild, check the schedule post looks right and a call-out
   button still toggles (press it twice to undo).
3. If something's wrong, [roll back](#rolling-back); if a migration damaged
   data, [put the backup back](#database-backup-and-restore).

Version numbers ([SemVer](https://semver.org)) for a bot:

- **major** — something raiders or officers must relearn: a command removed or
  renamed, a breaking data change.
- **minor** — new commands, options, or features.
- **patch** — fixes and visual tweaks.

Git tags are the source of truth for the version; `package.json`'s `version`
isn't bumped.

## Hotfixes

Fix forward: PR the fix into `main`, merge, run Release with `patch`. If `main`
has unreleased work you don't want to ship yet, either ship it with the fix or
revert it on `main` first. Long-lived release branches aren't worth it for one
deployed app.

## Rolling back

Actions → **Rollback** → enter an earlier tag (e.g. `v1.2.0`). It points
`production` back at that tag and Railway redeploys. Railway's own **Redeploy**
on an earlier deployment also works for a quick revert, but leaves
`production` out of step with what's running, so prefer the workflow.

Migrations don't roll back. Before rolling back past a release that added a
migration, check that the older code works with the newer schema.

## Database backup and restore

Each environment's SQLite database is one file on its Railway volume
(`/data/prod.db`, `/data/staging.db`; the default rollback journal, so no
`-wal` file). These commands worked when production moved onto its volume
(2026-10-10). They run on your machine with `railway login`, an SSH key
registered with `railway ssh keys add`, and the folder linked with
`railway link` to the right environment; Claude cloud sessions can't use
`railway ssh`.

**Copy the database out.** In a shell in the container
(`railway ssh -s ready-check`):
```sh
cd /app
node -e 'const D=require("better-sqlite3");const db=new D("/data/prod.db",{readonly:true});db.backup("/tmp/snap.db").then(()=>db.close())'
sha256sum /tmp/snap.db
```
`backup` takes a consistent copy while the bot runs. Then, on your machine:
```bash
railway ssh -s ready-check -- base64 /tmp/snap.db > snap.b64
tr -d '\r' < snap.b64 | base64 -d > prod-snapshot.db
shasum -a 256 prod-snapshot.db   # must match
```

**Put one back.** Upload it next to the live file, swap it in, restart:
```bash
railway volume files -v <volume name> upload prod-snapshot.db /prod.db.restore
railway ssh -s ready-check     # then: sha256sum /data/prod.db.restore
                               #       mv /data/prod.db.restore /data/prod.db
railway restart -s ready-check
```
Volume paths are relative to the volume (`/prod.db.restore` lands at
`/data/prod.db.restore`). The bot keeps the old file open until the restart,
so anything written between the `mv` and the restart is lost.

## GitHub and Railway settings

Set these once in the web UIs (they aren't stored in the repo):

- **GitHub → Settings → Rules → Rulesets**, for `main`: require a pull request
  and the `check` status check (from CI); block force pushes and deletion. For
  `production`: block deletion.
- **GitHub → Settings → Actions → General → Workflow permissions**: leave the
  default (read-only). The Release and Rollback jobs request
  `contents: write` themselves to push the tag and `production`.
- **GitHub → Settings → General → Pull Requests**: allow squash merging only,
  and turn on "Automatically delete head branches".
- **Railway → production service → Settings**: branch `production`, **Wait for
  CI** on.
- **Railway → staging environment**: branch `main`, **Wait for CI** on, a volume
  at `/data`, and the dev app's `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`,
  `DISCORD_GUILD_ID` = the test server, `DATABASE_URL=file:/data/staging.db`,
  `DEPLOY_LANES=1`. Create a project token for it and set it as `RAILWAY_STAGING_TOKEN` in your
  `.env` and in the Claude Code cloud environment.
