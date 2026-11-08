-- SQL-level proof for migration 0119 (snack shack — people per shift: a
-- season number, a per-shift override, carried by the regenerate RPC).
--
-- WHY SQL: the behavior is CHECK constraints, column defaults on existing
-- rows, grants/RLS, and a SECURITY DEFINER function — exercised as the
-- `authenticated` role. NOT `npm run`-able, NOT in CI.
--
-- THIS HARNESS APPLIES 0119 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK (0104 must already be applied — it is, since 2026-10-06). It re-runs
-- 0104's proof (the 0103 R-series + the N-series: kept/changed/lost notes and
-- cash, attribution, cash-person removal, cash-people RLS) against the
-- re-created function, then the H-series proves 0119's own rules.
--
-- HOW TO RUN (only on Whit's go, at the time he picks):
--   `npx tsx scripts/sim/snack-shack-headcount-build.ts > <file>`, send the
--   output as ONE batch through the Supabase MCP, read the raised message,
--   then run the leak check at the bottom. `--md5` prints the md5 the run
--   must report.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: one to two seconds)
--   ACCESS EXCLUSIVE on public.snack_shack_settings and public.snack_shack_blocks
--     (ADD COLUMN / ADD CHECK) — blocks every read and write of both: the
--     Snack Shack page, the Teams page snack button, both snack shack email
--     routes, the venue delete guard, the live regenerate RPC.
--   Nothing on profiles (0119 adds no FK). lock_timeout = 3s: the run gives
--   up rather than queueing behind a live writer; statement_timeout = 60s.
--
-- ROWS TOUCHED (all rolled back; "test" org only, owner
-- bbf9afe1-9e62-41e0-becc-895085bfc9d6): two fixture leagues, a division,
-- five teams, one settings row, blocks, cash people. Every other row is only
-- READ for the before/after checksum (M2) and the defaults check (H1).
--
-- ASSERTIONS
--   M2        pre-existing blocks (original columns) and settings (without the
--             new column) byte-identical
--   P1        privileges: the function, the trigger function, the cash table
--   R-series  the 0103 contract, unchanged (counts now kept=1 created=3 removed=4)
--   N1–N7     0104's rules, unchanged
--   H1        defaults: every existing settings row 1, every shift null
--   H3        a KEPT row keeps its own headcount
--   H4        a CHANGED row with a note carries its headcount too
--   H5        a CHANGED row holding ONLY a headcount is captured and carried;
--             a brand-new shift carries none
--   H6        `carried` counts the headcount-only row
--   H7        `lost` lists a removed headcount-only row with its count, and
--             carries `people_needed` (null) on a removed row without one
--   H2        1–20 bounds on both columns, as a member; null clears a shift
--   H8        a non-member writes nothing; anon refused
--
-- MUTANTS (each rewrites the REAL function or constraint inside its own
-- rolled-back block; KILLED only if the FIRST failure is its own tag)
--   HM1  the capture ignores a headcount-only row               → H5
--   HM2  the INSERT drops the carried headcount                 → H4
--   HM3  kept rows have their headcount cleared                 → H3
--   HM4  the season number's CHECK widened to 0..100            → H2
--   HM5  `carried` does not count a headcount-only row          → H6
--   HM6  `lost` leaves out the headcount                        → H7
--   PM1  (0104 regression) note/cash carry-forward removed      → N2
--   PM6  (0104 regression) lost not reported                    → N4
--
-- RUN LOG: none yet — the proof waits for Whit's go and timing.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

create temp table h119_snap on commit drop as
select
  (select md5(coalesce(string_agg(
       b.id::text || b.snack_shack_id::text || b.date::text || b.start_time::text || b.end_time::text ||
       coalesce(b.assigned_team_id::text, '-') || b.is_recurring::text || b.created_at::text, '|' order by b.id), ''))
     from public.snack_shack_blocks b) as blocks_md5,
  (select count(*) from public.snack_shack_blocks) as blocks_n,
  (select md5(coalesce(string_agg((to_jsonb(s) - 'people_per_shift')::text, '|' order by s.id), '')) from public.snack_shack_settings s) as settings_md5,
  (select count(*) from public.snack_shack_settings) as settings_n;

create temp table h119_fx on commit drop as
select
  'bbf9afe1-9e62-41e0-becc-895085bfc9d6'::uuid as owner,
  -- A REAL profile that is NOT a member of the test org: the original author
  -- of the carried note, so re-stamping is visible on `notes_updated_by`.
  'aa21d01c-66dc-4c37-b15c-7b743c557eea'::uuid as author,
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
  gen_random_uuid() as b4,
  gen_random_uuid() as b5,
  gen_random_uuid() as m1,
  gen_random_uuid() as cash_a,
  gen_random_uuid() as cash_b,
  gen_random_uuid() as nobody;

insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date)
select league_a, 'H119 Fixture A', 'Baseball', 'Fall 2026', owner, '2026-11-01'::date, '2026-12-20'::date from h119_fx
union all
select league_b, 'H119 Fixture B', 'Baseball', 'Fall 2026', owner, '2026-11-01'::date, '2026-12-20'::date from h119_fx;

insert into public.divisions (id, league_id, name, settings)
select division_a, league_a, 'H119 Minors', '{"game_duration": 120, "buffer_minutes": 30, "playing_days": ["Sa"]}'::jsonb from h119_fx;

insert into public.teams (id, league_id, division_id, name)
select bears,  league_a, division_a, 'Bears'  from h119_fx union all
select cubs,   league_a, division_a, 'Cubs'   from h119_fx union all
select expos,  league_a, division_a, 'Expos'  from h119_fx union all
select giants, league_a, division_a, 'Giants' from h119_fx union all
select other_team, league_b, null::uuid, 'Other League Team' from h119_fx;

insert into public.snack_shack_settings (id, season_id, start_date, end_date, days_of_week, time_blocks_by_day, home_venue_ids, scheduling_preference)
select snack, league_a, '2026-11-01'::date, '2026-12-20'::date, '["Sa"]'::jsonb, '{}'::jsonb, '[]'::jsonb, 'prefer_off_days' from h119_fx;

create function pg_temp.h119_try(p_role text, p_uid uuid, p_sql text)
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

create function pg_temp.h119_call(p_role text, p_uid uuid, p_snack uuid, p_shifts jsonb)
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

-- Resets the fixture rows (blocks + cash people) to their starting state.
-- Runs AFTER the migration (it writes the new columns), at the top of every
-- assertion pass so each mutant sees the same rows. Attribution on the
-- fixture rows is set by INSERT — the trigger is UPDATE-only — so the
-- original author/time are known literals.
create function pg_temp.h119_reset()
returns void
language plpgsql
as $fn$
declare fx h119_fx%rowtype;
begin
  select * into fx from h119_fx;
  delete from public.snack_shack_blocks where snack_shack_id = fx.snack;
  delete from public.snack_shack_cash_people where snack_shack_id = fx.snack;
  insert into public.snack_shack_cash_people (id, snack_shack_id, name) values
    (fx.cash_a, fx.snack, 'Alex'), (fx.cash_b, fx.snack, 'Blake');
  insert into public.snack_shack_blocks (id, snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring,
                                         notes, notes_updated_at, notes_updated_by, cash_person_id, people_needed) values
    (fx.b1, fx.snack, '2026-11-07', '09:30', '11:30', fx.bears, true,  'kept note',  '2026-09-01 10:00:00+00', fx.author, fx.cash_a, 2),
    (fx.b2, fx.snack, '2026-11-07', '11:30', '13:30', fx.cubs,  true,  'carry me',   '2026-09-02 10:00:00+00', fx.author, fx.cash_b, 5),
    (fx.b3, fx.snack, '2026-11-07', '13:30', '15:30', fx.expos, true,  'lost note',  '2026-09-03 10:00:00+00', fx.author, fx.cash_a, null),
    -- 0119: two rows that hold ONLY a headcount — b4's end moves (carried),
    -- b5 has no replacement (lost).
    (fx.b4, fx.snack, '2026-11-21', '09:30', '11:30', fx.bears, true,  null, null, null, null, 3),
    (fx.b5, fx.snack, '2026-11-21', '13:00', '15:00', fx.cubs,  true,  null, null, null, null, 4),
    (fx.m1, fx.snack, '2026-11-07', '08:00', '09:30', fx.giants, false, 'manual note', '2026-09-04 10:00:00+00', fx.author, fx.cash_a, null);
  update public.snack_shack_settings set shifts_generated_at = null, people_per_shift = 1 where id = fx.snack;
end;
$fn$;

create function pg_temp.h119_assert()
returns jsonb
language plpgsql
as $fn$
declare
  fx       h119_fx%rowtype;
  v_fails  text[] := array[]::text[];
  v_res    jsonb;
  v_txt    text;
  v_n      integer;
  v_team   uuid;
  v_before text;
  v_after  text;
  v_payload jsonb;
  v_lost3  jsonb;
  v_x      jsonb;
  r        public.snack_shack_blocks%rowtype;
begin
  select * into fx from h119_fx;
  perform pg_temp.h119_reset();

  -- Same payload as the 0103 proof: b1 kept (the passed team is ignored), b2's
  -- END moves (13:30 → 14:00), b3 removed with no replacement, one new day.
  v_payload := jsonb_build_array(
    jsonb_build_object('date', '2026-11-07', 'start', '09:30', 'end', '11:30', 'assigned_team_id', fx.giants),
    jsonb_build_object('date', '2026-11-07', 'start', '11:30', 'end', '14:00', 'assigned_team_id', fx.expos),
    jsonb_build_object('date', '2026-11-14', 'start', '09:30', 'end', '11:30', 'assigned_team_id', fx.giants),
    jsonb_build_object('date', '2026-11-21', 'start', '09:30', 'end', '12:00', 'assigned_team_id', fx.giants)
  );
  v_res := pg_temp.h119_call('authenticated', fx.owner, fx.snack, v_payload);
  if v_res ? 'error' then
    v_fails := array_append(v_fails, 'R1: the regenerate call itself failed: ' || (v_res ->> 'error'));
    return jsonb_build_object('fails', to_jsonb(v_fails));
  end if;

  -- ── R-series (0103 contract) ──────────────────────────────────────────────
  select count(*) into v_n from public.snack_shack_blocks
   where id = fx.m1 and not is_recurring and assigned_team_id = fx.giants and start_time = '08:00' and end_time = '09:30';
  if v_n <> 1 then v_fails := array_append(v_fails, 'R3: the manual row was touched'); end if;
  if (v_res ->> 'kept')::int <> 1 or (v_res ->> 'created')::int <> 3 or (v_res ->> 'removed')::int <> 4 then
    v_fails := array_append(v_fails, 'R1: expected kept=1 created=3 removed=4, got ' || v_res::text);
  end if;
  if not exists (select 1 from public.snack_shack_blocks where id = fx.b1 and is_recurring) then
    v_fails := array_append(v_fails, 'R1: the unchanged row did not keep its id');
  end if;
  if exists (select 1 from public.snack_shack_blocks where id in (fx.b2, fx.b3, fx.b4, fx.b5)) then
    v_fails := array_append(v_fails, 'R1: a superseded row still exists');
  end if;
  select assigned_team_id into v_team from public.snack_shack_blocks where id = fx.b1;
  if v_team is distinct from fx.bears then
    v_fails := array_append(v_fails, 'R2: the kept row took the caller''s team');
  end if;

  -- ── N1: the kept row keeps note, attribution and cash person ─────────────
  select * into r from public.snack_shack_blocks where id = fx.b1;
  if r.notes is distinct from 'kept note' or r.notes_updated_at is distinct from '2026-09-01 10:00:00+00'::timestamptz
     or r.notes_updated_by is distinct from fx.author or r.cash_person_id is distinct from fx.cash_a then
    v_fails := array_append(v_fails, format('N1: the kept row lost something: notes=%s at=%s by=%s cash=%s', r.notes, r.notes_updated_at, r.notes_updated_by, r.cash_person_id));
  end if;

  -- ── N2 / N3: the changed row carries note + cash, with the ORIGINAL author ─
  select * into r from public.snack_shack_blocks
   where snack_shack_id = fx.snack and is_recurring and date = '2026-11-07' and start_time = '11:30' and end_time = '14:00';
  if r.id is null then
    v_fails := array_append(v_fails, 'N2: the changed row was not created');
  else
    if r.notes is distinct from 'carry me' or r.cash_person_id is distinct from fx.cash_b then
      v_fails := array_append(v_fails, format('N2: the changed row did not carry the note/cash: notes=%s cash=%s', r.notes, r.cash_person_id));
    end if;
    if r.notes_updated_by is distinct from fx.author or r.notes_updated_at is distinct from '2026-09-02 10:00:00+00'::timestamptz then
      v_fails := array_append(v_fails, format('N3: attribution was re-stamped: by=%s at=%s', r.notes_updated_by, r.notes_updated_at));
    end if;
    if r.assigned_team_id is distinct from fx.expos then
      v_fails := array_append(v_fails, 'N2: the changed row did not get the passed team');
    end if;
  end if;

  -- ── N4: carried / lost reported ───────────────────────────────────────────
  -- 0119: carried/lost now also count headcount-only rows (H6/H7); N4 keeps
  -- 0104's content check on the removed 13:30 row.
  v_lost3 := (select x from jsonb_array_elements(coalesce(v_res -> 'lost', '[]'::jsonb)) x
               where x ->> 'date' = '2026-11-07' and x ->> 'start' = '13:30');
  if v_lost3 is null or (v_lost3 ->> 'notes') <> 'lost note'
     or (v_lost3 ->> 'cash_person_id')::uuid is distinct from fx.cash_a
     or v_lost3 ? 'notes_updated_by' then
    v_fails := array_append(v_fails, 'N4: lost should name the removed 13:30 row''s note and cash person (without attribution): ' || coalesce((v_res -> 'lost')::text, 'null'));
  end if;
  -- The new day's row carries nothing.
  select * into r from public.snack_shack_blocks where snack_shack_id = fx.snack and date = '2026-11-14';
  if r.notes is not null or r.cash_person_id is not null then
    v_fails := array_append(v_fails, 'N4: a brand-new shift must carry nothing');
  end if;

  -- ── N5: removing a cash person nulls its shifts (derived and manual) ──────
  select count(*) into v_n from public.snack_shack_blocks where snack_shack_id = fx.snack and cash_person_id = fx.cash_a;
  if v_n <> 2 then v_fails := array_append(v_fails, 'N5: expected 2 shifts on Alex before removal, got ' || v_n); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('delete from public.snack_shack_cash_people where id = %L', fx.cash_a));
  if v_txt <> 'OK rows=1' then
    v_fails := array_append(v_fails, 'N5: a member could not remove a cash person: ' || v_txt);
  end if;
  select count(*) into v_n from public.snack_shack_blocks where snack_shack_id = fx.snack and cash_person_id = fx.cash_a;
  if v_n <> 0 then v_fails := array_append(v_fails, 'N5: shifts still reference the removed cash person: ' || v_n); end if;
  select count(*) into v_n from public.snack_shack_blocks where id in (fx.b1, fx.m1) and cash_person_id is null and notes is not null;
  if v_n <> 2 then v_fails := array_append(v_fails, 'N5: the nulling touched more than cash_person_id, or missed a row'); end if;

  -- ── N6: the attribution trigger as a member ───────────────────────────────
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set notes = %L where id = %L', 'edited by member', fx.b1));
  if v_txt <> 'OK rows=1' then v_fails := array_append(v_fails, 'N6: a member could not write a note: ' || v_txt); end if;
  select * into r from public.snack_shack_blocks where id = fx.b1;
  if r.notes_updated_by is distinct from fx.owner or r.notes_updated_at is null or r.notes_updated_at < now() - interval '1 minute' then
    v_fails := array_append(v_fails, format('N6: the trigger did not stamp the member and now: by=%s at=%s', r.notes_updated_by, r.notes_updated_at));
  end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set notes = null where id = %L', fx.b1));
  select * into r from public.snack_shack_blocks where id = fx.b1;
  if v_txt <> 'OK rows=1' or r.notes_updated_by is not null or r.notes_updated_at is not null then
    v_fails := array_append(v_fails, 'N6: removing the note did not clear the attribution: ' || v_txt);
  end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set notes = %L where id = %L', repeat('x', 501), fx.b1));
  if v_txt not like 'ERR 23514%' then v_fails := array_append(v_fails, 'N6: 501 characters was not refused: ' || v_txt); end if;
  -- An assignment-only edit must not touch the attribution.
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set assigned_team_id = %L where id = %L', fx.cubs, fx.m1));
  select * into r from public.snack_shack_blocks where id = fx.m1;
  if v_txt <> 'OK rows=1' or r.notes_updated_at is distinct from '2026-09-04 10:00:00+00'::timestamptz or r.notes_updated_by is distinct from fx.author then
    v_fails := array_append(v_fails, 'N6: an assignment-only edit changed the note attribution');
  end if;

  -- ── N7: cash people RLS and uniqueness ────────────────────────────────────
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('insert into public.snack_shack_cash_people (snack_shack_id, name) values (%L, %L)', fx.snack, 'Casey'));
  if v_txt <> 'OK rows=1' then v_fails := array_append(v_fails, 'N7: a member could not add a name: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('insert into public.snack_shack_cash_people (snack_shack_id, name) values (%L, %L)', fx.snack, '  casey '));
  if v_txt not like 'ERR 23505%' then v_fails := array_append(v_fails, 'N7: a case/whitespace duplicate was not refused: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_cash_people set name = %L where id = %L', 'Blake R.', fx.cash_b));
  if v_txt <> 'OK rows=1' then v_fails := array_append(v_fails, 'N7: a member could not rename: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('insert into public.snack_shack_cash_people (snack_shack_id, name) values (%L, %L)', fx.snack, '   '));
  if v_txt not like 'ERR 23514%' then v_fails := array_append(v_fails, 'N7: a blank name was not refused: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.nobody, format('select 1 from public.snack_shack_cash_people where snack_shack_id = %L', fx.snack));
  if v_txt <> 'OK rows=0' then v_fails := array_append(v_fails, 'N7: a non-member saw the names: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.nobody, format('insert into public.snack_shack_cash_people (snack_shack_id, name) values (%L, %L)', fx.snack, 'Mallory'));
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'N7: a non-member inserted a name: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('anon', null, format('select 1 from public.snack_shack_cash_people where snack_shack_id = %L', fx.snack));
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'N7: anon could read the names: ' || v_txt); end if;
  -- A non-member cannot read a shift's note either (blocks RLS, unchanged).
  v_txt := pg_temp.h119_try('authenticated', fx.nobody, format('select notes from public.snack_shack_blocks where snack_shack_id = %L', fx.snack));
  if v_txt <> 'OK rows=0' then v_fails := array_append(v_fails, 'N7: a non-member read shift notes: ' || v_txt); end if;

  -- ── H-series (0119) — the headcount ───────────────────────────────────────
  -- H1 the defaults: every row outside the fixture reads 1 / null (checked in
  --    the DO block too, right after the migration); the fixture's settings
  --    row (inserted BEFORE the migration) got 1.
  if (select people_per_shift from public.snack_shack_settings where id = fx.snack) is distinct from 1::smallint then
    v_fails := array_append(v_fails, 'H1: the fixture settings row did not default to 1');
  end if;
  -- H3 the KEPT row keeps its own headcount.
  if (select people_needed from public.snack_shack_blocks where id = fx.b1) is distinct from 2::smallint then
    v_fails := array_append(v_fails, 'H3: the kept row lost its headcount: ' ||
      coalesce((select people_needed::text from public.snack_shack_blocks where id = fx.b1), 'null'));
  end if;
  -- H4 a CHANGED row with a note carries its headcount too.
  if (select people_needed from public.snack_shack_blocks
       where snack_shack_id = fx.snack and date = '2026-11-07' and start_time = '11:30' and end_time = '14:00') is distinct from 5::smallint then
    v_fails := array_append(v_fails, 'H4: the changed 11:30 row did not carry its headcount (5)');
  end if;
  -- H5 a CHANGED row holding ONLY a headcount is captured and carried; a
  --    brand-new shift carries none.
  if (select people_needed from public.snack_shack_blocks
       where snack_shack_id = fx.snack and date = '2026-11-21' and start_time = '09:30' and end_time = '12:00') is distinct from 3::smallint then
    v_fails := array_append(v_fails, 'H5: the headcount-only row (Nov 21 09:30) was not carried to its new end');
  end if;
  if (select people_needed from public.snack_shack_blocks where snack_shack_id = fx.snack and date = '2026-11-14') is not null then
    v_fails := array_append(v_fails, 'H5: a brand-new shift must carry no headcount');
  end if;
  -- H6 `carried` counts the headcount-only row: b2 (note) + b4 (headcount).
  if (v_res ->> 'carried')::int is distinct from 2 then
    v_fails := array_append(v_fails, 'H6: carried should be 2 (a note row and a headcount-only row), got ' || coalesce(v_res ->> 'carried', 'null'));
  end if;
  -- H7 `lost` names both removed rows with their headcount: b3 (null) and b5 (4).
  v_x := (select x from jsonb_array_elements(coalesce(v_res -> 'lost', '[]'::jsonb)) x
           where x ->> 'date' = '2026-11-21' and x ->> 'start' = '13:00');
  if jsonb_array_length(coalesce(v_res -> 'lost', '[]'::jsonb)) <> 2
     or v_x is null or (v_x ->> 'people_needed')::int is distinct from 4 or (v_x ->> 'notes') is not null
     or not (v_lost3 ? 'people_needed') or (v_lost3 ->> 'people_needed') is not null then
    v_fails := array_append(v_fails, 'H7: lost should list the 13:30 row (no headcount) and the headcount-only 13:00 row (4): ' || coalesce((v_res -> 'lost')::text, 'null'));
  end if;
  -- H2 the 1–20 bounds, as a member (writes — run after the reads above).
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_settings set people_per_shift = 0 where id = %L', fx.snack));
  if v_txt not like 'ERR 23514%' then v_fails := array_append(v_fails, 'H2: people_per_shift 0 was not refused: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_settings set people_per_shift = 21 where id = %L', fx.snack));
  if v_txt not like 'ERR 23514%' then v_fails := array_append(v_fails, 'H2: people_per_shift 21 was not refused: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_settings set people_per_shift = 20 where id = %L', fx.snack));
  if v_txt <> 'OK rows=1' then v_fails := array_append(v_fails, 'H2: a member could not set people_per_shift to 20: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set people_needed = 0 where id = %L', fx.m1));
  if v_txt not like 'ERR 23514%' then v_fails := array_append(v_fails, 'H2: people_needed 0 was not refused: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set people_needed = 21 where id = %L', fx.m1));
  if v_txt not like 'ERR 23514%' then v_fails := array_append(v_fails, 'H2: people_needed 21 was not refused: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set people_needed = 20 where id = %L', fx.m1));
  if v_txt <> 'OK rows=1' then v_fails := array_append(v_fails, 'H2: a member could not set a shift to 20: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.owner, format('update public.snack_shack_blocks set people_needed = null where id = %L', fx.m1));
  if v_txt <> 'OK rows=1' then v_fails := array_append(v_fails, 'H2: a member could not clear a shift back to the season number: ' || v_txt); end if;
  -- H8 a non-member changes nothing; anon is refused.
  v_txt := pg_temp.h119_try('authenticated', fx.nobody, format('update public.snack_shack_blocks set people_needed = 9 where id = %L', fx.b1));
  if v_txt <> 'OK rows=0' then v_fails := array_append(v_fails, 'H8: a non-member wrote a headcount: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('authenticated', fx.nobody, format('update public.snack_shack_settings set people_per_shift = 9 where id = %L', fx.snack));
  if v_txt <> 'OK rows=0' then v_fails := array_append(v_fails, 'H8: a non-member wrote the season number: ' || v_txt); end if;
  v_txt := pg_temp.h119_try('anon', null, format('update public.snack_shack_blocks set people_needed = 9 where id = %L', fx.b1));
  if v_txt not like 'ERR 42501%' then v_fails := array_append(v_fails, 'H8: anon was not refused: ' || v_txt); end if;

  return jsonb_build_object('fails', to_jsonb(v_fails));
end;
$fn$;

do $h119$
declare
  v_fails  text[] := array[]::text[];
  v_out    text := E'\n';
  fx       h119_fx%rowtype;
  v_m      jsonb;
  v_first  text;
  v_tag    text;
  v_def    text;
  v_mut    text;
  v_bmd5   text;
  m        record;
  v_fn     constant text := 'public.regenerate_snack_shack_shifts(uuid, jsonb)';
  v_trg    constant text := 'public.set_snack_shack_blocks_notes_attribution()';
  v_tbl    constant text := 'public.snack_shack_cash_people';
  r        record;
begin
  select * into fx from h119_fx;

  execute $mig119$
-- @@MIGRATION_0119@@
$mig119$;

  -- M2 — pre-existing rows byte-identical on their original columns.
  select md5(coalesce(string_agg(
       b.id::text || b.snack_shack_id::text || b.date::text || b.start_time::text || b.end_time::text ||
       coalesce(b.assigned_team_id::text, '-') || b.is_recurring::text || b.created_at::text, '|' order by b.id), '')) into v_bmd5
    from public.snack_shack_blocks b where b.snack_shack_id <> fx.snack;
  if v_bmd5 is distinct from (select blocks_md5 from h119_snap)
     or (select count(*) from public.snack_shack_blocks b where b.snack_shack_id <> fx.snack) <> (select blocks_n from h119_snap) then
    v_fails := array_append(v_fails, 'M2: pre-existing snack_shack_blocks rows changed');
  end if;
  if (select count(*) from public.snack_shack_blocks b where b.snack_shack_id <> fx.snack and (b.notes is not null or b.cash_person_id is not null)) <> 0 then
    v_fails := array_append(v_fails, 'M2: a pre-existing row acquired a note or cash person');
  end if;
  if exists (select 1 from public.snack_shack_settings s where s.id <> fx.snack and s.people_per_shift <> 1)
     or exists (select 1 from public.snack_shack_blocks b where b.snack_shack_id <> fx.snack and b.people_needed is not null) then
    v_fails := array_append(v_fails, 'H1: a pre-existing row is not at the default (settings 1, shifts null)');
  end if;
  if (select md5(coalesce(string_agg((to_jsonb(s) - 'people_per_shift')::text, '|' order by s.id), '')) from public.snack_shack_settings s where s.id <> fx.snack)
     is distinct from (select settings_md5 from h119_snap) then
    v_fails := array_append(v_fails, 'M2: pre-existing settings rows changed');
  end if;

  -- P1 — privileges.
  if has_function_privilege('anon', v_fn, 'execute') or not has_function_privilege('authenticated', v_fn, 'execute')
     or has_function_privilege('service_role', v_fn, 'execute') or has_function_privilege('dashboard_readonly', v_fn, 'execute') then
    v_fails := array_append(v_fails, 'P1: regenerate function privileges wrong');
  end if;
  if has_function_privilege('anon', v_trg, 'execute') or has_function_privilege('authenticated', v_trg, 'execute')
     or has_function_privilege('service_role', v_trg, 'execute') or has_function_privilege('dashboard_readonly', v_trg, 'execute') then
    v_fails := array_append(v_fails, 'P1: the trigger function is callable by a role');
  end if;
  for r in select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as priv loop
    if not has_table_privilege('authenticated', v_tbl, r.priv) or has_table_privilege('anon', v_tbl, r.priv)
       or has_table_privilege('service_role', v_tbl, r.priv) or has_table_privilege('dashboard_readonly', v_tbl, r.priv) then
      v_fails := array_append(v_fails, 'P1: cash people table privilege wrong for ' || r.priv);
    end if;
  end loop;

  v_m := pg_temp.h119_assert();
  v_fails := v_fails || array(select jsonb_array_elements_text(v_m -> 'fails'));
  v_out := v_out || format(E'BASELINE failures (%s): %s\n', coalesce(array_length(v_fails, 1), 0), to_jsonb(v_fails));

  for m in
    select * from (values
      ('HM1', 'the capture ignores a headcount-only row', 'H5', 'fn',
        $a$    and (b.notes is not null or b.cash_person_id is not null or b.people_needed is not null)$a$,
        $a$    and (b.notes is not null or b.cash_person_id is not null)$a$),
      ('HM2', 'the INSERT drops the carried headcount', 'H4', 'fn',
        $a$           c.notes, c.notes_updated_at, c.notes_updated_by, c.cash_person_id, c.people_needed$a$,
        $a$           c.notes, c.notes_updated_at, c.notes_updated_by, c.cash_person_id, null$a$),
      ('HM3', 'kept rows have their headcount cleared', 'H3', 'fn',
        $a$  -- assignment, note, cash person and headcount and all. (kept rows are never updated)$a$,
        $a$  update public.snack_shack_blocks set people_needed = null where snack_shack_id = p_snack_shack_id and is_recurring;$a$),
      ('HM4', 'the season number''s CHECK widened to 0..100', 'H2', 'chk', '', ''),
      ('HM5', 'carried does not count a headcount-only row', 'H6', 'fn',
        $a$              (notes is not null or cash_person_id is not null or people_needed is not null) as carried$a$,
        $a$              (notes is not null or cash_person_id is not null) as carried$a$),
      ('HM6', 'lost leaves out the headcount', 'H7', 'fn',
        $a$  select coalesce(jsonb_agg((x - 'notes_updated_at' - 'notes_updated_by')$a$,
        $a$  select coalesce(jsonb_agg((x - 'notes_updated_at' - 'notes_updated_by' - 'people_needed')$a$),
      ('PM1', '(0104 regression) note/cash carry-forward removed', 'N2', 'fn',
        $a$           c.notes, c.notes_updated_at, c.notes_updated_by, c.cash_person_id, c.people_needed$a$,
        $a$           null, null, null, null, c.people_needed$a$),
      ('PM6', '(0104 regression) lost not reported', 'N4', 'fn',
        $a$    'lost',                v_lost$a$,
        $a$    'lost',                '[]'::jsonb$a$)
    ) as t(id, what, target, kind, find, repl)
  loop
    begin
      if m.kind = 'chk' then
        alter table public.snack_shack_settings drop constraint snack_shack_settings_people_per_shift_range;
        alter table public.snack_shack_settings add constraint snack_shack_settings_people_per_shift_range
          check (people_per_shift between 0 and 100);
      else
        v_def := pg_get_functiondef(case when m.kind = 'trg' then v_trg else v_fn end::regprocedure);
        v_mut := replace(v_def, m.find, m.repl);
        if v_mut = v_def then
          raise exception 'MUTANT_NOOP';
        end if;
        execute v_mut;
      end if;
      v_m := pg_temp.h119_assert();
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      raise exception 'H119_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (the text to replace was not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H119_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  v_m := pg_temp.h119_assert();
  v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');
  v_out := v_out || format(E'prosrc md5 regenerate: %s (expected fd94fb29d2dd64ef659ac52fae736ae8 — build --md5)\n',
    (select md5(p.prosrc) from pg_proc p where p.oid = v_fn::regprocedure));

  raise exception '%', v_out;
end;
$h119$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from information_schema.columns where table_name = 'snack_shack_settings' and column_name = 'people_per_shift') as settings_col_must_be_0,
--   (select count(*) from information_schema.columns where table_name = 'snack_shack_blocks' and column_name = 'people_needed') as blocks_col_must_be_0,
--   (select md5(prosrc) from pg_proc where proname = 'regenerate_snack_shack_shifts') as fn_md5_must_be_0104_7881278e78eb8a513d0ae678f378f6a2,
--   (select count(*) from leagues where name like 'H119 Fixture%') as leagues_must_be_0,
--   (select md5(coalesce(string_agg(b::text, '|' order by b.id), '')) from snack_shack_blocks b) as blocks_md5_must_match_pre_run;
