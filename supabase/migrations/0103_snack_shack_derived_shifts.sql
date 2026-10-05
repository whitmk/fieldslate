-- 0103: snack shack — derived shifts (rule columns, per-day absorb choices,
-- atomic regenerate).
--
-- The snack shack moves from hand-configured blocks to shifts DERIVED from the
-- game schedule (CLAUDE.md "Snack shack — derived shifts"). Every decision —
-- which games count, the day window, gaps, division into shifts, the leftover
-- absorb, which stored rows survive — lives in the TypeScript library
-- src/lib/snack-shack/derive-shifts.ts. This migration is the DATABASE half:
--   1. the RULE, three columns on snack_shack_settings;
--   2. the per-day ABSORB CHOICE, keyed by DATE + WINDOW START (never an array
--      index), in its own table;
--   3. the atomic REGENERATE function: given the desired derived shifts, it
--      deletes the derived rows that no longer exist, inserts the new ones,
--      and KEEPS every derived row whose date/start/end is unchanged — with
--      its assignment — in ONE transaction. Manual rows (is_recurring=false)
--      are never touched.
--
-- EXISTING DATA IS NOT MIGRATED. Existing snack_shack_blocks rows are not
-- read or written here; existing snack_shack_settings rows receive the
-- column defaults (30 / 30 / 120) and nothing else changes until an admin
-- regenerates. The real league's 33 blocks keep rendering exactly as before.
--
-- APPLY VERBATIM, comments included (CLAUDE.md, "Apply migrations VERBATIM").
-- Comments inside the function body are part of pg_proc.prosrc; verify
-- md5(prosrc) against this file after applying. The final DO block verifies
-- every grant and RAISES if one is wrong, so a silent no-op revoke cannot
-- pass unnoticed.
--
-- LOCKS THIS TAKES when applied:
--   ACCESS EXCLUSIVE on snack_shack_settings (ADD COLUMN with constant
--     defaults — no rewrite; ADD CONSTRAINT scans the table, 3 rows today).
--     Blocks every read and write of that table — the Snack Shack page, the
--     venue delete guard, the team button's embed, the two email routes —
--     for the statement's duration (well under a second), or for the whole
--     migration if applied in one transaction.
--   SHARE ROW EXCLUSIVE on snack_shack_settings from the new table's FK
--     (already covered by the lock above when applied in one transaction).
--   Nothing on snack_shack_blocks, games, teams, leagues or divisions.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The rule — three columns on snack_shack_settings
-- ────────────────────────────────────────────────────────────────────────────
-- open_before_min   the shack opens this many minutes before the first game
-- close_after_min   …and closes this many minutes after the last game ENDS
-- max_shift_min     the longest shift a volunteer is asked for. A leftover
--                   UNDER 60 minutes may be absorbed into a neighbouring
--                   shift, so a shift can run up to 59 minutes over this —
--                   that is the rule working, not a bug (the UI says so).
-- shifts_generated_at  when the derived rows were last (re)generated; the
--                   page's staleness notice is computed, this is for display.
--
-- days_of_week keeps its meaning ("days the shack can open"); time_blocks_by_day
-- is no longer read by the generator and is left in place, untouched.
alter table public.snack_shack_settings
  add column open_before_min     integer not null default 30,
  add column close_after_min     integer not null default 30,
  add column max_shift_min       integer not null default 120,
  add column shifts_generated_at timestamptz null;

alter table public.snack_shack_settings
  add constraint snack_shack_settings_open_before_min_check check (open_before_min between 0 and 240),
  add constraint snack_shack_settings_close_after_min_check check (close_after_min between 0 and 240),
  add constraint snack_shack_settings_max_shift_min_check   check (max_shift_min between 30 and 480);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Per-day absorb choices — keyed by date + window start
-- ────────────────────────────────────────────────────────────────────────────
-- One row per (snack shack, date, window start): where a short leftover goes
-- on that day's window. "first" / "last" / "split" (see the library). A row
-- whose window no longer exists, or no longer has a short leftover, is left
-- in place and reported as stale by the derivation; the default applies.
create table public.snack_shack_absorb_choices (
  id             uuid primary key default gen_random_uuid(),
  snack_shack_id uuid not null references public.snack_shack_settings(id) on delete cascade,
  date           date not null,
  window_start   time not null,
  choice         text not null check (choice in ('first', 'last', 'split')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (snack_shack_id, date, window_start)
);

create index snack_shack_absorb_choices_snack_shack_id_idx
  on public.snack_shack_absorb_choices (snack_shack_id);

create trigger set_snack_shack_absorb_choices_updated_at
  before update on public.snack_shack_absorb_choices
  for each row execute procedure public.set_updated_at();

alter table public.snack_shack_absorb_choices enable row level security;

-- Same gate shape as snack_shack_blocks (0049): through the settings row to
-- the season's org.
create policy "Org members can manage snack shack absorb choices"
  on public.snack_shack_absorb_choices for all
  using (
    exists (
      select 1 from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where s.id = snack_shack_absorb_choices.snack_shack_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where s.id = snack_shack_absorb_choices.snack_shack_id
        and public.is_org_member(l.owner_id)
    )
  );

-- Table privileges: the default is removed and exactly what the browser
-- needs is granted back. service_role gets nothing (no admin-client reader
-- exists; CLAUDE.md "service_role gets NO default grants").
revoke all on table public.snack_shack_absorb_choices from public;
revoke all on table public.snack_shack_absorb_choices from anon;
revoke all on table public.snack_shack_absorb_choices from authenticated;
revoke all on table public.snack_shack_absorb_choices from service_role;
revoke all on table public.snack_shack_absorb_choices from dashboard_readonly;
grant select, insert, update, delete on table public.snack_shack_absorb_choices to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. regenerate_snack_shack_shifts(p_snack_shack_id, p_shifts) → jsonb
-- ────────────────────────────────────────────────────────────────────────────
-- p_shifts is the FULL desired set of derived shifts, computed by the
-- library in the browser:
--   [{ "date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM",
--      "assigned_team_id": "<uuid>" | null }, …]
--
-- What it does, in one transaction:
--   - row-locks the settings row → is_org_member gate on the season's org;
--   - validates every element (date, times, end after start, team belongs
--     to this season, no duplicate date/start/end) BEFORE writing anything;
--   - DELETES derived rows (is_recurring = true) whose date/start/end is not
--     in the desired set, reporting the assignments they carried;
--   - KEEPS every derived row whose date/start/end IS in the set. Its
--     assignment is never updated — the assigned_team_id passed for a kept
--     slot is IGNORED. The database, not the caller, decides what survived,
--     so a read made before the call cannot lose an assignment;
--   - INSERTS the desired slots that had no row, with the passed assignment;
--   - manual rows (is_recurring = false) are neither read nor written;
--   - stamps shifts_generated_at.
-- Any raise rolls back all of it.
--
-- Returns { kept, created, removed, removed_assignments: [{date, start, end,
-- team_id}], created_shifts: [{date, start, end, team_id}] }.
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
  v_removed_assignments jsonb;
  v_created_shifts      jsonb;
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
  -- assignment and all. (kept rows are never updated)
  select count(*) into v_kept
  from public.snack_shack_blocks b
  where b.snack_shack_id = p_snack_shack_id
    and b.is_recurring;

  -- ── Insert the desired slots that have no derived row ─────────────────────
  -- The NOT EXISTS sees the table as of statement start, so the rows this
  -- statement inserts never match themselves; duplicates within p_shifts
  -- were refused above.
  with ins as (
    insert into public.snack_shack_blocks
      (snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring)
    select p_snack_shack_id,
           (e ->> 'date')::date,
           (e ->> 'start')::time,
           (e ->> 'end')::time,
           nullif(e ->> 'assigned_team_id', '')::uuid,
           true
    from jsonb_array_elements(p_shifts) e
    where not exists (
      select 1 from public.snack_shack_blocks b
      where b.snack_shack_id = p_snack_shack_id
        and b.is_recurring
        and b.date       = (e ->> 'date')::date
        and b.start_time = (e ->> 'start')::time
        and b.end_time   = (e ->> 'end')::time
    )
    returning date, start_time, end_time, assigned_team_id
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'date', i.date, 'start', to_char(i.start_time, 'HH24:MI'), 'end', to_char(i.end_time, 'HH24:MI'),
           'team_id', i.assigned_team_id) order by i.date, i.start_time), '[]'::jsonb)
    into v_created, v_created_shifts
  from ins i;

  update public.snack_shack_settings
     set shifts_generated_at = now(),
         updated_at          = now()
   where id = p_snack_shack_id;

  return jsonb_build_object(
    'kept',                v_kept,
    'created',             v_created,
    'removed',             v_removed,
    'removed_assignments', v_removed_assignments,
    'created_shifts',      v_created_shifts
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Function privileges
-- ────────────────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE on every new function to PUBLIC, and this project's
-- default privileges add anon, authenticated, service_role and
-- dashboard_readonly. Revoking from a ROLE alone is a silent no-op while
-- PUBLIC still holds it (CLAUDE.md, found applying 0093) — so: revoke from
-- PUBLIC and from each role, then grant back exactly what is needed.
revoke execute on function public.regenerate_snack_shack_shifts(uuid, jsonb)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.regenerate_snack_shack_shifts(uuid, jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Verify — RAISES if any privilege or column is not exactly as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_fn    constant text := 'public.regenerate_snack_shack_shifts(uuid, jsonb)';
  v_tbl   constant text := 'public.snack_shack_absorb_choices';
  r       record;
begin
  if has_function_privilege('anon', v_fn, 'execute')               then v_wrong := v_wrong || ' [fn anon]'; end if;
  if not has_function_privilege('authenticated', v_fn, 'execute')  then v_wrong := v_wrong || ' [fn authenticated]'; end if;
  if has_function_privilege('service_role', v_fn, 'execute')       then v_wrong := v_wrong || ' [fn service_role]'; end if;
  if has_function_privilege('dashboard_readonly', v_fn, 'execute') then v_wrong := v_wrong || ' [fn dashboard_readonly]'; end if;

  for r in select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as priv loop
    if not has_table_privilege('authenticated', v_tbl, r.priv) then v_wrong := v_wrong || format(' [tbl authenticated %s]', r.priv); end if;
    if has_table_privilege('anon', v_tbl, r.priv)              then v_wrong := v_wrong || format(' [tbl anon %s]', r.priv); end if;
    if has_table_privilege('service_role', v_tbl, r.priv)      then v_wrong := v_wrong || format(' [tbl service_role %s]', r.priv); end if;
    if has_table_privilege('dashboard_readonly', v_tbl, r.priv) then v_wrong := v_wrong || format(' [tbl dashboard_readonly %s]', r.priv); end if;
  end loop;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'snack_shack_settings'
         and column_name in ('open_before_min', 'close_after_min', 'max_shift_min', 'shifts_generated_at')) <> 4 then
    v_wrong := v_wrong || ' [settings columns]';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'snack_shack_absorb_choices' and c.relrowsecurity) then
    v_wrong := v_wrong || ' [absorb table RLS]';
  end if;

  if v_wrong <> '' then
    raise exception '0103 verification failed:%', v_wrong;
  end if;
end;
$$;
