-- 0107: delete a playoff bracket; rebuild one safely.
--
-- Two SECURITY DEFINER functions, both their own preview (p_commit = false
-- writes nothing — the 0084 pattern):
--
--   delete_playoff_bracket(p_playoff_id, p_commit)
--   replace_playoff_games(p_playoff_id, p_settings, p_games, p_commit)
--
-- WHY. Before this, a bracket could not be deleted at all, and "rebuilding"
-- one (the wizard's Generate on an existing bracket) was four separate
-- browser calls — save settings as draft, delete every game, insert the new
-- games, mark active — so:
--   * entered RESULTS were deleted with no warning (scores, winners and the
--     advancement they caused live on the playoff_games rows);
--   * a failure after the delete left the bracket with no games, stuck as
--     `draft`, which hides it from the Playoffs page and the public schedule;
--   * nothing was written to the activity log.
-- replace_playoff_games is now the ONLY way games are written in bulk: one
-- transaction, refused while any result exists, logged.
--
-- DECISIONS (2026-10-08, the founder's):
--   1. Deleting a whole bracket is allowed EVEN WITH RESULTS. The preview
--      returns the counts the confirm states: games, dated games, games with
--      results, games currently on the public schedule.
--   2. Rebuilding is REFUSED while any game in the bracket has a result
--      (`blocked`, reason `results_entered`). Clearing a result is a separate
--      feature, not built.
--   3. The division LOCK does NOT gate either. playoff_games was never under
--      the 0082 trigger (it is a trigger on `games` only), and the lock's job
--      is protecting the regular schedule against re-derivation. What the
--      lock DOES decide is whether a bracket's dated games are on the public
--      schedule (0105), so the counts below say so instead.
--   4. Elite only, checked HERE as well as on the page (the 0106 plan-check
--      pattern; the Playoffs page is server-gated to Elite).
--   6. Every delete and every write of games logs to activity_log in the same
--      transaction.
--
-- A RESULT means any of: status 'completed', a home or away score, a winner.
-- (enter-result.ts writes all four together; any one is enough to refuse.)
--
-- "ON THE PUBLIC SCHEDULE" mirrors get_league_schedule_by_token (0105)
-- exactly, for one bracket: the org has a link row that is enabled; the
-- org's plan is Pro or Elite (always true here — these functions require
-- Elite); the season is not archived and has not ended more than 7 days ago
-- in the ORG's timezone; the game's division is LOCKED; the bracket is not
-- `draft`; the game has a date (undated playoff games are never rows). The
-- harness proves the count equals what the reader actually returns. If the
-- reader's conditions change, change both copies below with it.
--
-- REPLACE, IN THIS ORDER (each refusal raises, nothing written):
--   lock the bracket row and its games → caller is an org member → Elite →
--   settings and games validated (shape, teams in this season, fields in
--   this org, distinct game numbers, at least one game) → if any result
--   exists: return blocked (commit or not, nothing written) → preview
--   returns here → update settings → delete the games → insert the new
--   games → status 'active' → log.
-- Games are inserted with status 'scheduled' and NO scores or winner; the
-- playoff, league and division ids come from the bracket row, never from the
-- payload. A date or time that will not cast fails at the insert, after the
-- delete — the exception aborts the whole call, so the old games, the old
-- settings and the status all stand (proven by the harness).
--
-- THE DIVISION OF A BRACKET NEVER CHANGES HERE. p_settings carries no
-- division; the bracket row's division_id is kept.
--
-- GATE: is_org_member. Every org member is an admin today; if a non-admin
-- role is ever added this must be restricted with every other
-- is_org_member-gated write (CLAUDE.md).
--
-- LOCKS: row locks on the one playoffs row and its playoff_games rows (so a
-- result saved concurrently waits, and then finds its row gone). No table
-- locks.

create or replace function public.delete_playoff_bracket(
  p_playoff_id uuid,
  p_commit     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po        public.playoffs%rowtype;
  v_league    public.leagues%rowtype;
  v_plan      text;
  v_tz        text;
  v_div_name  text;
  v_games     integer;
  v_dated     integer;
  v_results   integer;
  v_public    integer;
  v_format    text;
  v_message   text;
begin
  if p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then its games.
  select * into v_po from public.playoffs where id = p_playoff_id for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_po.id for update;

  -- 2. Membership, judged on the season's org.
  select * into v_league from public.leagues where id = v_po.league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Counts (the confirm's numbers; taken after the locks).
  select count(*),
         count(*) filter (where g.scheduled_date is not null),
         count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null)
    into v_games, v_dated, v_results
    from public.playoff_games g
   where g.playoff_id = v_po.id;

  -- On the public schedule right now — see the header; mirrors 0105.
  select count(*) into v_public
    from public.playoff_games g
    join public.divisions d on d.id = g.division_id
   where g.playoff_id = v_po.id
     and g.scheduled_date is not null
     and d.locked
     and v_po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= v_league.end_date + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);

  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;

  if p_commit then
    delete from public.playoffs where id = v_po.id;
    if not found then
      raise exception 'nothing_deleted' using errcode = 'P0001';
    end if;

    v_format := case v_po.format
                  when 'single_elimination' then 'single elimination'
                  when 'double_elimination' then 'double elimination'
                  when 'round_robin' then 'round robin'
                  else v_po.format end;
    v_message := format('%s playoff bracket deleted (%s, %s %s, %s with results, %s dated)',
      coalesce(v_div_name, 'Division'), v_format,
      v_games, case when v_games = 1 then 'game' else 'games' end,
      v_results, v_dated);
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_bracket_deleted', v_message);
  end if;

  return jsonb_build_object(
    'committed',          p_commit,
    'blocked',            false,
    'reasons',            '[]'::jsonb,
    'playoff_id',         v_po.id,
    'division_id',        v_po.division_id,
    'division_name',      v_div_name,
    'format',             v_po.format,
    'status',             v_po.status,
    'games',              v_games,
    'dated_games',        v_dated,
    'games_with_results', v_results,
    'public_games',       v_public
  );
end;
$$;

create or replace function public.replace_playoff_games(
  p_playoff_id uuid,
  p_settings   jsonb,
  p_games      jsonb,
  p_commit     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po          public.playoffs%rowtype;
  v_league      public.leagues%rowtype;
  v_plan        text;
  v_tz          text;
  v_div_name    text;
  v_games       integer;
  v_dated       integer;
  v_results     integer;
  v_public_now  integer;
  v_new         integer;
  v_new_dated   integer;
  v_public_ok   boolean;
  v_public_after integer;
  v_inserted    integer;
  v_format      text;
  v_format_lbl  text;
  v_seeding     jsonb;
  v_start       date;
  v_end         date;
  v_days        text[];
  v_windows     jsonb;
  v_venues      jsonb;
  v_cross_on    boolean;
  v_cross_div   uuid;
  v_bad         integer;
  v_event       text;
  v_message     text;
begin
  if p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then its games.
  select * into v_po from public.playoffs where id = p_playoff_id for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_po.id for update;

  -- 2. Membership.
  select * into v_league from public.leagues where id = v_po.league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Settings. Every key is required and typed; a value that will not cast
  --    is invalid_settings, raised before anything is written.
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or jsonb_typeof(p_settings -> 'seeding') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'playing_days') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'day_windows') is distinct from 'object'
     or jsonb_typeof(p_settings -> 'venue_assignments') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'cross_division_enabled') is distinct from 'boolean'
     or (p_settings ->> 'format') is null
     or (p_settings ->> 'format') not in ('single_elimination', 'double_elimination', 'round_robin') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  begin
    v_format    := p_settings ->> 'format';
    v_seeding   := p_settings -> 'seeding';
    v_start     := nullif(p_settings ->> 'start_date', '')::date;
    v_end       := nullif(p_settings ->> 'end_date', '')::date;
    v_days      := array(select jsonb_array_elements_text(p_settings -> 'playing_days'));
    v_windows   := p_settings -> 'day_windows';
    v_venues    := p_settings -> 'venue_assignments';
    v_cross_on  := (p_settings ->> 'cross_division_enabled')::boolean;
    v_cross_div := nullif(p_settings ->> 'cross_division_opponent_id', '')::uuid;
  exception when others then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end;
  -- The cross-division opponent must be another division of this season
  -- (the FK alone would accept any org's division).
  if v_cross_div is not null and not exists (
       select 1 from public.divisions d
        where d.id = v_cross_div and d.league_id = v_po.league_id and d.id <> v_po.division_id) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;

  -- 5. Games: a non-empty array of objects with a round and a game number;
  --    distinct game numbers (advancement resolves targets by number); every
  --    team in this season; every field in this org.
  if p_games is null or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) = 0 then
    raise exception 'no_games' using errcode = 'P0001';
  end if;
  select count(*) into v_bad
    from jsonb_array_elements(p_games) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(btrim(e ->> 'round'), '') = ''
      or coalesce(e ->> 'game_number', '') !~ '^[0-9]{1,6}$';
  if v_bad > 0 then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  if (select count(distinct (e ->> 'game_number')::integer) from jsonb_array_elements(p_games) e)
     <> jsonb_array_length(p_games) then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  begin
    select count(*) into v_bad
      from jsonb_array_elements(p_games) e,
           lateral (values (nullif(e ->> 'home_team_id', '')::uuid), (nullif(e ->> 'away_team_id', '')::uuid)) t(team_id)
     where t.team_id is not null
       and not exists (select 1 from public.teams tm where tm.id = t.team_id and tm.league_id = v_po.league_id);
  exception when invalid_text_representation then
    raise exception 'invalid_games' using errcode = 'P0001';
  end;
  if v_bad > 0 then
    raise exception 'team_not_in_season' using errcode = 'P0001';
  end if;
  begin
    select count(*) into v_bad
      from jsonb_array_elements(p_games) e
     where nullif(e ->> 'venue_id', '') is not null
       and not exists (select 1 from public.venues v
                        where v.id = (e ->> 'venue_id')::uuid and v.owner_id = v_league.owner_id);
  exception when invalid_text_representation then
    raise exception 'invalid_games' using errcode = 'P0001';
  end;
  if v_bad > 0 then
    raise exception 'venue_not_in_org' using errcode = 'P0001';
  end if;

  -- 6. Counts, before and after.
  select count(*),
         count(*) filter (where g.scheduled_date is not null),
         count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null)
    into v_games, v_dated, v_results
    from public.playoff_games g
   where g.playoff_id = v_po.id;

  v_new := jsonb_array_length(p_games);
  select count(*) into v_new_dated
    from jsonb_array_elements(p_games) e
   where nullif(e ->> 'scheduled_date', '') is not null;

  -- Whether this bracket's dated games show on the public schedule — see the
  -- header; mirrors 0105. "Now" uses the bracket's current status; "after"
  -- uses 'active', which a commit sets.
  select count(*) into v_public_now
    from public.playoff_games g
    join public.divisions d on d.id = g.division_id
   where g.playoff_id = v_po.id
     and g.scheduled_date is not null
     and d.locked
     and v_po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= v_league.end_date + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);
  -- New games are written with the bracket's own division_id.
  v_public_ok := v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= v_league.end_date + 7)
     and exists (select 1 from public.divisions d where d.id = v_po.division_id and d.locked)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);
  v_public_after := case when v_public_ok then v_new_dated else 0 end;

  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;

  -- 7. Results block a rebuild (commit or preview); nothing is written.
  if v_results > 0 then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reasons', jsonb_build_array('results_entered'),
      'playoff_id', v_po.id, 'division_id', v_po.division_id, 'division_name', v_div_name,
      'status', v_po.status,
      'games', v_games, 'dated_games', v_dated, 'games_with_results', v_results,
      'public_games', v_public_now,
      'new_games', v_new, 'new_dated_games', v_new_dated, 'public_games_after', v_public_after);
  end if;

  -- 8. The write: settings, games, status, log — one transaction.
  if p_commit then
    update public.playoffs
       set format = v_format,
           seeding = v_seeding,
           start_date = v_start,
           end_date = v_end,
           playing_days = v_days,
           day_windows = v_windows,
           venue_assignments = v_venues,
           cross_division_enabled = v_cross_on,
           cross_division_opponent_id = case when v_cross_on then v_cross_div else null end,
           updated_at = now()
     where id = v_po.id;

    delete from public.playoff_games where playoff_id = v_po.id;

    insert into public.playoff_games
      (playoff_id, league_id, division_id, round, game_number,
       home_team_id, away_team_id, venue_id, scheduled_date, start_time, status)
    select v_po.id, v_po.league_id, v_po.division_id,
           btrim(e ->> 'round'), (e ->> 'game_number')::integer,
           nullif(e ->> 'home_team_id', '')::uuid, nullif(e ->> 'away_team_id', '')::uuid,
           nullif(e ->> 'venue_id', '')::uuid,
           nullif(e ->> 'scheduled_date', '')::date, nullif(e ->> 'start_time', '')::time,
           'scheduled'
      from jsonb_array_elements(p_games) e;

    -- The bracket holds exactly the new games, or nothing is saved.
    select count(*) into v_inserted from public.playoff_games where playoff_id = v_po.id;
    if v_inserted <> v_new then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;

    update public.playoffs set status = 'active', updated_at = now() where id = v_po.id;

    v_format_lbl := case v_format
                      when 'single_elimination' then 'single elimination'
                      when 'double_elimination' then 'double elimination'
                      else 'round robin' end;
    if v_games = 0 then
      v_event := 'playoff_bracket_generated';
      v_message := format('%s playoff bracket generated (%s, %s %s, %s dated)',
        coalesce(v_div_name, 'Division'), v_format_lbl,
        v_new, case when v_new = 1 then 'game' else 'games' end, v_new_dated);
    else
      v_event := 'playoff_bracket_rebuilt';
      v_message := format('%s playoff bracket rebuilt (%s, %s %s replaced with %s, %s dated)',
        coalesce(v_div_name, 'Division'), v_format_lbl,
        v_games, case when v_games = 1 then 'game' else 'games' end, v_new, v_new_dated);
    end if;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, v_event, v_message);
  end if;

  return jsonb_build_object(
    'committed', p_commit, 'blocked', false, 'reasons', '[]'::jsonb,
    'playoff_id', v_po.id, 'division_id', v_po.division_id, 'division_name', v_div_name,
    'status', case when p_commit then 'active' else v_po.status end,
    'games', v_games, 'dated_games', v_dated, 'games_with_results', v_results,
    'public_games', v_public_now,
    'new_games', v_new, 'new_dated_games', v_new_dated, 'public_games_after', v_public_after);
end;
$$;

-- Revoke from PUBLIC and from each role (a role-level revoke alone is a silent
-- no-op while PUBLIC holds it), then grant back exactly one.
revoke execute on function public.delete_playoff_bracket(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.delete_playoff_bracket(uuid, boolean)
  to authenticated;
revoke execute on function public.replace_playoff_games(uuid, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.replace_playoff_games(uuid, jsonb, jsonb, boolean)
  to authenticated;

-- Refuse to finish with a wrong privilege: the no-op form leaves no error.
do $check$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.delete_playoff_bracket(uuid, boolean)',
                              'public.replace_playoff_games(uuid, jsonb, jsonb, boolean)'] loop
    if not has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or has_function_privilege('dashboard_readonly', v_fn, 'execute') then
      raise exception '0107: % privileges are wrong', v_fn;
    end if;
  end loop;
end;
$check$;
