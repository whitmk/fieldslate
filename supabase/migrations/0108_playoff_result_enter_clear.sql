-- 0108: enter and clear a playoff result in the database, one rule for both.
--
-- Two SECURITY DEFINER functions, EXECUTE for `authenticated` only:
--
--   enter_playoff_result(p_game_id, p_home_score, p_away_score)
--   clear_playoff_result(p_game_id, p_commit)   -- its own preview (0084 pattern)
--
-- and two internal helpers nobody may call directly (no EXECUTE granted to any
-- role; the functions above run as their owner and reach them that way):
--
--   playoff_round_order(round)          -- mirror of getRoundOrder
--   playoff_single_elim_target(game_id) -- mirror of computeSingleElimAdvancement
--
-- WHY. A bracket with a result cannot be rebuilt (0107), and both that refusal
-- and the Edit-result refusal told the admin to "clear that result first" —
-- with no way to do it. And result ENTRY was two separate browser writes (the
-- result, then the winner into the next game) under RLS: not atomic, neither
-- write checked how many rows it changed (a refused write read as saved), no
-- server-side Elite check, nothing in the activity log. Entering and clearing
-- now share ONE advancement rule, in ONE transaction each.
--
-- DECISIONS (2026-10-13, the founder's):
--   1. Single elimination and round robin go through these functions.
--      DOUBLE ELIMINATION IS REFUSED by both (`format_not_supported`): its
--      result entry stays on the existing browser path, untouched — an
--      untested format is not regressed — and clearing is not offered for it
--      (the sentence points to deleting the bracket, which 0107 allows even
--      with results).
--   2. Clearing is allowed in a LOCKED division, as delete/rebuild are (0107):
--      playoff_games was never under the 0082 trigger. `posted` cannot be
--      touched — its trigger (0096) is on `games` only.
--   3. Membership + Elite, checked HERE (the page is also server-gated).
--   4. Every write logs in the same transaction: `playoff_result_entered`,
--      `playoff_result_cleared`.
--
-- THE ADVANCEMENT RULE (single elimination only; round robin advances
-- nothing). playoff_single_elim_target is a statement-for-statement port of
-- computeSingleElimAdvancement + singleElimPosition (src/lib/playoffs/
-- advancement.ts): rounds ordered by playoff_round_order, bracket size =
-- 2^(number of rounds), position = game_number − first number of its round
-- (the row's index in its round when that is out of range — legacy
-- brackets), target = next round's game numbered first(next) + ⌊pos/2⌋ (the
-- row at index ⌊pos/2⌋ when no such number), slot = home when pos is even.
-- THE TWO MUST AGREE: both harnesses run the SAME table of expected targets
-- for 4-, 6- (byes) and 8-team brackets — the block between the
-- XC-TABLE-BEGIN / XC-TABLE-END markers in
-- scripts/sim/playoff-result-sim.sql. Change one rule, change both.
--
-- BYES. A bye team is written into its round-2 seat when the bracket is
-- generated and nothing on the row marks it. It never needs to: a round-1
-- game only ever writes the slot its own position names, and the bye sits in
-- the OTHER slot of that game. Both functions go further and never overwrite
-- or remove a team this game did not put there:
--   * enter writes the slot only when it is empty, already holds the new
--     winner, or holds THIS game's previous winner (an edit); anything else
--     is `slot_occupied`, nothing written;
--   * clear removes a team from the next game only when the slot holds THIS
--     game's winner; a slot holding any other team is `advancement_mismatch`,
--     nothing written.
--
-- A RESULT means any of: status 'completed', a home or away score, a winner
-- (0107's definition). A game whose NEXT game has a result can be neither
-- edited nor cleared: the reply is `blocked` / `next_game_has_result` and
-- names that game, so the admin clears it first (latest round first). There
-- is no cascade.
--
-- CLEARING returns the game to status 'scheduled' with no scores and no
-- winner. Every playoff game is created 'scheduled' and nothing writes another
-- status before a result, so that is the status it had.
--
-- EVERY WRITE IS CONDITIONAL AND COUNTED. Each UPDATE's WHERE repeats the
-- values read under the row locks; each must change exactly one row or the
-- call raises `nothing_saved` and the whole transaction rolls back. The reply
-- echoes the game id; the app reports success only on a committed reply for
-- the game it asked about.
--
-- "ON THE PUBLIC SCHEDULE" (clear's preview) mirrors get_league_schedule_by_
-- token (0105) for the cleared game and the game a team is removed from — the
-- same conditions 0107 copies. If the reader's conditions change, change
-- 0107's two copies and this one with it.
--
-- GATE: is_org_member. Every org member is an admin today; if a non-admin
-- role is ever added this must be restricted with every other
-- is_org_member-gated write (CLAUDE.md).
--
-- LOCKS: row locks on the one playoffs row and its playoff_games rows, in that
-- order (0107's order). No table locks.

create or replace function public.playoff_round_order(p_round text)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_m text[];
begin
  -- Mirror of getRoundOrder (advancement.ts): the double-elimination labels
  -- first, then R<n> / RR<n> / SF / F.
  case p_round
    when 'WB-R1' then return 10; when 'WB-R2' then return 11;
    when 'WB-R3' then return 12; when 'WB-R4' then return 13;
    when 'WB-F'  then return 20;
    when 'LB-R1' then return 30; when 'LB-R2' then return 31;
    when 'LB-R3' then return 32; when 'LB-R4' then return 33;
    when 'LB-R5' then return 34; when 'LB-R6' then return 35;
    when 'LB-R7' then return 36; when 'LB-R8' then return 37;
    when 'LB-F'  then return 40;
    when 'GF'    then return 50; when 'GF-R' then return 51;
    else null;
  end case;
  v_m := regexp_match(p_round, '^(RR|R|SF|F)(\d*)');
  if v_m is null then
    return 99;
  end if;
  if v_m[1] = 'F' then
    return 50;
  end if;
  if v_m[1] = 'SF' then
    return 40;
  end if;
  return coalesce(nullif(v_m[2], '')::integer, 0);
end;
$$;

create or replace function public.playoff_single_elim_target(p_game_id uuid)
returns table (target_id uuid, target_field text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_game     public.playoff_games%rowtype;
  v_rounds   text[];
  v_n        integer;
  v_idx      integer;
  v_size     integer;
  v_pos      integer;
  v_tpos     integer;
  v_tnumber  integer;
  v_target   uuid;
begin
  select * into v_game from public.playoff_games where id = p_game_id;
  if not found then
    return;
  end if;

  -- The bracket's rounds in order (groupRounds + sort(byOrder)).
  select array_agg(r.round order by public.playoff_round_order(r.round), r.round)
    into v_rounds
    from (select distinct g.round from public.playoff_games g where g.playoff_id = v_game.playoff_id) r;
  v_n := coalesce(array_length(v_rounds, 1), 0);
  v_idx := array_position(v_rounds, v_game.round) - 1;

  -- The championship (or an unknown round) advances nothing.
  if v_idx is null or v_idx = v_n - 1 then
    return;
  end if;

  -- Every round after the first is complete, so the round count fixes the
  -- bracket size even when round 1 is short because of byes.
  v_size := 1 << v_n;

  -- singleElimPosition: positional numbering first, the row's index in its
  -- round as the fallback for legacy brackets.
  v_pos := v_game.game_number - (1 + v_size - (v_size >> v_idx));
  if not (v_pos >= 0 and v_pos < (v_size >> (v_idx + 1))) then
    select s.rn - 1 into v_pos
      from (select g.id, row_number() over (order by g.game_number, g.id) as rn
              from public.playoff_games g
             where g.playoff_id = v_game.playoff_id and g.round = v_game.round) s
     where s.id = v_game.id;
  end if;
  if v_pos is null or v_pos < 0 then
    return;
  end if;

  v_tpos := v_pos / 2;
  v_tnumber := (1 + v_size - (v_size >> (v_idx + 1))) + v_tpos;

  select g.id into v_target
    from public.playoff_games g
   where g.playoff_id = v_game.playoff_id
     and g.round = v_rounds[v_idx + 2]
     and g.game_number = v_tnumber
   order by g.id
   limit 1;
  if v_target is null then
    select s.id into v_target
      from (select g.id, row_number() over (order by g.game_number, g.id) as rn
              from public.playoff_games g
             where g.playoff_id = v_game.playoff_id and g.round = v_rounds[v_idx + 2]) s
     where s.rn - 1 = v_tpos;
  end if;
  if v_target is null then
    return;
  end if;

  target_id := v_target;
  target_field := case when v_pos % 2 = 0 then 'home_team_id' else 'away_team_id' end;
  return next;
end;
$$;

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

  -- 6. Where the winner goes (single elimination). A next game with a result
  --    blocks the save; a slot holding a team this game did not put there is
  --    never overwritten.
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

  -- 9. Log.
  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;
  select name into v_home_name from public.teams where id = v_game.home_team_id;
  select name into v_away_name from public.teams where id = v_game.away_team_id;
  select name into v_win_name from public.teams where id = v_winner;
  v_message := format('%s playoffs: Game %s (%s) %s %s, %s %s — %s won',
    coalesce(v_div_name, 'Division'), v_game.game_number, v_game.round,
    coalesce(v_home_name, 'Home'), p_home_score, coalesce(v_away_name, 'Away'), p_away_score,
    coalesce(v_win_name, 'the winner'));
  if v_had_result then
    v_message := v_message || format(' (result changed; was %s–%s)',
      coalesce(v_game.home_score::text, '?'), coalesce(v_game.away_score::text, '?'));
  end if;
  if v_advanced then
    v_message := v_message || format('; %s moved into Game %s (%s)',
      coalesce(v_win_name, 'the winner'), v_target.game_number, v_target.round);
  end if;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_po.league_id, v_po.division_id, 'playoff_result_entered', v_message);

  return jsonb_build_object(
    'committed', true, 'blocked', false,
    'game_id', v_game.id, 'playoff_id', v_po.id,
    'winner_id', v_winner, 'was_edit', v_had_result,
    'advanced', case when v_target_id is not null then jsonb_build_object(
                  'game_id', v_target.id, 'game_number', v_target.game_number,
                  'round', v_target.round, 'field', v_field, 'team_id', v_winner)
                else null end);
end;
$$;

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
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= v_league.end_date + 7)
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

-- Revoke from PUBLIC and from each role (a role-level revoke alone is a silent
-- no-op while PUBLIC holds it). The two entry points are granted back to
-- authenticated; the helpers to nobody.
revoke execute on function public.playoff_round_order(text)
  from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.playoff_single_elim_target(uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.enter_playoff_result(uuid, integer, integer)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.enter_playoff_result(uuid, integer, integer)
  to authenticated;
revoke execute on function public.clear_playoff_result(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.clear_playoff_result(uuid, boolean)
  to authenticated;

-- Refuse to finish with a wrong privilege: the no-op form leaves no error.
do $check$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.enter_playoff_result(uuid, integer, integer)',
                              'public.clear_playoff_result(uuid, boolean)'] loop
    if not has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or has_function_privilege('dashboard_readonly', v_fn, 'execute') then
      raise exception '0108: % privileges are wrong', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.playoff_round_order(text)',
                              'public.playoff_single_elim_target(uuid)'] loop
    if has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or has_function_privilege('dashboard_readonly', v_fn, 'execute') then
      raise exception '0108: % must not be callable by any role', v_fn;
    end if;
  end loop;
end;
$check$;
