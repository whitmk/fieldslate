-- promo_codes — table-driven promo → Stripe-coupon mapping.
--
-- Until now the only promo (INTERLEAGUE) was hardcoded in /api/auth/callback
-- against the STRIPE_INTERLEAGUE_COUPON_ID env var. That broke silently when
-- the Stripe coupon behind it expired (2026-06-29): the callback attached a
-- dead coupon, session creation threw, and promo signups fell through to the
-- dashboard with no discount and no retry. This table makes the mapping data:
-- adding, expiring, or re-pointing a promo is a row edit, not a deploy.
--
-- Read exclusively by resolvePromoCoupon (src/lib/promo.ts) via the
-- service-role admin client at checkout time. A code resolves only if the row
-- exists AND active AND (expires_at is null or in the future). expires_at is
-- kept ~5 days EARLIER than the Stripe coupon's redeem_by so we stop
-- attaching a coupon before Stripe would start rejecting it.
--
-- RLS is enabled with NO policies: anon/authenticated see nothing (promo
-- inventory is not public data). service_role bypasses RLS but NOT table
-- privileges, and this project's Postgres grants service_role nothing on new
-- public tables by default — the explicit GRANT below is load-bearing.
-- Without it every resolver read fails 42501 and the promo silently falls
-- back to the env var (the same class of gap as the 0070 comp-guard outage).

create table public.promo_codes (
  code             text primary key,          -- stored uppercase (pending_promo is uppercased by the 0071 trigger)
  stripe_coupon_id text not null,
  active           boolean not null default true,
  expires_at       timestamptz,               -- null = no expiry; set ~5 days before the Stripe coupon's redeem_by
  notes            text
);

alter table public.promo_codes enable row level security;

grant select on table public.promo_codes to service_role;

-- Seed: the INTERLEAGUE code now maps to the replacement Stripe coupon
-- INTERLEAGUE2 (the original INTERLEAGUE coupon expired 2026-06-29 and is
-- dead). The code in customers' links stays INTERLEAGUE. INTERLEAGUE2's
-- Stripe redeem_by is 2027-07-30 → expires_at 2027-07-25 (5 days earlier).
insert into public.promo_codes (code, stripe_coupon_id, active, expires_at, notes)
values (
  'INTERLEAGUE',
  'INTERLEAGUE2',
  true,
  '2027-07-25 00:00:00+00',
  'Interleague invite 20% off — replacement coupon; original INTERLEAGUE coupon expired 2026-06-29'
);
