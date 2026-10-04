# Future features

Ideas and open questions to pick up later. When one gets built, remove it from
here (git history keeps the record).

## Role minimums per raid size

The schedule post's role status dots compare each role's attendance against a
minimum (`min` in `RAID_TYPES`, `src/lib/classes.ts`). Today they're placeholders
from the design handoff: Tanks 2, Healers 3, DPS 10.

This version of the game has 40-, 20- and 10-player raids, and the right
minimums and makeup for each aren't known yet. Likely direction: configurable
minimums, per team or per raid size, set by officers instead of hard-coded.
Open questions:
- Is raid size a property of the team, of a weekly night, or of each raid?
- Should minimums be per role only, or per class too?

## Roster printout for a specific date

Replace the auto-updating roster post (`/raidlead team roster`) with an
on-demand command that privately sends a roster for one raid date: who's in
and who's out, grouped by class and role, ready for a raid leader to work from.

- Open to everyone, not only officers.
- Probably an ephemeral reply or a DM. Decide which when building it.
- Once it exists, decide whether to retire the roster post. The schedule post
  already shows the next raid's roster.

## Smaller production image

npm 11 counts TypeScript as a production dependency, because Prisma lists it as
an optional peer. That puts about 27 MB of TypeScript compiler binaries in the
production image, unused. Trim it, e.g. with an extra prune step, once Docker
builds can be tested (first Railway deploy).

## Automated tests

See `docs/testing-plan.md`: agreed plan, not started.
