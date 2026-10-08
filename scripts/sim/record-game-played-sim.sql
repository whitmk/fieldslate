-- SQL-level proof for migration 0106 (record_game_played — "Record where it
-- was played").
--
-- WHY SQL: the behavior is a SECURITY DEFINER function's refusals, the org
-- timezone's "today", the 0082 lock trigger letting the write through, the
-- 0096 posted trigger firing and being undone, and grants — exercised as
-- `anon` and `authenticated`. NOT `npm run`-able, NOT in CI (CLAUDE.md,
-- "Harness standard — SQL-level exceptions").
--
-- THIS HARNESS APPLIES 0106 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK, so it runs BEFORE the migration is applied. The text proven is the
-- repo file: the build script substitutes it for the placeholder below.
--
-- HOW TO RUN: `npx tsx scripts/sim/record-game-played-build.ts > <file>`, send
-- the output as ONE batch through the Supabase MCP (one batch = one
-- transaction), read the raised message, then run the leak check at the
-- bottom.
--
-- EVERY PASS IS ITS OWN ROLLED-BACK SUB-TRANSACTION. The baseline and each
-- mutant start from the same fixtures: a pass raises its results out, which
-- undoes every write it (and its mutant) made.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: about a second)
--   Creating the function takes no table lock. Row locks on the FIXTURE rows
--   only (all new, all rolled back), plus the test org owner's `profiles` ROW
--   (its timezone is switched per assertion, rolled back) — that blocks
--   writes to that one row (an org-name save by that account), nothing else.
--   The MU6 mutant rewrites clear_division_posted (a production trigger
--   function) inside its own rolled-back block; md5(prosrc) of it is printed
--   at the end and must equal its pre-run value.
--   lock_timeout = 3s; statement_timeout = 60s.
--
-- ROWS TOUCHED (all rolled back): the test org "SRALL" only (owner
-- aa21d01c-66dc-4c37-b15c-7b743c557eea) — two seasons, four divisions, eight
-- teams, one park, two fields, one interleague contact, thirteen games, their
-- activity-log rows, and that owner's profiles.timezone. One field is created
-- in the "test" org (owner bbf9afe1-9e62-41e0-becc-895085bfc9d6, not a member
-- of SRALL) to be the wrong-org field, and that owner is the non-member
-- caller. NOTHING belonging to Santa Rosa American Little League is written —
-- the SRALL owner is also an admin there, which is why every fixture names the
-- SRALL org id explicitly.
--
-- ASSERTIONS (in order; a mutant must die FIRST at its own tag)
--   P1   privileges: authenticated only; not anon / service_role /
--        dashboard_readonly / PUBLIC; SECURITY DEFINER
--   AN1  anon cannot call it; a non-member is refused (42501); nothing written
--   PL1  a Free org is refused (plan_required); nothing written
--   IL1  an interleague game — scheduled or rained out — refused with
--        interleague_not_supported; pending_interleague and reschedule_pending
--        interleague games refused too; nothing written
--   ST1  a non-interleague `completed` or `reschedule_pending` game refused
--        with status_not_eligible
--   TZ1  a played date equal to UTC's today, when the org's today is still the
--        day before, is refused (only exercisable 00:00–10:00 UTC — see NOTES)
--   TZ2  in three org timezones (Los Angeles, New York, Honolulu): today at
--        09:00 is accepted, tomorrow refused (played_date_in_future)
--   SS1  the day before the season starts refused (played_date_before_season);
--        the start date itself accepted; a season with no start date refuses
--   VN1  another org's field refused (venue_not_in_org); no field refused
--   IN1  a malformed or impossible time refused (invalid_scheduled_at); a
--        reason over 500 characters refused (reason_too_long)
--   OK1  a rained-out game in a LOCKED, posted division is corrected: status
--        scheduled, the new wall-clock time at +00, the new field; returns
--        was_posted and posted_kept true; the division is still locked
--   PS1  "Sent to parents" kept: posted true and posted_at EXACTLY as before
--   PS2  an ordinary edit (not a correction) still clears "Sent to parents"
--   PS3  a correction in a division that was NOT sent leaves it not sent
--   LG1  one activity-log row per correction, none for a refusal; event
--        game_played_recorded; the message names the old state, the new field
--        ("Park — Field") and the reason; a blank reason adds no "Reason:"
--
-- MUTANTS (each rewrites a REAL function inside its own rolled-back block;
-- KILLED only if the FIRST failure is its own tag)
--   MU1  interleague check removed                 → IL1
--   MU2  status filter removed                     → ST1
--   MU3  today computed in UTC, not the org's zone → TZ1 (window-dependent)
--   MU4  season-start check removed                → SS1
--   MU5  the posted restore drops posted_at        → PS1
--   MU6  ordinary edits also exempted (the 0096 trigger's UPDATE branch made
--        to clear nothing)                         → PS2
--   MU7  EXECUTE left on PUBLIC                    → P1
--   MU8  plan check removed                        → PL1
--
-- RUN LOG: see the bottom of this file after the run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

create temp table h106_fx on commit drop as
select
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as org,
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as nonmember,
  (now() at time zone 'America/Los_Angeles')::date as today_la,
  gen_random_uuid() as loc, gen_random_uuid() as v1, gen_random_uuid() as v2, gen_random_uuid() as v_foreign,
  gen_random_uuid() as io,
  gen_random_uuid() as s1, gen_random_uuid() as s_nostart,
  gen_random_uuid() as div_lock, gen_random_uuid() as div_open, gen_random_uuid() as div_ord,
  gen_random_uuid() as div_nostart,
  gen_random_uuid() as a1, gen_random_uuid() as a2, gen_random_uuid() as b1, gen_random_uuid() as b2,
  gen_random_uuid() as c1, gen_random_uuid() as c2, gen_random_uuid() as n1, gen_random_uuid() as n2,
  gen_random_uuid() as g_cx, gen_random_uuid() as g_sch, gen_random_uuid() as g_ord,
  gen_random_uuid() as g_il, gen_random_uuid() as g_il_cx, gen_random_uuid() as g_il_pi, gen_random_uuid() as g_il_rp,
  gen_random_uuid() as g_comp, gen_random_uuid() as g_rp,
  gen_random_uuid() as g_nostart, gen_random_uuid() as g_spare1, gen_random_uuid() as g_spare2, gen_random_uuid() as g_spare3,
  '2026-09-01 18:00:00+00'::timestamptz as posted_at_lock,
  '2026-09-02 18:00:00+00'::timestamptz as posted_at_ord;

-- Fixtures. Divisions are created UNLOCKED (the 0082 trigger refuses inserts
-- into a locked division) and locked after the games exist.
insert into public.locations (id, owner_id, name)
select loc, org, 'ZZ106 Park' from h106_fx;

insert into public.venues (id, owner_id, name, location_id)
select v1, org, 'ZZ106 Perry', null::uuid from h106_fx union all
select v2, org, 'ZZ106 Andrews', loc from h106_fx union all
select v_foreign, nonmember, 'ZZ106 Foreign Field', null::uuid from h106_fx;

insert into public.interleague_orgs (id, owner_id, name, admin_email)
select io, org, 'ZZ106 Northgate LL', 'zz106@example.com' from h106_fx;

insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
select s1,        'ZZ106 Season',   'Baseball', 'Fall 2026', org, today_la - 30, today_la + 30 from h106_fx union all
select s_nostart, 'ZZ106 No start', 'Baseball', 'Fall 2026', org, null::date,    today_la + 30 from h106_fx;

insert into public.divisions (id, league_id, name, settings)
select div_lock,    s1,        'ZZ106 Majors',  '{"game_duration": 120}'::jsonb from h106_fx union all
select div_open,    s1,        'ZZ106 Minors',  '{"game_duration": 90}'::jsonb from h106_fx union all
select div_ord,     s1,        'ZZ106 Rookies', '{"game_duration": 90}'::jsonb from h106_fx union all
select div_nostart, s_nostart, 'ZZ106 T-Ball',  '{"game_duration": 60}'::jsonb from h106_fx;

insert into public.teams (id, league_id, division_id, name)
select a1, s1, div_lock, 'ZZ106 Expos' from h106_fx union all
select a2, s1, div_lock, 'ZZ106 Bears' from h106_fx union all
select b1, s1, div_open, 'ZZ106 Cubs' from h106_fx union all
select b2, s1, div_open, 'ZZ106 Twins' from h106_fx union all
select c1, s1, div_ord,  'ZZ106 Mets' from h106_fx union all
select c2, s1, div_ord,  'ZZ106 Royals' from h106_fx union all
select n1, s_nostart, div_nostart, 'ZZ106 Owls' from h106_fx union all
select n2, s_nostart, div_nostart, 'ZZ106 Hawks' from h106_fx;

insert into public.games (id, league_id, home_team_id, away_team_id, venue_id, scheduled_at, status,
                          interleague_org_id, is_away, external_team_name)
select g_cx,      s1, a1, a2,         v1, (today_la - 5)::timestamp + time '10:00', 'cancelled',           null::uuid, false, null::text from h106_fx union all
select g_sch,     s1, b1, b2,         v1, (today_la - 4)::timestamp + time '10:00', 'scheduled',           null::uuid, false, null::text from h106_fx union all
select g_ord,     s1, c1, c2,         v1, (today_la + 4)::timestamp + time '10:00', 'scheduled',           null::uuid, false, null::text from h106_fx union all
select g_il,      s1, b1, null::uuid, v1, (today_la - 3)::timestamp + time '10:00', 'scheduled',           io, false, 'ZZ106 Rays' from h106_fx union all
select g_il_cx,   s1, b1, null::uuid, v1, (today_la - 3)::timestamp + time '12:00', 'cancelled',           io, false, 'ZZ106 Rays' from h106_fx union all
select g_il_pi,   s1, b1, null::uuid, v1, (today_la + 3)::timestamp + time '10:00', 'pending_interleague', io, false, null::text from h106_fx union all
select g_il_rp,   s1, b1, null::uuid, v1, (today_la + 3)::timestamp + time '12:00', 'reschedule_pending',  io, false, 'ZZ106 Rays' from h106_fx union all
select g_comp,    s1, b1, b2,         v1, (today_la - 2)::timestamp + time '10:00', 'completed',           null::uuid, false, null::text from h106_fx union all
select g_rp,      s1, b1, b2,         v1, (today_la - 2)::timestamp + time '12:00', 'reschedule_pending',  null::uuid, false, null::text from h106_fx union all
select g_nostart, s_nostart, n1, n2,  v1, (today_la - 2)::timestamp + time '10:00', 'cancelled',           null::uuid, false, null::text from h106_fx union all
select g_spare1,  s1, b2, b1,         v1, (today_la - 6)::timestamp + time '10:00', 'scheduled',           null::uuid, false, null::text from h106_fx union all
select g_spare2,  s1, b2, b1,         v1, (today_la - 7)::timestamp + time '10:00', 'cancelled',           null::uuid, false, null::text from h106_fx union all
select g_spare3,  s1, b2, b1,         v1, (today_la - 8)::timestamp + time '10:00', 'scheduled',           null::uuid, false, null::text from h106_fx;

-- Lock and "send" AFTER the games exist (inserts into a posted division
-- would clear it; inserts into a locked one are refused).
update public.divisions d set locked = true, posted = true, posted_at = fx.posted_at_lock
  from h106_fx fx where d.id = fx.div_lock;
update public.divisions d set posted = true, posted_at = fx.posted_at_ord
  from h106_fx fx where d.id = fx.div_ord;
update public.divisions d set posted = false, posted_at = null
  from h106_fx fx where d.id = fx.div_open;

-- Calls record_game_played as a user (or anon). 'OK <json>' or
-- 'ERR <sqlstate> <message>'.
create function pg_temp.h106_call(p_role text, p_uid uuid, p_game uuid, p_at text, p_venue uuid, p_reason text)
returns text
language plpgsql
as $fn$
declare
  v_j   jsonb;
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute 'select public.record_game_played($1, $2, $3, $4)' into v_j using p_game, p_at, p_venue, p_reason;
    v_out := 'OK ' || v_j::text;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

-- Runs a statement as a user. 'OK rows=N' or 'ERR <sqlstate> <message>'.
create function pg_temp.h106_try(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_n   integer;
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_out := 'OK rows=' || v_n;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

create function pg_temp.h106_at(p_date date, p_time text)
returns text language sql immutable as $fn$ select to_char(p_date, 'YYYY-MM-DD') || 'T' || p_time $fn$;

create function pg_temp.h106_set_tz(p_org uuid, p_tz text)
returns date
language plpgsql
as $fn$
begin
  update public.profiles set timezone = p_tz where id = p_org;
  return (now() at time zone p_tz)::date;
end;
$fn$;

-- The assertions. Returns {fails, notes}. Never throws: a crash is recorded
-- as a failure after the ones already collected, so they always print.
create function pg_temp.h106_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx       h106_fx%rowtype;
  v_fails  text[] := array[]::text[];
  v_notes  text[] := array[]::text[];
  v_fn     constant text := 'public.record_game_played(uuid, text, uuid, text)';
  v_txt    text;
  v_j      jsonb;
  v_today  date;
  v_utc    date;
  v_zone   text;
  v_g      public.games%rowtype;
  v_d      public.divisions%rowtype;
  v_n      integer;
  v_msg    text;
  v_ok     integer := 0;
  v_plan   text;
  z        text;
begin
  select * into fx from h106_fx;
  v_today := pg_temp.h106_set_tz(fx.org, 'America/Los_Angeles');

  begin
    -- ── P1 ──────────────────────────────────────────────────────────────────
    if not has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or has_function_privilege('dashboard_readonly', v_fn, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = v_fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
       or not (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      v_fails := array_append(v_fails, 'P1: privileges wrong (or not SECURITY DEFINER)');
    end if;

    -- ── AN1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('anon', null, fx.g_sch, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR 42501%' then
      v_fails := array_append(v_fails, 'AN1: anon called it: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.nonmember, fx.g_sch, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR 42501%not_authorized%' then
      v_fails := array_append(v_fails, 'AN1: a non-member was not refused: ' || v_txt);
    end if;
    select * into v_g from public.games where id = fx.g_sch;
    if v_g.scheduled_at <> ((fx.today_la - 4)::timestamp + time '10:00') at time zone 'UTC' or v_g.venue_id <> fx.v1 then
      v_fails := array_append(v_fails, 'AN1: a refused call changed the game');
    end if;

    -- ── PL1 ─────────────────────────────────────────────────────────────────
    select plan into v_plan from public.profiles where id = fx.org;
    update public.profiles set plan = 'free' where id = fx.org;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_sch, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    update public.profiles set plan = v_plan where id = fx.org;
    if v_txt not like 'ERR P0001 plan_required%' then
      v_fails := array_append(v_fails, 'PL1: a Free org was not refused: ' || v_txt);
    end if;
    select * into v_g from public.games where id = fx.g_sch;
    if v_g.venue_id <> fx.v1 then
      v_fails := array_append(v_fails, 'PL1: a Free org''s refused call changed the game');
    end if;

    -- ── IL1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_il, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001 interleague_not_supported%' then
      v_fails := array_append(v_fails, 'IL1: a scheduled interleague game was not refused as interleague: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_il_cx, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001 interleague_not_supported%' then
      v_fails := array_append(v_fails, 'IL1: a rained-out interleague game was not refused as interleague: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_il_pi, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001%' then
      v_fails := array_append(v_fails, 'IL1: a pending_interleague game was corrected: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_il_rp, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001%' then
      v_fails := array_append(v_fails, 'IL1: a reschedule_pending interleague game was corrected: ' || v_txt);
    end if;
    if exists (select 1 from public.games where id in (fx.g_il, fx.g_il_cx, fx.g_il_pi, fx.g_il_rp) and venue_id = fx.v2) then
      v_fails := array_append(v_fails, 'IL1: an interleague game was written');
    end if;

    -- ── ST1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_comp, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001 status_not_eligible%' then
      v_fails := array_append(v_fails, 'ST1: a completed game was not refused by status: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_rp, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001 status_not_eligible%' then
      v_fails := array_append(v_fails, 'ST1: a reschedule_pending game was not refused by status: ' || v_txt);
    end if;

    -- ── TZ1 ─────────────────────────────────────────────────────────────────
    -- Find an allowed org zone whose date is still behind UTC's. US zones are
    -- all behind UTC, so this exists only 00:00–10:00 UTC (Honolulu is last).
    v_utc := (now() at time zone 'UTC')::date;
    v_zone := null;
    foreach z in array array['Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Phoenix',
                             'America/Denver', 'America/Chicago', 'America/New_York'] loop
      if (now() at time zone z)::date < v_utc then v_zone := z; exit; end if;
    end loop;
    if v_zone is null then
      v_notes := array_append(v_notes, format(
        'TZ1 NOT EXERCISED: at %s UTC every allowed org zone is on UTC''s date, so a UTC "today" is indistinguishable. Re-run between 00:00 and 10:00 UTC.',
        to_char(now() at time zone 'UTC', 'HH24:MI')));
    else
      perform pg_temp.h106_set_tz(fx.org, v_zone);
      v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare1, pg_temp.h106_at(v_utc, '09:00'), fx.v2, null);
      if v_txt not like 'ERR P0001 played_date_in_future%' then
        v_fails := array_append(v_fails, format('TZ1: in %s (today %s) UTC''s date %s was accepted: %s',
          v_zone, (now() at time zone v_zone)::date, v_utc, v_txt));
      end if;
      v_notes := array_append(v_notes, format('TZ1 exercised in %s (org today %s, UTC today %s)',
        v_zone, (now() at time zone v_zone)::date, v_utc));
      perform pg_temp.h106_set_tz(fx.org, 'America/Los_Angeles');
    end if;

    -- ── TZ2 ─────────────────────────────────────────────────────────────────
    foreach z in array array['America/Los_Angeles', 'America/New_York', 'Pacific/Honolulu'] loop
      v_today := pg_temp.h106_set_tz(fx.org, z);
      v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare1, pg_temp.h106_at(v_today, '09:00'), fx.v2, null);
      if v_txt not like 'OK %' then
        v_fails := array_append(v_fails, format('TZ2: in %s today (%s) was refused: %s', z, v_today, v_txt));
      else
        v_ok := v_ok + 1;
      end if;
      v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare1, pg_temp.h106_at(v_today + 1, '09:00'), fx.v2, null);
      if v_txt not like 'ERR P0001 played_date_in_future%' then
        v_fails := array_append(v_fails, format('TZ2: in %s tomorrow (%s) was not refused: %s', z, v_today + 1, v_txt));
      end if;
    end loop;
    v_today := pg_temp.h106_set_tz(fx.org, 'America/Los_Angeles');

    -- ── SS1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare2, pg_temp.h106_at(fx.today_la - 31, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001 played_date_before_season%' then
      v_fails := array_append(v_fails, 'SS1: the day before the season was not refused: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare2, pg_temp.h106_at(fx.today_la - 30, '09:00'), fx.v2, null);
    if v_txt not like 'OK %' then
      v_fails := array_append(v_fails, 'SS1: the season''s start date was refused: ' || v_txt);
    else
      v_ok := v_ok + 1;
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_nostart, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, null);
    if v_txt not like 'ERR P0001 season_has_no_start_date%' then
      v_fails := array_append(v_fails, 'SS1: a season with no start date was not refused: ' || v_txt);
    end if;

    -- ── VN1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare3, pg_temp.h106_at(v_today - 1, '09:00'), fx.v_foreign, null);
    if v_txt not like 'ERR P0001 venue_not_in_org%' then
      v_fails := array_append(v_fails, 'VN1: another org''s field was accepted: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare3, pg_temp.h106_at(v_today - 1, '09:00'), null, null);
    if v_txt not like 'ERR P0001 venue_not_in_org%' then
      v_fails := array_append(v_fails, 'VN1: no field was accepted: ' || v_txt);
    end if;

    -- ── IN1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare3, 'yesterday', fx.v2, null);
    if v_txt not like 'ERR P0001 invalid_scheduled_at%' then
      v_fails := array_append(v_fails, 'IN1: a malformed time was accepted: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare3, to_char(v_today, 'YYYY') || '-02-30T09:00', fx.v2, null);
    if v_txt not like 'ERR P0001 invalid_scheduled_at%' then
      v_fails := array_append(v_fails, 'IN1: an impossible date was accepted: ' || v_txt);
    end if;
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_spare3, pg_temp.h106_at(v_today - 1, '09:00'), fx.v2, repeat('x', 501));
    if v_txt not like 'ERR P0001 reason_too_long%' then
      v_fails := array_append(v_fails, 'IN1: a 501-character reason was accepted: ' || v_txt);
    end if;

    -- ── OK1 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_cx, pg_temp.h106_at(v_today - 2, '15:30'), fx.v2,
                               '  Coaches played it Tuesday  ');
    if v_txt not like 'OK %' then
      v_fails := array_append(v_fails, 'OK1: correcting a rained-out game in a locked division failed: ' || v_txt);
    else
      v_ok := v_ok + 1;
      v_j := substr(v_txt, 4)::jsonb;
      select * into v_g from public.games where id = fx.g_cx;
      select * into v_d from public.divisions where id = fx.div_lock;
      if v_g.status <> 'scheduled'
         or v_g.scheduled_at <> ((v_today - 2)::timestamp + time '15:30') at time zone 'UTC'
         or v_g.venue_id <> fx.v2
         or not v_d.locked
         or (v_j ->> 'was_posted') <> 'true' or (v_j ->> 'posted_kept') <> 'true'
         or (v_j ->> 'previous_status') <> 'cancelled' then
        v_fails := array_append(v_fails, format('OK1: wrong result: status=%s at=%s venue_ok=%s locked=%s json=%s',
          v_g.status, v_g.scheduled_at, v_g.venue_id = fx.v2, v_d.locked, v_j));
      end if;
    end if;

    -- ── PS1 ─────────────────────────────────────────────────────────────────
    select * into v_d from public.divisions where id = fx.div_lock;
    if not v_d.posted or v_d.posted_at is distinct from fx.posted_at_lock then
      v_fails := array_append(v_fails, format('PS1: "Sent to parents" not kept exactly: posted=%s posted_at=%s (was %s)',
        v_d.posted, v_d.posted_at, fx.posted_at_lock));
    end if;

    -- ── PS2 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_try('authenticated', fx.org,
      format('update public.games set scheduled_at = scheduled_at + interval ''1 hour'' where id = %L', fx.g_ord));
    select * into v_d from public.divisions where id = fx.div_ord;
    if v_txt <> 'OK rows=1' or v_d.posted or v_d.posted_at is not null then
      v_fails := array_append(v_fails, format('PS2: an ordinary edit did not clear "Sent to parents": %s posted=%s', v_txt, v_d.posted));
    end if;

    -- ── PS3 ─────────────────────────────────────────────────────────────────
    v_txt := pg_temp.h106_call('authenticated', fx.org, fx.g_sch, pg_temp.h106_at(v_today - 1, '11:00'), fx.v1, '');
    select * into v_d from public.divisions where id = fx.div_open;
    if v_txt not like 'OK %' or v_d.posted or v_d.posted_at is not null
       or (case when v_txt like 'OK %' then substr(v_txt, 4)::jsonb ->> 'posted_kept' end) is distinct from 'false' then
      v_fails := array_append(v_fails, format('PS3: a correction in an unsent division: %s posted=%s', v_txt, v_d.posted));
    else
      v_ok := v_ok + 1;
    end if;

    -- ── LG1 ─────────────────────────────────────────────────────────────────
    select count(*) into v_n from public.activity_log where league_id in (fx.s1, fx.s_nostart);
    if v_n <> v_ok then
      v_fails := array_append(v_fails, format('LG1: %s activity-log rows for %s corrections', v_n, v_ok));
    end if;
    select message into v_msg from public.activity_log
     where league_id = fx.s1 and division_id = fx.div_lock and event_type = 'game_played_recorded';
    if v_msg is null
       or v_msg not like 'ZZ106 Expos vs ZZ106 Bears recorded as played % at 3:30 PM — ZZ106 Park — ZZ106 Andrews (correction; was rained out % at 10:00 AM — ZZ106 Perry). Reason: Coaches played it Tuesday' then
      v_fails := array_append(v_fails, 'LG1: correction log message wrong: ' || coalesce(v_msg, 'missing'));
    end if;
    select message into v_msg from public.activity_log
     where league_id = fx.s1 and division_id = fx.div_open and event_type = 'game_played_recorded'
       and message like 'ZZ106 Cubs vs ZZ106 Twins%';
    if v_msg is null or v_msg like '%Reason:%' or v_msg not like '%(correction; was scheduled %' then
      v_fails := array_append(v_fails, 'LG1: blank-reason log message wrong: ' || coalesce(v_msg, 'missing'));
    end if;
  exception when others then
    v_fails := array_append(v_fails, 'CRASH: ' || sqlstate || ' ' || sqlerrm);
  end;

  return jsonb_build_object('fails', to_jsonb(v_fails), 'notes', to_jsonb(v_notes));
end;
$fn$;

do $h106$
declare
  v_out     text := E'\n';
  v_m       jsonb;
  v_first   text;
  v_tag     text;
  v_def     text;
  v_mut     text;
  v_pre_cdp text;
  m         record;
  v_fn      constant text := 'public.record_game_played(uuid, text, uuid, text)';
  v_cdp     constant text := 'public.clear_division_posted()';
begin
  v_pre_cdp := (select md5(prosrc) from pg_proc where oid = v_cdp::regprocedure);

  execute $mig106$
-- @@MIGRATION_0106@@
$mig106$;

  -- Baseline, in its own rolled-back block like every mutant.
  begin
    v_m := pg_temp.h106_assert();
    raise exception 'H106_RESULT %', v_m::text;
  exception when others then
    if sqlerrm like 'H106_RESULT %' then
      v_m := substr(sqlerrm, 13)::jsonb;
      v_out := v_out || format(E'BASELINE failures (%s): %s\nNOTES: %s\n',
        jsonb_array_length(v_m -> 'fails'), v_m -> 'fails', v_m -> 'notes');
    else
      v_out := v_out || format(E'BASELINE CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  for m in
    select * from (values
      ('MU1', 'interleague check removed', 'IL1', v_fn,
        $a$if v_game.interleague_org_id is not null then$a$, $a$if false then$a$, null::text, null::text),
      ('MU2', 'status filter removed', 'ST1', v_fn,
        $a$if v_game.status not in ('cancelled', 'scheduled') then$a$, $a$if false then$a$, null, null),
      ('MU3', 'today computed in UTC', 'TZ1', v_fn,
        $a$v_today := (now() at time zone v_tz)::date;$a$, $a$v_today := (now() at time zone 'UTC')::date;$a$, null, null),
      ('MU4', 'season-start check removed', 'SS1', v_fn,
        $a$if v_played_date < v_league.start_date then$a$, $a$if false then$a$, null, null),
      ('MU5', 'posted restore drops posted_at', 'PS1', v_fn,
        $a$set posted = true, posted_at = v_posted_at$a$, $a$set posted = true$a$, null, null),
      ('MU6', 'ordinary edits also exempted (0096 UPDATE branch clears nothing)', 'PS2', v_cdp,
        $a$join oldrows o on o.id = n.id$a$, $a$join oldrows o on o.id = n.id and false$a$,
        $a$join newrows n on n.id = o.id$a$, $a$join newrows n on n.id = o.id and false$a$),
      ('MU7', 'EXECUTE left on PUBLIC', 'P1', null,
        null, $a$grant execute on function public.record_game_played(uuid, text, uuid, text) to public$a$, null, null),
      ('MU8', 'plan check removed', 'PL1', v_fn,
        $a$if v_plan is null or v_plan not in ('pro', 'elite') then$a$, $a$if false then$a$, null, null)
    ) as t(id, what, target, fn, find, repl, find2, repl2)
  loop
    begin
      if m.fn is null then
        execute m.repl;
      else
        v_def := pg_get_functiondef(m.fn::regprocedure);
        v_mut := replace(v_def, m.find, m.repl);
        if m.find2 is not null then
          v_mut := replace(v_mut, m.find2, m.repl2);
        end if;
        if v_mut = v_def or (m.find2 is not null and position(m.repl2 in v_mut) = 0) then
          raise exception 'MUTANT_NOOP';
        end if;
        execute v_mut;
      end if;
      v_m := pg_temp.h106_assert();
      raise exception 'H106_RESULT %', v_m::text;
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm like 'H106_RESULT %' then
        v_m := substr(sqlerrm, 13)::jsonb;
        v_first := v_m -> 'fails' ->> 0;
        v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
        v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
          m.id, m.what,
          case when v_first is null then 'SURVIVED'
               when v_tag = m.target then 'KILLED'
               else 'KILLED AT THE WRONG ASSERTION' end,
          v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      else
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  v_out := v_out || format(E'prosrc md5 record_game_played: %s\nclear_division_posted md5 before %s, after %s\n',
    (select md5(prosrc) from pg_proc where oid = v_fn::regprocedure),
    v_pre_cdp,
    (select md5(prosrc) from pg_proc where oid = v_cdp::regprocedure));

  raise exception '%', v_out;
end;
$h106$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname = 'record_game_played') as fn_must_be_0,
--   (select count(*) from leagues where name like 'ZZ106%') + (select count(*) from venues where name like 'ZZ106%')
--     + (select count(*) from locations where name like 'ZZ106%') + (select count(*) from interleague_orgs where name like 'ZZ106%')
--     + (select count(*) from activity_log where event_type = 'game_played_recorded') as fixtures_must_be_0,
--   (select timezone from profiles where id = 'aa21d01c-66dc-4c37-b15c-7b743c557eea') as srall_tz_unchanged,
--   (select plan from profiles where id = 'aa21d01c-66dc-4c37-b15c-7b743c557eea') as srall_plan_unchanged,
--   (select md5(prosrc) from pg_proc where proname = 'clear_division_posted') as cdp_md5_unchanged;

-- ── RUN LOG ─────────────────────────────────────────────────────────────────
-- 2026-10-08 19:41 UTC — against production, test org "SRALL" fixtures only
-- (plus one field in the "test" org as the wrong-org field), rolled back. No
-- other active backend and no idle transaction before the run.
-- Run 1: GREEN.
--   BASELINE failures (0): []
--   NOTE: TZ1 NOT EXERCISED — at 19:41 UTC every allowed org zone is on UTC's
--     date, so a UTC "today" is indistinguishable from the org's.
--   MU1 interleague check removed       → KILLED, first failure [IL1] (the
--       defence-in-depth WHERE then refused it as nothing_saved — the
--       assertion checks the refusal's NAME, which is what caught it)
--   MU2 status filter removed           → KILLED, first failure [ST1] (same
--       shape: nothing_saved, not status_not_eligible)
--   MU3 today computed in UTC           → SURVIVED — EXPECTED at this hour;
--       re-run between 00:00 and 10:00 UTC (5pm–3am Pacific) to kill it
--   MU4 season-start check removed      → KILLED, first failure [SS1]
--   MU5 posted restore drops posted_at  → KILLED, first failure [PS1]
--   MU6 ordinary edits also exempted    → KILLED, first failure [PS2]
--   MU7 EXECUTE left on PUBLIC          → KILLED, first failure [P1]
--   prosrc md5 record_game_played inside the batch:
--   5cb17bbb48d1adb22005d4c081ce8823 — equal to the body computed from the
--   repo file. clear_division_posted md5 e1a0932427550ddbca0725f6f7620855
--   before and after (MU6's rewrite rolled back).
-- Leak check after: function 0, ZZ106 fixtures + game_played_recorded log rows
-- 0, SRALL timezone America/Los_Angeles, clear_division_posted md5 unchanged.
--
-- 2026-10-08 19:55 UTC — Run 2, after adding the plan check (PL1, MU8).
-- Same fixtures, same scope, no other active backend. The batch carried the
-- migration from `create or replace function` on (the file-header comments
-- are not stored by Postgres); md5(prosrc) proves the body is the repo's.
--   BASELINE failures (0): []
--   NOTE: TZ1 NOT EXERCISED (19:55 UTC)
--   MU1 → KILLED [IL1]   MU2 → KILLED [ST1]   MU3 → SURVIVED (window, expected)
--   MU4 → KILLED [SS1]   MU5 → KILLED [PS1]   MU6 → KILLED [PS2]
--   MU7 → KILLED [P1]    MU8 plan check removed → KILLED [PL1]
--   prosrc md5 record_game_played: bab8adef7841de9abe9709854e900b28 — equal
--   to the body computed from the repo file. clear_division_posted md5
--   e1a0932427550ddbca0725f6f7620855 before and after.
-- Leak check after: function 0, fixtures 0, SRALL timezone
-- America/Los_Angeles, SRALL plan elite, clear_division_posted unchanged.
-- 0106 NOT APPLIED — waiting on the founder for timing. MU3 still owes a run
-- inside the 00:00–10:00 UTC window.
