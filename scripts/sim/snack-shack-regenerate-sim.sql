-- SQL-level proof for migration 0103 (snack shack — derived shifts: rule
-- columns, absorb choices, atomic regenerate).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- is a SECURITY DEFINER function's atomicity, an is_org_member gate, RLS on a
-- new table, and grants — exercised as the `authenticated` role. The
-- in-memory fake client cannot model any of that. NOT `npm run`-able, NOT in
-- CI. The TypeScript library that computes the desired shifts has its own
-- harness (`npm run sim:snack-shifts`); this one proves the DATABASE half.
--
-- THIS HARNESS APPLIES 0103 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK. It is the proof to run BEFORE the migration is applied for real. It
-- leaves nothing behind: no column, no table, no function, no row.
--
-- HOW TO RUN
--   1. `npx tsx scripts/sim/snack-shack-regenerate-build.ts > <file>`
--      substitutes the LITERAL text of
--      supabase/migrations/0103_snack_shack_derived_shifts.sql for the
--      placeholder line below, so what is proven is the file that will be
--      applied, not a copy that can drift.
--   2. Send the whole output as ONE batch through the Supabase MCP
--      (execute_sql). A batch runs in a single transaction.
--   3. The last statement ALWAYS raises. The raised message IS the result.
--      Everything — the timeouts, the helpers, the fixtures, the migration,
--      every mutant — rolls back with it.
--   4. Run the leak check afterwards (bottom of this file).
--   Get an explicit go-ahead first (the lock below).
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: one to two seconds)
--   ACCESS EXCLUSIVE on public.snack_shack_settings, from ADD COLUMN / ADD
--   CONSTRAINT (3 rows today, no rewrite). It BLOCKS READS AND WRITES of that
--   table from the live app — the Snack Shack page load, the venue delete
--   guard (it counts home_venue_ids), the Teams page's per-team snack button
--   (its embed joins settings), and the two snack shack email routes — for
--   the whole batch. lock_timeout = 3s means the run gives up rather than
--   queueing behind a live reader; statement_timeout = 60s bounds the whole
--   thing. Nothing else is locked beyond ordinary row locks on the fixture
--   rows (ROW EXCLUSIVE on leagues, divisions, teams, snack_shack_blocks —
--   these do not block anyone).
--
-- ROWS TOUCHED (all rolled back; all belong to the "test" org,
-- owner bbf9afe1-9e62-41e0-becc-895085bfc9d6, NEVER the real league):
--   two fixture leagues ("H103 Fixture A/B"), one division, five teams, one
--   snack_shack_settings row (inserted BEFORE the migration, so the column
--   defaults are proven on a pre-existing row), four snack_shack_blocks rows
--   (three derived, one manual), and absorb-choice rows. Every other row in
--   the database is only READ: the md5 of all pre-existing snack_shack_blocks
--   and snack_shack_settings rows is taken before the fixtures and the
--   migration and asserted unchanged after.
--
-- IMPERSONATION: `set local role authenticated` plus request.jwt.claims.sub,
-- exactly what PostgREST does for a signed-in browser. Assertions are read
-- back as postgres.
--
-- ASSERTIONS (tag: what)
--   M1   a settings row that existed BEFORE the migration reads 30/30/120
--        and a null shifts_generated_at afterwards (existing data untouched,
--        defaults applied)
--   M2   every pre-existing snack_shack_blocks row and every pre-existing
--        settings row (its original columns) is byte-identical after the
--        migration
--   P1   privileges: the function — anon no, authenticated yes, service_role
--        no, dashboard_readonly no; the absorb table — authenticated
--        select/insert/update/delete, nobody else anything
--   R3   after a regenerate, the MANUAL row is still there, same id, same
--        team (checked FIRST, so a mutant that deletes it dies here)
--   R1   kept=2 / created=2 / removed=1; the two kept rows keep their ids;
--        removed_assignments names the 13:30–15:30 row and its team;
--        created_shifts names the two new slots
--   R2   the kept 09:30 row still belongs to Bears although the payload
--        passed Giants for that slot — a kept row's assignment is the
--        database's, never the caller's
--   R4   shifts_generated_at is stamped
--   R5   the same payload again: kept=4, created=0, removed=0 (idempotent)
--   R6   a signed-in NON-member is refused (not_authorized) and nothing changes
--   R7   anon is refused (permission denied — no EXECUTE)
--   R8   validation refuses, each with nothing changed: a duplicate slot,
--        end not after start, a team from another season, a bad date, a
--        non-array
--   R9   ATOMICITY: a payload whose LAST element is bad changes nothing —
--        the rows before it were not written
--   C1   absorb choices as a member: insert + read back; a second row for
--        the same (snack shack, date, window start) is refused (23505); a
--        bad choice is refused (23514)
--   C2   a signed-in non-member reads zero rows and cannot insert; anon is
--        refused
--
-- MUTANTS — each rewrites the REAL function body (pg_get_functiondef +
-- replace, asserted to have changed the text) inside its own rolled-back
-- block. KILLED only if the FIRST failure is the mutant's own tag.
--   PM1  the delete matches on date+start only (end ignored)   → R1
--   PM2  manual rows are deleted too                           → R3
--   PM3  the is_org_member gate removed                        → R6
--   PM4  the duplicate check removed                           → R8-dup
--   PM5  kept rows take the caller's assignment                → R2
--   PM6  the team-in-season check removed                      → R8-team
--
-- RUN LOG: see the bottom of this file after the run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

-- ── Snapshot of pre-existing rows (read-only) ────────────────────────────────
create temp table h103_snap on commit drop as
select
  (select md5(coalesce(string_agg(b::text, '|' order by b.id), ''))
     from public.snack_shack_blocks b) as blocks_md5,
  (select count(*) from public.snack_shack_blocks) as blocks_n,
  (select md5(coalesce(string_agg(
       s.id::text || s.season_id::text || s.start_date::text || s.end_date::text ||
       s.days_of_week::text || s.time_blocks_by_day::text || s.home_venue_ids::text ||
       s.scheduling_preference || s.created_at::text || s.updated_at::text, '|' order by s.id), ''))
     from public.snack_shack_settings s) as settings_md5,
  (select count(*) from public.snack_shack_settings) as settings_n;

-- ── Fixtures (all under the "test" org) ──────────────────────────────────────
create temp table h103_fx on commit drop as
select
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as owner,
  gen_random_uuid() as league_a,
  gen_random_uuid() as league_b,
  gen_random_uuid() as division_a,
  gen_random_uuid() as bears,
  gen_random_uuid() as cubs,
  gen_random_uuid() as expos,
  gen_random_uuid() as giants,
  gen_random_uuid() as other_team,
  gen_random_uuid() as snack,
  gen_random_uuid() as b1,
  gen_random_uuid() as b2,
  gen_random_uuid() as b3,
  gen_random_uuid() as m1,
  gen_random_uuid() as nobody;

insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
select league_a, 'H103 Fixture A', 'Baseball', 'Fall 2026', owner, '2026-11-01', '2026-12-20' from h103_fx
union all
select league_b, 'H103 Fixture B', 'Baseball', 'Fall 2026', owner, '2026-11-01', '2026-12-20' from h103_fx;

insert into public.divisions (id, league_id, name, settings)
select division_a, league_a, 'H103 Minors', '{"game_duration": 120, "buffer_minutes": 30, "playing_days": ["Sa"]}'::jsonb from h103_fx;

insert into public.teams (id, league_id, division_id, name)
select bears,  league_a, division_a, 'Bears'  from h103_fx union all
select cubs,   league_a, division_a, 'Cubs'   from h103_fx union all
select expos,  league_a, division_a, 'Expos'  from h103_fx union all
select giants, league_a, division_a, 'Giants' from h103_fx union all
select other_team, league_b, null, 'Other League Team' from h103_fx;

-- The settings row goes in BEFORE the migration: M1 proves the defaults land
-- on a row that already existed.
insert into public.snack_shack_settings (id, season_id, start_date, end_date, days_of_week, time_blocks_by_day, home_venue_ids, scheduling_preference)
select snack, league_a, '2026-11-01', '2026-12-20', '["Sa"]'::jsonb, '{}'::jsonb, '[]'::jsonb, 'prefer_off_days' from h103_fx;

-- Resets the fixture blocks to their starting state. Called at the top of
-- every assertion pass so each mutant sees the same rows.
create function pg_temp.h103_reset()
returns void
language plpgsql
as $fn$
declare fx h103_fx%rowtype;
begin
  select * into fx from h103_fx;
  delete from public.snack_shack_blocks where snack_shack_id = fx.snack;
  insert into public.snack_shack_blocks (id, snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring) values
    (fx.b1, fx.snack, '2026-11-07', '09:30', '11:30', fx.bears, true),
    (fx.b2, fx.snack, '2026-11-07', '11:30', '13:30', fx.cubs,  true),
    (fx.b3, fx.snack, '2026-11-07', '13:30', '15:30', fx.expos, true),
    (fx.m1, fx.snack, '2026-11-07', '08:00', '09:30', fx.giants, false);
  update public.snack_shack_settings set shifts_generated_at = null where id = fx.snack;
end;
$fn$;

-- Runs one statement as a role, reports what happened, and always returns to
-- postgres.
create function pg_temp.h103_try(p_role text, p_uid uuid, p_sql text)
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

-- Calls the RPC as a role. Returns its jsonb, or {"error": "<sqlstate> <msg>"}.
-- A raise inside the function rolls back everything the call wrote — the
-- same thing that happens to a PostgREST request.
create function pg_temp.h103_call(p_role text, p_uid uuid, p_snack uuid, p_shifts jsonb)
returns jsonb
language plpgsql
as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute 'select public.regenerate_snack_shack_shifts($1, $2)' into v using p_snack, p_shifts;
  exception when others then
    v := jsonb_build_object('error', sqlstate || ' ' || sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$fn$;

-- The whole RPC + absorb assertion set. Returns { fails: [...in order...] }.
create function pg_temp.h103_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx       h103_fx%rowtype;
  v_fails  text[] := array[]::text[];
  v_res    jsonb;
  v_txt    text;
  v_n      integer;
  v_team   uuid;
  v_id     uuid;
  v_ts     timestamptz;
  v_payload jsonb;
  v_before text;
  v_after  text;
begin
  select * into fx from h103_fx;
  perform pg_temp.h103_reset();

  -- The regenerate payload: two unchanged slots (the first carries a DIFFERENT
  -- team than the stored row, which must be ignored), one changed slot (the
  -- 13:30 shift now ends 16:00) and one new day.
  v_payload := jsonb_build_array(
    jsonb_build_object('date', '2026-11-07', 'start', '09:30', 'end', '11:30', 'assigned_team_id', fx.giants),
    jsonb_build_object('date', '2026-11-07', 'start', '11:30', 'end', '13:30', 'assigned_team_id', null),
    jsonb_build_object('date', '2026-11-07', 'start', '13:30', 'end', '16:00', 'assigned_team_id', fx.expos),
    jsonb_build_object('date', '2026-11-14', 'start', '09:30', 'end', '11:30', 'assigned_team_id', fx.giants)
  );

  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, v_payload);
  if v_res ? 'error' then
    v_fails := array_append(v_fails, 'R3: the regenerate call itself failed: ' || (v_res ->> 'error'));
    return jsonb_build_object('fails', to_jsonb(v_fails));
  end if;

  -- R3 — the manual row is untouched (checked FIRST).
  select count(*) into v_n from public.snack_shack_blocks
   where id = fx.m1 and snack_shack_id = fx.snack and not is_recurring
     and assigned_team_id = fx.giants and start_time = '08:00' and end_time = '09:30';
  if v_n <> 1 then
    v_fails := array_append(v_fails, 'R3: the manual row was touched by the regenerate');
  end if;

  -- R1 — counts, kept ids, reported assignments.
  if (v_res ->> 'kept')::int <> 2 or (v_res ->> 'created')::int <> 2 or (v_res ->> 'removed')::int <> 1 then
    v_fails := array_append(v_fails, 'R1: expected kept=2 created=2 removed=1, got ' || v_res::text);
  end if;
  select count(*) into v_n from public.snack_shack_blocks where id in (fx.b1, fx.b2) and is_recurring;
  if v_n <> 2 then
    v_fails := array_append(v_fails, 'R1: the two unchanged rows did not keep their ids');
  end if;
  if exists (select 1 from public.snack_shack_blocks where id = fx.b3) then
    v_fails := array_append(v_fails, 'R1: the superseded 13:30-15:30 row still exists');
  end if;
  if (v_res -> 'removed_assignments')::text <> jsonb_build_array(jsonb_build_object(
       'date', '2026-11-07', 'start', '13:30', 'end', '15:30', 'team_id', fx.expos))::text then
    v_fails := array_append(v_fails, 'R1: removed_assignments wrong: ' || (v_res -> 'removed_assignments')::text);
  end if;
  if jsonb_array_length(v_res -> 'created_shifts') <> 2
     or (v_res -> 'created_shifts' -> 0 ->> 'end') <> '16:00'
     or (v_res -> 'created_shifts' -> 1 ->> 'date') <> '2026-11-14' then
    v_fails := array_append(v_fails, 'R1: created_shifts wrong: ' || (v_res -> 'created_shifts')::text);
  end if;
  select count(*) into v_n from public.snack_shack_blocks where snack_shack_id = fx.snack and is_recurring;
  if v_n <> 4 then
    v_fails := array_append(v_fails, 'R1: expected 4 derived rows after, got ' || v_n);
  end if;
  select assigned_team_id into v_team from public.snack_shack_blocks
   where snack_shack_id = fx.snack and is_recurring and date = '2026-11-07' and start_time = '13:30' and end_time = '16:00';
  if v_team is distinct from fx.expos then
    v_fails := array_append(v_fails, 'R1: the created 13:30-16:00 row did not get the passed team');
  end if;

  -- R2 — the kept 09:30 row's assignment is the database's.
  select assigned_team_id into v_team from public.snack_shack_blocks where id = fx.b1;
  if v_team is distinct from fx.bears then
    v_fails := array_append(v_fails, 'R2: the kept 09:30 row took the caller''s team instead of keeping Bears');
  end if;

  -- R4 — stamped.
  select shifts_generated_at into v_ts from public.snack_shack_settings where id = fx.snack;
  if v_ts is null then
    v_fails := array_append(v_fails, 'R4: shifts_generated_at not stamped');
  end if;

  -- R5 — idempotent.
  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, v_payload);
  if (v_res ->> 'kept')::int is distinct from 4 or (v_res ->> 'created')::int is distinct from 0 or (v_res ->> 'removed')::int is distinct from 0 then
    v_fails := array_append(v_fails, 'R5: second identical call: expected kept=4 created=0 removed=0, got ' || v_res::text);
  end if;

  -- R6 — a signed-in non-member.
  select md5(string_agg(b::text, '|' order by b.id)) into v_before from public.snack_shack_blocks b where snack_shack_id = fx.snack;
  v_res := pg_temp.h103_call('authenticated', fx.nobody, fx.snack, '[]'::jsonb);
  select md5(string_agg(b::text, '|' order by b.id)) into v_after from public.snack_shack_blocks b where snack_shack_id = fx.snack;
  if not (v_res ? 'error') or (v_res ->> 'error') not like '%not_authorized%' or v_before is distinct from v_after then
    v_fails := array_append(v_fails, 'R6: a non-member was not refused with not_authorized, or rows changed: ' || v_res::text);
  end if;

  -- R7 — anon.
  v_res := pg_temp.h103_call('anon', null, fx.snack, '[]'::jsonb);
  if not (v_res ? 'error') or (v_res ->> 'error') not like '42501%' then
    v_fails := array_append(v_fails, 'R7: anon was not refused with permission denied: ' || v_res::text);
  end if;

  -- R8 — validation, each with nothing changed.
  select md5(string_agg(b::text, '|' order by b.id)) into v_before from public.snack_shack_blocks b where snack_shack_id = fx.snack;
  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, v_payload || jsonb_build_array(
    jsonb_build_object('date', '2026-11-14', 'start', '09:30:00', 'end', '11:30:00', 'assigned_team_id', null)));
  if not (v_res ? 'error') or (v_res ->> 'error') not like '%duplicate_shift%' then
    v_fails := array_append(v_fails, 'R8-dup: a duplicate slot (with seconds) was not refused: ' || v_res::text);
  end if;
  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, jsonb_build_array(
    jsonb_build_object('date', '2026-11-21', 'start', '11:30', 'end', '11:30', 'assigned_team_id', null)));
  if not (v_res ? 'error') or (v_res ->> 'error') not like '%end_not_after_start%' then
    v_fails := array_append(v_fails, 'R8-end: end = start was not refused: ' || v_res::text);
  end if;
  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, jsonb_build_array(
    jsonb_build_object('date', '2026-11-21', 'start', '09:30', 'end', '11:30', 'assigned_team_id', fx.other_team)));
  if not (v_res ? 'error') or (v_res ->> 'error') not like '%team_not_in_season%' then
    v_fails := array_append(v_fails, 'R8-team: a team from another season was not refused: ' || v_res::text);
  end if;
  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, jsonb_build_array(
    jsonb_build_object('date', '11/21/2026', 'start', '09:30', 'end', '11:30', 'assigned_team_id', null)));
  if not (v_res ? 'error') or (v_res ->> 'error') not like '%bad_date%' then
    v_fails := array_append(v_fails, 'R8-date: a bad date was not refused: ' || v_res::text);
  end if;
  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, '{"date": "2026-11-21"}'::jsonb);
  if not (v_res ? 'error') or (v_res ->> 'error') not like '%shifts_not_array%' then
    v_fails := array_append(v_fails, 'R8-array: a non-array was not refused: ' || v_res::text);
  end if;
  select md5(string_agg(b::text, '|' order by b.id)) into v_after from public.snack_shack_blocks b where snack_shack_id = fx.snack;
  if v_before is distinct from v_after then
    v_fails := array_append(v_fails, 'R8: rows changed during refused calls');
  end if;

  -- R9 — atomicity: valid rows first, a bad one LAST.
  v_res := pg_temp.h103_call('authenticated', fx.owner, fx.snack, jsonb_build_array(
    jsonb_build_object('date', '2026-12-05', 'start', '09:30', 'end', '11:30', 'assigned_team_id', fx.cubs),
    jsonb_build_object('date', '2026-12-05', 'start', '11:30', 'end', '13:30', 'assigned_team_id', fx.bears),
    jsonb_build_object('date', '2026-12-05', 'start', '13:30', 'end', '12:00', 'assigned_team_id', null)));
  select md5(string_agg(b::text, '|' order by b.id)) into v_after from public.snack_shack_blocks b where snack_shack_id = fx.snack;
  if not (v_res ? 'error') or v_before is distinct from v_after then
    v_fails := array_append(v_fails, 'R9: a payload with a bad last element changed rows: ' || v_res::text);
  end if;

  -- C1 — absorb choices as a member.
  delete from public.snack_shack_absorb_choices where snack_shack_id = fx.snack;
  v_txt := pg_temp.h103_try('authenticated', fx.owner, format(
    'insert into public.snack_shack_absorb_choices (snack_shack_id, date, window_start, choice) values (%L, %L, %L, %L)',
    fx.snack, '2026-11-07', '09:30', 'first'));
  if v_txt <> 'OK rows=1' then
    v_fails := array_append(v_fails, 'C1: a member could not insert a choice: ' || v_txt);
  end if;
  v_txt := pg_temp.h103_try('authenticated', fx.owner, format(
    'select 1 from public.snack_shack_absorb_choices where snack_shack_id = %L and date = %L and window_start = %L and choice = %L',
    fx.snack, '2026-11-07', '09:30', 'first'));
  if v_txt <> 'OK rows=1' then
    v_fails := array_append(v_fails, 'C1: a member could not read the choice back: ' || v_txt);
  end if;
  v_txt := pg_temp.h103_try('authenticated', fx.owner, format(
    'insert into public.snack_shack_absorb_choices (snack_shack_id, date, window_start, choice) values (%L, %L, %L, %L)',
    fx.snack, '2026-11-07', '09:30:00', 'split'));
  if v_txt not like 'ERR 23505%' then
    v_fails := array_append(v_fails, 'C1: a second choice for the same date + window start was not refused: ' || v_txt);
  end if;
  v_txt := pg_temp.h103_try('authenticated', fx.owner, format(
    'insert into public.snack_shack_absorb_choices (snack_shack_id, date, window_start, choice) values (%L, %L, %L, %L)',
    fx.snack, '2026-11-14', '09:30', 'middle'));
  if v_txt not like 'ERR 23514%' then
    v_fails := array_append(v_fails, 'C1: a bad choice value was not refused: ' || v_txt);
  end if;
  v_txt := pg_temp.h103_try('authenticated', fx.owner, format(
    'update public.snack_shack_absorb_choices set choice = %L where snack_shack_id = %L and date = %L', 'split', fx.snack, '2026-11-07'));
  if v_txt <> 'OK rows=1' then
    v_fails := array_append(v_fails, 'C1: a member could not change a choice: ' || v_txt);
  end if;

  -- C2 — a non-member and anon.
  v_txt := pg_temp.h103_try('authenticated', fx.nobody, format(
    'select 1 from public.snack_shack_absorb_choices where snack_shack_id = %L', fx.snack));
  if v_txt <> 'OK rows=0' then
    v_fails := array_append(v_fails, 'C2: a non-member saw the choices: ' || v_txt);
  end if;
  v_txt := pg_temp.h103_try('authenticated', fx.nobody, format(
    'insert into public.snack_shack_absorb_choices (snack_shack_id, date, window_start, choice) values (%L, %L, %L, %L)',
    fx.snack, '2026-11-28', '09:30', 'last'));
  if v_txt not like 'ERR 42501%' then
    v_fails := array_append(v_fails, 'C2: a non-member inserted a choice: ' || v_txt);
  end if;
  v_txt := pg_temp.h103_try('anon', null, format(
    'select 1 from public.snack_shack_absorb_choices where snack_shack_id = %L', fx.snack));
  if v_txt not like 'ERR 42501%' then
    v_fails := array_append(v_fails, 'C2: anon could read the choices table: ' || v_txt);
  end if;

  return jsonb_build_object('fails', to_jsonb(v_fails));
end;
$fn$;

-- ── The migration, applied verbatim inside this transaction ─────────────────
do $h103$
declare
  v_fails  text[] := array[]::text[];
  v_out    text := E'\n';
  fx       h103_fx%rowtype;
  s        public.snack_shack_settings%rowtype;
  v_m      jsonb;
  v_first  text;
  v_tag    text;
  v_def    text;
  v_mut    text;
  v_bmd5   text;
  v_smd5   text;
  m        record;
  v_fn     constant text := 'public.regenerate_snack_shack_shifts(uuid, jsonb)';
  v_tbl    constant text := 'public.snack_shack_absorb_choices';
  r        record;
begin
  select * into fx from h103_fx;

  execute $mig103$
-- @@MIGRATION_0103@@
$mig103$;

  -- M1 — the pre-existing settings row got the defaults.
  select * into s from public.snack_shack_settings where id = fx.snack;
  if s.open_before_min <> 30 or s.close_after_min <> 30 or s.max_shift_min <> 120 or s.shifts_generated_at is not null then
    v_fails := array_append(v_fails, format('M1: defaults wrong: %s/%s/%s/%s', s.open_before_min, s.close_after_min, s.max_shift_min, s.shifts_generated_at));
  end if;

  -- M2 — pre-existing rows byte-identical (fixture rows excluded).
  select md5(coalesce(string_agg(b::text, '|' order by b.id), '')) into v_bmd5
    from public.snack_shack_blocks b where b.snack_shack_id <> fx.snack;
  select md5(coalesce(string_agg(
       x.id::text || x.season_id::text || x.start_date::text || x.end_date::text ||
       x.days_of_week::text || x.time_blocks_by_day::text || x.home_venue_ids::text ||
       x.scheduling_preference || x.created_at::text || x.updated_at::text, '|' order by x.id), '')) into v_smd5
    from public.snack_shack_settings x where x.id <> fx.snack;
  if v_bmd5 is distinct from (select blocks_md5 from h103_snap)
     or (select count(*) from public.snack_shack_blocks b where b.snack_shack_id <> fx.snack) <> (select blocks_n from h103_snap) then
    v_fails := array_append(v_fails, 'M2: pre-existing snack_shack_blocks rows changed');
  end if;
  if v_smd5 is distinct from (select settings_md5 from h103_snap)
     or (select count(*) from public.snack_shack_settings x where x.id <> fx.snack) <> (select settings_n from h103_snap) then
    v_fails := array_append(v_fails, 'M2: pre-existing snack_shack_settings rows changed');
  end if;

  -- P1 — privileges.
  if has_function_privilege('anon', v_fn, 'execute') or not has_function_privilege('authenticated', v_fn, 'execute')
     or has_function_privilege('service_role', v_fn, 'execute') or has_function_privilege('dashboard_readonly', v_fn, 'execute') then
    v_fails := array_append(v_fails, 'P1: function privileges wrong');
  end if;
  for r in select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as priv loop
    if not has_table_privilege('authenticated', v_tbl, r.priv) or has_table_privilege('anon', v_tbl, r.priv)
       or has_table_privilege('service_role', v_tbl, r.priv) or has_table_privilege('dashboard_readonly', v_tbl, r.priv) then
      v_fails := array_append(v_fails, 'P1: table privilege wrong for ' || r.priv);
    end if;
  end loop;

  -- Baseline.
  v_m := pg_temp.h103_assert();
  v_fails := v_fails || array(select jsonb_array_elements_text(v_m -> 'fails'));
  v_out := v_out || format(E'BASELINE failures (%s): %s\n', coalesce(array_length(v_fails, 1), 0), to_jsonb(v_fails));

  -- Mutants.
  for m in
    select * from (values
      ('PM1', 'delete matches on date+start only (end ignored)', 'R1',
        $a$          and (e ->> 'end')::time   = b.end_time$a$, $a$          and true$a$),
      ('PM2', 'manual rows deleted too', 'R3',
        $a$    where b.snack_shack_id = p_snack_shack_id
      and b.is_recurring
      and not exists ($a$, $a$    where b.snack_shack_id = p_snack_shack_id
      and not exists ($a$),
      ('PM3', 'is_org_member gate removed', 'R6',
        $a$  if not public.is_org_member(v_league.owner_id) then$a$, $a$  if false then$a$),
      ('PM4', 'duplicate check removed', 'R8-dup',
        $a$  if v_n <> v_distinct then$a$, $a$  if false then$a$),
      ('PM5', 'kept rows take the caller''s assignment', 'R2',
        $a$  -- Kept rows are never updated: what survived the delete IS the kept set,
  -- assignment and all. (kept rows are never updated)$a$,
        $a$  update public.snack_shack_blocks b set assigned_team_id = nullif(e ->> 'assigned_team_id', '')::uuid
    from jsonb_array_elements(p_shifts) e
   where b.snack_shack_id = p_snack_shack_id and b.is_recurring
     and b.date = (e ->> 'date')::date and b.start_time = (e ->> 'start')::time and b.end_time = (e ->> 'end')::time;$a$),
      ('PM6', 'team-in-season check removed', 'R8-team',
        $a$      if not exists (select 1 from public.teams t where t.id = v_team::uuid and t.league_id = v_settings.season_id) then$a$,
        $a$      if false then$a$)
    ) as t(id, what, target, find, repl)
  loop
    begin
      v_def := pg_get_functiondef('public.regenerate_snack_shack_shifts(uuid, jsonb)'::regprocedure);
      v_mut := replace(v_def, m.find, m.repl);
      if v_mut = v_def then
        raise exception 'MUTANT_NOOP';
      end if;
      execute v_mut;
      v_m := pg_temp.h103_assert();
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      raise exception 'H103_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H103_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  -- After the mutants: the unmutated function must still be green.
  v_m := pg_temp.h103_assert();
  v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');
  v_out := v_out || format(E'prosrc md5 (apply-time check): %s\n',
    (select md5(p.prosrc) from pg_proc p where p.oid = 'public.regenerate_snack_shack_shifts(uuid, jsonb)'::regprocedure));

  -- ALWAYS raise: this is what rolls everything back.
  raise exception '%', v_out;
end;
$h103$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from information_schema.columns where table_name = 'snack_shack_settings' and column_name = 'open_before_min') as cols_must_be_0,
--   (select count(*) from pg_class where relname = 'snack_shack_absorb_choices') as tbl_must_be_0,
--   (select count(*) from pg_proc where proname = 'regenerate_snack_shack_shifts') as fn_must_be_0,
--   (select count(*) from leagues where name like 'H103 Fixture%') as leagues_must_be_0,
--   (select md5(coalesce(string_agg(b::text, '|' order by b.id), '')) from snack_shack_blocks b) as blocks_md5_must_match_pre_run;
