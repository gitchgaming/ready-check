# Branching and releases

ready-check uses **trunk-based development** (GitHub Flow) with **tagged,
semantically versioned releases**. There is no `develop` branch.

```
feature branch ──PR──▶ main ──(auto)──▶ staging bot (test server)
                         │
                         └─ Release workflow: tag vX.Y.Z ──▶ production ──▶ Railway (raid guild)
```

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

- **Local** — `npm run dev` with your own dev Discord app, in the private test server.
- **Staging** — a Railway environment that tracks `main`, so every merge is live
  in the test server within minutes. It needs its own Discord application
  (a bot token can only run in one place, so it can't share the local dev
  bot's), its own volume, and `DISCORD_GUILD_ID` set to the test server.
- **Production** — the Railway environment that tracks `production`, in the raid
  guild. Only a release changes it.

Staging is optional: without it, test locally before merging and treat `main`
as the release candidate.

## Releasing

Actions → **Release** → Run workflow (from `main`), pick `patch`, `minor`, or
`major`, or type an exact version. The workflow:

1. Re-runs CI on the exact `main` commit.
2. Works out the next version from the latest `v*` tag and refuses if there's
   nothing new, the tag exists, or `production` has commits that aren't on `main`.
3. Tags the commit `vX.Y.Z` and fast-forwards `production` to it. Railway
   deploys `production`.
4. Publishes a GitHub Release with notes generated from the merged PRs.

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

## GitHub and Railway settings

Set these once in the web UIs (they aren't stored in the repo):

- **GitHub → Settings → Rules → Rulesets**, for `main`: require a pull request
  and the `check` status check (from CI); block force pushes and deletion. For
  `production`: block deletion.
- **GitHub → Settings → Actions → General → Workflow permissions**: Read and
  write (the Release workflow pushes the tag and `production`).
- **GitHub → Settings → General → Pull Requests**: allow squash merging only,
  and turn on "Automatically delete head branches".
- **Railway → production service → Settings**: branch `production`, **Wait for
  CI** on.
- **Railway → staging environment** (optional): branch `main`, Wait for CI on,
  its own variables and volume.
