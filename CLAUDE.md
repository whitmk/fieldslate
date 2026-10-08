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

## Live customer data — the standing rule

- **NEVER write to Santa Rosa American Little League's data (the real
  league, org `8fde72f9…`, season "SRALL - Fall 2026") unless the founder
  does it themself or says the words "write it."** That covers SQL through
  the Supabase MCP, regenerates, reassignments, emails, anything. Report what
  you would change, exactly, and stop. A general "do it" or "fix it" is not
  "write it." Acceptance testing happens in the test org (`SRALL`, owner
  `aa21d01c…`) only. Recorded 2026-10-06 after a one-off, explicitly
  instructed manual reassign of the Oct 17 snack shack shift.

## Placeholders in the founder's prompt — stop and ask

- **A placeholder in a prompt means STOP AND ASK.** Text like "[your time]",
  "[date]" or "<value>" is a value only the founder can supply. Never fill it
  in, infer it, or pick a "reasonable" default — and never take an
  irreversible action (apply a migration, push, write production data) that
  depends on it. Recorded 2026-10-08: 0105 was applied to production without
  the founder's time.

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
  (no `gh` installed). **A real build shows within ~20s** as a `Vercel`
  `pending` status WITH a deployment `target_url`; a dropped push has zero
  statuses. **Waiting:** a foreground `sleep` longer than ~20s is blocked by
  the session's Bash tool — use a background loop that polls every 60s and
  exits when the state leaves `pending`. **Confirming the SHA on the
  dashboard:** the in-app browser is not signed into Vercel and the Vercel
  connector needs an OAuth step the session cannot start; Claude in Chrome
  (the founder's signed-in Chrome) works — open the status's `target_url`
  and read Status / Environment / Source.
- **Vercel silently drops a push often enough to plan for — THREE occurrences,
  two of them nine days apart.** A dropped push gets no deployment at all: the
  GitHub status sits at `pending` with ZERO statuses and zero check runs, which
  is NOT what a slow build looks like (a real build posts a `Vercel` /
  `pending` status with a deployment URL within seconds). The dashboard is the
  only reliable check — the status API cannot distinguish "dropped" from
  "queued", so **confirm the SHA on the dashboard, never the API alone**.
  - **The pattern, consistent all three times:** the drop affects ONE push, and
    the NEXT push deploys the tip and carries the skipped commit with it. The
    dropped SHA never gets a deployment of its own and its status stays
    `pending` forever; that is expected, not a second failure.
  - **Remedy:** push a trivial follow-up commit (a docs line is fine), then
    confirm the new SHA on the dashboard. Its build contains the skipped
    commit, since that commit is its parent.
  - Occurrences: `a102f8c` (2026-09-15), `275563d` (2026-09-23), plus one
    reported earlier, ~2026-07-22. **If it happens a fourth time, stop
    absorbing it and check the repo's webhook delivery log in GitHub settings
    (Settings → Webhooks → Recent Deliveries) for the failing delivery** — two
    drops in nine days is a broken integration, not bad luck.
- **Canonical domain is `https://www.thefieldslate.com` (with www).** The bare
  domain 307-redirects to www; Stripe webhooks and Supabase auth callbacks are
  configured against www only, so links that land users (or mail-client image
  fetches) on the bare domain hit a redirect hop at best and break at worst.
  Every generated absolute URL must use `SITE_URL` from `src/lib/site.ts` —
  never `NEXT_PUBLIC_APP_URL`, never `VERCEL_URL`, never a hardcoded string.
  (`window.location.origin` in client-side auth redirects is fine — the user
  is already on www.)
- **NO PAGE MAY BE FRAMED EXCEPT `/s/…` (2026-10-08).** `next.config.mjs`
  sends `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors
  'none'` on every path except `/s` and `/s/…`, which get
  `frame-ancestors *` and NO X-Frame-Options (the public league schedule,
  which leagues embed on their own websites). Before this, nothing set either
  header and every page — login and the dashboard included — could be framed
  by any site (clickjacking). The exception is a negative lookahead in the
  GLOBAL rule's source, not an override by a later rule: X-Frame-Options has
  no "allow" value, so a leftover DENY could refuse the embed in an engine
  that honours it over the CSP. Nothing framed the app before the change
  (the only iframe in `src` is the hero embedding YouTube, which
  `frame-ancestors` does not govern). A second frameable route is a decision:
  extend the lookahead AND add its own rule. Proven 2026-10-08 in Chromium
  from a cross-origin parent; Safari not checked.

## Database & migrations

- Migrations live in `supabase/migrations/` (numbered `00NN_name.sql`).
  **Latest migration APPLIED: 0104 (snack shack shift notes + cash people, applied 2026-10-06 02:54 UTC, catalog `20261006025451`; md5(prosrc) verified against the repo file: `regenerate_snack_shack_shifts` `7881278e78eb8a513d0ae678f378f6a2`, `set_snack_shack_blocks_notes_attribution` `6190ad28b15a7a7cef1566230b75832d`).** 0102 is RESERVED by the parked `feat/game-change-alerts` branch and is NOT applied — the catalog goes 0101 → 0103 → 0104. **0105 (public league schedule) APPLIED 2026-10-08 18:28 UTC, catalog `20261008182811`**, verbatim from the repo file after a rolled-back proof (green 2026-10-08); md5(prosrc) verified: reader `42b8926dd2c0efb2555128b1693752d1`, `set_public_schedule_enabled` `a26e52df4e42e41c010d30685eb07cb9`, `reset_public_schedule_link` `847e50d16e5c53002cc551b99405c47b`; privileges verified per role, zero link rows and zero home parks at apply). Check `list_migrations` before numbering a new one; this file has been stale about the latest number before (2026-10-05). The repo files are the record, not the
  applicator — apply via the Supabase MCP/dashboard, and verify schema changes
  against the live catalog before writing code that depends on them.
- **Apply migrations VERBATIM from the repo file, comments included.** The
  apply tool runs exactly what it's given, so a paraphrased or
  comment-trimmed copy makes the live catalog silently diverge from the
  repo: comments INSIDE a function body (`$$…$$`) are stored in
  `pg_proc.prosrc` and are part of the live definition. (File-header
  comments before `create or replace` are never stored by Postgres — that
  part can't diverge.) After applying a function migration, verify
  `md5(prosrc)` against the repo file's body. Established 2026-07-23 after
  0079 was first applied from a trimmed copy and had to be re-applied.
- **`profiles` IS COLUMN-GRANTED: a signed-in user may update FOUR columns of
  their own row and nothing else (0098, applied to production 2026-09-29
  evening; md5(prosrc) verified against the repo file).** RLS decides which ROWS a user may
  update, never which COLUMNS. Before 0098, `authenticated` held table-level
  UPDATE, the only policy was `auth.uid() = id`, and the table had no triggers,
  so any signed-in user could set their own `plan`, `comped` and
  `pending_promo` from the browser.
  - **Editable by the user's own client:** `full_name`, `avatar_url`,
    `org_name`, `setup_dismissed`. The list lives in TWO places in 0098 — the
    `grant update (…)` and the trigger's array — and they must stay identical.
  - **Everything else is protected, including columns added later.** A new
    `profiles` column is NOT writable by users until a migration grants it, and
    the trigger's check is subtraction-based for the same reason. A column the
    app must let users change goes through a SECURITY DEFINER function (the
    calendar feed's `timezone` via `set_org_timezone`) or gets added to BOTH
    lists deliberately.
  - **`protect_profiles_columns()` MUST STAY SECURITY INVOKER.** It decides by
    `current_user`; as SECURITY DEFINER it would always see its owner and allow
    everything while looking unchanged.
  - **Legitimate writers of the protected columns:** `handle_new_user` (an
    INSERT), `process_checkout_event` (SECURITY DEFINER, runs as `postgres`),
    and the comping runbook (SQL editor, `postgres`). `service_role` has never
    held UPDATE on `profiles`.
  - **Proof:** `scripts/sim/profiles-protected-columns-sim.sql`, assembled by
    `profiles-protected-columns-build.ts`. It applies the migration inside a
    transaction that always rolls back, so it can run BEFORE the migration is
    applied. It holds SHARE ROW EXCLUSIVE on `profiles` (blocks writes, not
    reads) for the run. Run 2026-09-29 against production, rolled back: zero
    failures, 6 mutants each killed first at its own assertion, leak check
    clean. Read its run log — the first run was red because the HARNESS wrote
    values the test account already held.
  - **NOTHING SYNCS `profiles.email` FROM `auth.users`** (verified 2026-09-29):
    the only trigger on `auth.users` is the INSERT-only `on_auth_user_created`,
    no function sets `profiles.email`, and the app has no change-email screen.
    All 20 rows match today because nothing has ever changed an email. If a
    change-email feature is built, `profiles.email` goes stale unless a
    SECURITY DEFINER trigger on `auth.users` UPDATE copies it — which would
    pass 0098 (it runs as its owner). A client-side write would be refused.
  - **STILL OPEN, same class, not fixed by 0098:** plan LIMITS are enforced in
    the create RPCs only (`create_league` season cap, `create_division_atomic`,
    `create_team`, `create_interleague_org`), while RLS lets an org member
    INSERT into `leagues`, `divisions`, `teams` and `interleague_orgs`
    directly, and UPDATE `leagues.archived_at`. A season is the unit of sale,
    so a direct insert or un-archive is an unpaid season.
- **`is_org_member` IS the admin gate, because every org member is an admin
  today.** If a non-admin member role (e.g. coach) is ever added,
  `set_org_timezone`, `regenerate_team_calendar_link` and
  `set_team_calendar_link_enabled` (0099) must be restricted to admins — and
  so must every other `is_org_member`-gated write RPC; audit them all in the
  same change.
- **`service_role` gets NO default grants on new tables in `public`.** This
  project's Postgres does not grant service_role DML on newly created tables,
  so any table the admin client (`src/lib/supabase/admin.ts`) reads or writes
  needs an explicit `grant ... to service_role` in the migration. Forgetting
  this is exactly what caused the comp-guard 42501/503 outage fixed by
  migration 0070 (every checkout returned 503 until the grant landed).
  service_role bypasses RLS but NOT table-level privileges.
- **TIGHTENING A FUNCTION'S EXECUTE MEANS REVOKING FROM `public`, NOT FROM A
  ROLE — a role-level revoke is a silent no-op.** Postgres grants EXECUTE on
  every newly created function to `PUBLIC`, and `anon` / `authenticated` /
  `dashboard_readonly` inherit it from there. So
  `revoke execute on function … from anon;` RUNS CLEANLY AND CHANGES NOTHING:
  `has_function_privilege('anon', …)` is still true afterwards. The working
  form is revoke from `public`, then grant back the roles that genuinely need
  it:
  ```sql
  revoke execute on function public.f(args) from public;
  grant  execute on function public.f(args) to authenticated;
  ```
  **Always verify with `has_function_privilege` per role after applying** — the
  no-op version leaves no error behind to notice. Found the hard way applying
  0093. Related, still open: this project's default privileges hand EXECUTE on
  every new function to `dashboard_readonly` (see "Open items"), so a new
  function is broadly callable until a migration says otherwise.
- **PostgREST silently caps every query at 1000 rows.** No error is raised —
  partial results are indistinguishable from complete ones. The exposure is
  widest on queries NOT scoped to a single season (org-wide / all-time
  sweeps). **Do not read the old "season-scoped queries are safe" line as
  "season-scoped reads are fine"** — the schedule PDF bug (below) was a
  season-scoped read that truncated anyway, via an explicit `.limit()`. The
  cap and hardcoded limits are two doors into the same failure. See
  "Complete reads" below for the pattern and the conversion backlog.

## Billing — read this whole section before touching Stripe code

- **Season-as-unit-of-sale.** Every purchase is `mode: "payment"` (one-time,
  no subscriptions) for exactly one season. Price IDs come from env only.
- **quantity is ALWAYS 1. DO NOT rebuild a quantity=2 path.** The old
  "Free→paid upgrade buys 2 seasons (convert one + provision one)" branch
  double-charged customers ($258/$498 instead of $129/$249) and was removed in
  migration 0069. `process_checkout_event` treats any non-1 quantity as
  plan-flip only and provisions nothing; `/api/stripe/checkout` rejects
  `quantity !== 1`. A Free→paid upgrade converts the org's existing season in
  place; add-season buys one more; `upgradeOnly` (Pro→Elite, $100 delta) flips
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
  https://www.thefieldslate.com/blog/why-i-built-fieldslate
- **FAQPage JSON-LD comes from frontmatter.** A post with an optional `faq`
  list ({question, answer} pairs, answers plain text — no markdown) gets a
  FAQPage block on its page; `src/lib/blog.ts` fails the build on a malformed
  `faq` entry. Caveat: FAQ text lives in TWO places per file — the body's FAQ
  section (what readers see) and the frontmatter `faq` list (what search
  engines see) — so any FAQ edit must update both or they silently drift.

## Homepage testimonial

- **`src/components/marketing/testimonial.tsx` (2026-10-02) is the SRALL
  testimonial between the Hero and Features.** The stat strip, the two
  quotes and `FULL_REVIEW` are the reviewer's words VERBATIM — never edit
  them, including the em dash, the "+" and the all-caps first line.
  Attribution "Jenn M." / "Santa Rosa American Little League, Scheduler" was
  confirmed by her on 2026-10-02; the disclosure line beneath it (founding
  league, free first season) stays. Server component, native `<details>`
  for the full review, homepage hex literals not `fs-*` tokens. Deliberately
  NO star rating and NO Review JSON-LD — self-published reviews are not
  eligible for rich results, so markup would only invite a manual action.

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
- **The generator is split: `src/lib/playoffs/bracket-plan.ts` is PURE and
  decides everything; `generate-bracket.ts` only loads inputs and writes
  rows** (2026-10-05, branch `fix/playoff-generator`, after SRALL 50/70's
  bracket came out with three games at 9:00 AM on one field and the top two
  seeds never playing). A scheduling rule added to the I/O file is a rule the
  harness cannot see — add it to the plan. `preflightBracket` runs the same
  plan with nothing written, and the review step shows its warnings BEFORE
  the Generate button.
- **Single elimination handles byes; double elimination and round robin do
  NOT and remain untested.** `standardSeedOrder` lays out the bracket so
  seeds 1 and 2 are in opposite halves (8: 1v8, 4v5 | 2v7, 3v6); a bye team
  is written into its round-2 slot AT GENERATION TIME; and `game_number` is
  the BRACKET POSITION (round-1 position p is number p+1, a bye pair leaves
  its number unused; later rounds continue consecutively — see
  `singleElimFirstNumber`). Advancement resolves the target by that number,
  never by index in the round's compacted row list; a number that is not
  found (a legacy bracket with byes) falls back to row order. Six teams: 3v6
  and 4v5 in round 1, seed 1 plays the 4/5 winner, seed 2 the 3/6 winner.
- **Spacing is the division's `game_duration` + `buffer_minutes`**
  (`planSettingsFromDivision`; a missing value defaults to 90/15 AND is
  reported in the warnings). The playoff planner uses the END-BY window rule
  (the reschedule picker's), for the day window and the field's hours — so a
  9:00–17:00 Saturday fits two 180-minute games, not three, even though the
  regular-season generator (start-only) would place three. Deliberate; the
  stricter rule is the one the founder approved for the picker.
- **Slots are ONE chronological list; rounds consume it in order and never
  wrap.** A later round starts no earlier than the previous round's last game
  end + buffer (slots passed over are counted as `skippedForOrder`, and the
  TBD warning says so). When slots run out the game is saved with NO date,
  time or field and reported — never clamped onto the last date. Every
  playing date in the range gets a diagnostic (`ok` / `closed` / `too_short`)
  and `planWarnings` names the dates, weekday and field. Warnings are
  rendered VERBATIM by the review pre-flight and the success screen — never
  hand-write one.
- **Manual edit: `EditPlayoffGameModal` (calendar button on every unfinished
  game in the bracket list and cards)** sets date, time and field. Conflicts
  are the reschedule picker's manual-entry check (`manualMoveConflicts` via
  `src/lib/playoffs/edit-game.ts`) against BOTH the season's `games` and
  every other `playoff_games` row at that field — notices, never gates. The
  save chains `.select("id")`; zero rows is an error. Logged as
  `playoff_game_rescheduled`. The export modal's CSV still hardcodes a
  90-minute end time (`addMinsFmt(g.start_time, 90)`) — not touched.
- **The Dates step starts from the division's own playing days and windows**
  (`playoffDefaultsFromDivision`, applied when a division is picked; orphan
  windows for non-playing days are dropped). Still editable.
- **Playoff games are NOT in the team calendar feed, the Schedule page, the
  prints or the CSVs** — only the Playoffs page and its export read
  `playoff_games`. The feed also expires 7 days after `leagues.end_date`, so a
  bracket scheduled after the season end is unreachable there regardless.
- **Harness: `npm run sim:playoff-bracket`** (229 checks, 10 anti-vacuity
  counters; parts A–H + S) and `npm run sim:playoff-bracket:mutants` (13
  mutants applied to the real source, each required to die FIRST at its own
  assertion). Read the sim's header before touching any of this.

## Game deletion (single game)

- **`delete_game_if_unblocked` (0079) is THE single-game hard-delete path** —
  a SECURITY DEFINER RPC in the 0078/0065 family (row lock → `is_org_member`
  gate → block conditions → `{blocked, reasons}` or atomic delete). Entry
  point: "Delete game" in the All Games list's row `…` menu
  (`schedule-list.tsx`), click-then-block — the item is always enabled and
  the server decides; do NOT add client-side pre-disabling. The mobile game
  cards deliberately have no delete (they have no `…` menu).
- **Honest scope:** RLS (0049) already lets org members delete games
  client-side — the panel's team-delete does bulk deletes today. The RPC
  exists so the BLOCK CONDITIONS are server-authoritative, not to add a
  missing permission gate.
- **Exactly two block conditions — do not add more without a decision:**
  1. *Accepted interleague*: `interleague_org_id IS NOT NULL AND status <>
     'pending_interleague'`. Partner leagues read our `games` rows LIVE via
     the token RPCs (0037/0074), so deleting an accepted game silently drops
     it from their view. Includes `reschedule_pending` and rained-out
     accepted games — acceptance is the point of no return; the interleague
     resolve flow (which emails the partner) is the delete path for those.
     `pending_interleague` games stay deletable so a dead invite can't
     strand a row.
  2. *Recorded result*: `home_score IS NOT NULL OR away_score IS NOT NULL
     OR status = 'completed'`. Nothing in the product writes scores or
     `completed` to `games` today (results exist only on `playoff_games`) —
     this guards raw-SQL history and any future results feature. A
     scoreless `completed` game counts as a recorded result on purpose
     (approved 2026-07-23) — completion is history even when the score
     wasn't captured.
- **All three FK references to `games.id` cascade** (`game_umpires` 0025,
  `conflict_overrides` 0064, `interleague_reschedule_requests` 0039) — by
  design, they die with the game. The `conflict_overrides` cascade
  deliberately erases that game's override audit trail. The RPC returns the
  cascaded counts as disclosure. `playoff_games` never references `games`
  (parallel table), so no playoff condition exists.
- **Finish-schedule gap-fill will re-add a game for the two affected teams
  after a delete — accepted, unwarned, BY DESIGN.** Do not add a warning or
  store deletion intent; schedule-lock (the next feature) addresses it.

## Division deletion

- **`delete_division_permanently` (0081) is THE division hard-delete path** —
  a SECURITY DEFINER RPC in the 0065/0078/0079 family (row lock →
  `is_org_member` gate → block conditions → `{blocked, reasons}` or atomic
  delete + disclosure counts). Entry point: the trash icon on a division row
  in `division-section.tsx`. It REPLACED a bare three-statement client
  sequence (delete games → delete teams → delete division) that had no
  server-side gate, no atomicity (a failure after the games delete left a
  division with its schedule gone and its teams intact), and no disclosure.
  Do not reintroduce client-side division deletion.
- **Deletion order is load-bearing:** games → teams → division. `games`→`teams`
  FKs are NO ACTION and `teams.division_id` is SET NULL, so deleting the
  division alone ORPHANS its teams rather than removing them.
- **Exactly one block condition:** `playoffs.cross_division_opponent_id` →
  `divisions` is NO ACTION, so a division named as ANOTHER division's
  cross-division playoff opponent would raise a raw FK error. It is counted
  explicitly and blocks with a named reason (house rule from 0078: a guard
  never leans on an FK error). It is also right on the merits — everything
  else the RPC removes belongs TO the division; a cross-division playoff
  reference is someone else's configuration.
- **Accepted interleague games do NOT block here** (they DO in 0079's
  single-game delete). Deleting a whole division is an explicit acknowledged
  act; blocking would strand the division behind games only the partner flow
  can remove one at a time. The count is returned so the confirm dialog can
  warn that the partner org is not notified.
- **SET NULL side effects are DISCLOSED, not blocked** — returned in
  `side_effects` so the UI can name them: cross-division `playoff_games`
  team/winner slots (blanked, not deleted), `umpires.team_id` coach links,
  `snack_shack_blocks.assigned_team_id`. `activity_log.division_id` also
  SET NULLs — deliberate, the log is the record that the delete happened.
- The confirm dialog shows PRE-FLIGHT counts (teams + games) before the
  click; the success toast reports the RPC's counts, which were taken inside
  the delete's own transaction. A failed pre-flight count renders "couldn't
  count", never a silent 0 — a 0 on a destructive confirm is the worst
  possible failure mode.

## Team deletion (single team)

- **`delete_team_if_unblocked` (0084) is THE single-team hard-delete path** —
  a SECURITY DEFINER RPC in the 0078/0079/0081 family (row lock →
  `is_org_member` gate → block conditions → `{blocked, reasons, …}` or atomic
  delete + disclosure counts). It REPLACED the panel's three bare, non-atomic
  client deletes (delete home games → delete away games → delete `teams` row)
  in `division-schedule-panel.tsx`, which skipped the jsonb entirely and
  surfaced a locked refusal in the footer. Entry point: the trash icon on a
  team row in the division schedule panel.
- **It fixed TWO defects.** Defect 1 (dangerous, found during investigation):
  `enforce_division_lock` (0082) is a trigger on `games` ONLY, so a team with
  ZERO games deleted CLEAN on a LOCKED division — taking its `practice_slots`,
  `team_availability_blocks`, `team_game_constraints`, `official_conflicts`
  on CASCADE, no refusal, no disclosure. The RPC reads `divisions.locked`
  DIRECTLY (first block condition), so the lock fires with zero games — do NOT
  make this lean on the games trigger. Defect 2 (reported): the caught,
  correctly-worded refusal rendered in the panel footer while the modal
  closed — read as "nothing happened". The modal now shows block reasons AT
  the action and STAYS OPEN on a blocked result.
- **Exactly three block conditions, ALL evaluated (never first-match):**
  1. *Division locked* (`divisions.locked`). BLOCK, do NOT set `lock_bypass` —
     a team is not the container the lock lives in, so the bypass rule (only
     `delete_league_permanently` / `delete_division_permanently` qualify) does
     not apply. Fires regardless of games (Defect 1).
  2. *Accepted interleague* (mirror 0079): a game on the team with
     `interleague_org_id IS NOT NULL AND status <> 'pending_interleague'`.
  3. *Recorded result* (mirror 0079): a game on the team with
     `home_score`/`away_score NOT NULL OR status = 'completed'` — refused even
     when unlocked.
- **`p_commit boolean` — the RPC is its own preview.** `p_commit=false`
  evaluates blocks + computes every disclosure count and deletes NOTHING;
  `p_commit=true` re-evaluates blocks (the lock can flip between preview and
  confirm — a blocked commit deletes nothing) then deletes. The confirm dialog
  is populated from the preview call, so counts come from ONE authoritative
  source, never a parallel client count that could drift. Deletion order is
  games-first (the `games` FKs are NO ACTION), then the team.
- **DISCLOSURE, not gates:** destroyed counts (games + per-game
  `game_umpires`/`conflict_overrides`/`interleague_reschedule_requests`, plus
  `practice_slots`/`team_availability_blocks`/`team_game_constraints`/
  `official_conflicts`) and SET-NULL side effects (`playoff_games`
  home/away/winner, `umpires.team_id` coach link, `snack_shack_blocks`).
  `practice_slots` + `team_availability_blocks` are named IN the confirm copy —
  coach-entered data is why this delete is dangerous. `practices_legacy` is
  ignored (dead table), same call as the venue guard.
- **The jsonb is reconciled on the CLIENT, not in the RPC.** The RPC owns only
  the destructive teams/games delete; `reconcileJsonbAfterTeamDelete` in
  `reconcile-teams.ts` (the single team-name path — never a bare jsonb write)
  runs AFTER a confirmed delete and removes the team's own
  `settings.teams[]` entry + clears every `conflict_team` back-reference to it
  in BOTH scopes (self + cross-division, keyed by `conflict_division`). Runs
  after the delete, never before — doing it first would strip the jsonb for a
  team a block then refuses (drift in reverse). This closes the old
  "`handleDeleteTeam` leaves the jsonb stale on delete" bug that produced the
  `S Team 1 - Rookie` phantom in SRALL Fall 2026 Rookies.
- **Harness: `scripts/sim/team-delete-sim.sql`** — SQL, run via Supabase MCP
  (same SQL-level-exception standard as `schedule-lock-sim.sql`; NOT
  `npm run`-able), 12 assertions + 12 anti-vacuity counters + 5 mutants all
  killed by their own assertion (2026-07-27), incl. the ★ Defect-1 mutant
  (gate the lock on `games>0` → the zero-games-locked commit assertion A4
  fails). The jsonb reconcile is covered by `npm run sim:team-reconcile`
  (`scenarioDeleteReconcile` + 2 delete-rewrite mutants). Re-verify
  `md5(prosrc)` = `725e6e9d5bc00ca3f4252e1ba40f13d2` after any mutation run.
- **THREE team-count sources already disagree — the delete does NOT touch the
  third, by design.** The panel roster header ("Teams · N") reads the LIVE
  `teams` table (`teams.length`); the wizard edit-load derives N from
  `mergeLiveTeamsWithJsonb` (live + jsonb). Both drop by one on a delete. But
  the season-page division card's people badge reads the STORED
  `divisions.team_count` COLUMN (`division-section.tsx`), which is written only
  by the wizard save (from the configured count) and maintained by NOTHING on
  inline add (`create_team`) or delete — so it drifts independently (SRALL
  Fall 2026 Rookies: badge 15 while 16 live rows existed). The guarded delete
  deliberately leaves `team_count` alone: it is a wizard-configured value, not
  a live counter, and decrementing only the delete side would not make the
  badge correct (adds already drift it). Fixing the badge = make it read the
  live count, a separate decision. Do not "fix" it by writing `team_count` in
  the delete RPC.

## Schedule lock + posted flag

- **The rule, and the reason both flags exist:** `locked` protects a division
  against your OWN destructive re-derivation; `posted` tracks staleness from
  ANY source. Every scoping question this feature raises resolves against
  that sentence — including why an anonymous partner league's interleague
  accept/decline is ALLOWED under a lock (it isn't our admin re-deriving, and
  blocking it strands someone who cannot act on the error) while our side of
  interleague — resolve, counter, reschedule request — stays locked.
- **Storage is COLUMNS on `divisions` (0080), never `settings` jsonb.** Three
  reasons, the third decisive: settings has no CHECK and this is state not
  config; the enforcement trigger reads `locked` per mutated row; and the
  wizard save writes `settings` WHOLESALE (`step-review.tsx` builds it from
  form state rather than merging the stored row), so a lock kept there would
  be silently cleared by any wizard save.
- **`posted` auto-clears on ANY change to the division's games** — not just
  rainouts — EXCEPT a note-only edit (0096, 2026-09-28): `clear_division_posted`'s
  UPDATE branch is column-aware, ignoring `notes` / `notes_updated_at` /
  `notes_updated_by` / `updated_at` (the last because `set_games_updated_at`
  bumps it on every write). A MIXED edit (note + a real change) still clears,
  because the real change did. Set-based over the transition tables, so the
  cost numbers below do not move. Document it as auto-clearing on schedule
  change; it is not a decorative checkbox. Nothing branches on it and nothing
  warns off it.
- **`games` has NO `division_id`.** Every per-division check derives it via
  `home_team_id` → `teams.division_id`. Verified against live data: zero
  games whose home team lacks a division, zero cross-division games. A null
  division means NO division, therefore no lock — allowed, not fail-closed;
  failing closed there would make orphan rows permanently immutable.
- **Enforcement lives in `enforce_division_lock`, a BEFORE ROW trigger on
  `games` (0082) — not in client checks.** RLS (0049) lets any org member
  insert/update/delete games straight from the browser, so client-side and
  API-route checks are for the error MESSAGE, not the guard. Five of the
  eight DB functions that mutate `games` are granted to `anon`
  (token-bearing partner leagues) — enumerate with a `pg_proc` scan on
  `prosrc` before assuming a path is admin-only.
- **The rules when locked:** INSERT always refused; DELETE refused EXCEPT
  `pending_interleague` rows; UPDATE allowed only if every changed column is
  in the allowlist (`status`, `scheduled_at`, `venue_id`,
  `proposed_scheduled_at`, `proposed_venue_name`, `external_team_name`,
  `updated_at`, and since 0095 `notes`, `notes_updated_at`,
  `notes_updated_by` — a game note is internal admin text and a locked
  schedule is exactly when someone writes "lights out on field 2").
- **The column check is SUBTRACTION-based and must stay that way:**
  `to_jsonb(OLD) - allowlist IS DISTINCT FROM to_jsonb(NEW) - allowlist`.
  NEVER an enumerated blocklist — a column added to `games` next year must be
  blocked-when-locked BY DEFAULT. Mutant M4 in the harness swaps it for an
  enumerated list and is caught only by T5c; don't delete that assertion.
  **T5c was RE-KEYED 2026-09-28 from `notes` (now allowlisted, 0095) to
  `home_team_id`** — the durable choice because the trigger's own body commits
  to it: "if home_team_id moved between divisions, a lock on either end must
  apply. (That move is outside the allowlist and so is blocked regardless.)"
  Allowlisting it would break the trigger's own division resolution, so nobody
  will. M4 is written out explicitly (NM3) in
  `scripts/sim/game-notes-triggers-sim.sql`.
- **Trigger NAME ordering is load-bearing.** Postgres fires same-timing row
  triggers in name order, and `enforce_division_lock` sorts before
  `set_games_updated_at` so `updated_at` is unchanged at check time.
  `updated_at` is in the allowlist anyway — keep both properties.
- **`pending_interleague` deletes stay allowed** because those rows are
  excluded from every export and the Reports matrix by
  `countsAsScheduledGame` — they were never on the schedule parents
  received. This is what lets an anonymous partner's DECLINE work under a
  lock with NO bypass, and `delete_game_if_unblocked` (0083) excludes them
  from its `division_locked` reason for exactly the same reason. **The
  trigger and that RPC must agree about the same row** — if you change one
  carve-out, change both.
- **Bypass GUC rule:** `fieldslate.lock_bypass` is transaction-local
  (`set_config(..., true)`) and belongs ONLY in a SECURITY DEFINER function
  whose entire purpose is destroying the container the lock lives in.
  Exactly two qualify: `delete_league_permanently` and
  `delete_division_permanently`, and both set it AFTER their authorization
  and block-condition gates so a refused call never enables it. Locking must
  not make a division or season undeletable. `delete_game_if_unblocked` gets
  a real CHECK, never a bypass. A third claimant is a design review.
- **`posted` clearing is a STATEMENT-level trigger with transition tables**
  (`clear_division_posted`, three triggers — insert/update/delete). Not per
  row: the generator inserts in batches of 500 and a row trigger would fire
  500 updates at one divisions row.
- **Measured trigger cost (2026-07-23) — one stated threshold FAILED, and
  the feature shipped anyway; here is the honest number.** Insert+delete
  round trip, trigger on vs off: N=100 +12.6ms (+132%), N=500 +37.5ms
  (+88%), N=2000 +149.6ms (+89%). The +10% relative threshold was missed by
  a wide margin; the <50ms-at-N=500 absolute threshold passed. The curve is
  linear, so it is per-row plpgsql overhead, not a missing index. Accepted
  because the largest live division is 70 games — roughly +10ms on an
  operation that already costs seconds of client round-trips, a few times
  per season. **The relative threshold was the wrong metric for this
  operation; the absolute one is the one to hold future changes to.** If a
  league ever reaches thousands of games per division, the pre-designed
  escape hatch is AFTER STATEMENT with transition tables (raise from there
  and the statement still rolls back) — one set-based check instead of N.
  A locked-division abort costs 0.6ms: it refuses at row 1 and never scans.
- **All client lock reads and writes go through
  `src/lib/schedule/division-lock.ts`** — `fetchDivisionLocks` /
  `fetchSeasonDivisionLocks` / `setDivisionLock` / `setDivisionPosted` plus
  `lockedReason` for the wording and `isDivisionLockError` /
  `formatLockError` for translating the trigger's refusal. Same
  shared-pure-function rule as the umpires conflict helpers: never write a
  parallel lock check, and never hand-write the locked sentence.
- **The lock reads FAIL LOUD.** `fetchDivisionLocks` throws on a read error
  rather than returning unlocked defaults — an unreadable lock rendering as
  "unlocked" would put the admin straight back into click-then-refuse.
  Every consumer surfaces that error visibly.
- **Surfaces carrying lock state** (chunk 5): division schedule panel (the
  lock toggle + posted checkbox live here, plus gating on generate,
  finish, add game, delete team), season-page division cards (Locked/Sent
  badges), generate-all modal (pre-run "will be skipped" notice, amber
  rows, `skipped_locked` status), setup generate step (same skip), Add
  game modal, conflict resolver, the All Games delete dialog's
  `division_locked` reason, and the panel's per-row "Reschedule game" icon
  (2026-09-25 — see "Division panel — Reschedule game" for why it is gated when rainout
  recovery is not), and the Schedule page's list-menu and calendar-popover
  "Reschedule" for scheduled games (2026-09-26 — rained-out games exempt).
- **The two division-ambiguous surfaces get PER-OPTION / PER-ROW state, never
  a disabled button.** Add game picks its division INSIDE the modal, so
  options are annotated "— locked" and stay SELECTABLE (an admin must be
  able to see why, not find it mysteriously unpickable) with the reason
  inline once chosen. The conflict resolver spans divisions and can hold a
  mix in one list, so each row carries its own badge, its own disabled move
  button, and a reason naming THAT row's division — auto-move filters locked
  games out rather than attempting and failing, matching the pick-from-valid
  asymmetry used for rainout reschedule.
- **Both save paths translate a stale-lock refusal.** A division can be
  locked between render and click; Add game's insert and the resolver's
  patch run their error through `isDivisionLockError`, show the friendly
  reason, and mark the division/row locked so the UI catches up instead of
  re-offering the action.
- **Interleague resolve is gated in the ROUTE, not the trigger — and that is
  not a shortcut.** Verified against the live DB 2026-07-23: BOTH branches of
  `/api/interleague/games/[id]/resolve` already PASS the trigger on a locked
  division. Accept writes only `scheduled_at` / `status` /
  `proposed_scheduled_at` / `proposed_venue_name`, every one of them in the
  allowlist; decline deletes a `pending_interleague` row, which the carve-out
  permits. Those permissions are exactly what lets an anonymous PARTNER
  accept or decline under a lock without being stranded — the decision from
  2026-07-23. Our own admin resolving is the SAME row shape; the only
  difference is who is acting, so the trigger cannot distinguish them and the
  gate has to live where the actor is known.
  **Be honest about what that buys:** it stops the product's resolve path
  completely (the UI has no other), but it is NOT a database guarantee the
  way blocked INSERTs and DELETEs are — a caller issuing the same UPDATE
  directly under RLS still succeeds. Do not describe interleague resolve as
  trigger-enforced.
- **The wizard's save-and-regenerate checks the lock BEFORE writing
  anything.** The generator would refuse on its own, but only after
  `saveEditDivisionData()` had already persisted the wizard changes —
  producing "Division saved, but game schedule generation failed", a
  half-applied refusal. It now refuses up front, changes nothing, and says
  so; a locked division's *settings* can still be saved via "Save (don't
  generate)", since settings are not games. The new-division path is exempt:
  it plans before the division exists, so nothing can be locked.
- Chunks 1-3, 5, and 6 are landed, including the wizard and interleague
  resolve surfaces. Every surface in the original eight now carries lock
  state.
- **Harness: `scripts/sim/schedule-lock-sim.sql`** — 12 assertions, 12
  anti-vacuity counters, 9 mutants all killed (2026-07-23). Read its header
  before touching any of this; it is SQL, not `npm run`, for the reasons in
  "Harness standard — SQL-level exceptions" below.

## Harness standard — SQL-level exceptions

- **SQL-level enforcement in this repo CANNOT be proven by the `npm run
  sim:*` standard, and widening production grants to make a test run would
  be the wrong trade.** Two hard reasons: `service_role` has NO
  SELECT/INSERT/UPDATE/DELETE on `games`, `divisions`, `teams`, or `leagues`
  (verified 2026-07-23 — only REFERENCES/TRIGGER/TRUNCATE), so a
  service-role-driven tsx harness 42501s on its first write; and
  `scripts/sim/fake-supabase.ts` is an in-memory fake that cannot simulate a
  Postgres trigger, CHECK, or FK at all.
- **The standard for this class of work instead:** a transactional SQL
  harness — setup, assertions, and a terminal `raise exception` that carries
  the results out AND guarantees the whole thing rolls back — plus a
  mutation pass over every carve-out. Run it via the Supabase MCP against
  the live DB; always follow with a leak check that the scratch rows are
  gone. It is NOT `npm run`-able and does NOT run in CI. That is a real gap
  versus the officials/round-order sims; say so rather than letting it pass
  as equivalent. Live example: `scripts/sim/schedule-lock-sim.sql`.
- **Mutants are `create or replace` on PRODUCTION functions.** Run every one
  inside the same always-raising DO pattern so it can never commit, and
  ALWAYS re-verify `md5(prosrc)` against the repo migration bodies
  afterward. A surviving mutant in production is far worse than a failing
  test.
- **NEVER run `alter table ... disable trigger` on a production table
  without flagging the ACCESS EXCLUSIVE lock first and getting an explicit
  go-ahead.** This is a standing rule, not a preference. Disabling a trigger
  takes an ACCESS EXCLUSIVE lock on the table for the WHOLE transaction —
  every read and write from the live app blocks behind it until the
  transaction ends, even though the statement itself looks instant and even
  though the change rolls back. It was done unannounced on `games` during
  the 2026-07-23 trigger benchmark while an admin was actively regenerating
  schedules; it rolled back cleanly and no harm resulted, but the risk was
  taken without asking. Say what the lock will block and for roughly how
  long, get agreement, keep the transaction as short as possible, and
  confirm `tgenabled = 'O'` on every trigger afterward.
- **A mutation result is "killed" ONLY if the BASELINE ASSERTION fails** —
  not merely if the mutant behaves differently. Mixing those two criteria in
  one script produces mutants that look like survivors when they were caught
  (this happened on the 2026-07-23 lock run for M1/M2/M4 and had to be
  re-proven assertion-by-assertion). State the criterion once and use it
  everywhere.
- **Second half of the same rule: a mutant must be killed by the ASSERTION
  THAT IS SUPPOSED TO CATCH IT, not merely killed by something.** Read the
  failing assertion name on every kill; a red run is not the answer, the
  right red line is. A mutant that dies early to an unrelated assertion
  leaves the assertion it was written to exercise completely unproven while
  the tally still reads "all killed" — so the summary count is true and
  meaningless.
  **Worked example (2026-07-23, skip-attribution run):** M15 was written to
  prove the placement-invariance assertions. It mutated `tallyRejections` to
  write into `venueBookings` — which that function also READS to compute its
  own counts, so the run died at `[F1] weekly_cap attributed 0`, an
  attribution assertion, before invariance was ever evaluated. 15/15 killed,
  invariance unproven. The fix was to move the leak to the CALL SITE, after
  the tally is computed: attributions then stay correct and the mutant dies
  at `[INV] placement moved` — the line that was supposed to catch it. When a
  mutant targets assertion X, deliberately construct it so nothing before X
  can fire.
- **THE GENERATOR SHUFFLES WITH `Math.random` (`generate-schedule.ts` ~:165),
  so two runs of the SAME fixture differ from each other.** Any golden
  comparison of generator output must therefore pin the seed before it compares
  anything — and must separately assert that the pinning WORKS (two identical
  runs under one seed agree), or the golden can pass for the wrong reason
  instead of failing for one.
  **The failure mode is the mirror of a vacuous assertion, and just as silent
  about the property under test.** An unpinned golden compares shuffle NOISE:
  it fails on every run, for a reason that has nothing to do with the thing
  being proven, and a red line that is always red tells you nothing. A golden
  that fails for an unrelated reason is exactly as uninformative as one that
  passes without checking. Cost real time on the 2026-08-21 makeup-days run
  before it was diagnosed. Live example of the pinned form:
  `scripts/sim/makeup-days-sim.ts` (seeded xorshift32, same seed both sides,
  plus the pin-check assertion).
- **"What CALLS this" is not "what REACHES this" — ask the second question.**
  A shared function or component has direct callers AND entry paths, and the
  counts are not the same. On 2026-08-21 the caller enumeration for
  `buildAvailableSlots` returned the correct answer — ONE production caller —
  while the number of render paths that could reach it was SEVEN, four of them
  ungated for a case nobody had reasoned about (see "RainoutRescheduleModal has
  seven render paths" under the reschedule picker). The caller count was true
  and reassuring and did not describe the blast radius.
  **Standing review question for any shared component or shared function:
  enumerate the render sites and entry points, not just the direct callers,
  and check each one's gating separately.** A grep for the function name will
  not surface this; a grep for the COMPONENT name is a different search with a
  different answer.

## Complete reads — row limits and silent truncation

- **`fetchAllRows` in `src/lib/supabase/fetch-all.ts` is THE way to read a set
  that must be COMPLETE** — anything a printed document, an export file, or a
  derived number is built from. It pages, and it either returns every row or
  it THROWS. It never returns a short array. Callers must surface the throw,
  never fall back to a partial or empty list: "no games found" and "we could
  not read the games" look identical to an admin, and only one is safe to
  print. Harness: **`npm run sim:fetch-all`** — 36 assertions, 8 mutants all
  killed (2026-07-23).
- **Why it exists.** Printing SRALL Fall 2026 produced a PDF headed
  "Printed … · 200 games" for a **260-game** season that stopped two weeks
  early (last row 2026-10-03, true last game 2026-10-17) and looked finished.
  Cause: `.limit(mode === "calendar" ? 1000 : 200)` on the Schedule page's
  games query. The 200 was a **display** cap (originally `.limit(50)`, bumped
  in `e41f519`) that `SchedulePrintRegion` inherited when it was added later
  in `a3a8b82` — the print path never had a query of its own. **Nobody ever
  chose 200 for a document.** The header count was `games.length`, i.e. the
  length of the truncated array, so the PDF stated its own truncation as fact.
- **Three rules that are easy to get wrong. All three are mutant-proven; do
  not "simplify" any of them:**
  1. **Terminate on a SHORT PAGE, never on reaching the count.** Stopping at
     `rows.length >= count` silently drops every row inserted after the count
     snapshot. This was the first draft and the harness caught it before it
     shipped (mutant M7, caught only by assertion S11).
  2. **The caller MUST end its `.order()` chain with a unique tiebreak
     (`id`).** Range paging over a non-unique sort key drops or duplicates
     rows at page boundaries. It also fixes output determinism, which matters
     independently: SRALL Fall 2026 has **69 timestamps carrying ties, largest
     group 8**, so without a tiebreak the order within each of those groups
     varied between page loads — and when the old cap sliced through a tie
     group, *which* game survived into the PDF was arbitrary and differed
     between prints of identical data.
  3. **A read that returns no exact count THROWS.** Without a count, a short
     page and a server-side cap are indistinguishable, so completeness cannot
     be verified — and an unverifiable read is the whole failure mode. This
     also turns "the builder forgot `{ count: 'exact' }`" into an immediate
     loud error instead of a truncation discovered in a customer's PDF.
- **Cap discovery is load-bearing, but only in combination.** Because `offset`
  advances by rows actually received, paging self-corrects even when the page
  size sits above the server cap — so removing cap discovery breaks nothing
  *until the count is ALSO wrong*, at which point no full page ever appears and
  the walk stops early (194 of 250 in the harness). This is a worked example of
  the "killed by the RIGHT assertion" rule: mutant M1 first died only to an
  efficiency assertion while every completeness assertion passed, reading as
  8/8 killed and proving nothing. Scenario S15 was built to construct exactly
  the failing combination. Don't delete S11 or S15.
- **Never re-add a `.limit()` to a completeness-critical read — and never use
  1000 as a limit anywhere.** 1000 is PostgREST's own silent cap, so a real
  limit at that value is indistinguishable from being truncated by the server.
- **Converted so far: the Schedule page games query AND the Reports games read**
  (`overview-reports.tsx` — completion, field utilization, and the field ×
  division matrix all share that one array; on a read failure the whole Reports
  body is replaced with a visible error, never partial numbers). **Conversion
  backlog, priority order** — several of these can silently truncate, so the
  fix is this uniform pattern, not one-line edits:
  1. **Venues page** (`venues-page-client.tsx`) — org-wide, ALL seasons, no
     league scope. **660 rows today against a 1000 cap**, grows every season,
     never resets. This one has a date on it.
  2. **Season page division cards** (`leagues/[id]/page.tsx`) — whole season.
  3. **Both CSV exports** — generic (`export-picker-modal.tsx`) and Sports
     Connect (`sports-connect-export.ts`).
  4. **Division schedule panel** — and its OWN print region
     (`division-schedule-panel.tsx` ~1191), which has the identical
     `{activeGames.length} game` confident-count design.
  5. **The calendar branch's `1000`** — move off that number regardless, so a
     real cap can never be confused with the PostgREST one.
  Also unconverted on the Schedule page itself: the venue-options query
  (`.eq("league_id", …)`, no limit) that feeds the venue filter dropdown.
- **Not affected, verified:** the public token schedule (`/schedule/[token]`)
  goes through `get_interleague_schedule_by_token`, which returns an aggregated
  json scalar — the row cap applies to table reads, not a function's json
  return. Head-counts (`{ count: "exact", head: true }`) are exact regardless,
  so the dashboard stat cards and `division-game-counts.ts` are immune.

## Print path (PDF) — the RENDER-side truncation, and engine divergence

- **This is the render-side twin of the fetch truncation above.** The Schedule
  page / division panel / both umpire pages print via `window.print()` and the
  browser's Save-as-PDF, using the shared `.fieldslate-print-region` +
  `@media print` block in `globals.css`. A complete DOM (correct 260-game
  header) can STILL print short if the print CSS clips — same right-looking,
  silently-wrong failure, one layer down.
- **Two clip bugs found and fixed, IN ORDER — a fix for one did NOT fix the
  other, and each was invisible until printed:**
  1. `position: absolute` on the region (pre-`f9cdd47`). Browsers clip an
     out-of-flow box at ~one page; a ~53-page season printed one page's worth.
     Fixed by moving to NORMAL FLOW (`f9cdd47`): expand the region's ancestor
     chain via `:has()`, remove all other elements with a `display:none` sweep
     (`:has()` + complex `:not(.fieldslate-print-region *)`), region
     `position: static`. See the block's own header comment.
  2. `break-after: avoid` / `page-break-after: avoid` on the region container
     AND (via a `:last-of-type` that matched every day's table) on every
     table. WebKit mishandles break-avoid on a very tall multi-page block and
     CLIPS instead of paginating — Chrome was unaffected. Removed; trailing
     blank page suppressed the WebKit-safe way with `margin-bottom: 0` only.
     Do not reintroduce any break-avoid on the region or its tables.
- **CHROME VERIFICATION IS NOT SUFFICIENT FOR THE PRINT PATH — it has already
  diverged between engines once, silently.** Bug 1 was proven fixed in Chrome
  while Safari/Preview still truncated at the SAME point (Oct 10; Safari showed
  14 pages, Chrome 15). Admins print from whatever browser they have, so a
  print-CSS change that "works" in one engine can ship a truncated schedule in
  another with no error anywhere. **Any future change to the `@media print`
  block or the print regions REQUIRES a manual WebKit/Safari print check
  (print the largest real season, confirm the last date prints), not just
  Chrome.** The Claude Code session tooling could not do this: the in-app
  browser is Chromium and Claude-in-Chrome is Chrome — neither is WebKit, and
  print pagination is not observable through them at all (screen media only).
  The engine check is a human step; leave it to the founder and wait for it.
- **Still-open WebKit suspect if truncation recurs:** the print tables use
  `border-collapse: collapse` (globals.css), and WebKit has documented
  border-collapse pagination bugs. Not yet implicated (the break-avoid removal
  is the current hypothesis), but it is the next lever — switch to
  `border-collapse: separate` — if a single large day's table ever clips
  mid-table. A transformed ancestor was RULED OUT (the only transform is on the
  print-hidden Sidebar, a sibling of the region's ancestor chain, not an
  ancestor).

## Schedule export (Sports Connect)

- **TWO surfaces, ONE builder — format changes go in the builder, never in
  a surface.** `buildSportsConnectCsv` + `fetchSportsConnectGames` in
  `src/lib/schedule/sports-connect-export.ts` are the only CSV logic; the
  two hosts — the league page's export-picker modal row and the
  `/dashboard/export` page (`sportsconnect-exporter.tsx`, which has NO
  private CSV helpers since 2026-07-23) — only pick a division, call the
  shared fetch + builder, and download WITHOUT a BOM. Their output is
  byte-identical for the same division (harness-proven). Both are
  Pro-gated (the page server-side, the modal row via `isPro`); the page
  additionally offers the org-wide season picker INCLUDING archived
  seasons — the one capability the modal lacks, and the reason the page
  exists. Template columns, in order:
  `SortOrder,RoundNo,HomeTeam,AwayTeam,MatchDate,StartTime,EndTime,Location,Field`
  — CRLF endings, quote-only-when-needed, NO BOM (the file feeds Sports
  Connect's importer, not Excel; the older generic games CSV keeps its BOM).
- **EndTime = start + `divisions.settings.game_duration` ONLY** — never add
  `buffer_minutes` (between-game spacing, not play length). The builder
  FAILS LOUD (refuses the whole export, naming the division) on a missing or
  non-positive duration — an EndTime equal to StartTime is silently wrong
  data landing in a customer's system.
- **RoundNo = Monday-start calendar weeks** via the shared
  `weekKeyFromIsoDate` (exported from `game-days.ts` for exactly this).
  First game-bearing week = round 1; gap weeks are skipped, not counted.
  **Known limitation: a rainout makeup carries the round of the week it was
  MOVED TO** — the original date is unrecoverable (rainout reschedule
  overwrites `scheduled_at` in place, the activity log is prose,
  `interleague_reschedule_requests` stores only the proposed new time). Do
  not promise original-round makeups without first adding storage.
- **Field is BLANK on every row by design.** FieldSlate has no per-field
  concept (conflict detection treats each venue as one field;
  `venues.capacity` is informational-only). Do not stub a value.
- Rows are filtered by the shared `countsAsScheduledGame` (no cancelled, no
  pending-interleague — same exclusion set as the Reports matrix); `is_away`
  interleague games SWAP columns (partner = HomeTeam) because `games` always
  stores our team as `home_team_id` with `is_away` flagging the true host
  (verified against live rows 2026-07-23 — every away row's home_team_id is
  our team, venue_id NULL, partner field in `proposed_venue_name`). Location
  falls back to `proposed_venue_name` for is_away games only (the schedule
  panel's display rule); a null `external_team_name` renders as "TBD" — a
  reachable state (legacy pre-invite rows + the rainout status-flip path),
  not just theory.
- **Harness:** `npm run sim:sc-export` — exact-row assertions over the real
  builder (rounds, tiebreaks, quoting, midnight wrap, refusal shapes);
  mutation-checked (status-filter and duration-guard mutants both fail it).
  Re-run after ANY change to the builder or `weekKeyFromIsoDate`.
- **WHICH games an export contains, and who is home, live in ONE function:
  `normalizeExportGames` (`src/lib/schedule/export-games.ts`, 2026-09-29).**
  Both CSVs call it — the Sports Connect builder and the generic games CSV
  (`buildGenericGamesCsv` / `exportGenericGamesCsv` in
  `generic-games-export.ts`) — so the two files always contain the same games.
  It owns the status filter (`countsAsScheduledGame`), the sort, the partner
  name (`external_team_name` → away team → "TBD"), the `is_away` swap and the
  partner's field (away games only). **A format builder owns its columns,
  formats and quoting and NOTHING else — never filter, resolve a name or swap
  in a builder or a surface.** The generic CSV used to do all of that itself in
  the modal: it exported pending interleague games as scheduled, left Away Team
  blank on every interleague game, and never swapped.
- **The generic CSV's FORMAT is frozen:** six columns, every value quoted,
  `MM/DD/YYYY`, 12-hour `hh:mm AM/PM`, CRLF, no trailing newline, BOM added by
  the modal at download. "Location/Field Name" is the bare venue name (never
  the park), or the partner's field on an away game.
- **A failed read downloads NOTHING, on every CSV surface.**
  `fetchSportsConnectGames` is the one fetch all three use; it never throws and
  returns `ok: false` on a read error, a rejected request, or an error that
  arrives with partial rows. The generic CSV used to discard both read errors
  and download a header-only file, which reads as "this division has no games".
- **Harness: `npm run sim:games-export`** — fixtures for every status and every
  interleague shape, the same-games assertion across both files, a differential
  against a frozen copy of the pre-change generic code (ordinary games are
  byte-identical), read-fault injection. `npm run sim:games-export:mutants`
  applies 7 mutants to the real source and requires each to die FIRST at its
  own assertion; it restores the source in a `finally` and verifies it. A
  section that throws is recorded as `[CRASH-…]` and the run continues, so
  collected failures always print.
- **KNOWN HARNESS GAP: `sim:sc-export` drives the BUILDER, not the FETCH.** It
  feeds `buildSportsConnectCsv` fixture rows directly and never exercises
  `fetchSportsConnectGames`, so it **structurally cannot catch a truncated
  read** — a capped or short fetch produces a CSV that is internally perfect,
  passes every assertion, and is silently missing games. Green here says
  nothing about completeness. `fetchSportsConnectGames` has no `.limit()` but
  is unconverted and still exposed to the PostgREST 1000-row cap (see
  "Complete reads"); when it moves to `fetchAllRows`, the fetch needs its own
  coverage rather than an extension of this sim's builder assertions.

## Schedule filters

- **Stale filter URL params don't reconcile (except team).** The Schedule
  page's `?division=` and `?venue=` params survive a switch to a division
  that makes the selection invalid — the DB `.eq` still filters (→ "No games
  found") while the dropdown visually falls back to "All …". Only the team
  filter reconciles (`effectiveTeamId` in the server page). Division and
  venue are consistent with each other by design for now; if reconciliation
  is ever added, apply it to BOTH uniformly, not one. **`?location=` (added
  2026-09-24) joins this family and must be included in that same fix.** The
  practical trigger is the season switcher: it `router.refresh()`es and keeps
  the URL, so a previous season's ids ride along.
- **Location filter (`?location=`, 2026-09-24) — the tier above venue.** Sits
  BEFORE Venue and mirrors it exactly: options derive from venues carrying a
  game this season (`locationOptionsFromVenues`; the options read's venue embed
  carries `location:locations(id, name)`), filter is server-side on the ONE
  shared games query, so list/calendar/week/print all honor it. All logic lives
  in `src/lib/schedule/location-filter.ts`; the page only calls it.
  - **Venues with no location are out of scope BY DESIGN** — no option, no
    "Unassigned", excluded under a specific location, as are interleague away
    games (null `venue_id`). The dropdown hides when no season venue is located.
  - **Location → venue cascades like division → team:** the dropdown clears
    `?venue=` on change, the Venue dropdown lists only that location's venues,
    and the server drops a venue outside the location
    (`effectiveVenueForLocation`) rather than ANDing it into an empty list.
    This is location-vs-venue consistency, NOT stale-season reconciliation —
    with no location selected the venue passes through untouched.
  - **The location's venue ids come from their own read** —
    `fetchLocationVenueIds`: `venues` by `owner_id` + `location_id`, FAILS LOUD
    into `gamesError`. Not from the dropdown options (unpaginated — a venue lost
    to truncation there would silently drop its games from the filter) and not
    an `!inner` venue embed (that would change the shared query's embed for
    every view mode). A location with zero venues matches NOTHING (sentinel
    uuid), never everything.
  - **Week mode narrows ROWS too** (`narrowWeekVenues`), same as a venue
    filter. Without it, a Monroe view lists Westside's fields as empty rows —
    which reads as "free this week". Mutant LM3 (games filtered, rows not) is
    killed only by `[W1]`.
  - **Harness: `npm run sim:location-filter`** — 31 checks, 5 anti-vacuity
    counters, 5 mutants each killed first at its own assertion. It drives the
    lib, NOT the page: the page must keep CALLING `applyVenueScope` and
    `narrowWeekVenues`, never an inline copy, or the harness proves nothing.

## Schedule page — the ONE shared games query

- **`src/app/(dashboard)/dashboard/schedule/page.tsx` holds a SINGLE games read
  that feeds four surfaces**: list mode, calendar mode, week-by-field mode, and
  `SchedulePrintRegion`. There is no second query and no per-mode fetch. It is
  `fetchAllRows` (complete-or-throw) with a `scheduled_at` + `id` ordering; the
  `id` tiebreak and the absence of any `.limit()` are both load-bearing — see
  "Complete reads" and the file's own comment block. Calendar mode adds a date
  range on top; everything else is shared. A new view mode extends this query,
  it does not get its own.
- **`durationMin` on `ScheduleGame`: UNDEFINED MEANS UNRESOLVED, NEVER `?? 0`.**
  It carries the game's own division `game_duration` and is ABSENT whenever that
  cannot be resolved (division setting missing/zero/negative/non-numeric, or a
  home team with no division). Do not coerce it to 0 and do not quietly default
  it at a call site: `Number(NaN) || 0` is 0, a zero-length span overlaps
  nothing, and the surface then renders a confident wrong answer instead of an
  error — the same failure `isUsableDuration` exists to prevent in
  `detect-conflicts.ts`. A consumer that needs a number must choose an explicit
  default or render an honest "duration not set", and say which it did.
  **Why no default is baked in:** fifteen sites in this repo resolve a game
  duration under FOUR different fallback policies (throw / 90-with-a-finite-and-
  positive-test / 90-via-`?? 90` / 0). Defaulting in the data layer would
  silently pick a winner for all of them.
- **Duration comes from the DIVISIONS read as a projected jsonb key —
  `game_duration:settings->game_duration` — NEVER a `division:divisions(settings)`
  embed on the games query.** `divisions.settings` also holds the division's full
  `teams[]` array with coach metadata, so the embed ships that blob once PER GAME
  ROW: +479,118 bytes onto SRALL Fall 2026's 184,267-byte, 272-game response
  (2026-08-21). The projected key costs 338 bytes and rides a request the page
  already makes. Resolution lives in `src/lib/schedule/division-durations.ts`
  (`gameDurationsFromDivisionRows`) — pure, omits rather than defaults.
- **The durations map deliberately shares the divisions query that feeds the
  division-filter dropdown.** That coupling is chosen, not accidental: narrowing
  that select would take durations with it, but it CANNOT fail quietly — the
  filter dropdown and the end times vanish together, so the symptom is visible
  rather than a plausible-looking grid. Weighed against a second round trip on
  every Schedule page load, visible-when-broken won.
- **The venue embed's `location` is NULLABLE — never `!inner`.** The games query
  selects `venue:venues(name, location:locations(name))`, matching the
  venue-filter query on the same page. 21 of 30 live venues have `location_id`
  null, so an inner join empties the result for every org that has not adopted
  locations. Also note the chooser/display line from "Locations": list, calendar
  and print keep rendering the BARE `venue.name`; the qualified
  "Complex — Field" label is for surfaces where a field is PICKED.
- **`venue_id` is selected alongside the `venue` embed** because a field-centric
  view needs an id to key rows and `venue.name` is not unique. It is null on
  interleague away games — which is every null-venue row in production (24 of
  24, verified 2026-08-21).

## Week-by-field view mode

- **URL convention: `?mode=week` plus `?week=YYYY-MM-DD`, where the date is the
  MONDAY of the displayed week** — the direct analogue of calendar mode's
  `?month=YYYY-MM`. List is still the param-less default and `parseMode` still
  coerces anything unknown to `"list"`. A hand-typed mid-week `?week=` snaps to
  its Monday; a malformed one is treated as absent.
- **"Which week is now" is resolved in the BROWSER and never on the server.**
  `parseWeekParam` returns NULL rather than defaulting, `ViewModeToggle` seeds
  the param from the browser clock, and `ScheduleWeekGrid` resolves a null
  itself and `router.replace`s the URL. This is deliberate avoidance of the
  page's existing `todayLocalDateString()` bug (bare `new Date()` in a SERVER
  component, so "today" is UTC's today and a US league sees tomorrow from
  roughly 4pm local). That bug is still open and out of scope — **do not "tidy"
  the week default into it.** The one clock read lives in
  `currentWeekStartLocal()`, which carries a client-components-only warning.
- **Row set = `division_venues.allow_games` for a season division, UNIONed with
  any venue carrying ANY game in the week (every status).** The union arm is
  DEFENCE — a venue whose eligibility was unticked after its games were
  scheduled must not silently drop them. Eligible fields with NO games keep an
  empty row on purpose: an unused field is the capacity signal this view exists
  to give, so never filter rows down to those with games.
- **DELIBERATELY NOT SHARED with the Reports venues × divisions matrix
  derivation (`overview-reports.tsx`), even though the two look nearly
  identical. Do not "fix" them into one function.** Reports is SEASON-wide,
  DIVISION-keyed, and filters through `countsAsScheduledGame` (excluding
  cancelled and pending_interleague) because it reports real scheduled games.
  This one is WEEK-scoped, FIELD-keyed, and counts EVERY status because a
  cancelled or pending game still tells an admin whether that field is spoken
  for. Merging them forces one to answer the other's question. Same
  keep-them-apart reasoning as `countsAsScheduledGame` vs
  `teamIsOccupiedThisWeek` in `game-days.ts`.
- **`durationMin` undefined ⇒ START TIME ONLY.** `fmtTimeRange` renders
  `"9:00 AM"` alone rather than inventing an end. No `?? 0` (which would render
  "9:00 AM – 9:00 AM" and read as real data), no 90-minute fallback, and no
  sixteenth duration policy — this view has exactly two states. See the
  `durationMin` bullet under "Schedule page — the ONE shared games query".
- **This view SHOWS pending_interleague games and therefore deliberately
  disagrees with `countsAsScheduledGame`.** That predicate answers "is this a
  real scheduled game" for exports and reports; this grid answers "is this field
  spoken for", and a pending interleague proposal occupies the field — the
  reschedule picker's occupancy read counts it for the same reason. Pending
  games carry their own marker. Away interleague games have `venue_id` null and
  cannot appear at all; that is correct, and the grid states the count in a
  footnote rather than leaving them unaccounted for.
- **"Show cancelled" hides BLOCKS, NEVER ROWS**, and defaults ON. It is LOCAL
  component state, not a URL param (unlike `?past=`, which changes the query):
  every status is already fetched, so it is pure display. Rows are derived from
  the UNFILTERED game list, which makes the blocks-only rule structural — a
  field whose only game this week is cancelled keeps its row when the toggle is
  off. Do not reroute this through the query.
- **`hidePast` does not apply in week mode** (and its toggle is hidden there). A
  Monday-to-Sunday grid with its first three days clipped has empty columns
  meaning "already played", which is indistinguishable from "nothing
  scheduled" — the same misread the practices footnote exists to prevent.
- **Row headers use the BARE venue name, never `qualifiedVenueLabel`**, and
  rows are FLAT with no location bands: 70% of live venues have no location at
  all, SRALL's venue names already carry their own "@ Complex (LEAGUE)"
  suffixes, and one live location is named identically to its own venue. Sort is
  location asc with NULLS LAST, then venue name.
- **Practices are not shown, and the footnote saying so is load-bearing** — a
  blank Wednesday otherwise reads as "this field is free" and an admin books
  over a practice. A `?division=` filter adds a second footnote for the same
  reason: under it an empty cell means "no games for THIS division", not "free".
- **The clock is read in exactly three places, ALL post-mount, NONE in a render
  path**: the mode toggle's `onClick`, the grid's "This week" `onClick`, and the
  `useEffect` that `router.replace`s a missing `?week=`. Neither client
  component reads a clock, a random, or `toLocale*` while rendering, so server
  and client markup are identical. **Any change that moves a week default into
  render is a hydration mismatch that tsc, eslint and `next build` all pass** —
  it only breaks at runtime. On an unresolved first render the grid shows a
  static "Loading week…" and the effect replaces the URL; it never paints a
  wrong week.
- **The two render decisions live in `week-grid.ts`, not in the JSX** —
  `visibleBlocks` (which blocks a cell shows for a toggle state) and
  `blockMarkers` (cancelled / pending / interleague). They are there so the
  harness drives the SAME code the component calls rather than a copy; the
  component has no second implementation. `fmtTimeRange` and `rendersStartOnly`
  share one `hasUsableDuration` predicate for the same reason.
- **Division color coding is DERIVED FROM THE DIVISION ID, never stored.** Each
  block carries a 3px colored LEFT edge (LEFT corners squared so the stripe is
  not clipped; the right corners keep the block's original rounding), plus a legend above the grid covering only the divisions ON SCREEN
  that week. Lives in `src/lib/schedule/division-colors.ts`.
  **Do NOT store a color in `divisions.settings`** — that jsonb has many readers
  and several writers, and the wizard save writes it WHOLESALE from form state
  rather than merging the stored row, so a stored color would be silently
  dropped by the next wizard save. The one-parser-one-writer discipline that
  makes jsonb extension safe does not hold there. Deriving costs nothing and
  cannot drift. There is no picker and no user-chosen color.
- **The assignment rule: hash-with-linear-probe over the SEASON's divisions.**
  Sort the season's ids ascending, take `fnv1a(id) % PALETTE.length` as the
  preferred slot, and walk FORWARD to the next free slot if it is claimed.
  Sorting first is what makes the caller's array order irrelevant. **Assignment
  must run over the SEASON's divisions, never the week's** — otherwise a
  division's stripe changes as the admin pages. Plain hash-modulo without the
  probe collides constantly (five ids into ten slots collide often by the
  birthday bound) and is mutant-proven to break the "five distinct colors"
  assertion.
- **The stability guarantee, stated rather than implied:** identical for the
  same SET of ids, always, with no randomness/clock/state; ZERO collisions while
  `count <= palette size`; **adding a division never moves any division whose id
  sorts BEFORE it**, and one sorting after moves only if the newcomer claims the
  exact slot it held (removal has the mirror property). That residual movement
  is inherent to collision resolution over a shared slot space, and is accepted
  because the division NAME is on every block — color is reinforcement, never
  the sole carrier of the information. **Do not remove the name to make room.**
- **Palette is 10 mid-tone hex colors** — headroom over a full Little League
  ladder (8) and over the largest live season (5). **More divisions than colors
  REPEATS a color; it must never throw and never degrade to grey.** Colors are
  applied as inline `borderLeftColor`, NOT Tailwind classes: the JIT only emits
  classes it can see as complete literal strings, so a computed
  `` border-l-${hex} `` compiles to nothing — a silent failure that looks like
  the feature simply not rendering.
- **CANCELLED WINS.** A cancelled block keeps its greyed, struck-through
  treatment and gets the NEUTRAL edge, never its division color — a greyed block
  with a bright stripe sends two competing signals at once. `blockEdgeColor` is
  the single place that rule is applied; a game with no division, or an id not
  in the season, falls back to the same neutral edge rather than throwing.
- **NOTE: this app has no dark mode.** No `darkMode` key in the Tailwind config,
  zero `dark:` variants in `src`, no `prefers-color-scheme` anywhere (verified
  2026-08-21). The palette is chosen to survive one arriving, but nothing
  exercises that today and no `dark:` variants were added — one component
  carrying them while the rest of the app has none would be inconsistent and
  untestable.
- **Harness: `npm run sim:week-grid`** (`scripts/sim/week-grid-sim.ts`) — **81
  assertions and 14 ANTI-VACUITY COUNTERS** over the real
  `src/lib/schedule/week-grid.ts`, run three times under **UTC,
  America/Los_Angeles and Pacific/Kiritimati**. It deliberately does NOT pin
  `TZ=UTC` like the other sims: timezone independence is its headline
  assertion, and every expected value is a literal so a result that shifts with
  the host zone fails instead of quietly agreeing with itself.
  **A ZERO COUNTER FAILS THE RUN.** Scenario R walks rows × days × blocks the
  way the component does and counts what actually happened: cancelled blocks
  rendered and hidden, a row surviving with only a cancelled game and the toggle
  off (separately via the eligible arm and via the union arm), union-arm-only
  rows, an empty eligible row, an away game dropped, an out-of-week game
  dropped, pending and interleague blocks labelled, a start-only block, a
  resolved end-time block, and a multi-block cell.
  15 mutants: 14 killed by their own assertion or counter, 1 proven equivalent
  (a UTC-anchored `weekDates` — UTC has no DST) with its genuinely unsafe
  local-milliseconds sibling killed. **M14 (blockMarkers loses the pending
  distinction) is killed ONLY by a vacuity counter** — that is what proves the
  counters bite rather than decorate; don't delete them as noise.
  **THREE assertions were found VACUOUS during the pass** and the fixtures were
  rewritten around them: the out-of-week game had to move to a weekday no
  in-week game occupied, the tied-start pair had to be supplied in REVERSE id
  order because V8's stable sort satisfied the tiebreak assertion without the
  tiebreak, and the union arm needed a venue whose ONLY game is cancelled before
  a `countsAsScheduledGame`-style filter there could be caught. Don't undo any
  of those fixture details; each exists so a mutant has something real to kill.

## Bye line (division schedule panel)

- **Lives on the division schedule panel ONLY** (`division-schedule-panel.tsx`)
  — not the main Schedule page (that page is season-wide and flat; per-division
  byes there are a different, larger job). It is derived READ-ONLY display: a
  per-week "Bye: {teams}" line rendered at each week boundary, computed from the
  division's own game rows. **A team is on bye for a week iff it has ZERO game
  rows of ANY status that week** (appearing as `home_team_id` or `away_team_id`).
  Weeks with no games render no line — there is no day-group to anchor to
  (accepted for v1). Helpers live in `src/lib/venues/game-days.ts`; harness is
  `npm run sim:bye-line` (feature landed in commit `1a99665`).
- **`teamIsOccupiedThisWeek(status)` is status-blind ON PURPOSE — do not "fix"
  it.** It ignores its `status` argument (always returns `true`) and carries an
  inline `eslint-disable` for the deliberately-unread parameter. That parameter
  is the SEAM, not an oversight: any row — cancelled, `pending_interleague`,
  anything — means the team MIGHT be playing, and the bye line answers "is it
  safe to move a game onto this team this week," where "might be playing" must
  never read as free. Do NOT add a status filter, and do NOT collapse it into
  `countsAsScheduledGame`, which is the OPPOSITE predicate: that one filters FOR
  real games (excludes cancelled + pending_interleague) to feed views that
  report actually-scheduled games (venue game-days, Sports Connect, Reports).
  The two carry mutual DRIFT-HAZARD comments naming each other; keep both, and
  keep them apart.
- **Week bucketing is one of FOUR consumers of `weekKeyFromIsoDate`** (alongside
  Sports Connect `RoundNo`, the venue game-days derivation, and the
  week-by-field view mode). Never invent a
  second week definition — wall-clock date substring only, never parse the
  instant (house convention; see the `game-days.ts` header).
- **KNOWN GAP — reads `games`, NOT `playoff_games`.** `playoff_games` is a
  parallel table the bye computation does not touch, so once brackets exist a
  team playing ONLY a playoff game in a given week will wrongly read as on bye.
  Unresolved by design for now — **flag/close this before playoffs go live.**
- **Styling is neutral GRAY, deliberately not amber.** Amber means WARNING in
  this codebase (constraint violations, coach double-booked, interleague,
  locked); a bye is neutral information requiring no action. Same reasoning as
  the neutral prefer-miss notes — do not restyle it as a warning.

## Generate-all ordering

- **`npm run sim:scarcity` proves the "generate all divisions" run-order**
  (season-page control): divisions schedule most-constrained-first, sort key
  `slack = supply − demand` with tiebreak `supply → created_at → id`. Re-run
  it after ANY change to `src/lib/schedule/scarcity-order.ts` or to
  `buildSlots` in `generate-schedule.ts` — the scarcity supply is computed
  from the REAL `buildSlots`, so a change there can silently shift ordering.

## Matchup placement order (round-order fix, 2026-07-23)

- **Intra-division matchups are placed ROUND BY ROUND — never re-shuffle
  across rounds.** `buildMatchups` emits pass-groups where each group is a
  (possibly partial, near the end) perfect matching;
  `orderMatchupsForPlacement` is the ONLY sanctioned flattener. The old
  cross-list `shuffle(...)` interleaved pairs from different rounds; under
  the live Saturday-league shape (games_per_team == playing weeks ×
  max_games_per_week — ZERO weekly slack) the greedy placer then stranded
  matchups behind exhausted weekly caps and reported "not enough slots" on
  divisions with ample fields (eight consecutive live regenerations of
  50/70 scored 23–30 of 30 on identical data). Round order makes the
  exactly-tight shape place 100% by construction: round r fills date r.
- **Within a round: shuffle for slot variety, then stable-sort
  constrained-first** — pairs involving a team with any
  `team_game_constraints` rows (block or prefer) go ahead of the rest; the
  set comes from the constraint-rules map already loaded, no extra query.
  This is load-bearing where a constraint shrinks a team to scarce slots
  (50/70's Expos: 09:00-only, two 09:00 slots per Saturday — the division
  only reaches 100% placement if that pair picks first). Mutation-proven;
  don't demote it to cosmetics. It is still an ORDERING PREFERENCE, not a
  scheduling guarantee.
- **There is deliberately NO coach tier in the ordering, and must not be.**
  A coach tier was written and REMOVED before ship (2026-07-23) on exactly
  this reasoning: under greedy earliest-first placement, giving a shared
  coach's two pairs first pick lands them at the SAME earliest start on
  different fields — it manufactures the very double-booking it reads like
  it prevents. Same-division coach overlap is not prevented anywhere in
  this engine (see Coach conflicts below — Chunk 2 still deferred). Do not
  add an ordering knob that implies otherwise; the round-order sim's
  COACH12 fixture and unit group-2 assertion both fail if a coach tier
  comes back.
- **Both shuffling call sites got the fix** (`generateSchedule` and
  `planScheduleForNewDivision`; the wizard path passes an empty constrained
  set BY DESIGN — its teams don't exist in the DB yet, so round order
  applies but the priority sort has nothing to act on). `finishSchedule`
  needs NO ordering change: its deficit pair-builder already cycles rounds
  deterministically with no shuffle. Its blind pairing (pairs deficits
  without checking common free weeks, increments planned counts on build
  not placement) is a KNOWN separate gap — out of scope, do not conflate.
  Interleague matchups keep their own shuffle (per-team repetitions, not
  round-structured); generate still orders intra → home-IL → away-IL.
- **finishSchedule excludes cancelled games from team totals and caps**
  (`.neq("status", "cancelled")` on the existing-games fetch) — a cancelled
  game is not a game played, so finish now creates its makeup;
  `pending_interleague` rows still count (recreating them would duplicate
  invites). Venue bookings still count cancelled rows in BOTH copies —
  deliberately consistent with the umpires open question (revisit alongside
  rainout workflows).
- **Harness:** `npm run sim:round-order` (`scripts/sim/round-order-sim.ts`,
  TZ=UTC mandatory) — full playthroughs of the real generator at the live
  shapes (6/12/16 teams, 10 games, cap 1/week, 10 Saturdays) asserting 100%
  placement + round-robin balance on exactly-tight fixtures, plus the
  constrained-first, no-coach-tier, cancelled-filter, odd-bye, and
  orderMatchupsForPlacement unit checks. Mutation-tested 2026-07-23
  (4 mutants: restored cross-round shuffle, removed constrained-first sort,
  removed within-round shuffle, removed cancelled filter — ALL killed,
  re-verified after the coach tier was dropped), with
  anti-vacuity counters proving the week-exact and venue-exact scenarios
  actually ran. Re-run it AND `sim:game-constraints` after ANY change to
  generate-schedule.ts. The in-memory fake Supabase client is shared at
  `scripts/sim/fake-supabase.ts` — when the engine grows a new query shape,
  extend THAT fake (it throws on unknown shapes; never stub in a sim).

## Skip-reason attribution (why games went unplaced)

- **`src/lib/schedule/placement-diagnostics.ts` is the ONE home for both the
  per-filter attribution and the shortfall wording.** Every surface renders
  `shortfallSummary` VERBATIM — same rule as the schedule-lock wording
  helpers: never hand-write a shortfall sentence at a call site, and never
  write a parallel attribution.
- **Attribution runs AFTER abandonment, never inline — this is load-bearing.**
  The walk short-circuits (`continue`) on the first failing filter, so inline
  per-slot counters would be biased by chain ORDER: the first filter checked
  takes credit for every slot the later filters would also have rejected.
  (The pre-existing constraint attribution is honest only because the
  constraint check sits LAST.) Instead `tallyRejections` runs only for
  matchups that already failed, evaluates every filter INDEPENDENTLY with no
  short-circuit, and mutates nothing. Zero cost on the success path.
- **It is a REPORTING change and must stay one.** `planSchedule`'s walk is
  byte-identical in behavior; the harness pins this against a golden recorded
  from the pre-change tree (`scripts/sim/fixtures/placement-golden.json`) plus
  a golden-free INV2 check. If placement moves, something leaked — fix the
  leak, do NOT re-record the golden (the recorder's header states the only
  legitimate re-record case).
- **The venue availability window is NOT a walk filter.** `isVenueAvailable`
  runs inside `buildSlots`, so a too-short window yields a SMALLER SLOT POOL
  and then surfaces in the walk as venue collisions. A walk counter for it
  would read zero in exactly the case that misleads — which is why it is a
  supply-side computation instead. Same for `max_games_per_field_per_day`.
- **WHICH FILTERS CARRY ARITHMETIC:** `venue_booking` (via the venue-window
  supply analysis), `weekly_cap` (games per team vs. playing weeks × cap),
  `daily_cap` (vs. playing dates × cap), `org_field_cap` (away games vs.
  partner field count × dates).
  **WHICH DELIBERATELY DO NOT, and must not gain one:** `team_time` (pure
  cascade of prior placements — no meaningful unit), `coach_block` (set by
  ANOTHER division's persisted schedule, which this run doesn't control),
  `team_constraint` (arbitrary per-team rule sets; one "gap" would collapse
  unrelated rules into an invented number).
- **THE CAVEAT THAT MATTERS MOST — a number is emitted only when an
  INDEPENDENT config-level computation proves a shortfall.** A filter can bite
  from pure greedy cascade on a perfectly feasible config. When
  `weeks × cap >= games_per_team` and the weekly cap still dominates, there is
  NO gap: the sentence says the config has room and the games stranded behind
  already-placed ones. That was the real cause of one of the two wrong
  messages this feature replaced; fabricating a gap there would be worse than
  the old copy. Mutant M12 removes exactly this branch and is caught only by
  the D2 assertion — don't delete it.
- **Venue-window narration is REPRODUCE-OR-STAY-SILENT.** Supply is COUNTED
  from the real slot pool, then the per-field narration is recomputed and
  checked against that count; on mismatch (legacy
  `max_games_per_field_per_day` divisions, mixed per-venue windows) the
  arithmetic is suppressed and only cause+count is reported. Mutant M13 needs
  a fixture tuned so every LATER guard passes — an earlier version of P5
  exited at a later guard and let M13 survive.
- **NO LEVER RECOMMENDATIONS, anywhere.** Widening a window, shortening a
  buffer and adding a field can all close the same gap, and which is right
  depends on facts the code does not have (whether the city will grant earlier
  field time). Name the gap; let the admin pick the lever. The harness scans
  EVERY sentence the run produces against a lever-word pattern list and fails
  on a hit — that guard applies to any new wording too.
- **Both placement copies carry the pass** (`planSchedule` and
  `finishSchedule`'s inline copy); mutants M1/M2 cover them separately.
  `planScheduleForNewDivision` gets it via the shared `planSchedule`.
- **Surfaces:** wizard review panel, generate-all modal, setup generate step
  (two renderings), division schedule panel (generate + finish), and all three
  total-failure error strings. All lever copy was removed from them.
- **Harness: `npm run sim:diagnostics`** (`scripts/sim/placement-diagnostics-sim.ts`,
  TZ=UTC mandatory) — 247 assertions, 15 mutants all killed 2026-07-23,
  anti-vacuity counters requiring every filter to have DOMINATED at least once
  plus the empty-pool and tie cases to have fired. `SHOW_SENTENCES=1` prints
  every sentence the run produces. Re-run after ANY change to
  placement-diagnostics.ts, either walk copy, or `buildSlots`.

## Generator reads fail CLOSED (and never run after a destructive step)

- **Every `games` read in `generate-schedule.ts` returns an explicit error, and
  the regenerate DELETE now runs AFTER all of them.** Before this, all 14 reads
  discarded their error while the 3 writes checked theirs. The venue-booking
  pre-load was the dangerous one: on a read error it produced an EMPTY booking
  map, which the placement walk reads as "every field is free at every time", so
  the generator double-booked fields and reported success — with the division's
  previous schedule ALREADY DELETED, because the read ran after the delete. One
  transient blip was enough, at any data size. Nothing in the product said a word.
- **The ordering rule, generalized: no read whose failure is only detectable
  after a destructive step may run after that step.** `generateSchedule` now
  does all reads → builds every map → deletes → plans → inserts. An aborted run
  leaves the games table byte-identical. `finishSchedule` and
  `planScheduleForNewDivision` have no delete at all, so they only needed the
  fail-closed part.
- **STANDING RULE — `willBeClearedByRegenerate` mirrors the regenerate DELETE's
  WHERE clause, and the two must be changed together.** Reading before the
  delete means the pre-load reads still see the rows the delete is about to
  remove, so each subtracts them via this predicate, which mirrors
  `.eq(league_id).in(home_team_id).or("status.neq.scheduled,interleague_org_id.is.null")`.
  **The predicate is TypeScript and the delete is PostgREST filter syntax;
  neither can be derived from the other, so a change to one is silently wrong
  until the other follows.** It is quiet when wrong in BOTH directions:
  under-subtracting makes the division's own outgoing games block their own
  replacement slots (a regenerate that places far fewer games than it should);
  over-subtracting stops OTHER divisions' games from blocking, which is the
  original double-booking bug arriving through the front door. **Anyone who
  edits the delete's WHERE clause MUST edit the predicate to match and re-run
  `npm run sim:generator-failclosed` — assertions D1 (under-subtract) and D2
  (over-subtract) are the ONLY thing pinning the two together.** The function's
  own header carries the same warning; keep both.
- **REGENERATE NO LONGER DELETES A LIVE INTERLEAGUE NEGOTIATION (2026-09-23).**
  The delete preserved games that are `scheduled` AND interleague; a
  `pending_interleague` game was NOT preserved, so a regenerate deleted it, the
  `interleague_reschedule_requests` row CASCADED away, and the partner's respond
  link died showing "This link is no longer active … reach out to the league
  admin" — who no longer had a record of it either. No email to either side, and
  on their live schedule page the game simply vanished. **THE DOCUMENTED RULE
  CHANGED:** `sim:generator-failclosed`'s D3 assertion used to read "a pending
  interleague game is cleared". It is now split — `D3-pendingIL-untouched`
  (still cleared) and `D3-protected` (preserved). That flip is the fix, not an
  assertion loosened to make a build pass.
- **`isProtectedInterleagueGame` is the single predicate.** It protects a
  `pending_interleague` game the partner has TOUCHED — they countered
  (`external_team_name`), their proposed time is on the row
  (`proposed_scheduled_at`), or ANY `interleague_reschedule_requests` row
  exists — plus every accepted game in `reschedule_pending` (restoring 0079's
  rule that accepted interleague games are never silently deleted). An
  UNTOUCHED pending game is still cleared: it is an unanswered proposal, and
  keeping it would let a dead invite strand a row.
  **The request table is READ, never inferred.** A host proposal currently
  implies a partner counter (so `external_team_name` would be set), but that is
  an inference about the order routes are called, not a property of the data.
  **ANY request row counts, not just a pending one** — over-preserving leaves a
  game the admin can still remove deliberately through resolve Decline (which
  emails the partner); under-preserving destroys a conversation.
- **PRESERVE AND REPORT, NEVER REFUSE.** A schedule lock refuses the whole
  regenerate, which is right because an admin lifts a lock in one click. A
  negotiation cannot be cleared in one click — nothing forces it to converge —
  so refusing would leave the division unregenerable until the partner replies.
  `ScheduleResult.preservedGames` rides every result and all four surfaces
  (panel, generate-all modal, setup step, wizard review) render
  `preservedSummary()` VERBATIM — never hand-write that sentence, same rule as
  `shortfallSummary`. A game that survives a regenerate unannounced is the
  silent half of the bug.
- **THE SLOT HAZARD — this is what makes the two predicate copies matter now.**
  A preserved game keeps its slot, so the pre-loads must STOP subtracting it.
  `protectedIds` is computed once and passed to BOTH the delete
  (`.not("id","in",…)`, applied only when non-empty so an ordinary regenerate
  issues the identical statement) and every `willBeClearedByRegenerate` call. If
  the two drift in the TS direction, the game survives and the generator places
  a new game ON TOP of it with no error anywhere — mutant M4, caught only by
  `[D-no-double-book]`.
- **Both protection reads FAIL CLOSED**, before the delete: an unreadable
  request table aborts the whole regenerate rather than treating a live
  negotiation as untouched.
- **Harness: `npm run sim:regenerate-pending-guard`** — drives the real
  generator against the fake client; 31 assertions, 5 counters, 4 mutants each
  dying at its own assertion. **Read its mutation log:** M3 first "survived" by
  CRASHING the run, which printed a stack trace and hid the four failures it had
  already recorded. The sim now tolerates missing rows in the later block and
  prints collected failures on a rejection. A thrown error is not a pass and not
  a clean kill.
- **`delete_game_if_unblocked` HAS THE SAME HOLE AND IS DELIBERATELY NOT FIXED
  HERE — and the two are NOT coupled.** That RPC permits deleting a
  `pending_interleague` game so a dead invite can't strand a row, which means it
  will also delete one mid-negotiation. Closing it is SQL (a new migration, a
  new block reason, the SQL-harness standard). **Deferring is safe because a
  partner's decline goes through the token RPC, not this one**, so tightening
  `delete_game_if_unblocked` later does NOT require touching the 0082 lock
  trigger's matching `pending_interleague` carve-out. Do not assume the trigger
  and that RPC have to move together on THIS question — the rule that they must
  agree is about the lock carve-out, not about negotiation protection.
- **Post-write reads can't fail closed by aborting, so they report UNKNOWN.**
  The cross-division conflict check runs after the insert. On error it now sets
  `ScheduleResult.conflictsUnavailable` (a plain-English message) and returns an
  empty `conflicts` array — **non-null means conflicts are UNKNOWN, not zero.**
  Every surface rendering a conflict count must say so rather than showing 0;
  the setup step, generate-all modal, and wizard review panel all do.
- **Harness: `npm run sim:generator-failclosed`** (TZ=UTC mandatory) — 67
  assertions, anti-vacuity counters, **9 mutants all killed by their own
  assertion** (2026-07-23), including one that moves the delete back above the
  reads and dies with "expected 12, got 0". The shared fake client gained
  targeted read-fault injection (`injectReadFault`, matching on the select
  string) plus `ilike`/`maybeSingle`. **Use `selectEquals`, not
  `selectIncludes`, for the coach-linked read** — its select is just
  `"scheduled_at"`, a substring of every other games select, so a substring
  fault silently retargets to the wrong read.
- **Read that sim's mutation log before touching any of this.** It records three
  separate cases where the tally said "all killed" while the assertion under
  test proved nothing — a wrong-read fault, a happy-path fixture that doubled as
  a subtraction test, and a fixture too loose for the second of two subtraction
  loops to bind. All three were only visible by reading the failing assertion
  NAME on each kill.
- **Still open, deliberately out of scope** (its own session): the five
  venue-keyed reads scoped only by `.in("venue_id", …)` — no season, no date —
  and their PostgREST 1000-row truncation exposure. Whether it is safe to ignore
  bookings outside the season window when concurrent seasons share a venue is a
  design decision, not a mechanical conversion. See "Complete reads".

## Schedule slot grid — canonical import path

- **`src/lib/schedule/slots.ts` is THE home of `buildSlots`,
  `buildPlayingDates`, and the slot-grid helpers/types (`Slot`,
  `DivisionSettings`, `timeToMinutes`, `weekKey`, `minutesToTimeStr`,
  `localDateStr`, `DAY_TO_JS`, `JS_TO_DAY`).** They were lifted out of
  `generate-schedule.ts` verbatim (commit after 2026-07-24) because that
  file is `"use client"` and imports the browser Supabase client at module
  scope, so a SERVER consumer (the Reports field-utilization card) could not
  import `buildSlots` without dragging the client boundary into a server
  render. `slots.ts` carries no directive and depends only on the pure
  availability helpers.
- **NEW code imports from `./slots` (or `@/lib/schedule/slots`), always.**
  This is the single source of the "how many games fit" answer the generator
  and the report must never disagree about.
- **`generate-schedule.ts` re-exports `buildSlots` / `buildPlayingDates`
  (`export { … } from "./slots"` equivalent) as a PERMANENT compatibility
  shim — do NOT remove it, and do NOT migrate the existing importers off it
  as busywork.** Two valid paths therefore exist by design; the rule is new
  code uses `slots.ts`, old importers (`scarcity-order.ts`, the sims that
  reach it via the engine's public surface) keep working through the
  re-export. Removing the shim breaks them for zero benefit. If you ever DO
  choose to migrate every importer to `slots.ts` in one deliberate pass,
  that is a decision to make explicitly and prove with the four generator
  sims — not a "helpful" cleanup to slip into an unrelated diff.

## Venue conflict detection — the buffer belongs to the ARRIVING team

- **THE RULE.** Two games at the same venue/date conflict when their REAL SPANS
  overlap — each span is `[start, start + ITS OWN division's game_duration)`,
  half-open — with the **LATER game's start pushed back by the LATER game's
  `buffer_minutes`**. One predicate: `venueGamesConflict` in
  `src/lib/schedule/detect-conflicts.ts`.
- **WHY THE LATER GAME'S BUFFER — read this before "improving" it.** The buffer
  exists so the **ARRIVING team can warm up and take the field**. It is NOT the
  departing game's teardown allowance. So the gap a pairing needs is whatever
  the team showing up next needs — not the bigger of the two, and not the
  incumbent's.
- **`max(bufA, bufB)` IS WRONG, AND IT IS THE ANSWER YOU WILL REACH FOR.** It is
  the natural way to make a one-sided rule symmetric, and it reproduces ALL 8
  live SRALL false positives exactly (Majors 120+60 at 1:00 followed by Minors
  105+30 at 3:30 — thirty minutes of real daylight, flagged). Earlier-game's-
  buffer reproduces the same 8. **Both are ruled out on live evidence, not
  taste.** `min()` is also wrong in the opposite direction: it clears a pairing
  where the arriving division genuinely needs the gap.
- **The consequence to expect and NOT "fix": a division's buffer no longer
  protects the gap after its OWN games.** A Majors game ending at 3:00 can be
  followed by Minors at 3:30, because Minors needs 30. Confirmed correct.
- **The detector and the reschedule picker MUST agree.** The picker's
  `candidateClearsSpan` uses the PLACING division's buffer — there, the placing
  game is the one arriving. Same rule stated from the two different vantage
  points those surfaces have. `spansOverlap` is literally shared between them
  (detect-conflicts.ts imports it from reschedule-slots.ts) so they cannot drift
  about what "overlap" means. **Change one, change the other.**
- **Do NOT reuse `candidateClearsSpan` in a detector.** It is deliberately
  ASYMMETRIC — the buffer belongs to the placing side and it pads BOTH sides of
  the candidate. A detector has no placing side; both games already exist.
  Inheriting it would smuggle in an unmade decision.
- **`detectScheduleConflicts` (generate-schedule.ts) no longer carries a second
  copy of the predicate** — it imports `venueGamesConflict` and re-exports the
  shared `ConflictInputGame` type. The two wrappers differ ONLY in return shape
  (`games` with display labels vs `gameIds`). Do not re-fork them.
- **MIGRATION BRIDGE — a legacy branch still exists and must die.** When every
  game carries `durationMin`, the real-span model runs; when they do not, the
  OLD start-distance model runs on the scalar args. That fallback exists so the
  fix could land on the LEAGUE PAGE without changing the division panel badge,
  the conflict resolver, or the generator's post-write conflict report, which
  still pass scalars. The fallback is **wholesale per call, never per pair**
  (mutant M8). It is a bridge, not a design — the legacy branch is the wrong
  model. **Do not add new scalar-only callers.**
- **Surfaces STILL on the old model** (each is its own future change): the
  division panel badge (`division-schedule-panel.tsx:364`), the conflict
  resolver list + per-move check (`conflict-resolver-modal.tsx:357/432`),
  `findFreeSlot` (`:150`, also still a fixed lattice), the generator's placement
  loops (`generate-schedule.ts:653/2324`), the placement-diagnostics tally, the
  dashboard critical-alerts count (exact-timestamp only), and `add-game-modal`
  (exact-timestamp only). **Eleven implementations of venue collision exist;
  consolidating them is a project, not a cleanup.**
- **Live result (2026-07-30):** SRALL Fall 2026 went from **8 flagged to 0** —
  all 8 were false positives. The one genuine overlap org-wide (archived QA
  Season 2026-05-19, QA-Memorial 2026-07-27, two same-division QA-TBall games at
  17:45 and 18:00, both 90 min — a real 75-minute overlap) is **still caught**.
  Zero pairs newly flagged anywhere.
- **BOTH GUARDS ARE SILENT BY CONSTRUCTION — if either fires, the symptom is a
  BELIEVABLE NUMBER, not an error.** That is the whole reason the league page
  asserts instead of degrading:
  1. **The legacy fallback is all-or-nothing.** `hasPerGameDurations` uses
     `.every()`, so ONE game lacking a usable duration flips the ENTIRE call
     back to start-distance — every known false positive returns at once, with
     no error, looking exactly like the fix had never shipped. The league page
     therefore passes `{ strictPerGameDurations: true }` and THROWS instead:
     `durationFor`/`bufferFor` are total (they always return a finite positive
     number), so a violation there is a broken invariant, not a runtime
     condition. Mutant M10 pins it.
  2. **`typeof NaN === "number"` is TRUE.** A NaN duration would pass a typeof
     check, stay on the real-span path, and coerce to a ZERO-LENGTH span inside
     `venueGamesConflict` (`Number(NaN) || 0` is 0) — and a zero-length span
     conflicts with nothing, so EVERY conflict disappears, genuine ones
     included. `isUsableDuration` is therefore finite-AND-positive, never
     `typeof`; zero and negative are rejected for the same reason. Mutant M9
     pins it. `venueGamesConflict` carries its OWN copy of the guard because the
     league page's PEER loop calls it directly, bypassing `detectConflicts`
     entirely (mutant M11).
  **Neither hazard is reachable on live data** — all 30 divisions have numeric,
  positive `game_duration` and `buffer_minutes`, and zero teams lack a division
  (verified 2026-07-30), so the 90-minute default is pure defence and currently
  applies to nothing. The guards exist because the failure mode is invisible,
  not because it is likely.
- **KNOWN, NOT FIXED HERE:**
  1. **Harvest-narrow undercount.** `leagues/[id]/page.tsx` detects venue-wide
     but keeps only games whose home team is in the pass's division, so a
     flagged CROSS-division pair contributes ONE game, not two (the old 8 shown
     were half of 16 involved). Orthogonal to the predicate and separable.
  2. **`?? 0` game_duration fallback** on the panel badge (`:364`) and resolver
     (`:355`) gives `minGap = 0` — a division with unset settings reports zero
     conflicts forever. The league page now uses a 90-minute default instead,
     because a 0-length span can never overlap anything.
  3. **Inconsistent cancelled-game filtering.** The peer list skips cancelled
     games; the badge-membership pass does not — so the two can still disagree
     about a cancelled row even though they now share a predicate.
- **Harness: `npm run sim:venue-conflict`** (TZ=UTC mandatory) — 29 assertions,
  6 anti-vacuity counters, **11 mutants all killed by their own assertion**.
  Read its mutation log before touching this; three mutants initially failed
  that standard. **F3b** is the only thing ruling out `max()`/earlier-buffer;
  **F3c** exists solely so the duration-swap mutant has DIFFERING durations to
  corrupt (F3a's two games are both 60 min, so a swap is a no-op there); and the
  instant-parsing mutant SURVIVES the space-vs-`T` format check — under TZ=UTC
  local equals UTC and V8 parses both — so only the **non-`+00` offset**
  assertion catches it. Do not delete F3b, F3c, or that offset assertion.
  M1 (revert to start-distance) must kill F1 while leaving **F2 GREEN**: the
  genuine overlap is caught by both models, and a mutant that killed F2 too
  would prove nothing about which model is better.

## Division panel — "Reschedule game" (2026-09-25)

- **A per-row icon beside the rainout cloud** in `division-schedule-panel.tsx`
  (calendar-clock, `MoveGameIcon`): move a game WITHOUT marking it rained out.
  It first shipped as an action-row button with a pick mode; that was REMOVED
  the same day — every per-game affordance lives on the row, and two ways to do
  one thing on one screen is clutter. Do not bring the pick mode back.
  Rained-out rows get no icon (they keep their own Reschedule button).
  Where a click goes is ONE pure decision, `routeMoveTarget`
  (`src/lib/schedule/panel-reschedule-route.ts`); the panel only switches on
  its result. Never add a routing branch in the panel.
- **Where a refusal shows — decided per case, never silent:** a LOCKED
  division disables the icon with the lock sentence as its tooltip (the roster
  team-delete pattern; the "Schedule locked" card says it on every screen).
  Every other refusal (not yet agreed, request already out, already played,
  no opponent, not a scheduled game) keeps the icon enabled and, on click,
  renders `MoveNoticeLine` DIRECTLY UNDER THAT ROW with its sentence and link.
  Not a tooltip — tooltips don't exist on touch and can't hold a link. Not the
  footer or a toast — a refusal away from the action reads as "nothing
  happened" (Team deletion, Defect 2). `reschedule_pending` has no row chip, so
  that line is the ONLY thing telling the admin a request is already out.
- **The move variant offers NO makeup days** (2026-09-25). Makeup means "a
  RAINED-OUT game may move here"; the move variant clears every flag before the
  slot build via `availabilityForVariant` → `stripMakeup` (the interleague
  picker's function, same reason). Rainout recovery keeps them. A move can still
  reach a non-playing day through the "include non-playing days" override —
  those slots carry the `Off day` chip. Case (a) wording comes from
  `noFieldCopy`: on a move, a non-playing day reads "{Division} doesn't play
  that day." (grey, no link); rainout wording is unchanged and pinned as
  literals. Harness part V drives the REAL builder: a makeup-flagged Friday is
  offered through the rainout door and withheld through the move door, with
  Saturday identical through both.
- **Routes:** ordinary `scheduled` game → `RainoutRescheduleModal`
  `variant="move"` (same picker, same reads, same gates, same save — the
  variant changes the HEADER only: a calendar-clock instead of a rain cloud);
  accepted interleague game, **whatever its date** (2026-09-28: a played-out
  day is what a makeup request is for) → `RescheduleRequestModal` + the
  interleague reschedule route, with an `intro` line saying the partner agreed
  to this time so moving it sends a request; everything else → a stated
  reason, never a silent no-op. `pending_interleague` and `reschedule_pending`
  point at the Interleague page (the resolve flow owns them). Only `scheduled`
  ordinary games move — the picker's save writes `status: "scheduled"`, which
  would silently un-complete a `completed` row. **The rained-out row of an
  interleague game carries "Propose makeup time"** (Free) → the request modal
  with `makeupIntro` (see Interleague negotiation).
- **An interleague game must NEVER reach the plain picker.** Moving a time
  another league agreed to, without their consent, is what the request/respond
  flow exists to prevent. `plain` carries `awayTeamId: string` and is returned
  only when `interleague_org_id` is null AND `away_team_id` is set, so the
  render site needs no `!`. This is what keeps it from being a fifth ungated
  render path (see the reschedule picker's KNOWN DEFECT).
- **LOCK — GATED, AND RAINOUT RECOVERY IS NOT. THIS IS DELIBERATE, NOT AN
  INCONSISTENCY TO "FIX".** Rainout recovery (the cloud, the rained-out row's
  Reschedule) is exempt because weather is not a choice — a locked schedule
  must still survive a rainstorm. A plain move IS a choice, made on a schedule
  that may already be in parents' hands, so it takes the conflict resolver's
  "move" rule: the icon is disabled with `lockedReason(…, "move")`, and the
  router refuses with the same sentence if the lock flips before the click
  (interleague requests use the route's own `rescheduleInterleague` sentence).
  **This is a UI gate, exactly like the resolver's move — NOT a database
  guarantee.** The 0082 trigger's allowlist permits `scheduled_at`/`venue_id`
  writes on a locked division, so a direct RLS update still succeeds.
- **Plan (decided 2026-09-25): the button shows for everyone.** An ordinary
  game on a Free plan opens the Pro upsell (`UpgradeModal`, feature mode);
  interleague requests stay Free, matching the Schedule page's row menu. A
  visible control that explains the upgrade beats a hidden one.
- **One submit path for interleague requests:**
  `submitInterleagueRescheduleRequest` (`src/lib/interleague/request-reschedule.ts`)
  — extracted verbatim from `schedule-list.tsx`, pinned by the differential in
  `npm run sim:request-reschedule`. Both surfaces call it; never inline a second
  `fetch` to that route.
- **Byte-identical guarantees:** `RescheduleModalHeader`'s default render and
  `RescheduleRequestModal` without `intro` are both asserted against goldens
  recorded BEFORE the prop existed (`scripts/sim/fixtures/`). If either fails,
  an existing caller changed — fix the component, never re-record.
- **Harness: `npm run sim:panel-reschedule`** (TZ=UTC) — parts H (header), M
  (request modal intro), R (routing, 10 counters incl. an ordinary game routed
  plain and an interleague game routed to the request), V (move variant's
  makeup strip + case-(a) wording, through the real builder), W (the REAL
  `MoveGameIcon`/`MoveNoticeLine` rendered: disabled-with-lock-sentence, and
  every refusal's sentence + link under the row; counters for a blocked and an
  allowed render), S (source-wiring greps — weak by nature, stated). 15 mutants
  each killed first at its own assertion. **Keep the `ilAnomaly` fixture** (an interleague row WITH an away
  team): without it the "interleague branch skipped" mutant lands on
  `no_opponent` and [R2] passes vacuously.

## Schedule page — "Reschedule" (list menu + calendar popover, 2026-09-26)

- **ONE item, TWO jobs, so the picker variant is chosen PER GAME.** The list
  row menu's and calendar popover's "Reschedule" serves a scheduled game (a
  plain move) AND a rained-out game (rainout recovery). It used to open the
  rainout picker for everything — rain-cloud header, makeup days, no manual
  entry. Never pass a fixed `variant` from this surface.
- **Routing = `routeScheduleReschedule`** (`src/lib/schedule/schedule-page-reschedule-route.ts`):
  the panel's `routeMoveTarget` plus ONE added case. Rained-out non-interleague
  → RAINOUT picker (makeup days, no manual entry, NO lock gate — weather is not
  a choice), Pro only. Rained-out interleague → the REQUEST modal with makeup
  wording, any plan, no lock gate (2026-09-28 — it used to be a refusal).
  **The list's "Request reschedule" / "Propose makeup time" item goes through
  the same hook** — the list's private request wiring is gone.
  Everything else → `routeMoveTarget` unchanged: scheduled → MOVE picker
  (manual entry, no makeup days), accepted upcoming interleague → request flow
  with its intro, Free → upsell, and every other case a stated refusal.
  `pickerFor(route)` is the ONE place a route becomes a variant.
- **COMPLETED games are refused — this closed a live path.** The item used to
  open the picker for a `completed` game, and the picker's save writes
  `status: "scheduled"`, which would have silently un-completed a finished
  game. `routeMoveTarget` refuses it (`not_movable_status`).
- **Shared wiring: `useScheduleReschedule`** (`src/components/schedule/`) —
  both the list and the calendar call it, so they cannot drift. It renders the
  picker (routed variant, typed `awayTeamId`, current time/field for the
  manual form), the request modal and the upsell. The list's separate
  "Request reschedule" item (upcoming accepted interleague games) is unchanged.
- **Refusals are never silent.** Pending / already-requested / past /
  rained-out interleague games used to show "Reschedule" and do NOTHING on
  click. Now `MoveNoticeLine` (the panel's component) renders the reason in a
  full-width row directly under the list row, or inside the calendar popover,
  which stays open to show it.
- **Lock** from the page's EXISTING divisions read (`locked` added to its
  select — no extra round trip). `rescheduleItemLockTitle` disables the item
  with the panel's "move" sentence for a scheduled, non-interleague game on a
  locked division; the router refuses the same case with the same sentence.
  Page-load state — the move picker's manual save re-reads the lock anyway.
- **Plan visibility matches the panel:** `rescheduleItemVisible` — Free sees
  "Reschedule" on every game that isn't rained out (click → upsell); rained-out
  games stay hidden on Free, as the panel hides the rained-out row's button —
  EXCEPT an interleague game, whose item is a request (Free) and always shows.
- **`useScheduleReschedule` is now shared by SIX surfaces** (list, calendar,
  log-rainout, rained-out card, conflict card, upcoming list): `ReschedulableGame`
  is the minimal input, each surface's select carries the interleague fields
  (`interleague_org_id`, `interleague_org(name)`, `is_away`,
  `external_team_name`, `proposed_venue_name`, `venue_id`, `league_id`,
  `home_team.division(name)`), and every refusal renders `MoveNoticeLine` at
  the action. The conflict card gained the plan gate it never had (it fit both
  July incidents). The dashboard page reads locked divisions in one small
  query so the upcoming list can disable the item before the click.
- **Mobile game cards and the week grid have no reschedule** and were left
  that way.
- **Harness: `npm run sim:schedule-page-reschedule`** (TZ=UTC) — parts R
  (routing grid), V (per-game variant; makeup day through the REAL slot
  builder), L (lock), P (plan visibility), S (source wiring). 29 checks,
  counters for a scheduled game routed to move and a rained-out game routed to
  rainout. 9 mutants, each killed first at its own assertion.
- **NOT FIXED, recorded:** "Mark as rained out" still shows on games that are
  ALREADY rained out in the list menu and the calendar popover (the mobile
  card disables it via `RAINOUT_BLOCKED_STATUSES`; the desktop menu and the
  popover don't). And the dashboard cards' four ungated picker render paths —
  see the reschedule picker's KNOWN DEFECT.

## Move picker — "Enter a time manually" (2026-09-26)

- **The escape hatch for a time or field the slot list doesn't offer.** On the
  reschedule picker's MOVE variant only (the row "Reschedule game" icon), a
  small footer — "Need a time or field that isn't listed? Enter a time
  manually" — the interleague picker's pattern. Rainout recovery keeps offering
  slots and has no manual path. Form: `manual-move-form.tsx`; every decision:
  `src/lib/schedule/manual-move.ts` (pure).
- **FULLY manual:** any date, any time, any venue in the org — every venue by
  `owner_id`, labelled `qualifiedVenueLabel`, the same list as Add Game,
  INCLUDING its duplicate-name exposure (two location-less venues with the same
  name get identical labels; zero exist live; no tiebreaker invented). No
  filtering by division attachment, playing days, hours or occupancy. The
  footer sits OUTSIDE the picker body, so it stays reachable when the slot list
  fails to load — e.g. a division with no configured fields, the case this
  exists for. Saves `scheduled_at` + `venue_id` together, in the picker's bare
  wall-clock shape (`2026-10-10T15:30:00`); `status` is not written (only
  `scheduled` games reach it).
- **CONFLICTS ARE NOTICES, NEVER GATES, AND NOTHING IS RECORDED — THIS
  DIVERGES FROM ADD GAME ON PURPOSE. DO NOT "FIX" IT.** Add Game and the
  conflict resolver's manual move BLOCK until the admin types a reason
  (recorded in `conflict_overrides`). Add Game is placing a NEW game and can
  afford to demand a justification; this is an escape hatch whose whole purpose
  is to stop asking. What it must do is SAY what the save steps on: field
  already booked (`candidateClearsSpan` — real spans, the arriving division's
  buffer, the picker's own predicate), a team already playing then
  (`spansOverlap`, no buffer), outside the field's hours / closed that day /
  hours not set (`dayWindowBounds`, must END by close), a day the division
  doesn't play, a blackout date. A read that fails says "couldn't check" and
  the save stays allowed — never an empty all-clear. `manualSaveEnabled` takes
  the conflicts only to state in code that they never disable Save.
- **Occupancy reads are DATE-bounded, never league-bounded** (another season's
  game at the same field genuinely occupies it — see "Occupancy read scope"),
  one field on one day plus two teams on one day, so plain reads with their
  errors checked rather than `fetchAllRows`.
- **The lock is RE-READ AT SAVE — manual path only.** `routeMoveTarget` keeps
  the picker closed on a locked division, but the lock can be switched on while
  the form is open, and the 0082 trigger permits `scheduled_at`/`venue_id` on a
  locked division — so without the re-read the manual path would be the way
  around the lock. `fetchDivisionLocks` → `manualSaveLockRefusal`: refuses on a
  locked OR UNREADABLE lock. Still a UI gate, not a DB guarantee.
- **The interleague guard IS the variant check.** `manualEntryAvailable` is
  true for "move" only; the move variant opens only from a `plain` route
  (non-interleague, real away team); the four picker render paths ungated for
  interleague all use the RAINOUT variant. Mutant MM1 (link on every variant)
  is exactly the leak.
- **Harness: `npm run sim:manual-move`** (TZ=UTC) — 39 checks: variant/route
  guard, every conflict kind with its sentence and boundary fixtures (buffer
  edge, team game ending at the start, game ending at close), failed reads,
  lock refusal, Save never gated, input parsing, source wiring. Counters: a
  conflicting and a clean save each reached "Save enabled", all 8 conflict
  kinds produced, interleague games routed. 5 mutants, each killed first at its
  own assertion.

## Game notes (2026-09-28)

- **`games.notes` is an INTERNAL free-text note on a game** — it existed since
  0001, unused, until now. Decided, do not re-litigate: never printed, never
  exported, never shown to parents or to a partner league on any token page;
  editable while the division is LOCKED; a property of the game, edited where
  the game is seen and never inside the reschedule flow. Helpers:
  `src/lib/schedule/game-notes.ts` (pure); pieces: `GameNoteIcon` /
  `GameNoteLine` / `GameNoteDot` in `src/components/schedule/game-note.tsx`;
  the ONE editor: `useGameNoteEditor`.
- **Where it shows.** Every surface that shows a game, so an admin can trust
  the ABSENCE of a line to mean there is no note: Schedule list (row + mobile
  card), calendar (dot on the pill; line + icon in the popover), week grid
  (dot), division panel row, the three dashboard cards, and the game detail
  modal (full text, read-only, with attribution). NOT the log-rainout picker
  or the add-game modal. Two ways in, both on the row: the icon (outline and
  a faint outline when empty; filled and violet when present — ALWAYS visible
  in both states, since a hover-revealed empty icon made the first note
  undiscoverable on a mouse, found on the day it shipped) and
  the line itself (one truncated grey line under the matchup, full text on
  hover). 500 characters — the UI counts, a database CHECK enforces.
- **Attribution is a TRIGGER, never the write** (`set_games_notes_attribution`,
  0095): `notes_updated_at` / `notes_updated_by` (FK → `profiles`, set null)
  on every note change, cleared on removal. A writer cannot forget it or lie
  about who edited. Both columns are in the lock allowlist on the merits and in
  the posted trigger's ignore set. The editor embeds
  `notes_editor:profiles!games_notes_updated_by_fkey(full_name)` — profiles'
  RLS already lets org-mates read each other's name.
- **`NOTE_SELECT_FIELDS` is the one string every select carries** (Schedule
  page, panel, dashboard page, league page). That is deliberate and it is also
  THE HAZARD: the very object the print regions render from now carries the
  note. The omission is proven three ways and the third is the one that
  matters: `npm run sim:game-notes` scans both print regions, both CSV
  builders, the email builders and the partner-facing pages for `notes` (O1);
  `scripts/sim/game-notes-triggers-sim.sql` scans every token RPC's prosrc AND
  plants a note on an accepted interleague game and reads it back through the
  schedule token (K1/K2 — behavioural, catches a leak by any means); and the
  page/panel selects are asserted to CARRY the fields while the print files
  never reference them (O3). Mutant GM1 (the print region renders `{g.notes}`)
  is the one the design exists for.
- **A note line inside an auto-layout table cell must carry `w-0 min-w-full`**
  (2026-10-08). `GameNoteLine` is `block max-w-full truncate` — one nowrap
  line — and in a `<table>` without it the line's FULL width becomes the
  column's minimum: SRALL Fall 2026's 180-character note sized the Schedule
  list's Matchup column to 1,028px and pushed Division → Status off the card
  (reported in Safari; reproduced in Playwright WebKit AND Chromium).
  `w-0 min-w-full` makes it fill the cell while adding no width. The snack
  shack table caps its note at `max-w-[16rem]` instead; any new table cell
  hosting a note line needs one or the other.
- **The activity log records the EVENT, never the text**
  (`game_note_updated` / `game_note_removed` with the matchup and date).
- **Harnesses:** `npm run sim:game-notes` (45 checks, 6 mutants each killed at
  its own assertion, counters for a game with and without a note through each
  piece) and `scripts/sim/game-notes-triggers-sim.sql` (SQL, both triggers:
  note allowed on a locked division and attributed, note-only edit keeps
  `posted`, mixed edit clears, every other edit still clears, removal clears
  attribution, the 500 CHECK, INSERT branch untouched, the partner-leak
  fixture; 6 mutants killed at their own tag). The full
  `schedule-lock-sim.sql` was re-run on the same batch with T5c re-keyed:
  every pre-existing lock assertion holds.

## Row icons on touch screens — `ROW_ICON_REVEAL`

- **A hover-revealed control must never be invisible-but-tappable.** The
  panel's rainout cloud used `opacity-0 group-hover:opacity-100`; a touch screen
  never hovers, so on a phone it was INVISIBLE BUT STILL TAPPABLE — a tap on the
  blank right edge of a row could mark a game rained out with no control on
  screen. Fixed 2026-09-25 for the cloud and the "Reschedule game" icon.
- **The fix keys on INPUT TYPE, not width:** a `can-hover:` Tailwind variant
  (`@media (hover: hover)`, `tailwind.config.ts`) and the shared class string
  `ROW_ICON_REVEAL` (`src/components/ui/row-icon-reveal.ts`). Pointer devices:
  hidden until hover, grey-200 — exactly as before. Touch: always visible,
  grey-400 (grey-200 on white is visible in name only). Never a `sm:`/`md:`
  breakpoint: a narrow desktop window still hovers and a large tablet doesn't.
- **The string must stay a complete literal under `src/components`** — the
  Tailwind content globs don't scan `src/lib`, and the JIT emits nothing for a
  class it can't read whole.
- **Harness: `npm run sim:row-icon-reveal`** compiles the old and new classes
  with the REAL Tailwind config and resolves effective opacity/colour on both
  device types; pointer rendering asserted unchanged, touch asserted visible.
  4 mutants. Its mutation log records a first TV2 that was a touch mutant
  mislabelled as a pointer one — read it.
- **NOT yet converted, same hazard class:** the roster's team rename/delete
  icons in this same panel (`opacity-0 … group-hover:opacity-100`, ~:910 —
  delete opens a confirm dialog, so lower risk), and hover-revealed controls in
  `interleague-page-client.tsx`, `venues-page-client.tsx` and
  `practices-page-client.tsx`. Convert each to `ROW_ICON_REVEAL` when touched.
- **Row space on phones — recorded, not fixed.** The panel's game row is one
  line at every width, and its right cluster (venue name + icons) does not
  shrink. SRALL's venue names are long ("Andrews Field @ Monroe Complex
  (SRALL)", ~200px at text-xs), so at 375px the team names already get a few
  dozen pixels before truncating; the second icon (a gap-0.5 pair, ~30px)
  tightens that further. The real problem is the unshrinkable venue name — let
  it truncate, or wrap the row on narrow screens — a separate change.

## Makeup days (per venue, per day)

- **`venues.availability` gains a per-day `makeup?` boolean** — sibling to
  `practice`, same jsonb, no schema change. It means "rained-out games may be
  rescheduled onto this field on this day". Honored by the rainout reschedule
  picker and NOTHING else. **The same picker's "move" variant (the division
  panel's per-row "Reschedule game" icon) STRIPS the flags — decided
  2026-09-25**: a plain
  move is not a rainout. `availabilityForVariant`
  (`src/lib/schedule/reschedule-variant.ts`) is the one place that decides, and
  `noFieldCopy` keeps case (a) from naming makeups on a move. (The interleague counter-proposal picker reads it
  only to CLEAR it — `stripMakeup` — because a counter-proposal is not a
  rainout; see "Interleague counter-proposal picker".)
- **`makeup` DEFAULTS FALSE. `practice` DEFAULTS TRUE. The two are opposite ON
  PURPOSE — do not "make them consistent".** `practice` defaults true because
  every pre-existing venue was already practice-usable and must stay so;
  `makeup` is a new capability, so silence must mean no. Defaulting it true
  would have turned every open weekday at every venue into a makeup day on the
  day it shipped. `isMakeupDay` asks `=== true`; `isPracticeUsable` asks
  `!== false`. Mutant M5 flips the default and dies.
- **ON A MAKEUP DAY THE VENUE'S HOURS GOVERN.** The division's `playing_days`
  and `day_windows` are not consulted for that day — which is precisely why
  designating a makeup day needs no new hours anywhere (Friday has no
  `day_windows` entry in any live division). On a day the division DOES play,
  nothing changes, even if a field is also flagged.
- **EVERY OTHER CONSTRAINT STILL APPLIES**: venue occupancy, buffer (the
  arriving team's), team game constraints, blackout dates, team per-day caps,
  and the must-END-by semantic. Only the day gate and the window source change.
  A blackout still wins on a makeup day (mutant M6).
- **The picker needed NO restructuring, and this is why:** `isVenueAvailable`
  already performs the true per-venue window check inside the venue loop, so the
  outer time loop is only a BOUNDING RANGE. On a makeup day it is widened to the
  union of the flagged venues' windows — min(open), max(close) — and each field
  is still narrowed to its own window. **Do not invert the loops** and do not
  touch `spansOverlap` / `candidateClearsSpan` / the 15-minute grid; the feature
  landed without altering a single predicate.
- **On a makeup-only day, only FLAGGED fields participate.** A field that merely
  happens to be open that day was never offered for makeups.
- **GRID ANCHOR:** the time loop steps from the venue's open time on a makeup
  day (16:30) rather than the division's (10:00). Live windows open on quarter
  hours so offered times stay on the grid; a venue opening at 16:20 would anchor
  there. Pre-existing behavior, newly reachable.
- **THE WHOLESALE-WRITER HAZARD.** `draftToAvailability` (venue-edit-form.tsx)
  rebuilds each day as a FRESH OBJECT LITERAL, so **a key not named there is
  destroyed on the next venue save**. Any new availability key must be added in
  all THREE of `AvailabilityDraft`, `draftFromAvailability` and
  `draftToAvailability` — plus `DEFAULT_DRAFT` and the copy-Monday-to-weekdays
  helper, which builds its own literal. Same class as the `divisions.settings`
  wizard write; safe only because the wholesale writer IS the editor.
- **THE SAVE GUARD REJECTED THE FEATURE'S OWN USE CASE, and now doesn't.**
  `handleSave` blocks a save when a day is open, Practice is unchecked, and it
  is not a derived game day. Open Friday + Practice off + Makeup on is exactly
  what an admin needs here. `makeup` now counts as a purpose. If you add a
  third kind of day-purpose, add it to that guard too.
- **FOUR EMPTY-STATE CASES (three until 2026-09-14).** `isVenueAvailable`
  returns one `false` for two different situations, so the picker separates
  them via `venueDayFit` (closed / too_short / fits):
  - `no_field` — nothing open and makeup-flagged. Links to the Venues page.
  - `window_too_short` — a field IS open and flagged but cannot fit the span.
    **This is the one that matters**: without it a too-short window renders as
    `no_field` and tells the admin to add hours to a field that already has
    them. Names the field and its real hours. Mutant M7 collapses it and dies.
  - `occupied` — REAL candidates existed (a start inside the day's window at a
    field open for the whole span) and every one was rejected by a booking, a
    team game or a team constraint. Informational, quieter, NO link. Ordered
    BEFORE `too_short`: if any field could have taken the game, the day is full.
  - `day_window_too_short` (added 2026-09-14) — a field's hours COULD fit the
    span, but no start on the day's window landed inside them, so there was
    never a candidate to reject. Carries the window, `governedBy`
    (`division` | `makeup_union`) and the span. **Before it existed this was
    reported as `occupied` — "already booked" — with zero rejections behind
    it.** Live trigger: SRALL Fall 2026 AA's Wednesday window is 17:00–17:00
    at a field open 17:00–21:00, so the rainout picker told admins every
    Wednesday was booked. **`occupied` REQUIRES rejections; never collapse
    this back** (mutant M13 in `sim:reschedule-slots`; M7 in
    `sim:interleague-picker`). Differential proof over 20,000 seeded fixtures:
    offered slots byte-identical, and the only diagnostics that moved were
    28,063 `occupied` → `day_window_too_short`, none carrying a single
    venue-booking rejection.
  `blackout` and `team_cap` are reported separately — date facts, not config.
  The weekday roll-up of these is `summarizeByWeekday` in `reschedule-slots.ts`,
  shared by both pickers. **It emits ONE ENTRY PER DISTINCT REASON PER WEEKDAY,
  each with its own count** (2026-09-15). It used to print only the most common
  reason, credited with every empty date of the weekday — live: "Mets already has
  a game that day (7 dates)" for 5 team-cap Wednesdays plus 2 where only AA's
  5pm–5pm window blocked a free team. The hidden minority reasons were the
  actionable ones. A "reason" is what a surface PRINTS (`reasonKey`: `occupied`
  splits by `occupiedBlame`, the window kinds by the window they name). Reasons
  that print no count get one when their weekday has several (`reasonsOnDay > 1`);
  a single-reason weekday renders exactly as before (differential-proven over
  26,000 fixtures). Do not collapse it back — mutant RU1 in sim:interleague-picker.
- **`dayWindowBounds` is the SINGLE definition of a day's window.** Both
  `isVenueAvailable` (does THIS start fit?) and `venueDayFit` (could ANY start
  fit?) are expressed in terms of it so they cannot drift. Never re-derive
  `parseHHMM(w.start)` at a call site.
- **Diagnostics are CAPTURED DURING THE BUILD, never reconstructed** — each is
  written at the `continue`/`if` that caused it. Reconstructing afterwards means
  a second copy of the eligibility logic. `buildSlotsAndDiagnostics` is the real
  implementation; `buildAvailableSlots` is a thin wrapper returning `.slots` so
  slots-only callers and the existing 61 sim assertions are unaffected.
- **NO "outside usual hours" LABEL on a makeup-only day.**
  `earliest_start`/`latest_start` are derived from the division's FIRST PLAYING
  DAY, so labelling a Friday slot against them would present Saturday's hours as
  if they described Friday.
- **THE PICKER STILL READS NO PRACTICE OCCUPANCY.** A practice booked 3–4pm does
  not block a 3:30 game offer. Pre-existing, documented, and deliberately NOT
  fixed here — but makeup days make it more REACHABLE, because weekday evenings
  are exactly where practices live (all 13 live weekday practice entries in
  "Fall 2026" run 17:00–18:30 at fields open 17:00–21:00). Practice and Makeup
  are independent flags; a day may be both and nothing treats that as a
  conflict.
- **The flag is org-level and cross-season.** `venues` has no `league_id`, so a
  Fall makeup-Friday stays set through Spring until someone changes it.
- **Harness: `npm run sim:makeup-days`** (TZ=UTC) — 52 assertions, 10
  anti-vacuity counters, 7 mutants all killed by their own assertion. **The
  generation golden pins `Math.random`**: `generateSchedule` shuffles
  (generate-schedule.ts:165), so an unpinned golden compares noise and proves
  nothing. Both runs get the same seeded sequence and a separate assertion
  proves the pinning works. **Three fixture shapes are required** — every field
  open; a field closed on the playing day but flagged; and a field open on the
  playing day with a too-short window AND flagged. Only the third catches an
  `isVenueAvailable`-level leak; don't delete it.

## Reschedule picker — a DIFFERENT slot model than the generator, on purpose

- **Two models exist in this repo and they disagree. `reschedule-slots.ts` is
  the CORRECT one; the others are the ones to fix.**
  `src/lib/schedule/reschedule-slots.ts` (the picker,
  `RainoutRescheduleModal`) offers EVERY conflict-free start on a **15-minute
  grid** and computes occupancy by **REAL SPAN**, resolving each existing
  game's duration from **its OWN division**. Everything else — the generator
  (`buildSlots` / `planSchedule` / `finishSchedule`), BOTH detector copies
  (`detectScheduleConflicts` and `detect-conflicts.ts`), the conflict resolver,
  and the panel badge — still uses the OLD model: a fixed lattice anchored at
  the division's window open stepping by `game_duration + buffer_minutes`, with
  occupancy measured as **start-distance** (`|a − b| < gap`) using the
  **placing** division's numbers for every game regardless of whose it is.
  **Do NOT "align" the picker back to the lattice.** Fixing the generator side
  is a separate, larger change.
- **Why it was fixed here first (the live bug):** SRALL's Andrews Field hosts
  Majors (120 + 60) at 10:00 and 1:00. Placing Minors (105 + 30), the lattice
  yielded only 10:00 / 12:15 / 2:30 / 4:45; the first three collided, leaving
  **4:45 as the only offer while the field was empty from 3:00 PM**. An admin
  could not place a game at 3:30.
- **BOTH HALVES MUST STAY TOGETHER — half 1 alone is worse than neither.**
  Start-distance **over**-reserves when the placing division's interval exceeds
  the existing game's real span (the Andrews symptom), and **under**-reserves
  when it is shorter — a 90-minute division placed against a 120-minute game
  passes at +90 while that game is still running. The coarse lattice was
  MASKING the under-reservation: at 135-minute steps the overlapping candidates
  were unreachable. Put a fine grid on a start-distance test and the picker
  starts offering slots that **genuinely overlap real games**. Never ship the
  grid without the span test.
- **`buffer_minutes` is SYMMETRIC separation using the PLACING division's
  value.** The candidate's span is padded by the buffer on each side, then
  tested for overlap. Symmetric because clearing the field is needed on both
  sides — after-only padding lets a candidate be crammed against an existing
  game's START. Placing-division because the buffer states how much room THIS
  division needs around ITS games; using the existing game's (Majors' 60) would
  push Minors to 4:00 and re-hide the recovered time. Andrews now offers
  3:30 / 3:45 / 4:00 / 4:15 — `3:00 real end + 30 buffer`, exactly.
- **A window CLOSE means the span must END by it** — in `day_windows.end` AND
  in the legacy `latest_start` fallback, despite that field's name. A window
  that says 18:00 and permits a game running to 18:30 is not a window. This is
  why 4:45 correctly disappeared from Andrews (105 min → 6:30 PM); the fix for
  a league that wants it back is to WIDEN the Minors Saturday window, not to
  loosen this check. **The generator still checks only the START
  (`timeMin <= latest`), so it can place a game the picker considers illegal.**
  Known, accepted, and the safe direction — the picker is the stricter one.
- **REGENERATING A DIVISION WIPES HAND-PLACED TIMES.** A game moved to a
  non-lattice time (3:30) is deleted and re-placed on a lattice time by the
  next regenerate. Nothing warns about this. Tell admins before they hand-place
  a lot of games; it is the same class as the finish-schedule gap-fill note
  under "Game deletion".
- **`spansOverlap` MIRRORS `gamesOverlap` (`src/lib/umpires/conflicts.ts`) — it
  does not reuse it, and the two must NOT be "de-duplicated" without solving
  the units problem first.** `gamesOverlap` is millisecond-based
  (`new Date(scheduled_at).getTime()`), correct for its own all-instants
  inputs. The picker compares a bare LOCAL candidate (`"2026-08-15T15:30:00"`)
  against a stored `+00` wall-clock, so `new Date()` on both would be wrong by
  the browser's offset in every non-UTC zone — and would violate the
  wall-clock-substring house convention (see `game-days.ts`'s header). The
  predicate is identical, transposed to minutes. **The umpire path is untouched
  and byte-identical.**
- **KNOWN GAPS in the picker, deliberately not fixed here:**
  1. **No officials/umpire check on the new slot** — neither availability,
     blackouts, nor double-booking. `game_umpires` assignments travel with the
     game to whatever time is chosen, so a reschedule can silently put an
     official in two places.
  2. **No `practice_slots` occupancy check** — a practice booked 3:00–4:00 at
     a venue does NOT block a 3:30 game offer there.
  3. ~~The venue-occupancy read is org-wide and unpaginated~~ — **CLOSED
     2026-07-30**, see "Occupancy read scope" below. The other two stand.
  4. **THE SAVE IS CLIENT-SIDE WITH NO SERVER RE-CHECK.** `handleConfirm` is a
     bare browser `games.update({scheduled_at, venue_id, status})` under RLS.
     Hours and occupancy are enforced only when the slot is OFFERED, so a
     booking made between open and confirm is not caught, and nothing
     server-side would refuse a hand-built update either. Contrast the
     interleague routes, which run `gateRescheduleVenue` +
     `gateRescheduleOccupancy` on the server. Applies to BOTH variants (rainout
     and the panel's plain move). Worth closing the next time this save is
     touched: route it through a server endpoint that re-runs both gates.
     The move variant's "Enter a time manually" save (below) has the same
     client-side shape and no server re-check either.
- **CLOSED 2026-09-28 — the picker GUARDS ITSELF, and every render path routes.**
  Until then `RainoutRescheduleModal` had eight render paths, four of them
  (log-rainout, the rained-out card, the upcoming list, the conflict card)
  opening it on interleague games with a nullable `away_team_id` asserted
  non-null, and its save wrote `status: "scheduled"` matching on `id` only.
  Two live incidents came from it (SRALL "Fall 2026", test org): `205fb4a5`,
  `pending_interleague` → `scheduled` on 2026-07-13 22:40 bypassing the
  partner's agreement (`accept_interleague_invite` then skipped it, so it still
  renders "TBD"); and `7b595c78`, an ACCEPTED game moved three minutes after
  acceptance with no request and no email. Both identified by "vs Away" — the
  picker's fallback label — in exactly 2 of 341 `game_rescheduled` log entries.
  - **The guard is IN THE PICKER, not per surface** (`src/lib/schedule/picker-guard.ts`):
    at open, before any other read, it reads the game and refuses an
    interleague game (naming the partner and the request to use), a game whose
    status is not the variant's (rainout → `cancelled`, move → `scheduled`),
    or an unreadable game. At save, both conditions ride INSIDE the UPDATE's
    WHERE and `.select("id")` returns the rows: **zero rows is reported as
    "Nothing was saved", never success**. The manual form's save does the same.
    Per-surface routing is how the four ungated paths came to exist; a ninth
    render site will appear eventually and this is what catches it.
  - **The picker is rendered in exactly THREE places** — `useScheduleReschedule`
    (which the Schedule list/calendar, log-rainout, both league-page cards and
    the dashboard upcoming list all call) and the division panel twice (row
    icon, rained-out row). `sim:interleague-makeup` [S3] pins the count. A new
    surface calls the hook; it never renders the picker.
  - **Every save names its surface:** `logSource` (`src/lib/schedule/log-source.ts`)
    appends "— via {surface}" to the activity-log entry. Absent means unknown
    and the message is byte-identical to before, so old entries read the same.
  - **The status condition on the picker's save is the ONE such clause this
    codebase has, and it is acceptable only because a zero-row save is an
    error.** A codebase-wide status-clause sweep was decided AGAINST
    (2026-09-28): zero completed / scored / in_progress / postponed games exist
    live, and every clause would need rows-affected handling or become a silent
    no-op — worse than the bug. A DATABASE TRIGGER is the only layer that
    covers direct RLS writes and the eventual right answer; DEFERRED because
    every legitimate status writer (rainout, "Remove Rainout", the interleague
    routes, the token functions, the generator) needs auditing against it
    first. Both are recorded decisions, not omissions.
  - The PARTNER-facing interleague reschedule never touches this function — it
    uses `RescheduleRequestModal`, a free-text date/venue form.
- **Occupancy read scope — DATE-BOUNDED, NEVER SEASON-BOUNDED, and paginated.**
  `occupancyWindow(startDate, endDate)` in `reschedule-slots.ts` supplies the
  bounds for both of the picker's `games` reads.
  - **Why it is load-bearing:** the read was `.in("venue_id", venueIds)` with no
    date bound and no paging — org-wide, every season ever, straight into
    PostgREST's silent 1000-row cap. Under the OLD fixed lattice a truncated
    occupancy list was largely harmless (the coarse grid skipped past most
    danger anyway). Under REAL-SPAN occupancy it is a correctness defect: a row
    lost to truncation is a game the picker cannot see, so it offers a slot
    directly on top of it, and **nothing errors**. Live at the time of the fix:
    119 rows for a typical SRALL Minors reschedule against the 1000 cap —
    unscoped it accrued ~119/season forever, so it would have reached the cap
    in roughly eight seasons and truncated silently.
  - **DO NOT ADD A `league_id` FILTER.** It looks like the obvious scope and it
    is wrong: a CONCURRENT season's game at the same field on the same date
    genuinely occupies that field. Filtering it out would hide real occupancy.
    Today only one league uses these venues, so the bug would be invisible now
    and wrong later. `games` has no `division_id`; season means `league_id`.
    Date is the only correct axis.
  - **The upper bound rolls to the day AFTER `end_date`, and that is the whole
    point.** `scheduled_at` is a timestamp, so a naive `<= endDate` compares
    against `endDate 00:00` and DROPS every game on the final day — a 3:30 PM
    game on the season's last Saturday is `> 2026-10-24`. Mutant M11 makes
    exactly that change and the final Saturday then offers its FULL grid, on
    top of both real games. Bounds carry an explicit `+00:00` so the comparison
    holds regardless of the database's configured timezone.
  - **Date scope is SUFFICIENT because occupancy is same-date-keyed.**
    `venueBookings` is keyed `venueId:date` and `buildAvailableSlots` consults
    only dates inside the division window, so `[start_date, end_date]` is a
    superset of what is ever read. If the model ever grows cross-midnight
    awareness, this window must widen with it.
  - **The venue read goes through `fetchAllRows`** (complete-or-throw, cap
    discovery, `.order("id")` tiebreak) and fails CLOSED — a partial occupancy
    list is worse than none. This is that helper's FIRST client-component use;
    it is pure TS with no server-only imports. **The team read is date-scoped
    but deliberately NOT paginated:** a `teams` row belongs to exactly one
    season, so it is bounded by games-per-team (max 22 observed either side,
    ~44 for a pair) and cannot approach the cap.
  - **Still unconverted elsewhere** — the Venues page (660 rows), the division
    panel, both CSV exports, `fetchSportsConnectGames`, and the five
    venue-keyed generator reads. Same exposure, separate backlog; see
    "Complete reads".
- **Override toggles — two, both OFF by default, shared by BOTH pickers
  (2026-09-23).** `SlotOverrides` on `BuildAvailableSlotsParams`:
  `includeNonPlayingDays` lifts the playing-day gate ONLY, and
  `allowSecondGameSameDay` lifts the per-day team cap ONLY. Everything else
  still applies under both — venue hours, occupancy, the arriving team's
  buffer, blackout dates, the team's own games, `team_game_constraints`. An
  ABSENT overrides object is today's behavior exactly; that is what makes the
  differential possible, so never make a toggle default on.
- **The off-day semantic is the MAKEUP-DAY semantic, reused.** On a
  non-playing day the VENUE's hours govern (`day_windows`/`playing_days` are
  not consulted), via the same union-of-open-fields bound the makeup path
  already used — the only change is which fields are eligible (any field OPEN
  that day, not just makeup-flagged ones). No parallel branch, and
  `spansOverlap` / `candidateClearsSpan` / the 15-minute grid are untouched.
- **THE EXCEPTION FLAG IS PER SLOT, NEVER PER DAY — this was a real defect the
  harness caught.** A makeup-flagged day is offered with the overrides OFF, so
  its slots are not exceptions; but with `includeNonPlayingDays` ON that same
  day WIDENS to every open field and the whole of their hours, and those extra
  (field, time) pairs ARE new. A per-day rule let them render as normal offers.
  A slot is pre-existing iff its field is makeup-flagged AND its full span fits
  the makeup-only union; anything else on a non-playing day carries `off_day`.
  `exceptions` is OMITTED entirely on a normal slot — not an empty array.
- **Chips are `Off day` and `2nd game`, and must read on their own** (a long
  list scrolls the toggle label out of view), so each carries a `title`
  spelling the exception out. Both chips and both toggles live in ONE shared
  component, `src/components/schedule/slot-overrides.tsx`, rendered by the
  rainout modal and the interleague resolve picker — same one-component rule as
  `VenueEditForm`. Never hand-write an override chip or label at a call site.
- **`governedBy` gained `"override_union"`** rather than renaming
  `"makeup_union"`, so toggle-off output is unchanged. Surfaces must not name
  makeups when it is set: the rainout modal's case-(a) copy and its
  "Mark a field Makeup" link switch to open-field wording, and
  `emptyDayLines` takes `includeNonPlayingDays` so an EVALUATED non-playing day
  prints "the field is closed that day" instead of "{division} doesn't play on
  Mondays". A lifted gate must never still be listed as a reason.
- **Nothing server-side rejects what these surface (verified 2026-09-23).**
  Neither `gateRescheduleVenue` (it checks the venue's hours FOR THAT WEEKDAY,
  which an off-day slot satisfies) nor `gateRescheduleOccupancy` reads
  `playing_days`, and `max_games_per_team_per_day` is read by no route, gate or
  DB function at all. Re-check both before adding a gate that could refuse what
  the picker offers.
- **Cost is the list, not the compute.** Measured 2026-09-23 on the real
  builder: AA's interleague picker 270 slots / 0.32ms with both off → 538 /
  0.69ms with off-days on; the rainout modal at 4 fields 1,232 / 0.87ms →
  2,352 / 2.59ms; a 365-day 12-field stress case 22,032 slots / 47ms. **Reads
  do not change at all** — both surfaces bound their queries by the division's
  date window and venue ids, never by weekday, so a toggle costs one rebuild
  (the rainout modal holds the builder's INPUTS in state for exactly this) and
  no refetch. **PAGINATION CANDIDATE:** the rainout modal already renders 1,232
  rows in its widest live case today and the toggles roughly double it. That is
  a pre-existing property of that surface; it was deliberately not addressed
  here.
- **Harness: `npm run sim:picker-overrides`** — the load-bearing proof is a
  SEEDED DIFFERENTIAL over 2,000 fixtures: with both toggles off, BOTH
  surfaces' full output (slots, diagnostics, weekday roll-up, lines, headline)
  must hash-match a golden RECORDED FROM THE PRE-CHANGE TREE (commit `4eb9b9d`,
  before the builder was touched). **If it fails, the override leaked into the
  default path — fix the leak, do not re-record.** Plus 4 mutants each dying at
  its own assertion and 9 anti-vacuity counters. Read its mutation log first.
- **Harness: `npm run sim:reschedule-slots`** (TZ=UTC mandatory) — 61
  assertions, 8 anti-vacuity counters, **13 mutants all killed BY THEIR OWN
  assertion** (2026-07-30). Read its mutation log before touching any of this:
  two mutants initially died at the WRONG assertion and had to be re-proven —
  M5 needed fixture **F2b** (short existing game, long placing division,
  positioned mid-window) because F2's longer existing game makes mis-sizing
  over-reserve, which is safe and invisible; and the single one-sided-buffer
  mutant was split into **M3a/M3b** so both sides of the symmetric buffer are
  pinned. Fixture **F8** + mutants **M11/M12** pin the occupancy read scope
  above — F8 runs candidate rows through the real window predicate and feeds
  only the survivors to the real builder, so a scope that drops the final day
  shows up as slots offered on top of real games. Do not delete F2b, M3a, M3b,
  F8, M11, or M12.

## Reports — field utilization (placeable-slot model)

- **Utilization is GAMES ÷ PLACEABLE SLOTS, computed with `buildSlots` — the
  generator's own grid — so the report and the scheduler can never disagree
  about what fits.** It replaced a hours-based formula (game-hours ÷ a venue's
  open wall-clock hours × ALL season weeks) that counted non-playing weekdays,
  non-playing weeks, and hours no game could start in (an 8h Saturday window
  fits three 2h games, not four), so packed Saturday-only fields read as ~39%.
  Verified on SRALL Fall 2026 Minors: old 39% → new 73% on the two constrained
  fields; the pre-third-field reconstruction reads 60/60 = 100%, 0 free (the
  honest "at capacity" the old formula hid). Lives in `overview-reports.tsx`
  (server math) + `field-utilization-card.tsx` (display only).
- **DIVISION-CENTRIC, not venue-centric — load-bearing.** "How many slots" is
  not one number for a field shared by divisions with different game lengths (a
  165-min-spaced division fits more starts than a 180-min one), so each division
  owns its own slot count per field, via `buildSlots(..., [venueId], ...)`.
- **Three scoping rules that each prevent re-inflating the denominator — do NOT
  "simplify" any of them; each one, removed, brings the old bug back one rung
  down:**
  1. **Supply is summed only over fields a division ACTUALLY has games on**, not
     every eligible field. Adding eligible-but-unused fields would inflate the
     denominator exactly as non-playing days did. (Eligible-unused fields still
     show as empty columns in the games×divisions matrix.)
  2. **Supply is scoped to the division's ACTUAL playing DATES** (dates with ≥1
     counting game), not all season playing-days. `buildSlots` returns slots for
     every Saturday in the season window; the report keeps only those on dates
     the division plays. A division that plays 10 of 14 Saturdays has no
     capacity on the other 4 (teams at their weekly limit), so counting them
     would dilute the %.
  3. **A shared field's supply is an UPPER BOUND and is MARKED as one.**
     `buildSlots` for (division, field) ignores the OTHER division's games on
     that field, so on a shared field it overstates supply → the % is a FLOOR.
     Those fields (and any division containing one) render with `≤`/`≥`/"up to"
     and a "shared — upper bound" chip. Never let an approximate number render as
     a plain fact next to an exact one — that equal-trust misread is the whole
     reason the marking exists (founder's explicit condition).
- **PRACTICES are in NEITHER numerator nor denominator, deliberately.** The
  generator does not reserve field time for practices (`buildSlots` takes no
  practice input; the placement walk books only games), so netting practices out
  of game supply here would make the report STRICTER than the scheduler —
  calling a field full while the generator places another game on it. Report and
  generator disagreeing about what fits is worse than the asymmetry. Practices
  stay an informational per-division count. **REVISIT TRIGGER: if the generator
  is ever changed to reserve field time against practices, close this asymmetry
  in the SAME change — net practices into supply here and reserve them in
  `buildSlots` together, never one alone.** (Reasoning is also inline in
  `overview-reports.tsx`.)
- **The games read is `fetchAllRows` (fail-loud, complete).** Utilization,
  completion, and the matrix all derive from it; on a read error the entire
  Reports body renders a visible error instead of any partial number. See
  "Complete reads".

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
  coach to two teams in one division. (The 2026-07-23 round-order fix left
  this gap untouched — it deliberately ships with NO coach-aware ordering;
  see "no coach tier" under Matchup placement order above.)
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
  below); the panel's `handleDeleteTeam` delete path is ALSO fixed now — it
  routes through `delete_team_if_unblocked` (0084) + `reconcileJsonbAfterTeamDelete`
  (see "Team deletion (single team)" above), so both copies stay in agreement
  on delete. **Rule: never add a second code path that writes a team name or
  removes a team — route through `src/lib/divisions/reconcile-teams.ts`.**
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
  sites. **Delete-path drift is now CLOSED too:** the panel's team delete
  routes through `delete_team_if_unblocked` (0084) +
  `reconcileJsonbAfterTeamDelete` (see "Team deletion (single team)"), so a
  delete keeps both copies in agreement. SRALL's duplicate rows were repaired
  2026-07-22 — see Historical damage above; the `S Team 1 - Rookie` stale
  jsonb entry from the old delete path is a separate pending data cleanup.

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
- **PER-DAY VENUE FLAGS ARE ORG-SCOPED AND HAVE NO EXPIRY.** `venues` has no
  `league_id`, so both `practice` and `makeup` persist across every season with
  no per-season override and no expiry — a field flagged makeup-Friday for Fall
  Ball is still flagged in Spring, when the schedule shape may be completely
  different. **The two flags differ in CONSEQUENCE when stale:** a stale
  `practice` flag schedules a practice somewhere plausible, while a stale
  `makeup` flag offers GAME slots for a season that may not want weekday games
  at all. Neither is a bug; the second is worth saying out loud in any UI copy
  that sets it.
- **Practice and Makeup both appear on days the division actually plays, until
  a schedule exists.** Both checkboxes are suppressed on DERIVED game days
  (`>= 2` distinct weeks with real games — see `game-days.ts`), and before a
  season is generated there ARE no derived game days, so the controls show on
  Saturday for a Saturday league. Harmless (the day is already offered either
  way) but confusing, and the card already carries an empty-state note about
  it. **Do not "fix" this for one flag only** — the quirk is identical for both
  and they must stay consistent.
- **Street address (0100) — `venues.address` and `locations.address`, ONE
  reader.** Both columns existed unused since 0001/0085 (every row null on
  2026-09-30). The field's own address wins; a blank one falls to its park's.
  The rules live in `src/lib/venues/address.ts` (`normalizeAddress`: trim,
  collapse whitespace, blank-as-null; `effectiveAddress`: the TypeScript twin
  of the reader's coalesce) and the 0100 CHECKs (200 characters, no control
  characters) are the backstop. Written by exactly three surfaces — the shared
  `VenueEditForm`, the Venues page add form, and the park heading's rename;
  the picker's quick-create stays name-only. **Shown to admins on the Venues
  page, to families in the team calendar feed's LOCATION line, and — since
  0105 — on the public league schedule page (`/s/<token>`, with a Maps link)
  and its all-games feed; NOWHERE else**: no CSV, no print region, no partner
  page, no email. `sim:game-notes`
  O1a/O1c scan the outbound files for `address` exactly as they do for
  `notes`; `sim:venue-address` (+ mutants) pins the writers and the card.
  `city` / `state` on both tables stay dead (backlog).

## Division wizard — game days and `day_windows`

- **Switching a day OFF removes its `day_windows` entry. Never leave one
  behind.** `toggleGameDay` used to drop the day from `playing_days` and keep
  its window, so a division could carry hours for a day it does not play. All
  toggle logic now lives in `src/lib/divisions/day-window-toggle.ts`
  (`toggleDayWithWindows`), shared by the division wizard's Schedule step and
  the playoff wizard's Dates step — never write a second toggle.
- **Orphans were INERT, and that is why this was only a data-honesty fix.**
  Every reader checks `playing_days` first: `buildSlots`/`buildPlayingDates`,
  both pickers' `buildSlotsAndDiagnostics` (a non-playing day is either "doesn't
  play" or a makeup day, and makeup days use the VENUE's hours), the playoff
  bracket generator, the review summary, and the skip-reason diagnostics. **No
  DB function reads `day_windows` at all.** The cost was that a forgotten window
  is indistinguishable from a deliberate reservation — which made "is Sunday
  reserved on purpose?" unanswerable. Note `dayWindowBounds`
  (`lib/venues/availability.ts`) is about VENUE hours, a same-shaped map that
  has nothing to do with a division's `day_windows`.
- **Where the orphans came from:** `DEFAULT_WIZARD_DATA` seeds
  `playing_days: ["Sa","Su"]` with a window for each, so every Saturday-only
  division built in the wizard acquired a Sunday orphan. 15 existed in
  production on 2026-09-23 (11 of 30 divisions) — captured with ids and hours in
  `docs/orphan-day-windows-2026-09-23.md`. **No cleanup migration was written**;
  that is a separate decision, and the record exists because only ONE orphan
  (SRALL Majors, Sunday 10:00–18:00) carried hours a person typed.
- **The session stash lives in the wizard CONTAINER and must never enter
  `WizardData`.** Removing a window would otherwise discard hours the admin
  typed, so it is stashed and restored if the day goes back on in the same
  session. It sits in `division-wizard.tsx` / `playoff-wizard.tsx` state because
  only the CURRENT step is mounted — state in the step dies on any trip to
  Review and back. It is outside `WizardData` because that object is what the
  review step saves AND what create-mode drafts write to localStorage; a stash
  inside it would persist the very orphan being removed. Mutant M2 in the
  harness is exactly that shortcut.
- **Enable precedence — existing window, then stash, then default.** The first
  arm is what keeps LEGACY orphans behaving as they always did: re-enabling a
  day whose orphan is still in the saved settings restores those hours. **A
  division that is never toggled saves byte-identical settings**, so existing
  orphans survive re-saves by design; only toggling that day off clears one.
  Consequence to expect: after a save, hours no longer come back across
  SESSIONS (the window is gone), only within one.
- **Harness: `npm run sim:wizard-day-windows`** — drives the real
  `toggleDayWithWindows`; 2 mutants applied to the real source and killed by
  their own assertion, 4 anti-vacuity counters. Read its mutation log before
  changing any of this; it records why B6 and B7 both have to stay.
- **KNOWN, NOT FIXED — `playing_days` is stored in TOGGLE order, not week
  order.** The review step derives the legacy `earliest_start`/`latest_start`
  from `data.playing_days[0]`, which is the first day switched ON, not the
  earliest weekday. A division toggled We-then-Sa stores Wednesday's window in
  those legacy fields. Harmless today (every reader prefers `day_windows` and
  falls back to the legacy pair only when a playing day has no window, which the
  wizard cannot produce), but do not read "first playing day" as "earliest
  weekday" anywhere new.

## Locations (venue → park/complex hierarchy)

- **The model.** A `locations` row (0085) is an org-scoped park/complex
  ("Monroe Complex") that GROUPS venues (fields). `venues.location_id` is a
  NULLABLE FK → `locations(id)` ON DELETE RESTRICT. **The venue stays the
  atomic bookable unit; a location holds NO schedule data.** A venue with no
  location behaves EXACTLY as before this feature existed — that is the whole
  compatibility story (every venue is location-less until an org opts in).
  Migrations: 0085 (table + column + delete guard), 0086 (unique index),
  0087 (token RPCs emit location).
- **THE SCOPE FENCE — and why it holds.** Nothing scheduling-related reads
  `location_id`: not the generators, not conflict detection, not the
  availability jsonb, not `division_venues`, not the Reports matrix, not
  `delete_venue_if_unreferenced`. It holds because every venue reference in
  the engine is ID-keyed (verified: `division_venues`, `teams.preferred_field_id`,
  `snack_shack_settings.home_venue_ids`, the generator's venue maps), so
  location is a pure DISPLAY grouping. **Only three kinds of code read
  `location_id`: the CSV builder, `qualifiedVenueLabel`, and the Schedule
  page's Location FILTER (`src/lib/schedule/location-filter.ts`, 2026-09-24) —
  which narrows what is SHOWN, never what is scheduled.** If a change
  appears to need a scheduling path to know about locations, STOP — the plan
  is wrong.
- **THE CHOOSER vs DISPLAY line (safety-critical, not cosmetic).** Anywhere the
  user CHOOSES a field, show the qualified `"Monroe Complex — Andrews"` label;
  anywhere the user merely READS a schedule, the bare short name stays. The
  reason: SRALL's fields span four different leagues' parks (Wright/WSLL,
  Ives/SLL, Monroe/SRALL, Forestville/EMLL). Once names are short, a picker
  reading "Perry, Minors, Polley, Andrews" gives no way to tell whose park is
  whose, and during a rainout (moving many games fast) a mis-pick lands a game
  at the wrong league's field. That is a real error, which is why choosers are
  qualified and displays are not.
- **ONE formatter: `qualifiedVenueLabel(venue)` in
  `src/lib/venues/venue-label.ts`** (with `byQualifiedVenueLabel` for sorting).
  Input `{ name; location?: { name } | null }` → `"Complex — Field"` with a
  location, the bare name UNCHANGED without. Never hand-write the concatenation;
  never add a second formatter. It deliberately does NOT collide with the
  pre-existing game-level `venueLabel(g)` in schedule-list / schedule-print-region
  / game-detail-modal, which are DISPLAY surfaces and stay bare.
- **Chooser surfaces carrying it** (each widened its venue embed to a NULLABLE
  `location:locations(name)` join — an `!inner` on locations would empty every
  picker, since zero venues have a location today): Add Game modal, practice-slot
  modal, rainout-reschedule slot labels, conflict-resolver move-target,
  division-wizard Fields step, snack-shack Home venues, playoffs Venues step,
  the practices Preferred-field select, plus (as filters, for disambiguation)
  the schedule-page venue filter, the practices Fields filter, and the
  log-rainout game picker (rain closes a PARK — the park is the discriminator).
  Picker options are sorted by the qualified label so a park's fields cluster;
  the option VALUE is always `venue.id` — a label change must never change a
  value.
- **THE DEFERRED INTERNAL DISPLAY SWEEP.** The read-only display surfaces
  (schedule list, dashboard cards, print regions, Reports matrix) keep the bare
  short name ON PURPOSE for now. **TRIGGER to do the sweep:** the first org that
  has the SAME field name under two different locations (e.g. an "Andrews" in
  Monroe Complex and an "Andrews" in Wright Complex) — at that point bare names
  become ambiguous even when just reading, and the displays need the qualified
  label too. Until then, leave them bare.
- **The CSV export split** (`sports-connect-export.ts`, one of the two
  sanctioned `location_id` readers): venue HAS a location → Location = location
  name, Field = venue name; venue has NO location → Location = venue name,
  Field = blank (today's exact behavior); is_away → unchanged
  (`proposed_venue_name` fallback, blank Field). Proven byte-for-byte in
  `npm run sim:sc-export`.
- **PARTNER-FACING labels go through the three token RPCs, which EMIT, they do
  not FORMAT.** `get_interleague_schedule_by_token`, `get_interleague_invite_by_token`,
  and `get_reschedule_request_by_token` (0087) each emit a nested
  `venue.location` object (`{ name } | null`); TypeScript's one formatter does
  all concatenation, so RPC results and direct-query embeds share ONE signature.
  **DO NOT "simplify" this by granting `anon` SELECT on `locations`.** These RPCs
  feed ANONYMOUS surfaces (public token schedule page, public invite page,
  acceptance-confirmation email) and `anon` has NO grant on `locations` by
  design — a grant would expose every org's park list to anonymous callers. The
  RPCs are SECURITY DEFINER for exactly this reason: route location THROUGH them.
  The one exception is the game-resolve email route, which runs as our
  AUTHENTICATED admin and reads its own org's location via a direct embed under
  RLS. (All three surfaces render the bare name for a location-less venue —
  byte-identical to today — so there is no partner-visible change until a venue
  gets a location.)
- **The delete guard is COUNT-based, never FK-error-based** (same house rule as
  0078/0081): `delete_location_if_unreferenced` (0085) row-locks →
  `is_org_member` gate → COUNTS venues referencing the location → returns
  `{blocked, count, venue_names}` and deletes nothing if any exist, else deletes.
  The ON DELETE RESTRICT FK is a BACKSTOP only; the count is the guard, and a raw
  FK error must never reach the user.
- **Name uniqueness is enforced TWO ways** and both must stay: the app guard
  (LocationPicker create + heading rename reject a case-insensitive duplicate —
  the friendly path users see) AND the DB unique index
  `locations_owner_name_uniq (owner_id, lower(name))` (0086 — the backstop for
  races/other create paths). Applied while `locations` was empty so it could
  never fail on real data (the deliberate opposite of `venues`, where existing
  rows made uniqueness unsafe). Both create/rename paths CATCH a raw 23505 and
  map it to the same "A location with that name already exists" message — a raw
  unique-violation must never reach the UI.
- **RENAME is safe and is the escape hatch.** A location rename is a plain
  `locations.update` by id — venues reference locations by ID, so a rename
  touches nothing else (no name-keyed refs, no reference integrity to guard, no
  RPC needed). It exists because the delete guard correctly BLOCKS deleting a
  location that still has fields, so a typo'd name would otherwise be unfixable
  without detaching every field first.
- **Renaming a venue does NOT clear `posted`** — deliberate. The game hasn't
  moved (only its label changed), and a ten-field rename sitting would otherwise
  fire `posted` across every division at once. Relatedly, **schedule LOCK does
  not cover venue names**: a locked division protects against destructive
  re-derivation of GAMES, not against renaming a venue, so a locked schedule's
  printed wording can still change under a rename. Both are accepted.
- **The interleague venue-hours gate matches by NAME and this feature nudges it.**
  `get_game_venue_context_for_gate` (and the sender-side propose route) match a
  partner's free-typed `proposed_venue_name` against OUR venue names via
  `lower(v.name)`, fail-open (unmatched → skip the hours check). Live today: 15
  games carry a proposed name, ZERO match a venue. Shortening venue names makes
  an accidental match MORE likely, which moves that gate from skipping to
  ENFORCING a venue's hours — the safer direction, but a live behavior change
  driven purely by data entry, not code. Not a bug; know it exists.
- **The "Number of fields (optional)" capacity input was RETIRED** from the
  add/edit forms and the card display (a venue is now explicitly one field under
  a location, so a per-venue field count is self-contradictory). The
  `venues.capacity` COLUMN and its existing values are UNTOUCHED — insert/update
  simply stopped writing it. No data dropped; the column can be dropped later if
  desired.
- **Stored-name audit (2026-07-27): nothing but `activity_log` bakes in a venue
  name, and that is ACCEPTABLE.** Every other venue-name materialization
  (playoff bracket/export `venue_name`, Reports, the division panel, the CSV,
  practice export) is computed at RENDER/EXPORT time from a live `venue:venues(name)`
  join, so a rename flows through automatically — nothing persisted. `activity_log`
  messages are free text and DO contain venue names captured at write time (79
  live rows), but a log is a record of what was true when written, so it is left
  as-is BY DESIGN. `games.proposed_venue_name` stores the PARTNER's field name
  (external free text), not ours. If you ever add a NON-log surface that persists
  a venue name at write time, that IS a bug (the SRALL name-keyed drift family) —
  route it through the id instead.

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
- **`venues.capacity` is informational-only** and its INPUT is now RETIRED
  (2026-07-27, see the Locations section): nothing in the codebase reads it —
  conflict detection treats every venue as ONE field regardless of its value —
  and the add/edit forms no longer collect it, though the column and existing
  values remain. The separate, actually-consumed fields concept is
  `interleague_orgs.field_count` (the schedule generator caps same-day away
  games per partner org).

## Interleague counter-proposal picker

- **The "Edit" action on a counter-proposed game (`/dashboard/interleague`)
  opens on a PICKER of real available times, not a free-typed field**
  (2026-09-14). Component: `src/components/interleague/resolve-edit-modal.tsx`;
  assembly, fail-closed decisions and every empty-day sentence:
  `src/lib/schedule/interleague-resolve-picker.ts` (pure, sim-driven). Slots
  come from `buildSlotsAndDiagnostics` — the rainout picker's model. **Do NOT
  use `findFreeSlot`** (conflict-resolver-modal.tsx) here or anywhere new: it
  reads the legacy earliest/latest band and honors neither per-day windows nor
  makeup days.
- **THIS REVERSES THE JULY RULE FOR THIS SURFACE ONLY.** Manual surfaces stayed
  free-typed as the human-override escape hatch; that still holds for Add Game
  and the conflict resolver's manual move (warn-with-override). It does NOT
  hold here, because an interleague game has ANOTHER LEAGUE on the other end:
  a guessed time that bounces off the gate costs the partner a round trip, and
  a time that lands is an email to them. The free-typed field survives only as
  a secondary last resort behind "Enter a time manually", below the list — an
  admin must choose it deliberately. Typed times go through the same gates.
- **ONE FIELD: the game's current venue.** The resolve route writes
  `scheduled_at` and NEVER `venue_id`, and both server gates
  (`gateRescheduleVenue`, `gateRescheduleOccupancy`) read the venue off the
  stored row. Offering another field would save the time while the gates
  tested the OLD field — a wrong answer dressed as a feature. It is also the
  field the partner was told. Offering other fields means changing the route,
  both gates and the 0088 RPC (which takes no venue argument) together.
- **AWAY GAMES ARE FREE-TYPED BY DESIGN, not as a fallback.** Mode is keyed on
  `venue_id` (null ⇒ no field of ours), NEVER `is_away` — same key as the
  occupancy gate. A null venue is the partner's field: we have neither its
  hours nor its bookings, so there are no times we could honestly call
  "available", and a time-only picker would label guesses. The form carries a
  line saying so. (Live: 24/24 away games have null venue_id.)
- **NO MAKEUP DAYS.** Flags are cleared (`stripMakeup`) before the build — the
  flag means "a rained-out game may move here" and a counter-proposal is not a
  rainout. A non-playing weekday therefore reads as "AA doesn't play on …".
- **Our team only.** `away_team_id` is null on every interleague game, so the
  partner team's checks match nothing; team constraints are home-team-only for
  interleague (see Team game constraints).
- **The picker must never offer a time the gate refuses.** Duration is
  `durationFromSettings`, buffer is the occupancy gate's own `bufferFromRaw`
  (exported for this; body unchanged), occupancy scope matches the 0088 RPC
  (same field, not self, not cancelled, pending_interleague included,
  date-bounded never league-bounded, `fetchAllRows`). The picker is STRICTER
  than the server — it also enforces playing days, the division window, our
  team's other games and constraints — so it can hide times the server allows.
  `sim:interleague-picker` runs the real `gateRescheduleOccupancy` over every
  in-window grid time and requires exact agreement.
- **KNOWN, NOT FIXED — the gate resolves a missing buffer to 0.** The 0088 RPC
  emits `buffer_minutes` as JSON `null` when a division has none, and
  `bufferFromRaw(null)` is `Number(null)` = 0 — not the 15 its own comment
  says it mirrors. The picker reads the raw setting (`undefined` → 15), so it
  is stricter in that case (safe direction). Unreachable live: every division
  sets `buffer_minutes`. The sim pins the current gate behavior as `[KNOWN]`;
  fixing the gate flips that assertion — update it and this bullet together.
- **EVERY READ FAILS CLOSED** — division, field, blackout dates, games at the
  field, our team's games, constraints. An error (even one arriving WITH
  partial rows) renders "Couldn't load …, so no times are shown" + Retry, never
  an empty list. A skipped read is the `NOT_ATTEMPTED` placeholder, which is an
  ERROR so reaching it still fails closed.
- **Empty days, exact wording** (per weekday, only when every date of that
  weekday produced nothing; "config" lines amber, "info" lines grey):
  - field closed: "{Field} is closed that day." (+ Venues link)
  - field too short: "{Field} is open 9am–10am, which isn't long enough for
    this game." (+ Venues link)
  - day window too short: "{Division}'s game window that day is 5pm–5pm, which
    isn't long enough for a 90-minute game." — or, when the window is long
    enough but misses the field's hours: "{Division}'s game window that day
    (6am–8am) doesn't overlap {Field}'s hours enough for a 90-minute game."
  - occupied (bookings): "{Field} is already booked at every time that fits
    (N dates)."
  - occupied (team): "{Team} already has a game or a scheduling block at every
    time {Field} is free (N dates)."
  - blackout: "blacked out (N dates)." · team cap: "{Team} already has a game
    that day (N dates)."
  - non-playing days merge into ONE line: "{Division} doesn't play on Mondays,
    Tuesdays, Thursdays, Fridays or Sundays."
  Plus whole-picker states: unconfigured field, division without dates, and
  "season has no dates left to schedule".
  A weekday with several reasons gets one line per reason, each with its own
  count (e.g. "Wednesdays — Mets already has a game that day (5 dates)" and
  "Wednesdays — AA's game window that day is 5pm–5pm, … (2 dates)").
- **The no-times header follows the reasons present (`emptyHeadline`).** Field-side
  only (closed / too short / booked) → "No open times at {field} this season.";
  team-side only (team cap / team occupied) → "No open times for {team} this
  season."; any mix, or division/season-side reasons (day window, blackout) →
  "No open times this season." Never blames the field when a team-side reason is
  present. It used to name the field regardless.
- **A gate refusal renders INSIDE the modal** (it used to land in the page
  behind the overlay). The route's message already names what is in the way.
- **Harness: `npm run sim:interleague-picker`** (TZ=UTC) — 103 assertions, 25
  anti-vacuity counters (the roll-up/header addendum added 19 assertions, 6
  counters and 6 mutants, RU1–RU6; figures below are the original run's) (each empty-day reason, the live zero-length window,
  the away and no-venue branches, every fail-closed read, makeup stripping),
  10 mutants each killed at its own assertion (occupancy filter removed,
  buffer removed, buffer fallback diverged, empty states collapsed, makeup not
  stripped, venueGames error fails open, mode keyed on is_away, case (d)
  collapsed, NaN duration, blackout error swallowed). It does NOT exercise the
  Supabase queries themselves (the fake client doesn't model the projected-key
  embed); the embed was validated against live PostgREST.
- **Rainout modal issues noticed, NOT fixed (separate work):** it swallows the
  `blackout_dates` read error (a failed read offers blacked-out dates), and it
  computes `Number(s.game_duration ?? 90)` / `Number(s.buffer_minutes ?? 15)`,
  which are NaN for a non-numeric setting. This picker does neither.
- **Finding C, NOT fixed:** a typed edit (or Accept proposal) can still save a
  day the division doesn't play — neither server gate checks playing days. The
  live AA proposal for Tue 2026-09-29 would pass both gates. The picker never
  offers such a day.

## Team calendar feed (.ics) — 0099, applied 2026-09-29

- **What it is.** One link per team that a parent adds to their phone's
  calendar once; the team's games then update themselves. The link IS the
  credential: `/calendar/<64-hex token>.ics` on www, plus a `webcal://` twin
  for one-tap subscribe on Apple devices. Pro and Elite only.
- **Links are created by the DATABASE, never by an admin action:** when a
  division is LOCKED (`team_calendar_links_on_division_lock`), when a team
  is inserted into or moved into a locked division (the two `teams`
  triggers), and by 0099's backfill (12 teams, 3 SRALL divisions). The admin
  dialog on the Teams page only shows/copies, regenerates, or turns off/on.
  **"Exactly one current link per team" is a partial unique index** on
  `team_calendar_links(team_id) where status <> 'replaced'`: a team can never
  hold two working links, and a link an admin turned OFF is a current row, so
  re-locking never resurrects it. `replaced` rows are kept so an old link
  answers "replaced", not "unknown".
- **The gate is `locked`, NOT `posted`.** `posted` clears itself on any game
  change, including a rainout — the exact moment the feed matters — so it
  cannot gate a live feed. An UNLOCKED division answers 503 + Retry-After
  (a temporary error, so calendar apps keep their last copy), never an empty
  calendar (which would wipe every game from parents' phones).
- **The reader, `get_team_calendar_by_token(text)`, takes only the token,
  names every column it returns, and returns NO team data unless the status
  is `ok`.** Statuses: unknown / revoked / off / expired / plan / unlocked /
  ok, mapped to HTTP in `src/lib/calendar/links.ts` (`feedRefusalFor`). It
  excludes `pending_interleague` in SQL and `normalizeExportGames`
  (`keepCancelled: true`) excludes it again in TypeScript; cancelled games ARE
  returned and appear as "CANCELLED: …" with STATUS:CANCELLED rather than
  vanishing. Nothing in the feed: game notes, `teams.contact_email`, coach
  metadata in `divisions.settings`, scores, officials. Playoff games are NOT
  included (parallel table) — v1 says so in the dialog and the help page.
- **The field's street address IS in the feed, on the LOCATION line only
  (0100, applied 2026-09-30 after a first-run-green proof; md5(prosrc)
  verified against the repo file).** The reader emits one added key inside `venue`, `address` — the
  venue's own, else its park's, trimmed, blank as null (`coalesce(nullif(
  btrim(v.address), ''), nullif(btrim(loc.address), ''))`) — and the builder
  appends it to the label after a comma, through the escaper, so a phone
  opens the field in Maps. Never on an away game (the partner's field). The
  key lives on `TeamCalendarGame`'s venue type only; `ExportGame`, which the
  CSV builders share, never carries it. `anon` and `service_role` hold no
  SELECT on `venues` or `locations`, so the SECURITY DEFINER readers — this
  one and, since 0105, `get_league_schedule_by_token` — are the only
  anonymous paths to the value. The help page's "who can see" answer and
  the Teams dialog both say the address is in the feed. Harnesses:
  `scripts/sim/venue-address-calendar-sim.sql` (assembled by
  `venue-address-calendar-build.ts`; applies 0100 in an always-rolled-back
  transaction — NOTE it holds ACCESS EXCLUSIVE on `venues` and `locations`
  for the run, blocking reads and writes of both), `sim:team-calendar`
  section A (+ TC22/TC23), `sim:game-notes` O1a/O1c.
- **Expiry is 7 days after `leagues.end_date`, with "today" computed in the
  ORG's timezone in the database** (`now() at time zone profiles.timezone`),
  never `current_date` — the auto-archive helper's UTC-date bug must not be
  inherited. Archived seasons are expired at once.
- **`profiles.timezone`** (7 US IANA zones, CHECK-constrained, default
  Pacific; the same list as `ORG_TIMEZONES` in `src/lib/calendar/timezones.ts`
  — change one, change the other) is written ONLY through `set_org_timezone`.
  Under 0098 the column has no user grant and the trigger would refuse a
  direct write; the Settings card calls the function. It LABELS wall-clock
  game times (DTSTART;TZID=…) and never converts them. **Still reading server
  time instead of this column, listed and unchanged:** `auto-archive.ts`,
  `derived-status.ts`, the Schedule page's `todayLocalDateString`, and the
  `Date.now()` past-game checks on the token schedule page and the reschedule
  route.
- **`is_org_member` is the admin gate because every member is an admin
  today** — see the Database section for what changes if a coach role is
  added.
- **Titles are from the feed team's side** ("Expos vs Bears" at home, "Expos
  @ Lions" away, decided by team ID never by name) — CALENDAR-ONLY; the CSV
  exports keep host-first order. Calendar name is "Team — Org Season", with
  the org left out when the season name already contains it. A VTIMEZONE is
  emitted for the org zone; end = start + division `game_duration`, and an
  unusable duration yields a start-only event, never a guessed length. UID is
  `game-<id>@thefieldslate.com`, so a moved game updates in place.
- **Every feed response is `Cache-Control: private, no-store` and
  `X-Robots-Tag: noindex, nofollow`** — a regenerated link must die on the next
  request, which shared caching would defeat. `next.config.mjs` also sets the
  no-index header on `/schedule`, `/invite`, `/reschedule` and `/calendar`,
  and the three token pages export `robots: { index: false }`. The public
  `/help/calendar` page is the opposite: indexable, in the sitemap, and
  carries no token and no team data.
- **Known limits, stated in the product:** calendar apps refresh on their own
  schedule (Google can take many hours), so same-day changes like rainouts
  still come from the league; regenerating a division deletes and re-creates
  game rows, so UIDs change (a locked division cannot be regenerated, which is
  most of the protection); anyone holding the link can read the schedule
  (same as a printed one). No rate limit exists in the codebase — a Vercel
  firewall rule is the lever if load ever matters.
- **Harnesses.** `scripts/sim/team-calendar-links-sim.sql` (SQL, run
  2026-09-29 against production and rolled back: green, 5 mutants incl.
  `current_date` for expiry — that one is only distinguishable 5pm–3am
  Pacific and the harness asserts the window; read its run log: runs 1 and 2
  were harness faults), `npm run sim:team-calendar` (the builder, three host
  timezones, 21 mutants), `npm run sim:team-calendar-route` (URLs, refusal
  map, coach message, help page, wiring; 7 mutants), and `sim:games-export`
  pins the `keepCancelled` opt-in.

## Public league schedule (`/s/<token>`) — 0105, applied 2026-10-08

- **What it is.** One link per ORG that families open and a league embeds on
  its own website (`<iframe … height="700">`, the page scrolls inside it).
  `/s/<token>` is a client shell; it fetches `/s/<token>/data`; the all-games
  calendar is `/s/<token>.ics` (rewritten in `next.config.mjs` to
  `/s/[token]/feed` — a route folder cannot hold both a page and a
  `<token>.ics` handler). Pro and Elite; a downgraded org's link answers
  "turned off". Settings → Public schedule is the admin card.
- **HOME vs AWAY IS DECIDED BY THE PARK — `locations.is_home_park`.** Nothing
  about a FIELD says "ours": an org's venues include the other leagues' fields
  it plays at (Santa Rosa American LL's 272 Fall 2026 games are at four parks,
  one of them its own). Field in a home park → Home; another park, NO park, or
  the partner's field on an interleague away game → Away; no field at all and
  not a partner's → "Field TBD" (never Away — Away claims a fact we lack).
  ONE function decides it: `siteOf` in `src/lib/public-schedule/classify.ts`.
  The checkboxes live on the Settings card (not the Venues page), and the card
  names every field that has no park, with a Venues link.
- **The reader, `get_league_schedule_by_token(text)`, takes only the token and
  names every key** (same rules as the team calendar reader). Statuses
  unknown / off / plan / ok. **Only LOCKED divisions** contribute teams, games
  and playoff games; an unlocked one contributes its NAME to `unpublished`
  ("T-Ball isn't published yet"). `posted` is not a gate (it clears on every
  rainout). **`pending_interleague` never leaves it** — and `buildRows` drops
  it again in TypeScript, the second lock. Cancelled games ARE returned and
  read "Rained out" (the rainout flow is the only writer of `cancelled`);
  `reschedule_pending` shows at its current time with "Time may change";
  playoff games of non-draft brackets are all returned, only DATED ones are
  rows, and an empty single-elimination slot reads "Winner of Game N" from
  the positional numbering (any other format: "TBD"). Seasons: unarchived,
  ≥1 locked division, ended ≤7 days ago in the ORG's timezone; the reader
  returns `today` so the page needs no clock. More than one season → a picker.
- **Link lifetime: the token never names a season.** Off KEEPS the token
  (website embeds survive off/on) — the OPPOSITE of the team calendar link,
  where on always mints a new one. Reset writes a new token into the same row
  and the old one answers "isn't recognized"; the card's confirm says embeds
  stop working.
- **Caching lives in ONE place, `src/lib/public-schedule/links.ts`.** Every
  reader answer: `public, max-age=0, s-maxage=60` (edge only) — off, reset,
  home-park changes and rainouts reach visitors within a minute. A FAILED
  read: 503 + `no-store` + Retry-After, and the page says "We couldn't load
  the schedule right now" — never an empty schedule that looks real. Filters
  run in the browser, so one cached response serves every filter. The feed
  keeps the team feed's rules: `no-store`, 503 + Retry-After for anything
  temporary (including "no published games"), never an empty calendar.
- **`/s/` is outside the middleware matcher** (no Supabase Auth call per view)
  **and is the ONE framable route** (see "NO PAGE MAY BE FRAMED").
- **Prints say what they show:** the print line names the season, the filter
  (`filterSummary`: "Majors only", "Majors · Expos only") and the range.
- **Harnesses:** `scripts/sim/public-schedule-sim.sql` (+ build script; SQL,
  rolled back, SRALL test org; 5 mutants — unlocked division, pending
  interleague, note emitted, any park home, new token on re-enable);
  `npm run sim:public-schedule` (73 checks × 3 zones, 11 counters) +
  `:mutants` (7, incl. Home misclassified and the error path edge-cached);
  `sim:game-notes` O1-public / O1-public-reader (+ GM12/GM13).
- **K2 in `game-notes-triggers-sim.sql` strips SQL comments before looking
  for `notes`** (2026-10-08): the 0099 and 0105 readers both SAY in a comment
  that they must not emit notes, which made the old scan fire on the rule it
  checks. That harness has not been re-run since the edit.

## Interleague Case A — a signed-in league accepts onto its own schedule (2026-09-28)

- **What it is.** An invite still goes to an email address and the recipient
  answers anonymously through the token link; that path is UNCHANGED. When the
  person holding the link is SIGNED IN (and has not taken the `?anon=1` escape
  hatch), `/invite/[token]` recognises them and accepting also creates the
  games in THEIR league. **The identifier is the LINK, not the email address**
  — whoever holds it and is signed in is the right person; matching the
  invite's recipient email to an account is NOT the mechanism (that address is
  often a shared inbox that belongs to nobody).
- **The created rows are ORDINARY Case B interleague rows** in the recipient's
  league: their team as `home_team_id`, `away_team_id` NULL, `interleague_org_id`
  → their contact card for the host, `external_team_name` = the host's team
  name as text, `is_away` from THEIR perspective (the host's `is_away` inverted),
  `venue_id` = their field when they host, else null with the host's qualified
  venue label in `proposed_venue_name`. **Never point `away_team_id` at the
  other org's team** — it resolves to NULL on both sides under RLS and breaks
  the renderers. After acceptance the two leagues' rows are INDEPENDENT: no
  link column, no syncing; a change goes through the reschedule request flow,
  which already needs both sides to agree.
- **The shape: a SECURITY INVOKER wrapper, `accept_interleague_invite_as_member`
  (0097), authenticated only.** A plain route under the caller's RLS was ruled
  IN on permissions (every row created belongs to their org), but two calls
  from a route are not atomic and the token is single-use — "host RPC
  succeeded, our inserts failed" would leave an accepted invite with nothing on
  the recipient's schedule and no retry. So ONE transaction: read the invite
  through the token function → refuse a member of the SENDING org → resolve our
  team/venue IDs to the NAMES the host side stores → call the UNCHANGED anon
  token RPC for the host half → find-or-create our contact card from the RPC's
  own return (never client input) → insert our rows for ACCEPTED games only.
  Any raise, including the 0082 lock trigger, rolls back both halves. A count
  mismatch between what the host confirmed and what we planned raises
  `host_games_changed` (defensive; both reads share one snapshot).
- **`accept_interleague_invite` is NOT modified.** 0097 re-applied its 0074
  body verbatim (the live body had drifted by three trimmed comment lines, the
  0079 class); md5 matches the repo again. Proven by the twin-fixture run.
- **The own-invite guard needs no new key:** under the caller's RLS the host's
  season row is visible iff they are a member of the host org, so
  `exists(select 1 from leagues where id = <invite season>)` is the refusal.
  The page does the same read. Live on the founder's own accounts today (the
  Westside Little League owner is also an SRALL admin) — reachable, not
  hypothetical.
- **Division mapping is a DEFAULT, not an inference.** One picker per host
  division, pre-selected by case-insensitive trimmed name match, overridable;
  the per-game team dropdown filters on that choice. The data supports "Majors
  ↔ Majors" and fails "AA ↔ Minors", so never infer silently.
- **Games the host marked away are games WE host — our field is REQUIRED**
  (`venue_required`), stored as a real `venue_id` on our row and as the
  qualified label on the host's `proposed_venue_name`, exactly as a typed
  name would be.
- **Counters create NOTHING on our side, and the page says so.** A pending row
  that never syncs is the drift this design rejects. Declines create nothing.
- **Empty states are the common case** (half the live accounts have no active
  season): no season / no divisions / no teams each render a first-class card
  with a link, Accept stays disabled, and the escape hatch is always there.
  Locks are read up front (`fetchSeasonDivisionLocks`) and shown at the row
  with `lockedReason(…, "add")`, never a failure on save.
- **Signed-in pages render a PLAIN footer** — a signed-in partner is already a
  customer. The anonymous PENDING page's footer promo was REPLACED (not
  doubled) with the host-league line; every other `InviteFooter` caller (the
  schedule and reschedule token pages, the invite status screens) renders
  byte-identically with no props.
- **The host's response email gains one sentence when the partner is on
  FieldSlate** (`partnerOnFieldSlate` on `buildAcceptanceEmail`, set only by
  the signed-in route). The builders were lifted VERBATIM out of the anonymous
  route into `src/lib/interleague/invite-response-emails.ts`; the flag-less
  rendering is pinned to goldens.
- **BILLING — UNCAPPED AND UNBILLED, BY EXPLICIT DECISION (2026-09-28), to be
  revisited deliberately.** What the code does: the partner cap lives ONLY in
  the sender's invite-creation RPC (`create_interleague_org`, 0057), and
  `getInterleagueOrgCountForSeason` counts invites on seasons the org OWNS, so
  a received invite contributes zero. The Interleague nav item is Pro-locked
  in the sidebar but `/dashboard/interleague` has NO server gate, and the
  reschedule-request menu is already Free. Therefore **a Free league can
  accept this way, hold real interleague rows and a partner card, and use the
  reschedule flow without paying.** Recorded so the commercial call is made on
  purpose, not discovered by accident.
- **Invite visibility for the recipient is OUT of v1** — the invite's RLS is
  `is_org_member(sender_user_id)` (the host org), and her games already show
  on her own pages; a provenance column was judged not worth it.
- **Harnesses.** `npm run sim:invite-page` — goldens of every anonymous state
  captured from the PRE-CHANGE tree in their own commit (part G: byte-identical
  outside the footer, footer moved on exactly the two pending states), the
  emails (E), the signed-in branch rendered through the real page under a
  loader-hooked fake client (S), the pure decisions (B), three anti-vacuity
  counters, 9 in-source mutants each killed at its own tag — **read its
  mutation log: TM8 survived a vacuous `includes("disabled")` that matched a
  Tailwind class.** `scripts/sim/signed-in-accept-rpc-sim.sql` (SQL, Supabase
  MCP): T0/T1 twin-fixture old-vs-new on the anon RPC (the pre-change body
  rebuilt as `pg_temp.old_*` and md5-pinned), A1–A10 on the wrapper under an
  impersonated authenticated caller (`set local role authenticated` +
  `request.jwt.claims`), 8 mutants incl. host-side-not-updated, `away_team_id`
  on the created row, and the swallowed lock error (atomicity), leak check
  clean.

## Interleague negotiation (partner visibility + host counter)

Migrations 0090 (partner visibility) and 0091 (host counter), both applied
2026-09-15 with md5(prosrc) verified against the repo files.

- **A partner can always see a game they countered (0090).** Accepting an invite
  marks it `accepted` even when some games were only countered, and the live
  schedule used to return only `status = 'scheduled'`, so a partner lost every
  view of a countered game until the host acted. **Deliberately NOT fixed by
  changing the invite's status** — that would ripple through the 0074/0075
  supersede rules, the dashboard badge and schedule_token issuance.
  - `get_interleague_schedule_by_token` emits `countered_games` =
    `pending_interleague AND external_team_name IS NOT NULL` (that column is set
    on a pending game only by the invite's counter branch) and includes
    `reschedule_pending` in `games` with a `status` key — a confirmed game with a
    change outstanding also used to vanish at the moment the partner was asked
    about it. Unanswered pending games stay hidden.
  - **CANCELLED GAMES — CLOSED 2026-09-24 by 0092.** A cancelled game used to
    disappear from the partner's schedule entirely — no row, no message — so
    their league could turn up to a field for a game that was called off. It now
    comes back in its OWN key, `cancelled_games`, rendered as a separate greyed,
    struck-through "Cancelled" section. **Not folded into `games`:** that key
    means "confirmed and going ahead" AND `/api/invite/[token]/accept` builds the
    acceptance confirmation email from it, so a cancelled game inside it would be
    listed to the partner as one they had just agreed to (mutant CM2). Wording
    lives in `recipient-schedule.ts`; harnesses are
    `scripts/sim/cancelled-visibility-rpc-sim.sql` (2 mutants) and
    `npm run sim:recipient-schedule` ([X1]–[X10], 3 mutants).
  - **SAY THIS WHEREVER THE CANCELLED SECTION COMES UP: it makes the truth
    AVAILABLE, it does not DELIVER it.** Nothing emails the partner when a game
    is cancelled. The page is honest for a partner who opens it; one who does
    not open it still learns nothing. Do not read the section as "the partner
    has been told."
  - **NOTIFICATION IS NOT BUILT, and any future design must satisfy two
    constraints** (both established 2026-09-24): the rainout path CANCELS AND
    THEN RESCHEDULES, so emailing on the status write sends "cancelled" then
    "moved" — two emails for one event, which argues for sending on the rainout
    flow's COMPLETION rather than on the write; and the division panel's bulk
    path cancels many games at once, so it needs ONE digest, not N emails. All
    seven cancel paths are bare client-side `games.update({status:'cancelled'})`
    with no server route and no interleague filter, so notification needs a
    route before it needs a template.
  - `get_interleague_invite_by_token` emits the invite's own `schedule_token`
    (null until accepted) so the "already accepted" screen links the schedule.
  - All partner-facing wording lives in `src/lib/interleague/recipient-schedule.ts`.
    Harnesses: `scripts/sim/recipient-schedule-rpc-sim.sql` +
    `npm run sim:recipient-schedule`.
  - Minor: the invite page names the host by person (its RPC's sender has no
    `org_name`); the schedule page names the league.
- **"Propose a different time" (0091).** On a counter-proposed game the host can
  send a time back instead of confirming one. **The game stays
  `pending_interleague` until someone agrees — never `reschedule_pending`**:
  `countsAsScheduledGame` lists pending as not-a-real-game and does not know
  reschedule_pending, so flipping would start counting an unagreed game in
  exports/reports. Reuses `interleague_reschedule_requests`.
- **THE MODEL for a pending game — one place per fact, keep it that way:**
  `games.proposed_*` = the PARTNER's newest proposal; a pending request with a
  user = the HOST's outstanding proposal (awaiting partner); a pending request
  without a user = the partner's counter-back (awaiting host), MIRRORED into
  `games.proposed_*` in the same statement so "Accept proposal" applies the
  latest time. Past rows are history. Decisions:
  `src/lib/interleague/negotiation.ts`; emails: `negotiation-emails.ts`.
- **The three token-function fixes — do not undo any:**
  1. `decline_reschedule_request_by_token` — BRANCHED: never sets a
     `pending_interleague` game to `scheduled` (that CONFIRMED the original time
     the partner had rejected). Mirrored in the host respond route via
     `gameStatusAfterHostDecline`. Confirmed games unchanged — proven by running
     the pre-0091 bodies on twin fixtures.
  2. `accept_reschedule_request_by_token` — SHARED: clears
     `proposed_scheduled_at` (no-op on confirmed games, where it is always null).
     Same in the host respond route's accept.
  3. **Token guard, SHARED in accept/decline/counter:** a reschedule token may
     act ONLY on a host-authored request (`request_not_actionable_by_token`).
     Tokens are only ever emailed for host rows, so no reachable flow changed —
     but without the guard a leaked partner-row token could accept the
     partner's own request or counter it with wrong attribution. Behind the
     guard, "a token counter is the partner" is true by construction.
- **Statuses each creation path accepts (widened deliberately, again
  2026-09-28):** `/api/interleague/games/[id]/reschedule` — `scheduled` (flips
  to reschedule_pending; **the ORIGINAL date no longer matters**, only that the
  PROPOSED time is in the future — "is the game in the past" was the wrong
  question for a makeup), `pending_interleague` WITH a partner response (stays
  pending; lock gate, hours gate and 0088 occupancy gate; closes the partner's
  open counter-back; refuses a second host proposal), OR **`cancelled` — a
  MAKEUP** (see the next bullet). `create_reschedule_request_by_schedule_token`
  (partner) — still `scheduled` only; a partner answers a pending game through
  the host's token, never by opening a request.
- **A RAINED-OUT INTERLEAGUE GAME IS RESCHEDULED DIRECTLY (decided 2026-09-28).
  There is no "restore, then request" step.** "Remove Rainout" keeps its real
  meaning — the game wasn't rained out after all — and is never part of
  rescheduling. The host proposes a makeup time on the CANCELLED game
  (`decideHostProposal` → `cancelled_makeup`; refused while a host proposal is
  already out, or if the proposed time has passed); the request row is created
  and **the game STAYS `cancelled`** (`statusAfterHostProposal` → null) — an
  unanswered proposal must never make a rained-out game look scheduled. The
  partner's accept (`accept_reschedule_request_by_token`, UNCHANGED) sets it
  `scheduled` at the new time; the partner's decline leaves it cancelled
  (**0094**, `and status <> 'cancelled'` on the decline's UPDATE — a decline
  that quietly revived a rained-out game would be the pending-game decline bug
  again); the host declining a partner counter leaves it cancelled
  (`gameStatusAfterHostDecline`). **A makeup is NOT lock-gated**
  (`proposalLockGated`) — rainout recovery never is, and every surface offers
  it on a locked division; hours and occupancy gates still apply. Surfaces:
  the Schedule page menu's "Propose makeup time", the panel's rained-out row,
  the rained-out card, and log-rainout's done screen — all Free (a request).
  Emails and the partner's respond page carry makeup wording ("Rained out" /
  "Makeup", "declining leaves the game rained out"); the confirmed-game copy is
  asserted byte-identical. Why the restore step was rejected: it only worked
  while the game's ORIGINAL date was still ahead, so an on-the-day rainout —
  the common case — was trapped. Harnesses: `npm run sim:interleague-makeup`
  (host side, end to end), `scripts/sim/cancelled-reschedule-rpc-sim.sql`
  (the token functions, twin fixtures old-vs-new for the shared accept/decline
  paths, 3 mutants).
- **Resolve refuses `accept_proposal` / `keep_original` / `edit` while a host
  proposal is outstanding** (`resolveRefusal`); `decline` stays allowed (the
  partner is emailed). New `withdraw_proposal` is the way out — without it a
  silent partner would deadlock the host. Resolve closes the partner's open
  counter-back (accepted / declined) BEFORE setting the time, so a failed game
  update leaves a consistent pending game.
- **Emails say what happened, and negotiation sends are CHECKED.** Resolve's one
  "has been resolved / final details" email became three (`resolvedEmail`: your
  time / the original time / a new time) with the live-schedule link. Resolve
  (all actions incl. decline and withdraw) and the host proposal return
  `email: {sent, error, respond_url?}`; the dashboard shows a banner with the
  partner's respond link when a send fails. **Not checked, stated:** partner →
  host emails from the token respond route (the host still sees the state on the
  dashboard, which refetches on focus) and the host respond route for confirmed
  games (pre-existing).
- **Pending-game wording never says "reschedule"** (the harness strips URLs —
  `/reschedule/[token]` is a path, not wording). `/reschedule/[token]` switches
  copy on `game.status` (`respondPageCopy`); a confirmed game's page reads
  exactly as before (pinned by assertion W15).
- **Round count, no hard cap (decided 2026-09-15).** Round = request rows + 1,
  shown to the host (from round 2), on the partner's schedule and respond pages
  and in the host-proposal email. End states: either side accepts; host Keep
  original / Edit (host prerogative, emailed with explicit wording); host Decline
  (deletes, emailed); host Withdraw (back to the host's decision). **Cost:**
  nothing forces convergence — a negotiation can run to season end, the game is
  excluded from exports/reports throughout, and regenerate would wipe it. A hard
  cap would need a terminal action (auto-keep? auto-decline?) that commits or
  deletes a game neither side chose, which is worse than a visible count. Adding
  one later is a count check in `decideHostProposal` + the counter RPC.
- **KNOWN, NOT FIXED (2026-09-28) — makeup follow-ups.** (1) A host cannot
  WITHDRAW a makeup proposal: `withdraw_proposal` lives on the resolve route,
  which accepts only `pending_interleague`; a silent partner leaves the makeup
  outstanding (the same shape as a confirmed game's `reschedule_pending` with
  a silent partner — pre-existing). (2) The partner's live schedule page shows
  a rained-out game under "Cancelled" with NO sign of the open makeup proposal
  — `get_interleague_schedule_by_token` emits `open_host_proposal` for `games`
  only; the email is the delivery. (3) The token decline's email to the HOST
  says the game "will stay at its current time" for a rained-out game — the
  RPC's JSON carries no game status (`was_pending` only); a `was_cancelled`
  key is a one-line 0095. (4) The picker's SLOT save still has no save-time
  lock re-read (the manual form's does).
- **KNOWN, NOT FIXED — deleting a game mid-negotiation is silent.** Regenerate's
  delete clause (`status.neq.scheduled,…`) and `delete_game_if_unblocked` (which
  permits `pending_interleague`) both remove a pending game with an open request;
  the request CASCADES and the partner's token just shows "no longer active", no
  email. **What should happen:** regenerate should skip (or refuse over)
  pending games carrying a partner response; single delete of a game with an
  open request should go through the resolve Decline path (which emails) or at
  least disclose and email. Deletion behaviour deliberately unchanged here.
- **KNOWN, NOT FIXED — regenerate deletes an ACCEPTED game in
  `reschedule_pending`**, contradicting 0079's rule that accepted interleague
  games are never silently deleted. Zero live rows.
- **WHICH PATH GETS WHICH GATE — the rule, settled 2026-09-23. A future session
  will look at the partner counter, see no occupancy gate and think it found a
  hole; it is deliberate.**
  1. **Every path that WRITES a time gates occupancy** — both accept paths
     (`reschedule/[id]/respond` accept, resolve's `accept_proposal`).
  2. **A HOST-SIDE proposal gates too**, even though it writes no time: the
     admin is ours, and proposing a time our own field cannot take costs the
     partner a round trip and an email. Both branches of
     `games/[id]/reschedule` now do.
  3. **A PARTNER-SIDE proposal gates HOURS ONLY, never occupancy** — the token
     counter and `schedule/[token]/reschedule`. Three reasons: it writes no
     time (the host's later accept is gated); an occupancy refusal names the
     conflicting booking, which would leak our schedule to an anonymous token
     holder; and occupancy now is not occupancy at acceptance, so it would
     refuse proposals the host could still accept.
  4. **Lock gates are HOST-SIDE ONLY**, via `lockRefusal`
     (`lib/interleague/lock-gate.ts`). Refusing an anonymous partner strands
     someone who cannot act on the error — the same reason the 0082 trigger
     lets a partner decline under a lock.
  The lock gates on `games/[id]/reschedule` (scheduled branch) and
  `reschedule/[id]/respond` closed 2026-09-23; neither is covered by the
  trigger, whose allowlist permits every column those paths write, so the route
  gate is the only enforcement. Harness: `npm run sim:reschedule-gate-gaps`.
- **`gateRescheduleVenue` FAILS CLOSED (2026-09-23)** — it used to
  `return { ok: true }` on a read error, i.e. "the hours are fine" from a check
  that never ran. **It needs no `venue_id` carve-out and must not gain one:**
  `get_game_venue_context_for_gate` returns null in exactly one case, a
  missing game row. Away games, venue-less games and unmatched free-text labels
  come back as real objects and are skipped INSIDE the gate. That is the
  opposite of `gateRescheduleOccupancy`, whose RPC returns a real context for a
  venue-less game and therefore keys its skip on `venue_id` explicitly.
- **Live drift closed:** before 0091 the live accept/decline/counter bodies were
  0039's with every in-body comment stripped (md5 matched exactly) — the 0079
  failure class. 0091 re-applied them from the repo text.
- **Harnesses:** `scripts/sim/host-counter-rpc-sim.sql` (SQL; each pass is a
  rolled-back sub-transaction; 6 mutants killed at D1/A1/G1c/C1/R2/D2; the
  scheduled path proven against pg_temp copies of the old bodies) and
  `npm run sim:host-counter` (71 assertions, 13 counters, 14 mutants). Neither
  drives the routes' Supabase calls; the new embed/filter shapes were validated
  against live PostgREST.

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
  says "start times" on purpose. Start-time-only is a PRODUCT choice, not a
  technical limitation: nothing blocks an upgrade to overlap semantics
  (`divisions.settings.game_duration` is populated and positive on every
  live division, verified 2026-07-23). Any claim that a "duration-0 bug"
  blocks that upgrade is false — no such dependency exists in code or docs.
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
  asymmetry. (The interleague counter-proposal Edit is ALSO pick-from-valid
  since 2026-09-14, with a deliberately subordinate free-typed fallback — see
  "Interleague counter-proposal picker" for why that surface left the
  free-typed camp while Add Game and the manual move stay in it.) `prefer` hits render live amber notices on Add Game and the
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

## Mobile follow-ups (from the 2026-10-02 phone audit)

Shipped (2026-10-02 → 2026-10-05): marketing mobile nav; confirm dialogs on
single-game rainout and blackout removal with 40px row targets; the layout
batch (stat grid, panel rows, request modal scroll, scrollable
umpire/interleague tables, h-dvh shell, in-viewport switcher menus, wrapping
Schedule actions, p-4 content padding); division rows, stacked Schedule
filters, the overview width fix; the topbar org/season switchers (dead bell
removed); batch 3 — the Schedule phone card's "…" menu sharing
`GameActionsMenu` with the desktop row (same items, same handlers, rainout
disabled on cancelled/completed games), the calendar popover clamped on
screen below md and its rainout behind the shared confirm; batch 4 — every
hover-only row icon on `ROW_ICON_REVEAL` with 36px targets (division panel
roster, venues page location header and venue cards — the header row is
`group/loc`, each card a plain `group`, so reveals are per element —
interleague partner orgs, practices grid pencil), `max-h-[85dvh]` scrolling
bodies on the team snack shack, pay report, game detail and venue/location
delete dialogs, and a button-sized "Enter a time manually"; batch 5 — the
phone calendar's per-day count badges opening the existing day modal, the
week grid's `w-24 sm:w-40` field column and 40px chevrons, icon-only 40px
Teams/snack-shack row actions below md, and the low items (footer and legal
contents links `py-2`, consent notes `text-xs`, 40px drawer and team-member
buttons, stacked settings danger zone).

**16px form fields are ONE RULE in `globals.css`, not per-field classes
(decided 2026-10-05).** Below 640px every `input` (except checkbox, radio,
range, file), `select` and `textarea` is `font-size: 1rem`; the selector's
specificity beats a `text-xs`/`text-sm` utility and the max-width media
query keeps desktop sizes. It covers every field, present and future — do
not add `text-base sm:text-sm` to new fields (the five selects that carry
it from before are redundant, not the pattern). iOS Safari zooms the page
when a focused field is under 16px and does not zoom back; never "fix"
that with `maximum-scale=1` or `user-scalable=no`.

Still open:

- **FIXED 2026-10-05 — single-game rainout writes are checked.** All FOUR
  writers (division panel cloud `handleRainOut`, dashboard upcoming-games
  `handleRainout`, Schedule list `performRainout`, Schedule calendar
  `handleRainout`) used to send the `games` UPDATE and discard its result, so
  a refused or no-op write still logged "marked as rained out" and refreshed
  as if it succeeded. They now share `markGameRainedOut`
  (`src/lib/schedule/rainout-write.ts`): the same UPDATE with `.select("id")`
  chained, the picker's zero-rows pattern — an error OR zero rows is a
  failure, nothing is logged, and the shared `ConfirmDialog` stays open in an
  error state (busy while in flight, so no double tap). Only a one-row
  success logs and refreshes, exactly as before. **The multi-game writers are checked
  too (2026-10-05):** the division panel's bulk rainout and the log-rainout
  modal's single and multi flows. Multi-row writes go through
  `markGamesRainedOut` (`.in("id", ids)` + `.select("id")`), which returns
  the ids that actually changed; the caller logs ONLY those, and
  `bulkRainoutMessage` words the rest ("3 of 5 games were marked as rained
  out. 2 couldn't be saved — they may have been changed or deleted. Refresh
  and try again." / "None of the N games could be marked…"). On any
  shortfall the modal stays open with the message and only the unsaved
  games remain selected (the modal reloads its list so the saved ones drop
  out); a request error counts as nothing saved. A full success behaves
  exactly as before. Every single-game and multi-game rainout write in the
  product is now checked; `grep -rn 'status: "cancelled"' src` should show
  no bare `games.update` without a result read.
- **"Remove Rainout" is an unchecked write, on top of its known gaps.**
  `handleRestore` in `rained-out-stat-card.tsx` (the season page's rained-out
  card) sends `games.update({ status: "scheduled" })` and discards the
  result — the same pattern the rainout writers had before 2026-10-05 — then
  drops the game from the card's local list BEFORE the result is known and
  refreshes. A refused or zero-row write therefore makes the game vanish
  from the card while staying rained out, with no error and no activity-log
  entry (it writes none even on success). Pre-existing gaps it also still
  has: no plan gate and no interleague awareness (restoring a rained-out
  interleague game does not tell the partner). Fix shape: chain
  `.select("id")`, treat zero rows as failure, keep the row until the write
  confirms, log the restore, and route interleague games to the request
  flow.
- **Brand colour drift:** `fs-navy` is `#0b1c39`, the homepage literal is
  `#0C1F3F` (150 files). One decision, one migration pass.

## Snack shack — derived shifts (in progress, branch `feat/snack-shack-derived`)

- **Stage 1 landed: the pure library `src/lib/snack-shack/derive-shifts.ts`
  decides everything; nothing else may hold a rule.** Which games count
  (attached `home_venue_ids` only, `countsAsScheduledGame`), the day window
  (open N before the first start, close N after the last END, per-game
  duration via `planSettingsFromDivision` with the `durationDefaulted` flag
  reported as "assumed 90 minutes"), gaps (a break ≥ 60 min splits the day
  UNLESS the offsets make the windows touch or overlap, then one window),
  the days filter (a counting game on a closed weekday → `closedDays`, no
  shifts), division (fewest shifts ≤ max, leftover LAST), the leftover
  absorb (UNDER 60 min with 2+ shifts → first / last / split-to-the-minute
  with odd minutes on the EARLIER shifts; default `last`; exactly 60 stands),
  the absorb key (DATE + WINDOW START "HH:MM", never an index; a stored
  choice whose window moved or is no longer short → `staleChoices`, default
  applies), regenerate reconciliation (a stored derived row with the same
  date/start/end is KEPT with its assignment; manual `is_recurring=false`
  rows are never in any list), the equity pick seeded from the kept rows,
  and the staleness diff (dates whose stored derived shifts differ from the
  derivation, rendered by `stalenessSummary` verbatim).
- **Wall-clock only.** Date and time come from `scheduled_at` by substring;
  the weekday from `dayKeyFromIsoDate`. A close past midnight is clamped at
  24:00 and reported (`clampedDates`) because `time` cannot hold it. The sim
  runs under three host zones and asserts the library never hands a stored
  timestamp to `new Date`.
- **Blackout dates are deliberately NOT consulted.** The games are the
  truth; a game hand-placed on a blackout date still brings a crowd. The
  old fixed-block generator skipped blackouts; the derived model does not.
- **A shift can exceed the max by up to 59 minutes** — that is the absorb
  rule working (120 + a 59-minute leftover), not a bug. The sweep assertion
  bounds it at max+60.
- **Stage 2 APPLIED 2026-10-05: migration 0103 (`supabase/migrations/0103_snack_shack_derived_shifts.sql`)**, after a green rolled-back proof run (see the harness RUN LOG). Live: columns present with defaults 30/30/120 on all 3 existing settings rows, `shifts_generated_at` null everywhere, absorb table empty, blocks md5 unchanged (107 rows), privileges exactly as stated, md5(prosrc) matches.
  Three rule columns on `snack_shack_settings` (`open_before_min`,
  `close_after_min`, `max_shift_min`, defaults 30/30/120, CHECK-bounded) plus
  `shifts_generated_at`; the table `snack_shack_absorb_choices` keyed
  UNIQUE (snack_shack_id, date, window_start) with the 0049-shaped
  `is_org_member` policy and authenticated-only grants; and the SECURITY
  DEFINER RPC `regenerate_snack_shack_shifts(p_snack_shack_id, p_shifts)`.
  **The RPC takes the FULL desired derived set** (`[{date, start, end,
  assigned_team_id}]`, computed by the library in the browser) and in one
  transaction deletes derived rows not in the set, inserts the new ones, and
  KEEPS every derived row whose date/start/end matches — **a kept row's
  assignment is the database's; the team passed for a kept slot is IGNORED**,
  so a stale client read cannot lose an assignment. Manual rows
  (`is_recurring=false`) are never read or written. Every element is validated
  (date, HH:MM[:SS], end after start, team belongs to THIS season, no duplicate
  slot) before anything is written. EXECUTE: authenticated only (revoked from
  public + each role first; the migration's final DO block raises if a
  privilege is wrong). `days_of_week` keeps its meaning; `time_blocks_by_day`
  stays in place, unread.
- **Existing data was not migrated by 0103.** Existing blocks were neither read
  nor written (checksum-proven); existing settings rows got the defaults. The
  real league's 33 blocks change only if an admin regenerates.
- **Locks when 0103 is applied: ACCESS EXCLUSIVE on `snack_shack_settings`**
  (ADD COLUMN with constant defaults, no rewrite; ADD CONSTRAINT scans 3
  rows) — blocks every read and write of that table (Snack Shack page, venue
  delete guard, Teams page snack button embed, both email routes) for under a
  second, or for the whole migration if applied in one transaction. Nothing on
  `snack_shack_blocks`, `games`, `teams`, `leagues`, `divisions`.
- **Harness: `scripts/sim/snack-shack-regenerate-sim.sql`**, assembled by
  `snack-shack-regenerate-build.ts` (same pre-apply proof pattern as 0098):
  applies 0103 inside an always-rolled-back batch, fixtures under the "test"
  org only, asserts the pre-existing rows byte-identical (M2), the defaults on
  a pre-existing row (M1), privileges (P1), the keep/create/remove contract
  with ids and reported assignments (R1), the ignored caller assignment on a
  kept row (R2), the untouched manual row (R3, checked first), idempotence
  (R5), the non-member/anon refusals (R6/R7), validation (R8), atomicity (R9),
  and the absorb table's RLS (C1/C2); 6 mutants on the real function body.
  It holds the same ACCESS EXCLUSIVE lock as the migration for the run
  (one to two seconds, `lock_timeout` 3s). Not `npm run`-able, not in CI.
  Run 2026-10-05: green, 6/6 mutants killed at their own tag; run 1 died at
  the first fixture insert because `INSERT … SELECT` does not coerce bare
  string literals (VALUES does) — cast fixture literals in a SELECT list.
- **Stage 3 (UI + wrapper, 2026-10-05, on `feat/snack-shack-derived`):**
  - **PAST DATES ARE FROZEN BY THE CALLER, NOT THE RPC.** `buildRegeneratePlan`
    (`src/lib/snack-shack/regenerate-plan.ts`) computes "today" in the ORG's
    timezone (`todayInTimezone(profiles.timezone)`, never the browser's or the
    server's date) and passes every stored derived row dated before today
    through to the RPC unchanged, so the RPC keeps it; a derived shift for a
    past date is never added. The RPC has no notion of today. Harness part F
    + mutants SM21/SM22 pin it; the staleness notice is upcoming-only (SM23);
    the equity pick for new shifts is seeded with the frozen past rows (SM24).
  - **Regenerate ALWAYS previews.** `useShiftPlan` loads inputs through
    `loadShiftInputs` (every read throws; the games read is `fetchAllRows`,
    complete-or-throw; blackouts are not read) and computes the plan;
    `RegeneratePreviewModal` shows shifts added / removed / changed by date (a
    same-start, different-end pair is one "changed" shift, SM25) and every
    assignment that would change (`assignmentChangeLines`, verbatim); Confirm
    sends `plan.desired` to `regenerate_snack_shack_shifts` and logs
    `snack_shack_shifts_regenerated` with `regenerateLogMessage`; Cancel writes
    nothing. The wizard no longer generates — its Review step saves settings
    only.
  - **Legacy seasons** (`shifts_generated_at` null with derived rows) show
    `LEGACY_SHIFTS_NOTICE` verbatim on the page and in the preview.
  - **The Days/Blocks steps are gone**; `StepHours` is the rule (offsets,
    longest shift with `maxShiftHelpText` — it says a leftover under 60 can
    extend a shift up to 59 minutes — and the days the shack can open).
    `time_blocks_by_day` is written back untouched and read by nothing.
  - **Per-day leftover control** (`AbsorbChoiceControl`) writes
    `snack_shack_absorb_choices` under RLS and reloads the plan; manual shifts
    use the one `AddOneOffModal` from both the season-level button and the
    per-day "Add a shift on this day"; the list groups rows by date with the
    derived window, the closed-day list is upcoming-only.
  - `src/types/database.ts` is HAND-MAINTAINED (its `Functions` map is kept
    EMPTY on purpose — a real entry re-types every other `rpc()` call and
    broke two gate files); RPCs use `@ts-expect-error` at the call site. The
    0103 table and columns were added by hand in the generator's shape.
  - Verified look-only through a throwaway scratch route (deleted): the page,
    the preview, the Hours step, the leftover control; the fail-loud banner
    renders when a read refuses. **The real league (Santa Rosa American Little
    League, "SRALL - Fall 2026") WAS regenerated through the product on
    2026-10-05 23:43 UTC** (11 added, 9 removed, 24 past frozen; a no-op run a
    minute later stamped `shifts_generated_at`), which is how the Oct 17 Royals
    overlap below was found. The test org's two seasons are still legacy
    (`shifts_generated_at` null). Two leftover choices ("first", Oct 10 and
    Oct 17 09:30 windows) were saved AFTER that regenerate and are not yet
    applied — the next regenerate moves those windows.
- **ASSIGNMENT NEVER OVERLAPS A GAME (2026-10-06, branch
  `feat/snack-shack-overlap-guard`).** The picker used to key off game DATES
  only (`preferenceMapsByDate`), so a team could be handed the shift that ran
  during its own game — live: the real league's Oct 17 1:30–3:30 shift went to
  RVLL Royals, who play 2:30 at Memorial (reassigned by hand to SRALL Mariners
  the same day, logged as `snack_shift_assignment_changed`). The rules now, in
  `assignNewShifts` (derive-shifts.ts), in this order:
  1. **Hard, both modes, BEFORE equity:** a team is never given a shift that
     overlaps any of its games — home, away, interleague, pending, or a
     playoff game with a date — from `GAME_BUFFER_BEFORE_MIN` (30) before the
     start to the end (division duration) plus `GAME_BUFFER_AFTER_MIN` (0).
     Cancelled games don't count. The index (`assignmentIndexFromGames`) is
     built from `games` AND `playoff_games` (the loader reads both; the
     derivation still opens the shack from `games` only).
  2. **Equity next, in BOTH modes (decided 2026-10-06, replacing a
     tiers-first draft that used 38 of 54 teams in the real league):** the
     eligible teams with the fewest shifts so far, seeded with frozen and
     kept rows. The preference never promotes a team past that group.
  3. **The preference breaks the tie inside that group.** Game days: at a
     shack venue that day, HOME OR AWAY (already clear of the shift), then
     not playing that day, then anyone in the group. Off days: not playing
     that day, else anyone in the group. Leaving the first tier sets
     `preference_not_met`. Then name, then id.
  4. **Nobody eligible → the shift is UNASSIGNED and flagged `unfilled`.**
     Never a fallback to a playing team; `assigned_team_id` null in the RPC
     payload is a real outcome now. The plan carries `flagged` for the preview;
     `storedAssignmentFlag` judges STORED rows by the same rules for the page
     (`conflict` for a stored team the hard rule would refuse — legacy rows
     and hand edits). Sentences come from `assignmentFlagLine`, verbatim.
  - Frozen past rows, manual rows, kept assignments on unchanged shifts, the
    derivation and the leftover choices are untouched — a kept row that
    overlaps stays as it is and the page is where it gets flagged.
  - **FLAGS UI (mockup v2, approved and built 2026-10-06).** The pure
    decisions live in `src/lib/snack-shack/shift-flags.ts` and every surface
    renders them verbatim: RED means only "fix this" — the assigned team
    plays during the shift (chip "Plays 1:00pm, during this shift") or no
    team is assigned ("Needs a team" in red in place of the name, plus the
    chip "No team is free during this shift" ONLY when every team is
    blocked). Off-preference is plain gray text ("Not at the park that day"
    / "Plays that day"), never a chip. A row dated before today in the org's
    zone is NEVER flagged; a manual row gets the red checks only (it was
    never placed by the preference); the top banner counts red rows only
    (`redBannerLine`). The list sorts by date with manual shifts among the
    derived ones, shows a "Manual" tag only on manual rows, and renders a
    table at `md` and up and one card per shift below it; time ranges share
    one suffix ("9:30–11:30am", "11:30am–1:30pm", `fmtShiftRange`). While
    the game schedule is loading or unreadable the page passes no flag map
    and an empty row reads plain "Unassigned". The preview lists the plan's
    `flagged` under "After Confirm" (unfilled red, off-preference gray) and
    a red "N needs a team" pill. Nothing reaches the print region or the
    email routes (they render their own markup). Harness: sim section U
    (runs LAST) + mutants UM1–UM4; verified on a deleted scratch route at
    375px and 1280px.
  - **Harness:** sim section A — the harness's OWN interval check (buffer as a
    LITERAL 30, never the imported constant) over fixed fixtures and a seeded
    sweep of 300 Saturdays × 2 modes; nine mutants NM1–NM9 (buffer removed,
    away ignored, playoff ignored, filter after equity, fallback to a playing
    team, both missing flags, pending not busy, stored conflict not reported)
    plus NM10 (tiers before equity, killed by the re-keyed A7).
    Run 2026-10-06: 36/36 killed at their own assertion on the second pass
    (three harness ordering faults on the first — read the sim's MUTATION
    LOG); with NM10 and the flags mutants UM1–UM4, 41/41. `npm run
    sim:snack-shifts` 169 checks × 3 zones, 26 counters.
- **Shift notes + "in charge of cash" (0104, APPLIED 2026-10-06 02:54 UTC after
  a first-run-green rolled-back proof; branch `feat/snack-shack-notes-cash`).** Decided, same rules as game notes:
  a NOTE on any shift (500 chars, attribution by the BEFORE UPDATE trigger
  `set_snack_shack_blocks_notes_attribution`, copied from 0095) and an
  optional CASH PERSON, a FK to `snack_shack_cash_people` (one list per
  season, keyed by the settings row; unique on lower(btrim(name)); ON DELETE
  SET NULL — removing a name nulls its shifts in the same statement; the
  page's confirm shows a pre-flight count that renders "couldn't count" on a
  failed read, never 0). **Both are INTERNAL: never printed, emailed,
  exported or shown to teams.** `SHIFT_NOTE_SELECT_FIELDS`
  (`src/lib/snack-shack/shift-notes.ts`) is the one string the page select
  carries, and that is the hazard: the print regions render from the same
  object. `npm run sim:game-notes` scans the two email routes and the Teams
  page button as files and the page client's TWO print paths as SLICES, and
  asserts the page select CARRIES the fields; `sim:game-notes:mutants`
  (GM8–GM11) plants a leak in each and requires its own line to catch it.
- **Regenerate carries a note and its cash person to the same-start
  replacement.** 0104 re-creates `regenerate_snack_shack_shifts` (body
  verbatim from 0103 plus: capture the doomed rows' note, attribution and
  cash person BEFORE the delete; copy them in the INSERT — in the INSERT, so
  the UPDATE-only attribution trigger cannot re-stamp the regenerating admin
  as the author; return `carried` and `lost`). Kept rows are untouched as
  before. The plan (`regenerate-plan.ts`) lists `carried` and `lost` and the
  preview shows both, so nothing vanishes silently. **The ONE shared note
  editor is `src/components/schedule/note-editor-modal.tsx`**; the game hook
  and the shift hook (`use-shift-note-editor.tsx`) both render it and own
  their own write + log. Cash people are managed on the page
  (`cash-people-card.tsx`), not in the wizard.
- **Locks 0104 took when applied: ACCESS EXCLUSIVE on `snack_shack_blocks`**
  (ADD COLUMN ×4, ADD CHECK; ~110 rows, instant) and **SHARE ROW EXCLUSIVE on
  `profiles`** (the notes_updated_by FK — blocks profile WRITES for that
  statement: org-name saves, setup dismiss, Stripe plan updates, signups).
  Harness: `scripts/sim/snack-shack-notes-cash-sim.sql` (assembled by
  `snack-shack-notes-cash-build.ts`; applies 0104 rolled back, test org only,
  re-runs the 0103 R-series, N1–N7, 6 mutants incl. the FK flipped to NO
  ACTION and the trigger re-stamp). Run 2026-10-06 against production,
  rolled back: GREEN on the first run, 6/6 mutants killed first at their
  own tag, leak check clean, no other active backend; 0104 applied right
  after and verified live (see the harness RUN LOG). Existing blocks were
  byte-identical on their original columns afterward; no row carries a
  note or cash person and the cash-people table is empty until an admin
  uses the feature.
- **Harness: `npm run sim:snack-shifts`** (108 checks × 3 zones, 16
  anti-vacuity counters) and `npm run sim:snack-shifts:mutants` (27 mutants,
  each killed FIRST at its own assertion). Read the MUTATION LOG in the sim
  header: the first run had five killed at the wrong line, all harness
  ordering faults, and the section order now exists because of them.

## Open items

- **Snack shack last-resort tiebreak is alphabetical, so when shifts < teams
  the same end of the alphabet is skipped every season. Replace with a
  rotation (low priority).** (2026-10-06: the real league's from-scratch run
  gives 46 of 54 teams a shift; the eight skipped are the WSLL teams at the
  end of the name order.)

- **The reschedule picker's own save has no save-time lock re-read** (the
  manual path gained one 2026-09-26). If the lock is switched on while the
  picker is open, a picked slot still saves — the trigger allowlists the
  columns. Pre-existing; add the same `fetchDivisionLocks` →
  `manualSaveLockRefusal`-style check to `handleConfirm` when it is next
  touched (it affects the rainout variant too, where the lock is deliberately
  NOT a gate — so the check belongs to the move variant only).

- **CANDIDATE — a filtered schedule print does not say it is filtered.**
  `SchedulePrintRegion` prints the season name and a game count, but nothing
  about an active `?division=` / `?team=` / `?venue=` / `?location=` filter. A
  Monroe-only print therefore looks like the full season schedule — and a
  printed schedule handed to a board or parents is exactly where that misread
  lands. Pre-existing for every filter; the Location filter (2026-09-24) just
  makes a partial print more natural to produce. Fix = the print header names
  the active filters. Not built.

- **Rainout reschedule modal: swallowed `blackout_dates` error + NaN-prone
  duration/buffer parsing; occupancy gate: null buffer resolves to 0.** All
  three found 2026-09-14 during the interleague picker work and deliberately
  left alone — details under "Interleague counter-proposal picker".
- **Resolve route / accept-proposal can save onto a non-playing day** (Finding
  C, same section). Neither server gate checks the division's playing days.
  (The lock, hours and occupancy gaps alongside it closed 2026-09-23 — see
  "WHICH PATH GETS WHICH GATE" under Interleague negotiation.)
- **CLOSED 2026-09-24 by 0093 — both delete doors now guard a live
  negotiation.** `delete_game_if_unblocked` gained a FOURTH block reason,
  `interleague_negotiation`, evaluated alongside the other three (never
  first-match), count-first as the house rule requires. The
  `pending_interleague` carve-out STAYS for untouched invites — a dead invite
  must not strand a row — and the 0082 lock trigger was NOT touched, which was
  safe because a partner decline goes through the token RPCs
  (`accept`/`decline_interleague_invite` delete games directly), never this one.
  `anon` holds no EXECUTE on it, re-verified.
- **ONE DEFINITION OF "PROTECTED", TWO LANGUAGES, PINNED BY A SHARED TRUTH
  TABLE.** `public.is_protected_interleague_game` (SQL, 0093) and
  `isProtectedInterleagueGame` (TypeScript, the regenerate guard) must agree
  about the same rows and neither can be derived from the other. **The table
  lives in exactly ONE place: the `values` block between the
  `TRUTH-TABLE-BEGIN`/`END` marker lines in
  `scripts/sim/delete-game-negotiation-sim.sql`.** That harness runs every row
  through the SQL function; `npm run sim:regenerate-pending-guard` PARSES THE
  SAME BLOCK OUT OF THAT FILE and runs it through the TypeScript one. Change
  either predicate alone and its side goes red.
  **The formatting is load-bearing, in a measured way** (not the vague way an
  earlier draft of this note claimed): re-indenting or reflowing the ROWS is
  fine, but each marker must stay alone on its own line, and renaming,
  removing or DUPLICATING a marker, adding a column, or changing the literal
  style all fail the cross-check. Never a skip — a missing block is a failure.
  **Do not add a second "for readability" copy of the table**: the first draft
  of that file had one in its header, and the parser silently read 22 rows
  across both copies, which is the exact drift the design exists to prevent.

- **Dead-column cleanup (backlog, no reader/writer).** `divisions.practice_venue_id`
  (no UI picker anywhere, 1 live row) and `venues.venue_type` (read/written
  nowhere, superseded by `division_venues.allow_games`/`allow_practices`) are
  both dead columns. Same family; a future cleanup migration can drop them.
  Not urgent — flagged so a reader doesn't assume they mean something.
- **`dashboard_readonly` holds EXECUTE on functions it shouldn't (least-privilege
  backlog).** `delete_location_if_unreferenced` and every function created since
  the July "alter default privileges … grant execute on functions" change carry
  an EXECUTE grant to `dashboard_readonly`. It fails CLOSED (the functions gate
  on `is_org_member`, which matches `auth.uid()`, and the dashboard connects with
  NO JWT), so nothing is exposed — but it is one layer of protection instead of
  two. Clean up alongside the restricted Stripe key.

- **Rainout reschedule modal carries lever advice** — `rainout-reschedule-modal.tsx`
  line ~515 says "Try adding venues or extending the season end date." Same
  smell as the generator copy removed 2026-07-23, but a different feature with
  no attribution machinery behind it: there is no rejection tally for the
  rainout slot search, so honest wording there needs its own (small) design
  pass, not a copy-paste of `shortfallSummary`. Deliberately left out of the
  skip-attribution change.

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
  (`practices-page-client.tsx` ~line 1697): clearing it blur-saves
  `duration_minutes: 0` (`Number("")` is `0`, `min={15}` is UI-only) — but
  the write is REJECTED by the live `CHECK (duration_minutes > 0)` on
  `practice_time_slots` (verified against the live catalog 2026-07-23; zero
  zero-duration rows exist). The defect is UX only: the admin sees a raw
  constraint-violation message instead of a friendly guard. Wants the
  `66e7256` guard class as polish, not as a data-integrity fix.
- **Pay-report modal print is an unverified whole-page print path**
  (`pay-report-modal.tsx` ~line 188, mounted on `/dashboard/umpires` via
  `PayReportButton`). It prints via a whole-page `window.print()` using
  `print:block`/`print:hidden` utilities and has NO `.fieldslate-print-region`
  — unlike the schedule/division/umpire print regions. Under the OLD
  unconditional `body { visibility: hidden }` in the print CSS it was printing
  BLANK (nothing re-showed the modal). The print-normal-flow rewrite in
  `f9cdd47` removed that unconditional blank (body is no longer hidden when no
  region is present), so this surface's print behavior CHANGED — it now prints
  *something* rather than nothing — but nobody has verified what it actually
  produces (likely the page chrome + modal, unstyled for print). Whoever
  touches it next should either convert it to the `.fieldslate-print-region`
  mechanism (the schedule/umpire pattern) or print it once and confirm what
  comes out today. Not a regression of a working feature — it was blank before.
