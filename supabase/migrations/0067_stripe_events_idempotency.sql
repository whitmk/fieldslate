-- Item 13 (billing hardening, Chunk A): make the Stripe webhook idempotent.
--
-- checkout.session.completed is delivered at-least-once and retried on
-- timeout/non-2xx for ~3 days, so the handler must not double-process.
-- Previously the route did the plan update + season provisioning inline with
-- NO dedup, so a retry re-inserted a season — and worse, recomputed `wasPaid`
-- from the already-mutated profiles.plan, which turned the quantity=1 /
-- originally-Free path (meant to provision NOTHING) into a spurious season on
-- retry.
--
-- This migration adds:
--   1. stripe_events — a dedup ledger keyed on the Stripe event id.
--   2. process_checkout_event — a SECURITY DEFINER function that claims the
--      event id and performs the plan update + branch logic in ONE
--      transaction. The claim (INSERT ... ON CONFLICT DO NOTHING) is the FIRST
--      statement; a duplicate inserts zero rows and returns early, before any
--      read or write. Because the pre-update plan read happens AFTER the claim
--      and inside the same txn, retry-ordering can never corrupt wasPaid again.
--
-- Called ONLY by the Stripe webhook via the service-role client (the route
-- verifies the Stripe signature first), so there is no auth.uid() check here —
-- it mirrors the route's existing trust model. Execute is granted to
-- service_role only.

create table if not exists public.stripe_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);

-- Internal ledger — no end-user access. RLS on with no policies denies the
-- anon/authenticated API roles; the SECURITY DEFINER function below runs as
-- owner (bypasses RLS), and the service-role client bypasses RLS too.
alter table public.stripe_events enable row level security;

create or replace function public.process_checkout_event(
  p_event_id     text,
  p_org_id       uuid,
  p_plan         text,
  p_quantity     int,
  p_upgrade_only boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_was_paid boolean;
  v_seed     public.leagues%rowtype;
  v_has_seed boolean := false;
begin
  -- ── Dedup claim ─────────────────────────────────────────────────────────
  -- First writer wins. A duplicate delivery conflicts on the PK and inserts
  -- zero rows → return before any further read or write. Concurrent duplicate
  -- deliveries serialize on the PK lock, so exactly one proceeds.
  insert into public.stripe_events (event_id, type)
  values (p_event_id, 'checkout.session.completed')
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 'skipped_duplicate';
  end if;

  -- ── Pre-update plan → wasPaid ───────────────────────────────────────────
  -- Read AFTER the claim and INSIDE the txn: a retry never reaches this line
  -- (it returned early above), so wasPaid can no longer be corrupted by
  -- retry-ordering — the core bug this migration eliminates.
  select (plan in ('pro', 'elite')) into v_was_paid
    from public.profiles
   where id = p_org_id;
  v_was_paid := coalesce(v_was_paid, false);

  -- ── Apply tier + clear onboarding pending_plan ──────────────────────────
  -- (Idempotent in isolation, but kept inside the txn with the branch logic
  -- so a failure rolls back the claim too.)
  update public.profiles
     set plan = p_plan,
         pending_plan = null
   where id = p_org_id;

  -- Oldest active season — the conversion target and the seed for new rows
  -- (mirrors the route's `order by created_at asc limit 1` over active rows).
  select * into v_seed
    from public.leagues
   where owner_id = p_org_id
     and archived_at is null
   order by created_at asc
   limit 1;
  v_has_seed := found;

  -- ── Branch logic — byte-for-byte the route's prior behavior ─────────────
  if p_upgrade_only then
    -- Pro→Elite ($120 delta): tier already flipped above; record the
    -- conversion on the oldest active season. No new season.
    if v_has_seed then
      update public.leagues set updated_at = now() where id = v_seed.id;
    end if;

  elsif p_quantity = 2 then
    -- First upgrade buying two seasons: convert the existing one + add one.
    if v_has_seed then
      update public.leagues set updated_at = now() where id = v_seed.id;
    end if;
    insert into public.leagues (owner_id, name, sport, season, status, archived_at)
    values (
      p_org_id, 'New Season',
      coalesce(v_seed.sport, 'baseball'),
      coalesce(v_seed.season, ''),
      'active', null
    );

  elsif p_quantity = 1 and v_was_paid then
    -- Existing paid org adding one more season.
    insert into public.leagues (owner_id, name, sport, season, status, archived_at)
    values (
      p_org_id, 'New Season',
      coalesce(v_seed.sport, 'baseball'),
      coalesce(v_seed.season, ''),
      'active', null
    );
  end if;
  -- quantity = 1 and NOT wasPaid: plan update only (the Free→paid post-signup
  -- path — the existing single season becomes the paid season; no new row).

  return 'processed';
end;
$$;

revoke all on function public.process_checkout_event(text, uuid, text, int, boolean) from public;
grant execute on function public.process_checkout_event(text, uuid, text, int, boolean) to service_role;
