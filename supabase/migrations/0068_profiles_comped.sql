-- Item 13 (billing hardening, Chunk B): comped-account guard.
--
-- profiles.comped marks an account as having complimentary access that the
-- billing path must NEVER touch — independent of profiles.plan (the tier).
-- It is a "do not let Stripe overwrite or charge this row" flag, not a tier.
--
-- The Stripe webhook (process_checkout_event caller) and the checkout-start
-- route both read this flag and refuse to act for a comped org: the webhook
-- acks + no-ops (never overwrites the comp or provisions a season), and the
-- checkout route refuses to create a session — so a comped account can never
-- reach Stripe, which is what makes live smoke-testing through the team's own
-- comped accounts safe.

alter table public.profiles
  add column if not exists comped boolean not null default false;

-- Backfill the known complimentary accounts. Matched case-insensitively by
-- email; safe if any address is absent — only matching rows update, no error.
update public.profiles
   set comped = true
 where lower(email) in (
   'whitking10@gmail.com',
   'whitmellonking@gmail.com',
   'whitking10+test2@gmail.com',
   'jennifer.m.medici@gmail.com'
 );
