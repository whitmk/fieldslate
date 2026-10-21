-- 0117: saved practice field plans — the in-app practice planner's storage
-- (2026-10-21, Whit; mockup docs/mockups/practice-planner.html).
--
-- WHAT.
--   1. practice_plans: one row per saved plan. A plan belongs to the LEAGUE
--      (org, owner_id), not a season: no league_id, no link to divisions or
--      teams — it is a snapshot the admin edits.
--   2. practice_plan_input_problem(input): the shape check every write runs.
--      Returns null for a good input, else ONE problem key. Callable by no
--      role; the write functions reach it as its owner.
--   3. create_practice_plan, copy_practice_plan, save_practice_plan: member
--      of the org AND Pro/Elite (plan_required). delete_practice_plan: member
--      only, so a league that dropped to Free can still delete its plans
--      (decided 2026-10-21).
--
-- THE STORED INPUT is the practice-planner module's PlanCore — seasonStart,
-- seasonEnd, minutesBetween, divisions — with an optional `lit` and `id` per
-- division. NO city: every plan reads the league's profiles.sunset_city when
-- it opens, so a `cityId` key is refused by name (city_not_allowed) and any
-- other unknown key is refused (unknown_key / division_unknown_key) — a key
-- the module gains later is refused until a migration allows it.
--
-- THE LIMITS (one place in TypeScript: src/lib/practice-plans/plan-input.ts,
-- INPUT_LIMITS; the calculator's own form stays inside every one of them):
--   dates            "" or YYYY-MM-DD, a real date, year 2000–2099 (reversed
--                    dates are allowed — the planner explains them)
--   minutesBetween   integer 0–30
--   divisions        0–40
--   name             a string of 0–60 characters
--   teams            integer 0–60       perWeek        integer 0–7
--   lengthMin        integer 15–240     teamsPerField  integer 1–4
--   days             0–7 distinct integers 0–6
--   start, end       "HH:MM", 00:00–23:59 (end before start is allowed)
--   fieldType        one of the six the module knows
--   lit              optional boolean   id             optional string, 1–40
-- An "integer" is a JSON number with no fractional part (6.0 counts as 6).
-- ONE CASE TABLE PINS THIS FUNCTION AND THE TYPESCRIPT TWIN: the block
-- between the PLANINPUT-TABLE-BEGIN / -END lines in
-- scripts/sim/practice-plans-sim.sql, run through this function by the SQL
-- proof and through practicePlanInputProblem by sim:practice-plan-input.
-- Never a second copy. A planner-valid input must never be refused on save.
--
-- TWO ADMINS, ONE PLAN. save_practice_plan takes the updated_at the browser
-- loaded. If the row has been saved since, it writes NOTHING and answers
-- {committed:false, status:'stale', updated_at, updated_by_id,
-- updated_by_name}. "Keep mine" is a SECOND call carrying that newer
-- updated_at — never automatic. updated_at is stored at MILLISECOND
-- precision so the browser's Date round-trips it exactly.
--
-- PRIVILEGES. The table: RLS on, SELECT for authenticated members of the org
-- (is_org_member, the 0049 form), and NO write grant to any role — every
-- write is a function below. service_role gets nothing (the admin client
-- never touches this table). Every function is revoked from public, anon,
-- authenticated, service_role and dashboard_readonly first (a role-level
-- revoke alone is a no-op), then the four entry points are granted to
-- authenticated. Every function pins search_path. The final DO block checks
-- every role and aborts the migration on a mismatch.
--
-- NO ACTIVITY LOG: activity_log rows belong to a season; a plan has none.
--
-- LOCKS WHEN APPLIED: CREATE TABLE with three foreign keys to profiles takes
-- SHARE ROW EXCLUSIVE on `profiles` for the statement — profile WRITES
-- (signups, settings, a webhook's plan update) wait an instant; reads don't.
-- Everything else is new.
--
-- APPLY VERBATIM, comments included (CLAUDE.md). Verify md5(prosrc) of all
-- five functions against this file after applying.
--
-- DEPLOY ORDER: apply BEFORE the code that reads practice_plans or calls
-- these functions reaches `main`.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The table
-- ────────────────────────────────────────────────────────────────────────────
create table public.practice_plans (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  input         jsonb not null,
  input_version integer not null default 1,
  mode          text not null default 'spread',
  created_at    timestamptz not null default date_trunc('milliseconds', now()),
  created_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default date_trunc('milliseconds', now()),
  updated_by    uuid references public.profiles(id) on delete set null,
  constraint practice_plans_name_check check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint practice_plans_input_object check (jsonb_typeof(input) = 'object'),
  constraint practice_plans_input_version_check check (input_version >= 1),
  constraint practice_plans_mode_check check (mode in ('spread', 'sameNights'))
);

create index practice_plans_owner_idx on public.practice_plans (owner_id, updated_at desc);

alter table public.practice_plans enable row level security;

create policy "Org members can read practice plans"
  on public.practice_plans
  for select
  to authenticated
  using (public.is_org_member(owner_id));

revoke all on table public.practice_plans from public, anon, authenticated, service_role, dashboard_readonly;
grant select on table public.practice_plans to authenticated;

comment on table public.practice_plans is
  'Saved practice field plans (the in-app practice planner). Org-scoped, not season-scoped. input = the practice-planner PlanCore (no city) plus lit/id per division, checked by practice_plan_input_problem. Written ONLY by create/copy/save/delete_practice_plan (0117).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. practice_plan_input_problem
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.practice_plan_input_problem(p_input jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_s    text;
  v_date date;
  v_k    text;
  v_d    jsonb;
  v_x    jsonb;
  v_n    numeric;
  v_seen integer[];
  v_e    integer;
begin
  -- Same order as the TypeScript twin: the first problem found is the answer.
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    return 'not_an_object';
  end if;
  if p_input ? 'cityId' then
    return 'city_not_allowed';
  end if;
  if exists (select 1 from jsonb_object_keys(p_input) k
              where k not in ('seasonStart', 'seasonEnd', 'minutesBetween', 'divisions')) then
    return 'unknown_key';
  end if;
  if not (p_input ?& array['seasonStart', 'seasonEnd', 'minutesBetween', 'divisions']) then
    return 'missing_key';
  end if;

  foreach v_k in array array['seasonStart', 'seasonEnd'] loop
    v_x := p_input -> v_k;
    if jsonb_typeof(v_x) <> 'string' then
      return case v_k when 'seasonStart' then 'season_start' else 'season_end' end;
    end if;
    v_s := v_x #>> '{}';
    if v_s <> '' then
      if v_s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        return case v_k when 'seasonStart' then 'season_start' else 'season_end' end;
      end if;
      begin
        v_date := v_s::date;
      exception when others then
        return case v_k when 'seasonStart' then 'season_start' else 'season_end' end;
      end;
      if to_char(v_date, 'YYYY-MM-DD') <> v_s or extract(year from v_date) not between 2000 and 2099 then
        return case v_k when 'seasonStart' then 'season_start' else 'season_end' end;
      end if;
    end if;
  end loop;

  v_x := p_input -> 'minutesBetween';
  if jsonb_typeof(v_x) <> 'number' then return 'minutes_between'; end if;
  v_n := v_x::numeric;
  if v_n % 1 <> 0 or v_n < 0 or v_n > 30 then return 'minutes_between'; end if;

  if jsonb_typeof(p_input -> 'divisions') <> 'array' then return 'divisions'; end if;
  if jsonb_array_length(p_input -> 'divisions') > 40 then return 'division_count'; end if;

  for v_d in select e from jsonb_array_elements(p_input -> 'divisions') with ordinality as t(e, i) order by i loop
    if jsonb_typeof(v_d) <> 'object' then return 'division_not_object'; end if;
    if exists (select 1 from jsonb_object_keys(v_d) k
                where k not in ('id', 'name', 'teams', 'perWeek', 'lengthMin', 'days', 'start', 'end',
                                'fieldType', 'teamsPerField', 'lit')) then
      return 'division_unknown_key';
    end if;
    if not (v_d ?& array['name', 'teams', 'perWeek', 'lengthMin', 'days', 'start', 'end', 'fieldType', 'teamsPerField']) then
      return 'division_missing_key';
    end if;

    if jsonb_typeof(v_d -> 'name') <> 'string' or char_length(v_d ->> 'name') > 60 then return 'division_name'; end if;

    v_x := v_d -> 'teams';
    if jsonb_typeof(v_x) <> 'number' then return 'teams'; end if;
    v_n := v_x::numeric;
    if v_n % 1 <> 0 or v_n < 0 or v_n > 60 then return 'teams'; end if;

    v_x := v_d -> 'perWeek';
    if jsonb_typeof(v_x) <> 'number' then return 'per_week'; end if;
    v_n := v_x::numeric;
    if v_n % 1 <> 0 or v_n < 0 or v_n > 7 then return 'per_week'; end if;

    v_x := v_d -> 'lengthMin';
    if jsonb_typeof(v_x) <> 'number' then return 'length'; end if;
    v_n := v_x::numeric;
    if v_n % 1 <> 0 or v_n < 15 or v_n > 240 then return 'length'; end if;

    v_x := v_d -> 'days';
    if jsonb_typeof(v_x) <> 'array' or jsonb_array_length(v_x) > 7 then return 'days'; end if;
    v_seen := array[]::integer[];
    for v_k in select jsonb_typeof(e) from jsonb_array_elements(v_x) e loop
      if v_k <> 'number' then return 'days'; end if;
    end loop;
    for v_n in select e::numeric from jsonb_array_elements(v_x) e loop
      if v_n % 1 <> 0 or v_n < 0 or v_n > 6 then return 'days'; end if;
      v_e := v_n::integer;
      if v_e = any (v_seen) then return 'days'; end if;
      v_seen := array_append(v_seen, v_e);
    end loop;

    if jsonb_typeof(v_d -> 'start') <> 'string' or (v_d ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return 'start';
    end if;
    if jsonb_typeof(v_d -> 'end') <> 'string' or (v_d ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return 'end';
    end if;

    if jsonb_typeof(v_d -> 'fieldType') <> 'string'
       or (v_d ->> 'fieldType') not in ('diamond60', 'diamond5070', 'diamond90', 'softball', 'soccerSmall', 'soccerFull') then
      return 'field_type';
    end if;

    v_x := v_d -> 'teamsPerField';
    if jsonb_typeof(v_x) <> 'number' then return 'teams_per_field'; end if;
    v_n := v_x::numeric;
    if v_n % 1 <> 0 or v_n < 1 or v_n > 4 then return 'teams_per_field'; end if;

    if v_d ? 'lit' and jsonb_typeof(v_d -> 'lit') <> 'boolean' then return 'lit'; end if;

    if v_d ? 'id' and (jsonb_typeof(v_d -> 'id') <> 'string' or char_length(v_d ->> 'id') not between 1 and 40) then
      return 'id';
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.practice_plan_input_problem(jsonb)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. create_practice_plan
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.create_practice_plan(
  p_org_id        uuid,
  p_name          text,
  p_input         jsonb,
  p_input_version integer,
  p_mode          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan    text;
  v_name    text := btrim(p_name);
  v_problem text;
  v_id      uuid;
  v_at      timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  if p_org_id is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if p_input_version is distinct from 1 then
    raise exception 'input_version' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('spread', 'sameNights') then
    raise exception 'invalid_mode' using errcode = 'P0001';
  end if;
  v_problem := public.practice_plan_input_problem(p_input);
  if v_problem is not null then
    raise exception 'invalid_input:%', v_problem using errcode = 'P0001';
  end if;

  insert into public.practice_plans (owner_id, name, input, input_version, mode,
                                     created_at, created_by, updated_at, updated_by)
  values (p_org_id, v_name, p_input, 1, p_mode, v_at, auth.uid(), v_at, auth.uid())
  returning id into v_id;

  return jsonb_build_object('committed', true, 'id', v_id, 'updated_at', v_at);
end;
$$;

revoke execute on function public.create_practice_plan(uuid, text, jsonb, integer, text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.create_practice_plan(uuid, text, jsonb, integer, text)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. copy_practice_plan — an exact duplicate (input, version, mode); only the
--    name is new. Team counts are NOT refreshed (decided 2026-10-21).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.copy_practice_plan(p_plan_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src  public.practice_plans%rowtype;
  v_plan text;
  v_name text := btrim(p_name);
  v_id   uuid;
  v_at   timestamptz := date_trunc('milliseconds', clock_timestamp());
begin
  if p_plan_id is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  select * into v_src from public.practice_plans where id = p_plan_id for share;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_src.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_src.owner_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  insert into public.practice_plans (owner_id, name, input, input_version, mode,
                                     created_at, created_by, updated_at, updated_by)
  values (v_src.owner_id, v_name, v_src.input, v_src.input_version, v_src.mode,
          v_at, auth.uid(), v_at, auth.uid())
  returning id into v_id;

  return jsonb_build_object('committed', true, 'id', v_id, 'updated_at', v_at);
end;
$$;

revoke execute on function public.copy_practice_plan(uuid, text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.copy_practice_plan(uuid, text)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. save_practice_plan — guarded by the updated_at the browser loaded
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.save_practice_plan(
  p_plan_id             uuid,
  p_expected_updated_at timestamptz,
  p_name                text,
  p_input               jsonb,
  p_input_version       integer,
  p_mode                text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     public.practice_plans%rowtype;
  v_plan    text;
  v_name    text := btrim(p_name);
  v_problem text;
  v_by_name text;
  v_at      timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_rows    integer;
begin
  if p_plan_id is null or p_expected_updated_at is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  select * into v_row from public.practice_plans where id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_row.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_row.owner_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if p_input_version is distinct from 1 then
    raise exception 'input_version' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('spread', 'sameNights') then
    raise exception 'invalid_mode' using errcode = 'P0001';
  end if;
  v_problem := public.practice_plan_input_problem(p_input);
  if v_problem is not null then
    raise exception 'invalid_input:%', v_problem using errcode = 'P0001';
  end if;

  -- Someone saved since this browser loaded the plan: write nothing, and say
  -- who and when. Overwriting takes a second call with this updated_at.
  if v_row.updated_at <> p_expected_updated_at then
    select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_by_name
      from public.profiles p where p.id = v_row.updated_by;
    return jsonb_build_object('committed', false, 'status', 'stale',
                              'updated_at', v_row.updated_at,
                              'updated_by_id', v_row.updated_by,
                              'updated_by_name', v_by_name);
  end if;

  -- Never move updated_at backwards or leave it equal (two saves inside one
  -- millisecond would otherwise look like no save at all to the next guard).
  if v_at <= v_row.updated_at then
    v_at := v_row.updated_at + interval '1 millisecond';
  end if;

  update public.practice_plans
     set name = v_name, input = p_input, input_version = 1, mode = p_mode,
         updated_at = v_at, updated_by = auth.uid()
   where id = p_plan_id
     and updated_at = p_expected_updated_at;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  return jsonb_build_object('committed', true, 'status', 'saved', 'id', p_plan_id, 'updated_at', v_at);
end;
$$;

revoke execute on function public.save_practice_plan(uuid, timestamptz, text, jsonb, integer, text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.save_practice_plan(uuid, timestamptz, text, jsonb, integer, text)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. delete_practice_plan — membership only (a downgraded league can delete)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_practice_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_rows  integer;
begin
  if p_plan_id is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from public.practice_plans where id = p_plan_id for update;
  if not found then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_owner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  delete from public.practice_plans where id = p_plan_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  return jsonb_build_object('committed', true, 'id', p_plan_id);
end;
$$;

revoke execute on function public.delete_practice_plan(uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.delete_practice_plan(uuid)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Verify privileges, search_path and RLS (a mismatch aborts the migration)
-- ────────────────────────────────────────────────────────────────────────────
do $verify$
declare
  r     record;
  v_has boolean;
  v_bad text := '';
begin
  for r in select f.fn, x.role_name,
                  (f.fn <> 'public.practice_plan_input_problem(jsonb)' and x.role_name = 'authenticated') as expected
             from unnest(array[
                    'public.practice_plan_input_problem(jsonb)',
                    'public.create_practice_plan(uuid, text, jsonb, integer, text)',
                    'public.copy_practice_plan(uuid, text)',
                    'public.save_practice_plan(uuid, timestamp with time zone, text, jsonb, integer, text)',
                    'public.delete_practice_plan(uuid)']) f(fn),
                  unnest(array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']) x(role_name)
  loop
    v_has := has_function_privilege(r.role_name, r.fn, 'EXECUTE');
    if v_has is distinct from r.expected then
      v_bad := v_bad || format(' [%s EXECUTE on %s is %s]', r.role_name, r.fn, v_has);
    end if;
  end loop;

  for r in select p.proname, p.prosecdef, p.proconfig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('practice_plan_input_problem', 'create_practice_plan', 'copy_practice_plan',
                                'save_practice_plan', 'delete_practice_plan')
  loop
    if r.proconfig is null or not ('search_path=public, pg_temp' = any (r.proconfig)) then
      v_bad := v_bad || format(' [%s does not pin search_path]', r.proname);
    end if;
    if r.prosecdef is distinct from (r.proname <> 'practice_plan_input_problem') then
      v_bad := v_bad || format(' [%s security definer is %s]', r.proname, r.prosecdef);
    end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('practice_plan_input_problem', 'create_practice_plan', 'copy_practice_plan',
                          'save_practice_plan', 'delete_practice_plan')) <> 5 then
    v_bad := v_bad || ' [not exactly one overload of each function]';
  end if;

  for r in select x.role_name from unnest(array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']) x(role_name)
  loop
    if r.role_name <> 'public' and (has_table_privilege(r.role_name, 'public.practice_plans', 'INSERT')
       or has_table_privilege(r.role_name, 'public.practice_plans', 'UPDATE')
       or has_table_privilege(r.role_name, 'public.practice_plans', 'DELETE')
       or has_table_privilege(r.role_name, 'public.practice_plans', 'TRUNCATE')) then
      v_bad := v_bad || format(' [%s can write practice_plans]', r.role_name);
    end if;
    if r.role_name not in ('public', 'authenticated') and has_table_privilege(r.role_name, 'public.practice_plans', 'SELECT') then
      v_bad := v_bad || format(' [%s can read practice_plans]', r.role_name);
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.practice_plans', 'SELECT') then
    v_bad := v_bad || ' [authenticated cannot read practice_plans]';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.practice_plans'::regclass) then
    v_bad := v_bad || ' [RLS is off on practice_plans]';
  end if;

  if v_bad <> '' then
    raise exception '0117 verification failed:%', v_bad;
  end if;
end
$verify$;
