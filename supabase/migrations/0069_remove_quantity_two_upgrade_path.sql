-- Item 13 (billing fix): remove the quantity = 2 feature-upgrade path.
--
-- Background: a Free→paid feature upgrade used to be a TWO-season purchase
-- (qty 2) — the webhook converted the org's existing Free season AND inserted a
-- second new season, charging $258/$498 instead of $129/$249. That was wrong:
-- upgrading an existing Free season must convert that ONE season in place and
-- provision NO second season. The separate "add a season" flow (a paid org
-- buying one more, qty 1) is correct and is unchanged.
--
-- This migration replaces process_checkout_event (from migration 0067) to
-- DELETE the `p_quantity = 2` branch. After removal a Free→paid upgrade
-- (qty 1, wasPaid = false) falls through to the existing plan-flip-only
-- behavior: the tier is applied to profiles and the org's single existing
-- season becomes the paid season — no new row. The other three behaviors are
-- byte-for-byte unchanged:
--   • upgradeOnly (Pro→Elite): flip tier, touch the seed season, no new season.
--   • qty 1 & wasPaid (add-season): insert one new season.
--   • qty 1 & NOT wasPaid (Free→paid convert): plan update only.
--
-- A stray in-flight qty 2 event delivered after deploy now also falls through
-- to plan-flip-only (it matches no remaining branch), so it can no longer
-- provision a phantom second season.
--
-- ALL idempotency/claim logic, the wasPaid read ordering (after the claim,
-- inside the txn), and the SECURITY DEFINER + set search_path = public +
-- revoke/grant-to-service_role from 0067 are preserved exactly.

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
  -- (it returned early above), so wasPaid can never be corrupted by
  -- retry-ordering.
  select (plan in ('pro', 'elite')) into v_was_paid
    from public.profiles
   where id = p_org_id;
  v_was_paid := coalesce(v_was_paid, false);

  -- ── Apply tier + clear onboarding pending_plan ──────────────────────────
  update public.profiles
     set plan = p_plan,
         pending_plan = null
   where id = p_org_id;

  -- Oldest active season — the conversion target and the seed for new rows.
  select * into v_seed
    from public.leagues
   where owner_id = p_org_id
     and archived_at is null
   order by created_at asc
   limit 1;
  v_has_seed := found;

  -- ── Branch logic ────────────────────────────────────────────────────────
  if p_upgrade_only then
    -- Pro→Elite ($120 delta): tier already flipped above; record the
    -- conversion on the oldest active season. No new season.
    if v_has_seed then
      update public.leagues set updated_at = now() where id = v_seed.id;
    end if;

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
  -- Otherwise (qty 1 and NOT wasPaid — the Free→paid feature upgrade — or any
  -- stray non-1 quantity): plan update only. The org's existing single season
  -- becomes the paid season in place; no new row is provisioned.

  return 'processed';
end;
$$;

revoke all on function public.process_checkout_event(text, uuid, text, int, boolean) from public;
grant execute on function public.process_checkout_event(text, uuid, text, int, boolean) to service_role;
