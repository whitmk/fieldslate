-- SQL-level proof for migration 0111 (season purchases, season credits,
-- process_checkout_event with a purchase id, create_league needing a credit).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the rules are
-- SECURITY DEFINER functions, a table under RLS and per-role grants. The
-- in-memory fake client cannot model any of that. NOT `npm run`-able, NOT in CI.
--
-- THIS HARNESS APPLIES 0111 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK. It is the proof to run BEFORE the migration is applied for real. It
-- leaves nothing behind: no table, no function change, no grant, no row.
--
-- HOW TO RUN
--   1. `npx tsx scripts/sim/season-purchase-build.ts > <file>` substitutes the
--      LITERAL text of supabase/migrations/0111_season_purchases.sql, and the
--      LITERAL 0071 body of process_checkout_event (the legacy twin), for the
--      two placeholder lines below.
--   2. Send the whole output as ONE batch through the Supabase MCP
--      (execute_sql) — one batch is one transaction.
--   3. The last statement ALWAYS raises. The raised message IS the result.
--   Get an explicit go-ahead first.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: a few seconds)
--   SHARE ROW EXCLUSIVE on public.profiles and public.leagues, from CREATE
--   TABLE season_purchases (its foreign keys) — BLOCKS WRITES to both from
--   the live app (season renames, archive, auto-archive, plan changes,
--   signups, create_league, a checkout), not reads. ACCESS EXCLUSIVE on the
--   process_checkout_event and create_league functions (a Stripe webhook
--   arriving mid-run waits; the run is seconds, Stripe retries anyway).
--   Row locks on the "test" org's profiles row and seasons.
--   lock_timeout = 3s, statement_timeout = 60s.
--
-- ROWS TOUCHED (all rolled back): the "test" org (owner bbf9afe1…, NOT the
-- real league) — its profiles plan/comped/pending_*, its one active season
-- (archived and restored by blocks), seasons the functions create, its
-- season_purchases rows, stripe_events claims 'H111-…'. The "Test 2" org's
-- owner is the NON-member caller; one season_purchases row is inserted for
-- the Test 2 org (the purchase-of-another-league case). Nothing in the real
-- league is read or written.
--
-- IMPERSONATION: `set local role authenticated` plus request.jwt.claims, the
-- way PostgREST does it; the webhook's calls run as service_role. Assertions
-- are read back as postgres.
--
-- ASSERTIONS (in evaluation order — mutant targets depend on it)
--   H0        BEFORE 0111: an Elite league with every season archived
--             creates a new season FREE through create_league (the hole)
--   B-*       begin_season_purchase: comped refused (billing_managed);
--             add_season takes the league's tier, not the request's;
--             first_season refused while a season is active; first_season
--             with nothing active takes the chosen tier (a downgrade too);
--             tier required; convert_free only for Free with a season
--             active; upgrade_tier only from Pro; signup only Free with
--             nothing active; invalid name / end before start refused with
--             no row; non-member and anon refused
--   A-*       attach_purchase_session: session recorded once; a second
--             attach refused; non-member refused; null → abandoned
--   P-*       process_checkout_event with a purchase:
--             P-add            season created from the row; plan unchanged
--             P-add-race       paid at Pro, league now Elite: season
--                              created, plan NOT lowered, flagged
--             P-first-zero     nothing active, Elite league buys Pro: plan
--                              Pro, season created FROM THE PENDING ROW
--             P-first-race     a season became active before payment: season
--                              created, plan NOT lowered, flagged
--             P-convert        Free → Elite in place, no new season
--             P-convert-stale  already paid: credit, flagged
--             P-upgrade        Pro → Elite
--             P-upgrade-stale  not on Pro any more: NO credit, plan
--                              unchanged, flagged
--             P-signup         Free signup: plan raised, a credit, pending_*
--                              cleared
--             P-unmatched      unknown purchase: credit, plan not lowered,
--                              flagged
--             P-unmatched-upgrade  unknown $100 upgrade: no credit, plan
--                              unchanged, flagged
--             P-notpending     a purchase paid twice: second → credit,
--                              flagged; one season only
--             P-orgmismatch    another league's purchase: credit here,
--                              theirs untouched, flagged
--             P-tier-mismatch  wrong tier in metadata: credit, flagged,
--                              purchase still pending
--             P-dup            the same event twice: skipped, one season
--   L-*       legacy (no purchase id) == the 0071 body, on twin fixtures:
--             L-pin (the twin is the real 0071 body, md5 fb3b7eb4…), L1 paid
--             add, L2 Free convert, L3 upgradeOnly, L4 quantity 2, L5 paid
--             signup with no season — same profiles and seasons, and
--             L5-credit: the new branch also leaves one credit
--   C-*       create_league: Free creates with nothing active; Free capped;
--             paid without a credit → cap_reached + purchase_required (with a
--             season active AND with none — the archive-everything hole);
--             C-comped: a comped league creates freely, with a season active
--             and with none, and no credit is touched; paid with a credit
--             creates and uses it up, the next create needs another
--   BF1       the backfill: every paid, non-comped league with no season at
--             all holds exactly one unused credit (counter: leagues checked)
--   R-*       RLS: members read their own league's purchases, not another's;
--             no browser write
--   G-*/S-*   EXECUTE per role on all four functions; table grants; RLS on;
--             DEFINER + search_path
--
-- MUTANTS — each in its own rolled-back block. A body rewrite is asserted to
-- have changed the text (MUTANT_NOOP otherwise). KILLED only if the FIRST
-- failure is the mutant's own tag.
--   MU1  begin: comped check removed                        → B-comped
--   MU2  begin: add_season takes the requested tier         → B-add
--   MU3  begin: kind-for-state check removed                → B-add-wrong
--   MU4  process: add_season sets plan to the purchase tier → P-add-race
--   MU5  process: first_season ignores an active season     → P-first-race
--   MU6  process: first_season creates no season            → P-first-zero
--   MU7  process: an unmatched payment is dropped           → P-unmatched
--   MU8  process: purchase-org check removed                → P-orgmismatch
--   MU9  process: pending check removed                     → P-notpending
--   MU10 process: tier check removed                        → P-tier-mismatch
--   MU11 legacy: a Free convert provisions a season         → L2
--   MU12 create_league: the credit is not used up           → C-paid-credit
--   MU13 create_league: a paid league creates without one   → C-paid-none
--   MU14 process EXECUTE granted to authenticated           → G-process
--   MU15 RLS policy reads every league's purchases          → R-other
--   MU16 process: convert_free also creates a season        → P-convert
--   MU17 process: a stale $100 upgrade becomes a credit     → P-upgrade-stale
--   MU18 process: an unmatched $100 upgrade raises the plan → P-unmatched-upgrade
--   MU19 legacy: the paid-signup credit removed             → L5-credit
--   MU20 create_league: the comped bypass removed           → C-comped
--   MU21 the backfill's credits missing (deleted)           → BF1
--
-- NOT EXERCISED, stated: two create_league calls racing for one credit (FOR
-- UPDATE SKIP LOCKED needs two sessions; one batch is one session); the
-- webhook route and its email (TypeScript, sim:stripe-webhook in step 2).
--
-- RUN LOG
--   RUN 1 (2026-10-14) — refused at compile, nothing ran: h111_assert declares
--     a season_purchases%rowtype before the migration creates the table.
--     FIX: check_function_bodies off for the batch (first statement).
--   RUN 2 (2026-10-14, against production, rolled back; no other backend
--     checked busy) — baseline GREEN, zero failures, no zero counter:
--     H0   the hole was real: an Elite league with every season archived got
--          a new season free from create_league (OK {"row": …})
--     purchases_begun 5 · refused 13 · seasons_created 4 · credits 4 ·
--     flagged 6 · legacy_twins_equal 5 (L1–L5 identical to the 0071 body)
--     MU1–MU19 → all KILLED at their own tag, first try
--     AFTER MUTANTS: zero failures. Leak check clean: no season_purchases
--     table, no new functions, process_checkout_event still the 5-argument
--     0071 body (md5 fb3b7eb4…), create_league unchanged (78b70490…), no
--     H111 seasons or events, test/Test 2 profiles back to elite/comped.
--   RUN 3 (2026-10-14, at review) — 0111 changed: comped leagues create
--     freely in create_league (C-comped, MU20); 'comp' credits dropped; a
--     one-time backfill credits every paid, non-comped league with no season
--     (BF1, MU21 — it found exactly one league, the paying Pro league, which
--     paid at signup and would otherwise have been refused its first season).
--     The run now prints each created function's md5, so the hand-sent batch
--     is proven to be the repo file: all four matched (attach 97bc5d48…,
--     begin 3b92e7bc…, create_league 91749851…, process 87fbb719…).
--     Baseline GREEN, zero failures, no zero counter (seasons_created 5,
--     backfilled_leagues 1, the rest as run 2). MU1–MU21 → all KILLED at
--     their own tag. AFTER MUTANTS: zero failures. Leak check clean, as run 2,
--     plus the Pro league untouched (no seasons, no credit).

-- check_function_bodies off (transaction-local): the assertion function
-- names season_purchases, which the migration creates later in this batch.
select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true),
       set_config('check_function_bodies', 'off', true);

-- Runs one statement as a role and reports what happened; always returns to
-- postgres. With p_into, the statement's single value is reported.
create function pg_temp.h111_try(p_role text, p_uid uuid, p_sql text, p_into boolean default false)
returns text
language plpgsql
as $fn$
declare
  v_n   integer;
  v_val text;
  v_out text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', p_role)::text end,
    true
  );
  execute format('set local role %I', p_role);
  begin
    if p_into then
      execute p_sql into v_val;
      v_out := 'OK ' || coalesce(v_val, 'null');
    else
      execute p_sql;
      get diagnostics v_n = row_count;
      v_out := 'OK rows=' || v_n;
    end if;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

-- 'OK {json}' → jsonb; anything else → null.
create function pg_temp.h111_json(p text)
returns jsonb
language sql
as $fn$
  select case when left(p, 4) = 'OK {' then substr(p, 4)::jsonb end;
$fn$;

-- Sets the test org's state. p_active: the one active season active, or
-- every season archived.
create function pg_temp.h111_state(p_uid uuid, p_active_id uuid, p_plan text, p_comped boolean, p_active boolean)
returns void
language plpgsql
as $fn$
begin
  update public.profiles
     set plan = p_plan, comped = p_comped, pending_plan = null, pending_promo = null
   where id = p_uid;
  if p_active then
    update public.leagues set archived_at = null, status = 'active' where id = p_active_id;
  else
    update public.leagues set archived_at = now(), status = 'archived'
     where owner_id = p_uid and archived_at is null;
  end if;
end;
$fn$;

-- begin_season_purchase as a signed-in caller.
create function pg_temp.h111_begin(p_caller uuid, p_org uuid, p_kind text, p_tier text,
  p_name text default 'H111 Spring', p_start date default '2027-04-03', p_end date default '2027-05-22')
returns text
language sql
as $fn$
  select pg_temp.h111_try('authenticated', p_caller, format(
    'select public.begin_season_purchase(%L::uuid, %L, %L, %L, %L, %L, %L::date, %L::date)::text',
    p_org, p_kind, p_tier, p_name, 'Baseball', 'Spring 2027', p_start, p_end), true);
$fn$;

-- process_checkout_event as the webhook (service_role).
create function pg_temp.h111_process(p_org uuid, p_plan text, p_qty int, p_upgrade boolean,
  p_purchase uuid, p_event text default null)
returns text
language sql
as $fn$
  select pg_temp.h111_try('service_role', null, format(
    'select public.process_checkout_event(%L, %L::uuid, %L, %s, %L, %L::uuid)::text',
    coalesce(p_event, 'H111-' || gen_random_uuid()), p_org, p_plan, p_qty, p_upgrade, p_purchase), true);
$fn$;

-- The legacy call shape: five named arguments, exactly what the pre-0111
-- webhook sends.
create function pg_temp.h111_process_legacy(p_org uuid, p_plan text, p_qty int, p_upgrade boolean)
returns text
language sql
as $fn$
  select pg_temp.h111_try('service_role', null, format(
    'select public.process_checkout_event(p_event_id => %L, p_org_id => %L::uuid, p_plan => %L, p_quantity => %s, p_upgrade_only => %L)::text',
    'H111-' || gen_random_uuid(), p_org, p_plan, p_qty, p_upgrade), true);
$fn$;

-- What a twin comparison compares: the org's plan fields and its seasons,
-- with ids and timestamps left out.
create function pg_temp.h111_snap(p_uid uuid)
returns jsonb
language sql
as $fn$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('plan', plan, 'pending_plan', pending_plan, 'pending_promo', pending_promo)
                  from public.profiles where id = p_uid),
    'seasons', (select coalesce(jsonb_agg(jsonb_build_object(
                  'name', name, 'sport', sport, 'season', season, 'status', status,
                  'archived', archived_at is not null, 'start', start_date, 'end', end_date)
                  order by name, sport, season, status, archived_at is not null), '[]'::jsonb)
                  from public.leagues where owner_id = p_uid));
$fn$;

-- THE 0071 BODY, verbatim from the repo file (substituted by the build
-- script). md5(prosrc) is pinned below to the live pre-0111 function.
create function pg_temp.old_pce(p_event_id text, p_org_id uuid, p_plan text, p_quantity int, p_upgrade_only boolean)
returns text
language plpgsql
as $oldpce$
-- @@OLD_PCE_BODY_0071@@
$oldpce$;

-- The whole assertion set. Returns { fails: [...in order...], counters: {} }.
create function pg_temp.h111_assert(p_uid uuid, p_other uuid, p_active uuid)
returns jsonb
language plpgsql
as $fn$
declare
  v_fails    text[] := array[]::text[];
  v_begin    integer := 0;
  v_refused  integer := 0;
  v_seasons  integer := 0;
  v_credits  integer := 0;
  v_flagged  integer := 0;
  v_twins    integer := 0;
  v_backfill integer := 0;
  v_res      text;
  v_j        jsonb;
  v_pid      uuid;
  v_pid2     uuid;
  v_n        integer;
  v_n2       integer;
  v_row      public.season_purchases%rowtype;
  v_lg       public.leagues%rowtype;
  v_plan     text;
  v_old      jsonb;
  v_new      jsonb;
  v_evt      text;
  v_role     text;
  v_fn       text;
  t          record;
begin
  -- ══ B: begin_season_purchase ═══════════════════════════════════════════
  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', true, true);
    select count(*) into v_n from public.season_purchases;
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'add_season', null);
    select count(*) into v_n2 from public.season_purchases;
    if pg_temp.h111_json(v_res) is distinct from '{"error": "billing_managed"}'::jsonb or v_n2 <> v_n then
      v_fails := array_append(v_fails, 'B-comped: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-B-comped: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'add_season', 'pro', '  H111 Spring  ');
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = (v_j ->> 'purchase_id')::uuid;
    if v_j ->> 'tier' is distinct from 'elite' or v_j ->> 'kind' is distinct from 'add_season'
       or v_row.status is distinct from 'pending' or v_row.plan_at_checkout is distinct from 'elite'
       or v_row.name is distinct from 'H111 Spring' or v_row.tier is distinct from 'elite'
       or (v_j ->> 'upgrade_only')::boolean then
      v_fails := array_append(v_fails, 'B-add: ' || v_res);
    else v_begin := v_begin + 1; end if;

    select count(*) into v_n from public.season_purchases;
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'first_season', 'pro');
    select count(*) into v_n2 from public.season_purchases;
    if pg_temp.h111_json(v_res) ->> 'error' is distinct from 'kind_not_allowed'
       or pg_temp.h111_json(v_res) ->> 'allowed' is distinct from 'add_season' or v_n2 <> v_n then
      v_fails := array_append(v_fails, 'B-add-wrong: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-B-add: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, false);
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'first_season', 'pro');
    v_j := pg_temp.h111_json(v_res);
    if v_j ->> 'tier' is distinct from 'pro' or v_j ->> 'kind' is distinct from 'first_season' then
      v_fails := array_append(v_fails, 'B-first: ' || v_res);
    else v_begin := v_begin + 1; end if;

    v_res := pg_temp.h111_begin(p_uid, p_uid, 'first_season', null);
    if pg_temp.h111_json(v_res) is distinct from '{"error": "tier_required"}'::jsonb then
      v_fails := array_append(v_fails, 'B-first-notier: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-B-first: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, true);
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'convert_free', 'elite');
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = (v_j ->> 'purchase_id')::uuid;
    if v_j ->> 'tier' is distinct from 'elite' or v_row.name is not null then
      v_fails := array_append(v_fails, 'B-convert: ' || v_res);
    else v_begin := v_begin + 1; end if;
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'add_season', 'pro');
    if pg_temp.h111_json(v_res) ->> 'allowed' is distinct from 'convert_free' then
      v_fails := array_append(v_fails, 'B-convert-only: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-B-convert: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'pro', false, true);
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'upgrade_tier', 'pro');
    v_j := pg_temp.h111_json(v_res);
    if v_j ->> 'tier' is distinct from 'elite' or not coalesce((v_j ->> 'upgrade_only')::boolean, false) then
      v_fails := array_append(v_fails, 'B-upgrade: ' || v_res);
    else v_begin := v_begin + 1; end if;
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'upgrade_tier', 'elite');
    if pg_temp.h111_json(v_res) ->> 'error' is distinct from 'kind_not_allowed' then
      v_fails := array_append(v_fails, 'B-upgrade-elite: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-B-upgrade: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, false);
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'signup', 'pro');
    if pg_temp.h111_json(v_res) ->> 'tier' is distinct from 'pro' then
      v_fails := array_append(v_fails, 'B-signup: ' || v_res);
    else v_begin := v_begin + 1; end if;
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, true);
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'signup', 'pro');
    if pg_temp.h111_json(v_res) ->> 'error' is distinct from 'kind_not_allowed' then
      v_fails := array_append(v_fails, 'B-signup-active: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-B-signup: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    select count(*) into v_n from public.season_purchases;
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'add_season', null, '   ');
    if pg_temp.h111_json(v_res) is distinct from '{"error": "invalid_season", "field": "name"}'::jsonb then
      v_fails := array_append(v_fails, 'B-invalid-name: ' || v_res);
    else v_refused := v_refused + 1; end if;
    v_res := pg_temp.h111_begin(p_uid, p_uid, 'add_season', null, 'H111 Spring', '2027-05-22', '2027-04-03');
    select count(*) into v_n2 from public.season_purchases;
    if pg_temp.h111_json(v_res) is distinct from '{"error": "invalid_season", "field": "end_before_start"}'::jsonb
       or v_n2 <> v_n then
      v_fails := array_append(v_fails, 'B-invalid-dates: ' || v_res);
    else v_refused := v_refused + 1; end if;

    v_res := pg_temp.h111_begin(p_other, p_uid, 'add_season', null);
    if v_res not like 'ERR P0001 not_org_member%' then
      v_fails := array_append(v_fails, 'B-nonmember: ' || v_res);
    else v_refused := v_refused + 1; end if;

    v_res := pg_temp.h111_try('anon', null, format(
      'select public.begin_season_purchase(%L::uuid, %L)::text', p_uid, 'add_season'), true);
    if v_res not like 'ERR 42501 permission denied%' then
      v_fails := array_append(v_fails, 'B-anon: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-B-invalid: ' || sqlerrm); end if;
  end;

  -- ══ A: attach_purchase_session ═════════════════════════════════════════
  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'add_season', null)) ->> 'purchase_id')::uuid;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.attach_purchase_session(%L::uuid, %L)::text', v_pid, 'cs_h111_a'), true);
    select * into v_row from public.season_purchases where id = v_pid;
    if v_res <> 'OK {"ok": true}' or v_row.stripe_session_id is distinct from 'cs_h111_a' or v_row.status <> 'pending' then
      v_fails := array_append(v_fails, 'A-attach: ' || v_res);
    end if;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.attach_purchase_session(%L::uuid, %L)::text', v_pid, 'cs_h111_b'), true);
    if v_res not like 'ERR P0001 purchase_not_pending%' then
      v_fails := array_append(v_fails, 'A-twice: ' || v_res);
    end if;
    v_res := pg_temp.h111_try('authenticated', p_other, format(
      'select public.attach_purchase_session(%L::uuid, %L)::text', v_pid, 'cs_h111_c'), true);
    if v_res not like 'ERR P0001 not_org_member%' then
      v_fails := array_append(v_fails, 'A-nonmember: ' || v_res);
    end if;
    v_pid2 := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'add_season', null)) ->> 'purchase_id')::uuid;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.attach_purchase_session(%L::uuid, null)::text', v_pid2), true);
    select * into v_row from public.season_purchases where id = v_pid2;
    if v_res <> 'OK {"ok": true}' or v_row.status <> 'abandoned' then
      v_fails := array_append(v_fails, 'A-abandon: ' || v_res);
    end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-A: ' || sqlerrm); end if;
  end;

  -- ══ P: process_checkout_event with a purchase ═════════════════════════
  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'add_season', null)) ->> 'purchase_id')::uuid;
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, false, v_pid);
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = v_pid;
    select * into v_lg from public.leagues where id = v_row.league_id;
    select plan into v_plan from public.profiles where id = p_uid;
    if v_j ->> 'outcome' is distinct from 'season_created' or (v_j ->> 'needs_review')::boolean
       or v_row.status <> 'completed' or v_lg.id is null or v_lg.name <> 'H111 Spring'
       or v_lg.sport <> 'Baseball' or v_lg.season <> 'Spring 2027'
       or v_lg.start_date <> '2027-04-03' or v_lg.end_date <> '2027-05-22'
       or v_lg.archived_at is not null or v_lg.owner_id <> p_uid or v_plan <> 'elite' then
      v_fails := array_append(v_fails, 'P-add: ' || v_res);
    else v_seasons := v_seasons + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-add: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'pro', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'add_season', null)) ->> 'purchase_id')::uuid;
    update public.profiles set plan = 'elite' where id = p_uid;
    v_res := pg_temp.h111_process(p_uid, 'pro', 1, false, v_pid);
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = v_pid;
    select plan into v_plan from public.profiles where id = p_uid;
    if v_j ->> 'outcome' is distinct from 'season_created' or v_row.league_id is null
       or v_plan <> 'elite' or not v_row.needs_review
       or v_row.review_reason is distinct from 'plan_changed:pro->elite' then
      v_fails := array_append(v_fails, format('P-add-race: %s (plan %s)', v_res, v_plan));
    else v_flagged := v_flagged + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-add-race: ' || sqlerrm); end if;
  end;

  -- The zero-active purchase builds its season FROM THE PENDING ROW.
  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, false);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'first_season', 'pro',
      'H111 From The Row', '2027-03-01', '2027-06-30')) ->> 'purchase_id')::uuid;
    v_res := pg_temp.h111_process(p_uid, 'pro', 1, false, v_pid);
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = v_pid;
    select * into v_lg from public.leagues where id = v_row.league_id;
    select plan into v_plan from public.profiles where id = p_uid;
    select count(*) into v_n from public.leagues where owner_id = p_uid and archived_at is null;
    if v_j ->> 'outcome' is distinct from 'season_created' or v_lg.id is null
       or v_lg.name <> 'H111 From The Row' or v_lg.start_date <> '2027-03-01' or v_lg.end_date <> '2027-06-30'
       or v_plan <> 'pro' or v_row.needs_review or v_row.status <> 'completed' or v_n <> 1 then
      v_fails := array_append(v_fails, format('P-first-zero: %s (plan %s, active %s)', v_res, v_plan, v_n));
    else v_seasons := v_seasons + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-first-zero: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, false);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'first_season', 'pro')) ->> 'purchase_id')::uuid;
    update public.leagues set archived_at = null, status = 'active' where id = p_active;
    v_res := pg_temp.h111_process(p_uid, 'pro', 1, false, v_pid);
    select * into v_row from public.season_purchases where id = v_pid;
    select plan into v_plan from public.profiles where id = p_uid;
    if v_row.league_id is null or v_plan <> 'elite' or not v_row.needs_review
       or v_row.review_reason is distinct from 'season_active_at_payment' then
      v_fails := array_append(v_fails, format('P-first-race: %s (plan %s)', v_res, v_plan));
    else v_flagged := v_flagged + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-first-race: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, true);
    select count(*) into v_n from public.leagues where owner_id = p_uid;
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'convert_free', 'elite')) ->> 'purchase_id')::uuid;
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, false, v_pid);
    select * into v_row from public.season_purchases where id = v_pid;
    select plan into v_plan from public.profiles where id = p_uid;
    select count(*) into v_n2 from public.leagues where owner_id = p_uid;
    if pg_temp.h111_json(v_res) ->> 'outcome' is distinct from 'converted' or v_plan <> 'elite'
       or v_n2 <> v_n or v_row.status <> 'completed' or v_row.needs_review then
      v_fails := array_append(v_fails, format('P-convert: %s (plan %s, seasons %s→%s)', v_res, v_plan, v_n, v_n2));
    end if;

    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-convert: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'convert_free', 'pro')) ->> 'purchase_id')::uuid;
    update public.profiles set plan = 'pro' where id = p_uid;
    v_res := pg_temp.h111_process(p_uid, 'pro', 1, false, v_pid);
    select * into v_row from public.season_purchases where id = v_pid;
    if pg_temp.h111_json(v_res) ->> 'outcome' is distinct from 'credited' or v_row.status <> 'credited'
       or v_row.league_id is not null or v_row.review_reason is distinct from 'already_paid:pro' then
      v_fails := array_append(v_fails, 'P-convert-stale: ' || v_res);
    else v_credits := v_credits + 1; v_flagged := v_flagged + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-convert-stale: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'pro', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'upgrade_tier', null)) ->> 'purchase_id')::uuid;
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, true, v_pid);
    select * into v_row from public.season_purchases where id = v_pid;
    select plan into v_plan from public.profiles where id = p_uid;
    if pg_temp.h111_json(v_res) ->> 'outcome' is distinct from 'upgraded' or v_plan <> 'elite'
       or v_row.status <> 'completed' or v_row.needs_review then
      v_fails := array_append(v_fails, 'P-upgrade: ' || v_res);
    end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-upgrade: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'pro', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'upgrade_tier', null)) ->> 'purchase_id')::uuid;
    update public.profiles set plan = 'free' where id = p_uid;
    select count(*) into v_n from public.season_purchases where org_id = p_uid and status = 'credited';
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, true, v_pid);
    select * into v_row from public.season_purchases where id = v_pid;
    select plan into v_plan from public.profiles where id = p_uid;
    select count(*) into v_n2 from public.season_purchases where org_id = p_uid and status = 'credited';
    if pg_temp.h111_json(v_res) ->> 'outcome' is distinct from 'flagged' or v_plan <> 'free'
       or v_row.status <> 'completed' or not v_row.needs_review or v_n2 <> v_n then
      v_fails := array_append(v_fails, format('P-upgrade-stale: %s (plan %s, credits %s→%s)', v_res, v_plan, v_n, v_n2));
    else v_flagged := v_flagged + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-upgrade-stale: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, false);
    update public.profiles set pending_plan = 'pro', pending_promo = 'H111PROMO' where id = p_uid;
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'signup', 'pro')) ->> 'purchase_id')::uuid;
    v_res := pg_temp.h111_process(p_uid, 'pro', 1, false, v_pid);
    select * into v_row from public.season_purchases where id = v_pid;
    if pg_temp.h111_json(v_res) ->> 'outcome' is distinct from 'credited' or v_row.status <> 'credited'
       or v_row.league_id is not null or v_row.needs_review
       or not exists (select 1 from public.profiles where id = p_uid and plan = 'pro'
                        and pending_plan is null and pending_promo is null) then
      v_fails := array_append(v_fails, 'P-signup: ' || v_res);
    else v_credits := v_credits + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-signup: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_res := pg_temp.h111_process(p_uid, 'pro', 1, false, gen_random_uuid());
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = (v_j ->> 'purchase_id')::uuid;
    select plan into v_plan from public.profiles where id = p_uid;
    if v_row.id is null or v_row.kind <> 'unmatched' or v_row.status <> 'credited'
       or v_row.review_reason is distinct from 'purchase_not_found' or v_plan <> 'elite' then
      v_fails := array_append(v_fails, format('P-unmatched: %s (plan %s)', v_res, v_plan));
    else v_credits := v_credits + 1; v_flagged := v_flagged + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-unmatched: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, true);
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, true, gen_random_uuid());
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = (v_j ->> 'purchase_id')::uuid;
    select plan into v_plan from public.profiles where id = p_uid;
    if v_row.id is null or v_row.status <> 'completed' or not v_row.needs_review or v_plan <> 'free' then
      v_fails := array_append(v_fails, format('P-unmatched-upgrade: %s (plan %s)', v_res, v_plan));
    else v_flagged := v_flagged + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-unmatched-upgrade: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'add_season', null)) ->> 'purchase_id')::uuid;
    perform pg_temp.h111_process(p_uid, 'elite', 1, false, v_pid);
    select count(*) into v_n from public.leagues where owner_id = p_uid;
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, false, v_pid);
    v_j := pg_temp.h111_json(v_res);
    select count(*) into v_n2 from public.leagues where owner_id = p_uid;
    select * into v_row from public.season_purchases where id = (v_j ->> 'purchase_id')::uuid;
    if v_n2 <> v_n or v_row.id is null or v_row.id = v_pid or v_row.status <> 'credited'
       or v_row.review_reason is distinct from 'purchase_not_pending:completed' then
      v_fails := array_append(v_fails, format('P-notpending: %s (seasons %s→%s)', v_res, v_n, v_n2));
    else v_credits := v_credits + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-notpending: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    insert into public.season_purchases (org_id, kind, tier, plan_at_checkout, name, sport, start_date, end_date)
    values (p_other, 'add_season', 'elite', 'elite', 'H111 Theirs', 'Baseball', '2027-04-03', '2027-05-22')
    returning id into v_pid;
    select count(*) into v_n from public.leagues where owner_id in (p_uid, p_other);
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, false, v_pid);
    v_j := pg_temp.h111_json(v_res);
    select count(*) into v_n2 from public.leagues where owner_id in (p_uid, p_other);
    select * into v_row from public.season_purchases where id = (v_j ->> 'purchase_id')::uuid;
    if v_n2 <> v_n or v_row.org_id is distinct from p_uid or v_row.status <> 'credited'
       or v_row.review_reason is distinct from 'purchase_belongs_to_another_league'
       or not exists (select 1 from public.season_purchases where id = v_pid and status = 'pending') then
      v_fails := array_append(v_fails, format('P-orgmismatch: %s (seasons %s→%s)', v_res, v_n, v_n2));
    end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-orgmismatch: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'add_season', null)) ->> 'purchase_id')::uuid;
    select count(*) into v_n from public.leagues where owner_id = p_uid;
    v_res := pg_temp.h111_process(p_uid, 'pro', 1, false, v_pid);
    v_j := pg_temp.h111_json(v_res);
    select count(*) into v_n2 from public.leagues where owner_id = p_uid;
    select * into v_row from public.season_purchases where id = (v_j ->> 'purchase_id')::uuid;
    select plan into v_plan from public.profiles where id = p_uid;
    if v_n2 <> v_n or v_row.status <> 'credited' or v_row.review_reason is distinct from 'tier_mismatch:elite<>pro'
       or v_plan <> 'elite'
       or not exists (select 1 from public.season_purchases where id = v_pid and status = 'pending') then
      v_fails := array_append(v_fails, format('P-tier-mismatch: %s (seasons %s→%s)', v_res, v_n, v_n2));
    end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-tier-mismatch: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    v_pid := (pg_temp.h111_json(pg_temp.h111_begin(p_uid, p_uid, 'add_season', null)) ->> 'purchase_id')::uuid;
    v_evt := 'H111-dup-' || gen_random_uuid();
    select count(*) into v_n from public.leagues where owner_id = p_uid;
    perform pg_temp.h111_process(p_uid, 'elite', 1, false, v_pid, v_evt);
    v_res := pg_temp.h111_process(p_uid, 'elite', 1, false, v_pid, v_evt);
    select count(*) into v_n2 from public.leagues where owner_id = p_uid;
    if pg_temp.h111_json(v_res) is distinct from '{"result": "skipped_duplicate"}'::jsonb or v_n2 <> v_n + 1 then
      v_fails := array_append(v_fails, format('P-dup: %s (seasons %s→%s)', v_res, v_n, v_n2));
    end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-P-dup: ' || sqlerrm); end if;
  end;

  -- ══ L: legacy branch == the 0071 body, on twin fixtures ═══════════════
  if (select md5(prosrc) from pg_proc
       where proname = 'old_pce' and pronamespace = pg_my_temp_schema()) <> 'fb3b7eb41a8223cdf98fc8b674f4798b' then
    v_fails := array_append(v_fails, 'L-pin: the twin is not the live pre-0111 body');
  end if;

  for t in
    select * from (values
      ('L1', 'elite', true,  'elite', 1, false),
      ('L2', 'free',  true,  'pro',   1, false),
      ('L3', 'pro',   true,  'elite', 1, true),
      ('L4', 'elite', true,  'elite', 2, false),
      ('L5', 'free',  false, 'pro',   1, false)
    ) as x(tag, plan, active, buy, qty, upg)
  loop
    begin
      perform pg_temp.h111_state(p_uid, p_active, t.plan, false, t.active);
      update public.profiles set pending_plan = 'pro', pending_promo = 'H111PROMO' where id = p_uid;
      perform pg_temp.old_pce('H111-old-' || gen_random_uuid(), p_uid, t.buy, t.qty, t.upg);
      v_old := pg_temp.h111_snap(p_uid);
      raise exception 'H111_ROLLBACK';
    exception when others then
      if sqlerrm <> 'H111_ROLLBACK' then v_old := jsonb_build_object('crash', sqlerrm); end if;
    end;
    begin
      perform pg_temp.h111_state(p_uid, p_active, t.plan, false, t.active);
      update public.profiles set pending_plan = 'pro', pending_promo = 'H111PROMO' where id = p_uid;
      select count(*) into v_n from public.season_purchases where org_id = p_uid;
      v_res := pg_temp.h111_process_legacy(p_uid, t.buy, t.qty, t.upg);
      v_new := pg_temp.h111_snap(p_uid);
      select count(*) into v_n2 from public.season_purchases
       where org_id = p_uid and kind = 'signup' and status = 'credited' and league_id is null;
      if t.tag = 'L5' then
        v_new := v_new || jsonb_build_object('h111_credits', v_n2 - v_n);
      end if;
      raise exception 'H111_ROLLBACK';
    exception when others then
      if sqlerrm <> 'H111_ROLLBACK' then v_new := jsonb_build_object('crash', sqlerrm); end if;
    end;
    if pg_temp.h111_json(v_res) is distinct from '{"result": "processed", "outcome": "legacy"}'::jsonb
       or (v_new - 'h111_credits') is distinct from v_old then
      v_fails := array_append(v_fails, format('%s: old %s new %s (%s)', t.tag, v_old, v_new, v_res));
    else v_twins := v_twins + 1; end if;
    if t.tag = 'L5' and (v_new ->> 'h111_credits') is distinct from '1' then
      v_fails := array_append(v_fails, format('L5-credit: %s', v_new ->> 'h111_credits'));
    end if;
  end loop;

  -- ══ C: create_league ═══════════════════════════════════════════════════
  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, false);
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Free', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    if pg_temp.h111_json(v_res) -> 'row' is null then
      v_fails := array_append(v_fails, 'C-free-ok: ' || v_res);
    else v_seasons := v_seasons + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-C-free-ok: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'free', false, true);
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Free', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    if pg_temp.h111_json(v_res) is distinct from
       '{"error": "cap_reached", "cap": "activeSeasons", "limit": 1, "plan": "free"}'::jsonb then
      v_fails := array_append(v_fails, 'C-free-cap: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-C-free-cap: ' || sqlerrm); end if;
  end;

  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    select count(*) into v_n from public.leagues where owner_id = p_uid;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Paid', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    select count(*) into v_n2 from public.leagues where owner_id = p_uid;
    if pg_temp.h111_json(v_res) is distinct from
       '{"error": "cap_reached", "cap": "activeSeasons", "limit": 1, "plan": "elite", "reason": "purchase_required"}'::jsonb
       or v_n2 <> v_n then
      v_fails := array_append(v_fails, 'C-paid-none: ' || v_res);
    else v_refused := v_refused + 1; end if;

    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, false);
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Paid', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    if pg_temp.h111_json(v_res) ->> 'reason' is distinct from 'purchase_required' then
      v_fails := array_append(v_fails, 'C-paid-zero: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-C-paid-none: ' || sqlerrm); end if;
  end;

  -- A comped league creates freely: with a season active and with none, and
  -- an unused credit sitting there is NOT touched.
  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', true, true);
    insert into public.season_purchases (org_id, kind, tier, plan_at_checkout, status, completed_at)
    values (p_uid, 'signup', 'elite', 'free', 'credited', now())
    returning id into v_pid;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Comped A', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    v_j := pg_temp.h111_json(v_res);
    perform pg_temp.h111_state(p_uid, p_active, 'elite', true, false);
    v_res := v_res || ' | none active: ' || pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Comped B', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    select * into v_row from public.season_purchases where id = v_pid;
    if v_j -> 'row' is null or v_res not like '%none active: OK {"row"%'
       or v_row.league_id is not null or v_row.credit_used_at is not null then
      v_fails := array_append(v_fails, 'C-comped: ' || v_res);
    else v_seasons := v_seasons + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-C-comped: ' || sqlerrm); end if;
  end;

  -- A paid (not comped) league with a credit creates and uses it up.
  begin
    perform pg_temp.h111_state(p_uid, p_active, 'elite', false, true);
    insert into public.season_purchases (org_id, kind, tier, plan_at_checkout, status, completed_at)
    values (p_uid, 'signup', 'elite', 'free', 'credited', now())
    returning id into v_pid;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Comp', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    v_j := pg_temp.h111_json(v_res);
    select * into v_row from public.season_purchases where id = v_pid;
    v_res := v_res || ' | second: ' || pg_temp.h111_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H111 Comp 2', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    if v_j -> 'row' is null or v_row.league_id is distinct from (v_j -> 'row' ->> 'id')::uuid
       or v_row.credit_used_at is null or v_res not like '%second: OK %"purchase_required"%' then
      v_fails := array_append(v_fails, 'C-paid-credit: ' || v_res);
    else v_seasons := v_seasons + 1; end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-C-paid-credit: ' || sqlerrm); end if;
  end;

  -- ══ BF: the one-time backfill ═════════════════════════════════════════
  for t in
    select p.id,
           (select count(*) from public.season_purchases sp
             where sp.org_id = p.id and sp.status = 'credited' and sp.league_id is null) as credits
      from public.profiles p
     where p.plan in ('pro', 'elite') and not p.comped
       and not exists (select 1 from public.leagues l where l.owner_id = p.id)
  loop
    if t.credits <> 1 then
      v_fails := array_append(v_fails, format('BF1: league %s… holds %s unused credits', left(t.id::text, 8), t.credits));
    else v_backfill := v_backfill + 1; end if;
  end loop;

  -- ══ R: RLS and browser writes ═════════════════════════════════════════
  begin
    insert into public.season_purchases (org_id, kind, tier, plan_at_checkout, status)
    values (p_uid, 'signup', 'elite', 'free', 'credited'), (p_other, 'signup', 'elite', 'free', 'credited');
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select count(*)::text from public.season_purchases where org_id = %L', p_uid), true);
    if v_res <> 'OK 1' then v_fails := array_append(v_fails, 'R-own: ' || v_res); end if;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'select count(*)::text from public.season_purchases where org_id = %L', p_other), true);
    if v_res <> 'OK 0' then v_fails := array_append(v_fails, 'R-other: ' || v_res); end if;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'insert into public.season_purchases (org_id, kind, tier, plan_at_checkout, status) values (%L, %L, %L, %L, %L)',
      p_uid, 'signup', 'elite', 'free', 'credited'));
    if v_res not like 'ERR 42501 permission denied%' then v_fails := array_append(v_fails, 'R-insert: ' || v_res); end if;
    v_res := pg_temp.h111_try('authenticated', p_uid, format(
      'update public.season_purchases set league_id = null where org_id = %L', p_uid));
    if v_res not like 'ERR 42501 permission denied%' then v_fails := array_append(v_fails, 'R-update: ' || v_res); end if;
    v_res := pg_temp.h111_try('anon', null, 'select count(*)::text from public.season_purchases', true);
    if v_res not like 'ERR 42501 permission denied%' then v_fails := array_append(v_fails, 'R-anon: ' || v_res); end if;
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_fails := array_append(v_fails, 'CRASH-R: ' || sqlerrm); end if;
  end;

  -- ══ G / S: privileges and structure ═══════════════════════════════════
  foreach v_fn in array array[
    'public.begin_season_purchase(uuid, text, text, text, text, text, date, date)',
    'public.attach_purchase_session(uuid, text)',
    'public.create_league(uuid, text, text, text, date, date)']
  loop
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      v_fails := array_append(v_fails, 'G-auth: authenticated cannot execute ' || v_fn);
    end if;
    foreach v_role in array array['public', 'anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        v_fails := array_append(v_fails, format('G-auth: %s can execute %s', v_role, v_fn));
      end if;
    end loop;
  end loop;
  v_fn := 'public.process_checkout_event(text, uuid, text, integer, boolean, uuid)';
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    v_fails := array_append(v_fails, 'G-process: service_role cannot execute it');
  end if;
  foreach v_role in array array['public', 'anon', 'authenticated', 'dashboard_readonly'] loop
    if has_function_privilege(v_role, v_fn, 'EXECUTE') then
      v_fails := array_append(v_fails, format('G-process: %s can execute it', v_role));
    end if;
  end loop;
  if exists (select 1 from pg_proc where proname = 'process_checkout_event' and pronargs = 5) then
    v_fails := array_append(v_fails, 'G-process: the 5-argument version still exists');
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if has_table_privilege(v_role, 'public.season_purchases', 'INSERT,UPDATE,DELETE') then
      v_fails := array_append(v_fails, format('G-table: %s can write season_purchases', v_role));
    end if;
  end loop;

  foreach v_fn in array array['begin_season_purchase', 'attach_purchase_session', 'process_checkout_event', 'create_league'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_fn and p.prosecdef
                      and (p.proconfig @> array['search_path=public, pg_temp'] or p.proconfig @> array['search_path=public'])) then
      v_fails := array_append(v_fails, 'S1: not SECURITY DEFINER with a search_path: ' || v_fn);
    end if;
  end loop;

  return jsonb_build_object(
    'fails', to_jsonb(v_fails),
    'counters', jsonb_build_object(
      'purchases_begun', v_begin,
      'refused', v_refused,
      'seasons_created', v_seasons,
      'credits', v_credits,
      'flagged', v_flagged,
      'legacy_twins_equal', v_twins,
      'backfilled_leagues', v_backfill));
end;
$fn$;

do $h111$
declare
  v_uid    uuid;
  v_other  uuid;
  v_active uuid;
  v_n      integer;
  v_hole   text;
  v_base   jsonb;
  v_m      jsonb;
  v_out    text := '';
  v_fn     text;
  v_def    text;
  v_mut    text;
  m        record;
  v_first  text;
  v_tag    text;
  v_zero   text := '';
  k        text;
begin
  select count(*), min(id::text)::uuid into v_n, v_uid
    from public.profiles where org_name = 'test';
  if v_n <> 1 or v_uid::text not like 'bbf9afe1%' then
    raise exception 'H111 SETUP: expected exactly one "test" org owned by bbf9afe1…, found % (%)', v_n, v_uid;
  end if;
  select count(*), min(id::text)::uuid into v_n, v_other
    from public.profiles where org_name = 'Test 2';
  if v_n <> 1 then
    raise exception 'H111 SETUP: expected exactly one "Test 2" org, found %', v_n;
  end if;
  if exists (select 1 from public.organization_members where org_id = v_uid and user_id = v_other) then
    raise exception 'H111 SETUP: the Test 2 owner is a member of the test org';
  end if;
  select count(*), min(id::text)::uuid into v_n, v_active
    from public.leagues where owner_id = v_uid and archived_at is null;
  if v_n <> 1 then
    raise exception 'H111 SETUP: expected exactly one active season in the test org, found %', v_n;
  end if;

  -- H0: the hole, before 0111 — an Elite league that archives everything
  -- gets its next season free.
  begin
    perform pg_temp.h111_state(v_uid, v_active, 'elite', false, false);
    v_hole := pg_temp.h111_try('authenticated', v_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      v_uid, 'H111 Hole', 'Baseball', 'Spring 2027', '2027-04-03', '2027-05-22'), true);
    raise exception 'H111_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H111_ROLLBACK' then v_hole := 'CRASH ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- The migration, verbatim.
  execute $mig111$
-- @@MIGRATION_0111@@
  $mig111$;

  v_base := pg_temp.h111_assert(v_uid, v_other, v_active);
  for k in select jsonb_object_keys(v_base -> 'counters') loop
    if (v_base -> 'counters' ->> k)::integer = 0 then
      v_zero := v_zero || ' ' || k;
    end if;
  end loop;

  -- The md5 of every function the migration created, so the run can be
  -- matched to the repo file (the batch is sent by hand).
  v_out := (select string_agg(proname || '=' || md5(prosrc), ' ' order by proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and proname in ('begin_season_purchase', 'attach_purchase_session',
                               'process_checkout_event', 'create_league')) || E'\n';
  v_out := v_out || format(
    E'H111 RESULTS\nH0 free season for an Elite league with nothing active (before 0111): %s  [expected OK {"row": …]\nBASELINE failures: %s\nBASELINE counters: %s\nZERO counters:%s\n',
    left(v_hole, 60), v_base -> 'fails', v_base -> 'counters',
    case when v_zero = '' then ' none' else v_zero end);

  for m in
    select * from (values
      ('MU1',  'begin: comped check removed',                    'B-comped',       'begin',
         'if v_comped then', 'if false then'),
      ('MU2',  'begin: add_season takes the requested tier',      'B-add',          'begin',
         'v_tier := v_plan;', 'v_tier := p_tier;'),
      ('MU3',  'begin: kind-for-state check removed',             'B-add-wrong',    'begin',
         'elsif p_kind is distinct from v_allowed then', 'elsif false then'),
      ('MU4',  'process: add_season sets the purchase tier',      'P-add-race',     'process',
         E'    v_outcome := ''season_created'';\n\n  elsif v_purchase.kind = ''first_season'' then',
         E'    update public.profiles set plan = v_purchase.tier where id = p_org_id;\n    v_outcome := ''season_created'';\n\n  elsif v_purchase.kind = ''first_season'' then'),
      ('MU5',  'process: first_season ignores an active season',  'P-first-race',   'process',
         'if v_active = 0 then', 'if true then'),
      ('MU6',  'process: first_season creates no season',         'P-first-zero',   'process',
         E'      v_reason := ''season_active_at_payment'';\n    end if;\n    v_outcome := ''season_created'';',
         E'      v_reason := ''season_active_at_payment'';\n    end if;\n    v_outcome := ''credited'';'),
      ('MU7',  'process: an unmatched payment is dropped',        'P-unmatched',    'process',
         E'  if v_reason is not null then\n    insert into public.season_purchases (',
         E'  if v_reason is not null then\n    return jsonb_build_object(''result'', ''processed'');\n    insert into public.season_purchases ('),
      ('MU8',  'process: purchase-org check removed',             'P-orgmismatch',  'process',
         'when v_purchase.org_id <> p_org_id        then', 'when false then'),
      ('MU9',  'process: pending check removed',                  'P-notpending',   'process',
         'when v_purchase.status <> ''pending''       then', 'when false then'),
      ('MU10', 'process: tier check removed',                     'P-tier-mismatch','process',
         'when v_purchase.tier <> p_plan            then', 'when false then'),
      ('MU11', 'legacy: a Free convert provisions a season',      'L2',             'process',
         'elsif p_quantity = 1 and v_was_paid then', 'elsif p_quantity = 1 then'),
      ('MU12', 'create_league: the credit is not used up',        'C-paid-credit',  'create',
         E'     where id = v_credit\n       and league_id is null;\n    if not found then',
         E'     where id = v_credit\n       and false;\n    if false then'),
      ('MU13', 'create_league: a paid league creates without one','C-paid-none',    'create',
         '    if v_credit is null then', '    if false then'),
      ('MU14', 'process EXECUTE granted to authenticated',        'G-process',      'grantproc', null, null),
      ('MU15', 'RLS policy reads every league''s purchases',      'R-other',        'policy',    null, null),
      ('MU16', 'process: convert_free also creates a season',     'P-convert',      'process',
         E'      update public.profiles set plan = v_purchase.tier where id = p_org_id;\n      v_outcome := ''converted'';',
         E'      update public.profiles set plan = v_purchase.tier where id = p_org_id;\n      v_outcome := ''season_created'';'),
      ('MU17', 'process: a stale $100 upgrade becomes a credit',  'P-upgrade-stale','process',
         'v_outcome := ''flagged'';', 'v_outcome := ''credited'';'),
      ('MU18', 'process: an unmatched $100 upgrade raises the plan','P-unmatched-upgrade','process',
         'set plan = case when p_upgrade_only then v_cur_plan', 'set plan = case when false then v_cur_plan'),
      ('MU19', 'legacy: the paid-signup credit removed',          'L5-credit',      'process',
         'elsif p_quantity = 1 and not v_was_paid and not v_has_seed then', 'elsif false then'),
      ('MU20', 'create_league: the comped bypass removed',        'C-comped',       'create',
         'if coalesce(v_comped, false) then', 'if false then'),
      ('MU21', 'the backfill''s credits missing',                  'BF1',            'backfill', null, null)
    ) as t(id, what, target, kind, old_text, new_text)
  loop
    begin
      if m.kind = 'grantproc' then
        grant execute on function public.process_checkout_event(text, uuid, text, int, boolean, uuid) to authenticated;
      elsif m.kind = 'policy' then
        alter policy "Org members can read season purchases" on public.season_purchases using (true);
      elsif m.kind = 'backfill' then
        delete from public.season_purchases where kind = 'signup' and stripe_event_id is null;
      else
        v_fn := case m.kind
                  when 'begin'   then 'public.begin_season_purchase(uuid, text, text, text, text, text, date, date)'
                  when 'create'  then 'public.create_league(uuid, text, text, text, date, date)'
                  else 'public.process_checkout_event(text, uuid, text, integer, boolean, uuid)' end;
        v_def := pg_get_functiondef(v_fn::regprocedure);
        v_mut := replace(v_def, m.old_text, m.new_text);
        if v_mut = v_def then
          raise exception 'MUTANT_NOOP';
        end if;
        execute v_mut;
      end if;

      v_m := pg_temp.h111_assert(v_uid, v_other, v_active);
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first [%s], expected [%s]; %s failure(s): %s\n   first: %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'),
        (select string_agg(split_part(x, ':', 1), ' ') from jsonb_array_elements_text(v_m -> 'fails') x),
        left(coalesce(v_first, '-'), 160));
      raise exception 'H111_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H111_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  -- After the mutants: the unmutated fix must still be green.
  v_m := pg_temp.h111_assert(v_uid, v_other, v_active);
  v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');

  -- ALWAYS raise: this is what rolls everything back.
  raise exception '%', v_out;
end;
$h111$;
