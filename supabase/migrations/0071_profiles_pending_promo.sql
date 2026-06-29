-- profiles.pending_promo — the promo code a user arrived with at signup but
-- hasn't redeemed yet. Same home/pattern as pending_plan (0061): carried
-- through auth metadata, written by the SECURITY DEFINER handle_new_user
-- trigger (no user session exists at signup with email confirmation on, so a
-- client write can't satisfy the profiles RLS UPDATE policy auth.uid()=id),
-- read after email verification by /api/auth/callback to attach a Stripe coupon
-- to the FIRST checkout, and cleared by the webhook (process_checkout_event) on
-- the first successful checkout so the discount can't ride a later purchase.
--
-- The existing "Users can update own profile" RLS policy (auth.uid() = id)
-- already covers this column — it's the same row, no new policy needed.
--
-- Unlike pending_plan, NO CHECK constraint / value whitelist: promo codes are
-- open-ended marketing tags resolved at checkout (the callback matches
-- INTERLEAGUE → STRIPE_INTERLEAGUE_COUPON_ID), not a fixed enum that drives app
-- logic. The trigger stores the trimmed/uppercased value or NULL; an unknown
-- code simply never resolves a coupon and is cleared on the first checkout. A
-- CHECK would force a migration per promo and could fail the whole signup
-- INSERT — the exact risk 0061's CASE was written to avoid.

alter table public.profiles
  add column if not exists pending_promo text;

-- handle_new_user(): now also persists the promo code from signup.
--
-- The signup form stores the ?promo= URL param in auth user metadata as
-- `promo`. We normalize (upper + trim) and nullif empty → NULL, mirroring how
-- org_name (0060) is captured and how pending_plan (0061) flows. The plan
-- CASE, org_name logic, and the organization_members owner insert (0048) are
-- preserved exactly; the trigger binding (0001) is unchanged.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, org_name, pending_plan, pending_promo)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    nullif(trim(new.raw_user_meta_data->>'org_name'), ''),
    case
      when new.raw_user_meta_data->>'plan' in ('pro', 'elite')
        then new.raw_user_meta_data->>'plan'
      else null
    end,
    nullif(upper(trim(new.raw_user_meta_data->>'promo')), '')
  );

  insert into public.organization_members (org_id, user_id, role)
  values (new.id, new.id, 'owner');

  return new;
end;
$$;

-- process_checkout_event(): on a successful checkout, ALSO clear pending_promo
-- alongside pending_plan, so the promo can be redeemed exactly once (the first
-- season) and cannot ride a later purchase. This is the ONLY change vs the
-- definition from migration 0069 — the dedup claim, wasPaid read ordering,
-- branch logic, SECURITY DEFINER, search_path, and grants are byte-for-byte
-- identical (the revoke/grant at the bottom re-asserts the service_role-only
-- execute grant unchanged).

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

  -- ── Apply tier + clear onboarding pending_plan / pending_promo ──────────
  update public.profiles
     set plan = p_plan,
         pending_plan = null,
         pending_promo = null
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
