-- Atomic division creation for the wizard flow. Wraps the division row,
-- its teams, venue assignments, interleague configs, and (optionally) a
-- pre-computed schedule of games in ONE transaction.
--
-- Why: the wizard previously inserted the division first, then ran the
-- client-side schedule generator which inserted games separately. If
-- schedule generation failed (infeasible constraints, partial network
-- error, etc.) the division/teams/venues were left behind in the DB and
-- the user could create a duplicate by retrying. This RPC eliminates the
-- window — any failure rolls back the whole transaction.
--
-- The pre-existing create_division / create_team / create_league RPCs in
-- migration 0055 remain in place; they're still used by non-wizard direct
-- create flows (Add Team button, etc.).
--
-- Return contract:
--   Success:      { "row": <inserted divisions row as jsonb> }
--   Cap reached:  { "error": "cap_reached", "cap": <key>, "limit": <int>, "plan": <plan> }
--
-- Other failures (auth, not_org_member, unknown_home_team, etc.) raise an
-- exception with errcode P0001 — matches the precedent in 0052 and 0055.

create or replace function public.create_division_atomic(
  p_league_id                      uuid,
  p_division                       jsonb,    -- name, team_count, start_date, end_date,
                                             -- settings, umpires_per_game, umpire_roles,
                                             -- plays_interleague, intra_division_games_per_team
  p_team_names                     text[],   -- ordered list of team names (1+ required)
  p_venue_assignments              jsonb,    -- [{venue_id, allow_games}]
  p_interleague_games              jsonb,    -- [{interleague_org_id, game_count, home_games_per_team}]
  p_games                          jsonb,    -- [{home_team_name, away_team_name|null,
                                             --   interleague_org_id|null, venue_id|null,
                                             --   scheduled_at, status, is_away}]
  p_use_league_schedule_settings   jsonb     -- null or {playing_days, day_windows} to write to leagues
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_org_id     uuid;
  v_plan       text;
  v_div_count  int;
  v_team_count int;
  v_new_teams  int := coalesce(array_length(p_team_names, 1), 0);
  v_div_id     uuid;
  v_div_row    public.divisions%rowtype;
  v_team_id    uuid;
  v_raw_name   text;
  v_name_norm  text;
  v_name_map   jsonb := '{}'::jsonb;
  v_game       jsonb;
  v_home_norm  text;
  v_away_norm  text;
  v_home_id    uuid;
  v_away_id    uuid;
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

  if v_new_teams < 1 then
    raise exception 'no_teams_provided' using errcode = 'P0001';
  end if;

  -- ── Cap checks ────────────────────────────────────────────────────────────
  v_plan := coalesce(
    (select plan from public.profiles where id = v_org_id),
    'free'
  );

  if v_plan = 'free' then
    -- Divisions cap = 1 org-wide.
    select count(*) into v_div_count
      from public.divisions d
      join public.leagues   l on d.league_id = l.id
     where l.owner_id = v_org_id;
    if v_div_count >= 1 then
      return jsonb_build_object(
        'error', 'cap_reached',
        'cap',   'divisions',
        'limit', 1,
        'plan',  v_plan
      );
    end if;

    -- Teams cap = 6 org-wide.
    select count(*) into v_team_count
      from public.teams     t
      join public.divisions d on t.division_id = d.id
      join public.leagues   l on d.league_id   = l.id
     where l.owner_id = v_org_id;
    if v_team_count + v_new_teams > 6 then
      return jsonb_build_object(
        'error', 'cap_reached',
        'cap',   'teamsPerOrg',
        'limit', 6,
        'plan',  v_plan
      );
    end if;
  end if;

  -- ── INSERT division ───────────────────────────────────────────────────────
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
    p_division->>'name',
    coalesce((p_division->>'team_count')::int, v_new_teams),
    nullif(p_division->>'start_date', '')::date,
    nullif(p_division->>'end_date', '')::date,
    coalesce(p_division->'settings', '{}'::jsonb),
    'active',
    coalesce((p_division->>'umpires_per_game')::int, 0),
    coalesce(p_division->'umpire_roles', '[]'::jsonb),
    coalesce((p_division->>'plays_interleague')::boolean, false),
    coalesce((p_division->>'intra_division_games_per_team')::int, 0)
  )
  returning * into v_div_row;
  v_div_id := v_div_row.id;

  -- ── INSERT teams; build lower(trim(name)) → id map ────────────────────────
  foreach v_raw_name in array p_team_names loop
    if v_raw_name is null then continue; end if;
    v_name_norm := lower(trim(v_raw_name));
    if v_name_norm = '' then continue; end if;
    if v_name_map ? v_name_norm then
      raise exception 'duplicate_team_name: %', v_raw_name using errcode = 'P0001';
    end if;
    insert into public.teams (league_id, division_id, name)
    values (p_league_id, v_div_id, trim(v_raw_name))
    returning id into v_team_id;
    v_name_map := v_name_map || jsonb_build_object(v_name_norm, v_team_id::text);
  end loop;

  -- ── INSERT division_venues ────────────────────────────────────────────────
  if jsonb_typeof(p_venue_assignments) = 'array' then
    insert into public.division_venues (division_id, venue_id, allow_games)
    select
      v_div_id,
      (e->>'venue_id')::uuid,
      coalesce((e->>'allow_games')::boolean, true)
    from jsonb_array_elements(p_venue_assignments) e;
  end if;

  -- ── INSERT division_interleague_games (skip rows with game_count = 0) ────
  if jsonb_typeof(p_interleague_games) = 'array' then
    insert into public.division_interleague_games (
      division_id, interleague_org_id, game_count, home_games_per_team
    )
    select
      v_div_id,
      (e->>'interleague_org_id')::uuid,
      (e->>'game_count')::int,
      coalesce((e->>'home_games_per_team')::int, (e->>'game_count')::int)
    from jsonb_array_elements(p_interleague_games) e
    where coalesce((e->>'game_count')::int, 0) > 0;
  end if;

  -- ── INSERT games; resolve team names → ids via the map ────────────────────
  if jsonb_typeof(p_games) = 'array' then
    for v_game in select * from jsonb_array_elements(p_games) loop
      v_home_norm := lower(trim(v_game->>'home_team_name'));
      v_home_id := nullif(v_name_map->>v_home_norm, '')::uuid;
      if v_home_id is null then
        raise exception 'unknown_home_team: %', v_game->>'home_team_name'
          using errcode = 'P0001';
      end if;

      if (v_game ? 'away_team_name')
         and jsonb_typeof(v_game->'away_team_name') <> 'null'
         and coalesce(v_game->>'away_team_name', '') <> ''
      then
        v_away_norm := lower(trim(v_game->>'away_team_name'));
        v_away_id := nullif(v_name_map->>v_away_norm, '')::uuid;
        if v_away_id is null then
          raise exception 'unknown_away_team: %', v_game->>'away_team_name'
            using errcode = 'P0001';
        end if;
      else
        v_away_id := null;
      end if;

      insert into public.games (
        league_id,
        home_team_id,
        away_team_id,
        interleague_org_id,
        venue_id,
        scheduled_at,
        status,
        is_away
      ) values (
        p_league_id,
        v_home_id,
        v_away_id,
        nullif(v_game->>'interleague_org_id', '')::uuid,
        nullif(v_game->>'venue_id', '')::uuid,
        (v_game->>'scheduled_at')::timestamptz,
        coalesce(v_game->>'status', 'scheduled'),
        coalesce((v_game->>'is_away')::boolean, false)
      );
    end loop;
  end if;

  -- ── Optional: persist this division's schedule windows on the league ─────
  if p_use_league_schedule_settings is not null
     and jsonb_typeof(p_use_league_schedule_settings) = 'object'
  then
    update public.leagues
       set schedule_settings = p_use_league_schedule_settings
     where id = p_league_id;
  end if;

  return jsonb_build_object('row', to_jsonb(v_div_row));
end;
$$;

revoke all on function public.create_division_atomic(uuid, jsonb, text[], jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_division_atomic(uuid, jsonb, text[], jsonb, jsonb, jsonb, jsonb) to authenticated;
