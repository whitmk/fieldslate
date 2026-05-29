-- SECURITY DEFINER RPCs that enforce Free-plan caps on division, team, and
-- active-season creation. Keep limits in sync with src/lib/plan/limits.ts.
--
-- Return contract for all three:
--   Success:      { "row": <full inserted row as jsonb> }
--   Cap reached:  { "error": "cap_reached", "cap": <key>, "limit": <int>, "plan": <plan> }
--
-- Other failures (not authenticated, not a member of the resolved org, bad
-- FKs) still raise an exception with errcode P0001 so callers can map them
-- to user-facing messages — matches the precedent in 0052_org_admin_rpcs.

-- ────────────────────────────────────────────────────────────────────────────
-- create_division — drop-in replacement for the divisions INSERT in the
-- division wizard (step-review.tsx !isEditMode branch). Resolves org via
-- the parent league's owner_id, enforces the Free=1 division cap org-wide.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.create_division(
  p_league_id                      uuid,
  p_name                           text,
  p_team_count                     int,
  p_start_date                     date,
  p_end_date                       date,
  p_settings                       jsonb,
  p_umpires_per_game               int,
  p_umpire_roles                   jsonb,
  p_plays_interleague              boolean,
  p_intra_division_games_per_team  int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_org_id   uuid;
  v_plan     text;
  v_count    int;
  v_row      public.divisions%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select owner_id into v_org_id from public.leagues where id = p_league_id;
  if v_org_id is null then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;

  if not public.is_org_member(v_org_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.divisions d
    join public.leagues   l on d.league_id = l.id
   where l.owner_id = v_org_id;

  v_plan := coalesce(
    (select plan from public.profiles where id = v_org_id),
    'free'
  );

  if v_plan = 'free' and v_count >= 1 then
    return jsonb_build_object(
      'error', 'cap_reached',
      'cap',   'divisions',
      'limit', 1,
      'plan',  v_plan
    );
  end if;

  insert into public.divisions (
    league_id,
    name,
    team_count,
    start_date,
    end_date,
    settings,
    status,
    umpires_per_game,
    umpire_roles,
    plays_interleague,
    intra_division_games_per_team
  ) values (
    p_league_id,
    p_name,
    p_team_count,
    p_start_date,
    p_end_date,
    p_settings,
    'active',
    p_umpires_per_game,
    p_umpire_roles,
    p_plays_interleague,
    p_intra_division_games_per_team
  )
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_division(uuid, text, int, date, date, jsonb, int, jsonb, boolean, int) from public;
grant execute on function public.create_division(uuid, text, int, date, date, jsonb, int, jsonb, boolean, int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- create_team — drop-in replacement for the three teams INSERT sites
-- (add-team-button, team-section, division-wizard bulk). Free cap = 6 teams
-- across the entire org, NOT per-division.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.create_team(
  p_league_id   uuid,
  p_division_id uuid,
  p_name        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_org_id   uuid;
  v_plan     text;
  v_count    int;
  v_row      public.teams%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select owner_id into v_org_id from public.leagues where id = p_league_id;
  if v_org_id is null then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;

  if not public.is_org_member(v_org_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  if p_division_id is not null and not exists (
    select 1 from public.divisions
     where id = p_division_id and league_id = p_league_id
  ) then
    raise exception 'division_not_in_league' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.teams     t
    join public.divisions d on t.division_id = d.id
    join public.leagues   l on d.league_id   = l.id
   where l.owner_id = v_org_id;

  v_plan := coalesce(
    (select plan from public.profiles where id = v_org_id),
    'free'
  );

  if v_plan = 'free' and v_count >= 6 then
    return jsonb_build_object(
      'error', 'cap_reached',
      'cap',   'teamsPerOrg',
      'limit', 6,
      'plan',  v_plan
    );
  end if;

  insert into public.teams (league_id, division_id, name)
  values (p_league_id, p_division_id, p_name)
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_team(uuid, uuid, text) from public;
grant execute on function public.create_team(uuid, uuid, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- create_league — drop-in replacement for the leagues INSERT in
-- new-league-form.tsx. Free cap = 1 ACTIVE season (archived_at IS NULL);
-- archived seasons don't count, so a user can rotate freely once their
-- current season ends.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.create_league(
  p_org_id     uuid,
  p_name       text,
  p_sport      text,
  p_season     text,
  p_start_date date,
  p_end_date   date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_plan     text;
  v_count    int;
  v_row      public.leagues%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.leagues
   where owner_id    = p_org_id
     and archived_at is null;

  v_plan := coalesce(
    (select plan from public.profiles where id = p_org_id),
    'free'
  );

  if v_plan = 'free' and v_count >= 1 then
    return jsonb_build_object(
      'error', 'cap_reached',
      'cap',   'activeSeasons',
      'limit', 1,
      'plan',  v_plan
    );
  end if;

  insert into public.leagues (
    name, sport, season, status, owner_id, start_date, end_date
  ) values (
    p_name, p_sport, p_season, 'active', p_org_id, p_start_date, p_end_date
  )
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_league(uuid, text, text, text, date, date) from public;
grant execute on function public.create_league(uuid, text, text, text, date, date) to authenticated;
