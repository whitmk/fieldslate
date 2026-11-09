# Branch D — volunteer tracker (0123): plan for review

Status: APPROVED 2026-11-09 with the answers under "Decisions" below; board
conflicts approved as resolved. Branch `feat/volunteer-tracker`,
migration `0123_volunteer_tracker.sql`. The switch stays SRALL + "test" only.

What this plan is built on, read live today:
- `volunteers` is per LEAGUE (one row per org + email), not per season.
  It already has an unused `family_id` column (0 rows set).
- A claim's family team is `volunteer_claims.family_team_id`, per claim, so a
  family can belong to two teams (the board's Patel row).
- `umpires` is per season (name, email, phone, team_id = the team they COACH).
  `game_umpires` has (game, umpire, role, paid) and references `games` only,
  so playoff games can't carry officials. Regular season only comes for free.
- 0 of 8 live officials have an email on file, so an email match will rarely
  fire today. The explicit team link has to be the main path.
- Outbox kind `nudge` is already allowed (0120). The take already attaches
  the league's sign-up link to every row.

---

## 1. Officials proposal (decide this first)

**Goal: count an official's assigned games toward a family without touching
how officials are assigned, paid or auto-assigned.**

Recommendation: everything goes in NEW volunteer tables, and `umpires` and
`game_umpires` get no new columns. The officials pages, auto-assign, the
pickers and the pay report don't change at all. Archiving the season deletes
the new rows with the rest of the volunteer data.

**A. Which officials count.** This is opt-in per official, per season, using
`volunteer_official_links (umpire_id → umpires, counts_for_team_id → teams)`.
- No row means the official's games don't count. That's today's default, and
  it's right for paid umpires who aren't parents.
- "Counts for [team]" is set in a new Officials panel on the tracker. It lists
  the season's officials, has a team picker, and shows a "matched by email"
  line when there is a match.
- Alternative (your "e.g."): a "Counts for team" field on the official's edit
  form. I recommend against it. It means changing `umpires` and the shared
  profile form (the form-inside-a-form trap), and the officials pages would
  start reading volunteer data, which the fence would then have to allow.

**B. Which family the official joins.** These rules apply in order:
1. A manual link from the tracker's merge tool, which can join an official to
   any family.
2. Otherwise, an email match: `lower(btrim(umpires.email))` equals a
   volunteer's `email_lc`, and that volunteer has a claim this season.
   Computed when read, never stored.
3. Otherwise, the official is a family of their own, shown as
   "J. Smith (official)" using the name as entered on the roster.

The family's teams include the official's "counts for" team.

**C. Which games count.** Every `game_umpires` row for a counted official
whose game is:
- regular season (always true, see above), and
- not `cancelled` (rained out) and not `pending_interleague`.

How each game is counted:
- Dated before today (league timezone): **worked**, unless marked as a no-show.
- Today or later: **upcoming**.
- Each assignment counts as one shift, equal to any volunteer spot.

**D. A missed game.** A "No-show" tick on the assignment, stored in
`volunteer_official_no_shows (game_umpire_id → game_umpires on delete
cascade)`.
- It can be set only on a past game, the same rule as a volunteer no-show.
- The tick is in the tracker's Officials panel, under each counted official's
  past games. The game detail modal and the officials pages don't change.
- **A no-show does NOT change pay** (`game_umpires.paid` is left alone), and
  auto-assign never reads it. Say so on screen: "Doesn't change pay."

**E. Season switch.** "Officials' games count" is on the goal. It's the
board's "Umpire" item under What counts, labeled with the sport's word.

Open questions on this part:
- O1. Should an email match alone count an official who has no "counts for"
  team? I recommend no: counting is always opt-in, and email only decides the
  family.
- O2. Should a no-show official's assignment also show somewhere in the
  officials pages? I recommend not in v1, since that would touch officials
  code.

---

## 2. The tracker

### Rules (decided, plus what this plan proposes)

- **Goal:** N shifts per family (1–20), per season. With no goal set, the
  tracker shows counts only plus a "Set a goal" prompt, with no status
  buckets.
- **What counts:**
  - Roles with `counts_toward_goal` (the column exists since 0121), including
    the snack shack role.
  - Officials' games, if switched on.
  - All counted shifts are equal. No-shows never count. Detached and
    canceled claims never count.
- **A claim is:**
  - **worked** if it's active, its spot date is before today (league
    timezone) and it isn't a no-show;
  - **upcoming** if it's active and dated today or later.

  "Today" counts as upcoming because that's when a no-show can first be
  marked (the next day), so a spot can't count as worked and then flip.
- **Rained-out game:** the held spot counts as neither worked nor upcoming
  until a makeup is set. A game awaiting a reschedule answer still counts as
  upcoming.
- **Family:** each volunteer is their own family unless merged. Merges are
  stored PER SEASON (`volunteer_family_members`), so archiving deletes them.
  The org-wide `volunteers.family_id` stays unused; the plan proposes dropping
  it (see Locks).
- **Family name:** the last name of the earliest member ("Patel"), with
  members listed below it ("M. Patel, R. Patel").
- **Family teams:** the union of its members' claim teams plus any official's
  counts-for team.
- **Status buckets** (exclusive, computed in TypeScript from the database's
  counts):
  - met: worked ≥ goal;
  - on track: worked + upcoming ≥ goal;
  - short N: N = goal − (worked + upcoming).
- **Which families are listed:** those with at least one active claim, past or
  upcoming, or a counted official. A family whose spots were all canceled
  isn't listed (it still shows on Who signed up). Open question O3.
- **Families per team:** optional, a number only (1–60), in
  `volunteer_team_family_counts`. For a team with a count:
  - not signed up = max(0, count − listed families on that team);
  - progress reads "7 met · 2 on track of 10".

  A team without a count reads "of N signed up". A family on two teams counts
  on both team rows, and appears once in the top tiles.
- **Top tiles:** Goal met / On track / Short (families) and "Families not
  signed up yet" (summed over teams with a count).

### Tables (0123)

All tables have RLS on and no privileges for any role. Every read and write
goes through SECURITY DEFINER functions, like `volunteers`. Each table has
`owner_id` and `season_id` (cascade).

| Table | Key | Columns |
|---|---|---|
| `volunteer_goals` | season_id | shifts_per_family 1–20 null, officials_count bool default true, updated_at, updated_by |
| `volunteer_team_family_counts` | team_id (→ teams cascade) | families 1–60 |
| `volunteer_family_members` | (season_id, member) | member is a volunteer OR an official (exactly one of volunteer_id → volunteers cascade, umpire_id → umpires cascade); family_key uuid. A row means "merged into family_key"; no row means its own family. |
| `volunteer_official_links` | umpire_id (→ umpires cascade) | counts_for_team_id → teams set null |
| `volunteer_official_no_shows` | game_umpire_id (→ game_umpires cascade) | marked_at, marked_by |

The archive wipe (`wipe_volunteer_data_on_archive`) is re-created to delete
all five tables by season, along with the rest. `volunteer_archive_holds`
stays claims-only: goals, counts and links aren't sign-ups, so they don't
hold a season open.

### Functions (0123)

All are SECURITY DEFINER with `search_path = public, pg_temp`, behind
`volunteer_admin_gate` (member → switch → Elite → not archived). EXECUTE is
revoked from PUBLIC and granted to authenticated only. None writes
`activity_log`.

- `volunteer_tracker(season)` is the ONE read. It returns:
  - the goal and what counts;
  - teams with their family count;
  - families: key, name, members (initial + last name + email, or the
    official's roster name), teams, worked, upcoming, no-shows, plus
    `rained_out` held;
  - the officials panel: official, counts-for team, matched volunteer, and
    past assignments with no-show.

  It's complete or it errors; the screen never shows a partial list.
- `set_volunteer_goal(season, shifts, officials_count, counting_role_ids[])`
  writes the goal and each role's `counts_toward_goal` in one call (the board
  edits them together).
- `set_team_family_count(season, team, families | null)`.
- `set_official_counts_for(season, umpire, team | null)`. The team must be in
  the season.
- `set_official_no_show(game_umpire, bool)`. The game must be dated before
  today and the official counted.
- `merge_volunteer_families(season, keep_key, merge_key, commit)` is its own
  preview: it returns both families' members, teams and counts. Merging an
  official-only family is allowed. `split_volunteer_family(season, member)`
  undoes it.
- `volunteer_admin_nudge(season, volunteer_ids[])`:
  - Queues one `nudge` per VOLUNTEER (officials-only families can't be nudged;
    see O4).
  - Payload: ids plus the family's goal, worked and upcoming. Numbers only;
    the payload CHECK already bans addresses and names.
  - Refuses `link_off` when the sign-up link is off: a nudge without the link
    is pointless.
  - Skips anyone nudged in the last 24 hours (read from the outbox log) and
    reports them as `recently_nudged`.
  - The take needs no change.

### Screens

**Volunteer tracker** (`/dashboard/volunteers/tracker`), reached from Who
signed up (as the board shows) and from the Volunteers page:
- the goal card + Edit goal dialog;
- by-team table with an inline family-count field;
- family list: filter All / Goal met / On track / Short, select boxes,
  "Email N selected a nudge", "Merge 2 selected", and "Split" on a merged
  family;
- Officials panel;
- Export CSV.

All words go in `words.ts`, all rules in `src/lib/volunteers/tracker.ts`
(pure). Same gates as the other volunteer screens.

### Nudge email (new template, words for your review)

- Subject: "[League]: can your family sign up for more?"
- Body: "Your family has worked N of the M shifts the league asks for, with K
  more coming up. [Sign up for another spot]." followed by the league's
  reply-to line.

No spot list, and no manage link (the take attaches none for this kind).

### Admin CSV

Family, Members, Emails, Teams, Worked, Upcoming, No-shows, Status. It's
built in the browser from `volunteer_tracker` with formula cells made inert
(the `signupsCsv` rule), and the file is added to the fence's `CSV_ALLOWED`
with the decision date.

---

## 3. Board vs plan: conflicts

1. **Numbers don't add up on the board.** Expos has "Families 10" but
   progress reads "of 12", and Pirates has 8 vs "of 12". The plan uses the
   team's family count ("of 10").
2. **Bucket overlap.** The board's legend reads "On track (includes upcoming
   spots)" next to "Goal met". The plan makes the buckets exclusive (met is
   never also on track), so the tiles add up to the families listed.
3. **"Short" is undefined on the board.** Patel shows "Short 1" with 0
   worked and 1 upcoming. The plan defines short N = goal − (worked +
   upcoming), which matches Patel and Brooks.
4. **No merge on the board, and Merge family was CUT from Who signed up
   (2026-11-08).** Your list brings merge back. The plan puts it on the
   tracker only ("Merge 2 selected"). Confirm that it stays off Who signed
   up.
5. **No officials section on the board.** The plan adds the Officials panel
   (counts-for team, email match, no-shows).
6. **"Volunteer list" vs the board's family list.** The board lists FAMILIES
   with members inside, and the plan follows the board. Say if you wanted one
   row per volunteer instead.
7. **What counts is display-only on the board, under "Edit goal".** The plan
   edits the roles' `counts_toward_goal` and the officials switch in that
   dialog. The roles editor doesn't show `counts_toward_goal` today.
8. **The board's nudge can select any family.** Families with no volunteer
   (official-only) can't be emailed; their boxes are disabled with a reason.
9. **The archive line** says "Names, emails and counts are deleted". The plan
   also deletes goals, team counts, merges, official links and no-shows. The
   wording stays true.
10. **Rained-out spots** have no column on the board. The plan shows them in
    the family row as a note ("1 spot held: rained out"), not as a column.

## 4. Privacy policy: change before building

Section 8 doesn't yet cover three things the tracker does. Proposed
additions, for your and the lawyer's review (launch blocker 2 is already
open):
- "Your league can group sign-ups from the same family together and see how
  many spots your family has worked."
- "If you also officiate for the league, your league can count the games
  you're assigned toward your family's total, matched by your email address
  or set by an administrator."
- Emails: "…reminders, a note from your league asking your family to sign up
  for more, and updates when your spot changes…"

## 5. Proof plan

`scripts/sim/volunteer-tracker-sim.sql` plus a build script. It applies 0123
rolled back in "test", with "Test 2" as the other league.

**Fixtures:** two teams in a locked division, plus one team in another
league; counting and non-counting roles plus the snack shack role; and claims
covering each case:
- worked, a no-show, today, upcoming;
- canceled, detached;
- on a rained-out game, a makeup-set game and a pending-reschedule game;
- a shift.

Also: three officials (linked, email-matched, unlinked) with past, future,
no-show and rained-out assignments; and a merged family across two teams.

**Assertions:**
- **TR1** worked/upcoming/no-shows per family, exactly.
- **TR2** non-counting roles and the officials switch.
- **TR3** today is upcoming, not worked.
- **TR4** rained out is neither; a makeup counts again.
- **TR5** canceled and detached never count.
- **TF1** families: merge, split, an official joined by email, a manual link
  winning over email.
- **TT1** by-team math with and without a count; a family on two teams.
- **TO1** officials: unlinked never counts; regular season only; a no-show
  can't be set on a future game; `paid` untouched.
- **TN1** nudge: one per volunteer, link off is refused, the 24-hour skip,
  payload holds numbers only.
- **TG1** gates: non-member, switch off, Pro, archived.
- **TW1** the archive wipe deletes all five tables and leaves the 0120/0121
  ones as before.
- **TP1** privileges per role on every new function and table.
- **TL1** no `activity_log` write.

**About 24 mutants,** each required to die at its own tag. Examples:
- counting a no-show;
- counting today as worked;
- counting a rained-out spot;
- ignoring `counts_toward_goal`;
- officials counted with no link;
- email match ignoring the season;
- dropping the 24-hour skip;
- a nudge naming an address;
- the wipe missing a table;
- a grant to anon;
- the gate allowing Pro.

**Regressions:** the 0121 and 0122 proofs re-run against 0123, because the
wipe function is re-created.

**App harnesses:**
- `sim:volunteer-tracker`: status buckets, by-team math, family names, CSV,
  words, wiring; plus `:mutants`.
- `sim:volunteer-email`: the nudge template (T1 drops `nudge` from the
  not-built list).
- Screens checked on a deleted scratch route at 1280px and 375px with stubbed
  replies.

## 6. Leak-fence changes (`sim:volunteer-leaks`)

- **W1/V1:** add the five tables and new functions to the name lists.
- **CSV_ALLOWED:** add the tracker CSV file, dated.
- **New U1, the officials fence:**
  - Nothing under `src/lib/umpires`, `src/components/umpires`, the pay report
    or auto-assign imports `src/lib/volunteers` or names a volunteer table.
  - No SQL function outside the volunteer set reads `volunteer_official_*`.

  This pins "assignment, pay and auto-assign don't change". Mutant: the pay
  report reads no-shows.
- **A1 / D1:** unchanged (the new functions get checked automatically).
- **Email:** the nudge template must name no other family or volunteer (a
  test with two families).

## 7. Locks (when 0123 is applied; under a second)

- CREATE TABLE with foreign keys takes **SHARE ROW EXCLUSIVE** on `profiles`,
  `leagues`, `teams`, `umpires`, `game_umpires` and `volunteers`. That blocks
  writes to those tables (not reads) for the statement: profile saves,
  season edits, team edits, official edits and assignments.
- Re-creating the wipe function takes no table lock.
- Optional cleanup: dropping the unused `volunteers.family_id` takes **ACCESS
  EXCLUSIVE** on `volunteers` (2 rows). I recommend doing it in 0123, so a
  later change can't accidentally use an org-wide family link that outlives
  the season.
- `umpires` and `game_umpires` are not ALTERed.

The proof holds the same locks for its run (seconds, lock_timeout 3s), plus
row locks for its fixtures.

## 8. Build order (each step commit-and-hold)

1. Pure rules (`tracker.ts`) + `sim:volunteer-tracker`.
2. 0123 + proof file (the proof runs on your go).
3. Tracker screen + Officials panel + Edit goal + merge/split.
4. Nudge template + send.
5. CSV + fence changes.
6. CLAUDE.md, help page FAQ, privacy (after your wording decision).

Deploy order: apply 0123 before the screens reach `main`.

## Decisions (Whit, 2026-11-09)

- O1. An email match alone never makes an official count; the admin's
  "Counts for [team]" is required. Email only picks the family.
- O2. No-shows are not shown on the officials pages in v1.
- O3. Families whose spots were ALL canceled ARE listed (0 worked, short) and
  are nudge targets. (Replaces "a family is listed if it has an active claim":
  a family is listed if any member has any claim in the season that isn't
  detached-only, or it holds a counted official.)
- O4. Official-only families can't be nudged.
- O5. Nudge limit: once per volunteer per 3 DAYS (72 hours, read from the
  outbox log).
- O6. 0123 drops `volunteers.family_id`.
- Privacy: the three sentences ship on their own docs branch
  (`docs/privacy-volunteer-tracker`) before the build.
