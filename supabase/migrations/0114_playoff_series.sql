-- 0114: playoff series — a single-elimination round can be 1 game or best of
-- 3, 5 or 7 (approved mockup docs/mockups/playoff-series.html, 2026-10-20).
-- Every rule and sentence lives in src/lib/playoffs/series.ts (with
-- series-lengths.ts and series-names.ts); this file enforces them.
--
-- THE MODEL
--   Every game of a series is its own playoff_games row. All games of one
--   series share the round and the `game_number` (the bracket position —
--   advancement keys on it, so it is never renumbered); `series_game` is
--   1..length. A single game is game 1 of 1. If-needed games are created and
--   dated when the bracket is generated.
--   A team wins a series at length/2 + 1 wins. The games after the deciding
--   one become status `not_needed` in the same transaction as the result;
--   a result change or a clear that un-decides the series brings them back
--   (`scheduled`). Results go in order (game k needs game k-1's result — a
--   rained-out game is moved, never skipped); only the LAST result in a
--   series can be changed or cleared.
--   The series winner moves into the next round. When that round is a
--   series, into EVERY game of it; once BOTH of its teams are known, home
--   alternates — the higher TRUE seed (the bracket's seeding list; in Stage 2,
--   the seeds the admin gave) is home in games 1, 3, 5 and 7. Until then each
--   team sits in its bracket slot. Single-game rounds work exactly as before.
--   Series are single elimination only (decided 2026-10-20).
--
-- WHAT THIS FILE DOES
--   1. Schema. playoffs.series_by_round (jsonb, {} = every round 1 game);
--      playoff_games.series_game (1..7, default 1); the status check gains
--      'not_needed'; a unique index (playoff_id, round, game_number,
--      series_game). Every existing bracket and game is untouched apart from
--      the defaults.
--   2. season_last_day (0112): a not-needed game's date doesn't count.
--   3. New helpers, callable by NO role: playoff_check_series (the payload's
--      series shape — both writers call it), playoff_series_place (moves a
--      series winner into, or out of, the next round's games), and
--      playoff_round_title / playoff_round_in_sentence / playoff_game_title
--      (the log's words).
--   4. replace_playoff_games and playoff_write_stage (0113): series payloads
--      (series_game, settings.series_by_round), stored; Stage 2 seeds may sit
--      in every game of their series.
--   5. delete_playoff_bracket (0113): counts not-needed games.
--   6. enter_playoff_result / clear_playoff_result (0113): the series rules
--      above, with new refusals `game_not_needed`, `series_order`,
--      `series_later_result`. The log names the round and the teams, never a
--      stored game number (CLAUDE.md open item, 2026-10-20).
--   7. get_league_schedule_by_token (0113): not-needed games never leave the
--      database; series_game and series_length are emitted.
--   8. replace_two_stage_games (0113): its public counts skip not-needed games.
--   Every public-schedule mirror (0107's rule) gains `status <> 'not_needed'`,
--   as the reader does.
--
-- KEPT BYTE-FOR-BYTE: every line the 0107, 0108 and 0113 proofs' mutants
-- replace. Series handling is added in new blocks (5b, 8b) around the
-- single-game code, so those proofs re-run against this file unchanged.
--
-- HONEST SCOPE. playoffs and playoff_games are RLS ALL for org members (0049);
-- these functions make the product's writes atomic, checked and logged; they
-- are not a permission fence.
--
-- GATE: is_org_member + Elite, as 0107/0108.
--
-- LOCKS WHEN APPLIED: ACCESS EXCLUSIVE on `playoffs` and `playoff_games` for
-- the ALTERs (no rewrite: both new columns have constant defaults; the status
-- check and the new unique index scan every playoff_games row — 18 today).
-- It blocks the Playoffs page, the public schedule reader, auto-archive's and
-- the snack shack's playoff reads for that moment. Applied in one
-- transaction (well under a second).
--
-- APPLY VERBATIM, comments included (CLAUDE.md). The verify block at the end
-- raises if a privilege is wrong. Verify md5(prosrc) of every function.
--
-- DEPLOY ORDER: apply BEFORE the series code reaches main. The code on main
-- today writes no series and reads none of the new columns; for it every
-- bracket behaves exactly as before.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Schema
-- ────────────────────────────────────────────────────────────────────────────
alter table public.playoffs
  -- Round label → series length (3, 5 or 7). A round not listed is 1 game.
  add column series_by_round jsonb not null default '{}'::jsonb;

alter table public.playoffs
  add constraint playoffs_series_by_round_check
    check (jsonb_typeof(series_by_round) = 'object');

alter table public.playoff_games
  -- Game k of its series (a single game is 1).
  add column series_game smallint not null default 1;

alter table public.playoff_games
  drop constraint playoff_games_status_check,
  add constraint playoff_games_status_check
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled', 'not_needed')),
  add constraint playoff_games_series_game_check
    check (series_game between 1 and 7);

-- One row per game of a series.
create unique index playoff_games_series_slot_key
  on public.playoff_games (playoff_id, round, game_number, series_game);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. season_last_day — from 0112_feed_cutoff_last_day.sql; not-needed games don't count
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
  -- 0114: a playoff game that is NOT NEEDED (its series was decided before
  -- it) is never played, so its date doesn't count.
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
               where pg.league_id = l.id
                 and pg.status <> 'not_needed'))
         end
    from public.leagues l
   where l.id = p_league_id
$$;

revoke execute on function public.season_last_day(uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Helpers (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────

-- The series shape of a bracket payload. Both writers call it.
create or replace function public.playoff_check_series(
  p_format text,
  p_series jsonb,
  p_games  jsonb
)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  -- Settings: series lengths are 3, 5 or 7, single elimination only, and
  -- every round named is a round of these games.
  if p_series is null or jsonb_typeof(p_series) <> 'object'
     or exists (select 1 from jsonb_each(p_series) s
                 where jsonb_typeof(s.value) <> 'number' or s.value::text not in ('3', '5', '7'))
     or (p_series <> '{}'::jsonb and p_format is distinct from 'single_elimination')
     or exists (select 1 from jsonb_object_keys(p_series) k
                 where not exists (select 1 from jsonb_array_elements(p_games) e
                                    where btrim(e ->> 'round') = k)) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  -- Games: series_game is absent (1) or 1..7.
  if exists (select 1 from jsonb_array_elements(p_games) e
              where coalesce(e ->> 'series_game', '1') !~ '^[1-7]$') then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  -- One row per game number and game of its series; one round per number.
  -- (Before 0114: distinct game numbers — the same rule for single games.)
  if (select count(distinct ((e ->> 'game_number')::integer, coalesce(e ->> 'series_game', '1')::integer))
        from jsonb_array_elements(p_games) e) <> jsonb_array_length(p_games)
     or exists (select 1 from jsonb_array_elements(p_games) e
                 group by (e ->> 'game_number')::integer
                having count(distinct btrim(e ->> 'round')) > 1) then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  -- Every series is games 1..L, L = its round's length (1 when not listed).
  if exists (select 1
               from (select btrim(e ->> 'round') as r,
                            count(*) as c,
                            max(coalesce(e ->> 'series_game', '1')::integer) as m
                       from jsonb_array_elements(p_games) e
                      group by btrim(e ->> 'round'), (e ->> 'game_number')::integer) x
              where x.c <> coalesce((p_series ->> x.r)::integer, 1) or x.m <> x.c) then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.playoff_check_series(text, jsonb, jsonb)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- Moves a series winner into the next round's series (every game of it), or
-- takes it back out (p_incoming null). p_field is the bracket slot this series
-- feeds; p_outgoing the team it sent on before (an edit or a clear), or null.
-- TypeScript twin: seriesAdvanceWrites / seriesClearWrites (series.ts).
create or replace function public.playoff_series_place(
  p_po       public.playoffs,
  p_round    text,
  p_number   integer,
  p_field    text,
  p_incoming uuid,
  p_outgoing uuid
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_len   integer;
  v_first public.playoff_games%rowtype;
  v_ours  uuid;
  v_other uuid;
  v_a     uuid;
  v_b     uuid;
  v_sa    integer;
  v_sb    integer;
  v_top   uuid;
  v_low   uuid;
  v_home  uuid;
  v_away  uuid;
  v_n     integer;
  v_rows  integer := 0;
  r       public.playoff_games%rowtype;
begin
  select max(g.series_game) into v_len
    from public.playoff_games g
   where g.playoff_id = p_po.id and g.round = p_round and g.game_number = p_number;
  if v_len is null then
    return 0;
  end if;
  select * into v_first
    from public.playoff_games g
   where g.playoff_id = p_po.id and g.round = p_round and g.game_number = p_number
   order by g.series_game, g.id limit 1;

  -- Who else is in the next series. Once both of its teams are known, home
  -- alternates and the slots no longer say who came from where: the team
  -- leaving must be one of the two. Before that each team is in its bracket
  -- slot: this series' slot must be empty or hold a team this series sent.
  -- A stranger is never overwritten or guessed about.
  if v_len > 1 and v_first.home_team_id is not null and v_first.away_team_id is not null then
    if p_outgoing is not null and p_outgoing = v_first.home_team_id then
      v_other := v_first.away_team_id;
    elsif p_outgoing is not null and p_outgoing = v_first.away_team_id then
      v_other := v_first.home_team_id;
    else
      raise exception 'slot_occupied' using errcode = 'P0001';
    end if;
  else
    v_ours  := case when p_field = 'home_team_id' then v_first.home_team_id else v_first.away_team_id end;
    v_other := case when p_field = 'home_team_id' then v_first.away_team_id else v_first.home_team_id end;
    if v_ours is not null and v_ours is distinct from p_outgoing and v_ours is distinct from p_incoming then
      raise exception 'slot_occupied' using errcode = 'P0001';
    end if;
  end if;

  -- Bracket slots A (home today) and B.
  v_a := case when p_field = 'home_team_id' then p_incoming else v_other end;
  v_b := case when p_field = 'home_team_id' then v_other else p_incoming end;
  -- Both known: the higher TRUE seed (lower number in the seeding list; a team
  -- with no seed ranks below one with a seed; no seeds at all → slot A).
  if v_a is not null and v_b is not null then
    select o.ord into v_sa from jsonb_array_elements(p_po.seeding) with ordinality o(e, ord)
     where o.e ->> 'team_id' = v_a::text limit 1;
    select o.ord into v_sb from jsonb_array_elements(p_po.seeding) with ordinality o(e, ord)
     where o.e ->> 'team_id' = v_b::text limit 1;
    if v_sb is not null and (v_sa is null or v_sb < v_sa) then
      v_top := v_b; v_low := v_a;
    else
      v_top := v_a; v_low := v_b;
    end if;
  end if;

  -- Every game of the next series, each write conditional on what was read.
  for r in
    select * from public.playoff_games g
     where g.playoff_id = p_po.id and g.round = p_round and g.game_number = p_number
     order by g.series_game, g.id
  loop
    if v_len > 1 and v_top is not null then
      v_home := case when r.series_game % 2 = 1 then v_top else v_low end;
      v_away := case when r.series_game % 2 = 1 then v_low else v_top end;
    else
      v_home := v_a;
      v_away := v_b;
    end if;
    update public.playoff_games g
       set home_team_id = v_home,
           away_team_id = v_away,
           updated_at   = now()
     where g.id = r.id
       and g.status <> 'completed'
       and g.home_score is null and g.away_score is null and g.winner_id is null
       and g.home_team_id is not distinct from r.home_team_id
       and g.away_team_id is not distinct from r.away_team_id;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;
    v_rows := v_rows + 1;
  end loop;
  return v_rows;
end;
$$;

revoke execute on function public.playoff_series_place(public.playoffs, text, integer, text, uuid, uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- A round's name for the log: "Final", "Semifinals", "Quarterfinals", "Round 1".
-- The round labelled R1 is always Round 1, as the app calls it (series-names.ts).
create or replace function public.playoff_round_title(p_playoff_id uuid, p_round text)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_rounds text[];
  v_n      integer;
  v_idx    integer;
begin
  if p_round = 'F' then
    return 'Final';
  end if;
  if p_round = 'SF' then
    return 'Semifinals';
  end if;
  select array_agg(r.round order by public.playoff_round_order(r.round), r.round)
    into v_rounds
    from (select distinct g.round from public.playoff_games g where g.playoff_id = p_playoff_id) r;
  v_n := coalesce(array_length(v_rounds, 1), 0);
  v_idx := array_position(v_rounds, p_round);
  if v_idx is null then
    return p_round;
  end if;
  if p_round <> 'R1' and p_round !~ '^RR' and (1 << (v_n - v_idx)) = 4 then
    return 'Quarterfinals';
  end if;
  return 'Round ' || v_idx;
end;
$$;

revoke execute on function public.playoff_round_title(uuid, text)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- "the Final", "the Semifinals", "Round 2" — a round inside a sentence.
create or replace function public.playoff_round_in_sentence(p_playoff_id uuid, p_round text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case when t like 'Round %' then t else 'the ' || t end
    from (select public.playoff_round_title(p_playoff_id, p_round) as t) x
$$;

revoke execute on function public.playoff_round_in_sentence(uuid, text)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- A game's name for the log: "RR Game 13" (round robin — its numbers are the
-- ones people see), "Semifinals, game 2 of 3" (a series), "Round 1" (a single
-- elimination game; the teams in the same line say which).
create or replace function public.playoff_game_title(
  p_playoff_id  uuid,
  p_round       text,
  p_game_number integer,
  p_series_game integer
)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_len integer;
begin
  if p_round ~ '^RR' then
    return 'RR Game ' || p_game_number;
  end if;
  select max(g.series_game) into v_len
    from public.playoff_games g
   where g.playoff_id = p_playoff_id and g.round = p_round and g.game_number = p_game_number;
  if coalesce(v_len, 1) > 1 then
    return format('%s, game %s of %s', public.playoff_round_title(p_playoff_id, p_round), p_series_game, v_len);
  end if;
  return public.playoff_round_title(p_playoff_id, p_round);
end;
$$;

revoke execute on function public.playoff_game_title(uuid, text, integer, integer)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. replace_playoff_games — from 0113_two_stage_playoffs.sql; series payloads
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
  v_per_day     smallint;
  v_series      jsonb;
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

  -- 3b. Two-stage (0113): either half of a pair is rebuilt only by
  --     replace_two_stage_games, which writes both stages in one transaction.
  if v_po.stage = 2 or exists (select 1 from public.playoffs c where c.parent_playoff_id = v_po.id) then
    raise exception 'two_stage_pair' using errcode = 'P0001';
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
     or (p_settings ->> 'format') not in ('single_elimination', 'double_elimination', 'round_robin')
     -- 0113: the round robin's per-team daily limit, 1 or 2 (absent → 1).
     or coalesce(p_settings ->> 'games_per_team_per_day', '1') not in ('1', '2') then
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
    v_per_day   := coalesce((p_settings ->> 'games_per_team_per_day')::smallint, 1);
    -- 0114: each round's series length ({} = every round 1 game).
    v_series    := coalesce(p_settings -> 'series_by_round', '{}'::jsonb);
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
  -- 0114: one row per game number and game of its series (a single game is
  -- game 1 of 1); the series shape is playoff_check_series'.
  perform public.playoff_check_series(v_format, v_series, p_games);
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
     and g.status <> 'not_needed'
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
           games_per_team_per_day = v_per_day,
           series_by_round = v_series,
           updated_at = now()
     where id = v_po.id;

    delete from public.playoff_games where playoff_id = v_po.id;

    insert into public.playoff_games
      (playoff_id, league_id, division_id, round, game_number,
       home_team_id, away_team_id, venue_id, scheduled_date, start_time, status, series_game)
    select v_po.id, v_po.league_id, v_po.division_id,
           btrim(e ->> 'round'), (e ->> 'game_number')::integer,
           nullif(e ->> 'home_team_id', '')::uuid, nullif(e ->> 'away_team_id', '')::uuid,
           nullif(e ->> 'venue_id', '')::uuid,
           nullif(e ->> 'scheduled_date', '')::date, nullif(e ->> 'start_time', '')::time,
           'scheduled', coalesce((e ->> 'series_game')::smallint, 1)
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
-- 5. delete_playoff_bracket — from 0113_two_stage_playoffs.sql; not-needed games counted
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
  v_not_needed integer;
  v_format    text;
  v_message   text;
  v_root      uuid;
  v_ids       uuid[];
  v_pair      boolean;
begin
  if p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then its games. Two-stage (0113): deleting
  --    EITHER stage deletes both (decided 2026-10-19, D4) — the Stage 1 row is
  --    locked and deleted (Stage 2 cascades), then Stage 2, then all games.
  select coalesce(p.parent_playoff_id, p.id) into v_root from public.playoffs p where p.id = p_playoff_id;
  select * into v_po from public.playoffs where id = v_root for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoffs where parent_playoff_id = v_po.id for update;
  select array_agg(p.id order by p.stage) into v_ids
    from public.playoffs p where p.id = v_po.id or p.parent_playoff_id = v_po.id;
  v_pair := cardinality(v_ids) > 1;
  perform 1 from public.playoff_games where playoff_id = any (v_ids) for update;

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
                             or g.away_score is not null or g.winner_id is not null),
         -- 0114: games a decided series never needed (the confirm says so).
         count(*) filter (where g.status = 'not_needed')
    into v_games, v_dated, v_results, v_not_needed
    from public.playoff_games g
   where g.playoff_id = any (v_ids);

  -- On the public schedule right now — see the header; mirrors 0105.
  select count(*) into v_public
    from public.playoff_games g
    join public.divisions d on d.id = g.division_id
   where g.playoff_id = any (v_ids)
     and g.scheduled_date is not null
     and g.status <> 'not_needed'
     and d.locked
     and exists (select 1 from public.playoffs po where po.id = g.playoff_id and po.status <> 'draft')
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

    v_format := case when v_pair then 'round robin, then bracket' else case v_po.format
                  when 'single_elimination' then 'single elimination'
                  when 'double_elimination' then 'double elimination'
                  when 'round_robin' then 'round robin'
                  else v_po.format end end;
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
    'two_stage',          v_pair,
    'status',             v_po.status,
    'games',              v_games,
    'dated_games',        v_dated,
    'games_with_results', v_results,
    'not_needed_games',   v_not_needed,
    'public_games',       v_public
  );
end;
$$;

revoke execute on function public.delete_playoff_bracket(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.delete_playoff_bracket(uuid, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. enter_playoff_result — from 0113_two_stage_playoffs.sql; series, and the log names the round
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.enter_playoff_result(
  p_game_id    uuid,
  p_home_score integer,
  p_away_score integer
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
  v_div_name   text;
  v_winner     uuid;
  v_had_result boolean;
  v_target_id  uuid;
  v_field      text;
  v_slot       uuid;
  v_advanced   boolean := false;
  v_rows       integer;
  v_home_name  text;
  v_away_name  text;
  v_win_name   text;
  v_message    text;
  v_child      public.playoffs%rowtype;
  v_has_child  boolean := false;
  v_started    integer;
  v_prev       jsonb;
  -- 0114: series.
  v_len        integer := 1;
  v_k          integer;
  v_need       integer;
  v_before     uuid;
  v_after      uuid;
  v_t_id       uuid;
  v_t_field    text;
  v_t_round    text;
  v_t_number   integer;
  v_t_len      integer := 0;
  v_t_res      public.playoff_games%rowtype;
  v_series_mode boolean := false;
  v_blocker    integer;
  v_not_needed integer[] := '{}';
  v_restored   integer[] := '{}';
  v_moved      boolean := false;
begin
  if p_game_id is null or p_home_score is null or p_away_score is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'invalid_scores' using errcode = 'P0001';
  end if;
  if p_home_score = p_away_score then
    raise exception 'tied_score' using errcode = 'P0001';
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
  select p.plan into v_plan from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Format: single elimination and round robin only.
  if v_po.format is distinct from 'single_elimination' and v_po.format is distinct from 'round_robin' then
    raise exception 'format_not_supported' using errcode = 'P0001';
  end if;

  -- 4b. Two-stage (0113): a round-robin game whose Stage 2 already has a
  --     result can be neither changed nor cleared (decided 2026-10-19). Stage
  --     2's row and games are locked after this bracket's — Stage 1 first,
  --     every two-stage function's order.
  select * into v_child from public.playoffs where parent_playoff_id = v_po.id for update;
  v_has_child := found;
  if v_has_child then
    perform 1 from public.playoff_games where playoff_id = v_child.id for update;
    select min(g.game_number) into v_started
      from public.playoff_games g
     where g.playoff_id = v_child.id
       and (g.status = 'completed' or g.home_score is not null
            or g.away_score is not null or g.winner_id is not null);
    if v_started is not null then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_stage_started',
        'game_id', v_game.id, 'stage2_game_number', v_started);
    end if;
  end if;

  -- 5. The game: both teams, not cancelled.
  if v_game.home_team_id is null or v_game.away_team_id is null then
    raise exception 'teams_missing' using errcode = 'P0001';
  end if;
  if v_game.status = 'cancelled' then
    raise exception 'game_cancelled' using errcode = 'P0001';
  end if;

  v_winner := case when p_home_score > p_away_score then v_game.home_team_id else v_game.away_team_id end;
  v_had_result := v_game.status = 'completed' or v_game.home_score is not null
               or v_game.away_score is not null or v_game.winner_id is not null;

  -- 5b. Series (0114). Every game of a series is a row sharing the round and
  --     the game number; series_game is 1..length (a single game is 1 of 1).
  --     A game whose series is decided is not needed; results go in order
  --     (game k needs game k-1's result); only the LAST result in a series
  --     can be changed. The series winner — the team with length/2 + 1 wins —
  --     is what moves on.
  if v_game.status = 'not_needed' then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reason', 'game_not_needed',
      'game_id', v_game.id, 'series_game', v_game.series_game);
  end if;
  select max(g.series_game) into v_len from public.playoff_games g where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number;
  v_k := v_game.series_game;
  v_need := v_len / 2 + 1;
  if v_len > 1 then
    if v_had_result then
      select max(g.series_game) into v_blocker
        from public.playoff_games g
       where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.series_game > v_k and (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null);
      if v_blocker is not null then
        return jsonb_build_object(
          'committed', false, 'blocked', true, 'reason', 'series_later_result',
          'game_id', v_game.id, 'series_game', v_k, 'later_series_game', v_blocker);
      end if;
    elsif exists (select 1 from public.playoff_games g
                   where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.series_game = v_k - 1 and not (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null)) then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'series_order',
        'game_id', v_game.id, 'series_game', v_k, 'previous_series_game', v_k - 1);
    end if;
  end if;
  -- The series winner before and after this result.
  select s.w into v_before
    from (select g.winner_id as w, count(*) as c from public.playoff_games g
           where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.winner_id is not null group by g.winner_id) s
   where s.c >= v_need;
  select s.w into v_after
    from (select case when g.id = v_game.id then v_winner else g.winner_id end as w, count(*) as c
            from public.playoff_games g
           where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and (g.id = v_game.id or g.winner_id is not null)
           group by 1) s
   where s.c >= v_need;
  if v_before is not null and not v_had_result then
    -- The series is decided: this game isn't needed (even if its status says otherwise).
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reason', 'game_not_needed',
      'game_id', v_game.id, 'series_game', v_k);
  end if;
  -- Where the series winner goes. A series on either side of the move is
  -- handled by playoff_series_place (8b); two single games keep step 6/8.
  if v_po.format = 'single_elimination' then
    select t.target_id, t.target_field into v_t_id, v_t_field
      from public.playoff_single_elim_target(v_game.id) t;
    if v_t_id is not null then
      select g.round, g.game_number into v_t_round, v_t_number from public.playoff_games g where g.id = v_t_id;
      select max(g.series_game) into v_t_len from public.playoff_games g where g.playoff_id = v_po.id and g.round = v_t_round and g.game_number = v_t_number;
    end if;
    v_series_mode := v_len > 1 or coalesce(v_t_len, 0) > 1;
  end if;
  if v_series_mode and v_t_id is not null then
    select * into v_t_res from public.playoff_games g
     where g.playoff_id = v_po.id and g.round = v_t_round and g.game_number = v_t_number and (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null)
     order by g.series_game limit 1;
    if found then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_game_has_result',
        'game_id', v_game.id,
        'next_game', jsonb_build_object(
          'game_id', v_t_res.id, 'game_number', v_t_res.game_number, 'round', v_t_res.round,
          'series_game', v_t_res.series_game,
          'home_name', (select name from public.teams where id = v_t_res.home_team_id),
          'away_name', (select name from public.teams where id = v_t_res.away_team_id),
          'home_score', v_t_res.home_score, 'away_score', v_t_res.away_score));
    end if;
  end if;

  -- 6. Where the winner goes (single elimination). A next game with a result
  --    blocks the save; a slot holding a team this game did not put there is
  --    never overwritten.
  if v_po.format = 'single_elimination' and not v_series_mode then
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
      if v_slot is not null and v_slot <> v_winner
         and (v_game.winner_id is null or v_slot <> v_game.winner_id) then
        raise exception 'slot_occupied' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- 7. The result, conditional on what was read under the lock.
  update public.playoff_games
     set home_score = p_home_score,
         away_score = p_away_score,
         winner_id  = v_winner,
         status     = 'completed',
         updated_at = now()
   where id = v_game.id
     and status = v_game.status
     and home_team_id = v_game.home_team_id
     and away_team_id = v_game.away_team_id
     and home_score is not distinct from v_game.home_score
     and away_score is not distinct from v_game.away_score
     and winner_id  is not distinct from v_game.winner_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  -- 8. The advancement, conditional on the slot and on the next game still
  --    having no result.
  if v_target_id is not null and v_slot is distinct from v_winner then
    update public.playoff_games
       set home_team_id = case when v_field = 'home_team_id' then v_winner else home_team_id end,
           away_team_id = case when v_field = 'away_team_id' then v_winner else away_team_id end,
           updated_at   = now()
     where id = v_target_id
       and status <> 'completed'
       and home_score is null and away_score is null and winner_id is null
       and (case when v_field = 'home_team_id' then home_team_id else away_team_id end)
           is not distinct from v_slot;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;
    v_advanced := true;
  end if;

  -- 8b. Series (0114): the games after the deciding one become not needed; a
  --     result that un-decides the series brings them back; the series winner
  --     moves into the next round (every game of it, if it is a series).
  if v_len > 1 then
    if v_after is not null then
      with u as (
        update public.playoff_games g
           set status = 'not_needed', updated_at = now()
         where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.series_game > v_k and g.status <> 'not_needed'
           and g.status <> 'completed' and g.home_score is null and g.away_score is null and g.winner_id is null
        returning g.series_game)
      select coalesce(array_agg(u.series_game order by u.series_game), '{}') into v_not_needed from u;
    else
      with u as (
        update public.playoff_games g
           set status = 'scheduled', updated_at = now()
         where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.status = 'not_needed'
        returning g.series_game)
      select coalesce(array_agg(u.series_game order by u.series_game), '{}') into v_restored from u;
    end if;
  end if;
  if v_series_mode and v_t_id is not null and v_before is distinct from v_after then
    perform public.playoff_series_place(v_po, v_t_round, v_t_number, v_t_field, v_after, v_before);
    v_moved := v_after is not null;
  end if;

  -- 9. Log.
  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;
  select name into v_home_name from public.teams where id = v_game.home_team_id;
  select name into v_away_name from public.teams where id = v_game.away_team_id;
  select name into v_win_name from public.teams where id = v_winner;
  -- 0114: the log names the round (and the game of a series) and the teams,
  -- never a stored bracket position.
  v_message := format('%s playoffs: %s — %s %s, %s %s — %s won',
    coalesce(v_div_name, 'Division'), public.playoff_game_title(v_po.id, v_game.round, v_game.game_number, v_k),
    coalesce(v_home_name, 'Home'), p_home_score, coalesce(v_away_name, 'Away'), p_away_score,
    coalesce(v_win_name, 'the winner'));
  if v_had_result then
    v_message := v_message || format(' (result changed; was %s–%s)',
      coalesce(v_game.home_score::text, '?'), coalesce(v_game.away_score::text, '?'));
  end if;
  if v_advanced then
    v_message := v_message || format('; %s moved into %s',
      coalesce(v_win_name, 'the winner'), public.playoff_round_in_sentence(v_po.id, v_target.round));
  end if;
  if v_moved then
    v_message := v_message || format(case when v_len > 1 then '; %s won the series and moved into %s'
                                          else '; %s moved into %s' end,
      (select name from public.teams where id = v_after), public.playoff_round_in_sentence(v_po.id, v_t_round));
  elsif v_series_mode and v_before is not null and v_after is null then
    v_message := v_message || format('; the series is undecided again — %s removed from %s',
      (select name from public.teams where id = v_before), public.playoff_round_in_sentence(v_po.id, v_t_round));
  end if;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_po.league_id, v_po.division_id, 'playoff_result_entered', v_message);

  -- Two-stage (0113): a round-robin result entered or changed after Stage 2 was seeded
  -- flags Stage 2 so the admin re-checks the seeds. The seeds never move.
  if v_has_child and v_child.seeded_at is not null then
    -- One entry per game: an earlier entry's "was" is kept, "now" is this one.
    select e into v_prev from jsonb_array_elements(v_child.stage1_changes) e
     where (e ->> 'game_number')::integer = v_game.game_number limit 1;
    update public.playoffs
       set stage1_changed_at = now(),
           stage1_changes = coalesce((select jsonb_agg(e) from jsonb_array_elements(v_child.stage1_changes) e
                                       where (e ->> 'game_number')::integer <> v_game.game_number), '[]'::jsonb)
                            || jsonb_build_array(jsonb_build_object(
                                 'game_number', v_game.game_number,
                                 'home_team_id', v_game.home_team_id, 'away_team_id', v_game.away_team_id,
                                 'was_home', case when v_prev is null then to_jsonb(v_game.home_score) else v_prev -> 'was_home' end,
                                 'was_away', case when v_prev is null then to_jsonb(v_game.away_score) else v_prev -> 'was_away' end,
                                 'now_home', p_home_score, 'now_away', p_away_score)),
           updated_at = now()
     where id = v_child.id;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_stage1_changed_after_seeding',
            format('%s playoffs: RR Game %s result changed after Stage 2 was seeded — re-check the seeds',
                   coalesce(v_div_name, 'Division'), v_game.game_number));
  end if;

  return jsonb_build_object(
    'committed', true, 'blocked', false,
    'game_id', v_game.id, 'playoff_id', v_po.id,
    'winner_id', v_winner, 'was_edit', v_had_result,
    'stage2_recheck', v_has_child and v_child.seeded_at is not null,
    'advanced', case when v_target_id is not null then jsonb_build_object(
                  'game_id', v_target.id, 'game_number', v_target.game_number,
                  'round', v_target.round, 'field', v_field, 'team_id', v_winner)
                when v_moved then jsonb_build_object(
                  'game_id', v_t_id, 'game_number', v_t_number,
                  'round', v_t_round, 'field', v_t_field, 'team_id', v_after)
                else null end,
    -- 0114: the series this game is in.
    'series', jsonb_build_object(
                'length', v_len, 'series_game', v_k,
                'winner_id', v_after, 'was_winner_id', v_before,
                'not_needed', to_jsonb(v_not_needed), 'restored', to_jsonb(v_restored)));
end;
$$;

revoke execute on function public.enter_playoff_result(uuid, integer, integer)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.enter_playoff_result(uuid, integer, integer)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. clear_playoff_result — from 0113_two_stage_playoffs.sql; series, and the log names the round
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
  v_child      public.playoffs%rowtype;
  v_has_child  boolean := false;
  v_started    integer;
  v_prev       jsonb;
  -- 0114: series.
  v_len        integer := 1;
  v_k          integer;
  v_need       integer;
  v_before     uuid;
  v_after      uuid;
  v_t_id       uuid;
  v_t_field    text;
  v_t_round    text;
  v_t_number   integer;
  v_t_len      integer := 0;
  v_t_res      public.playoff_games%rowtype;
  v_t_first    public.playoff_games%rowtype;
  v_series_mode boolean := false;
  v_series_remove boolean := false;
  v_blocker    integer;
  v_restore    jsonb := '[]'::jsonb;
  v_n          integer;
  v_out_name   text;
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

  -- 4b. Two-stage (0113): a round-robin game whose Stage 2 already has a
  --     result can be neither changed nor cleared (decided 2026-10-19). Stage
  --     2's row and games are locked after this bracket's — Stage 1 first,
  --     every two-stage function's order.
  select * into v_child from public.playoffs where parent_playoff_id = v_po.id for update;
  v_has_child := found;
  if v_has_child then
    perform 1 from public.playoff_games where playoff_id = v_child.id for update;
    select min(g.game_number) into v_started
      from public.playoff_games g
     where g.playoff_id = v_child.id
       and (g.status = 'completed' or g.home_score is not null
            or g.away_score is not null or g.winner_id is not null);
    if v_started is not null then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_stage_started',
        'game_id', v_game.id, 'stage2_game_number', v_started);
    end if;
  end if;

  -- 5. There must be a result to clear.
  if not (v_game.status = 'completed' or v_game.home_score is not null
          or v_game.away_score is not null or v_game.winner_id is not null) then
    raise exception 'no_result' using errcode = 'P0001';
  end if;

  -- 5b. Series (0114): only the LAST result in a series can be cleared.
  --     Clearing the deciding game un-decides the series: its not-needed games
  --     are scheduled again and the winner leaves the next round.
  select max(g.series_game) into v_len from public.playoff_games g where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number;
  v_k := v_game.series_game;
  v_need := v_len / 2 + 1;
  if v_len > 1 then
    select max(g.series_game) into v_blocker
      from public.playoff_games g
     where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.series_game > v_k and (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null);
    if v_blocker is not null then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'series_later_result',
        'game_id', v_game.id, 'series_game', v_k, 'later_series_game', v_blocker);
    end if;
  end if;
  select s.w into v_before
    from (select g.winner_id as w, count(*) as c from public.playoff_games g
           where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.winner_id is not null group by g.winner_id) s
   where s.c >= v_need;
  select s.w into v_after
    from (select g.winner_id as w, count(*) as c from public.playoff_games g
           where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.winner_id is not null and g.id <> v_game.id group by g.winner_id) s
   where s.c >= v_need;
  if v_len > 1 and v_after is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'series_game', g.series_game, 'scheduled_date', g.scheduled_date,
             'venue_name', (select v.name from public.venues v where v.id = g.venue_id))
             order by g.series_game), '[]'::jsonb)
      into v_restore
      from public.playoff_games g
     where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.status = 'not_needed';
  end if;
  if v_po.format = 'single_elimination' then
    select t.target_id, t.target_field into v_t_id, v_t_field
      from public.playoff_single_elim_target(v_game.id) t;
    if v_t_id is not null then
      select g.round, g.game_number into v_t_round, v_t_number from public.playoff_games g where g.id = v_t_id;
      select max(g.series_game) into v_t_len from public.playoff_games g where g.playoff_id = v_po.id and g.round = v_t_round and g.game_number = v_t_number;
    end if;
    v_series_mode := v_len > 1 or coalesce(v_t_len, 0) > 1;
  end if;
  if v_series_mode and v_t_id is not null then
    select * into v_t_res from public.playoff_games g
     where g.playoff_id = v_po.id and g.round = v_t_round and g.game_number = v_t_number and (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null)
     order by g.series_game limit 1;
    if found then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_game_has_result',
        'game_id', v_game.id,
        'next_game', jsonb_build_object(
          'game_id', v_t_res.id, 'game_number', v_t_res.game_number, 'round', v_t_res.round,
          'series_game', v_t_res.series_game,
          'home_name', (select name from public.teams where id = v_t_res.home_team_id),
          'away_name', (select name from public.teams where id = v_t_res.away_team_id),
          'home_score', v_t_res.home_score, 'away_score', v_t_res.away_score));
    end if;
    if v_before is not null and v_after is null then
      -- Take the series winner back out of the next round, only if it is
      -- there. A stranger in this series' slot is never guessed about.
      select * into v_t_first from public.playoff_games g
       where g.playoff_id = v_po.id and g.round = v_t_round and g.game_number = v_t_number order by g.series_game, g.id limit 1;
      if exists (select 1 from public.playoff_games g
                  where g.playoff_id = v_po.id and g.round = v_t_round and g.game_number = v_t_number and (g.home_team_id = v_before or g.away_team_id = v_before)) then
        v_series_remove := true;
      elsif (case when v_t_field = 'home_team_id' then v_t_first.home_team_id else v_t_first.away_team_id end) is not null
            or (coalesce(v_t_len, 0) > 1 and v_t_first.home_team_id is not null and v_t_first.away_team_id is not null) then
        raise exception 'advancement_mismatch' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- 6. The game this one advanced its winner into (single elimination).
  if v_po.format = 'single_elimination' and not v_series_mode then
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
     and g.status <> 'not_needed'
     and d.locked
     and v_po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);

  -- 0114: the next round's series counts too when this clear removes a team from it.
  if v_series_remove and not coalesce(v_public, false) then
    select count(*) > 0 into v_public
      from public.playoff_games g
      join public.divisions d on d.id = g.division_id
     where g.playoff_id = v_po.id and g.round = v_t_round and g.game_number = v_t_number
       and g.scheduled_date is not null
       and g.status <> 'not_needed'
       and d.locked
       and v_po.status <> 'draft'
       and v_league.archived_at is null
       and v_tz is not null
       and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
       and exists (select 1 from public.public_schedule_links k
                    where k.org_id = v_league.owner_id and k.enabled);
  end if;

  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;
  select name into v_home_name from public.teams where id = v_game.home_team_id;
  select name into v_out_name from public.teams where id = v_before;
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

    -- 0114: series — the not-needed games come back, the winner leaves the
    -- next round.
    if v_len > 1 and v_after is null then
      update public.playoff_games g
         set status = 'scheduled', updated_at = now()
       where g.playoff_id = v_po.id and g.round = v_game.round and g.game_number = v_game.game_number and g.status = 'not_needed';
      get diagnostics v_n = row_count;
      if v_n <> jsonb_array_length(v_restore) then
        raise exception 'nothing_saved' using errcode = 'P0001';
      end if;
    end if;
    if v_series_remove then
      perform public.playoff_series_place(v_po, v_t_round, v_t_number, v_t_field, null, v_before);
    end if;

    -- 0114: the log names the round (and the game of a series) and the teams.
    v_message := format('%s playoffs: result cleared for %s — was %s %s, %s %s',
      coalesce(v_div_name, 'Division'), public.playoff_game_title(v_po.id, v_game.round, v_game.game_number, v_k),
      coalesce(v_home_name, 'Home'), coalesce(v_game.home_score::text, '?'),
      coalesce(v_away_name, 'Away'), coalesce(v_game.away_score::text, '?'));
    if v_win_name is not null then
      v_message := v_message || format(' (%s won)', v_win_name);
    end if;
    if v_remove then
      v_message := v_message || format('; %s removed from %s',
        coalesce(v_win_name, 'the winner'), public.playoff_round_in_sentence(v_po.id, v_target.round));
    end if;
    if v_series_remove then
      v_message := v_message || format('; the series is undecided again — %s removed from %s',
        coalesce(v_out_name, 'the winner'), public.playoff_round_in_sentence(v_po.id, v_t_round));
    end if;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_result_cleared', v_message);
  end if;

  -- Two-stage (0113): a round-robin result cleared after Stage 2 was seeded
  -- flags Stage 2 so the admin re-checks the seeds. The seeds never move.
  if p_commit and v_has_child and v_child.seeded_at is not null then
    -- One entry per game: an earlier entry's "was" is kept; "now" is cleared.
    select e into v_prev from jsonb_array_elements(v_child.stage1_changes) e
     where (e ->> 'game_number')::integer = v_game.game_number limit 1;
    update public.playoffs
       set stage1_changed_at = now(),
           stage1_changes = coalesce((select jsonb_agg(e) from jsonb_array_elements(v_child.stage1_changes) e
                                       where (e ->> 'game_number')::integer <> v_game.game_number), '[]'::jsonb)
                            || jsonb_build_array(jsonb_build_object(
                                 'game_number', v_game.game_number,
                                 'home_team_id', v_game.home_team_id, 'away_team_id', v_game.away_team_id,
                                 'was_home', case when v_prev is null then to_jsonb(v_game.home_score) else v_prev -> 'was_home' end,
                                 'was_away', case when v_prev is null then to_jsonb(v_game.away_score) else v_prev -> 'was_away' end,
                                 'now_home', null, 'now_away', null)),
           updated_at = now()
     where id = v_child.id;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_stage1_changed_after_seeding',
            format('%s playoffs: RR Game %s result cleared after Stage 2 was seeded — re-check the seeds',
                   coalesce(v_div_name, 'Division'), v_game.game_number));
  end if;

  return jsonb_build_object(
    'committed', p_commit, 'blocked', false,
    'game_id', v_game.id, 'playoff_id', v_po.id,
    'game_number', v_game.game_number, 'round', v_game.round,
    'home_name', v_home_name, 'away_name', v_away_name,
    'home_score', v_game.home_score, 'away_score', v_game.away_score,
    'winner_name', v_win_name,
    'stage2_recheck', p_commit and v_has_child and v_child.seeded_at is not null,
    'on_public_schedule', coalesce(v_public, false),
    'removed', case when v_remove then jsonb_build_object(
                 'game_id', v_target.id, 'game_number', v_target.game_number,
                 'round', v_target.round, 'field', v_field, 'team_name', v_win_name)
               when v_series_remove then jsonb_build_object(
                 'game_id', v_t_first.id, 'game_number', v_t_number,
                 'round', v_t_round, 'field', v_t_field, 'team_name', v_out_name)
               else null end,
    -- 0114: the series this game is in, and the games a clear brings back.
    'series', jsonb_build_object(
                'length', v_len, 'series_game', v_k,
                'winner_id', v_before, 'winner_after_id', v_after,
                'restored', v_restore));
end;
$$;

revoke execute on function public.clear_playoff_result(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.clear_playoff_result(uuid, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. get_league_schedule_by_token — from 0113_two_stage_playoffs.sql; not-needed games never leave
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
                     -- 0113: Stage 2 slots waiting for seeding say "Seed N".
                     'stage',          po.stage,
                     'seed_home',      pg.seed_home,
                     'seed_away',      pg.seed_away,
                     -- 0114: game k of a series, and the series' length (1 for a
                     -- single game). Until both teams are known the page names
                     -- no home team.
                     'series_game',    pg.series_game,
                     'series_length',  (select max(s.series_game) from public.playoff_games s
                                         where s.playoff_id = pg.playoff_id and s.round = pg.round
                                           and s.game_number = pg.game_number),
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
                   ) order by pg.scheduled_date nulls last, pg.start_time nulls last, pg.game_number, pg.series_game, pg.id), '[]'::jsonb)
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
               -- 0114: a game its series never needed is never shown.
               and pg.status <> 'not_needed'
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
-- 9. playoff_write_stage — from 0113_two_stage_playoffs.sql; series payloads (helper; no role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.playoff_write_stage(
  p_po         public.playoffs,
  p_owner      uuid,
  p_settings   jsonb,
  p_games      jsonb,
  p_team_count integer,
  p_write      boolean
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_format   text;
  v_seeding  jsonb;
  v_start    date;
  v_end      date;
  v_days     text[];
  v_windows  jsonb;
  v_venues   jsonb;
  v_per_day  smallint;
  v_series   jsonb;
  v_adv      integer;
  v_bad      integer;
  v_seeds    integer[];
  v_new      integer;
  v_inserted integer;
begin
  -- Validates one stage's settings and games and, with p_write, writes them.
  -- The checks re-state replace_playoff_games' (TWO WRITERS, PINNED — see the
  -- header) plus the stage's own: Stage 1 is a round robin whose games carry
  -- teams and no seeds; Stage 2 is single elimination whose games carry seeds
  -- (exactly 1…advance_count, once each) and no teams. Called with
  -- p_write = false for both stages before either is written.

  -- Settings.
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or jsonb_typeof(p_settings -> 'seeding') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'playing_days') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'day_windows') is distinct from 'object'
     or jsonb_typeof(p_settings -> 'venue_assignments') is distinct from 'array'
     or (p_settings ->> 'format') is distinct from
          (case when p_po.stage = 1 then 'round_robin' else 'single_elimination' end)
     or coalesce(p_settings ->> 'games_per_team_per_day', '1') not in ('1', '2') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  begin
    v_format  := p_settings ->> 'format';
    v_seeding := p_settings -> 'seeding';
    v_start   := nullif(p_settings ->> 'start_date', '')::date;
    v_end     := nullif(p_settings ->> 'end_date', '')::date;
    v_days    := array(select jsonb_array_elements_text(p_settings -> 'playing_days'));
    v_windows := p_settings -> 'day_windows';
    v_venues  := p_settings -> 'venue_assignments';
    v_per_day := coalesce((p_settings ->> 'games_per_team_per_day')::smallint, 1);
    v_series  := coalesce(p_settings -> 'series_by_round', '{}'::jsonb);
    v_adv     := nullif(p_settings ->> 'advance_count', '')::integer;
  exception when others then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end;
  if p_po.stage = 2 and (v_adv is null or v_adv < 2 or v_adv > coalesce(p_team_count, 0)
                         or jsonb_array_length(v_seeding) <> 0) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  if p_po.stage = 1 then
    -- Stage 1's seeding is the teams IN, each a team of this season, once.
    begin
      select count(*) into v_bad
        from jsonb_array_elements(v_seeding) e
       where jsonb_typeof(e) <> 'object'
          or not exists (select 1 from public.teams tm
                          where tm.id = (e ->> 'team_id')::uuid and tm.league_id = p_po.league_id);
    exception when others then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end;
    if v_bad > 0 then
      raise exception 'team_not_in_season' using errcode = 'P0001';
    end if;
    if jsonb_array_length(v_seeding) < 2
       or (select count(distinct e ->> 'team_id') from jsonb_array_elements(v_seeding) e)
          <> jsonb_array_length(v_seeding) then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end if;
  end if;

  -- Games: replace_playoff_games' checks.
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
  -- 0114: one row per game number and game of its series (a single game is
  -- game 1 of 1); the series shape is playoff_check_series'.
  perform public.playoff_check_series(v_format, v_series, p_games);
  begin
    select count(*) into v_bad
      from jsonb_array_elements(p_games) e,
           lateral (values (nullif(e ->> 'home_team_id', '')::uuid), (nullif(e ->> 'away_team_id', '')::uuid)) t(team_id)
     where t.team_id is not null
       and not exists (select 1 from public.teams tm where tm.id = t.team_id and tm.league_id = p_po.league_id);
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
                        where v.id = (e ->> 'venue_id')::uuid and v.owner_id = p_owner);
  exception when invalid_text_representation then
    raise exception 'invalid_games' using errcode = 'P0001';
  end;
  if v_bad > 0 then
    raise exception 'venue_not_in_org' using errcode = 'P0001';
  end if;

  -- The stage's own shape.
  if p_po.stage = 1 then
    if exists (select 1 from jsonb_array_elements(p_games) e
                where nullif(e ->> 'seed_home', '') is not null or nullif(e ->> 'seed_away', '') is not null) then
      raise exception 'invalid_games' using errcode = 'P0001';
    end if;
  else
    if exists (select 1 from jsonb_array_elements(p_games) e
                where nullif(e ->> 'home_team_id', '') is not null or nullif(e ->> 'away_team_id', '') is not null) then
      raise exception 'invalid_games' using errcode = 'P0001';
    end if;
    begin
      -- 0114: a seed sits in every game of its series, so each seed number
      -- appears once per series — and in ONE series only.
      select coalesce(array_agg(distinct s.seed order by s.seed), array[]::integer[]) into v_seeds
        from jsonb_array_elements(p_games) e,
             lateral (values (nullif(e ->> 'seed_home', '')::integer), (nullif(e ->> 'seed_away', '')::integer)) s(seed)
       where s.seed is not null;
      select count(*) into v_bad
        from (select s.seed
                from jsonb_array_elements(p_games) e,
                     lateral (values (nullif(e ->> 'seed_home', '')::integer), (nullif(e ->> 'seed_away', '')::integer)) s(seed)
               where s.seed is not null
               group by s.seed
              having count(distinct (e ->> 'game_number')) > 1
                  or count(*) <> count(distinct coalesce(e ->> 'series_game', '1'))) x;
    exception when others then
      raise exception 'invalid_games' using errcode = 'P0001';
    end;
    if v_seeds is distinct from array(select generate_series(1, v_adv)) or v_bad > 0 then
      raise exception 'invalid_games' using errcode = 'P0001';
    end if;
  end if;

  if not p_write then
    return;
  end if;

  -- The write: settings, games, status — inside the caller's transaction.
  update public.playoffs
     set format = v_format,
         seeding = v_seeding,
         start_date = v_start,
         end_date = v_end,
         playing_days = v_days,
         day_windows = v_windows,
         venue_assignments = v_venues,
         cross_division_enabled = false,
         cross_division_opponent_id = null,
         games_per_team_per_day = v_per_day,
         advance_count = case when p_po.stage = 2 then v_adv else null end,
         series_by_round = v_series,
         updated_at = now()
   where id = p_po.id;

  delete from public.playoff_games where playoff_id = p_po.id;

  insert into public.playoff_games
    (playoff_id, league_id, division_id, round, game_number,
     home_team_id, away_team_id, seed_home, seed_away, venue_id, scheduled_date, start_time, status, series_game)
  select p_po.id, p_po.league_id, p_po.division_id,
         btrim(e ->> 'round'), (e ->> 'game_number')::integer,
         nullif(e ->> 'home_team_id', '')::uuid, nullif(e ->> 'away_team_id', '')::uuid,
         nullif(e ->> 'seed_home', '')::smallint, nullif(e ->> 'seed_away', '')::smallint,
         nullif(e ->> 'venue_id', '')::uuid,
         nullif(e ->> 'scheduled_date', '')::date, nullif(e ->> 'start_time', '')::time,
         'scheduled', coalesce((e ->> 'series_game')::smallint, 1)
    from jsonb_array_elements(p_games) e;

  v_new := jsonb_array_length(p_games);
  select count(*) into v_inserted from public.playoff_games where playoff_id = p_po.id;
  if v_inserted <> v_new then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  update public.playoffs set status = 'active', updated_at = now() where id = p_po.id;
end;
$$;

revoke execute on function public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. replace_two_stage_games — from 0113_two_stage_playoffs.sql; public counts skip not-needed games
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.replace_two_stage_games(
  p_stage1_id  uuid,
  p_settings1  jsonb,
  p_games1     jsonb,
  p_stage2_id  uuid,
  p_settings2  jsonb,
  p_games2     jsonb,
  p_commit     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s1         public.playoffs%rowtype;
  v_s2         public.playoffs%rowtype;
  v_league     public.leagues%rowtype;
  v_plan       text;
  v_tz         text;
  v_div_name   text;
  v_rebuild1   boolean;
  v_keep_seeds boolean;
  v_r1         integer;
  v_r2         integer;
  v_first2     integer;
  v_g1         integer;
  v_g2         integer;
  v_new1       integer;
  v_new2       integer;
  v_dated_new  integer;
  v_teams      integer;
  v_end1       date;
  v_start2     date;
  v_public_now integer;
  v_public_ok  boolean;
  v_order      uuid[];
  v_event      text;
  v_message    text;
begin
  if p_commit is null or p_stage1_id is null or p_stage2_id is null
     or p_settings2 is null or p_games2 is null
     or ((p_settings1 is null) <> (p_games1 is null)) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  -- No Stage 1 payload = rebuild Stage 2 only (its dates and fields), keeping
  -- Stage 1's games and results (decided 2026-10-19, D5).
  v_rebuild1 := p_settings1 is not null;

  -- 1. Lock Stage 1, Stage 2, then their games; they must be one pair.
  select * into v_s1 from public.playoffs where id = p_stage1_id for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  select * into v_s2 from public.playoffs where id = p_stage2_id for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if v_s1.stage <> 1 or v_s2.stage <> 2 or v_s2.parent_playoff_id is distinct from v_s1.id
     or v_s2.league_id <> v_s1.league_id or v_s2.division_id <> v_s1.division_id then
    raise exception 'not_a_pair' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_s1.id for update;
  perform 1 from public.playoff_games where playoff_id = v_s2.id for update;

  -- 2. Membership.
  select * into v_league from public.leagues where id = v_s1.league_id;
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

  -- 4. Results. Stage 2 with a result: nothing is rebuilt. Stage 1 with a
  --    result: only a Stage-2-only rebuild is allowed.
  select count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null),
         count(*)
    into v_r1, v_g1
    from public.playoff_games g where g.playoff_id = v_s1.id;
  select count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null),
         min(g.game_number) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null),
         count(*)
    into v_r2, v_first2, v_g2
    from public.playoff_games g where g.playoff_id = v_s2.id;
  select d.name into v_div_name from public.divisions d where d.id = v_s1.division_id;
  if v_r2 > 0 then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reasons', jsonb_build_array('stage2_started'),
      'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
      'stage2_game_number', v_first2);
  end if;
  if v_rebuild1 and v_r1 > 0 then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reasons', jsonb_build_array('results_entered'),
      'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
      'games_with_results', v_r1);
  end if;

  -- 5. Validate BOTH stages before writing either.
  if v_rebuild1 then
    perform public.playoff_write_stage(v_s1, v_league.owner_id, p_settings1, p_games1, null, false);
    v_teams := jsonb_array_length(p_settings1 -> 'seeding');
    v_end1 := nullif(p_settings1 ->> 'end_date', '')::date;
  else
    v_teams := jsonb_array_length(v_s1.seeding);
    v_end1 := v_s1.end_date;
  end if;
  perform public.playoff_write_stage(v_s2, v_league.owner_id, p_settings2, p_games2, v_teams, false);
  v_start2 := nullif(p_settings2 ->> 'start_date', '')::date;
  if v_end1 is not null and v_start2 is not null and v_start2 <= v_end1 then
    raise exception 'stage_order' using errcode = 'P0001';
  end if;
  -- A Stage-2-only rebuild of a seeded bracket keeps its seeds.
  v_keep_seeds := not v_rebuild1 and v_s2.seeded_at is not null;

  v_new1 := case when v_rebuild1 then jsonb_array_length(p_games1) else v_g1 end;
  v_new2 := jsonb_array_length(p_games2);
  select count(*) into v_dated_new
    from jsonb_array_elements(coalesce(p_games1, '[]'::jsonb) || p_games2) e
   where nullif(e ->> 'scheduled_date', '') is not null;
  if not v_rebuild1 then
    v_dated_new := v_dated_new + (select count(*) from public.playoff_games g
                                   where g.playoff_id = v_s1.id and g.scheduled_date is not null);
  end if;

  -- On the public schedule — mirrors the 0105 reader, as 0107 does, for both
  -- stages: now (by each stage's status) and after (both active).
  select count(*) into v_public_now
    from public.playoff_games g
    join public.playoffs po on po.id = g.playoff_id
    join public.divisions d on d.id = g.division_id
   where g.playoff_id in (v_s1.id, v_s2.id)
     and g.scheduled_date is not null
     and g.status <> 'not_needed'
     and d.locked
     and po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);
  v_public_ok := v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.divisions d where d.id = v_s1.division_id and d.locked)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);

  if not p_commit then
    return jsonb_build_object(
      'committed', false, 'blocked', false, 'reasons', '[]'::jsonb,
      'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
      'rebuild_stage1', v_rebuild1, 'keeps_seeds', v_keep_seeds,
      'stage1_games', v_g1, 'stage2_games', v_g2,
      'new_stage1_games', v_new1, 'new_stage2_games', v_new2,
      'public_games', v_public_now,
      'public_games_after', case when v_public_ok then v_dated_new else 0 end);
  end if;

  -- 6. The write — one transaction.
  if v_rebuild1 then
    perform public.playoff_write_stage(v_s1, v_league.owner_id, p_settings1, p_games1, null, true);
  end if;
  perform public.playoff_write_stage(v_s2, v_league.owner_id, p_settings2, p_games2, v_teams, true);
  update public.playoffs
     set seeding           = case when v_keep_seeds then v_s2.seeding else '[]'::jsonb end,
         seeded_at         = case when v_keep_seeds then v_s2.seeded_at else null end,
         seeded_by         = case when v_keep_seeds then v_s2.seeded_by else null end,
         stage1_changed_at = case when v_keep_seeds then v_s2.stage1_changed_at else null end,
         stage1_changes    = case when v_keep_seeds then v_s2.stage1_changes else '[]'::jsonb end,
         updated_at        = now()
   where id = v_s2.id;
  if v_keep_seeds then
    select array_agg((e.value ->> 'team_id')::uuid order by e.ordinality) into v_order
      from jsonb_array_elements(v_s2.seeding) with ordinality e;
    perform public.playoff_apply_seeds(v_s2.id, v_order);
  end if;

  if v_rebuild1 then
    v_event := case when v_g1 = 0 and v_g2 = 0 then 'playoff_two_stage_generated' else 'playoff_two_stage_rebuilt' end;
    v_message := format('%s playoffs (round robin, then bracket) %s: %s round-robin %s, %s bracket %s',
      coalesce(v_div_name, 'Division'),
      case when v_event = 'playoff_two_stage_generated' then 'generated' else 'rebuilt' end,
      v_new1, case when v_new1 = 1 then 'game' else 'games' end,
      v_new2, case when v_new2 = 1 then 'game' else 'games' end);
  else
    v_event := 'playoff_stage2_rebuilt';
    v_message := format('%s playoffs: Stage 2 rebuilt (%s bracket %s)%s',
      coalesce(v_div_name, 'Division'), v_new2, case when v_new2 = 1 then 'game' else 'games' end,
      case when v_keep_seeds then '; seeds kept' else '' end);
  end if;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_s1.league_id, v_s1.division_id, v_event, v_message);

  return jsonb_build_object(
    'committed', true, 'blocked', false, 'reasons', '[]'::jsonb,
    'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
    'rebuild_stage1', v_rebuild1, 'keeps_seeds', v_keep_seeds,
    'stage1_games', v_g1, 'stage2_games', v_g2,
    'new_stage1_games', v_new1, 'new_stage2_games', v_new2,
    'public_games', v_public_now,
    'public_games_after', case when v_public_ok then v_dated_new else 0 end);
end;
$$;

revoke execute on function public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Verify — RAISES if anything is not exactly as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_role  text;
  r       record;
begin
  for r in
    select * from (values
      ('public.season_last_day(uuid)',                                                       '', false),
      ('public.playoff_check_series(text, jsonb, jsonb)',                                    '', false),
      ('public.playoff_series_place(public.playoffs, text, integer, text, uuid, uuid)',       '', false),
      ('public.playoff_round_title(uuid, text)',                                             '', false),
      ('public.playoff_round_in_sentence(uuid, text)',                                       '', false),
      ('public.playoff_game_title(uuid, text, integer, integer)',                            '', false),
      ('public.replace_playoff_games(uuid, jsonb, jsonb, boolean)',                          'authenticated', true),
      ('public.delete_playoff_bracket(uuid, boolean)',                                       'authenticated', true),
      ('public.enter_playoff_result(uuid, integer, integer)',                                'authenticated', true),
      ('public.clear_playoff_result(uuid, boolean)',                                         'authenticated', true),
      ('public.get_league_schedule_by_token(text)',                                          'anon,authenticated', true),
      ('public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)',  '', false),
      ('public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)',    'authenticated', true)
    ) as t(fn, allowed, definer)
  loop
    foreach v_role in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']
    loop
      if has_function_privilege(v_role, r.fn, 'EXECUTE')
         <> (v_role = any (string_to_array(r.allowed, ','))) then
        v_wrong := v_wrong || format(' [%s EXECUTE on %s is %s]', v_role, r.fn,
                                     has_function_privilege(v_role, r.fn, 'EXECUTE'));
      end if;
    end loop;
    if (select prosecdef from pg_proc where oid = r.fn::regprocedure) <> r.definer then
      v_wrong := v_wrong || format(' [%s SECURITY DEFINER should be %s]', r.fn, r.definer);
    end if;
  end loop;

  if exists (select 1 from public.playoff_games where series_game <> 1 or status = 'not_needed') then
    v_wrong := v_wrong || ' [an existing game is not a single game]';
  end if;
  if exists (select 1 from public.playoffs where series_by_round <> '{}'::jsonb) then
    v_wrong := v_wrong || ' [an existing bracket has series]';
  end if;

  if v_wrong <> '' then
    raise exception '0114 verification failed:%', v_wrong;
  end if;
end;
$$;
