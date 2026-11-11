-- 0131 — Snack shack: mark the days whose games changed, and name the
-- volunteers a rebuild would drop (2026-11-11, branch feat/snack-shack-stale-days).
-- Plan: docs/plans/game-change-followthrough.md, "B. Snack shack kept in step
-- with games" — option (2), B1 and the names-only function from B3.
--
-- WHAT IT DOES
--   * A statement-level trigger on `games` (insert, update, delete) records
--     every date a game changed on, at a snack shack's home field, for the
--     season's snack shack: snack_shack_stale_days (one row per shack and
--     date). Old AND new rows count, so a game moved off a shack field marks
--     its old date and one moved onto it marks the new one. Only dates that
--     are today or later in the league's timezone. An update counts only when
--     scheduled_at, venue_id, status or home_team_id changed (a note edit
--     marks nothing). Statement level because the generator inserts 500 rows
--     at a time; transition tables, like clear_division_posted (0082).
--   * A mark does NOT say a day's shifts are wrong. It says a game changed on
--     a day the shack could care about. The app runs the real shift
--     calculation (derive-shifts.ts) over the marked days and shows only
--     those it really flags; the rest are cleared.
--   * The trigger never blocks a game write: a failure is swallowed and
--     recorded in snack_shack_stale_failures (time and SQLSTATE only, no
--     personal data), and the app then checks the whole season instead of
--     trusting the marks. SECURITY DEFINER: members write games from the
--     browser and partner leagues through the token functions; neither holds
--     a privilege on the new tables.
--   * Skipped while fieldslate.lock_bypass is on (a season or division is
--     being deleted — the shack is on its way out too).
--
-- FUNCTIONS (authenticated only)
--   snack_shack_stale_state(season)  — member: the shack's upcoming marked
--       dates and whether a mark failed since shifts were last generated.
--   clear_snack_shack_stale_days(shack, dates, before) — member: deletes the
--       marks for those dates (null = every date) made at or before `before`
--       (the moment the app read the games), so a change made while the
--       preview was open stays marked. Returns the count.
--   volunteer_shift_claims_for_blocks(season, block ids) — the names-only
--       read for the rebuild preview: ACTIVE sign-ups on those shifts, as
--       block id, claim id, first initial and last name. NEVER an email.
--       volunteer_admin_gate (member → switch → Elite → not archived). Only
--       regenerate-preview-modal.tsx may call it (sim:game-notes fence).
--
-- NOT CHANGED: regenerate_snack_shack_shifts, clear_division_posted, the
-- lock trigger, every volunteer function.
--
-- LOCKS when applied: SHARE ROW EXCLUSIVE on `games` for the three CREATE
-- TRIGGER statements (blocks game writes for well under a second; reads
-- continue); ACCESS SHARE on snack_shack_settings, leagues, profiles,
-- volunteer_claims, volunteers (function bodies are not checked at create —
-- only the new tables' FK takes SHARE ROW EXCLUSIVE on snack_shack_settings,
-- blocking its writes for the statement).
--
-- Deploy order: apply 0131 BEFORE the code reaches main — the dashboard and
-- the snack shack page call the new functions.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────────────────────
create table public.snack_shack_stale_days (
  snack_shack_id uuid not null references public.snack_shack_settings(id) on delete cascade,
  date           date not null,
  marked_at      timestamptz not null default now(),
  primary key (snack_shack_id, date)
);

create table public.snack_shack_stale_failures (
  id        bigint generated always as identity primary key,
  failed_at timestamptz not null default now(),
  sqlstate  text not null
);

alter table public.snack_shack_stale_days enable row level security;
alter table public.snack_shack_stale_failures enable row level security;
revoke all on public.snack_shack_stale_days from public, anon, authenticated, service_role, dashboard_readonly;
revoke all on public.snack_shack_stale_failures from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The mark trigger
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.snack_shack_mark_stale_days()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A season or division delete: the shack goes with it.
  if coalesce(current_setting('fieldslate.lock_bypass', true), '') = 'on' then
    return null;
  end if;

  begin
    if tg_op = 'INSERT' then
      insert into public.snack_shack_stale_days (snack_shack_id, date, marked_at)
      select distinct s.id, (n.scheduled_at at time zone 'UTC')::date, now()
        from newrows n
        join public.snack_shack_settings s on s.season_id = n.league_id
        join public.leagues l on l.id = n.league_id
        join public.profiles p on p.id = l.owner_id
       where n.venue_id is not null and n.scheduled_at is not null
         and s.home_venue_ids ? n.venue_id::text
         and (n.scheduled_at at time zone 'UTC')::date >= (now() at time zone p.timezone)::date
      on conflict (snack_shack_id, date) do update set marked_at = excluded.marked_at;
    elsif tg_op = 'DELETE' then
      insert into public.snack_shack_stale_days (snack_shack_id, date, marked_at)
      select distinct s.id, (o.scheduled_at at time zone 'UTC')::date, now()
        from oldrows o
        join public.snack_shack_settings s on s.season_id = o.league_id
        join public.leagues l on l.id = o.league_id
        join public.profiles p on p.id = l.owner_id
       where o.venue_id is not null and o.scheduled_at is not null
         and s.home_venue_ids ? o.venue_id::text
         and (o.scheduled_at at time zone 'UTC')::date >= (now() at time zone p.timezone)::date
      on conflict (snack_shack_id, date) do update set marked_at = excluded.marked_at;
    else
      -- An update counts only when a column the shifts depend on changed;
      -- then BOTH the old row (its old date and field) and the new one.
      insert into public.snack_shack_stale_days (snack_shack_id, date, marked_at)
      select distinct s.id, (x.scheduled_at at time zone 'UTC')::date, now()
        from (
          select o.league_id, o.scheduled_at, o.venue_id
            from oldrows o join newrows n on n.id = o.id
           where (o.scheduled_at, o.venue_id, o.status, o.home_team_id)
                 is distinct from (n.scheduled_at, n.venue_id, n.status, n.home_team_id)
          union all
          select n.league_id, n.scheduled_at, n.venue_id
            from oldrows o join newrows n on n.id = o.id
           where (o.scheduled_at, o.venue_id, o.status, o.home_team_id)
                 is distinct from (n.scheduled_at, n.venue_id, n.status, n.home_team_id)
        ) x
        join public.snack_shack_settings s on s.season_id = x.league_id
        join public.leagues l on l.id = x.league_id
        join public.profiles p on p.id = l.owner_id
       where x.venue_id is not null and x.scheduled_at is not null
         and s.home_venue_ids ? x.venue_id::text
         and (x.scheduled_at at time zone 'UTC')::date >= (now() at time zone p.timezone)::date
      on conflict (snack_shack_id, date) do update set marked_at = excluded.marked_at;
    end if;
  exception when others then
    -- Never block a game write. Record that marking failed so the app
    -- checks the whole season instead of trusting the marks.
    begin
      insert into public.snack_shack_stale_failures (sqlstate) values (sqlstate);
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists snack_shack_mark_stale_insert on public.games;
create trigger snack_shack_mark_stale_insert
  after insert on public.games
  referencing new table as newrows
  for each statement execute function public.snack_shack_mark_stale_days();

drop trigger if exists snack_shack_mark_stale_update on public.games;
create trigger snack_shack_mark_stale_update
  after update on public.games
  referencing old table as oldrows new table as newrows
  for each statement execute function public.snack_shack_mark_stale_days();

drop trigger if exists snack_shack_mark_stale_delete on public.games;
create trigger snack_shack_mark_stale_delete
  after delete on public.games
  referencing old table as oldrows
  for each statement execute function public.snack_shack_mark_stale_days();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. The app's reads and the clear
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.snack_shack_stale_state(p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_tz    text;
  v_shack uuid;
  v_gen   timestamptz;
begin
  select l.owner_id into v_owner from public.leagues l where l.id = p_season_id;
  if v_owner is null or not public.is_org_member(v_owner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select s.id, s.shifts_generated_at into v_shack, v_gen
    from public.snack_shack_settings s where s.season_id = p_season_id;
  if v_shack is null then
    return jsonb_build_object('snack_shack_id', null, 'dates', '[]'::jsonb, 'failed_since', false);
  end if;
  select p.timezone into v_tz from public.profiles p where p.id = v_owner;
  return jsonb_build_object(
    'snack_shack_id', v_shack,
    'dates', coalesce((
      select jsonb_agg(to_char(d.date, 'YYYY-MM-DD') order by d.date)
        from public.snack_shack_stale_days d
       where d.snack_shack_id = v_shack
         and d.date >= (now() at time zone coalesce(v_tz, 'America/Los_Angeles'))::date), '[]'::jsonb),
    'failed_since', exists (
      select 1 from public.snack_shack_stale_failures f
       where v_gen is null or f.failed_at > v_gen)
  );
end;
$$;

create or replace function public.clear_snack_shack_stale_days(p_snack_shack_id uuid, p_dates date[], p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_n     integer;
begin
  select l.owner_id into v_owner
    from public.snack_shack_settings s join public.leagues l on l.id = s.season_id
   where s.id = p_snack_shack_id;
  if v_owner is null or not public.is_org_member(v_owner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_before is null then
    raise exception 'before_required' using errcode = '22023';
  end if;
  delete from public.snack_shack_stale_days d
   where d.snack_shack_id = p_snack_shack_id
     and d.marked_at <= p_before
     and (p_dates is null or d.date = any (p_dates));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The rebuild preview's names: ACTIVE sign-ups on the given shifts of this
-- season. First initial and last name only — never an email, never a
-- canceled or detached sign-up.
create or replace function public.volunteer_shift_claims_for_blocks(p_season_id uuid, p_block_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.volunteer_admin_gate(p_season_id, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'block_id', c.snack_shack_block_id,
             'claim_id', c.id,
             'first_initial', v.first_initial,
             'last_name', v.last_name)
           order by c.snack_shack_block_id, c.position, c.id)
      from public.volunteer_claims c
      join public.volunteers v on v.id = c.volunteer_id
     where c.season_id = p_season_id
       and c.status = 'active'
       and c.snack_shack_block_id = any (coalesce(p_block_ids, '{}'::uuid[]))), '[]'::jsonb);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Privileges (revoke from PUBLIC, then grant back — the house rule)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.snack_shack_mark_stale_days()                         from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.snack_shack_stale_state(uuid)                         from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.clear_snack_shack_stale_days(uuid, date[], timestamptz) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_shift_claims_for_blocks(uuid, uuid[])       from public, anon, authenticated, service_role, dashboard_readonly;
grant  execute on function public.snack_shack_stale_state(uuid)                         to authenticated;
grant  execute on function public.clear_snack_shack_stale_days(uuid, date[], timestamptz) to authenticated;
grant  execute on function public.volunteer_shift_claims_for_blocks(uuid, uuid[])       to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Verify, or the whole migration rolls back
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  f text;
  r text;
  t text;
begin
  foreach f in array array['public.snack_shack_mark_stale_days()', 'public.snack_shack_stale_state(uuid)',
                           'public.clear_snack_shack_stale_days(uuid, date[], timestamptz)',
                           'public.volunteer_shift_claims_for_blocks(uuid, uuid[])'] loop
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '0131 verify: % must be SECURITY DEFINER', f;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0131 verify: PUBLIC can execute %', f;
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0131 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;
  if has_function_privilege('authenticated', 'public.snack_shack_mark_stale_days()', 'EXECUTE') then
    raise exception '0131 verify: the trigger function must be callable by no role';
  end if;
  foreach t in array array['public.snack_shack_stale_days', 'public.snack_shack_stale_failures'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_table_privilege(r, t, 'SELECT') or has_table_privilege(r, t, 'INSERT')
         or has_table_privilege(r, t, 'UPDATE') or has_table_privilege(r, t, 'DELETE') then
        raise exception '0131 verify: % holds a privilege on %', r, t;
      end if;
    end loop;
  end loop;
  if (select count(*) from pg_trigger
       where tgrelid = 'public.games'::regclass and tgname like 'snack_shack_mark_stale_%'
         and tgenabled = 'O' and (tgtype & 1) = 0) <> 3 then
    raise exception '0131 verify: three enabled statement-level mark triggers on games';
  end if;
end $v$;
