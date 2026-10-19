-- SQL-level proof for migration 0110 (leagues: season create/restore guard).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- is a table privilege, a trigger and a SECURITY DEFINER function, exercised
-- as the `authenticated` role under RLS. The in-memory fake client cannot
-- model any of that. NOT `npm run`-able, NOT in CI.
--
-- THIS HARNESS APPLIES 0110 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK. It is the proof to run BEFORE the migration is applied for real. It
-- leaves nothing behind: no grant change, no trigger, no function, no row.
--
-- HOW TO RUN
--   1. `npx tsx scripts/sim/season-guard-build.ts > <file>` substitutes the
--      LITERAL text of supabase/migrations/0110_season_create_restore_guard.sql
--      for the placeholder line below.
--   2. Send the whole output as ONE batch through the Supabase MCP
--      (execute_sql) — one batch is one transaction.
--   3. The last statement ALWAYS raises. The raised message IS the result.
--   Get an explicit go-ahead first.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: a second or two)
--   SHARE ROW EXCLUSIVE on public.leagues, from CREATE TRIGGER (and REVOKE).
--   It BLOCKS WRITES to leagues from the live app (season rename, archive,
--   the auto-archive on read, schedule settings, create_league, a Stripe
--   checkout's new season) and does NOT block reads. Row locks on the "test"
--   org's profiles row (plan flips), its leagues rows, and a stripe_events
--   claim. lock_timeout = 3s, statement_timeout = 60s. No ACCESS EXCLUSIVE
--   lock is taken: no mutant drops or disables the trigger or alters a table.
--
-- ROWS TOUCHED (all rolled back): the "test" org (owner bbf9afe1…, NOT the
-- real league) — its profiles.plan, its one active season, two scratch
-- archived seasons the harness inserts ("H110 Archived A/B"), a season
-- create_league / process_checkout_event create, one scratch division + team
-- from create_division_atomic, a stripe_events claim HARNESS-0110-evt. The
-- "Test 2" org's owner is used as a NON-member caller of the test org; and,
-- for the owner_id assertions only, the test owner is made an admin of
-- "Test 2" (one organization_members row, rolled back) and the test org's
-- seasons are pointed at Test 2's id — never any Test 2 row itself.
--
-- IMPERSONATION: `set local role authenticated` plus request.jwt.claims, the
-- way PostgREST does it. Assertions are read back as postgres.
--
-- ASSERTIONS (in evaluation order — mutant targets depend on it)
--   H0        BEFORE 0110: a signed-in member CAN insert a season, CAN
--             un-archive one, and (as a member of two orgs) CAN move a season
--             into the other org (the holes are real)
--   I1/I1b    PRIVILEGE LAYER: insert of an active / an archived season is
--             refused with "permission denied"
--   C-insert / C-insert-archived   TRIGGER LAYER, isolated by re-granting
--             INSERT inside a rolled-back block: both refused by the trigger
--   U1/U2/U3  un-archive refused by the trigger: alone, mixed with other
--             columns, and as a bulk update; the row reads back unchanged
--   U-owner / U-owner-archived   moving a season (active; archived, mixed
--             with a rename) to another org the caller ALSO belongs to is
--             refused by the trigger and the owner reads back unchanged
--   A1/A2     archiving an active season is allowed; re-stamping an archived
--             season's archived_at is allowed
--   O-*       name, schedule_settings, pay_tracking_enabled, pay_rate_mode,
--             end_date on an active season, and name on an archived one,
--             all save and read back changed
--   N1        a non-member's update touches zero rows (RLS, unchanged)
--   E-anon    anon insert refused
--   L-*       every legitimate writer still works: create_league caps
--             (L-create-cap) and creates (L-create); process_checkout_event
--             as service_role adds a season (L-checkout);
--             delete_league_permanently (L-delete); create_division_atomic's
--             schedule_settings update (L-division); postgres directly
--             (L-postgres)
--   R-*       restore_season: elite and pro restore with another season
--             active; Free with another active → cap_reached and unchanged;
--             Free with none active → restored; new end date applied; end
--             before start refused; not archived refused; non-member
--             refused and unchanged; unknown id refused; anon cannot execute
--   P1/P2     EXECUTE per role; INSERT privilege per role
--   S1/S2/S3  trigger function INVOKER; trigger BEFORE INSERT OR UPDATE,
--             row, enabled; restore_season DEFINER with its search_path
--
-- MUTANTS — each in its own rolled-back block. A body rewrite is asserted to
-- have changed the text (MUTANT_NOOP otherwise). KILLED only if the FIRST
-- failure is the mutant's own tag.
--   LM1  trigger function made SECURITY DEFINER              → C-insert
--   LM2  un-archive check removed                            → U1
--   LM3  ANY archived_at change refused (archive too)        → A1
--   LM4  INSERT refused only when not archived               → C-insert-archived
--   LM5  restore_season's Free cap removed                   → R-free-cap
--   LM6  restore_season caps paid orgs too                   → R-elite
--   LM7  restore_season's membership check removed           → R-nonmember
--   LM8  restore_season counts archived seasons as active    → R-free-ok
--   LM9  INSERT re-granted to authenticated                  → I1
--   LM10 restore_season EXECUTE granted to anon              → R-anon
--   LM11 owner_id check removed                              → U-owner
--
-- NOT EXERCISED, stated: anon against the trigger (anon holds no INSERT or
-- UPDATE on leagues, so it never reaches it); the per-org advisory lock in
-- restore_season (needs two concurrent sessions; one batch is one session).
--
-- AFTER 0111 (2026-10-19, edited, not re-run): L-create-cap now runs with
-- the test org un-comped (a comped league creates freely under 0111), and
-- L-checkout accepts process_checkout_event's jsonb reply. Both still hold
-- against the pre-0111 functions.
--
-- RUN LOG (2026-10-14, ~11:00 Pacific, against production, rolled back; leak
-- check clean after each run; no other active backend). 0110 was NOT applied.
--
--   RUN 1 — baseline RED at R-elite / R-pro, and the fault was the HARNESS:
--     section O re-reads `v_before` for the ACTIVE season, and R compared
--     Archived A's end_date against it. The restore itself was right (row
--     back, end_date 2026-09-30 unchanged). FIX: Archived A's snapshot is
--     its own variable, `v_a_before`. The run also printed every failure in
--     full and was too long to read; mutants now print tags + the first one.
--     That fault also made LM10 die at R-elite instead of R-anon.
--
--   RUN 2 — baseline GREEN, zero failures, no zero counter:
--     H0   the hole is real: a signed-in member inserted a season (OK rows=1)
--          and un-archived one (OK rows=1, read back)
--     refused_by_privilege 2 · refused_by_trigger 5 · allowed_writes 8 ·
--     legitimate_writers_ok 6 · restored 4 · restore_refused 6
--     LM1  → KILLED at [C-insert]
--     LM2  → KILLED at [U1]
--     LM3  → KILLED at [A1]            (A1 A2 only)
--     LM4  → KILLED at [C-insert-archived]   (the only failure)
--     LM5  → KILLED at [R-free-cap]    (the only failure)
--     LM6  → KILLED at [R-elite]       (R-elite R-pro R-enddate)
--     LM7  → KILLED at [R-nonmember]
--     LM8  → KILLED at [R-free-ok]     (the only failure)
--     LM9  → KILLED at [I1]            — the refusal that replaced "permission
--                                        denied" was the TRIGGER's: with
--                                        INSERT re-granted, the second layer held
--     LM10 → KILLED at [R-anon]        (anon reached the function and got
--                                        not_authenticated)
--     AFTER MUTANTS: zero failures.
--
--   RUN 3 (2026-10-14, at review) — 0110's trigger now also refuses a browser
--     change of owner_id; U-owner / U-owner-archived and LM11 added; the test
--     owner made an admin of "Test 2" for the run (rolled back). No other
--     active backend before the run. Baseline GREEN, zero failures, no zero
--     counter:
--     H0   all three holes real before 0110: insert, un-archive, AND a move
--          to another org (each OK rows=1)
--     refused_by_privilege 2 · refused_by_trigger 7 · allowed_writes 8 ·
--     legitimate_writers_ok 6 · restored 4 · restore_refused 6
--     LM1–LM10 → KILLED at their own tag, as in run 2
--     LM11 → KILLED at [U-owner]           (U-owner U-owner-archived only)
--     NOTE LM4: its archived INSERT now dies at the owner_id check
--          (season_move_refused — OLD is null on INSERT, so owner_id is
--          "distinct"). Still killed at its own tag [C-insert-archived]; the
--          owner check is a harmless third refusal of browser INSERTs.
--     AFTER MUTANTS: zero failures. Leak check clean: no H110 rows, no stray
--     Test 2 membership, no stripe_events claim, test plan back to elite, no
--     0110 function or trigger, INSERT privilege as before.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

-- Runs one statement as a role and reports what happened; always returns to
-- postgres. With p_into, the statement's single value is reported.
create function pg_temp.h110_try(p_role text, p_uid uuid, p_sql text, p_into boolean default false)
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

create function pg_temp.h110_restore_sql(p_league uuid, p_end date default null)
returns text
language sql
as $fn$
  select format('select public.restore_season(%L::uuid, %L::date)::text', p_league, p_end);
$fn$;

-- The whole assertion set. Returns { fails: [...in order...], counters: {} }.
create function pg_temp.h110_assert(p_uid uuid, p_other uuid, p_active uuid, p_a uuid, p_b uuid)
returns jsonb
language plpgsql
as $fn$
declare
  v_fails   text[] := array[]::text[];
  v_priv    integer := 0;
  v_trig    integer := 0;
  v_allowed integer := 0;
  v_legit   integer := 0;
  v_rest    integer := 0;
  v_refused integer := 0;
  v_res     text;
  v_before  public.leagues%rowtype;
  v_a_before public.leagues%rowtype;
  v_row     public.leagues%rowtype;
  v_n       integer;
  v_n2      integer;
  v_role    text;
begin
  select * into v_before from public.leagues where id = p_a;
  v_a_before := v_before;

  -- ── I: privilege layer ───────────────────────────────────────────────────
  v_res := pg_temp.h110_try('authenticated', p_uid, format(
    'insert into public.leagues (name, sport, season, status, owner_id) values (%L, %L, %L, %L, %L)',
    'H110 Insert', 'baseball', 'Fall', 'active', p_uid));
  if v_res like 'ERR 42501 permission denied%' then v_priv := v_priv + 1;
  else v_fails := array_append(v_fails, 'I1: ' || v_res); end if;

  v_res := pg_temp.h110_try('authenticated', p_uid, format(
    'insert into public.leagues (name, sport, season, status, owner_id, archived_at) values (%L, %L, %L, %L, %L, now())',
    'H110 Insert Archived', 'baseball', 'Fall', 'archived', p_uid));
  if v_res like 'ERR 42501 permission denied%' then v_priv := v_priv + 1;
  else v_fails := array_append(v_fails, 'I1b: ' || v_res); end if;

  -- ── C: trigger layer for INSERT, isolated ────────────────────────────────
  begin
    grant insert on table public.leagues to authenticated;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'insert into public.leagues (name, sport, season, status, owner_id) values (%L, %L, %L, %L, %L)',
      'H110 Insert', 'baseball', 'Fall', 'active', p_uid));
    if v_res like 'ERR 42501 season_create_refused:%' then v_trig := v_trig + 1;
    else v_fails := array_append(v_fails, 'C-insert: ' || v_res); end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'insert into public.leagues (name, sport, season, status, owner_id, archived_at) values (%L, %L, %L, %L, %L, now())',
      'H110 Insert Archived', 'baseball', 'Fall', 'archived', p_uid));
    if v_res like 'ERR 42501 season_create_refused:%' then v_trig := v_trig + 1;
    else v_fails := array_append(v_fails, 'C-insert-archived: ' || v_res); end if;

    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'CRASH-C: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── U: un-archive refused ────────────────────────────────────────────────
  v_res := pg_temp.h110_try('authenticated', p_uid, format(
    'update public.leagues set archived_at = null where id = %L', p_a));
  if v_res like 'ERR 42501 season_restore_refused:%' then v_trig := v_trig + 1;
  else v_fails := array_append(v_fails, 'U1: ' || v_res); end if;

  v_res := pg_temp.h110_try('authenticated', p_uid, format(
    'update public.leagues set archived_at = null, status = %L, end_date = end_date + 30 where id = %L',
    'active', p_a));
  if v_res like 'ERR 42501 season_restore_refused:%' then v_trig := v_trig + 1;
  else v_fails := array_append(v_fails, 'U2: ' || v_res); end if;

  v_res := pg_temp.h110_try('authenticated', p_uid, format(
    'update public.leagues set archived_at = null where owner_id = %L and archived_at is not null', p_uid));
  if v_res like 'ERR 42501 season_restore_refused:%' then v_trig := v_trig + 1;
  else v_fails := array_append(v_fails, 'U3: ' || v_res); end if;

  select * into v_row from public.leagues where id = p_a;
  if to_jsonb(v_row) is distinct from to_jsonb(v_before) then
    v_fails := array_append(v_fails, 'U-unchanged: the archived season changed during refused writes');
  end if;

  -- ── U-owner: moving a season to another org refused ──────────────────────
  -- The caller is a member of BOTH orgs (fixture), so RLS's WITH CHECK passes
  -- and only the trigger can refuse. Rolled back so a mutant's successful
  -- move cannot disturb the assertions after it.
  begin
    select * into v_before from public.leagues where id = p_active;
    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set owner_id = %L where id = %L', p_other, p_active));
    select * into v_row from public.leagues where id = p_active;
    if v_res like 'ERR 42501 season_move_refused:%' and v_row.owner_id = p_uid then
      v_trig := v_trig + 1;
    else v_fails := array_append(v_fails, 'U-owner: ' || v_res); end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set owner_id = %L, name = name || %L where id = %L', p_other, ' H110', p_a));
    select * into v_row from public.leagues where id = p_a;
    if v_res like 'ERR 42501 season_%_refused:%' and v_row.owner_id = p_uid then
      v_trig := v_trig + 1;
    else v_fails := array_append(v_fails, 'U-owner-archived: ' || v_res); end if;

    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'CRASH-U-owner: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── A: archiving stays allowed ───────────────────────────────────────────
  begin
    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set archived_at = now(), status = %L where id = %L', 'archived', p_active));
    select * into v_row from public.leagues where id = p_active;
    if v_res <> 'OK rows=1' or v_row.archived_at is null then
      v_fails := array_append(v_fails, 'A1: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set archived_at = archived_at - interval ''1 day'' where id = %L', p_b));
    if v_res <> 'OK rows=1' then
      v_fails := array_append(v_fails, 'A2: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'CRASH-A: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── O: every other browser write stays allowed ───────────────────────────
  begin
    select * into v_before from public.leagues where id = p_active;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set name = name || %L where id = %L', ' H110', p_active));
    select * into v_row from public.leagues where id = p_active;
    if v_res <> 'OK rows=1' or v_row.name is not distinct from v_before.name then
      v_fails := array_append(v_fails, 'O-name: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set schedule_settings = coalesce(schedule_settings, ''{}''::jsonb) || ''{"h110": true}''::jsonb where id = %L',
      p_active));
    select * into v_row from public.leagues where id = p_active;
    if v_res <> 'OK rows=1' or v_row.schedule_settings is not distinct from v_before.schedule_settings then
      v_fails := array_append(v_fails, 'O-schedule_settings: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set pay_tracking_enabled = not pay_tracking_enabled where id = %L', p_active));
    select * into v_row from public.leagues where id = p_active;
    if v_res <> 'OK rows=1' or v_row.pay_tracking_enabled is not distinct from v_before.pay_tracking_enabled then
      v_fails := array_append(v_fails, 'O-pay_tracking_enabled: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set pay_rate_mode = case when pay_rate_mode = ''per_umpire'' then ''per_role'' else ''per_umpire'' end where id = %L',
      p_active));
    select * into v_row from public.leagues where id = p_active;
    if v_res <> 'OK rows=1' or v_row.pay_rate_mode is not distinct from v_before.pay_rate_mode then
      v_fails := array_append(v_fails, 'O-pay_rate_mode: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set end_date = coalesce(end_date, current_date) + 7 where id = %L', p_active));
    select * into v_row from public.leagues where id = p_active;
    if v_res <> 'OK rows=1' or v_row.end_date is not distinct from v_before.end_date then
      v_fails := array_append(v_fails, 'O-end_date: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'update public.leagues set name = %L where id = %L', 'H110 Archived Renamed', p_a));
    select * into v_row from public.leagues where id = p_a;
    if v_res <> 'OK rows=1' or v_row.name <> 'H110 Archived Renamed' or v_row.archived_at is null then
      v_fails := array_append(v_fails, 'O-archived-name: ' || v_res);
    else v_allowed := v_allowed + 1; end if;

    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'CRASH-O: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── N / E ────────────────────────────────────────────────────────────────
  v_res := pg_temp.h110_try('authenticated', p_other, format(
    'update public.leagues set name = %L where id = %L', 'H110 Not Yours', p_a));
  if v_res <> 'OK rows=0' then
    v_fails := array_append(v_fails, 'N1: ' || v_res);
  end if;

  v_res := pg_temp.h110_try('anon', null, format(
    'insert into public.leagues (name, sport, season, status, owner_id) values (%L, %L, %L, %L, %L)',
    'H110 Anon', 'baseball', 'Fall', 'active', p_uid));
  if v_res not like 'ERR 42501 permission denied%' then
    v_fails := array_append(v_fails, 'E-anon: ' || v_res);
  end if;

  -- ── L: every legitimate writer still works ───────────────────────────────
  -- Not comped for this check: since 0111 a comped league creates freely,
  -- and the "test" org is comped. Rolled back.
  begin
    update public.profiles set comped = false where id = p_uid;
    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H110 Created', 'baseball', 'Fall', '2026-11-01', '2026-12-01'), true);
    if v_res not like 'OK %"cap_reached"%' then
      v_fails := array_append(v_fails, 'L-create-cap: ' || v_res);
    else v_legit := v_legit + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'L-create-cap: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.leagues set archived_at = now(), status = 'archived' where id = p_active;
    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'select public.create_league(%L::uuid, %L, %L, %L, %L::date, %L::date)::text',
      p_uid, 'H110 Created', 'baseball', 'Fall', '2026-11-01', '2026-12-01'), true);
    select count(*) into v_n from public.leagues
     where owner_id = p_uid and name = 'H110 Created' and archived_at is null;
    if v_res not like 'OK {"row"%' or v_n <> 1 then
      v_fails := array_append(v_fails, format('L-create: %s (rows=%s)', v_res, v_n));
    else v_legit := v_legit + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'L-create: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.profiles set plan = 'elite' where id = p_uid;
    select count(*) into v_n from public.leagues where owner_id = p_uid;
    v_res := pg_temp.h110_try('service_role', null, format(
      'select public.process_checkout_event(%L, %L::uuid, %L, 1, false)',
      'HARNESS-0110-evt', p_uid, 'elite'), true);
    select count(*) into v_n2 from public.leagues where owner_id = p_uid;
    -- 'processed' (text before 0111, inside a jsonb reply after it).
    if v_res not like 'OK %processed%' or v_n2 <> v_n + 1 then
      v_fails := array_append(v_fails, format('L-checkout: %s (%s → %s seasons)', v_res, v_n, v_n2));
    else v_legit := v_legit + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'L-checkout: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'select public.delete_league_permanently(%L::uuid)::text', p_a), true);
    if v_res not like 'OK {%"deleted": true%' or exists (select 1 from public.leagues where id = p_a) then
      v_fails := array_append(v_fails, 'L-delete: ' || v_res);
    else v_legit := v_legit + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'L-delete: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.profiles set plan = 'elite' where id = p_uid;
    v_res := pg_temp.h110_try('authenticated', p_uid, format(
      'select public.create_division_atomic(%L::uuid, %L::jsonb, array[%L], %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)::text',
      p_active, '{"name": "H110 Div"}', 'H110 Team', '[]', '[]', '[]', '{"h110_division": 1}'), true);
    select * into v_row from public.leagues where id = p_active;
    if v_res not like 'OK {"row"%' or v_row.schedule_settings is distinct from '{"h110_division": 1}'::jsonb then
      v_fails := array_append(v_fails, 'L-division: ' || v_res);
    else v_legit := v_legit + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'L-division: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.leagues set archived_at = null, status = 'active' where id = p_a;
    if not exists (select 1 from public.leagues where id = p_a and archived_at is null) then
      v_fails := array_append(v_fails, 'L-postgres: postgres could not un-archive directly');
    else v_legit := v_legit + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'L-postgres: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── R: restore_season ────────────────────────────────────────────────────
  -- R-elite / R-pro: another season (p_active) is active; paid orgs restore.
  foreach v_role in array array['elite', 'pro']
  loop
    begin
      update public.profiles set plan = v_role where id = p_uid;
      v_res := pg_temp.h110_try('authenticated', p_uid, pg_temp.h110_restore_sql(p_a), true);
      select * into v_row from public.leagues where id = p_a;
      if v_res not like 'OK {"row"%' or v_row.archived_at is not null or v_row.status <> 'active'
         or v_row.end_date is distinct from v_a_before.end_date then
        v_fails := array_append(v_fails, format('R-%s: %s', v_role, v_res));
      else v_rest := v_rest + 1; end if;
      raise exception 'H110_ROLLBACK';
    exception when others then
      if sqlerrm <> 'H110_ROLLBACK' then
        v_fails := array_append(v_fails, format('R-%s: %s %s', v_role, sqlstate, sqlerrm));
      end if;
    end;
  end loop;

  begin
    update public.profiles set plan = 'free' where id = p_uid;
    v_res := pg_temp.h110_try('authenticated', p_uid, pg_temp.h110_restore_sql(p_a), true);
    select * into v_row from public.leagues where id = p_a;
    if v_res not like 'OK %"error": "cap_reached"%' or v_res not like '%"plan": "free"%'
       or v_row.archived_at is null then
      v_fails := array_append(v_fails, 'R-free-cap: ' || v_res);
    else v_refused := v_refused + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'R-free-cap: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.profiles set plan = 'free' where id = p_uid;
    update public.leagues set archived_at = now(), status = 'archived' where id = p_active;
    v_res := pg_temp.h110_try('authenticated', p_uid, pg_temp.h110_restore_sql(p_a), true);
    select * into v_row from public.leagues where id = p_a;
    if v_res not like 'OK {"row"%' or v_row.archived_at is not null then
      v_fails := array_append(v_fails, 'R-free-ok: ' || v_res);
    else v_rest := v_rest + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'R-free-ok: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.profiles set plan = 'elite' where id = p_uid;
    v_res := pg_temp.h110_try('authenticated', p_uid, pg_temp.h110_restore_sql(p_a, '2026-12-31'), true);
    select * into v_row from public.leagues where id = p_a;
    if v_res not like 'OK {"row"%' or v_row.end_date is distinct from '2026-12-31'::date then
      v_fails := array_append(v_fails, 'R-enddate: ' || v_res);
    else v_rest := v_rest + 1; end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'R-enddate: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  begin
    update public.profiles set plan = 'elite' where id = p_uid;

    v_res := pg_temp.h110_try('authenticated', p_uid, pg_temp.h110_restore_sql(p_a, '2026-01-01'), true);
    if v_res not like 'ERR P0001 end_before_start%' then
      v_fails := array_append(v_fails, 'R-end-before-start: ' || v_res);
    else v_refused := v_refused + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, pg_temp.h110_restore_sql(p_active), true);
    if v_res not like 'ERR P0001 league_not_archived%' then
      v_fails := array_append(v_fails, 'R-not-archived: ' || v_res);
    else v_refused := v_refused + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_other, pg_temp.h110_restore_sql(p_a), true);
    select * into v_row from public.leagues where id = p_a;
    if v_res not like 'ERR P0001 not_org_member%' or v_row.archived_at is null then
      v_fails := array_append(v_fails, 'R-nonmember: ' || v_res);
    else v_refused := v_refused + 1; end if;

    v_res := pg_temp.h110_try('authenticated', p_uid, pg_temp.h110_restore_sql(gen_random_uuid()), true);
    if v_res not like 'ERR P0001 league_not_found%' then
      v_fails := array_append(v_fails, 'R-notfound: ' || v_res);
    else v_refused := v_refused + 1; end if;

    v_res := pg_temp.h110_try('anon', null, pg_temp.h110_restore_sql(p_a), true);
    select * into v_row from public.leagues where id = p_a;
    if v_res not like 'ERR 42501 permission denied%' or v_row.archived_at is null then
      v_fails := array_append(v_fails, 'R-anon: ' || v_res);
    else v_refused := v_refused + 1; end if;

    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_fails := array_append(v_fails, 'CRASH-R: ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  -- ── P / S: privileges and structure ──────────────────────────────────────
  if not has_function_privilege('authenticated', 'public.restore_season(uuid, date)', 'EXECUTE') then
    v_fails := array_append(v_fails, 'P1: authenticated cannot execute restore_season');
  end if;
  foreach v_role in array array['public', 'anon', 'service_role', 'dashboard_readonly']
  loop
    if has_function_privilege(v_role, 'public.restore_season(uuid, date)', 'EXECUTE') then
      v_fails := array_append(v_fails, 'P1: ' || v_role || ' can execute restore_season');
    end if;
  end loop;
  foreach v_role in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']
  loop
    if has_function_privilege(v_role, 'public.protect_leagues_season_cap()', 'EXECUTE') then
      v_fails := array_append(v_fails, 'P1: ' || v_role || ' can execute the trigger function');
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.leagues', 'INSERT')
     or has_table_privilege('anon', 'public.leagues', 'INSERT') then
    v_fails := array_append(v_fails, 'P2: INSERT on leagues held by authenticated or anon');
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'protect_leagues_season_cap'
                    and not p.prosecdef) then
    v_fails := array_append(v_fails, 'S1: the trigger function is missing or SECURITY DEFINER');
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.leagues'::regclass
                    and t.tgname = 'protect_leagues_season_cap'
                    and t.tgenabled = 'O' and t.tgtype = 23) then
    v_fails := array_append(v_fails, 'S2: trigger is not an enabled BEFORE INSERT OR UPDATE row trigger');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'restore_season'
                    and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']) then
    v_fails := array_append(v_fails, 'S3: restore_season is not DEFINER with search_path = public, pg_temp');
  end if;

  return jsonb_build_object(
    'fails', to_jsonb(v_fails),
    'counters', jsonb_build_object(
      'refused_by_privilege', v_priv,
      'refused_by_trigger', v_trig,
      'allowed_writes', v_allowed,
      'legitimate_writers_ok', v_legit,
      'restored', v_rest,
      'restore_refused', v_refused));
end;
$fn$;

do $h110$
declare
  v_uid    uuid;
  v_other  uuid;
  v_active uuid;
  v_a      uuid;
  v_b      uuid;
  v_n      integer;
  v_hole   text;
  v_hole2  text;
  v_hole3  text;
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
    raise exception 'H110 SETUP: expected exactly one "test" org owned by bbf9afe1…, found % (%)', v_n, v_uid;
  end if;
  select count(*), min(id::text)::uuid into v_n, v_other
    from public.profiles where org_name = 'Test 2';
  if v_n <> 1 then
    raise exception 'H110 SETUP: expected exactly one "Test 2" org, found %', v_n;
  end if;
  if exists (select 1 from public.organization_members where org_id = v_uid and user_id = v_other) then
    raise exception 'H110 SETUP: the Test 2 owner is a member of the test org';
  end if;
  select count(*), min(id::text)::uuid into v_n, v_active
    from public.leagues where owner_id = v_uid and archived_at is null;
  if v_n <> 1 then
    raise exception 'H110 SETUP: expected exactly one active season in the test org, found %', v_n;
  end if;

  insert into public.leagues (name, sport, season, status, owner_id, start_date, end_date, archived_at)
  values ('H110 Archived A', 'baseball', 'Fall', 'archived', v_uid, '2026-09-01', '2026-09-30', now() - interval '1 day')
  returning id into v_a;
  insert into public.leagues (name, sport, season, status, owner_id, start_date, end_date, archived_at)
  values ('H110 Archived B', 'baseball', 'Fall', 'archived', v_uid, '2026-08-01', '2026-08-31', now() - interval '2 days')
  returning id into v_b;

  -- The test owner becomes an admin of Test 2 too (rolled back with the rest),
  -- so a move between the two orgs passes RLS and only the trigger can stop it.
  insert into public.organization_members (org_id, user_id, role)
  values (v_other, v_uid, 'admin');

  -- H0: the hole, before the fix.
  begin
    v_hole := pg_temp.h110_try('authenticated', v_uid, format(
      'insert into public.leagues (name, sport, season, status, owner_id) values (%L, %L, %L, %L, %L)',
      'H110 Hole', 'baseball', 'Fall', 'active', v_uid));
    v_hole2 := pg_temp.h110_try('authenticated', v_uid, format(
      'update public.leagues set archived_at = null, status = %L where id = %L', 'active', v_a));
    if not exists (select 1 from public.leagues where id = v_a and archived_at is null) then
      v_hole2 := v_hole2 || ' BUT the row did not change';
    end if;
    v_hole3 := pg_temp.h110_try('authenticated', v_uid, format(
      'update public.leagues set owner_id = %L where id = %L', v_other, v_active));
    if not exists (select 1 from public.leagues where id = v_active and owner_id = v_other) then
      v_hole3 := v_hole3 || ' BUT the row did not change';
    end if;
    raise exception 'H110_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H110_ROLLBACK' then
      v_hole := 'CRASH ' || sqlstate || ' ' || sqlerrm;
    end if;
  end;

  -- The migration, verbatim.
  execute $mig110$
-- @@MIGRATION_0110@@
  $mig110$;

  v_base := pg_temp.h110_assert(v_uid, v_other, v_active, v_a, v_b);
  for k in select jsonb_object_keys(v_base -> 'counters') loop
    if (v_base -> 'counters' ->> k)::integer = 0 then
      v_zero := v_zero || ' ' || k;
    end if;
  end loop;

  v_out := format(
    E'H110 RESULTS\nH0 insert (before 0110): %s  [expected OK rows=1]\nH0 un-archive (before 0110): %s  [expected OK rows=1]\nH0 move to another org (before 0110): %s  [expected OK rows=1]\nBASELINE failures: %s\nBASELINE counters: %s\nZERO counters:%s\n',
    v_hole, v_hole2, v_hole3, v_base -> 'fails', v_base -> 'counters',
    case when v_zero = '' then ' none' else v_zero end);

  for m in
    select * from (values
      ('LM1',  'trigger function made SECURITY DEFINER',       'C-insert',          'alter',  null, null),
      ('LM2',  'un-archive check removed',                     'U1',                'trig',
         'if old.archived_at is not null and new.archived_at is null then', 'if false then'),
      ('LM3',  'any archived_at change refused',               'A1',                'trig',
         'if old.archived_at is not null and new.archived_at is null then', 'if old.archived_at is distinct from new.archived_at then'),
      ('LM4',  'INSERT refused only when not archived',        'C-insert-archived', 'trig',
         'if tg_op = ''INSERT'' then', 'if tg_op = ''INSERT'' and new.archived_at is null then'),
      ('LM5',  'Free cap removed',                             'R-free-cap',        'rest',
         'if v_plan not in (''pro'', ''elite'') then', 'if false then'),
      ('LM6',  'paid orgs capped too',                         'R-elite',           'rest',
         'if v_plan not in (''pro'', ''elite'') then', 'if true then'),
      ('LM7',  'membership check removed',                     'R-nonmember',       'rest',
         'if not public.is_org_member(v_league.owner_id) then', 'if false then'),
      ('LM8',  'archived seasons counted as active',           'R-free-ok',         'rest',
         'and archived_at is null and id <> p_league_id', 'and id <> p_league_id'),
      ('LM9',  'INSERT re-granted to authenticated',           'I1',                'grantins', null, null),
      ('LM10', 'restore_season EXECUTE granted to anon',       'R-anon',            'grantanon', null, null),
      ('LM11', 'owner_id check removed',                       'U-owner',           'trig',
         'if new.owner_id is distinct from old.owner_id then', 'if false then')
    ) as t(id, what, target, kind, old_text, new_text)
  loop
    begin
      if m.kind = 'alter' then
        alter function public.protect_leagues_season_cap() security definer;
      elsif m.kind = 'grantins' then
        grant insert on table public.leagues to authenticated;
      elsif m.kind = 'grantanon' then
        grant execute on function public.restore_season(uuid, date) to anon;
      else
        v_fn := case m.kind when 'trig' then 'public.protect_leagues_season_cap()'
                            else 'public.restore_season(uuid, date)' end;
        v_def := pg_get_functiondef(v_fn::regprocedure);
        v_mut := replace(v_def, m.old_text, m.new_text);
        if v_mut = v_def then
          raise exception 'MUTANT_NOOP';
        end if;
        execute v_mut;
      end if;

      v_m := pg_temp.h110_assert(v_uid, v_other, v_active, v_a, v_b);
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      -- Tags only (the full text of every failure made run 1's message too
      -- long to read); the first failure is printed whole.
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n   first: %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'),
        (select string_agg(split_part(x, ':', 1), ' ') from jsonb_array_elements_text(v_m -> 'fails') x),
        left(coalesce(v_first, '-'), 200));
      raise exception 'H110_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H110_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  -- After the mutants: the unmutated fix must still be green.
  v_m := pg_temp.h110_assert(v_uid, v_other, v_active, v_a, v_b);
  v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');

  -- ALWAYS raise: this is what rolls everything back.
  raise exception '%', v_out;
end;
$h110$;
