-- Proof for 0117 (saved practice plans: practice_plans, the input check, and
-- create / copy / save / delete). Assembled by practice-plans-build.ts, which
-- puts the LITERAL migration text where the placeholder is — so this proves
-- the file that will be applied. It runs BEFORE 0117 is applied: the whole
-- batch is one transaction that the final RAISE always rolls back. Fixtures
-- live in the "test" proof org (bbf9afe1…, Elite) and, as the OTHER league,
-- "Test 2" (27c15406…, Elite); each owner is a member of their own org only
-- (checked 2026-10-21). Never Santa Rosa American's data.
--
-- LOCKS: CREATE TABLE with three foreign keys to profiles takes SHARE ROW
-- EXCLUSIVE on `profiles` for the WHOLE batch — profile writes (signups,
-- settings, a webhook's plan update) wait until it ends (a few seconds);
-- reads don't. The case flips the "test" org's plan (row lock, rolled back).
-- lock_timeout 3s.
--
-- THE SHARED CASE TABLE: the rows between the PLANINPUT-TABLE-BEGIN / -END
-- lines below are the ONLY copy. This proof runs them through
-- practice_plan_input_problem (XV1); sim:practice-plan-input parses the same
-- block and runs it through the TypeScript twin, and requires the
-- just-inside / just-outside row of every INPUT_LIMITS limit to be here. Each
-- marker alone on its line, one row per line. Never a second copy.
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   SP1 every function pins search_path = public, pg_temp; the four entry
--       points are SECURITY DEFINER, the input check INVOKER; one overload each
--   PR1 EXECUTE per role: entry points authenticated only, the input check no
--       role; the table: SELECT authenticated only, no write for any role, RLS on
--   XV1 every row of the shared case table → the expected problem key
--   C1  create as the owner: committed; name trimmed; input, version 1, mode,
--       created_by / updated_by, updated_at = the reply's, at ms precision
--   C2  create by a non-member and by Test 2's owner → not_authorized; nothing written
--   C3  create on Free → plan_required; on Pro → committed
--   C4  a cityId input → invalid_input:city_not_allowed; a blank name →
--       invalid_name; a bad mode → invalid_mode; version 2 → input_version;
--       anon may not call (EXECUTE); nothing written
--   R1  the owner reads the plan; Test 2's owner reads none of "test"'s
--       plans; anon may not read (no grant)
--   W0  a member's direct INSERT / UPDATE / DELETE on the table is refused
--   S1  save with the loaded updated_at: committed, a later updated_at, the
--       new name / input / mode, updated_by = the caller
--   S2  save with an OLD updated_at: committed=false, status stale, the
--       current updated_at, who saved (id + name) — and the row is unchanged
--   S3  "Keep mine" = a SECOND call with the stale reply's updated_at → committed
--   S4  save by Test 2's owner → not_authorized; on Free → plan_required; an
--       invalid input → invalid_input; the row unchanged each time
--   S5  every stored updated_at has millisecond precision
--   K1  copy as the owner: a new row, same owner, input, version (an old
--       version stays old) and mode, the new name; the source unchanged
--   K2  copy by Test 2's owner → not_authorized; on Free → plan_required
--   D1  delete by Test 2's owner → not_authorized (row stays); on Free →
--       committed (membership only); an unknown id → plan_not_found
-- Mutants (each must die at its own tag):
--   MU1  create's plan check removed                    → C3
--   MU2  save's stale check removed                     → S2
--   MU3  save's member check removed                    → S4
--   MU4  delete gains a plan check                      → D1
--   MU5  copy's member check removed                    → K2
--   MU6  the cityId refusal removed (falls to unknown)  → XV1
--   MU7  the teams limit moved to 61                    → XV1
--   MU8  save loses its search_path                     → MIG (the
--        migration's own check refuses to apply — the right red line)
--   MU8b save loses its search_path AND the migration's check is removed
--                                                       → SP1
--   MU9  create granted to anon                         → MIG
--   MU10 save's updated_at not truncated to ms          → S5
--   MU11 copy writes version 1 / 'spread' (not an exact duplicate) → K1
--   MU12 the stale reply names nobody                   → S2
--   MU13 duplicate days allowed                         → XV1
-- Plus: md5(prosrc) of all five functions and the md5 of the case table as
-- run are printed — match them to the files (practice-plans-build.ts --md5).
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '120s', true);

-- Calls `p_sql` as `p_role` (with `p_sub` as the JWT subject); returns its one
-- text value, or 'ERR:<sqlstate>:<message>'.
create or replace function pg_temp.h117_as(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare
  v text;
begin
  if p_sub is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  end if;
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$f$;

create or replace function pg_temp.h117_create(p_sub uuid, p_org uuid, p_name text, p_input jsonb, p_version int, p_mode text) returns text
language sql as $f$
  select pg_temp.h117_as('authenticated', p_sub,
    format('select public.create_practice_plan(%L::uuid, %L, %L::jsonb, %s, %L)::text', p_org, p_name, p_input, p_version, p_mode))
$f$;

create or replace function pg_temp.h117_save(p_sub uuid, p_id uuid, p_at timestamptz, p_name text, p_input jsonb, p_mode text) returns text
language sql as $f$
  select pg_temp.h117_as('authenticated', p_sub,
    format('select public.save_practice_plan(%L::uuid, %L::timestamptz, %L, %L::jsonb, 1, %L)::text', p_id, p_at, p_name, p_input, p_mode))
$f$;

-- The shared case table (see the header). Each row: a label, how its input is
-- built, a patch, and the expected problem key (null = accepted). The input is
-- built from the row labelled 'base' (B, and its first division D):
--   raw     the patch IS the input        top     B || patch
--   topdel  B without the key named       div     B with divisions [D || patch]
--   divdel  B with D minus the key named  divs    B with divisions = N copies of D
--   adddiv  B with divisions [D, D || patch]
-- sim:practice-plan-input builds them the same way. One row per line.
create or replace function pg_temp.h117_rows() returns table(label text, kind text, patch text, want text)
language sql as $t$
  select * from (values
-- PLANINPUT-TABLE-BEGIN
  ('base', 'raw', '{"seasonStart":"2027-02-22","seasonEnd":"2027-05-29","minutesBetween":0,"divisions":[{"name":"Majors","teams":6,"perWeek":2,"lengthMin":90,"days":[0,1,2,3,4],"start":"17:00","end":"20:00","fieldType":"diamond60","teamsPerField":1}]}', null),
  ('not an object: array', 'raw', '[]', 'not_an_object'),
  ('not an object: null', 'raw', 'null', 'not_an_object'),
  ('not an object: string', 'raw', '"plan"', 'not_an_object'),
  ('cityId refused by name', 'top', '{"cityId":"ca-santa-rosa"}', 'city_not_allowed'),
  ('cityId null still refused', 'top', '{"cityId":null}', 'city_not_allowed'),
  ('unknown top key', 'top', '{"notes":"x"}', 'unknown_key'),
  ('missing divisions', 'topdel', '"divisions"', 'missing_key'),
  ('missing minutesBetween', 'topdel', '"minutesBetween"', 'missing_key'),
  ('dates empty', 'top', '{"seasonStart":"","seasonEnd":""}', null),
  ('dates reversed allowed', 'top', '{"seasonStart":"2027-05-29","seasonEnd":"2027-02-22"}', null),
  ('start year 2000 (inside)', 'top', '{"seasonStart":"2000-01-01"}', null),
  ('start year 1999 (outside)', 'top', '{"seasonStart":"1999-12-31"}', 'season_start'),
  ('end year 2099 (inside)', 'top', '{"seasonEnd":"2099-12-31"}', null),
  ('end year 2100 (outside)', 'top', '{"seasonEnd":"2100-01-01"}', 'season_end'),
  ('start Feb 30', 'top', '{"seasonStart":"2027-02-30"}', 'season_start'),
  ('start leap day 2028', 'top', '{"seasonStart":"2028-02-29"}', null),
  ('start Feb 29 2027', 'top', '{"seasonStart":"2027-02-29"}', 'season_start'),
  ('start short month', 'top', '{"seasonStart":"2027-2-22"}', 'season_start'),
  ('start with time', 'top', '{"seasonStart":"2027-02-22T00:00"}', 'season_start'),
  ('start number', 'top', '{"seasonStart":20270222}', 'season_start'),
  ('end null', 'top', '{"seasonEnd":null}', 'season_end'),
  ('minutesBetween 0 (inside)', 'top', '{"minutesBetween":0}', null),
  ('minutesBetween 30 (inside)', 'top', '{"minutesBetween":30}', null),
  ('minutesBetween 31 (outside)', 'top', '{"minutesBetween":31}', 'minutes_between'),
  ('minutesBetween -1 (outside)', 'top', '{"minutesBetween":-1}', 'minutes_between'),
  ('minutesBetween 2.5', 'top', '{"minutesBetween":2.5}', 'minutes_between'),
  ('minutesBetween string', 'top', '{"minutesBetween":"5"}', 'minutes_between'),
  ('minutesBetween 5.0 counts as 5', 'top', '{"minutesBetween":5.0}', null),
  ('divisions not array', 'top', '{"divisions":{}}', 'divisions'),
  ('zero divisions', 'top', '{"divisions":[]}', null),
  ('40 divisions (inside)', 'divs', '40', null),
  ('41 divisions (outside)', 'divs', '41', 'division_count'),
  ('division not object', 'top', '{"divisions":[7]}', 'division_not_object'),
  ('division unknown key', 'div', '{"color":"red"}', 'division_unknown_key'),
  ('division cityId is unknown', 'div', '{"cityId":"ca-santa-rosa"}', 'division_unknown_key'),
  ('division missing teams', 'divdel', '"teams"', 'division_missing_key'),
  ('division missing fieldType', 'divdel', '"fieldType"', 'division_missing_key'),
  ('name empty (inside)', 'div', '{"name":""}', null),
  ('name 60 chars (inside)', 'div', '{"name":"NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN"}', null),
  ('name 61 chars (outside)', 'div', '{"name":"NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN"}', 'division_name'),
  ('name 60 accented chars (inside)', 'div', '{"name":"éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé"}', null),
  ('name number', 'div', '{"name":5}', 'division_name'),
  ('teams 0 (inside)', 'div', '{"teams":0}', null),
  ('teams 60 (inside)', 'div', '{"teams":60}', null),
  ('teams -1 (outside)', 'div', '{"teams":-1}', 'teams'),
  ('teams 61 (outside)', 'div', '{"teams":61}', 'teams'),
  ('teams fractional', 'div', '{"teams":0.5}', 'teams'),
  ('teams string', 'div', '{"teams":"0"}', 'teams'),
  ('perWeek 0 (inside)', 'div', '{"perWeek":0}', null),
  ('perWeek 7 (inside)', 'div', '{"perWeek":7}', null),
  ('perWeek -1 (outside)', 'div', '{"perWeek":-1}', 'per_week'),
  ('perWeek 8 (outside)', 'div', '{"perWeek":8}', 'per_week'),
  ('perWeek fractional', 'div', '{"perWeek":0.5}', 'per_week'),
  ('perWeek string', 'div', '{"perWeek":"0"}', 'per_week'),
  ('lengthMin 15 (inside)', 'div', '{"lengthMin":15}', null),
  ('lengthMin 240 (inside)', 'div', '{"lengthMin":240}', null),
  ('lengthMin 14 (outside)', 'div', '{"lengthMin":14}', 'length'),
  ('lengthMin 241 (outside)', 'div', '{"lengthMin":241}', 'length'),
  ('lengthMin fractional', 'div', '{"lengthMin":15.5}', 'length'),
  ('lengthMin string', 'div', '{"lengthMin":"15"}', 'length'),
  ('teamsPerField 1 (inside)', 'div', '{"teamsPerField":1}', null),
  ('teamsPerField 4 (inside)', 'div', '{"teamsPerField":4}', null),
  ('teamsPerField 0 (outside)', 'div', '{"teamsPerField":0}', 'teams_per_field'),
  ('teamsPerField 5 (outside)', 'div', '{"teamsPerField":5}', 'teams_per_field'),
  ('teamsPerField fractional', 'div', '{"teamsPerField":1.5}', 'teams_per_field'),
  ('teamsPerField string', 'div', '{"teamsPerField":"1"}', 'teams_per_field'),
  ('days empty (inside)', 'div', '{"days":[]}', null),
  ('days all seven (inside)', 'div', '{"days":[6,5,4,3,2,1,0]}', null),
  ('days 7 (outside)', 'div', '{"days":[7]}', 'days'),
  ('days -1 (outside)', 'div', '{"days":[-1]}', 'days'),
  ('days duplicate', 'div', '{"days":[1,1]}', 'days'),
  ('days fractional', 'div', '{"days":[1.5]}', 'days'),
  ('days string element', 'div', '{"days":["Mon"]}', 'days'),
  ('days not array', 'div', '{"days":"Mon"}', 'days'),
  ('days eight entries', 'div', '{"days":[0,1,2,3,4,5,6,0]}', 'days'),
  ('start 00:00 (inside)', 'div', '{"start":"00:00"}', null),
  ('start 23:59 (inside)', 'div', '{"start":"23:59"}', null),
  ('start 24:00 (outside)', 'div', '{"start":"24:00"}', 'start'),
  ('start 7:00 (no leading zero)', 'div', '{"start":"7:00"}', 'start'),
  ('start with seconds', 'div', '{"start":"17:00:00"}', 'start'),
  ('start 17:60', 'div', '{"start":"17:60"}', 'start'),
  ('end 23:59 (inside)', 'div', '{"end":"23:59"}', null),
  ('end 24:00 (outside)', 'div', '{"end":"24:00"}', 'end'),
  ('end number', 'div', '{"end":1200}', 'end'),
  ('end before start allowed', 'div', '{"start":"20:00","end":"17:00"}', null),
  ('field type diamond60', 'div', '{"fieldType":"diamond60"}', null),
  ('field type diamond5070', 'div', '{"fieldType":"diamond5070"}', null),
  ('field type diamond90', 'div', '{"fieldType":"diamond90"}', null),
  ('field type softball', 'div', '{"fieldType":"softball"}', null),
  ('field type soccerSmall', 'div', '{"fieldType":"soccerSmall"}', null),
  ('field type soccerFull', 'div', '{"fieldType":"soccerFull"}', null),
  ('unknown field type', 'div', '{"fieldType":"diamond45"}', 'field_type'),
  ('lit true', 'div', '{"lit":true}', null),
  ('lit false', 'div', '{"lit":false}', null),
  ('lit string', 'div', '{"lit":"yes"}', 'lit'),
  ('lit null', 'div', '{"lit":null}', 'lit'),
  ('id 1 char (inside)', 'div', '{"id":"a"}', null),
  ('id 40 chars (inside)', 'div', '{"id":"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"}', null),
  ('id empty (outside)', 'div', '{"id":""}', 'id'),
  ('id 41 chars (outside)', 'div', '{"id":"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"}', 'id'),
  ('id number', 'div', '{"id":7}', 'id'),
  ('second division''s problem found', 'adddiv', '{"teams":61}', 'teams'),
  ('first problem wins (teams before perWeek)', 'div', '{"teams":61,"perWeek":9}', 'teams'),
  ('cityId wins over unknown key', 'top', '{"cityId":"x","notes":"y"}', 'city_not_allowed')
-- PLANINPUT-TABLE-END
  ) as x(label, kind, patch, want)
$t$;

create or replace function pg_temp.h117_table() returns table(label text, input text, want text)
language sql as $t$
  with d as (select r.patch::jsonb as base, r.patch::jsonb -> 'divisions' -> 0 as div
               from pg_temp.h117_rows() r where r.label = 'base')
  select r.label,
         (case r.kind
            when 'raw'    then r.patch::jsonb
            when 'top'    then d.base || r.patch::jsonb
            when 'topdel' then d.base - (r.patch::jsonb #>> '{}')
            when 'div'    then jsonb_set(d.base, '{divisions}', jsonb_build_array(d.div || r.patch::jsonb))
            when 'divdel' then jsonb_set(d.base, '{divisions}', jsonb_build_array(d.div - (r.patch::jsonb #>> '{}')))
            when 'divs'   then jsonb_set(d.base, '{divisions}', to_jsonb(array_fill(d.div, array[r.patch::int])))
            when 'adddiv' then jsonb_set(d.base, '{divisions}', jsonb_build_array(d.div, d.div || r.patch::jsonb))
          end)::text,
         r.want
    from pg_temp.h117_rows() r cross join d
$t$;

create or replace function pg_temp.h117_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';  -- "test"
  v_org2  uuid := '27c15406-fdda-43ce-bc31-1a071fe254e4';  -- "Test 2"
  v_in    jsonb := '{"seasonStart":"2027-02-22","seasonEnd":"2027-05-29","minutesBetween":0,"divisions":[{"name":"ZZ117 Majors","teams":6,"perWeek":2,"lengthMin":90,"days":[0,1,2,3,4],"start":"17:00","end":"20:00","fieldType":"diamond60","teamsPerField":1,"lit":true,"id":"d1"}]}';
  v_in2   jsonb := '{"seasonStart":"2027-03-01","seasonEnd":"2027-05-29","minutesBetween":10,"divisions":[]}';
  v_name  text;
  c       record;
  r       jsonb;
  t       text;
  v_got   text;
  v_id    uuid; v_id2 uuid; v_copy uuid;
  v_at    timestamptz; v_at2 timestamptz;
  v_n     bigint;
  v_snap  jsonb;
  v_ok    boolean;
begin
  -- ── SP1: search_path pinned, definer flags, one overload each ─────────────
  for c in select p.proname, p.prosecdef, p.proconfig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('practice_plan_input_problem', 'create_practice_plan', 'copy_practice_plan',
                                'save_practice_plan', 'delete_practice_plan') loop
    if c.proconfig is null or not ('search_path=public, pg_temp' = any (c.proconfig)) then
      return 'SP1 ' || c.proname || ' does not pin search_path';
    end if;
    if c.prosecdef is distinct from (c.proname <> 'practice_plan_input_problem') then
      return 'SP1 ' || c.proname || ' security definer is ' || c.prosecdef;
    end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('practice_plan_input_problem', 'create_practice_plan', 'copy_practice_plan',
                          'save_practice_plan', 'delete_practice_plan')) <> 5 then
    return 'SP1 not exactly one overload of each';
  end if;

  -- ── PR1: privileges per role ──────────────────────────────────────────────
  for c in select f.fn, x.role_name,
                  (f.fn <> 'public.practice_plan_input_problem(jsonb)' and x.role_name = 'authenticated') as expected
             from unnest(array[
                    'public.practice_plan_input_problem(jsonb)',
                    'public.create_practice_plan(uuid, text, jsonb, integer, text)',
                    'public.copy_practice_plan(uuid, text)',
                    'public.save_practice_plan(uuid, timestamp with time zone, text, jsonb, integer, text)',
                    'public.delete_practice_plan(uuid)']) f(fn),
                  unnest(array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']) x(role_name) loop
    if has_function_privilege(c.role_name, c.fn, 'EXECUTE') is distinct from c.expected then
      return format('PR1 %s EXECUTE on %s is %s', c.role_name, c.fn, not c.expected);
    end if;
  end loop;
  for c in select x.role_name from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) x(role_name) loop
    if has_table_privilege(c.role_name, 'public.practice_plans', 'INSERT') or has_table_privilege(c.role_name, 'public.practice_plans', 'UPDATE')
       or has_table_privilege(c.role_name, 'public.practice_plans', 'DELETE') or has_table_privilege(c.role_name, 'public.practice_plans', 'TRUNCATE') then
      return 'PR1 ' || c.role_name || ' can write practice_plans';
    end if;
    if has_table_privilege(c.role_name, 'public.practice_plans', 'SELECT') is distinct from (c.role_name = 'authenticated') then
      return 'PR1 ' || c.role_name || ' SELECT on practice_plans wrong';
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.practice_plans'::regclass) then
    return 'PR1 RLS off';
  end if;

  -- ── XV1: the shared case table ────────────────────────────────────────────
  for c in select * from pg_temp.h117_table() loop
    v_got := public.practice_plan_input_problem(c.input::jsonb);
    if v_got is distinct from c.want then
      return format('XV1 %s: got %s, want %s', c.label, coalesce(v_got, 'null'), coalesce(c.want, 'null'));
    end if;
  end loop;

  -- ── C1: create ────────────────────────────────────────────────────────────
  t := pg_temp.h117_create(v_org, v_org, '  ZZ117 Spring  ', v_in, 1, 'sameNights');
  if t like 'ERR:%' or (t::jsonb ->> 'committed') <> 'true' then return 'C1 create: ' || left(t, 160); end if;
  r := t::jsonb;
  v_id := (r ->> 'id')::uuid;
  select to_jsonb(p) into v_snap from public.practice_plans p where p.id = v_id;
  if v_snap is null or v_snap ->> 'name' <> 'ZZ117 Spring' or (v_snap -> 'input') <> v_in
     or (v_snap ->> 'input_version') <> '1' or v_snap ->> 'mode' <> 'sameNights'
     or (v_snap ->> 'owner_id')::uuid <> v_org or (v_snap ->> 'created_by')::uuid <> v_org
     or (v_snap ->> 'updated_by')::uuid <> v_org
     or (v_snap ->> 'updated_at')::timestamptz <> (r ->> 'updated_at')::timestamptz then
    return 'C1 stored row: ' || left(v_snap::text, 200);
  end if;

  -- ── C2: not a member ──────────────────────────────────────────────────────
  select count(*) into v_n from public.practice_plans where owner_id = v_org;
  t := pg_temp.h117_create(gen_random_uuid(), v_org, 'ZZ117 X', v_in, 1, 'spread');
  if t not like 'ERR:42501:not_authorized%' then return 'C2 non-member: ' || left(t, 120); end if;
  t := pg_temp.h117_create(v_org2, v_org, 'ZZ117 X', v_in, 1, 'spread');
  if t not like 'ERR:42501:not_authorized%' then return 'C2 other league: ' || left(t, 120); end if;
  if (select count(*) from public.practice_plans where owner_id = v_org) <> v_n then return 'C2 something written'; end if;

  -- ── C3: plan ──────────────────────────────────────────────────────────────
  update public.profiles set plan = 'free' where id = v_org;
  t := pg_temp.h117_create(v_org, v_org, 'ZZ117 Free', v_in, 1, 'spread');
  update public.profiles set plan = 'pro' where id = v_org;
  if t not like 'ERR:P0001:plan_required%' then
    update public.profiles set plan = 'elite' where id = v_org;
    return 'C3 free: ' || left(t, 120);
  end if;
  t := pg_temp.h117_create(v_org, v_org, 'ZZ117 Pro', v_in, 1, 'spread');
  update public.profiles set plan = 'elite' where id = v_org;
  if t like 'ERR:%' or (t::jsonb ->> 'committed') <> 'true' then return 'C3 pro: ' || left(t, 120); end if;

  -- ── C4: refusals ──────────────────────────────────────────────────────────
  select count(*) into v_n from public.practice_plans where owner_id = v_org;
  t := pg_temp.h117_create(v_org, v_org, 'ZZ117 C', v_in || '{"cityId":"ca-santa-rosa"}', 1, 'spread');
  if t not like 'ERR:P0001:invalid_input:city_not_allowed%' then return 'C4 cityId: ' || left(t, 120); end if;
  t := pg_temp.h117_create(v_org, v_org, '   ', v_in, 1, 'spread');
  if t not like 'ERR:P0001:invalid_name%' then return 'C4 blank name: ' || left(t, 120); end if;
  t := pg_temp.h117_create(v_org, v_org, repeat('n', 81), v_in, 1, 'spread');
  if t not like 'ERR:P0001:invalid_name%' then return 'C4 long name: ' || left(t, 120); end if;
  t := pg_temp.h117_create(v_org, v_org, 'ZZ117 C', v_in, 1, 'both');
  if t not like 'ERR:P0001:invalid_mode%' then return 'C4 mode: ' || left(t, 120); end if;
  t := pg_temp.h117_create(v_org, v_org, 'ZZ117 C', v_in, 2, 'spread');
  if t not like 'ERR:P0001:input_version%' then return 'C4 version: ' || left(t, 120); end if;
  t := pg_temp.h117_as('anon', null, format('select public.create_practice_plan(%L::uuid, %L, %L::jsonb, 1, %L)::text', v_org, 'ZZ117 A', v_in, 'spread'));
  if t not like 'ERR:42501:permission denied%' then return 'C4 anon: ' || left(t, 120); end if;
  if (select count(*) from public.practice_plans where owner_id = v_org) <> v_n then return 'C4 something written'; end if;

  -- ── R1: reads under RLS ───────────────────────────────────────────────────
  t := pg_temp.h117_as('authenticated', v_org, format('select count(*)::text from public.practice_plans where id = %L::uuid', v_id));
  if t <> '1' then return 'R1 owner reads: ' || t; end if;
  t := pg_temp.h117_as('authenticated', v_org2, format('select count(*)::text from public.practice_plans where owner_id = %L::uuid', v_org));
  if t <> '0' then return 'R1 other league reads: ' || t; end if;
  t := pg_temp.h117_as('anon', null, 'select count(*)::text from public.practice_plans');
  if t not like 'ERR:42501:permission denied%' then return 'R1 anon reads: ' || left(t, 120); end if;

  -- ── W0: no direct writes ──────────────────────────────────────────────────
  t := pg_temp.h117_as('authenticated', v_org, format(
    'insert into public.practice_plans (owner_id, name, input) values (%L::uuid, %L, %L::jsonb) returning id::text', v_org, 'ZZ117 W', v_in));
  if t not like 'ERR:42501:%' then return 'W0 insert: ' || left(t, 120); end if;
  t := pg_temp.h117_as('authenticated', v_org, format('update public.practice_plans set name = %L where id = %L::uuid returning id::text', 'ZZ117 W', v_id));
  if t not like 'ERR:42501:%' then return 'W0 update: ' || left(t, 120); end if;
  t := pg_temp.h117_as('authenticated', v_org, format('delete from public.practice_plans where id = %L::uuid returning id::text', v_id));
  if t not like 'ERR:42501:%' then return 'W0 delete: ' || left(t, 120); end if;

  -- ── S1: save ──────────────────────────────────────────────────────────────
  v_at := (r ->> 'updated_at')::timestamptz;
  t := pg_temp.h117_save(v_org, v_id, v_at, 'ZZ117 Spring v2', v_in2, 'spread');
  if t like 'ERR:%' or (t::jsonb ->> 'committed') <> 'true' or (t::jsonb ->> 'status') <> 'saved' then return 'S1 save: ' || left(t, 160); end if;
  v_at2 := (t::jsonb ->> 'updated_at')::timestamptz;
  select to_jsonb(p) into v_snap from public.practice_plans p where p.id = v_id;
  if v_at2 <= v_at or (v_snap ->> 'updated_at')::timestamptz <> v_at2 or v_snap ->> 'name' <> 'ZZ117 Spring v2'
     or (v_snap -> 'input') <> v_in2 or v_snap ->> 'mode' <> 'spread' or (v_snap ->> 'updated_by')::uuid <> v_org then
    return 'S1 stored row: ' || left(v_snap::text, 200);
  end if;

  -- ── S2: a stale save writes nothing and says who and when ────────────────
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_name from public.profiles p where p.id = v_org;
  t := pg_temp.h117_save(v_org, v_id, v_at, 'ZZ117 stale', v_in, 'sameNights');
  if t like 'ERR:%' then return 'S2 stale save errored: ' || left(t, 160); end if;
  r := t::jsonb;
  if r ->> 'committed' <> 'false' or r ->> 'status' <> 'stale' or (r ->> 'updated_at')::timestamptz <> v_at2
     or (r ->> 'updated_by_id')::uuid is distinct from v_org or r ->> 'updated_by_name' is distinct from v_name then
    return 'S2 stale reply: ' || left(t, 200);
  end if;
  if (select to_jsonb(p) from public.practice_plans p where p.id = v_id) <> v_snap then return 'S2 the row changed'; end if;

  -- ── S3: "Keep mine" is a second call with the newer updated_at ────────────
  t := pg_temp.h117_save(v_org, v_id, (r ->> 'updated_at')::timestamptz, 'ZZ117 mine', v_in, 'sameNights');
  if t like 'ERR:%' or (t::jsonb ->> 'committed') <> 'true' then return 'S3 keep mine: ' || left(t, 160); end if;
  v_at := (t::jsonb ->> 'updated_at')::timestamptz;
  select to_jsonb(p) into v_snap from public.practice_plans p where p.id = v_id;
  if v_snap ->> 'name' <> 'ZZ117 mine' then return 'S3 not saved'; end if;

  -- ── S4: refusals leave the row alone ──────────────────────────────────────
  t := pg_temp.h117_save(v_org2, v_id, v_at, 'ZZ117 theirs', v_in2, 'spread');
  if t not like 'ERR:42501:not_authorized%' then return 'S4 other league: ' || left(t, 120); end if;
  update public.profiles set plan = 'free' where id = v_org;
  t := pg_temp.h117_save(v_org, v_id, v_at, 'ZZ117 free', v_in2, 'spread');
  update public.profiles set plan = 'elite' where id = v_org;
  if t not like 'ERR:P0001:plan_required%' then return 'S4 free: ' || left(t, 120); end if;
  t := pg_temp.h117_save(v_org, v_id, v_at, 'ZZ117 bad', v_in || '{"notes":"x"}', 'spread');
  if t not like 'ERR:P0001:invalid_input:unknown_key%' then return 'S4 invalid: ' || left(t, 120); end if;
  if (select to_jsonb(p) from public.practice_plans p where p.id = v_id) <> v_snap then return 'S4 the row changed'; end if;

  -- ── S5: millisecond precision ─────────────────────────────────────────────
  if exists (select 1 from public.practice_plans where owner_id = v_org
              and (updated_at <> date_trunc('milliseconds', updated_at) or created_at <> date_trunc('milliseconds', created_at))) then
    return 'S5 a stamp finer than a millisecond';
  end if;

  -- ── K1: copy is an exact duplicate ────────────────────────────────────────
  update public.practice_plans set input_version = 2 where id = v_id;  -- an older-format plan stays as it is
  select to_jsonb(p) into v_snap from public.practice_plans p where p.id = v_id;
  t := pg_temp.h117_as('authenticated', v_org, format('select public.copy_practice_plan(%L::uuid, %L)::text', v_id, '  ZZ117 Copy  '));
  if t like 'ERR:%' or (t::jsonb ->> 'committed') <> 'true' then return 'K1 copy: ' || left(t, 160); end if;
  v_copy := (t::jsonb ->> 'id')::uuid;
  select (p.owner_id = v_org and p.name = 'ZZ117 Copy' and p.input = (v_snap -> 'input') and p.input_version = 2
          and p.mode = v_snap ->> 'mode' and p.created_by = v_org and p.id <> v_id)
    into v_ok from public.practice_plans p where p.id = v_copy;
  if v_ok is not true then return 'K1 copied row: ' || left((select to_jsonb(p)::text from public.practice_plans p where p.id = v_copy), 200); end if;
  if (select to_jsonb(p) from public.practice_plans p where p.id = v_id) <> v_snap then return 'K1 the source changed'; end if;

  -- ── K2: copy refusals ─────────────────────────────────────────────────────
  t := pg_temp.h117_as('authenticated', v_org2, format('select public.copy_practice_plan(%L::uuid, %L)::text', v_id, 'ZZ117 theirs'));
  if t not like 'ERR:42501:not_authorized%' then return 'K2 other league: ' || left(t, 120); end if;
  update public.profiles set plan = 'free' where id = v_org;
  t := pg_temp.h117_as('authenticated', v_org, format('select public.copy_practice_plan(%L::uuid, %L)::text', v_id, 'ZZ117 free'));
  update public.profiles set plan = 'elite' where id = v_org;
  if t not like 'ERR:P0001:plan_required%' then return 'K2 free: ' || left(t, 120); end if;

  -- ── D1: delete — membership only ──────────────────────────────────────────
  t := pg_temp.h117_as('authenticated', v_org2, format('select public.delete_practice_plan(%L::uuid)::text', v_copy));
  if t not like 'ERR:42501:not_authorized%' then return 'D1 other league: ' || left(t, 120); end if;
  if not exists (select 1 from public.practice_plans where id = v_copy) then return 'D1 deleted by the other league'; end if;
  update public.profiles set plan = 'free' where id = v_org;
  t := pg_temp.h117_as('authenticated', v_org, format('select public.delete_practice_plan(%L::uuid)::text', v_copy));
  update public.profiles set plan = 'elite' where id = v_org;
  if t like 'ERR:%' or (t::jsonb ->> 'committed') <> 'true' then return 'D1 free delete: ' || left(t, 120); end if;
  if exists (select 1 from public.practice_plans where id = v_copy) then return 'D1 row still there'; end if;
  t := pg_temp.h117_as('authenticated', v_org, format('select public.delete_practice_plan(%L::uuid)::text', gen_random_uuid()));
  if t not like 'ERR:P0001:plan_not_found%' then return 'D1 unknown id: ' || left(t, 120); end if;

  return 'pass';
end;
$f$;

do $h$
declare
  v_mig text := $mig117$
-- @@MIGRATION_0117@@
$mig117$;
  v_fns text;
  v_out text := '';
  v_res text;
  v_mut text;
  v_cut int;
  v_src text;
  m record;
begin
  execute v_mig;

  v_out := v_out || (select string_agg('md5 ' || proname || ' ' || md5(prosrc), E'\n' order by proname) from pg_proc
                      where pronamespace = 'public'::regnamespace
                        and proname in ('practice_plan_input_problem', 'create_practice_plan', 'copy_practice_plan',
                                        'save_practice_plan', 'delete_practice_plan')) || E'\n';

  -- The table as run (label|kind|patch|want per row, ordered by label in byte
  -- order): compare with `practice-plans-build.ts --md5`.
  v_out := v_out || 'table ' || (select count(*) from pg_temp.h117_rows()) || ' rows, md5 '
        || (select md5(string_agg(label || '|' || kind || '|' || patch || '|' || coalesce(want, ''), E'\n' order by label collate "C"))
              from pg_temp.h117_rows()) || E'\n';

  begin
    v_res := pg_temp.h117_case();
    raise exception 'H117CASE:%', v_res;
  exception when others then
    v_out := v_out || 'BASELINE ' || replace(sqlerrm, 'H117CASE:', '') || E'\n';
  end;

  -- Mutants re-run the FUNCTION part of the migration only (the table has
  -- already been created); each runs in its own subtransaction, rolled back.
  v_cut := strpos(v_mig, '-- 2. practice_plan_input_problem');
  v_fns := substr(v_mig, v_cut);

  for m in select * from (values
    ('MU1', 'C3', $a$where p.id = p_org_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then$a$, $b$where p.id = p_org_id;
  if false then$b$, null, null),
    ('MU2', 'S2', $a$  if v_row.updated_at <> p_expected_updated_at then$a$, $b$  if false then$b$, null, null),
    ('MU3', 'S4', $a$  select * into v_row from public.practice_plans where id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_row.owner_id) then$a$, $b$  select * into v_row from public.practice_plans where id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if false then$b$, null, null),
    ('MU4', 'D1', $a$  delete from public.practice_plans where id = p_plan_id;$a$,
     $b$  if (select plan from public.profiles where id = v_owner) not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;
  delete from public.practice_plans where id = p_plan_id;$b$, null, null),
    ('MU5', 'K2', $a$  if not public.is_org_member(v_src.owner_id) then$a$, $b$  if false then$b$, null, null),
    ('MU6', 'XV1', $a$  if p_input ? 'cityId' then
    return 'city_not_allowed';
  end if;
$a$, $b$$b$, null, null),
    ('MU7', 'XV1', $a$if v_n % 1 <> 0 or v_n < 0 or v_n > 60 then return 'teams'; end if;$a$,
     $b$if v_n % 1 <> 0 or v_n < 0 or v_n > 61 then return 'teams'; end if;$b$, null, null),
    ('MU8', 'MIG', $a$  p_mode                text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$$a$, $b$  p_mode                text
)
returns jsonb
language plpgsql
security definer
as $$$b$, null, null),
    ('MU8b', 'SP1', $a$  p_mode                text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$$a$, $b$  p_mode                text
)
returns jsonb
language plpgsql
security definer
as $$$b$,
     $a$    if r.proconfig is null or not ('search_path=public, pg_temp' = any (r.proconfig)) then
      v_bad := v_bad || format(' [%s does not pin search_path]', r.proname);
    end if;$a$, $b$$b$),
    ('MU9', 'MIG', $a$grant execute on function public.create_practice_plan(uuid, text, jsonb, integer, text)
  to authenticated;$a$, $b$grant execute on function public.create_practice_plan(uuid, text, jsonb, integer, text)
  to authenticated, anon;$b$, null, null),
    ('MU10', 'S5', $a$  v_at      timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_rows    integer;$a$, $b$  v_at      timestamptz := clock_timestamp();
  v_rows    integer;$b$, null, null),
    ('MU11', 'K1', $a$  values (v_src.owner_id, v_name, v_src.input, v_src.input_version, v_src.mode,$a$,
     $b$  values (v_src.owner_id, v_name, v_src.input, 1, 'spread',$b$, null, null),
    ('MU12', 'S2', $a$                              'updated_by_name', v_by_name);$a$,
     $b$                              'updated_by_name', null);$b$, null, null),
    ('MU13', 'XV1', $a$      if v_e = any (v_seen) then return 'days'; end if;
$a$, $b$$b$, null, null)
  ) as x(id, expect, find, repl, find2, repl2)
  loop
    if (length(v_fns) - length(replace(v_fns, m.find, ''))) / length(m.find) <> 1
       or (m.find2 is not null and (length(v_fns) - length(replace(v_fns, m.find2, ''))) / length(m.find2) <> 1) then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    v_src := replace(v_fns, m.find, m.repl);
    if m.find2 is not null then v_src := replace(v_src, m.find2, m.repl2); end if;
    begin
      begin
        execute v_src;
      exception when others then
        raise exception 'H117CASE:MIG %', sqlerrm;
      end;
      v_res := pg_temp.h117_case();
      raise exception 'H117CASE:%', v_res;
    exception when others then
      v_mut := replace(sqlerrm, 'H117CASE:', '');
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED' when v_mut = 'pass' then 'SURVIVED' else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 160), m.expect);
    end;
  end loop;

  raise exception E'ROLLED BACK — 0117 proof\n%', v_out;
end $h$;

-- Leak check (run separately afterwards; every value must be null / 0 and
-- the "test" plan still elite until 0117 is applied):
-- select to_regclass('public.practice_plans'),
--        to_regprocedure('public.practice_plan_input_problem(jsonb)'),
--        to_regprocedure('public.create_practice_plan(uuid, text, jsonb, integer, text)'),
--        to_regprocedure('public.copy_practice_plan(uuid, text)'),
--        to_regprocedure('public.save_practice_plan(uuid, timestamp with time zone, text, jsonb, integer, text)'),
--        to_regprocedure('public.delete_practice_plan(uuid)'),
--        (select plan from public.profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6'),
--        (select plan from public.profiles where id = '27c15406-fdda-43ce-bc31-1a071fe254e4'),
--        (select count(*) from pg_proc where proname like 'h117%');

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- 2026-10-21 — against production, "test" proof org (+ "Test 2" as the other
--   league), rolled back. The batch carried the harness's statements and the
--   migration from its "-- 1. The table" section on, verbatim (the migration's
--   file-header comment is never stored; the md5s below prove the bodies).
--   Run 1 refused at COMPILE, nothing ran: the 'divs' row builder used
--   jsonb_agg(d.div) over generate_series — an aggregate whose only argument
--   is an OUTER column belongs to the outer query ("r.label must appear in the
--   GROUP BY"). Fixed with to_jsonb(array_fill(d.div, …)); the table md5 is
--   unchanged (the builder is not part of the table).
--   Run 2 GREEN. md5(prosrc) printed, each equal to `practice-plans-build.ts
--   --md5`: copy_practice_plan 31a4a78d7ad7d7dd3299f7f6a9ed84dd,
--   create_practice_plan 1ef653c9eb5fbccf09e7e4e604e34250,
--   delete_practice_plan f0c8d4197e4e9074a698a6462be550d2,
--   practice_plan_input_problem fc9ad6da607acc9d7ec80ca22e16e7f1,
--   save_practice_plan eb327a8f31123181978482d08a13287a; table 105 rows, md5
--   cf7d04f6d48c066eef3b6ad2743d0261 (equal). BASELINE pass. MU1 C3, MU2 S2,
--   MU3 S4, MU4 D1, MU5 K2, MU6 XV1, MU7 XV1, MU8 MIG, MU8b SP1, MU9 MIG,
--   MU10 S5, MU11 K1, MU12 S2, MU13 XV1 — 14/14 KILLED at their own tag.
--   Leak check: no practice_plans table, none of the five functions, 0 h117
--   temp functions, 0 policies, not in schema_migrations; "test" and
--   "Test 2" still elite. 0117 NOT applied.
-- 2026-10-21 20:02 UTC — 0117 APPLIED verbatim (catalog 20261021200232) on
--   Whit's go, after a read-only check (no transaction open > 5 s, no lock on
--   profiles). md5(prosrc) of all five equal to the values above; one
--   overload each; search_path pinned on all five; EXECUTE authenticated only
--   on the four entry points, none on the input check; table SELECT
--   authenticated only, no write grant, RLS on; leak check clean (0 rows, 0
--   h117 functions, no triggers).
