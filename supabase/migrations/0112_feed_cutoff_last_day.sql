-- 0112: the public schedule and team calendar feeds stop 7 days after the
-- LATER of a season's end date and its last dated game — not the end date
-- alone.
--
-- DECIDED 2026-10-19 (Whit). Before this, a season whose games ran past its
-- end date (playoffs scheduled after the regular season ends, a makeup game)
-- dropped off parents' phones and off the league's public page 7 days after
-- the END DATE, while those games were still to be played. Auto-archive
-- (2026-10-19, TypeScript) already waits for every game; the feeds now do too.
--
-- WHAT THIS FILE DOES
--   1. season_last_day(league_id): the later of the end date and the last
--      dated game — any regular-season game (any status), any dated playoff
--      game. No end date → null, and a null last day is never cut off (the
--      rule before 0112). Callable by NO role: the five functions below are
--      SECURITY DEFINER and reach it as its owner. SECURITY INVOKER, stable.
--      TypeScript twin: seasonLastDay (src/lib/seasons/archive-decision.ts);
--      the two are pinned by ONE case table, between the LASTDAY-TABLE-BEGIN /
--      LASTDAY-TABLE-END lines of scripts/sim/feed-cutoff-sim.sql, which the SQL
--      proof runs through this function and sim:feed-cutoff runs through the
--      TypeScript one. Change one rule alone and its side goes red.
--   2. The five functions that hold the "end date + 7" cut-off, re-created
--      VERBATIM from their latest repo files with only that expression
--      changed to season_last_day(...) + 7:
--        get_team_calendar_by_token   (0100) — the team feed's "expired"
--        get_league_schedule_by_token (0105) — which seasons the public page shows
--        delete_playoff_bracket       (0107) — "games on the public schedule"
--        replace_playoff_games        (0107) — the same count, twice
--        clear_playoff_result         (0108) — the same test, one game
--      The last three mirror the 0105 reader (CLAUDE.md: change all copies
--      together); this file is that change. "Today" is unchanged: the ORG's
--      timezone, computed in the database.
--
-- FAIL-SAFE DIRECTION. A read error inside any of these raises and fails the
-- whole call — the feed route already answers a failed read with 503 +
-- Retry-After (calendar apps keep their last copy) and the public page with
-- "We couldn't load the schedule right now". Nothing here can make a read
-- error look like "expired".
--
-- APPLY VERBATIM, comments included (CLAUDE.md). Verify md5(prosrc) of all
-- six functions against this file, and EXECUTE per role (the verify block at
-- the end raises if a privilege is wrong).
--
-- LOCKS: CREATE OR REPLACE FUNCTION locks only the function being replaced;
-- a feed request arriving mid-apply waits a moment. No table is locked.
--
-- DEPLOY ORDER: none required for the database — the routes read the same
-- statuses either way. The editor's note on the season page describes this
-- rule, so the code that carries it should reach main AFTER 0112 is applied.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. season_last_day
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.season_last_day(p_league_id uuid)
returns date
language sql
stable
set search_path = public
as $$
  -- The day the feeds' 7-day grace counts from: the LATER of the end date and
  -- the last dated game. Regular-season games of ANY status count, by the
  -- date part of scheduled_at as stored (the house wall-clock convention:
  -- stored at +00, read as UTC); playoff games by scheduled_date (undated
  -- ones carry no date to count). No end date → null: never cut off.
  -- TypeScript twin: seasonLastDay — one case table pins both.
  select case
           when l.end_date is null then null
           else greatest(
             l.end_date,
             (select max((g.scheduled_at at time zone 'UTC')::date)
                from public.games g
               where g.league_id = l.id),
             (select max(pg.scheduled_date)
                from public.playoff_games pg
               where pg.league_id = l.id))
         end
    from public.leagues l
   where l.id = p_league_id
$$;

revoke execute on function public.season_last_day(uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. get_team_calendar_by_token — verbatim from 0100_venue_address_in_calendar.sql, cut-off changed
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_team_calendar_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status        text;
  v_team_id       uuid;
  v_team_name     text;
  v_league_id     uuid;
  v_division_id   uuid;
  v_division_name text;
  v_duration      jsonb;
  v_locked        boolean;
  v_season_name   text;
  v_end_date      date;
  v_archived_at   timestamptz;
  v_org_name      text;
  v_plan          text;
  v_timezone      text;
  v_today         date;
  v_games         jsonb;
begin
  -- A malformed token is answered without touching the table.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;

  select k.status, k.team_id
    into v_status, v_team_id
    from public.team_calendar_links k
   where k.token = p_token;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_status = 'replaced' then
    return jsonb_build_object('status', 'revoked');
  end if;
  if v_status = 'off' then
    return jsonb_build_object('status', 'off');
  end if;

  -- A link whose team, season or org row is gone is answered 'unknown'
  -- EXPLICITLY — never by whichever later check happens to trip on a null.
  select t.name, t.league_id, t.division_id
    into v_team_name, v_league_id, v_division_id
    from public.teams t
   where t.id = v_team_id;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  select l.name, l.end_date, l.archived_at, p.org_name, p.plan, p.timezone
    into v_season_name, v_end_date, v_archived_at, v_org_name, v_plan, v_timezone
    from public.leagues l
    join public.profiles p on p.id = l.owner_id
   where l.id = v_league_id;
  if not found or v_timezone is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  -- "Today" in the ORG's zone. Never current_date, never the server's zone.
  v_today := (now() at time zone v_timezone)::date;

  if v_archived_at is not null
     or (v_end_date is not null and v_today > public.season_last_day(v_league_id) + 7)
  then
    return jsonb_build_object('status', 'expired');
  end if;

  if v_plan is null or v_plan not in ('pro', 'elite') then
    return jsonb_build_object('status', 'plan');
  end if;

  -- A team with no division has no locked division.
  select d.name, d.settings -> 'game_duration', d.locked
    into v_division_name, v_duration, v_locked
    from public.divisions d
   where d.id = v_division_id;

  if not found or not coalesce(v_locked, false) then
    return jsonb_build_object('status', 'unlocked');
  end if;

  -- Every column is named. NEVER to_jsonb(g), never g.*: games carries notes,
  -- scores and attribution, and teams carries contact_email.
  --
  -- scheduled_at is WALL-CLOCK text with a literal +00 (see game-time.ts); it
  -- is rendered explicitly so the result does not depend on the session's
  -- TimeZone setting. updated_at is a real instant, rendered in UTC.
  --
  -- proposed_venue_name is the PARTNER's field and is returned for away games
  -- only; on a home game it can hold a stale counter-proposal.
  --
  -- venue.address (0100) is the ONLY place a street address leaves the
  -- database. Partner-facing token functions do not emit it.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',                  g.id,
      'scheduled_at',        to_char(g.scheduled_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00',
      'updated_at',          to_char(g.updated_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'status',              g.status,
      'is_away',             g.is_away,
      'home_team_id',        g.home_team_id,
      'away_team_id',        g.away_team_id,
      'external_team_name',  g.external_team_name,
      'proposed_venue_name', case when g.is_away then g.proposed_venue_name
                                  else null end,
      'home_team',           jsonb_build_object('name', ht.name),
      'away_team',           case when awt.id is not null
                               then jsonb_build_object('name', awt.name)
                               else null end,
      'venue',               case when v.id is not null
                               then jsonb_build_object(
                                 'name', v.name,
                                 'location', case when loc.id is not null
                                   then jsonb_build_object('name', loc.name)
                                   else null end,
                                 -- 0100: the field's street address, so a phone
                                 -- can open the LOCATION line in Maps. The
                                 -- venue's own, else its park's, trimmed, blank
                                 -- as null. Emitted HERE and nowhere else: the
                                 -- CSV exports, prints and partner RPCs name
                                 -- their columns and never select it.
                                 'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), ''))
                               )
                               else null end
    )
    order by g.scheduled_at asc, g.id asc
  ), '[]'::jsonb)
    into v_games
    from public.games g
    join public.teams ht on ht.id = g.home_team_id
    left join public.teams awt on awt.id = g.away_team_id
    left join public.venues v on v.id = g.venue_id
    left join public.locations loc on loc.id = v.location_id
   where g.league_id = v_league_id
     and (g.home_team_id = v_team_id or g.away_team_id = v_team_id)
     -- An unagreed interleague proposal never leaves the database.
     and g.status <> 'pending_interleague';

  return jsonb_build_object(
    'status',   'ok',
    'team',     jsonb_build_object('id', v_team_id, 'name', v_team_name),
    'division', jsonb_build_object('name', v_division_name,
                                   'game_duration', v_duration),
    'season',   jsonb_build_object('name', v_season_name),
    'org',      jsonb_build_object('name', v_org_name, 'timezone', v_timezone),
    'games',    v_games
  );
end;
$$;

revoke execute on function public.get_team_calendar_by_token(text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.get_team_calendar_by_token(text)
  to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. get_league_schedule_by_token — verbatim from 0105_public_league_schedule.sql, cut-off changed
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_league_schedule_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_enabled  boolean;
  v_org_name text;
  v_plan     text;
  v_timezone text;
  v_today    date;
  v_seasons  jsonb;
begin
  -- A malformed token is answered without touching the table.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;

  select k.org_id, k.enabled
    into v_org_id, v_enabled
    from public.public_schedule_links k
   where k.token = p_token;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if not v_enabled then
    return jsonb_build_object('status', 'off');
  end if;

  select p.org_name, p.plan, p.timezone
    into v_org_name, v_plan, v_timezone
    from public.profiles p
   where p.id = v_org_id;
  if not found or v_timezone is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  if v_plan is null or v_plan not in ('pro', 'elite') then
    return jsonb_build_object('status', 'plan');
  end if;

  -- "Today" in the ORG's zone. Never current_date, never the server's zone.
  v_today := (now() at time zone v_timezone)::date;

  -- Every key is named. NEVER to_jsonb(g), never g.*: games carries notes,
  -- scores and attribution; teams carries contact_email; divisions.settings
  -- carries coach metadata (only the game_duration key is projected).
  --
  -- scheduled_at is WALL-CLOCK text with a literal +00 (see game-time.ts); it
  -- is rendered explicitly so the result does not depend on the session's
  -- TimeZone setting.
  --
  -- A division is published iff it is LOCKED. Games have no division_id: a
  -- game belongs to its home team's division (CLAUDE.md, schedule lock).
  select coalesce(jsonb_agg(s.season order by s.sort_start nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_seasons
    from (
      select l.id, l.created_at, l.start_date as sort_start,
        jsonb_build_object(
          'id',         l.id,
          'name',       l.name,
          'start_date', l.start_date,
          'end_date',   l.end_date,

          'divisions', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',            d.id,
                     'name',          d.name,
                     'game_duration', d.settings -> 'game_duration'
                   ) order by d.name, d.id), '[]'::jsonb)
              from public.divisions d
             where d.league_id = l.id and d.locked
          ),

          -- Names only: what the page lists as "not published yet".
          'unpublished', (
            select coalesce(jsonb_agg(d.name order by d.name, d.id), '[]'::jsonb)
              from public.divisions d
             where d.league_id = l.id and not d.locked
          ),

          'teams', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',          t.id,
                     'name',        t.name,
                     'division_id', t.division_id
                   ) order by t.name, t.id), '[]'::jsonb)
              from public.teams t
              join public.divisions d on d.id = t.division_id
             where t.league_id = l.id and d.locked
          ),

          'games', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',                  g.id,
                     'scheduled_at',        to_char(g.scheduled_at at time zone 'UTC',
                                                    'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00',
                     'status',              g.status,
                     'is_away',             g.is_away,
                     'interleague',         g.interleague_org_id is not null,
                     'division_id',         ht.division_id,
                     'home_team_id',        g.home_team_id,
                     'away_team_id',        g.away_team_id,
                     'external_team_name',  g.external_team_name,
                     -- The PARTNER's field, away games only; on a home game it
                     -- can hold a stale counter-proposal.
                     'proposed_venue_name', case when g.is_away then g.proposed_venue_name
                                                 else null end,
                     'home_team',           jsonb_build_object('name', ht.name),
                     'away_team',           case when awt.id is not null
                                              then jsonb_build_object('name', awt.name)
                                              else null end,
                     'venue',               case when v.id is not null
                                              then jsonb_build_object(
                                                'name', v.name,
                                                'location', case when loc.id is not null
                                                  then jsonb_build_object('name', loc.name)
                                                  else null end,
                                                'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), '')),
                                                'home_park', coalesce(loc.is_home_park, false)
                                              )
                                              else null end
                   ) order by g.scheduled_at, g.id), '[]'::jsonb)
              from public.games g
              join public.teams ht on ht.id = g.home_team_id
              join public.divisions hd on hd.id = ht.division_id
              left join public.teams awt on awt.id = g.away_team_id
              left join public.venues v on v.id = g.venue_id
              left join public.locations loc on loc.id = v.location_id
             where g.league_id = l.id
               and hd.locked
               -- An unagreed interleague proposal never leaves the database.
               and g.status <> 'pending_interleague'
          ),

          'playoff_games', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',             pg.id,
                     'playoff_id',     pg.playoff_id,
                     'format',         po.format,
                     'division_id',    pg.division_id,
                     'round',          pg.round,
                     'game_number',    pg.game_number,
                     'scheduled_date', pg.scheduled_date,
                     'start_time',     to_char(pg.start_time, 'HH24:MI'),
                     'status',         pg.status,
                     'home_team',      case when pht.id is not null
                                         then jsonb_build_object('id', pht.id, 'name', pht.name)
                                         else null end,
                     'away_team',      case when pat.id is not null
                                         then jsonb_build_object('id', pat.id, 'name', pat.name)
                                         else null end,
                     'venue',          case when v.id is not null
                                         then jsonb_build_object(
                                           'name', v.name,
                                           'location', case when loc.id is not null
                                             then jsonb_build_object('name', loc.name)
                                             else null end,
                                           'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), '')),
                                           'home_park', coalesce(loc.is_home_park, false)
                                         )
                                         else null end
                   ) order by pg.scheduled_date nulls last, pg.start_time nulls last, pg.game_number, pg.id), '[]'::jsonb)
              from public.playoff_games pg
              join public.playoffs po on po.id = pg.playoff_id
              join public.divisions d on d.id = pg.division_id
              left join public.teams pht on pht.id = pg.home_team_id
              left join public.teams pat on pat.id = pg.away_team_id
              left join public.venues v on v.id = pg.venue_id
              left join public.locations loc on loc.id = v.location_id
             where pg.league_id = l.id
               and d.locked
               and po.status <> 'draft'
          )
        ) as season
        from public.leagues l
       where l.owner_id = v_org_id
         and l.archived_at is null
         and (l.end_date is null or v_today <= public.season_last_day(l.id) + 7)
         and exists (select 1 from public.divisions d where d.league_id = l.id and d.locked)
    ) s;

  return jsonb_build_object(
    'status',  'ok',
    'org',     jsonb_build_object('name', v_org_name, 'timezone', v_timezone),
    'today',   v_today,
    'seasons', v_seasons
  );
end;
$$;

revoke execute on function public.get_league_schedule_by_token(text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.get_league_schedule_by_token(text)
  to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. delete_playoff_bracket — verbatim from 0107_playoff_bracket_delete_rebuild.sql, cut-off changed
-- ────────────────────────────────────────────────────────────────────────────
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
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
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

revoke execute on function public.delete_playoff_bracket(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.delete_playoff_bracket(uuid, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. replace_playoff_games — verbatim from 0107_playoff_bracket_delete_rebuild.sql, cut-off changed
-- ────────────────────────────────────────────────────────────────────────────
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
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);
  -- New games are written with the bracket's own division_id.
  v_public_ok := v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
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

revoke execute on function public.replace_playoff_games(uuid, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.replace_playoff_games(uuid, jsonb, jsonb, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. clear_playoff_result — verbatim from 0108_playoff_result_enter_clear.sql, cut-off changed
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.clear_playoff_result(
  p_game_id uuid,
  p_commit  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po_id      uuid;
  v_po         public.playoffs%rowtype;
  v_league     public.leagues%rowtype;
  v_game       public.playoff_games%rowtype;
  v_target     public.playoff_games%rowtype;
  v_plan       text;
  v_tz         text;
  v_div_name   text;
  v_target_id  uuid;
  v_field      text;
  v_slot       uuid;
  v_remove     boolean := false;
  v_public     boolean;
  v_rows       integer;
  v_home_name  text;
  v_away_name  text;
  v_win_name   text;
  v_message    text;
begin
  if p_game_id is null or p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then every game in it (0107's order).
  select g.playoff_id into v_po_id from public.playoff_games g where g.id = p_game_id;
  if v_po_id is null then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  select * into v_po from public.playoffs where id = v_po_id for update;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_po.id for update;
  select * into v_game from public.playoff_games where id = p_game_id and playoff_id = v_po.id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;

  -- 2. Membership, judged on the season's org.
  select * into v_league from public.leagues where id = v_po.league_id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Format: single elimination and round robin only.
  if v_po.format is distinct from 'single_elimination' and v_po.format is distinct from 'round_robin' then
    raise exception 'format_not_supported' using errcode = 'P0001';
  end if;

  -- 5. There must be a result to clear.
  if not (v_game.status = 'completed' or v_game.home_score is not null
          or v_game.away_score is not null or v_game.winner_id is not null) then
    raise exception 'no_result' using errcode = 'P0001';
  end if;

  -- 6. The game this one advanced its winner into (single elimination).
  if v_po.format = 'single_elimination' then
    select t.target_id, t.target_field into v_target_id, v_field
      from public.playoff_single_elim_target(v_game.id) t;
    if v_target_id is not null then
      select * into v_target from public.playoff_games where id = v_target_id;
      if v_target.status = 'completed' or v_target.home_score is not null
         or v_target.away_score is not null or v_target.winner_id is not null then
        return jsonb_build_object(
          'committed', false, 'blocked', true, 'reason', 'next_game_has_result',
          'game_id', v_game.id,
          'next_game', jsonb_build_object(
            'game_id', v_target.id, 'game_number', v_target.game_number, 'round', v_target.round,
            'home_name', (select name from public.teams where id = v_target.home_team_id),
            'away_name', (select name from public.teams where id = v_target.away_team_id),
            'home_score', v_target.home_score, 'away_score', v_target.away_score));
      end if;
      v_slot := case when v_field = 'home_team_id' then v_target.home_team_id else v_target.away_team_id end;
      if v_slot is not null and v_game.winner_id is not null and v_slot = v_game.winner_id then
        v_remove := true;
      elsif v_slot is not null and v_game.winner_id is not null then
        -- The slot holds a team this game did not put there. Never guess.
        raise exception 'advancement_mismatch' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- 7. On the public schedule — mirrors 0105 (see the header).
  select count(*) > 0 into v_public
    from public.playoff_games g
    join public.divisions d on d.id = g.division_id
   where g.id in (v_game.id, case when v_remove then v_target_id else v_game.id end)
     and g.scheduled_date is not null
     and d.locked
     and v_po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);

  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;
  select name into v_home_name from public.teams where id = v_game.home_team_id;
  select name into v_away_name from public.teams where id = v_game.away_team_id;
  select name into v_win_name from public.teams where id = v_game.winner_id;

  -- 8. The write: the game, then the next game's slot, then the log.
  if p_commit then
    update public.playoff_games
       set home_score = null,
           away_score = null,
           winner_id  = null,
           status     = 'scheduled',
           updated_at = now()
     where id = v_game.id
       and status = v_game.status
       and home_score is not distinct from v_game.home_score
       and away_score is not distinct from v_game.away_score
       and winner_id  is not distinct from v_game.winner_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;

    if v_remove then
      update public.playoff_games
         set home_team_id = case when v_field = 'home_team_id' then null else home_team_id end,
             away_team_id = case when v_field = 'away_team_id' then null else away_team_id end,
             updated_at   = now()
       where id = v_target_id
         and status <> 'completed'
         and home_score is null and away_score is null and winner_id is null
         and (case when v_field = 'home_team_id' then home_team_id else away_team_id end) = v_game.winner_id;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'nothing_saved' using errcode = 'P0001';
      end if;
    end if;

    v_message := format('%s playoffs: result cleared for Game %s (%s) — was %s %s, %s %s',
      coalesce(v_div_name, 'Division'), v_game.game_number, v_game.round,
      coalesce(v_home_name, 'Home'), coalesce(v_game.home_score::text, '?'),
      coalesce(v_away_name, 'Away'), coalesce(v_game.away_score::text, '?'));
    if v_win_name is not null then
      v_message := v_message || format(' (%s won)', v_win_name);
    end if;
    if v_remove then
      v_message := v_message || format('; %s removed from Game %s (%s)',
        coalesce(v_win_name, 'the winner'), v_target.game_number, v_target.round);
    end if;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_result_cleared', v_message);
  end if;

  return jsonb_build_object(
    'committed', p_commit, 'blocked', false,
    'game_id', v_game.id, 'playoff_id', v_po.id,
    'game_number', v_game.game_number, 'round', v_game.round,
    'home_name', v_home_name, 'away_name', v_away_name,
    'home_score', v_game.home_score, 'away_score', v_game.away_score,
    'winner_name', v_win_name,
    'on_public_schedule', coalesce(v_public, false),
    'removed', case when v_remove then jsonb_build_object(
                 'game_id', v_target.id, 'game_number', v_target.game_number,
                 'round', v_target.round, 'field', v_field, 'team_name', v_win_name)
               else null end);
end;
$$;

revoke execute on function public.clear_playoff_result(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.clear_playoff_result(uuid, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Verify — RAISES if anything is not exactly as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_role  text;
  r       record;
begin
  for r in
    select * from (values
      ('public.season_last_day(uuid)',                                         ''),
      ('public.get_team_calendar_by_token(text)',                              'anon,authenticated'),
      ('public.get_league_schedule_by_token(text)',                            'anon,authenticated'),
      ('public.delete_playoff_bracket(uuid, boolean)',                         'authenticated'),
      ('public.replace_playoff_games(uuid, jsonb, jsonb, boolean)',            'authenticated'),
      ('public.clear_playoff_result(uuid, boolean)',                           'authenticated')
    ) as t(fn, allowed)
  loop
    foreach v_role in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']
    loop
      if has_function_privilege(v_role, r.fn, 'EXECUTE')
         <> (v_role = any (string_to_array(r.allowed, ','))) then
        v_wrong := v_wrong || format(' [%s EXECUTE on %s is %s]', v_role, r.fn,
                                     has_function_privilege(v_role, r.fn, 'EXECUTE'));
      end if;
    end loop;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('get_team_calendar_by_token', 'get_league_schedule_by_token',
                                  'delete_playoff_bracket', 'replace_playoff_games',
                                  'clear_playoff_result')
                and p.prosrc like '%end_date + 7%') then
    v_wrong := v_wrong || ' [a function still cuts off at end_date + 7]';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'season_last_day' and p.prosecdef) then
    v_wrong := v_wrong || ' [season_last_day is SECURITY DEFINER]';
  end if;

  if v_wrong <> '' then
    raise exception '0112 verification failed:%', v_wrong;
  end if;
end;
$$;
