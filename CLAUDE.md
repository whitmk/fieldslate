# CLAUDE.md

Operational guidance for working in this repo. [README.md](README.md) covers the
stack, data model, and code conventions — read it first. This file holds the
production-critical, easy-to-get-wrong facts, mostly around billing and URLs.

## Docs split — where knowledge goes

- **This file (repo CLAUDE.md)** gets anything about how FieldSlate works:
  schema facts, code conventions, guard patterns, gotchas a future code
  change must respect.
- **Local memory notes** (`~/.claude/projects/.../memory/`) get anything
  about how sessions verify and operate: tooling quirks, harness tricks,
  environment workarounds.
- When in doubt, repo — it's the reviewed, versioned, recoverable store.

## Deployment & environment

- **Production-only.** Every push to `main` auto-deploys to production via
  Vercel. There is no staging environment. `npx tsc --noEmit` and
  `npx eslint <touched paths>` must pass before every commit.
- **Check the queue before every push.** Run
  `git log origin/main..main --oneline` and push only approved commits —
  held commits from earlier sessions (or worktree/chip sessions) can be
  sitting on local `main` and would ride along silently (this happened
  2026-07-14: a held docs commit shipped uninspected alongside an approved
  one).
- **Stripe is LIVE.** The keys in Vercel are live-mode keys; real cards get
  charged. There is no test-mode deployment. Any change to checkout, webhook,
  or pricing code ships straight to paying customers on the next push.
- **Vercel env vars are PROJECT-scoped.** When checking or setting an env var,
  look at the fieldslate *project's* settings, not team-level settings — a var
  that exists at one scope and not the other has caused confusion before.
  Values in the Vercel dashboard cannot be verified from this repo; say so
  rather than assuming.
- **Deploy watching:** verify the watch mechanism with one successful poll
  BEFORE announcing a watch is armed, and poll deploy status no faster than
  every 60s — deploys take 60–90s, faster polling only burns the API quota.
  Status source:
  `curl https://api.github.com/repos/whitmk/fieldslate/commits/<sha>/status`
  (no `gh` installed).
- **Canonical domain is `https://www.thefieldslate.com` (with www).** The bare
  domain 307-redirects to www; Stripe webhooks and Supabase auth callbacks are
  configured against www only, so links that land users (or mail-client image
  fetches) on the bare domain hit a redirect hop at best and break at worst.
  Every generated absolute URL must use `SITE_URL` from `src/lib/site.ts` —
  never `NEXT_PUBLIC_APP_URL`, never `VERCEL_URL`, never a hardcoded string.
  (`window.location.origin` in client-side auth redirects is fine — the user
  is already on www.)

## Database & migrations

- Migrations live in `supabase/migrations/` (numbered `00NN_name.sql`).
  **Latest migration: 0077.** The repo files are the record, not the
  applicator — apply via the Supabase MCP/dashboard, and verify schema changes
  against the live catalog before writing code that depends on them.
- **`service_role` gets NO default grants on new tables in `public`.** This
  project's Postgres does not grant service_role DML on newly created tables,
  so any table the admin client (`src/lib/supabase/admin.ts`) reads or writes
  needs an explicit `grant ... to service_role` in the migration. Forgetting
  this is exactly what caused the comp-guard 42501/503 outage fixed by
  migration 0070 (every checkout returned 503 until the grant landed).
  service_role bypasses RLS but NOT table-level privileges.
- **PostgREST silently caps every query at 1000 rows.** No error is raised —
  partial results are indistinguishable from complete ones. Season-scoped
  queries (`.eq("league_id", …)`) are safe at current scale; the exposure is
  any query NOT scoped to a single season (org-wide / all-time sweeps). The
  Schedule venue-options query and the calendar query both inherit this cap
  deliberately — fine now. Before onboarding a customer with large historical
  data, audit cross-season queries and add pagination or a hit-the-cap guard
  as one uniform pass.

## Billing — read this whole section before touching Stripe code

- **Season-as-unit-of-sale.** Every purchase is `mode: "payment"` (one-time,
  no subscriptions) for exactly one season. Price IDs come from env only.
- **quantity is ALWAYS 1. DO NOT rebuild a quantity=2 path.** The old
  "Free→paid upgrade buys 2 seasons (convert one + provision one)" branch
  double-charged customers ($258/$498 instead of $129/$249) and was removed in
  migration 0069. `process_checkout_event` treats any non-1 quantity as
  plan-flip only and provisions nothing; `/api/stripe/checkout` rejects
  `quantity !== 1`. A Free→paid upgrade converts the org's existing season in
  place; add-season buys one more; `upgradeOnly` (Pro→Elite, $120 delta) flips
  the tier without adding a season.
- **Webhook idempotency is claim-first, inside the RPC.** Stripe delivers
  `checkout.session.completed` at-least-once and retries for ~3 days.
  `process_checkout_event` (migration 0067) claims `event.id` in
  `stripe_events` as its FIRST statement (insert … on conflict do nothing) and
  returns `skipped_duplicate` before any read or write; the pre-update plan
  read (`wasPaid`) happens after the claim, in the same transaction. **Do not
  add dedup logic in the webhook route** — the route verifies the signature,
  runs the comp guard, and calls the RPC; that's all it should do.
- **The webhook never reads `payment_status`** — it keys only off
  `event.type === "checkout.session.completed"` plus session metadata
  (`orgId/plan/quantity/upgradeOnly`, all strings). Consequences: a $0
  (fully-discounted) session provisions exactly like a paid one — good; but a
  session completed with an async payment method (ACH-style,
  `payment_status: 'unpaid'`) would also provision immediately, and
  `checkout.session.async_payment_failed` is unhandled. This is moot while the
  Stripe dashboard is card-only; revisit before enabling any async payment
  method.
- **The webhook handles ONLY `checkout.session.completed`.** Every other
  event type — `charge.refunded`, all dispute events, anything else Stripe
  sends — is acked with a 200 and dropped. A refund therefore does NOT
  auto-downgrade the plan or remove the provisioned season; refund/dispute
  cleanup is manual by design for now.
- **`profiles.comped` means "billing must never touch this row"** — it is
  independent of `plan` and exists so the team's own accounts can smoke-test
  production safely. `/api/stripe/checkout` fails CLOSED: 403 if comped, 503
  if comp status can't be confirmed (read error / missing row). The webhook
  acks + no-ops a comped org's event (`skipped_comped`) and returns 500 on an
  unconfirmed read so Stripe retries. **To convert a comped account into a
  paying one, clear `comped` BEFORE starting checkout** — while set, every
  checkout is blocked and every webhook is a no-op.
- **`comped` covers two populations:** the team's own smoke-test accounts
  AND founding-league comps (see COMPING-RUNBOOK.md) — do not treat comped
  rows as disposable test data.

## Promo codes

- **Flow:** `/signup?promo=CODE` → trimmed/uppercased into auth metadata →
  `handle_new_user` trigger writes `profiles.pending_promo` (migration 0071,
  deliberately no allowlist) → after email verification, the checkout paths
  resolve the code via the `promo_codes` table (`resolvePromoCoupon` in
  `src/lib/promo.ts`) and attach `discounts: [{ coupon }]` →
  `process_checkout_event` clears `pending_promo` unconditionally on the first
  successful checkout, so a promo rides exactly one purchase.
- **Promo codes are table-driven.** To add/expire/repoint a promo, edit the
  `promo_codes` row (code → `stripe_coupon_id`, `active`, `expires_at`) — no
  deploy needed. `STRIPE_INTERLEAGUE_COUPON_ID` is a legacy fallback used only
  if the table read *errors* (not "no row") and only for INTERLEAGUE; do not
  build new promos on env vars.
- **INTERLEAGUE currently maps to Stripe coupon `INTERLEAGUE2`** (20% off).
  The original `INTERLEAGUE` Stripe coupon expired 2026-06-29 and is dead —
  the *code* customers' links carry is still INTERLEAGUE; only the coupon
  behind it changed. `INTERLEAGUE2` has Stripe `redeem_by` 2027-07-30; the
  `promo_codes.expires_at` is 2027-07-25 (5 days earlier, so we stop
  attaching it before Stripe would reject it).
- **Both checkout creators honor `pending_promo` — do not re-investigate the
  "recovery-path promo gap."** `/api/auth/callback` (primary) and
  `/api/stripe/checkout` (dashboard-CTA/upgrade retry path) each read
  `pending_promo` and resolve it via `resolvePromoCoupon` with the same
  fail-soft + retry-without-coupon behavior; the retry path gained this in
  commit `7389614` (pushed 2026-07-02) and it was re-verified 2026-07-14.
  These are the ONLY two session creators; all client checkout buttons POST
  to `/api/stripe/checkout`.
- **Coupon XOR promotion codes:** `createCheckoutSession` sets
  `discounts: [{ coupon }]` when a coupon was resolved, otherwise
  `allow_promotion_codes: true` (Stripe forbids both on one session). So every
  couponless checkout — including upgrades and add-seasons — shows the typed
  promo-code field.

## Blog

- **Architecture:** markdown files in `content/blog/` (frontmatter: title,
  description, slug, datePublished, dateModified) parsed with `gray-matter`,
  rendered with `react-markdown` via explicit per-element styled components.
  `src/lib/blog.ts` reads posts at build time; routes live in
  `src/app/(marketing)/blog/` (index + `[slug]`, fully static via
  `generateStaticParams`, unknown slugs 404). `src/app/sitemap.ts` hardcodes
  the marketing routes and generates blog entries from the posts lib, so new
  posts appear in the sitemap automatically; `public/llms.txt` describes the
  site for LLM crawlers. All absolute URLs come from `SITE_URL`.
- **Live articles:**
  https://www.thefieldslate.com/blog/sports-connect-alternatives-little-league
  https://www.thefieldslate.com/blog/little-league-scheduling-software
- **FAQPage JSON-LD comes from frontmatter.** A post with an optional `faq`
  list ({question, answer} pairs, answers plain text — no markdown) gets a
  FAQPage block on its page; `src/lib/blog.ts` fails the build on a malformed
  `faq` entry. Caveat: FAQ text lives in TWO places per file — the body's FAQ
  section (what readers see) and the frontmatter `faq` list (what search
  engines see) — so any FAQ edit must update both or they silently drift.

## Playoffs

- **Playoff advancement is client-side by design.** Saving a result
  (`src/lib/playoffs/enter-result.ts`) writes the completed row and then
  populates downstream team slots from the browser — no DB trigger, no API
  route. This assumes a single admin enters results; two admins saving
  concurrently could race (stale `allGames` → wrong/blocked advancement).
  Revisit (move into a DB function) if concurrent leagues / multi-admin
  result entry becomes real. The single- and double-elim mappings live in
  `src/lib/playoffs/advancement.ts` (pure, testable — see its header for
  the movement rules and edit semantics).

## Schedule filters

- **Stale filter URL params don't reconcile (except team).** The Schedule
  page's `?division=` and `?venue=` params survive a switch to a division
  that makes the selection invalid — the DB `.eq` still filters (→ "No games
  found") while the dropdown visually falls back to "All …". Only the team
  filter reconciles (`effectiveTeamId` in the server page). Division and
  venue are consistent with each other by design for now; if reconciliation
  is ever added, apply it to BOTH uniformly, not one.

## Generate-all ordering

- **`npm run sim:scarcity` proves the "generate all divisions" run-order**
  (season-page control): divisions schedule most-constrained-first, sort key
  `slack = supply − demand` with tiebreak `supply → created_at → id`. Re-run
  it after ANY change to `src/lib/schedule/scarcity-order.ts` or to
  `buildSlots` in `generate-schedule.ts` — the scarcity supply is computed
  from the REAL `buildSlots`, so a change there can silently shift ordering.

## Coach conflicts in schedule generation

- **Same-division shared-coach double-booking is a KNOWN, deliberately
  deferred gap — do not build on the "handled automatically" assumption.**
  The generator prevents a shared coach's teams from overlapping
  *cross-division* via the coach-block map (seeded from the linked team's
  already-persisted games). It does NOT prevent one coach's two teams in the
  SAME division from being placed at the same start time on different fields.
  The same-division skip (`if (sameDiv) continue;` at
  ~`generate-schedule.ts:818`, mirrored in `finishSchedule` ~1607 and
  `planScheduleForNewDivision` ~1303) rests on the comment "handled
  automatically since both teams always play different opponents" — that
  comment is FALSE and verified so: the two teams play each other only
  once/twice a season; their games against other opponents are independent
  and can collide. Exposure concentrates in tight/small divisions where slots
  force overlap. Deferred (wait-and-see) because no current league assigns one
  coach to two teams in one division.
- **Fix path when triggered:** live in-walk coupling — block the coach's other
  same-division team at each placed start time — applied in BOTH placement
  copies (`planSchedule` and `finishSchedule`'s inline copy), with the
  three-part harness standard. **Build trigger:** the first league with a
  same-division double-coach, or any report of an intra-division coach
  double-booking.

## Team names — two copies, one rename path

- **Name-keyed-reference drift is a bug FAMILY, not one bug.** Team identity
  is stored redundantly: the `teams` table (id-keyed, authoritative) and
  `divisions.settings.teams[]` jsonb (name-keyed copy, including name-keyed
  `conflict_team` back-references). ANY operation that changes or removes a
  team must update BOTH or they silently diverge. Rename is fixed (`1296df9`,
  below); the panel's `handleDeleteTeam` still leaves the jsonb stale on
  delete — same family, different trigger, still open. **Rule: never add a
  second code path that writes a team name or removes a team — route through
  `src/lib/divisions/reconcile-teams.ts`.**
- **Historical damage:** a wizard rename on SRALL Fall 2026 T-Ball created a
  duplicate `teams` row (the wizard reconciled by name and only inserted
  net-new names), splitting one real team across two identities and
  corrupting the schedule. Cleaned up manually 2026-07-22 (uuid-scoped
  deletes, verified table == jsonb after). Two benign known drifts remain
  by choice: the archived SRALL "A" division's `Jackets` orphan row, and
  trailing-whitespace-only jsonb names in Rookies (the generator trims).
- **`src/lib/divisions/reconcile-teams.ts` is the SINGLE rename path.** Both
  surfaces route through it: the wizard save (`reconcileTeamsOnSave`, called
  from `step-review.tsx`) and the inline schedule-panel pencil
  (`renameTeamInline`, called from `division-schedule-panel.tsx` — it has NO
  bare `teams.update({name})` anymore; do not reintroduce one). A rename
  UPDATEs the row in place, rewrites this division's jsonb entry, AND rewrites
  every division's `conflict_team` references (in-division and cross-division,
  matched by the ref's `conflict_division`).
- **Identity is the threaded `TeamEntry.id`.** At edit-load
  (`division-section.tsx` → `mergeLiveTeamsWithJsonb`) the wizard's
  `data.teams` is rebuilt from the LIVE `teams` rows (id + name authoritative),
  layered with jsonb coach metadata by name. `team_count` follows the live
  count so the length-sync effect can't truncate a duplicate out of view. An
  entry with an `id` whose name changed = RENAME (UPDATE in place, never a new
  row); an entry with no `id` = genuine ADD (insert). `id` is NEVER persisted
  into the jsonb (`toJsonbEntries` strips it) — identity stays on the row.
- **Removals are report-only — never delete a team here.** `teams` has CASCADE
  children (`practice_slots`, `team_availability_blocks`,
  `team_game_constraints`, `official_conflicts`), so deleting a "games-empty"
  team could silently destroy a coach's entered data. An omitted team is KEPT,
  re-appended to the jsonb (so the two copies still agree), and surfaced as a
  non-blocking notice. Deletion is a separate, explicit action on the schedule
  panel — out of this path.
- **Read-only blast-radius banner:** `detectTeamJsonbDrift` runs at edit-load
  and shows a non-blocking notice when a division's live teams disagree with
  its jsonb list (the corruption shape). Detection only — no auto-repair.
- **Harness:** `npm run sim:team-reconcile`
  (`scripts/sim/team-reconcile-sim.ts`) — drives the real functions against a
  fake client; asserts rename→zero new rows, add→insert, team-with-games never
  destroyed and reported, teams/jsonb agree after every op, `conflict_team`
  rewritten in both scopes, collision aborts with no writes. Mutation-tested
  (detection mutants + in-source guard disables all caught) with anti-vacuity
  counters. Re-run after ANY change to `reconcile-teams.ts` or the two call
  sites. **Still open in this family:** the panel's `handleDeleteTeam` leaves
  the jsonb stale on delete (delete path, not rename). SRALL's duplicate rows
  were repaired 2026-07-22 — see Historical damage above.

## Venues

- **The venue editor is ONE shared component** (2026-07-14): `VenueEditForm`
  plus its `VenueEditModal` wrapper in
  `src/components/venues/venue-edit-form.tsx`. Hosts: the Venues page and
  its /setup embed render it inline; the Practice tab's weekly grid opens
  it in the modal via a per-field pencil. Edit venue fields/validation in
  the shared component, never in a host. The Practice tab holds only
  `{id, name}` per venue, so the pencil fetches the full `venues` row on
  click; after save the modal awaits the page's `load()` — in-place
  refresh, and a venue whose hours were cleared correctly drops off the
  grid (it only shows availability-configured venues).
- **The shared editor contains NO `<form>` element — by design.** This is
  the generalized official-profile-sections lesson: a component built for
  reuse must not depend on implicit form submission, because React submit
  events bubble through nested forms and any host `<form>` would capture
  them. All its buttons are explicit `type="button"`. Keep both properties
  when extending it, and hold any new reusable form-ish component to the
  same rule.
- **The practice surface gets venue EDIT only** — no deletion there, and
  the mobile day view has no edit affordance (its venue cards are
  whole-row `<button>` tap targets; nesting an edit button would be
  invalid HTML). Phone users edit venues on the Venues page.

## Interleague invites

- **Invite status is STORED, not derived.** `interleague_invites.status`
  (`pending`/`accepted`/`declined`/`superseded`) is the single source of
  truth the dashboard badge renders. Every response write happens inside the
  SECURITY DEFINER RPCs `accept_interleague_invite` /
  `decline_interleague_invite` (latest: 0074/0075) in one transaction — a
  response row cannot exist while its invite still reads pending. Do not add
  status writes or dedup logic in the routes; they validate input, call the
  RPC, and send emails — that's all.
- **Supersede asymmetry is deliberate (0074 accept, 0075 decline).**
  Accepting an invite marks ALL sibling pending invites (same `season_id` +
  `interleague_org_id`) `superseded` — acceptance resolves the pairing, and
  any surviving sibling would allow double-scheduling. Declining supersedes
  only siblings with `created_at` EARLIER than the declined invite — a
  decline of an old duplicate must never kill a newer corrected invite, and
  a decline only proves the sends before it are dead. Don't "simplify" the
  two rules to match; the difference is the point. (Eternally-pending
  duplicate invites were the root cause of the recurring "still shows
  pending after they accepted" reports.)
- **Email sender identity comes from the RPCs.** The responding recipient is
  anonymous and cannot read `profiles` under RLS, so both RPCs return
  `sender_org_name` (`profiles.org_name`) alongside `sender_name` — the ONLY
  path for the acceptance/decline-flow emails to name the sending league.
  Every email site fails soft: `org_name` → `full_name` → email → literal
  fallback; a null can never reach a subject. Naming trap: in the RPC
  returns, `org_name` is the RECIPIENT partner org (`interleague_orgs.name`)
  and `sender_org_name` is the sending league — don't swap them.
- The public invite page renders honest status screens for
  accepted/declined/superseded revisits (fed by `updated_at` +
  `scheduled_game_count`, added to `get_interleague_invite_by_token` in
  0074); only genuinely invalid tokens get the not-found screen. The
  interleague dashboard refetches on tab focus/visibility — deliberately no
  polling and no realtime.
- **`venues.capacity` is informational-only** (UI label "Number of fields"
  since 2026-07-14): nothing in the codebase reads it — conflict detection
  treats every venue as ONE field regardless of its value. The separate,
  actually-consumed fields concept is `interleague_orgs.field_count` (the
  schedule generator caps same-day away games per partner org). If capacity
  is ever wired into conflict detection, update the helper copy on the
  venues page in the same change.

## Officials / umpires

- **Schema map:** `umpires` roster is per-season (0023, `season_id` NOT NULL);
  per-game assignments in `game_umpires` (0025, UNIQUE(game_id, umpire_id) and
  UNIQUE(game_id, role)); division requirements `umpires_per_game` +
  `umpire_roles` jsonb (0024); pay tracking (0026); contact columns +
  `official_roles` / `official_availability` / `official_blackouts` /
  `official_certifications` + nullable `role_id` + `toggle_assignment_paid`
  RPC (0062); `umpires.team_id` coach link + `divisions.priority` (0063);
  `official_conflicts` non-coach conflict-of-interest links, UNIQUE(umpire_id,
  team_id) (0073). `official_roles` (not `divisions.umpire_roles`) is the
  source of truth for slot labels — the two diverging once made assigned
  slots read "Open".
- **Zero availability windows = available anytime** (enforced in
  `src/lib/umpires/eligibility.ts`). Availability is opt-in detail, not a
  requirement — never make windows mandatory or treat their absence as
  unavailable.
- **`umpires.team_id` = the team this official coaches** (ON DELETE SET NULL).
  Conflict philosophy: manual assignment (`umpire-slots.tsx`) WARNS after
  save and lets the commissioner override; auto-assign
  (`src/lib/umpires/auto-assign.ts`) hard-blocks coach conflicts, blackouts,
  and double-booking at every tier. Keep that asymmetry. `official_conflicts`
  rows (0073, parent/sibling/family/other) get the identical treatment:
  warn-with-override on manual, hard-block on auto-assign.
- **Auto-assign NEVER assigns outside availability or over weekly caps —
  no opt-in exists (removed 2026-07-21; was strict-by-default with a
  fallback checkbox from 2026-07-14).** An assignment outside an official's
  stated availability or weekly cap is a commitment they never made, so the
  engine has exactly one tier and no `allowOutsideAvailability` parameter.
  Slots nobody qualifies for stay OPEN and are reported with
  `outside_availability` / `over_weekly_limit` skip reasons plus the names
  of the officials blocked only by them (the "ask them first, then assign
  manually from the game" list). Manual assignment is the only override
  path: the picker shows those officials as flagged-but-selectable
  ("outside listed availability"). Both entry points — the season button
  and the per-division button — share the confirmation dialog copy via
  `auto-assign-button.tsx` so wording can't drift. Don't rebuild a
  relaxation tier or any machine path around availability/caps.
- **All eligibility date math is client-timezone-only by design** (see the
  `eligibility.ts` header). On a server, "local" is UTC and day/week
  boundaries shift silently — any server-side or DB-side use must add an
  explicit timezone parameter first.
- **Naming traps:** `blackout_dates` is season-level scheduling blackouts;
  `official_blackouts` is per-official unavailable dates. `official_conflicts`
  (0073, officials' conflict-of-interest links) is unrelated to
  `conflict_overrides` (0064, the game-scheduling override audit trail).
  Don't mix them up.
- **The `official-profile-sections.tsx` add-forms call `e.stopPropagation()`
  in `handleAdd` — never remove it.** Those sections are reused inside the
  edit-official modal's `<form>`; React submit events bubble through nested
  forms, so without it, adding a window/blackout also fires the modal's
  profile save and closes it. Verify event handling any time a component
  with a form is reused inside another form.
- **Conflict overlap/blackout logic is shared.** `findUmpireConflict`
  (`src/lib/umpires/conflicts.ts`) is a thin fetch over the exported pure
  functions `bookingsFromRows` / `findConflictInBookings`, and the picker's
  pre-click option states (`umpire-slots.tsx`) use the same functions. Never
  write a parallel implementation — extend the shared ones.
- **Open question, deliberately consistent in both places:** bookings on
  cancelled games still count as time conflicts (save-time and pre-click
  agree). Revisit alongside rainout workflows.
- **Scale note:** the picker roster feeds (game-detail-modal,
  division-schedule-panel) embed each official's FULL booking rows per
  fetch. First suspect if picker-open slows at large-league scale.
- **Season-wide auto-assign is orchestration only.** `autoAssignSeason`
  (`src/lib/umpires/auto-assign-season.ts`) runs the unchanged per-division
  engine in ascending `divisions.priority` order (name tiebreak, matching
  the priority card). No state is threaded between runs — the engine
  re-reads all `game_umpires` at the start of every run, so each division
  sees earlier divisions' assignments; anything that turns that refetch
  into a snapshot breaks the compounding. Zero-slot divisions are reported
  (`no_slots_required`), a division error is recorded and the sequence
  continues, and re-running assigns nothing (the engine fills empty slots
  only). Entry point: "Auto-assign season" on /dashboard/umpires next to
  the priority card; the per-division button in the division schedule
  panel is a separate surface sharing the same confirm-dialog
  components. Runtime is ~7 sequential browser
  queries per division — fine at current scale; needs progress UI or a
  server move (which first needs the timezone param) if leagues get much
  larger.
- **The engine takes an optional injected client:**
  `autoAssignUmpires(divisionId, seasonId, client?)`, default
  `createClient()`. The seam exists ONLY so the simulation harness can
  drive the real engine against in-memory fixtures — production callers
  omit it. Don't remove it and don't add other client-construction paths.
- **Simulation harness:** `scripts/sim/auto-assign-season-sim.ts`, run via
  `npm run sim:officials`. TZ=UTC is mandatory (the harness exits
  otherwise) — it pins the engine's client-local date math for Node; never
  "fix" a harness date issue by adding timezone handling to the engine.
  It fakes only the Supabase client (the exact query/embed subset the
  engine issues, enforcing the game_umpires uniques), runs every shape in
  the engine's single strict mode on fresh fixtures (single-mode since the
  opt-in's removal, 2026-07-21), and asserts the full invariant set — no
  double-booking / blackout / coach / COI assignments ever; ZERO
  assignments outside availability windows or weekly caps under ANY input;
  top-priority division fills its alone-run count, idempotent second run,
  error continuation, skip reasons always reported with soft-blocked
  officials' names — over fixed shapes plus seeded-random seasons, with an
  anti-vacuity counter proving the availability/cap invariants were
  actually exercised. Mutation-tested against the single-tier structure
  2026-07-21 (13 mutants incl. re-adding an unconditional relaxed retry —
  all killed; one proven equivalent via a compound mutant).
  Re-run it after ANY change to auto-assign.ts, auto-assign-season.ts,
  eligibility.ts, or conflicts.ts. If the engine grows a new query shape
  the fake client throws — extend the fake, don't stub the query.
- **Harness standard (playoff work, extended 2026-07-14) — three parts,
  all required:**
  1. **Real code, full playthroughs.** Drive the actual functions under
     test end-to-end (fake only the environment, never the logic).
  2. **Mutation-tested.** A harness isn't proven until deliberately broken
     code fails it: disable each protection / invariant-bearing branch one
     at a time (hard blocks, tier gating, ordering, error continuation,
     idempotency guards, result reporting), confirm the harness fails
     EVERY mutant, then restore and re-verify green.
  3. **Anti-vacuity counters.** Count how often each guarded scenario
     actually occurred (e.g. soft-reason open slots in officials runs,
     per-path deflection counts in the constraints sim) and FAIL the run
     if a counter is zero — a conditional invariant whose condition never
     fires passes while checking nothing.
  A first-run-green harness with no mutation pass and no coverage proof
  proves nothing about its own assertions.

## Team game constraints

- **`team_game_constraints` (0076) is the games-side sibling of
  `team_availability_blocks` (0042)** — same 2-char day codes, same
  time-window shape (`time` columns, both-null = whole day, half-open
  `[start, end)` on the game's START time), and deliberately a SEPARATE
  table: practices and games are decoupled surfaces, and a scope column on
  the practices table would couple its auto-assign engine to game
  semantics. Two severities: `block` (hard, enforced everywhere) and
  `prefer` (soft, ENFORCED as of chunk 2b — the generator's two-pass walk
  below — plus non-blocking heads-up notices on the manual paths).
  **`prefer` = prefer to AVOID the window, decided 2026-07-21 — do not
  reinterpret as positive "prefers to play here" windows.** Windows are
  half-open `[start, end)` on the game's START time — all user-facing copy
  says "start times" on purpose.
- **Every constraint check goes through
  `src/lib/schedule/team-constraints.ts`** (`constraintsFromRows` /
  `findConstraintViolation` / `violatesHardConstraint`) — same
  shared-pure-function rule as the umpires conflict helpers; never write a
  parallel matcher. Client-timezone-only, same stance as `eligibility.ts`:
  any server-side reuse must add an explicit timezone parameter first.
- **The generator enforces `block` rules in BOTH loop copies** —
  `planSchedule` AND `finishSchedule`'s deliberate inline copy. The check
  sits LAST in the filter chain (that's what makes the constraint-blocked
  attribution honest — a rejection there means the slot passed everything
  else) and the constraints read fails CLOSED before any delete/insert.
  Constraint-caused unscheduled matchups are reported distinctly
  (`constraintBlockedCount`, a subset of `unscheduledCount`) in results and
  every surface that shows them, including both total-failure error
  messages. `planScheduleForNewDivision` is exempt BY DESIGN: it plans
  before teams exist in the DB, so no constraint rows can exist for them.
- **Preferences are a TWO-PASS walk (chunk 2b), in BOTH loop copies.** For
  each matchup, pass 1 applies every hard filter plus skips slots either
  local team prefers to avoid; pass 2 runs only when pass 1 assigned
  nothing and ignores preferences entirely (hard filters only) — so a
  prefer rule can NEVER starve a matchup or block anything. Rejected walks
  are read-only; only the assigning iteration mutates the booking maps.
  `preferMissCount` (pass-2 placements inside a prefer window) rides
  `PlanScheduleResult`/`ScheduleResult` and surfaces as NEUTRAL notes —
  never warnings — on the schedule panel, the wizard result screen, and
  the setup step. Don't collapse the two passes into a scoring pass
  without re-running the full mutation suite (4 mutants: each copy's
  hard-block check and pass-1 skip). Add Game modal and the conflict
  resolver's manual move run `block` hits through the existing
  warn-with-override flow, recorded in `conflict_overrides` as type
  `team_constraint` (CHECK extended in 0077); the rainout reschedule modal
  and the resolver's auto-move `findFreeSlot` are pick-from-valid surfaces,
  so blocked slots are FILTERED out with no override path — keep that
  asymmetry. `prefer` hits render live amber notices on Add Game and the
  resolver move form and are deliberately recorded NOWHERE. Message wording
  comes from the shared `formatConstraintRule` — don't hand-write rule
  descriptions. Rules fetch: once per modal-open in the resolver (all teams
  on loaded games — cross-division moves included) and the rainout modal;
  per team-pair in Add Game (teams aren't known at open). Every path fails
  LOUD/CLOSED if the rules read errors — never silently skip the check.
- **Entry UI:** "Team scheduling constraints" section on the Schedule page
  (`team-constraints-section.tsx`), per-division per-team cards cloning the
  practices UnavailabilitySection pattern. Elite-gated in the server page
  via `getOrgPlan` + `!isElite` + `FeatureLockedCard` — the gate wraps the
  ENTRY UI only.
- **Interleague scope is home-team-only** (interleague matchups have
  `awayId: null` — the external org has no constraint rows by definition).
  The interleague reschedule server routes (resolve / respond / the
  token RPC) do NOT run constraint checks — deliberately out of scope;
  constraint checks do not cover the interleague reschedule routes; revisit
  if a real partner league reports a constraint violation via reschedule.
- **Tier-blind data layer, Elite-gated UI.** The constraint-entry UI (not
  yet built) will be Elite-gated like the officials pages; the generator
  honors whatever rows exist regardless of plan, so constraints stay live
  after a downgrade — deliberate, same pattern as officials data. RLS is
  the 0049 `is_org_member` form; grant to `authenticated` only, NO
  service_role grant (client-side consumers only).
- **Harness:** `npm run sim:game-constraints`
  (`scripts/sim/team-game-constraints-sim.ts`, TZ=UTC mandatory — same
  three-part standard as the officials sim). Re-run after ANY change to
  generate-schedule.ts or team-constraints.ts. If the engine grows a new
  query shape the fake client throws — extend the fake, don't stub the
  query. Mutation procedure: disable the constraint check in each loop copy
  one at a time; the harness must fail both times (its per-path deflection
  counters guarantee both copies stay exercised).

## Native date/time inputs

- **A native time/date input's `value` is `""` when cleared AND when a
  segment is uncommitted.** On iOS/iPadOS Safari a time typed without
  committing the AM/PM segment renders as filled (pale blue) while the DOM
  value — and therefore React state — is still empty. A field can look
  filled and be empty; any save gated on it must tell the user which field
  is missing (the Add Game modal's "Still needed" hint, commit `5393a76`,
  is the pattern — note its Time label says "check AM/PM").
- **House guard for any DB write or ISO timestamp built from a native
  time value:** `/^\d{2}:\d{2}(:\d{2})?$/` (dates: `/^\d{4}-\d{2}-\d{2}$/`).
  The seconds tolerance is REQUIRED, not decorative — Postgres `time`
  columns prefill client state as `HH:MM:SS`, and a strict `HH:MM` regex
  blocks legitimate saves of unedited values. Established in `048a568`
  (conflict resolver `saveManualMove`) and `66e7256` (practices
  `TimeSlotRow` start-time blur-save). Never write an unguarded native
  input value to the DB.

## Open items

- Run the ghost-invite cleanup by hand: four pre-0074 pending SRA→Westside
  invites (three from 2026-05-16 to whitking10@gmail.com, one to Westside's
  Apple private-relay contact) should be marked `superseded` — reviewed SQL
  is in the 2026-07-14 interleague fix-pass report. Leave the QA-Riverside
  pending invite alone (legitimately pending).
- **Vercel `STRIPE_INTERLEAGUE_COUPON_ID` still points at the dead
  `INTERLEAGUE` coupon — update it by hand to `INTERLEAGUE2`** (it is only a
  fallback now, but a fallback to a dead coupon is useless).
- The Supabase confirm-signup email template is copied at
  `public/email-templates/confirm-signup.html`, but editing the repo file does
  NOT change the live email — it must be re-pasted into the Supabase dashboard
  by hand.
- Verify the Supabase auth redirect-URL allowlist contains the www forms (and
  drop bare-domain entries).
- `divisions.umpire_roles` jsonb stays populated until a future cleanup
  migration (see README data-model notes).
- Follow-up (separate commit): add metadataBase: new URL(SITE_URL) to the
  root layout so OG URL resolution stops depending on Vercel domain config.
- Practices `TimeSlotRow` **Duration** field
  (`practices-page-client.tsx` ~line 1671): clearing it blur-saves
  `duration_minutes: 0` — `Number("")` is `0` and `min={15}` is UI-only, so
  the write SUCCEEDS (a persisted zero-minute slot, worse than the rejected
  start-time write). Needs the same guard class as `66e7256`.
