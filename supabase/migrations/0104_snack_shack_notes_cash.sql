-- 0104: snack shack — shift notes (with attribution) and an optional
-- "in charge of cash" person per shift, chosen from a per-season list.
--
-- Decided 2026-10-05 (CLAUDE.md "Snack shack — derived shifts"):
--   * A NOTE on any shift, derived or manual: free text, 500 characters,
--     with who/when attribution set by a TRIGGER (copied from 0095's game
--     notes), never by the write. Admins only — never printed, emailed,
--     exported or shown to teams. The TypeScript harness scans every outbound
--     snack shack path for the column names.
--   * A CASH PERSON per shift: a FK to a per-season list of names the admin
--     types in (`snack_shack_cash_people`, keyed by the settings row, which is
--     one per season). ON DELETE SET NULL: removing a name makes its shifts
--     "no cash person" in the same statement — a database guarantee, not a
--     client sweep. A name is a ROW, so a rename propagates (never a text
--     column on the shift: that is the name-keyed-drift family).
--   * REGENERATE CARRIES THEM FORWARD. regenerate_snack_shack_shifts
--     (0103) is re-created below, body verbatim except: before the delete it
--     captures the note, its attribution and the cash person of every row it
--     is about to remove; the INSERT copies them onto the new row with the
--     SAME DATE AND START (so a shift whose END moved keeps its note and its
--     author — copied in the INSERT, where the BEFORE UPDATE attribution
--     trigger cannot re-stamp the regenerating admin as the author). Doomed
--     rows with no same-start replacement are reported in `lost`, so the
--     preview can say so. Kept rows are never updated, as before.
--
-- EXISTING DATA: no row carries a note or a cash person (columns are new);
-- nothing is migrated.
--
-- APPLY VERBATIM, comments included. Verify md5(prosrc) of BOTH functions
-- against this file after applying. The final DO block raises if a
-- privilege or column is wrong.
--
-- LOCKS THIS TAKES when applied:
--   ACCESS EXCLUSIVE on snack_shack_blocks (ADD COLUMN ×4, ADD CHECK — scans
--     ~110 rows, instant). Blocks every read and write of shifts (the Snack
--     Shack page, the Teams page snack button, both email routes, the
--     regenerate RPC) for the statement's duration.
--   SHARE ROW EXCLUSIVE on profiles (the notes_updated_by FK) and on the new
--     snack_shack_cash_people table (the cash_person_id FK) — blocks WRITES
--     to profiles (org-name saves, setup-dismiss, Stripe plan updates,
--     signup inserts) for that statement; reads unaffected.
--   Nothing on snack_shack_settings, games, teams, leagues or divisions.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The per-season cash-people list
-- ────────────────────────────────────────────────────────────────────────────
create table public.snack_shack_cash_people (
  id             uuid primary key default gen_random_uuid(),
  snack_shack_id uuid not null references public.snack_shack_settings(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 80),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One name per season, case- and whitespace-insensitive. An expression index
-- (a UNIQUE constraint cannot use an expression).
create unique index snack_shack_cash_people_name_uniq
  on public.snack_shack_cash_people (snack_shack_id, lower(btrim(name)));

create trigger set_snack_shack_cash_people_updated_at
  before update on public.snack_shack_cash_people
  for each row execute procedure public.set_updated_at();

alter table public.snack_shack_cash_people enable row level security;

create policy "Org members can manage snack shack cash people"
  on public.snack_shack_cash_people for all
  using (
    exists (
      select 1 from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where s.id = snack_shack_cash_people.snack_shack_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where s.id = snack_shack_cash_people.snack_shack_id
        and public.is_org_member(l.owner_id)
    )
  );

revoke all on table public.snack_shack_cash_people from public;
revoke all on table public.snack_shack_cash_people from anon;
revoke all on table public.snack_shack_cash_people from authenticated;
revoke all on table public.snack_shack_cash_people from service_role;
revoke all on table public.snack_shack_cash_people from dashboard_readonly;
grant select, insert, update, delete on table public.snack_shack_cash_people to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Four columns on snack_shack_blocks
-- ────────────────────────────────────────────────────────────────────────────
-- authenticated already holds table-level DML on snack_shack_blocks (0027),
-- so the new columns inherit it; nothing to grant.
alter table public.snack_shack_blocks
  add column notes            text,
  add column notes_updated_at timestamptz,
  add column notes_updated_by uuid references public.profiles(id) on delete set null,
  add column cash_person_id   uuid references public.snack_shack_cash_people(id) on delete set null;

alter table public.snack_shack_blocks
  add constraint snack_shack_blocks_notes_length check (notes is null or length(notes) <= 500);

create index snack_shack_blocks_cash_person_id_idx
  on public.snack_shack_blocks (cash_person_id);

-- ── Attribution: BEFORE UPDATE, only when the note actually changed ──────────
-- Copied from 0095's set_games_notes_attribution. UPDATE only: the regenerate
-- RPC's INSERT carries an existing note's attribution through untouched.
create or replace function public.set_snack_shack_blocks_notes_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.notes is distinct from old.notes then
    if new.notes is null then
      -- Removed: nothing to attribute, and a stale "Last edited by" on an
      -- empty note would be noise.
      new.notes_updated_at := null;
      new.notes_updated_by := null;
    else
      new.notes_updated_at := now();
      new.notes_updated_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists set_snack_shack_blocks_notes_attribution on public.snack_shack_blocks;
create trigger set_snack_shack_blocks_notes_attribution
  before update on public.snack_shack_blocks
  for each row execute function public.set_snack_shack_blocks_notes_attribution();

revoke execute on function public.set_snack_shack_blocks_notes_attribution()
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. regenerate_snack_shack_shifts — re-created with carry-forward
-- ────────────────────────────────────────────────────────────────────────────
-- Body VERBATIM from 0103 except the three marked blocks (capture, the INSERT's
-- four extra columns, and the `carried` / `lost` keys in the return).
--
-- Returns { kept, created, removed, removed_assignments, created_shifts,
--           carried, lost: [{date, start, end, notes, cash_person_id}] }.
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
  -- cash person. The INSERT below copies them onto the new row with the SAME
  -- date and start — in the INSERT, so the BEFORE UPDATE attribution trigger
  -- does not re-stamp the regenerating admin as the author. Doomed rows with
  -- no same-start replacement are reported in `lost`.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', b.date, 'start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'),
           'notes', b.notes, 'notes_updated_at', b.notes_updated_at, 'notes_updated_by', b.notes_updated_by,
           'cash_person_id', b.cash_person_id) order by b.date, b.start_time, b.end_time), '[]'::jsonb)
    into v_carry
  from public.snack_shack_blocks b
  where b.snack_shack_id = p_snack_shack_id
    and b.is_recurring
    and (b.notes is not null or b.cash_person_id is not null)
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
  -- assignment, note and cash person and all. (kept rows are never updated)
  select count(*) into v_kept
  from public.snack_shack_blocks b
  where b.snack_shack_id = p_snack_shack_id
    and b.is_recurring;

  -- ── Insert the desired slots that have no derived row ─────────────────────
  -- The NOT EXISTS sees the table as of statement start, so the rows this
  -- statement inserts never match themselves; duplicates within p_shifts
  -- were refused above. 0104: the four carried columns come from the capture
  -- above, matched on date + start (the earliest-ending doomed row wins if
  -- two shared a start).
  with ins as (
    insert into public.snack_shack_blocks
      (snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring,
       notes, notes_updated_at, notes_updated_by, cash_person_id)
    select p_snack_shack_id,
           (e ->> 'date')::date,
           (e ->> 'start')::time,
           (e ->> 'end')::time,
           nullif(e ->> 'assigned_team_id', '')::uuid,
           true,
           c.notes, c.notes_updated_at, c.notes_updated_by, c.cash_person_id
    from jsonb_array_elements(p_shifts) e
    left join lateral (
      select (x ->> 'notes')                           as notes,
             (x ->> 'notes_updated_at')::timestamptz   as notes_updated_at,
             (x ->> 'notes_updated_by')::uuid          as notes_updated_by,
             (x ->> 'cash_person_id')::uuid            as cash_person_id
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
              (notes is not null or cash_person_id is not null) as carried
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
-- 4. Verify — RAISES if any privilege, column or trigger is not as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_fn    constant text := 'public.regenerate_snack_shack_shifts(uuid, jsonb)';
  v_trg   constant text := 'public.set_snack_shack_blocks_notes_attribution()';
  v_tbl   constant text := 'public.snack_shack_cash_people';
  r       record;
begin
  if has_function_privilege('anon', v_fn, 'execute')               then v_wrong := v_wrong || ' [fn anon]'; end if;
  if not has_function_privilege('authenticated', v_fn, 'execute')  then v_wrong := v_wrong || ' [fn authenticated]'; end if;
  if has_function_privilege('service_role', v_fn, 'execute')       then v_wrong := v_wrong || ' [fn service_role]'; end if;
  if has_function_privilege('dashboard_readonly', v_fn, 'execute') then v_wrong := v_wrong || ' [fn dashboard_readonly]'; end if;
  if has_function_privilege('anon', v_trg, 'execute') or has_function_privilege('authenticated', v_trg, 'execute')
     or has_function_privilege('service_role', v_trg, 'execute') or has_function_privilege('dashboard_readonly', v_trg, 'execute') then
    v_wrong := v_wrong || ' [trigger fn callable]';
  end if;

  for r in select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as priv loop
    if not has_table_privilege('authenticated', v_tbl, r.priv) then v_wrong := v_wrong || format(' [tbl authenticated %s]', r.priv); end if;
    if has_table_privilege('anon', v_tbl, r.priv)              then v_wrong := v_wrong || format(' [tbl anon %s]', r.priv); end if;
    if has_table_privilege('service_role', v_tbl, r.priv)      then v_wrong := v_wrong || format(' [tbl service_role %s]', r.priv); end if;
    if has_table_privilege('dashboard_readonly', v_tbl, r.priv) then v_wrong := v_wrong || format(' [tbl dashboard_readonly %s]', r.priv); end if;
  end loop;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'snack_shack_blocks'
         and column_name in ('notes', 'notes_updated_at', 'notes_updated_by', 'cash_person_id')) <> 4 then
    v_wrong := v_wrong || ' [blocks columns]';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_snack_shack_blocks_notes_attribution'
                  and tgrelid = 'public.snack_shack_blocks'::regclass and tgenabled = 'O') then
    v_wrong := v_wrong || ' [attribution trigger]';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'snack_shack_cash_people' and c.relrowsecurity) then
    v_wrong := v_wrong || ' [cash people RLS]';
  end if;

  if v_wrong <> '' then
    raise exception '0104 verification failed:%', v_wrong;
  end if;
end;
$$;
