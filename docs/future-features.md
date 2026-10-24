# Future features

Ideas and open questions to pick up later. When one gets built, remove it from
here (git history keeps the record).

## Officer-set raid sizes and role targets

Teams pick a raid size (20 or 25) and get fixed role targets (`roleTargets` in
`src/lib/classes.ts`). Possible later: a `/raidlead` setting for custom role
targets per team, more sizes, and a size per night or per raid for a team
that runs several sizes from one roster.

## Smaller production image

npm 11 counts TypeScript as a production dependency, because Prisma lists it as
an optional peer. That puts about 27 MB of TypeScript compiler binaries in the
production image, unused. Trim it, e.g. with an extra prune step, once Docker
builds can be tested (first Railway deploy).

## Database export and import

An officer-only `/raidlead export` that sends the team's data (or the whole
database) as a private file, and a matching import. It would give on-demand
backups without SSH and a way to move a team to another server. It can't
help a bot whose data is about to be lost to a redeploy: the command only
exists after a deploy.

## Registered characters

Per-team names (`/name`, `/raidlead name`) are the first step. The design
discussed (2026-10-24) keeps Discord roles as the default and lets a raider or
officer optionally override each field: class, role (Tank/Healer/Damage),
spec (which can imply the role) and off-specs, stored per person and falling
back to Discord where unset. Later, alts: several characters per person, a
main per team, and an optional "bringing" character per raid, with attendance
still per person. Open questions: whether a profile beats a Discord role when
they disagree, and whether the bot should also hand out matching roles.
