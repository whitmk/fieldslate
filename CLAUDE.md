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
  **Latest migration: 0075.** The repo files are the record, not the
  applicator — apply via the Supabase MCP/dashboard, and verify schema changes
  against the live catalog before writing code that depends on them.
- **`service_role` gets NO default grants on new tables in `public`.** This
  project's Postgres does not grant service_role DML on newly created tables,
  so any table the admin client (`src/lib/supabase/admin.ts`) reads or writes
  needs an explicit `grant ... to service_role` in the migration. Forgetting
  this is exactly what caused the comp-guard 42501/503 outage fixed by
  migration 0070 (every checkout returned 503 until the grant landed).
  service_role bypasses RLS but NOT table-level privileges.

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
- **Auto-assign is STRICT BY DEFAULT (2026-07-14).** An assignment outside an
  official's stated availability or weekly cap is a commitment they never
  made, so the fallback tier — which relaxes exactly those two soft
  constraints and nothing else — runs only behind
  `allowOutsideAvailability: true`. By default those slots stay OPEN and are
  reported with `outside_availability` / `over_weekly_limit` skip reasons
  plus the names of the officials blocked only by them (the "ask them first,
  then assign manually from the game" list; the picker's
  outside-listed-availability state is the manual follow-up path). Both
  entry points — the season button and the per-division button, which now
  shares the same confirmation dialog — expose the opt-in as an
  unchecked-by-default checkbox via shared components in
  `auto-assign-button.tsx` so wording and behavior can't drift. Don't
  re-promote the fallback tier to default behavior.
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
  panel is a separate surface sharing the same confirm dialog + fallback
  opt-in checkbox. Runtime is ~7 sequential browser
  queries per division — fine at current scale; needs progress UI or a
  server move (which first needs the timezone param) if leagues get much
  larger.
- **The engine takes an optional injected client:**
  `autoAssignUmpires(divisionId, seasonId, client?, options?)`, default
  `createClient()`. The seam exists ONLY so the simulation harness can
  drive the real engine against in-memory fixtures — production callers
  omit it. Don't remove it and don't add other client-construction paths.
- **Simulation harness:** `scripts/sim/auto-assign-season-sim.ts`, run via
  `npm run sim:officials`. TZ=UTC is mandatory (the harness exits
  otherwise) — it pins the engine's client-local date math for Node; never
  "fix" a harness date issue by adding timezone handling to the engine.
  It fakes only the Supabase client (the exact query/embed subset the
  engine issues, enforcing the game_umpires uniques), runs every shape in
  BOTH modes (default and fallback opt-in) on fresh fixtures, and asserts
  the full invariant set — no double-booking / blackout / coach / COI
  assignments ever; default runs make ZERO assignments outside
  availability windows or weekly caps; opt-in soft violations bounded by
  fallbackFilled (so opt-in relaxes only those two); opt-in fills ≥ strict
  fills; top-priority division fills its alone-run count, idempotent
  second run, error continuation, skip reasons always reported with
  soft-blocked officials' names — over fixed shapes plus seeded-random
  seasons.
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
     actually occurred (e.g. fallback fills across opt-in runs,
     soft-reason open slots in default runs) and FAIL the run if a counter
     is zero — a conditional invariant whose condition never fires passes
     while checking nothing.
  A first-run-green harness with no mutation pass and no coverage proof
  proves nothing about its own assertions.

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
