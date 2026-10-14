-- 0111: every paid season is paid for — season purchases and season credits.
--
-- DECIDED 2026-10-14 (Whit):
--   * A paying league has no "season limit": every new season is bought, one
--     at a time, at the league's CURRENT tier (Pro → Pro price, Elite → Elite
--     price). Quantity is ALWAYS 1.
--   * With NO active season, a purchase offers a tier choice (up or down).
--   * A Free league keeps one active free season at a time (create_league);
--     with that season active it can only upgrade it IN PLACE (convert_free).
--   * Pro → Elite is a flat $100 for the whole league (upgrade_tier).
--   * A paid signup pays before any season exists: its payment becomes a
--     SEASON CREDIT, which create_league uses up for the first season.
--   * A payment whose purchase is not pending (or is not this league's, or is
--     for another tier) becomes a credit, never LOWERS the plan, and is
--     flagged needs_review. The webhook emails hello@ when it sees the flag.
--   * Pending purchases expire after 24 hours, worked out on read; no job.
--   * Comped leagues never buy: begin_season_purchase refuses them
--     (`billing_managed`). Their seasons come from FieldSlate — a credit
--     inserted by hand (kind 'comp', see COMPING-RUNBOOK.md), then the form.
--
-- WHAT THIS FILE DOES
--   1. Table season_purchases: one row per checkout. A row with status
--      'credited' and league_id null IS an unused season credit.
--   2. begin_season_purchase(...): decides what may be bought from the
--      league's plan, comp flag and active-season count — never the browser.
--   3. attach_purchase_session(...): records the Stripe session id, or marks
--      the purchase abandoned when Stripe failed.
--   4. process_checkout_event: gains p_purchase_id and now returns jsonb.
--      With no purchase id (checkout sessions created by the code before this
--      change, valid up to 24 hours) it runs the 0071 body UNCHANGED, plus one
--      addition: a paid signup with nothing to convert gets a credit, so it is
--      not stranded by (5). Remove that branch in a follow-up migration once
--      the window has passed.
--   5. create_league: Free unchanged; a PAID league must use up a credit.
--      Without one it returns the old cap_reached shape plus
--      reason 'purchase_required', so the screens shipped before this change
--      still show their existing message instead of breaking.
--
-- DEPLOY ORDER: apply this BEFORE the route/screens that call
-- begin_season_purchase reach main. The live code keeps working on it: the
-- webhook's named-argument call resolves to the new function (p_purchase_id
-- defaults to null) and ignores the reply's shape.
--
-- APPLY VERBATIM, comments included (CLAUDE.md). Verify md5(prosrc) of
-- begin_season_purchase, attach_purchase_session, process_checkout_event and
-- create_league against this file. create_league's live body had drifted
-- from 0059 by one in-body comment (found 2026-10-14); this file replaces it.
--
-- LOCKS when applied: CREATE TABLE season_purchases takes SHARE ROW EXCLUSIVE
-- on profiles and leagues (its foreign keys) — blocks WRITES to both (renames,
-- archive, plan changes, signups) until the transaction ends, not reads.
-- DROP FUNCTION process_checkout_event takes ACCESS EXCLUSIVE on that function
-- only: a Stripe webhook arriving mid-apply waits, then retries if it errors.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. season_purchases
-- ────────────────────────────────────────────────────────────────────────────
create table public.season_purchases (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.profiles(id) on delete cascade,
  kind              text not null,
  tier              text not null,
  plan_at_checkout  text not null,
  name              text,
  sport             text,
  season_label      text,
  start_date        date,
  end_date          date,
  status            text not null default 'pending',
  needs_review      boolean not null default false,
  review_reason     text,
  stripe_session_id text unique,
  stripe_event_id   text,
  league_id         uuid references public.leagues(id) on delete set null,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  credit_used_at    timestamptz,

  constraint season_purchases_kind_check check (kind in
    ('add_season', 'first_season', 'convert_free', 'upgrade_tier', 'signup',
     'unmatched', 'comp')),
  constraint season_purchases_tier_check check (tier in ('pro', 'elite')),
  constraint season_purchases_plan_check check (plan_at_checkout in ('free', 'pro', 'elite')),
  constraint season_purchases_status_check check (status in
    ('pending', 'completed', 'credited', 'abandoned')),
  constraint season_purchases_name_check check (name is null
    or (name = btrim(name) and char_length(name) between 1 and 120)),
  constraint season_purchases_sport_check check (sport is null
    or (sport = btrim(sport) and char_length(sport) between 1 and 40)),
  constraint season_purchases_label_check check (season_label is null
    or char_length(season_label) <= 60),
  constraint season_purchases_dates_check check (end_date is null
    or start_date is null or end_date >= start_date),
  -- A purchase that creates a season carries everything the season needs.
  constraint season_purchases_season_fields check (
    kind not in ('add_season', 'first_season')
    or (name is not null and sport is not null
        and start_date is not null and end_date is not null)),
  constraint season_purchases_review_check check (
    needs_review = (review_reason is not null))
);

create index season_purchases_org_idx on public.season_purchases (org_id, created_at desc);
-- The credit lookup create_league makes.
create index season_purchases_credit_idx on public.season_purchases (org_id, created_at)
  where status = 'credited' and league_id is null;

alter table public.season_purchases enable row level security;

-- Members read their own league's purchases (the success page, a future
-- purchase history). Nobody writes from the browser: every write is one of
-- the SECURITY DEFINER functions below.
create policy "Org members can read season purchases"
  on public.season_purchases
  for select
  to authenticated
  using (public.is_org_member(org_id));

revoke all on table public.season_purchases from public, anon, authenticated, service_role, dashboard_readonly;
grant select on table public.season_purchases to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. begin_season_purchase
-- ────────────────────────────────────────────────────────────────────────────
-- Order: signed in → member → profile read (comped refuses here) → active
-- count → kind allowed for that state → tier derived → season fields
-- validated → pending row. Returns {purchase_id, kind, tier, upgrade_only}
-- or {error: …}; nothing is written on an error.
create or replace function public.begin_season_purchase(
  p_org_id       uuid,
  p_kind         text,
  p_tier         text default null,
  p_name         text default null,
  p_sport        text default null,
  p_season_label text default null,
  p_start_date   date default null,
  p_end_date     date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan    text;
  v_comped  boolean;
  v_active  int;
  v_allowed text;
  v_tier    text;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_sport   text := nullif(btrim(coalesce(p_sport, '')), '');
  v_label   text := nullif(btrim(coalesce(p_season_label, '')), '');
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  select plan, comped into v_plan, v_comped
    from public.profiles
   where id = p_org_id;
  if not found then
    raise exception 'org_not_found' using errcode = 'P0001';
  end if;

  -- Comped leagues are never charged. FieldSlate adds their seasons.
  if v_comped then
    return jsonb_build_object('error', 'billing_managed');
  end if;

  select count(*) into v_active
    from public.leagues
   where owner_id = p_org_id
     and archived_at is null;

  -- What this league may buy right now. One answer per state.
  v_allowed := case
    when v_plan = 'free' and v_active >= 1 then 'convert_free'
    when v_active >= 1                     then 'add_season'
    else                                        'first_season'
  end;

  if p_kind = 'upgrade_tier' then
    if v_plan <> 'pro' then
      return jsonb_build_object('error', 'kind_not_allowed', 'allowed', v_allowed, 'plan', v_plan);
    end if;
    v_tier := 'elite';
  elsif p_kind = 'signup' then
    -- A paid signup's checkout: nothing to create yet, so it becomes a credit.
    if v_plan <> 'free' or v_active <> 0 then
      return jsonb_build_object('error', 'kind_not_allowed', 'allowed', v_allowed, 'plan', v_plan);
    end if;
    v_tier := p_tier;
  elsif p_kind is distinct from v_allowed then
    return jsonb_build_object('error', 'kind_not_allowed', 'allowed', v_allowed, 'plan', v_plan);
  elsif p_kind = 'add_season' then
    -- The league's current tier, whatever the request said.
    v_tier := v_plan;
  else
    -- first_season and convert_free: the one place a tier is chosen.
    v_tier := p_tier;
  end if;

  if v_tier is null or v_tier not in ('pro', 'elite') then
    return jsonb_build_object('error', 'tier_required');
  end if;

  if p_kind in ('add_season', 'first_season') then
    if v_name is null or char_length(v_name) > 120 then
      return jsonb_build_object('error', 'invalid_season', 'field', 'name');
    end if;
    if v_sport is null or char_length(v_sport) > 40 then
      return jsonb_build_object('error', 'invalid_season', 'field', 'sport');
    end if;
    if v_label is not null and char_length(v_label) > 60 then
      return jsonb_build_object('error', 'invalid_season', 'field', 'season_label');
    end if;
    if p_start_date is null or p_end_date is null then
      return jsonb_build_object('error', 'invalid_season', 'field', 'dates');
    end if;
    if p_end_date < p_start_date then
      return jsonb_build_object('error', 'invalid_season', 'field', 'end_before_start');
    end if;
  else
    -- Only season-creating kinds carry season fields.
    v_name := null; v_sport := null; v_label := null;
    p_start_date := null; p_end_date := null;
  end if;

  insert into public.season_purchases (
    org_id, kind, tier, plan_at_checkout, name, sport, season_label,
    start_date, end_date, created_by
  ) values (
    p_org_id, p_kind, v_tier, v_plan, v_name, v_sport, v_label,
    p_start_date, p_end_date, auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object(
    'purchase_id',  v_id,
    'kind',         p_kind,
    'tier',         v_tier,
    'upgrade_only', p_kind = 'upgrade_tier'
  );
end;
$$;

revoke execute on function public.begin_season_purchase(uuid, text, text, text, text, text, date, date)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.begin_season_purchase(uuid, text, text, text, text, text, date, date)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. attach_purchase_session
-- ────────────────────────────────────────────────────────────────────────────
-- After Stripe answers: the session id (p_session_id set), or abandoned
-- (p_session_id null — Stripe failed, nothing will ever be paid). Only a
-- pending purchase of a league the caller belongs to; one counted UPDATE.
create or replace function public.attach_purchase_session(
  p_purchase_id uuid,
  p_session_id  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select org_id into v_org
    from public.season_purchases
   where id = p_purchase_id
   for update;
  if not found then
    raise exception 'purchase_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_org) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  update public.season_purchases
     set stripe_session_id = p_session_id,
         status = case when p_session_id is null then 'abandoned' else status end
   where id = p_purchase_id
     and status = 'pending'
     and stripe_session_id is null;
  if not found then
    raise exception 'purchase_not_pending' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.attach_purchase_session(uuid, text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.attach_purchase_session(uuid, text)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. process_checkout_event
-- ────────────────────────────────────────────────────────────────────────────
-- The old signature returned text and had no purchase id. Dropped and
-- re-created: CREATE OR REPLACE cannot change a return type.
drop function public.process_checkout_event(text, uuid, text, int, boolean);

create function public.process_checkout_event(
  p_event_id     text,
  p_org_id       uuid,
  p_plan         text,
  p_quantity     int,
  p_upgrade_only boolean,
  p_purchase_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted   int;
  v_was_paid   boolean;
  v_seed       public.leagues%rowtype;
  v_has_seed   boolean := false;
  v_cur_plan   text;
  v_purchase   public.season_purchases%rowtype;
  v_active     int;
  v_reason     text;
  v_league     uuid;
  v_outcome    text;
  v_credit     uuid;
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
    return jsonb_build_object('result', 'skipped_duplicate');
  end if;

  -- ══ LEGACY: no purchase id (sessions created before 0111) ═══════════════
  -- The 0071 body, unchanged, then one addition (marked). Remove this whole
  -- branch once no pre-0111 checkout session can still be paid.
  if p_purchase_id is null then
    -- ── Pre-update plan → wasPaid ─────────────────────────────────────────
    -- Read AFTER the claim and INSIDE the txn: a retry never reaches this line
    -- (it returned early above), so wasPaid can never be corrupted by
    -- retry-ordering.
    select (plan in ('pro', 'elite')) into v_was_paid
      from public.profiles
     where id = p_org_id;
    v_was_paid := coalesce(v_was_paid, false);

    -- ── Apply tier + clear onboarding pending_plan / pending_promo ────────
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

    -- ── Branch logic ──────────────────────────────────────────────────────
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

    -- ── ADDED BY 0111 ─────────────────────────────────────────────────────
    -- A paid signup with no season to convert: before 0111 its first season
    -- came free from create_league, which now needs a credit.
    elsif p_quantity = 1 and not v_was_paid and not v_has_seed then
      insert into public.season_purchases (
        org_id, kind, tier, plan_at_checkout, status, stripe_event_id, completed_at
      ) values (
        p_org_id, 'signup', p_plan, 'free', 'credited', p_event_id, now()
      );
    end if;
    -- Otherwise (qty 1 and NOT wasPaid — the Free→paid feature upgrade — or any
    -- stray non-1 quantity): plan update only. The org's existing single season
    -- becomes the paid season in place; no new row is provisioned.

    return jsonb_build_object('result', 'processed', 'outcome', 'legacy');
  end if;

  -- ══ WITH A PURCHASE ═════════════════════════════════════════════════════
  select plan into v_cur_plan
    from public.profiles
   where id = p_org_id
   for update;
  v_cur_plan := coalesce(v_cur_plan, 'free');

  select * into v_purchase
    from public.season_purchases
   where id = p_purchase_id
   for update;

  -- Anything that does not match the purchase exactly: the money becomes a
  -- credit on the paying league, the plan is never lowered, and the row is
  -- flagged for a person to look at. EXCEPT a $100 tier-upgrade payment: it
  -- is not a season's price, so it becomes no credit and changes no plan
  -- (from Free it would be Elite for $100) — flagged only, for a refund or a
  -- hand fix.
  v_reason := case
    when v_purchase.id is null                then 'purchase_not_found'
    when v_purchase.org_id <> p_org_id        then 'purchase_belongs_to_another_league'
    when v_purchase.status <> 'pending'       then 'purchase_not_pending:' || v_purchase.status
    when v_purchase.tier <> p_plan            then 'tier_mismatch:' || v_purchase.tier || '<>' || p_plan
    when p_upgrade_only <> (v_purchase.kind = 'upgrade_tier') then 'upgrade_flag_mismatch'
    when p_quantity <> 1                      then 'quantity_not_one'
  end;

  if v_reason is not null then
    insert into public.season_purchases (
      org_id, kind, tier, plan_at_checkout, status, needs_review, review_reason,
      stripe_event_id, completed_at
    ) values (
      p_org_id, 'unmatched', p_plan, v_cur_plan,
      case when p_upgrade_only then 'completed' else 'credited' end,
      true, v_reason, p_event_id, now()
    )
    returning id into v_credit;

    update public.profiles
       set plan = case when p_upgrade_only then v_cur_plan
                       when p_plan = 'elite' or v_cur_plan = 'elite' then 'elite'
                       else p_plan end,
           pending_plan = null,
           pending_promo = null
     where id = p_org_id;

    return jsonb_build_object(
      'result', 'processed',
      'outcome', case when p_upgrade_only then 'flagged' else 'credited' end,
      'purchase_id', v_credit,
      'kind', 'unmatched', 'needs_review', true, 'review_reason', v_reason);
  end if;

  select count(*) into v_active
    from public.leagues
   where owner_id = p_org_id
     and archived_at is null;

  v_outcome := null;

  if v_purchase.kind = 'add_season' then
    -- A season at the tier paid for; the plan is never lowered. If the plan
    -- moved since checkout, a person checks the price paid.
    if v_cur_plan <> v_purchase.plan_at_checkout then
      v_reason := 'plan_changed:' || v_purchase.plan_at_checkout || '->' || v_cur_plan;
    end if;
    v_outcome := 'season_created';

  elsif v_purchase.kind = 'first_season' then
    if v_active = 0 then
      -- The deliberate tier choice, including a downgrade.
      update public.profiles set plan = v_purchase.tier where id = p_org_id;
    else
      -- A season became active since checkout: create the paid season, but
      -- a downgrade now would change seasons nobody chose to change.
      if v_purchase.tier = 'elite' then
        update public.profiles set plan = 'elite' where id = p_org_id;
      end if;
      v_reason := 'season_active_at_payment';
    end if;
    v_outcome := 'season_created';

  elsif v_purchase.kind = 'convert_free' then
    if v_cur_plan = 'free' then
      update public.profiles set plan = v_purchase.tier where id = p_org_id;
      v_outcome := 'converted';
    else
      v_reason := 'already_paid:' || v_cur_plan;
    end if;

  elsif v_purchase.kind = 'upgrade_tier' then
    if v_cur_plan = 'pro' then
      update public.profiles set plan = 'elite' where id = p_org_id;
      v_outcome := 'upgraded';
    else
      -- $100 is not a season's price: no credit, no plan change, flagged.
      v_reason := 'not_on_pro:' || v_cur_plan;
      v_outcome := 'flagged';
    end if;

  elsif v_purchase.kind = 'signup' then
    if v_cur_plan = 'free' or (v_cur_plan = 'pro' and v_purchase.tier = 'elite') then
      update public.profiles set plan = v_purchase.tier where id = p_org_id;
    end if;
    v_outcome := 'credited';
  end if;

  if v_outcome = 'season_created' then
    insert into public.leagues (
      owner_id, name, sport, season, status, start_date, end_date
    ) values (
      p_org_id, v_purchase.name, v_purchase.sport,
      coalesce(v_purchase.season_label, ''), 'active',
      v_purchase.start_date, v_purchase.end_date
    )
    returning id into v_league;
  end if;

  -- A convert_free that no longer fits: the payment is a credit.
  if v_outcome is null then
    v_outcome := 'credited';
  end if;

  update public.season_purchases
     set status          = case when v_outcome = 'credited' then 'credited' else 'completed' end,
         league_id       = v_league,
         needs_review    = (v_reason is not null),
         review_reason   = v_reason,
         stripe_event_id = p_event_id,
         completed_at    = now()
   where id = p_purchase_id
     and status = 'pending';
  if not found then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  update public.profiles
     set pending_plan = null,
         pending_promo = null
   where id = p_org_id;

  return jsonb_build_object(
    'result', 'processed', 'outcome', v_outcome, 'purchase_id', p_purchase_id,
    'kind', v_purchase.kind, 'league_id', v_league,
    'needs_review', v_reason is not null, 'review_reason', v_reason);
end;
$$;

revoke execute on function public.process_checkout_event(text, uuid, text, int, boolean, uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.process_checkout_event(text, uuid, text, int, boolean, uuid)
  to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. create_league
-- ────────────────────────────────────────────────────────────────────────────
-- Free: one active season at a time, as in 0059. Paid (pro/elite, comped
-- included): every season is paid for, so a create uses up one credit — the
-- oldest unused one. Without a credit the reply keeps 0059's cap_reached
-- shape and adds reason 'purchase_required'.
create or replace function public.create_league(
  p_org_id     uuid,
  p_name       text,
  p_sport      text,
  p_season     text,
  p_start_date date,
  p_end_date   date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_plan     text;
  v_count    int;
  v_credit   uuid;
  v_row      public.leagues%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.leagues
   where owner_id    = p_org_id
     and archived_at is null;

  v_plan := coalesce(
    (select plan from public.profiles where id = p_org_id),
    'free'
  );

  if v_plan = 'free' then
    -- Free: one active season at a time (0059).
    if v_count >= 1 then
      return jsonb_build_object(
        'error', 'cap_reached',
        'cap',   'activeSeasons',
        'limit', 1,
        'plan',  v_plan
      );
    end if;
  else
    -- Paid: a season must be paid for. Oldest unused credit first; SKIP
    -- LOCKED so two creates at once never take the same credit.
    select id into v_credit
      from public.season_purchases
     where org_id = p_org_id
       and status = 'credited'
       and league_id is null
     order by created_at asc
     limit 1
     for update skip locked;
    if v_credit is null then
      return jsonb_build_object(
        'error',  'cap_reached',
        'cap',    'activeSeasons',
        'limit',  1,
        'plan',   v_plan,
        'reason', 'purchase_required'
      );
    end if;
  end if;

  insert into public.leagues (
    name, sport, season, status, owner_id, start_date, end_date
  ) values (
    p_name, p_sport, p_season, 'active', p_org_id, p_start_date, p_end_date
  )
  returning * into v_row;

  if v_credit is not null then
    update public.season_purchases
       set league_id      = v_row.id,
           credit_used_at = now()
     where id = v_credit
       and league_id is null;
    if not found then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

revoke execute on function public.create_league(uuid, text, text, text, date, date)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.create_league(uuid, text, text, text, date, date)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Verify — RAISES if anything is not exactly as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_role  text;
  v_fn    text;
begin
  foreach v_fn in array array[
    'public.begin_season_purchase(uuid, text, text, text, text, text, date, date)',
    'public.attach_purchase_session(uuid, text)',
    'public.create_league(uuid, text, text, text, date, date)']
  loop
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      v_wrong := v_wrong || format(' [authenticated cannot execute %s]', v_fn);
    end if;
    foreach v_role in array array['public', 'anon', 'service_role', 'dashboard_readonly']
    loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        v_wrong := v_wrong || format(' [%s can execute %s]', v_role, v_fn);
      end if;
    end loop;
  end loop;

  v_fn := 'public.process_checkout_event(text, uuid, text, integer, boolean, uuid)';
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    v_wrong := v_wrong || ' [service_role cannot execute process_checkout_event]';
  end if;
  foreach v_role in array array['public', 'anon', 'authenticated', 'dashboard_readonly']
  loop
    if has_function_privilege(v_role, v_fn, 'EXECUTE') then
      v_wrong := v_wrong || format(' [%s can execute process_checkout_event]', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_proc where proname = 'process_checkout_event' and pronargs = 5) then
    v_wrong := v_wrong || ' [the old 5-argument process_checkout_event still exists]';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly']
  loop
    if has_table_privilege(v_role, 'public.season_purchases', 'INSERT')
       or has_table_privilege(v_role, 'public.season_purchases', 'UPDATE')
       or has_table_privilege(v_role, 'public.season_purchases', 'DELETE') then
      v_wrong := v_wrong || format(' [%s can write season_purchases]', v_role);
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.season_purchases', 'SELECT') then
    v_wrong := v_wrong || ' [authenticated cannot read season_purchases]';
  end if;
  foreach v_role in array array['anon', 'service_role', 'dashboard_readonly']
  loop
    if has_table_privilege(v_role, 'public.season_purchases', 'SELECT') then
      v_wrong := v_wrong || format(' [%s can read season_purchases]', v_role);
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.season_purchases'::regclass) then
    v_wrong := v_wrong || ' [RLS is off on season_purchases]';
  end if;

  if v_wrong <> '' then
    raise exception '0111 verification failed:%', v_wrong;
  end if;
end;
$$;
