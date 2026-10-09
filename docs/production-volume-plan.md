# Plan: give production a volume

> **Status (2026-10-09): not started.** Production has no volume, so
> `/data/prod.db` lives on the container's disk and a release, restart or crash
> wipes it. Don't release until this is done. Delete this file afterwards and
> fix the CLAUDE.md hosting line and Pending work entry.

Attaching a volume redeploys the service, which itself wipes the current
database. So either accept losing it (path A) or copy it out first and put it
back afterwards (path B).

## Decide: is the data worth copying?

Check what's set up in the raid guild: one schedule post per team, each
team's nights (`/raidlead nights list`), one-off raids, cancellations, and
call-outs people have made.

- **A few teams and nights, call-outs you can live without** → path A. Five
  minutes, nothing to go wrong.
- **More than that, or call-outs that matter** → path B.

## Path A: start fresh

1. Railway → production → **+ Create → Volume**, attach to `ready-check`,
   mount path `/data`. It redeploys with an empty database.
2. Logs: `Logged in as ready-check#2607`, migrations applied, no errors.
3. An officer re-creates each team (`/raidlead team setup`), its nights
   (`/raidlead nights add`) and any one-off raids or cancellations. The bot
   posts a new schedule message; delete the old one (it no longer updates).
4. `railway restart` and check the teams survive it (proves the volume works).

## Path B: copy the database out and back

`railway ssh` needs `railway login` and an SSH client, so this runs **from
your own machine**, not a Claude cloud session (no SSH client there, and
project tokens can't register SSH keys). On macOS, use `base64 -D` where this
says `base64 -d` if your version is old.

The production database uses the default rollback journal (one file, no
`-wal`), so `prod.db` alone is the whole database. Do it at a quiet time:
anything written between step 1 and step 4 is lost.

**Rehearse on staging first** (`railway environment staging`, and
`staging.db` in place of `prod.db`): it tests every step below with nothing
at stake. Note anything that differs and fix this file.

### 1. Snapshot (inside the container)

```bash
railway environment production
railway ssh -s ready-check          # interactive shell in the container
```
In that shell:
```sh
cd /app
node -e 'const D=require("better-sqlite3");const db=new D("/data/prod.db",{readonly:true});db.backup("/tmp/snap.db").then(()=>{console.log(db.prepare("SELECT count(*) n FROM RaidTeam").get());db.close()})'
sha256sum /tmp/snap.db; ls -l /tmp/snap.db
exit
```
`backup` takes a consistent copy even while the bot is running. Note the team
count and the hash.

### 2. Copy it to your machine

```bash
railway ssh -s ready-check -- base64 /tmp/snap.db > snap.b64
tr -d '\r' < snap.b64 | base64 -d > prod-snapshot.db
shasum -a 256 prod-snapshot.db      # must match the hash from step 1
```
If the hashes differ, look at `snap.b64` for extra lines (a login banner) and
strip them. Keep `prod-snapshot.db` somewhere safe: it is the only copy.

### 3. Attach the volume

Railway → production → **+ Create → Volume**, attach to `ready-check`, mount
path `/data`. The redeploy starts on an empty database (the bot has no teams,
so it posts nothing). Wait for `Logged in as ready-check#2607`.

### 4. Put the snapshot back

Upload the file to the volume. Try stdin first:
```bash
railway ssh -s ready-check -- 'base64 -d > /data/prod.db.restore' < snap.b64
```
If that hangs or leaves an empty file, `railway ssh` isn't forwarding stdin:
open an interactive shell (`railway ssh -s ready-check`), run
`cat > /tmp/snap.b64`, paste the contents of `snap.b64`, press Ctrl-D, then
`base64 -d /tmp/snap.b64 > /data/prod.db.restore`.

Then, in the container:
```sh
sha256sum /data/prod.db.restore     # must match step 1
cd /app && node -e 'const D=require("better-sqlite3");const db=new D("/data/prod.db.restore",{readonly:true});console.log(db.pragma("integrity_check",{simple:true}),db.prepare("SELECT count(*) n FROM RaidTeam").get())'
mv /data/prod.db.restore /data/prod.db
exit
```
Then `railway restart` so the bot opens the restored file.

### 5. Check

- Logs: `Logged in as ready-check#2607`, `No pending migrations to apply`.
- Discord: the existing schedule posts update again (same message IDs, so no
  new posts) and call-outs are still there.
- `railway restart` once more and check nothing is lost (the volume works).
- Later: turn on volume backups (the volume's **Backups** tab) if the plan
  offers them.
