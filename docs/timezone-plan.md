# Plan: fixed team time, clearly labelled

> **Status (2026-10-06): agreed, not started.** Builds on the test suite from
> #7. Merge that first: this plan relies on its snapshots and wording tests to
> catch every changed string. One PR, with commits in the order at the end.
> Remove this file once it's merged, along with its entry in CLAUDE.md →
> Pending work.

## Context

Raids are stored as exact moments (`RaidInstance.startsAt`, UTC). Each team
also has a timezone (`RaidTeam.timezone`, IANA name), the team's reference
zone, called **team time** below. It's needed for three things:

1. **Weekly nights.** A night (`RaidSlot`) is a wall-clock rule, "Tuesday 8:00
   PM", generated in team time so raids stay at 8 PM local across daylight
   saving and land on the right weekday.
2. **Plain text.** Discord renders `<t:…>` timestamps in each viewer's own zone,
   but only in message text. Autocomplete choices and select-menu options are
   plain text, so dates there have to be written in one zone. Discord never
   tells a bot a user's timezone.
3. **What officers type.** `raid add`'s date and time, and `nights add`'s time,
   are read in team time.

Officers and raiders can live in different zones. Today several messages print
team time as plain text with no zone, so anyone outside it misreads them.
Changing a team's timezone also causes trouble: generated raids keep their old
moments while the sync adds new ones at the new zone's times, so every night
shows twice.

## Decisions

- **Team time is fixed at setup.** `/raidlead team edit` loses its `timezone`
  option. A team set up in the wrong zone is fixed by `team delete` and setting
  it up again (it loses its call-outs, which is acceptable).
- **Anything Discord can convert is converted.** Every date or time in message
  text (schedule post, `/schedule`, `/roster` cards, every reply) is a `<t:…>`
  timestamp, so each viewer sees their own local time.
- **Anything Discord can't convert says its zone.** Plain-text dates (autocomplete
  choices, select options) carry the zone's short name for that moment, e.g.
  `Tue, Oct 6 · 8:00 PM CDT`.
- **What officers type is read in team time, and the reply confirms it both
  ways.** The reply shows team time with its zone, plus a `<t:…>` timestamp the
  officer sees in their own zone. If the two don't match what they meant, the
  mistake is obvious right away.
- **Weekly nights stay in team time**, since a night is a rule, not a moment.
  They're labelled with the zone's generic name ("Central Time"), and wherever
  a night is shown in message text, its next raid is shown as a timestamp too.

## Zone names

Add to `src/lib/time.ts` (or a new `src/lib/zones.ts`), using only Luxon and
`Intl`, no new dependency:

- `zoneAbbrev(date, timezone)`: the short name *at that moment*, which follows
  DST. Luxon `toFormat("ZZZZ")` in `en-US` gives `CDT`/`CST`, `EDT`/`EST`,
  `MST` (Phoenix); outside the US it gives offsets: `GMT+2` (Berlin, summer),
  `GMT+9` (Tokyo). Use this for one raid's moment.
- `zoneGenericName(timezone)`: the DST-neutral name for rules. `Intl.DateTimeFormat`
  with `timeZoneName: "longGeneric"` gives `Central Time`, `Central European
  Time`, `Japan Standard Time`. Use this for nights and "team time" mentions,
  followed by the IANA name where there's room: `Central Time (America/Chicago)`.

Check both outputs in a unit test for a US zone, a European zone and a no-DST
zone (Phoenix or Tokyo), in summer and winter. The exact strings come from the
Node ICU data, so pin the ones the code relies on.

## Changes, by surface

### 1. Message text → timestamps (`src/lib/embeds.ts`, replies)

Today these print team time as plain text with no zone:

| Where | Now | Change to |
|---|---|---|
| Next Up heading, `raidCard` (`embeds.ts` ~line 306) | `## Tue, Oct 6 · 8:00 PM` | `## <t:unix:D>` heading, `<t:unix:t> · <t:unix:R>` below it (check how a timestamp renders in a `##` heading in the test server, and fall back to `<t:unix:F>` if it looks off) |
| Coming Up lines (`comingUpContainer`, ~lines 360, 369) | `**Tue, Oct 6** 8:00 PM` | `**<t:unix:D>** <t:unix:t>` |
| Cancelled Coming Up line | `🚫 **Tue, Oct 6** · Cancelled` | `🚫 **<t:unix:D>** · Cancelled` |
| `setAttendance` replies (`attendance.ts` ~line 125) | `…called out for Tue, Oct 6 · 8:00 PM` | `…for <t:unix:F>` |
| Date button reply (`attendanceControls.ts` ~line 99) | `You're out for Tue, Oct 6` | `You're out for <t:unix:F>` |
| `raid add/cancel/restore/remove` replies (`raid.ts` ~lines 35, 73, 126) | `formatRaidLabel(...)` (+ `(America/Chicago)` on add) | see 3 below for `add`; `<t:unix:F>` for the rest |

The personal schedule's day blocks already use timestamps (`dayBlocks`), so
they don't change.

Add one helper (e.g. `discordTime(date, style)` in `embeds.ts` or `time.ts`) so
the `Math.floor(getTime() / 1000)` conversion lives in one place.

Text budget: `<t:1791334800:D>` is 16 characters against the ~10 of `Tue, Oct
6`. The limit tests from #7 (`discordLimits.test.ts`) must still pass at
`MAX_PUBLIC_DAYS`; if they don't, the roster truncates a little sooner, which
is fine.

### 2. Plain text → zone label (`src/lib/pickers.ts`, `embeds.ts`)

- `formatRaidLabel(date, timezone)` appends `zoneAbbrev`: `Tue, Oct 6 · 8:00 PM
  CDT`. It's used by every raid date picker (`/callout`, `/raidlead callout`
  and `attend`, `raid cancel/restore/remove`, `/roster`'s date picker) and the
  personal schedule's select labels, so one change covers them. Callers that
  put it in message text switch to timestamps (section 1) instead.
- `formatNight` (nights picker, `nights remove` and `list`) gains the zone: a
  new `formatNight(dayOfWeek, hour, minute, timezone)` → `Tuesday 8:00 PM
  Central Time`. In the picker, keep it ≤ 100 characters.
- `raid add`'s date picker (`upcomingDateChoices` / `dateChoice`) lists calendar
  days, which have no time, so no zone is needed there. Its first choice, or
  the option description, should say dates are in team time (see 3).
- Choice and option labels stay ≤ 100 characters. Extend the label-length checks
  in `discordLimits.test.ts` to cover the longest zone names.

### 3. Officer input (`src/commands/raidlead/{index,raid,nights}.ts`)

- **Option descriptions** are the same for every server, so they can only say
  "in the team's timezone". `raid add`'s `date` and `time`, and `nights add`'s
  `time`, say so.
- **Make the `time` options autocomplete** (`raid add`, `nights add`). As the
  officer types, show what it will mean: `20:00` → one choice `8:00 PM Central
  Time (America/Chicago)`, value `20:00`. If it can't be parsed, show one choice
  `Type a 24-hour time, e.g. 20:00` with value `NO_CHOICE`, and `execute`
  rejects it as today. The `role` option is read raw during autocomplete
  (`options.get("role")?.value`; see CLAUDE.md Gotchas). If no team is picked
  yet, say `Pick a team first`.
- **Confirmation replies** show both:
  - `raid add`: `✅ Added a raid on Tue, Oct 6 · 8:00 PM CDT (team time) — <t:unix:F> for you.`
  - `nights add`: `✅ Added Tuesdays 8:00 PM Central Time (America/Chicago) as a weekly raid night. Next: <t:unix:F>.`
  - `nights list`: each night with its next raid as `<t:unix:F>`, plus the zone
    once at the bottom (as today).
- **DST edge cases** for typed times, worth a test each: a time that doesn't
  exist (2:30 AM on spring-forward day; Luxon moves it forward an hour) and one
  that happens twice (1:30 AM on fall-back day). The confirmation's timestamp
  shows what was saved; for the first case, consider rejecting it with a
  message saying that time doesn't exist that day in team time.

### 4. Make the timezone permanent (`src/commands/raidlead/{index,team}.ts`)

- Remove the `timezone` option from `team edit` and its handling in
  `team.ts` → `edit` (`invalidTimezone` stays for `setup`). The edit reply
  still lists the timezone, as a read-only line.
- `team setup`'s option description becomes "The team's timezone (permanent)".
  Its reply says it clearly: `Team time: Central Time (America/Chicago) — it's
  7:14 PM there now. This can't be changed later.` The current time there lets
  the officer catch a wrong pick right away.
- Registered commands change, so `npm run deploy-commands` is needed (the
  production container runs it on boot; locally, run it once).
- No schema change: `RaidTeam.timezone` stays.

### 5. Docs

- README: `team edit` loses `[timezone:]`; `setup` notes it's permanent; the
  `nights add` line and the Notes bullet on timezones explain team time and the
  labels.
- CLAUDE.md → Decisions to keep: replace "Dates shown to users must be formatted
  in the team's timezone (or Discord `<t:...>` timestamps)" with: team time is
  fixed at setup; message text uses `<t:…>`; plain text (choices, select
  options) always carries a zone label; officer input is read in team time and
  confirmed both ways.
- Remove this file and its Pending work entry.

## Tests (the suite from #7)

- Update the snapshots in `test/unit/__snapshots__/scheduleMessage.test.ts.snap`
  deliberately (`npx vitest run -u`) and review the diff: only the date strings
  should change.
- Unit: `zoneAbbrev` / `zoneGenericName` (above); `formatRaidLabel` and
  `formatNight` with zones; the public message's heading and Coming Up lines
  hold timestamps for the right moments and no zone-less plain dates. A useful
  guard: no text in any V2 payload matches a bare `\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d`
  pattern unless a zone label follows.
- Limits: label lengths with the longest zone names; text budget at
  `MAX_PUBLIC_DAYS` with timestamps.
- Integration: `team edit` has no timezone option (its `data.toJSON()`) and still
  edits the rest; `team setup` reply wording; `raid add` / `nights add`
  confirmations show team time plus a timestamp of the right moment; `time`
  autocomplete (valid, invalid, no team); DST-gap and repeated-hour times; every
  reply that used `formatRaidLabel` now has a timestamp.

## Order (one commit per step)

1. Zone helpers + tests.
2. Message text → timestamps (embeds and replies), snapshots updated.
3. Plain-text labels with zones (pickers, nights, select), limit tests extended.
4. Officer input: descriptions, `time` autocomplete, confirmations, DST cases.
5. Remove `team edit timezone:`; setup wording.
6. Docs (README, CLAUDE.md), remove this plan.

## Verification

- `npx tsc --noEmit`, `npx tsc -p test`, `npm test` all clean.
- In the test server (`npm run dev`, which means stopping staging first; see
  CLAUDE.md), with the Discord client set to a zone different from the team's:
  the schedule post, `/schedule` and replies show local times; pickers and the
  personal select show team time with a zone label; `raid add` and `nights add`
  confirmations match.
- `npm run deploy-commands`, then check `/raidlead team edit` no longer offers
  `timezone`.
