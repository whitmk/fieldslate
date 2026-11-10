# When a game moves, everyone who needs to know does — officials and the snack shack

Plan only, 2026-11-10. Nothing built. Reviewed by Whit 2026-11-10 — his
decisions are below and override anything later in this file that disagrees.
Migration number is a placeholder: check `list_migrations` before numbering
(0102 is still reserved; the repo's latest is 0127, so this is probably 0128).

## Decisions (Whit, 2026-11-10)

0. **Now, its own tiny commit:** fix the rainout blog post (lines 9 and 87,
   body AND frontmatter `faq`). Held for review.
1. **The cancelled-game busy rule comes first, its own commit with mutants.**
   ONE rule, in the database's eligibility code; the app calls it — no second
   copy. Lean: a cancelled game does NOT make an official busy. See "Step 1"
   below for what depends on today's behaviour.
2. **Part A approved as planned, plus:**
   - the "taken off this game" email — upcoming games only, combined into the
     same per-official email as moves;
   - `record_game_played` (0106) must NEVER queue an official email, with a
     mutant;
   - "past" is judged AT SEND TIME, in the league's timezone;
   - youth officials route to the parent's email (confirmed below);
   - Resend's limits and what a league-wide rainout does to both outboxes
     (below);
   - the real league's officials contact stays unconfirmed; no writes to it.
   - Resolved from the earlier open list: default ON for every league (gated by
     a confirmed contact); Elite only; the coordinator conflict email IS sent.
3. **Part B: option 2 approved, team-keeping rule (B4) approved.** The
   rebuild-one-day preview must NAME the volunteers who will lose their spot.
   No admin email in v1 (B5 dropped).

## Step 1 — the cancelled-game busy rule (before anything else)

**What the code does today (read 2026-11-10) — the app disagrees with itself:**

| Path | Cancelled game counts as busy? |
|---|---|
| SQL `official_slot_problem` (0124: claims, `insert_official_assignments`) | **No** (`g2.status <> 'cancelled'`) |
| auto-assign bookings (`auto-assign.ts` ~358) | **No** (TS filter). (The ~246 filter is which games to STAFF — a different question; it stays.) |
| Manual save refusal (`findUmpireConflict`, conflicts.ts) | **Yes** — no status in the read |
| Manual picker pre-click flags (`umpire-slots.tsx` via `bookingsFromRows`, rosters from the division panel and game detail modal) | **Yes** — the `booking_rows` embed selects no status |
| Record-where-played's officials notice (`record-played-modal.tsx`) | **Yes** (CLAUDE.md says so deliberately) |

**Does anything depend on "cancelled = busy"?** No sim pins it: no officials
fixture puts an official on a cancelled game and expects a conflict
(`sim:officials`, `sim:umpire-reads`, `sim:record-played`,
`sim:officials-wall-clock` checked). `coach-conflict-sim` pins "cancelled
excluded", but that is the coach-conflict feature, not officials. The change
alters three things people see: a rained-out game stops blocking the manual
save and the picker flag, and record-played's notice stops naming a
rained-out game. **That last one is a judgement call:** record-played is
usually used ON a rained-out game's own officials. Their OTHER rained-out
game that day no longer counts, which is the intent.

**One rule, the database's:**
- New SQL `official_bookings_core(p_umpire_ids uuid[])` (INVOKER, callable by
  no role): each official's games that count as busy — the ONE place the
  status rule lives (not `cancelled`; whether `pending_interleague` counts is
  stated in the function, today it does). `official_slot_problem` re-created
  to gather from it (body otherwise verbatim from 0124).
- New `official_bookings(p_season_id)` (DEFINER, authenticated, member):
  returns `{umpire_id, game_id, start (wall clock), minutes, home, away}` from
  the core function. The app's four readers — `findUmpireConflict`, the two
  roster embeds (division panel, game detail modal), record-played, and
  auto-assign's existing-assignments read — switch to it. `bookingsFromRows`
  keeps the mapping; no TypeScript filter on status anywhere.
- Fence: a source scan (new `sim:official-bookings`, or a section of
  `sim:officials`) fails on any officials file that reads `game_umpires` with
  a `games(` embed for booking purposes, or filters bookings on `status`.
- **Proof** (rolled back in "test"): OB1 a cancelled game is not a booking;
  OB2 a scheduled one is; OB3 `official_slot_problem` and `official_bookings`
  agree row for row; OB4 non-member refused; P1 EXECUTE per role. Mutants:
  MB1 core counts cancelled → OB1; MB2 `official_slot_problem` keeps its own
  inline filter dropped (counts cancelled) → OB3; MB3 `official_bookings`
  bypasses the core → OB3; MB4 grant to anon → P1. App mutants: the TS reader
  re-adds an embed → the scan; a status filter re-added in TS → the scan.
- Re-run `sim:officials` (all three zones), `sim:umpire-reads`,
  `sim:record-played`, `sim:official-claim-rules`, the 0124 proof as
  `regress0124` (its mutants on `official_slot_problem` re-targeted — the
  sql-latest rule), and `sim:mutant-targets`.
- CLAUDE.md: replace the "Open question … bookings on cancelled games still
  count" bullet with the decided rule.

---

## A. Email assigned officials when their game changes

### What's true today (read from the code)

- An assignment is a `game_umpires` row keyed on the game id, so it follows a
  move. Nobody is told. The officials outbox (0124) knows five kinds:
  `help_request`, `claim_confirmed`, `drop_confirmed`, `drop_notice`,
  `claims_digest`. It has NO `coalesce_key`.
- `official_outbox_take` fails every pending row when `official_signup` is off
  for the org, or when the org has no confirmed officials contact email. It
  sends to `btrim(umpires.email)`. For a youth official that field already
  holds the parent's or guardian's address (privacy section 9). The drain
  already refuses a bad address (`bad_recipient`), but nobody sees that
  failure anywhere.
- 0121's `volunteer_on_game_change` is the pattern to copy: an AFTER UPDATE OF
  scheduled_at, venue_id, status row trigger that is SECURITY DEFINER, skips
  past games in league time, swallows failures and records them.
- `official_slot_problem` / `official_block_reason` (0124) are the SQL
  eligibility rule, pinned to `claim-rules.ts` by one shared table.

### Recommendation: its own trigger, not the volunteer one

Add a new trigger, `official_on_game_change`. Do not add officials to
`volunteer_on_game_change`. Four reasons:

1. **The fence.** `sim:volunteer-leaks` U1 says officials code and volunteer
   code never reach each other. A shared function would break that by design.
2. **The early exit.** The volunteer trigger returns as soon as a game has no
   active claims. Most games with umpires have no volunteer claims.
3. **Mutant targets.** Re-creating `volunteer_on_game_change` makes every
   volunteer mutant aimed at 0121/0122 shadowed (the sql-latest rule). We
   would have to re-target them and re-run the proofs for no gain.
4. **Separate failures.** Each feature has its own switch and its own failure
   count.

Postgres fires the two AFTER triggers in name order. They are independent:
neither reads or writes what the other touches.

### The design

**What triggers an email.** The same column set and WHEN clause as the
volunteer trigger: a change to scheduled_at, venue_id or status. The trigger
exits early when the game has no `game_umpires` row. As a cheap first cut it
queues nothing when the old and the new time are both before "now" in the
league's time (`official_org_now`).

**"Past" is decided AT SEND TIME (decided 2026-11-10).** The take drops every
game whose CURRENT start — or, for a removal, its snapshot start — is at or
before `official_org_now` when the row is taken, and supersedes the row when
nothing is left (`all_past`). So a notice held up by the 10-minute hold, a
retry or a quota stop never tells an official about a game that has already
started. The trigger's check is only an early exit; the take's is the rule.

**`record_game_played` never queues an official email (decided).** A time
check can't guarantee it: the played date may be today with a start later
than now, and the original game may also be later today. So 0106's function
is re-created verbatim plus one line before its UPDATE —
`perform set_config('fieldslate.official_notice_skip', 'on', true);` — and
the trigger exits when that transaction-local setting is on. PostgREST runs no
raw SQL, so a browser can't set it; even if something did, it only suppresses
an email. Re-creating 0106 means re-verifying its md5 and re-targeting its
mutants (`record-game-played-sim.sql`, the sql-latest rule). Proof GC12: a
recorded correction later today queues nothing; mutant MG14 (the skip check
removed) dies at GC12.

**One email per official, not one per game. This differs from volunteers on
purpose.** The division panel's bulk rainout changes 3–6 games in one
statement, and an umpire is often on several of them. One email per game
means three emails that each say "rained out". So the trigger UPSERTS one
pending row per official:

- `coalesce_key = 'changes:' || umpire_id`, with a partial unique index on
  (coalesce_key) where status = 'pending'.
- `kind = 'game_changes'`.
- The payload is a map from game_umpire_id to `was`. `was` is the FIRST state
  seen for that assignment in this window: start, venue_id and status, ids
  only. A later change in the same window leaves `was` alone.
- `next_attempt_at = now() + 10 minutes`. The hold soaks up picker fiddling
  and "rain out, then set the makeup" in one sitting. The cron already runs
  every 5 minutes, so the real delay is 10–15 minutes.
- 0125's rule applies: an upsert into a table with a cross-column CHECK must
  propose a row that passes the CHECK on its own. `umpire_id` must be set on
  the proposed row.

**The email describes now against was, worked out when the email is taken.**
`official_outbox_take` is re-created. For a `game_changes` row it:

- reads each game's CURRENT state;
- drops any game whose current state equals `was` (moved and then moved back
  means nothing to say);
- drops any assignment that no longer exists (unassigned, or the game was
  deleted);
- marks the row `superseded` (`no_net_change`) when nothing is left;
- otherwise returns, for each game, `official_game_json` plus `was`.

TypeScript (`src/lib/umpires/change-notice.ts`, pure) picks the wording from
the pair:

| was → now | Line |
|---|---|
| scheduled → cancelled | Rained out |
| cancelled → scheduled, new time | Makeup set |
| cancelled → scheduled, same time | Back on |
| scheduled → scheduled, new time or field | Moved |

All four of the requested cases come out of the pair. Nothing has to be
recorded as an "event", and a rainout followed by a makeup inside the 10
minutes reads as one "Moved" line, which is true.

**Who gets the email.** Every official on the game, with the email address in
`umpires.email`. For a youth official that is the parent's or guardian's
address, and the email is worded to a parent (the 0124 youth flag the take
already returns).

**Youth routing, confirmed 2026-11-10.** There is one email column. The take
sends every official's own email to `btrim(umpires.email)` whatever the
designation; youth changes only the wording. For a youth official the field
is labelled "Parent or guardian email" in both the add form and the edit
form (`PARENT_EMAIL_LABEL`, `add-umpire-button.tsx` and `umpire-list.tsx`,
since 0124 on 2026-11-09). **One gap:** a youth official entered BEFORE
2026-11-09 saw a plain "Email" label, so their row could hold the child's own
address. Read-only check of live data, 2026-11-10: unarchived seasons hold 5
adult officials (2 with email) and 1 youth official (no email), and no
official with an email predates 0124 — so nothing is exposed today. The
Officials page will still show a one-time line for any youth official whose
email predates 0124: "Check that this is a parent's or guardian's email."

**Gates.** All four are checked in the trigger. If any one fails, nothing is
queued; we don't queue rows only to fail them.

1. Elite (officials are Elite).
2. `org_feature_on(owner, 'official_signup')`. This is on by default since 0127
   and is effectively the "officials email" switch.
3. A confirmed officials contact email. It is the reply-to, never an account
   email (0126).
4. A new setting, `official_signup_settings.notify_game_changes`, default true.
   Its card line: "Email officials when their games move or are rained out."

The take keeps its own feature and contact checks as a second line.

**Officials with no email address.** The row is still queued, and the take
fails it with `no_email`. That keeps a record. A new member-only function,
`official_notice_gaps(season)`, returns the recent failed notices
(`no_email`, `bad_recipient`, send failures) with the official's name and the
game. **Recommend yes, the coordinator sees it**, as a banner on
/dashboard/umpires:

> 2 officials weren't emailed about game changes: Sam R. (no email on file),
> Jo P. (the email bounced). Let them know yourself, or add an email on their
> profile.

It shows names on an admin page only. When a gate is off, the same page says
why instead:

> Officials aren't emailed when games change. Confirm an officials contact
> email in Settings to turn this on.

**Failures in the trigger.** A new table, `official_trigger_failures` (game,
trigger name, SQLSTATE; no personal data), with a member-only count. The
count appears on the same banner and in the daily check. We don't reuse the
volunteer table, because of the fence. The trigger never blocks the schedule
edit.

### Does a move re-check the officials? Never unassign; warn

Today nothing re-checks an official after a move. The picker and the manual
move check fields and teams only. Record-where-played is the one surface that
names an official ("already officiating … that day").

**Proposal:** a move never touches `game_umpires`. Any re-check only tells
people.

1. **Every path, after the fact (the important one).** The trigger also runs
   a new helper, `official_move_problem(umpire, game)`. It is
   `official_slot_problem`'s rule minus the slot-taken and on-game steps, and
   it calls the same `official_block_reason`. Only the reasons a move can
   change apply: blackout, overlap with their other games, availability
   window and weekly cap. Division, coach and conflict of interest don't
   change on a move. If it finds a problem, the trigger upserts one held
   coordinator row, `kind = 'assignment_conflicts'`, keyed
   `'conflicts:' || season_id`, sent to the officials contact. The take
   re-checks each entry and drops the ones that are no longer a problem.
   This covers the paths with no admin present, such as a partner league
   accepting a makeup through its token (`accept_reschedule_request_by_token`).
2. **Live banner.** /dashboard/umpires lists every upcoming assignment that
   now has a problem. It is worked out with the shared TypeScript rule
   (`blockReason`), so it is always current, wherever the move came from.
3. **Before saving.** The manual move form and the slot picker add one notice
   when a pick puts an assigned official in two places, or inside a blackout
   or outside their availability. It uses record-played's
   `findConflictInBookings` notice. It never gates Save, the same as every
   other conflict on those forms. This step is optional; it can follow later.
4. **The official's own email says so.** For example: "This new time overlaps
   another game you're assigned to. Santa Rosa American Little League has
   been told." It names nothing about anyone else.

**Watch this when building:** the 0124 SQL bookings gatherer excludes
`cancelled` games. The CLAUDE.md "open question" says the manual and
auto-assign paths count cancelled bookings as busy. The live banner (TS) and
the trigger check (SQL) must agree, or one flags what the other clears. Pick
one rule and pin it in the shared table.

### Email wording (draft)

From: `"Santa Rosa American Little League via FieldSlate" <FieldSlate>`.
Reply-to: the officials contact.

Subject, one game: `Game moved: Sat, Oct 17 — Majors, Expos vs Mets`. The
first word changes with the case: Game moved / Rained out / Makeup set / Back
on. Subject, several games: `3 of your games changed`.

Body, one entry per game:

> Hi Sam,
>
> A game you're assigned to has changed.
>
> **Moved** — Majors · Expos vs Mets · Plate umpire
> Now: Sat, Oct 17 · 3:30 PM · Monroe Complex — Andrews
> Was: Sat, Oct 17 · 1:00 PM · Monroe Complex — Andrews
>
> **Rained out** — Minors · Royals vs Cubs · Base umpire
> Sat, Oct 17 · 9:00 AM · Monroe Complex — Polley
> You're still assigned. If a makeup date is set, we'll email you.
>
> **Makeup set** — … Now: … / Was: rained out Sat, Oct 10 · 1:00 PM
>
> **Back on** — … The rainout was lifted; the game is at its original time.
>
> You're still assigned to these games. If you can't make a new time, reply
> to this email to let Santa Rosa American Little League know.

Youth version: it opens "Hi, this is about Sam's umpire assignments." and
ends "…reply to let the league know if Sam can't make it."

**No link in the email.** Minting a fresh sign-up link revokes the official's
current one (one link per official), so a move email would kill the link in
last week's help email. The email has to make sense without a link.

### Privacy policy, section 9 (change this BEFORE shipping)

Two edits:

- "What the league enters": change "…an email address so we can send the
  link" to "…an email address so we can send the link **and tell them when
  their games change**".
- "Emails": add after the first sentence:

  > We also email an official (or, for an official under 18, their parent or
  > guardian) when a game they're assigned to is moved, rained out, given a
  > makeup date, put back on the schedule, or removed from the schedule
  > (only for games that haven't started), whether or not the league uses
  > officials sign-up. When a change puts an official in two places at once,
  > or on a date they said they can't work, we tell the league's officials
  > contact.

The section's heading, "Officials sign-up", stops being accurate. Rename it
"Officials" and update the contents link.

**Note:** leagues entered officials' emails before 0124 (0062). Those
officials were never told FieldSlate would email them. The policy change and
the default-on switch are what decide that. This is a decision for you, below.

### Tables, functions, triggers, locks

| Object | Change |
|---|---|
| `official_outbox` | add `coalesce_key`; partial unique index (coalesce_key) where pending; kind CHECK widened: `game_changes`, `assignment_conflicts`; the umpire-required CHECK widened (`assignment_conflicts` has no umpire) |
| `official_signup_settings` | add `notify_game_changes boolean not null default true` |
| `official_trigger_failures` | new, RLS on, no role privilege |
| `official_on_game_change()` | new, AFTER UPDATE OF scheduled_at, venue_id, status, SECURITY DEFINER, `search_path=public, pg_temp`, callable by no role |
| `official_move_problem(umpire, game)` | new, INVOKER, callable by no role |
| `official_outbox_take` | re-created verbatim from 0124 plus the two kinds and the net-change drop; still service_role only |
| `official_notice_gaps(season)`, `official_trigger_failure_count(season)` | new, authenticated, member + Elite |
| `wipe_official_signup_on_archive` | unchanged: it already deletes the season's outbox; the new failures table cascades with the season |

Locks when applied:

- **SHARE ROW EXCLUSIVE on `games`** for the CREATE TRIGGER. It blocks game
  writes, not reads, for the statement.
- **ACCESS EXCLUSIVE on `official_outbox` and `official_signup_settings`**:
  ADD COLUMN with a constant default, plus the CHECK swaps. Both are tiny and
  no browser screen reads them directly.

The apply time is yours (standing rule).

### How it meets every path that writes games

| Path | What happens |
|---|---|
| Picker / manual move / panel row icon | UPDATE scheduled_at, venue_id → "Moved" |
| Single and bulk rainout (`markGame(s)RainedOut`) | status → cancelled → "Rained out"; a bulk rainout is one email per official |
| Remove Rainout | cancelled → scheduled, same time → "Back on" |
| Rainout reschedule (rainout picker) | cancelled → scheduled, new time → "Makeup set" |
| Interleague: partner accepts a makeup or move (`accept_reschedule_request_by_token`, anon) | the trigger fires inside the token function → email. This is the case that most needs it: no admin is present |
| Interleague: resolve / accept proposal / host respond | UPDATE scheduled_at → "Moved" |
| `reschedule_pending` flip with no time change | nothing (no column we watch changed except status, and that change isn't one of the four cases) |
| Record where it was played | both times past → nothing |
| Regenerate, division delete, team delete, game delete | the games are DELETED, and `game_umpires` cascades. **No email, and the official is never told they lost the game.** See below |
| Generator inserts | no assignments exist yet → nothing |

**Deletes — "taken off this game" (approved 2026-11-10).** A regenerate,
division delete, team delete or game delete removes assignments with the
game (`game_umpires` cascades). A new BEFORE DELETE row trigger on `games`,
`official_on_game_delete`, runs before the cascade, so the assignments are
still readable. For each UPCOMING assignment (start after `official_org_now`)
it adds a `removed` entry to the official's same pending `changes:` row,
carrying a snapshot (start, venue_id, home/away team names, division name,
role), because the game and possibly its teams are gone by send time. The
take words it from the snapshot and drops it if the snapshot start has passed
by then.

- **There is no reattach**, unlike volunteers: a regenerate's re-inserted
  game has no officials. So the line is: "**Taken off** — Majors · Expos vs
  Mets · Sat, Oct 17 · 1:00 PM. This game was removed from the schedule or
  rebuilt, and you're no longer assigned. Santa Rosa American Little League
  will let you know if you're needed."
- **Unlike the change trigger, this one is not swallowed.** If it fails, the
  delete fails visibly, as with `volunteer_on_game_delete`. A delete must not
  go through while silently losing the notice. (It only reads and upserts
  one outbox row, so a failure is unlikely.)
- **Not covered, stated:** a coordinator removing an official in the slot UI
  sends nothing (that is a deliberate edit by the person who would tell
  them), and an official dropping their own spot already gets
  `drop_confirmed`.
- Proof GC13: a regenerate (delete + insert) of a division with upcoming
  assigned games queues one combined row per official with `removed` entries;
  a past assigned game queues nothing; a move followed by a delete in the hold
  window reads as a single "Taken off". Mutants: MG15 (removed entries for
  past games) → GC13; MG16 (the delete trigger swallows its errors) → GC14,
  a forced failure must abort the delete.

### Resend limits, and a league-wide rainout (checked 2026-11-10)

**Resend's published limits** ([usage limits](https://resend.com/docs/api-reference/rate-limit),
[quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits),
[pricing](https://resend.com/pricing)):

- 10 API requests per second per team, the same on every plan, shared by all
  keys.
- **Free:** 100 emails a day (UTC day) and 3,000 a month.
- **Pro:** 50,000 a month, no daily cap.

**Which plan FieldSlate is on can't be seen from the repo — check the Resend
dashboard.**

**What the drains do today** (`src/lib/outbound-email/outbox-drain.ts`):

- 25 rows per run, 600 ms between sends. The volunteer and officials drains
  both run every 5 minutes, so they overlap: about 3.3 requests per second at
  most, plus up to 5 from a sign-up or cancel. That stays well under 10 per
  second.
- Throughput is about 300 emails an hour per outbox.
- A failed send with status 429 or 5xx is retried with backoff of 1, 4, 9 and
  16 minutes (5 attempts, about 30 minutes in all), then marked `failed` for
  good.

**A league-wide rainout.** Say 20 Saturday games, 2 umpires each, 2 volunteer
spots each:

- Officials: one combined email per official, so about 10–20.
- Volunteers: one email per claim, about 40.
- Rate: no problem — about 60 emails clear in one or two runs.
- **Daily quota on Free:** this alone can use most of the 100 a day.
- What happens when the quota runs out: Resend answers 429, our drain
  retries it like a rate limit, and every row burns its 5 attempts in about
  30 minutes and is marked `failed`. **The rest of that day's emails, in both
  outboxes, are lost.** They're failed visibly in each outbox, but no admin
  screen shows outbox failures today.

**Fix in this build (proposed):**

1. Tell a quota 429 apart from a rate-limit 429 by Resend's error name
   (`daily_quota_exceeded` / `monthly_quota_exceeded` vs
   `rate_limit_exceeded`). A quota 429 puts the row back to `pending` until
   the next UTC midnight (daily) or stops the drain run (monthly), WITHOUT
   counting an attempt, and stops the rest of that run. A rate 429 retries on
   the next run.
2. The send-time "past" rule above then throws away any game notice whose
   game started while it waited. The volunteer outbox doesn't have that rule;
   the plan adds the same check to `volunteer_outbox_take` for game kinds
   (`game_moved`, `rained_out`, `makeup_set`, `back_on`) — a separate
   re-creation of that function, with its mutants re-targeted.
3. The Officials banner (`official_notice_gaps`) and the volunteer sign-up
   list show "N emails are waiting for the daily email limit to reset", so a
   quota stop isn't silent.

**If FieldSlate is on Free, upgrading Resend before this ships is the real
fix.** It is a dashboard action for you, not code.

### Proof plan

SQL proof `scripts/sim/official-game-change-sim.sql` (+ build script with
`--md5`). It is rolled back in the "test" org, with "Test 2" as the other
league. Every setting is changed through the app's own functions, in screen
order: contact, then confirm, then the switch (the 0124/0125 lesson). Games
are moved by direct UPDATE as the signed-in role, because games have no
function and that is the browser's real write.

Assertions:

- **GC1:** one each of move, rainout, makeup and back on queues exactly one
  row per official.
- **GC2:** a bulk rainout of 3 games is one row for an official on all 3.
- **GC3:** move and move back → the take supersedes it as `no_net_change`.
- **GC4:** both times past → nothing.
- **GC5:** each of the four gates (not Elite, feature off, no contact, notify
  off) → nothing queued.
- **GC6:** no email → failed `no_email`, and the gaps function lists it.
- **GC7:** a partner token accept fires it.
- **GC8:** a failure inside the trigger doesn't block the UPDATE and records
  one failures row.
- **GC9:** a move into an overlap queues `assignment_conflicts`; moving it
  back drops the entry at take.
- **GC10:** `game_umpires` and `games` are byte-identical apart from the
  edit, so nothing was unassigned.
- **GC11:** the 0082 lock trigger and "Sent to parents" are untouched (a
  locked division still allows the move and still clears posted, exactly as
  before).
- **KY1:** the exact key set of a taken row: no other official's name, no
  game notes.
- **P1:** EXECUTE per role.
- **R1:** the 0124 proof is re-run against the new take (re-targeted, as
  `regress0124`).

Mutants, each killed at its own tag:

| Mutant | Change | Killed by |
|---|---|---|
| MG1 | past-game skip removed | GC4 |
| MG2 | no coalesce (insert per game) | GC2 |
| MG3 | `was` overwritten by the latest change | GC3 |
| MG4 | net-change drop removed | GC3 |
| MG5 | Elite gate removed | GC5 |
| MG6 | contact gate removed | GC5 |
| MG7 | `notify_game_changes` ignored | GC5 |
| MG8 | exception handler re-raises | GC8 |
| MG9 | trigger deletes the assignment on conflict | GC10 |
| MG10 | conflict check uses the full slot rule (always slot_taken) | GC9 |
| MG11 | take returns another official's name | KY1 |
| MG12 | EXECUTE granted to anon | P1 |
| MG13 | status-only WHEN (misses venue moves) | GC1 |

App harness `npm run sim:official-change-notice` (three zones) + `:mutants`:

- the four lines from (was, now);
- the youth wording;
- the subject line for one game and for several;
- "Now/Was" times as wall clock (the officials wall-clock rule);
- the gaps banner sentences;
- the template refusing a row it can't describe (`unknown_kind`, never
  blank).

`sim:volunteer-email`'s T1 pattern (every kind has a template) gets an
officials twin.

**Fences:**

- the new template files go in `sim:daylight-leaks`' outbound list;
- `sim:game-notes` O1 scans the officials change template for `notes`;
- `sim:volunteer-leaks` U1 already walks `src/lib/umpires` + `outbound-email`,
  and a new rule checks that `official_on_game_change`'s body names no
  `volunteer_` object;
- `sim:mutant-targets` must pass after the 0124 take mutants are re-targeted.

---

## B. Snack shack kept in step with games

### What's true today

- The whole derivation is TypeScript (`derive-shifts.ts`). It covers windows,
  gaps, the max shift, the leftover absorb, the closed days, the overlap
  guard, the equity pick and the preference tiers.
- `regenerate_snack_shack_shifts` takes the FULL desired set from the browser
  and keeps rows that match on date, start and end exactly.
- The carry rule for notes, cash person, headcount and volunteer claims
  (0104/0119/0122) is **same date + same start**. Different start = the
  shift is removed and a new one is added: the claim detaches, and
  `spot_lost` goes out 10 minutes later unless a same-start shift comes back.
- A "changed" shift (same start, new end) is a NEW row. **Its team is picked
  fresh** by `assignNewShifts`; the old team is not preferred. Notes, cash,
  headcount and claims carry.
- Past dates are frozen by the caller. Regenerate always previews.

### The fact that decides it

When the FIRST game of a shack day moves, the window's open time moves, and
every shift that day starts at a different time. Shifts are cut from the
window start in max-length pieces. Under the carry rule, that means:

- every volunteer sign-up that day is lost and emailed "spot lost";
- every shift is re-picked, so teams reshuffle;
- leftover choices keyed on the old window start go stale and fall back to
  the default.

A typical "move the 9:00 game to 10:30" therefore wipes the day. The only
change where everything carries is when the LAST game moves and the window
end shifts within the same piece count, and even then the team can change.

### The three options

| | (1) Auto-regenerate affected days | (2) Manual, tell the admin | (3) Hybrid: auto when everything carries |
|---|---|---|---|
| Where it runs | Needs the derivation **in SQL** (a second copy of ~600 lines: one rule, two languages, a huge pinned table) or a service-role server job. **service_role holds no SELECT on games, teams, divisions or leagues**, so it would need a new DEFINER reader that returns whole seasons | No new derivation; the page's existing TS diff | Same problem as (1): something server-side has to derive to know whether "everything carries" |
| Team assignments | First game moved → the whole day is re-picked without anyone seeing it; a team can lose or gain a shift by itself | Unchanged until the admin confirms the preview | End-only changes keep teams **only if** we change the rule to carry the team (below); all else falls back to (2) |
| Volunteer claims | First game moved → every claim that day is lost, and each volunteer gets a "spot lost" email minutes after an admin's unrelated edit | Nothing moves until Confirm; the preview already counts carried and lost sign-ups | Carries by definition (it acts only when all carry); the volunteer gets the `shift_changed` "new hours" email |
| Rainouts | A same-day rainout deletes today's shifts and emails every volunteer "spot lost". Partial rainouts (shack still open for other games) get re-cut at random | The admin decides whether the shack still opens | A rainout never carries everything → manual |
| Breaks decisions | "Regenerate ALWAYS previews" (decided 2026-10-05) | none | partly |
| Cost | Very high | Low | High (the server-side derivation), for a narrow case |

**Recommendation: (2), plus two changes that make it good and make (3)
possible later without a rewrite.**

**Push back on (1)** for three reasons. It writes the real league's
assignments and cancels real volunteers with no preview. It needs either a
second copy of the derivation in SQL or a broad service-role reader. And the
carry rule as it stands turns a routine move into "every volunteer that day
was dropped".

**Push back on (3) as stated.** "Only times shift and every claim carries"
is almost never true for a time move (see above), so it pays the full cost of
(1) for the rare end-of-day case.

### What (2) means concretely

**B1. A stale-days mark written in the database** (the only migration piece).
A statement-level trigger on `games` uses transition tables, like
`clear_division_posted`; the generator inserts in batches of 500, so it can't
be a row trigger. It fires on insert, delete, and update of
scheduled_at / venue_id / status / home_team_id. It records the affected
dates (old and new) into a new table, `snack_shack_stale_days`
(snack_shack_id, date, marked_at, unique on the pair), for seasons that have
a snack shack. It records only dates in range that are upcoming in league
time.

It does not decide that a day IS stale. It only says a game changed on a day
the shack could care about. Cheap, no derivation, swallow-and-record on
failure. It is SECURITY DEFINER because partner token functions write games.

**B2. The banner says the truth, using the existing TS diff.**
- **Dashboard:** when the season has marks newer than `shifts_generated_at`,
  run the snack shack loader + `upcomingStaleness` and show
  "Snack shack: games changed on Sat, Oct 17 and Sun, Oct 18 — review
  shifts". It shows only days the diff really flags. Marks the diff clears
  are deleted. An unreadable diff says "couldn't check", never silence.
- **Snack shack page:** the existing staleness notice gains the red-flag
  count for upcoming shifts. A moved game can make a STORED team overlap its
  own shift, and `storedAssignmentFlag` already finds that, but only on that
  page today.

**B3. Regenerate one day** (no migration). `buildRegeneratePlan` gains
`onlyDates`. Days not selected pass through exactly as stored, the way the
past freeze already works, so the full-set RPC keeps them. The banner's
"Review Sat, Oct 17" opens the preview for that day only. An admin fixes the
changed day without risking the rest of the season.

**The one-day preview NAMES the volunteers who lose their spot (decided
2026-11-10)** — e.g. "J. Smith (9:30–11:30) and K. Lee (11:30–1:30) lose
their spot and are emailed." It doesn't just give a count. That crosses a
fence the snack shack keeps today: "the snack shack page, its prints and
emails read NO volunteer data" (`sim:game-notes` O1-snack-volunteer-*), and
the preview reads counts only (`volunteer_shift_claim_counts`).

The change:

- A new member + Elite function,
  `volunteer_shift_claims_for_blocks(p_block_ids uuid[])`, returns
  `{block_id, claim_id, first_initial, last_name}` for ACTIVE claims on those
  shifts. It returns no email, and it is a volunteer function, inside the
  volunteer fence.
- ONLY the regenerate preview modal (`regenerate-preview-modal.tsx`) may call
  it. The fence is narrowed by exactly that one file, by name: the page,
  prints, emails and the Teams-page button stay fenced.
- `sim:game-notes` gains a check that no other snack shack file names the
  function. A mutant calls it from the print and dies there.
- If the names can't be read, the preview shows the count with "Couldn't
  read who signed up", never a silent count. Confirm stays allowed: the
  count is right, and the emails go out as today.
- The full-season regenerate preview shows the same names. One component,
  one rule.

**B4. Carry the team on a changed shift** (no migration; it changes the plan).
When a shift keeps its start and only its end moves, the new shift keeps its
old team if that team still passes the hard overlap rule. Otherwise the
picker runs, as today. This removes the "end moved, team swapped" surprise.
It is also the precondition if we ever want (3). It is a rule change in
`assignNewShifts`/`buildRegeneratePlan`, so it needs your decision.

**B5. Email — DROPPED from v1 (decided 2026-11-10).** Kept for the record: A daily email to the admin listing stale days
needs a recipient. The snack shack has no contact address. The choices: the
league's confirmed volunteers contact (only when sign-ups are set up), the
owner's account email (but `profiles.email` is never synced, and we've ruled
account emails out for volunteer mail), or no email. The email can't say
which shifts change without the derivation server-side; the honest version
is "Games changed on Sat, Oct 17 at your snack shack fields — open the Snack
shack page to see whether its shifts need rebuilding." **Recommend shipping
B1–B4 and deciding B5 after a week of the banner.**

**Volunteer emails under (2):** none until the admin confirms a regenerate.
Then exactly today's rules apply: carried sign-ups get `shift_changed`, lost
ones get `spot_lost` (held 10 minutes, withdrawn on reattach). B4 changes
nothing for volunteers.

### Interactions

| Path | B1 marks |
|---|---|
| Game regenerate (delete + insert) | yes |
| Rainouts (bulk too) | one statement, marks both dates |
| Record-where-played | marks only upcoming dates, so usually nothing |
| Interleague accept (token) | yes; the trigger is DEFINER |

`regenerate_snack_shack_shifts` is untouched. A confirmed regenerate deletes
the season's marks with dates ≤ the newest regenerated day. A per-day
regenerate deletes only that day's marks.

Locks: the CREATE TRIGGER statements on `games` take SHARE ROW EXCLUSIVE (the
same apply as A; put both in one migration so `games` is locked once).

### Proof plan

**SQL proof** (`snack-stale-days-sim.sql`, rolled back in "test"). The marks
cover:

- SM1: a move at a shack field marks both dates;
- SM2: a past date is not marked;
- SM3: a season with no snack shack writes nothing;
- SM4: a 500-row insert is one statement with one mark per date;
- SM5: delete marks;
- SM6: a failure doesn't block the write;
- SM7: a token-function write marks;
- SM8: the lock trigger and posted are unchanged.

Mutants, each killed at its own tag:

| Mutant | Change | Killed by |
|---|---|---|
| MS1 | row-level trigger | SM4, by counting statements |
| MS2 | past dates marked | SM2 |
| MS3 | old date not marked | SM1 |
| MS4 | delete ignored | SM5 |
| MS5 | re-raise | SM6 |

**App sims:**

- `sim:snack-shifts` gains the B3 section (the `onlyDates` plan leaves every
  other day byte-identical, past freeze kept) and the B4 section (team
  carried when clear, re-picked when it now overlaps).
- New mutants: `onlyDates` ignored; team carried even when it overlaps (dies
  at the A-series overlap check); team never carried.
- The existing goldens (`sim:snack-print`) must stay byte-identical.
- The fence: the banner code reads no volunteer data (`sim:game-notes`
  O1-snack-volunteer-*), and the dashboard banner file goes in that fence.

---

## Homepage and blog wording to update WHEN SHIPPED

`src/components/marketing/one-change.tsx`: update the header comment and the
two cards.

- **Officials** — now: "The assigned umpires stay on the game, so their
  assignments move with it." Proposed: "Assigned umpires stay on the game and
  get an email with the new time. If a move puts one in two places, you're
  told."
- **Snack shack**, with option (2) — now: "Shifts are built from the game
  schedule, and FieldSlate shows you which days to rebuild when the games
  change." Proposed: "Shifts are built from the game schedule. When games
  change, FieldSlate flags the days to rebuild and shows every change before
  you confirm."

**Fix the blog now, independent of this build.**
`content/blog/rainout-volunteer-coordination.md`, lines 9 and 87 (the FAQ, in
both the frontmatter and the body), says snack shack "spots are tied to games,
so they move when games move". That is false today and stays false under (2).
Line 68 says umpires "are assigned to the game itself", which is true, but the
paragraph implies they "hear about it", which isn't true until A ships.

---

## Earlier open questions — how they were settled

Read from "Part A approved as planned" on 2026-11-10; correct any of these
if that isn't what you meant.

1. Default for every league: ON, gated by a confirmed officials contact.
   Santa Rosa American's contact stays unconfirmed, and nothing writes to it.
2. Elite only.
3. "Taken off this game" email: yes, for upcoming games (explicit).
4. Coordinator conflict email: yes, as designed (`assignment_conflicts`).
5. A cancelled game is not busy: Step 1, the database's rule.
6. Snack shack: option 2 + B1–B4 (explicit).
7. No snack shack admin email in v1 (explicit).

**Still open, needs you:** which Resend plan FieldSlate is on (dashboard
check). If it's Free, upgrade before Part A ships.

## Build order (each step held for your go)

0. The rainout blog FAQ fix — its own commit, its own branch.
1. Step 1: the cancelled-game busy rule (migration + proof + app readers),
   its own commit.
2. Privacy section 9.
3. Migration (A triggers, outbox, 0106 skip line, B1 marks, the volunteer
   preview-names function) and its rolled-back proofs: the new proof plus
   `regress0124`, `regress0106` and the volunteer take re-target.
4. Officials templates, the quota-aware drain, the Officials page banner.
5. B2–B4 screens and the named-volunteers preview.
6. Apply (your time), then ship.
7. Homepage cards.
