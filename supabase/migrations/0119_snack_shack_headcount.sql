-- 0119: snack shack — how many people a shift needs.
--
-- Decided 2026-11-07 (CLAUDE.md "Snack shack — derived shifts"):
--   * A SEASON number, `snack_shack_settings.people_per_shift` (1–20,
--     default 1 — every existing season reads exactly as before).
--   * An optional PER-SHIFT override, `snack_shack_blocks.people_needed`
--     (1–20, null = use the season's number). The effective count is
--     `coalesce(people_needed, people_per_shift)`, decided in TypeScript by
--     ONE helper (src/lib/snack-shack/headcount.ts).
--   * The full-schedule print shows "N people" only when the effective count
--     is above 1. Team prints and both emails never show it.
--   * REGENERATE CARRIES THE OVERRIDE like a note: regenerate_snack_shack_shifts
--     (0104) is re-created below, body VERBATIM from 0104 except that
--     `people_needed` joins the capture (its predicate and its jsonb), the
--     INSERT's carried columns, the `carried` predicate, and therefore `lost`
--     (a removed row's override is listed so the preview can say so). Kept
--     rows are never updated, as before. The season number is NOT carried — it
--     lives on the settings row, which the RPC never writes except its stamp.
--
-- EXISTING DATA: every settings row gets 1, every shift null; nothing else is
-- read or written.
--
-- APPLY VERBATIM, comments included. Verify md5(prosrc) of the function
-- against this file after applying. The final DO block raises if a privilege,
-- column or constraint is wrong.
--
-- DEPLOY ORDER: apply 0119 BEFORE the code reaches `main` — the Snack Shack
-- page, the regenerate preview and the wizard select and write the new
-- columns.
--
-- LOCKS THIS TAKES when applied:
--   ACCESS EXCLUSIVE on snack_shack_settings (ADD COLUMN with a constant
--     default — no rewrite — and ADD CHECK, which scans 3 rows). Blocks every
--     read and write of that table: the Snack Shack page, the venue delete
--     guard, the Teams page snack button embed, both email routes, the
--     regenerate RPC.
--   ACCESS EXCLUSIVE on snack_shack_blocks (ADD COLUMN, ADD CHECK — ~110
--     rows). Blocks every read and write of shifts for the statement.
--   Both for well under a second. Nothing on profiles, games, teams, leagues
--   or divisions (no new FK).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The two columns
-- ────────────────────────────────────────────────────────────────────────────
-- authenticated already holds table-level DML on both tables (0027), so the
-- new columns inherit it; nothing to grant. service_role holds none and gets
-- none.
alter table public.snack_shack_settings
  add column people_per_shift smallint not null default 1;
alter table public.snack_shack_settings
  add constraint snack_shack_settings_people_per_shift_range check (people_per_shift between 1 and 20);

alter table public.snack_shack_blocks
  add column people_needed smallint;
alter table public.snack_shack_blocks
  add constraint snack_shack_blocks_people_needed_range check (people_needed is null or people_needed between 1 and 20);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. regenerate_snack_shack_shifts — re-created, the override carried
-- ────────────────────────────────────────────────────────────────────────────
-- Body VERBATIM from 0104 except `people_needed` in the capture, the INSERT,
-- the `carried` predicate (and so `lost`).
--
-- Returns { kept, created, removed, removed_assignments, created_shifts,
--           carried, lost: [{date, start, end, notes, cash_person_id,
--                            people_needed}] }.
create or replace function public.regenerate_snack_shack_shifts(
  p_snack_shack_id uuid,
  p_shifts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.snack_shack_settings%rowtype;
  v_league   public.leagues%rowtype;
  v_elem     jsonb;
  v_i        integer := 0;
  v_date     text;
  v_start    text;
  v_end      text;
  v_team     text;
  v_n        integer;
  v_distinct integer;
  v_kept     integer;
  v_created  integer;
  v_removed  integer;
  v_carried  integer;
  v_removed_assignments jsonb;
  v_created_shifts      jsonb;
  v_carry    jsonb;
  v_lost     jsonb;
begin
  if p_shifts is null or jsonb_typeof(p_shifts) <> 'array' then
    raise exception 'shifts_not_array' using errcode = 'P0001';
  end if;

  select * into v_settings
  from public.snack_shack_settings
  where id = p_snack_shack_id
  for update;

  if not found then
    raise exception 'snack_shack_not_found' using errcode = 'P0001';
  end if;

  select * into v_league
  from public.leagues
  where id = v_settings.season_id;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  -- ── Validate everything before writing anything ───────────────────────────
  for v_elem in select * from jsonb_array_elements(p_shifts) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'shift_%_not_object', v_i using errcode = 'P0001';
    end if;
    v_date  := v_elem ->> 'date';
    v_start := v_elem ->> 'start';
    v_end   := v_elem ->> 'end';
    v_team  := nullif(v_elem ->> 'assigned_team_id', '');
    if v_date is null or v_date !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'shift_%_bad_date', v_i using errcode = 'P0001';
    end if;
    if v_start is null or v_start !~ '^\d{2}:\d{2}(:\d{2})?$' then
      raise exception 'shift_%_bad_start', v_i using errcode = 'P0001';
    end if;
    if v_end is null or v_end !~ '^\d{2}:\d{2}(:\d{2})?$' then
      raise exception 'shift_%_bad_end', v_i using errcode = 'P0001';
    end if;
    if v_end::time <= v_start::time then
      raise exception 'shift_%_end_not_after_start', v_i using errcode = 'P0001';
    end if;
    if v_team is not null then
      if v_team !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'shift_%_bad_team', v_i using errcode = 'P0001';
      end if;
      -- The FK only says "a team exists"; the team must be THIS season's.
      if not exists (select 1 from public.teams t where t.id = v_team::uuid and t.league_id = v_settings.season_id) then
        raise exception 'shift_%_team_not_in_season', v_i using errcode = 'P0001';
      end if;
    end if;
  end loop;

  select count(*),
         count(distinct (e ->> 'date') || '|' || (e ->> 'start')::time::text || '|' || (e ->> 'end')::time::text)
    into v_n, v_distinct
  from jsonb_array_elements(p_shifts) e;
  if v_n <> v_distinct then
    raise exception 'duplicate_shift' using errcode = 'P0001';
  end if;

  -- ── 0104: capture what the doomed rows carry, BEFORE the delete ───────────
  -- A row about to be removed may hold a note (with its attribution) and a
  -- cash person — and, since 0119, a headcount of its own. The INSERT below
  -- copies them onto the new row with the SAME
  -- date and start — in the INSERT, so the BEFORE UPDATE attribution trigger
  -- does not re-stamp the regenerating admin as the author. Doomed rows with
  -- no same-start replacement are reported in `lost`.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', b.date, 'start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'),
           'notes', b.notes, 'notes_updated_at', b.notes_updated_at, 'notes_updated_by', b.notes_updated_by,
           'cash_person_id', b.cash_person_id, 'people_needed', b.people_needed)
           order by b.date, b.start_time, b.end_time), '[]'::jsonb)
    into v_carry
  from public.snack_shack_blocks b
  where b.snack_shack_id = p_snack_shack_id
    and b.is_recurring
    and (b.notes is not null or b.cash_person_id is not null or b.people_needed is not null)
    and not exists (
      select 1 from jsonb_array_elements(p_shifts) e
      where (e ->> 'date')::date  = b.date
        and (e ->> 'start')::time = b.start_time
        and (e ->> 'end')::time   = b.end_time
    );

  -- ── Remove derived rows that are no longer derived ────────────────────────
  -- Manual rows are excluded by is_recurring; the desired set is matched on
  -- date + start + end (all three — a changed end is a different shift).
  with gone as (
    delete from public.snack_shack_blocks b
    where b.snack_shack_id = p_snack_shack_id
      and b.is_recurring
      and not exists (
        select 1 from jsonb_array_elements(p_shifts) e
        where (e ->> 'date')::date  = b.date
          and (e ->> 'start')::time = b.start_time
          and (e ->> 'end')::time   = b.end_time
      )
    returning b.date, b.start_time, b.end_time, b.assigned_team_id
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'date', g.date, 'start', to_char(g.start_time, 'HH24:MI'), 'end', to_char(g.end_time, 'HH24:MI'),
           'team_id', g.assigned_team_id) order by g.date, g.start_time)
           filter (where g.assigned_team_id is not null), '[]'::jsonb)
    into v_removed, v_removed_assignments
  from gone g;

  -- Kept rows are never updated: what survived the delete IS the kept set,
  -- assignment, note, cash person and headcount and all. (kept rows are never updated)
  select count(*) into v_kept
  from public.snack_shack_blocks b
  where b.snack_shack_id = p_snack_shack_id
    and b.is_recurring;

  -- ── Insert the desired slots that have no derived row ─────────────────────
  -- The NOT EXISTS sees the table as of statement start, so the rows this
  -- statement inserts never match themselves; duplicates within p_shifts
  -- were refused above. 0104/0119: the five carried columns come from the capture
  -- above, matched on date + start (the earliest-ending doomed row wins if
  -- two shared a start).
  with ins as (
    insert into public.snack_shack_blocks
      (snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring,
       notes, notes_updated_at, notes_updated_by, cash_person_id, people_needed)
    select p_snack_shack_id,
           (e ->> 'date')::date,
           (e ->> 'start')::time,
           (e ->> 'end')::time,
           nullif(e ->> 'assigned_team_id', '')::uuid,
           true,
           c.notes, c.notes_updated_at, c.notes_updated_by, c.cash_person_id, c.people_needed
    from jsonb_array_elements(p_shifts) e
    left join lateral (
      select (x ->> 'notes')                           as notes,
             (x ->> 'notes_updated_at')::timestamptz   as notes_updated_at,
             (x ->> 'notes_updated_by')::uuid          as notes_updated_by,
             (x ->> 'cash_person_id')::uuid            as cash_person_id,
             (x ->> 'people_needed')::smallint         as people_needed
      from jsonb_array_elements(v_carry) x
      where (x ->> 'date')::date  = (e ->> 'date')::date
        and (x ->> 'start')::time = (e ->> 'start')::time
      order by (x ->> 'end')::time
      limit 1
    ) c on true
    where not exists (
      select 1 from public.snack_shack_blocks b
      where b.snack_shack_id = p_snack_shack_id
        and b.is_recurring
        and b.date       = (e ->> 'date')::date
        and b.start_time = (e ->> 'start')::time
        and b.end_time   = (e ->> 'end')::time
    )
    returning date, start_time, end_time, assigned_team_id,
              (notes is not null or cash_person_id is not null or people_needed is not null) as carried
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'date', i.date, 'start', to_char(i.start_time, 'HH24:MI'), 'end', to_char(i.end_time, 'HH24:MI'),
           'team_id', i.assigned_team_id) order by i.date, i.start_time), '[]'::jsonb),
         count(*) filter (where i.carried)
    into v_created, v_created_shifts, v_carried
  from ins i;

  -- ── 0104: what could not be carried ───────────────────────────────────────
  select coalesce(jsonb_agg((x - 'notes_updated_at' - 'notes_updated_by')
           order by x ->> 'date', x ->> 'start'), '[]'::jsonb)
    into v_lost
  from jsonb_array_elements(v_carry) x
  where not exists (
    select 1 from jsonb_array_elements(v_created_shifts) i
    where i ->> 'date' = x ->> 'date' and i ->> 'start' = x ->> 'start'
  );

  update public.snack_shack_settings
     set shifts_generated_at = now(),
         updated_at          = now()
   where id = p_snack_shack_id;

  return jsonb_build_object(
    'kept',                v_kept,
    'created',             v_created,
    'removed',             v_removed,
    'removed_assignments', v_removed_assignments,
    'created_shifts',      v_created_shifts,
    'carried',             v_carried,
    'lost',                v_lost
  );
end;
$$;

-- CREATE OR REPLACE keeps the function's ACL, but the grants are restated so
-- this file is the whole truth and the DO block below checks it.
revoke execute on function public.regenerate_snack_shack_shifts(uuid, jsonb)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.regenerate_snack_shack_shifts(uuid, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Verify — RAISES if any privilege, column or constraint is not as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_fn    constant text := 'public.regenerate_snack_shack_shifts(uuid, jsonb)';
begin
  if has_function_privilege('anon', v_fn, 'execute')               then v_wrong := v_wrong || ' [fn anon]'; end if;
  if not has_function_privilege('authenticated', v_fn, 'execute')  then v_wrong := v_wrong || ' [fn authenticated]'; end if;
  if has_function_privilege('service_role', v_fn, 'execute')       then v_wrong := v_wrong || ' [fn service_role]'; end if;
  if has_function_privilege('dashboard_readonly', v_fn, 'execute') then v_wrong := v_wrong || ' [fn dashboard_readonly]'; end if;
  if (select count(*) from pg_proc where proname = 'regenerate_snack_shack_shifts') <> 1 then
    v_wrong := v_wrong || ' [fn overloads]';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'snack_shack_settings'
                    and column_name = 'people_per_shift' and is_nullable = 'NO' and column_default = '1') then
    v_wrong := v_wrong || ' [settings column]';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'snack_shack_blocks'
                    and column_name = 'people_needed' and is_nullable = 'YES' and column_default is null) then
    v_wrong := v_wrong || ' [blocks column]';
  end if;
  if (select count(*) from pg_constraint
       where conname in ('snack_shack_settings_people_per_shift_range', 'snack_shack_blocks_people_needed_range')
         and contype = 'c' and convalidated) <> 2 then
    v_wrong := v_wrong || ' [checks]';
  end if;
  if not has_column_privilege('authenticated', 'public.snack_shack_settings', 'people_per_shift', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.snack_shack_blocks', 'people_needed', 'UPDATE') then
    v_wrong := v_wrong || ' [authenticated cannot write]';
  end if;
  if has_column_privilege('anon', 'public.snack_shack_blocks', 'people_needed', 'SELECT')
     or has_column_privilege('service_role', 'public.snack_shack_blocks', 'people_needed', 'SELECT') then
    v_wrong := v_wrong || ' [blocks column readable by anon/service_role]';
  end if;
  if exists (select 1 from public.snack_shack_settings where people_per_shift <> 1)
     or exists (select 1 from public.snack_shack_blocks where people_needed is not null) then
    v_wrong := v_wrong || ' [existing rows not at the defaults]';
  end if;

  if v_wrong <> '' then
    raise exception '0119 verification failed:%', v_wrong;
  end if;
end;
$$;
