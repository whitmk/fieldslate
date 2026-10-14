-- 0110: a signed-in user can no longer create a season, or bring an archived
-- one back, straight from the browser.
--
-- THE HOLE (confirmed against the live catalog 2026-10-14). `leagues` has one
-- RLS policy, "Org members can manage leagues" (ALL, is_org_member(owner_id)),
-- and `authenticated` holds table-level INSERT and UPDATE. So any org member
-- could, from the browser:
--   INSERT a season          → skips create_league's season cap (0059)
--   set archived_at to null  → un-archives a season, also skipping the cap
-- A season is the unit of sale, so either one is an unpaid season. The
-- Unarchive modal (archive-modals.tsx) did the second with a bare update.
--
-- THE FIX:
--   1. INSERT is revoked from authenticated and anon (nothing in the app
--      inserts a season with the user's own client).
--   2. A BEFORE INSERT OR UPDATE trigger refuses, for the two browser roles,
--      every INSERT (belt and braces: holds if INSERT is ever re-granted),
--      any UPDATE that takes archived_at from set to null, and any UPDATE
--      that changes owner_id (moving a season between orgs). Archiving (null
--      → set) and every other browser write — name, schedule_settings, pay
--      settings, end_date, status — stay allowed.
--   3. restore_season(p_league_id, p_new_end_date) is the ONE way back from
--      archived. Paid orgs (pro/elite) restore free with no cap (decided
--      2026-10-14: an archived season was already paid for). A Free org may
--      restore only when it has no other active season (`cap_reached`, the
--      same JSON as create_league).
--
-- WHO STILL WRITES leagues, and why each still works (all SECURITY DEFINER,
-- owned by postgres, so current_user inside them is `postgres`):
--   create_league             INSERT (the free create path, capped)
--   process_checkout_event    INSERT (a purchased season) and UPDATE updated_at
--   delete_league_permanently DELETE (this trigger never sees a DELETE)
--   create_division_atomic    UPDATE schedule_settings
--   restore_season            UPDATE archived_at → null (this file)
-- The auto-archive on read and the Archive modal set archived_at, which is
-- allowed. service_role holds no INSERT/UPDATE on leagues and never did.
--
-- ALSO CLOSED (added at review, 2026-10-14): an UPDATE of owner_id by a
-- member of BOTH orgs used to move an active season into the other org
-- without going through its cap. No legitimate writer changes owner_id.
--
-- APPLY VERBATIM, comments included (CLAUDE.md). Verify md5(prosrc) of
-- protect_leagues_season_cap() and restore_season() against this file.
--
-- LOCKS when applied: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on leagues
-- (blocks writes to leagues — renames, archive, auto-archive, schedule
-- settings, create_league, a checkout — not reads) until the transaction
-- ends; REVOKE takes a brief lock of the same kind.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Privileges
-- ────────────────────────────────────────────────────────────────────────────
revoke insert on table public.leagues from public;
revoke insert on table public.leagues from anon;
revoke insert on table public.leagues from authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The trigger
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER — AND IT MUST STAY THAT WAY (0098's rule). The check is
-- "who is the caller", read from current_user. As SECURITY DEFINER it would
-- always see its owner and allow everything while looking unchanged.
create or replace function public.protect_leagues_season_cap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Only the two roles a browser can act as are restricted. SECURITY DEFINER
  -- functions (run as their owner), the SQL editor (postgres) and
  -- service_role all pass.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception
      'season_create_refused: a season can only be created through create_league or a purchase.'
      using errcode = '42501';
  end if;

  -- Archiving is allowed; un-archiving goes through restore_season.
  if old.archived_at is not null and new.archived_at is null then
    raise exception
      'season_restore_refused: an archived season can only be restored through restore_season.'
      using errcode = '42501';
  end if;

  -- A season never changes org. A member of two orgs could otherwise move an
  -- active season into the other org without going through its cap. Nothing
  -- in the app or any function writes owner_id on an existing season.
  if new.owner_id is distinct from old.owner_id then
    raise exception
      'season_move_refused: a season cannot be moved to another organization.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_leagues_season_cap
  before insert or update on public.leagues
  for each row
  execute function public.protect_leagues_season_cap();

-- A trigger function is never called directly; nobody needs EXECUTE on it.
revoke execute on function public.protect_leagues_season_cap()
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. restore_season
-- ────────────────────────────────────────────────────────────────────────────
-- Order: row lock → is_org_member → archived → end date → org lock → cap →
-- one conditional, counted UPDATE. Returns {row} or the create_league-shaped
-- {error: 'cap_reached', …}; every other refusal raises with nothing written.
create or replace function public.restore_season(
  p_league_id    uuid,
  p_new_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league public.leagues%rowtype;
  v_plan   text;
  v_active int;
  v_row    public.leagues%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_league
    from public.leagues
   where id = p_league_id
   for update;
  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;

  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  if v_league.archived_at is null then
    raise exception 'league_not_archived' using errcode = 'P0001';
  end if;

  if p_new_end_date is not null
     and v_league.start_date is not null
     and p_new_end_date < v_league.start_date
  then
    raise exception 'end_before_start' using errcode = 'P0001';
  end if;

  -- Two restores for one org at once would each count the other as still
  -- archived. Serialize per org; released at commit, so the second call's
  -- count sees the first one's row.
  perform pg_advisory_xact_lock(hashtextextended('restore_season:' || v_league.owner_id::text, 0));

  v_plan := coalesce(
    (select plan from public.profiles where id = v_league.owner_id),
    'free'
  );

  -- Paid orgs restore free with no cap: an archived season was already paid
  -- for. A Free org gets one active season.
  if v_plan not in ('pro', 'elite') then
    select count(*) into v_active
      from public.leagues
     where owner_id = v_league.owner_id
       and archived_at is null and id <> p_league_id;
    if v_active >= 1 then
      return jsonb_build_object(
        'error', 'cap_reached',
        'cap',   'activeSeasons',
        'limit', 1,
        'plan',  v_plan
      );
    end if;
  end if;

  update public.leagues
     set archived_at = null,
         status      = 'active',
         end_date    = coalesce(p_new_end_date, end_date)
   where id = p_league_id
     and archived_at is not null
  returning * into v_row;
  if not found then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

-- Revoked from PUBLIC (what anon/authenticated inherit) AND from each role,
-- because this project's default privileges grant some roles directly.
revoke execute on function public.restore_season(uuid, date)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.restore_season(uuid, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Verify — RAISES if anything is not exactly as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_role  text;
begin
  if has_table_privilege('authenticated', 'public.leagues', 'INSERT')
     or has_table_privilege('anon', 'public.leagues', 'INSERT')
  then
    v_wrong := v_wrong || ' [INSERT on leagues still held by authenticated or anon]';
  end if;

  if not has_function_privilege('authenticated', 'public.restore_season(uuid, date)', 'EXECUTE') then
    v_wrong := v_wrong || ' [authenticated cannot execute restore_season]';
  end if;
  foreach v_role in array array['public', 'anon', 'service_role', 'dashboard_readonly']
  loop
    if has_function_privilege(v_role, 'public.restore_season(uuid, date)', 'EXECUTE') then
      v_wrong := v_wrong || format(' [%s can execute restore_season]', v_role);
    end if;
  end loop;
  foreach v_role in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']
  loop
    if has_function_privilege(v_role, 'public.protect_leagues_season_cap()', 'EXECUTE') then
      v_wrong := v_wrong || format(' [%s can execute protect_leagues_season_cap]', v_role);
    end if;
  end loop;

  -- tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update → 23.
  if not exists (
    select 1
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.leagues'::regclass
       and t.tgname = 'protect_leagues_season_cap'
       and t.tgenabled = 'O'
       and t.tgtype = 23
       and not p.prosecdef
  ) then
    v_wrong := v_wrong || ' [trigger missing, disabled, wrong events, or its function is SECURITY DEFINER]';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'restore_season'
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    v_wrong := v_wrong || ' [restore_season is not SECURITY DEFINER with search_path = public, pg_temp]';
  end if;

  if v_wrong <> '' then
    raise exception '0110 verification failed:%', v_wrong;
  end if;
end;
$$;
