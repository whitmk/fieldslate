# CLAUDE.md

Operational guidance for working in this repo. [README.md](README.md) covers the
stack, data model, and code conventions — read it first. This file holds the
production-critical, easy-to-get-wrong facts, mostly around billing and URLs.

## Deployment & environment

- **Production-only.** Every push to `main` auto-deploys to production via
  Vercel. There is no staging environment. `npx tsc --noEmit` and
  `npx eslint <touched paths>` must pass before every commit.
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
  **Latest migration: 0072.** The repo files are the record, not the
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
  `generateStaticParams`, unknown slugs 404). `src/app/sitemap.ts` covers the
  public marketing routes plus each post; `public/llms.txt` describes the site
  for LLM crawlers. All absolute URLs come from `SITE_URL`.
- **Live article:**
  https://www.thefieldslate.com/blog/sports-connect-alternatives-little-league
- **The FAQPage JSON-LD on the article page is hardcoded** (four Q/A pairs in
  `src/app/(marketing)/blog/[slug]/page.tsx`, gated to that slug) — editing
  the article's FAQ section in the markdown requires a manual matching update
  to the JSON-LD, or the two silently drift.

## Open items

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
