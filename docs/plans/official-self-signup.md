# Officials self-sign-up — plan (held for review, 2026-11-09)

Status: DECIDED 2026-11-09 (see "Decisions" at the end); building on
`feat/officials-signup`, privacy wording on `docs/officials-signup-privacy`.
Nothing applied; every proof runs on Whit's go.

## What it is

Rostered officials (rows in `umpires`) claim open umpire spots themselves,
next to auto-assign. Each official gets a PRIVATE link (only its sha256
stored). The link shows open spots in the divisions the official may work;
a claim runs the same checks auto-assign runs and creates an ordinary
`game_umpires` row, so pay, the pay report, the officials pages and the
volunteer tracker's family-goal count need no change. A coordinator can send
selected officials a "we need help" email listing the open spots each of them
could take, with that official's link. Youth officials are reached through
the parent/guardian email on file.

Not in scope: the public volunteer link (officials never appear there), new
officials signing themselves up, playoff games (`game_umpires` references
`games` only), double elimination or anything bracket-related.

---

## What the investigation found

### 1. Qualifications are not stored today — any official can work any division

- An official is `umpires(id, season_id, name, designation youth|adult,
  email, phone, pay_rate, max_games_per_week, notes, team_id)` plus
  availability windows, blackout dates, certifications (free text, unused by
  any rule), the coach link (`team_id`) and conflict-of-interest links (0073).
- `designation` is display-only: no engine, picker or check reads it.
- Roles are per season (`official_roles`); a division says how many officials
  a game needs (`divisions.umpires_per_game`) and the slots take the first N
  season roles. Nothing ties an official to a division or a role.
- So "divisions they're qualified for" needs a new table. Proposed:
  `official_divisions(umpire_id, division_id)` with **no rows = every
  division** — the same opt-in rule as availability windows ("zero windows =
  available anytime"), so every existing official keeps working exactly as
  today until a coordinator narrows them.
- Role qualification (e.g. a youth official may work base but not plate) is a
  natural next ask; proposed as a v2 decision, not v1.

### 2. Emails: almost nobody has one, and there is no guardian field

Live, read-only (2026-11-09): 9 official rows across 5 seasons; **1** has an
email (the test org's "Volunteer Test" season), **0** have a phone. The real
league has 1 official, in an archived season, no email. So today the feature
would reach nobody until coordinators enter emails — the coordinator screen
has to make that obvious (name every selected official without an email and
link to their profile), never silently skip them.

There is ONE email column. The privacy policy (section 7) already tells
leagues to enter a parent's/guardian's email and phone for any official under
18, but the app never says so: the add/edit form labels it plain "Email" for
youth and adult alike.

An email path to officials already exists — `POST /api/umpires/[id]/email`
("Email schedule"), sent to an address the admin types, not stored. It is a
one-off send, not part of this design; left as is.

### 3. Auto-assign and re-runs

- The engine (`src/lib/umpires/auto-assign.ts`) is BROWSER-side: it reads
  every `game_umpires` row for the season's officials, fills only EMPTY
  slots, then bulk-inserts. A self-claim is an ordinary row, so a re-run
  leaves it alone and counts it toward that official's load and weekly cap
  (self-claimers get fewer automatic picks — the right direction).
- **Race 1 (loud):** a claim landing between auto-assign's read and its
  insert hits a unique index (`(game_id, role)` or `(game_id, umpire_id)`),
  the bulk insert fails WHOLE, and the run reports filled 0 with a raw error.
- **Race 2 (silent):** an official claims a 10:00 game in division B while
  auto-assign, holding a stale read, gives them a 10:00 game in division A.
  Nothing in the database prevents overlap, so they are double-booked.
- Both are closed only if auto-assign's WRITE moves into a database function
  that takes the same per-official locks as the claim and re-checks each row
  (see design §4). Manual assignment (UmpireSlots) has the same shape but is
  warn-with-override; its unique-index race already surfaces as an error.

### 4. FINDING — the availability check reads game times in the browser's zone (fix first)

Games are stored as wall-clock with `+00` (live: 46 Fall 2026 test-org games
at `09:00+00` are 9 AM games). `eligibility.ts` does `new Date(scheduled_at)`
and then `getHours()` / `getDay()` in the BROWSER's zone. From a Pacific
browser a 9:00 AM Saturday game is checked as 2:00 AM (PDT, 7 h earlier;
8 h in PST):

- an evening window (Mo 17:00–20:00) never matches an evening game — refuses
  fitting slots (safe direction, but auto-assign under-fills);
- a morning window (Sa 08:00–12:00) ACCEPTS a 3–7 PM game — an assignment
  outside stated availability, which the engine must never make;
- blackout dates and the Mon–Sun week only shift for games before ~07:00
  wall-clock, which don't exist live.

`sim:officials` pins `TZ=UTC`, where local equals UTC, so it can't see this.
CLAUDE.md's "client-timezone-only by design" line describes the code, but the
storage convention makes it wrong outside UTC.

**Status: fixed on `fix/officials-wall-clock` (committed, held, 2026-11-09).**
Official `eb0e0562…` (test org "SRALL", Fall 2026; Monday 17:00–20:00 only)
holds two Saturday assignments, and NEITHER came from this bug (a Saturday
can't match a Monday window in any zone): Sep 19 11:30 was written by
auto-assign on 2026-07-15 03:46 UTC in a 12-row batch, about an hour before
the strict-by-default commit, while the engine still ran its relaxing
fallback tier by default; Nov 7 12:00 was a single-row write 41 seconds after
a role rename — a manual assignment.

This must be fixed BEFORE the claim function exists: the SQL claim check will
use the wall-clock rule (the house rule), and a TypeScript twin that disagrees
with it would offer, refuse and report different things. It is its own
branch: wall-clock helpers in `eligibility.ts` (date/weekday/minutes from the
`scheduled_at` substring, like `game-days.ts`), the same for the manual
picker's blackout path in `conflicts.ts`, `sim:officials` run under three host
zones (UTC, Los Angeles, Kiritimati) with literal expected values, and a
mutant restoring `getHours()` killed only outside UTC.

### 5. Reusing the volunteer pieces — the fence decides how

- `sim:volunteer-leaks` U1 (decided 2026-11-09) forbids any officials file
  from reaching `src/lib/volunteers` or `src/components/volunteers`. So
  "reuse" means LIFT the neutral pieces into a shared module, never import
  across:
  - `email-headers.ts` (From "<League> via FieldSlate", reply-to sanity,
    address shape) and the drain core (`outbox-drain.ts`: take → render →
    send with idempotency key → finish, retry rules) move to
    `src/lib/outbound-email/`. Volunteer emails must stay byte-identical —
    pinned by golden output recorded before the move.
  - The token pattern (32 random bytes, sha256 stored, plain token only in the
    email payload until sent — 0121's manage links) is copied as a rule, not
    shared as code, because it lives in SQL.
- `volunteer_outbox.volunteer_id` is NOT NULL, so officials get their own
  `official_outbox` with the same shape and the same "ids only, never a name
  or address in the payload" CHECK. Keeps the archive wipe and both fences
  simple.
- `org_features` (0120) is a generic switch table and isn't in U1's word
  list; a new feature key `'official_signup'` is safe to read from officials
  code.
- Not reused: Turnstile and the IP/email rate events. There is no public form
  — the link is the credential. A per-link attempt limit stays (cheap).
- The tracker needs nothing: it counts `game_umpires` for officials an admin
  set "Counts for [team]". A self-claim counts like any assignment.

---

## Design

### Tables (0124 — confirm with `list_migrations` before numbering)

- `official_divisions(umpire_id → umpires ON DELETE CASCADE, division_id →
  divisions ON DELETE CASCADE, primary key both)`. No rows = all divisions.
  Same season enforced (division's league = official's season), by the write
  function. Authenticated SELECT under RLS; writes through a function.
- `official_signup_settings(owner_id pk → profiles, enabled bool default
  false, contact_email text)` — PER LEAGUE (the org), not per season: one
  on/off and one officials contact email for every season, like the volunteer
  settings. The officials contact email is the reply-to on
  every officials email AND the address the coordinator's notices go to (the
  drop email, the daily digest). Link use needs Elite + the switch + a contact
  email + the setting on. NEVER falls back to an account email (the volunteer
  rule). Drops close a FIXED 48 hours before the game (decision 6).
- `official_signup_links(token_hash pk, umpire_id, season_id, created_at,
  revoked_at)`; partial unique index: one current link per official.
- `official_self_claims(game_umpire_id pk → game_umpires ON DELETE CASCADE,
  umpire_id, claimed_at)`. Marks which assignments the official took
  themselves. Keeps `game_umpires` unaltered (the 0123 tracker proof pins it
  byte-identical).
- `official_outbox` — volunteer_outbox's shape with `umpire_id` (nullable for
  coordinator mail); kinds `help_request`, `claim_confirmed`,
  `drop_confirmed` (to the official), `drop_notice` (to the coordinator, sent
  at once — decision 8) and `claims_digest` (to the coordinator, once a day,
  only when there were claims). No privilege for any role; take/finish
  functions service_role only.
- Archive wipe trigger (the 0120 pattern, NULL → set only): deletes links,
  self-claim marks, outbox rows and settings for the season. Assignments
  themselves stay — they are the league's officiating and pay record, as today.
  `volunteer_archive_holds` is NOT extended: nothing here is personal data
  beyond what the officials roster already holds.

### Functions (rules in SQL; the claim is the guard)

- `official_claim_problem(...)` — pure SQL eligibility, callable by no role,
  the port of auto-assign's `pick()` plus two additions, in this order:
  game status `scheduled` and not past (league timezone) → division needs
  officials and the role is one of its slots → slot empty → official not on
  the game → division allowed (`official_divisions`) → blackout (wall-clock
  date) → coach link → conflict of interest → overlap with their other games
  (each game's own division duration, 90 default) → availability window
  (wall-clock) → weekly cap (Mon–Sun, wall-clock).
  **ONE RULE, TWO LANGUAGES, ONE TABLE:** a case table between
  `OFFICIAL-ELIG-TABLE-BEGIN/END` markers in the SQL proof; the SQL runs it
  through this function, `npm run sim:official-eligibility` parses the same
  block and runs it through the (fixed, §4) TypeScript checks auto-assign
  uses. Never a second copy.
- `official_signup_page(p_token)` — service_role. `unknown` for anything
  wrong (bad link, revoked, switch off, setting off, archived — a link never
  reveals the feature). Returns the official's first name, league name, their
  own upcoming assignments, and open spots in allowed divisions: date, time,
  field, matchup, division, role, and either "can take" or the official's OWN
  reason it can't ("You have a game then", "Outside your availability",
  "Your blackout date", "Your weekly limit"). Never another official's name,
  contact or reasons; a filled spot is simply not listed.
- `official_claim(p_token, p_game_id, p_role_id)` — service_role. Link → gates
  → advisory locks (the official, then the game) → `official_claim_problem`
  on live rows → insert `game_umpires` (canonical role name + `role_id`) and
  `official_self_claims` → queue `claim_confirmed` + `coordinator_notice`.
  Unique-index backstop answers `just_taken`. Never raises for a refusal.
- `official_drop(p_token, p_game_umpire_id)` — only a self-claimed row, only
  while the game is MORE than 48 hours away (league wall clock); deletes the
  assignment, queues `drop_confirmed` and an immediate `drop_notice`. Inside
  48 hours, or for an assignment the coordinator made, the page shows the
  officials contact email instead (decision 6).
- `official_digest_queue()` — service_role, run by a daily cron: one
  `claims_digest` per season whose self-claims since the last digest are not
  empty; marks them reported.
- `send_official_help_request(p_season_id, p_umpire_ids, p_division_ids)` —
  authenticated, member → switch → Elite → not archived → setting on with a
  contact email. Per official: refuses (by name) one with no usable email;
  mints a fresh link (revokes the old); queues ONE `help_request` whose spot
  list is computed at SEND time by the drain (take attaches the official's
  currently claimable spots, like 0121's `volunteer_email_spots`), so the
  email never lists a spot taken meanwhile. At most one help email per
  official per 24 h. Returns counts + the names skipped and why.
- `set_official_divisions(p_umpire_id, p_division_ids)` — member, same season.
- `insert_official_assignments(p_season_id, p_rows)` — auto-assign's new
  write: same locks, re-runs `official_claim_problem` per row, inserts the
  rows that still fit and returns the ones that don't as `taken_meanwhile`.
  Closes races 1 and 2. Auto-assign's selection logic stays in TypeScript.

### Screens

- **Official's page `/o/<token>`** (shell + client, noindex, not framable,
  outside the middleware, `referrer: no-referrer` — the manage page's rules).
  Youth official: header "Signing up for <Name>" so a parent knows whose
  games these are. "Take this spot" → confirm → result. Own assignments with
  "Drop" where allowed (else "Contact <league>" with the contact email).
- **Coordinator, `/dashboard/umpires`:** an "Ask for help" dialog — pick
  divisions (default: those with open spots), see each official with their
  claimable-spot count, tick who gets the email; officials with no email are
  listed greyed with "Add an email" links. Shows the result counts verbatim.
- **Official profile:** "Divisions" (all, or a chosen list), the email field
  labelled "Parent or guardian email" when designation is youth, and the
  sign-up link: the help email carries it, and **"Copy new link (the old one
  stops working)"** mints a fresh link, revokes the old one, and copies the
  new one once — the only way to text a link to an official without email
  (decision 4; only the hash is stored, so no link can be shown twice).
- **Settings card** (only when the switch is on): on/off, contact email,
  drop cutoff.
- **Assignment chips:** a self-claimed assignment shows a small "Signed up"
  tag in the slot UI so the coordinator can tell it from an auto pick.
- Auto-assign and the manual picker gain the division rule (auto: hard; manual:
  warn-with-override, the house asymmetry).

### Emails (via `src/lib/outbound-email/`)

From "<League> via FieldSlate" at FieldSlate's address, reply-to the
officials contact email. Youth: sent to the email on file, worded to a parent
("<League> needs officials. Here are games <Name> can take."). Templates fail
closed (an unrenderable email fails the row, never sends blank). Drain: a
second cron path, or the existing 5-minute cron runs both outboxes —
recommend one route calling both drains (one cron slot, Pro already).

---

## Privacy policy changes (ship first, like volunteers phase 0)

- Section 1/2: if a league uses officials sign-up, FieldSlate emails the
  official (or, for youth officials, the parent/guardian email the league
  entered) a private link on the league's behalf; what the page shows (the
  official's own games, availability and blackout reasons, open spots — never
  other officials' details); that anyone holding the link can take or drop
  spots for that official.
- Section 7 (minors): for an official under 18 the emails go to the
  parent/guardian address the league entered, and the parent decides (or lets
  the youth official use the link). We still don't collect information
  directly from anyone under 18 — but a claim made through the link does
  record which games were chosen; legal review should confirm that wording.
- Retention: links and sign-up records deleted when the season is archived;
  assignments kept as the league's records (as today); backups 30 days.
- Emails: replies go to the league; no marketing use.
- `/help/officials-signup`, noindex until launch.
- Launch blocker, same as volunteers: legal review of sections 1 and 7, and
  reply-to verification for the contact email.

---

## Harnesses (house standard)

- Prereq branch: `sim:officials` across three zones + wall-clock mutants.
- SQL proof (rolled back in the "test" org with "Test 2"; holds locks only
  after Whit's go): the ELIG table, page never naming another official
  (key-set check, the KY1 pattern), claim/drop/help/insert races (two claims
  for one slot; claim vs `insert_official_assignments` overlap), archive wipe,
  privileges per role, leak check. One mutant per check, each killed at its
  own tag.
- `sim:official-eligibility` (shared table, 3 zones), `sim:official-signup-page`,
  `sim:official-help-request`, each with `:mutants`.
- Fences: a new officials-signup fence (no print/export/feed/public file
  reaches the link or claim code; `official_signup_page` names no other
  official); U1 extended so `src/lib/outbound-email` may be imported by both
  sides but imports neither.

## Branches, in order (each held for Whit's go)

0. `fix/officials-wall-clock` — §4. No migration. Corrects the CLAUDE.md line.
1. Privacy policy + help page (noindex).
2. `chore/outbound-email` — lift the shared email pieces; volunteer emails
   byte-identical by golden.
3. 0124 part 1 — `official_divisions` + its UI; auto-assign and the picker
   honor it. Useful on its own.
4. 0124 part 2 — settings, links, claims, drop, outbox, help request,
   `insert_official_assignments` (auto-assign switches to it here).
5. Screens — official page, Ask for help, profile, settings card.
Switch on for the two test orgs only ("SRALL" `aa21d01c…`, "test"
`bbf9afe1…`). Never the real league.

## Decisions (2026-11-09)

1. **Divisions default — DECIDED:** an official with no division list may
   claim in every division (the availability-window rule: no rows = no limit).
2. **Youth = under 18 — DECIDED:** "youth" is the policy's "under 18"; the one
   email field is relabelled "Parent or guardian email" for youth officials. No
   new column.
3. **Locked divisions only — DECIDED:** spots are offered only in LOCKED
   divisions (a regenerate deletes games and their assignments).
4. **Officials without email — DECIDED:** the profile's button reads "Copy new
   link (the old one stops working)" and does exactly that.
5. **Contact email — DECIDED:** a separate officials contact-email setting.
6. **Dropping — DECIDED:** officials drop only spots they claimed, until 48
   hours before the game; inside 48 hours the page shows the officials contact
   email.
7. **Hold window — DECIDED:** none in v1 (send help, wait, auto-assign the
   rest).
8. **Coordinator notices — DECIDED:** claims go in one daily digest email plus
   the "Signed up" tag in the app; each drop sends an immediate email.
9. **Auto-assign wall-clock fix — DONE:** `ef8fd43`, live 2026-11-09.
