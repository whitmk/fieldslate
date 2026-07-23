-- Schedule lock ENFORCEMENT (chunk 3). This is the migration where `locked`
-- stops being an inert column. Two triggers on public.games plus a
-- transaction-local bypass GUC, and the two container-destroying RPCs
-- re-created to set it.
--
-- ── Why a trigger and not client checks ─────────────────────────────────────
-- RLS (0049) grants org members full INSERT/UPDATE/DELETE on games, and every
-- destructive schedule path except delete_game_if_unblocked is a DIRECT
-- client-side write from the browser. A check in React, or in a Next.js route
-- that uses the user's own RLS client, stops the UI and nothing else — the
-- same write is available straight from PostgREST. A trigger is the only
-- place a per-division lock is actually true. Client-side lock checks (later
-- chunk) exist to produce a good ERROR MESSAGE, never as the guard.
--
-- ── Deriving the division ───────────────────────────────────────────────────
-- games has NO division_id. Division is derived home_team_id -> teams.division_id.
-- Verified against live data 2026-07-23: zero games whose home team lacks a
-- division, zero cross-division games.
--
-- A NULL division_id is ALLOWED, deliberately, and this is NOT a fail-open
-- mistake: a lock is per-division, so a game belonging to no division cannot
-- belong to a locked one. Failing closed there would make orphan rows
-- PERMANENTLY IMMUTABLE with no UI able to fix them — strictly worse than the
-- state it would be guarding. Known accepted limit: nulling a team's
-- division_id escapes the lock. That write is available under RLS, but it
-- orphans the team and visibly breaks the schedule panel, so it is not a
-- quiet bypass. The lock guards accidents, not attackers.
--
-- ── Trigger name ordering is load-bearing ───────────────────────────────────
-- Postgres fires same-timing row triggers in NAME order. 'enforce_division_lock'
-- sorts before 'set_games_updated_at', so NEW.updated_at still equals
-- OLD.updated_at when the column check runs. updated_at is in the allowlist
-- anyway (belt and braces) — do not rename either trigger past the other and
-- assume the other half still covers it.
--
-- ── The column allowlist is SUBTRACTION-based, on purpose ───────────────────
--   to_jsonb(OLD) - allowlist  IS DISTINCT FROM  to_jsonb(NEW) - allowlist
-- NOT an enumerated blocklist. A column added to games next year is then
-- blocked-when-locked BY DEFAULT, which is the safe direction. An enumerated
-- blocklist silently permits every future column — that is exactly the class
-- of bug this feature exists to prevent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The bypass GUC
--
-- 'fieldslate.lock_bypass' = 'on', set with set_config(..., true) so it is
-- TRANSACTION-LOCAL and cannot leak across statements on a pooled connection.
--
-- THE RULE, and it is not negotiable without a design review: a bypass belongs
-- ONLY in a SECURITY DEFINER function whose entire purpose is destroying the
-- container the lock lives in. Exactly two functions qualify —
-- delete_league_permanently (the season) and delete_division_permanently (the
-- division). Locking a division must not make it undeletable; that would trade
-- one trap for a worse one.
--
-- Explicitly NOT eligible:
--   * delete_game_if_unblocked — gets a real division_locked CHECK (0083),
--     never a bypass. It deletes a game, not the container.
--   * every interleague RPC (5 of them are granted to anon) — they need no
--     bypass at all. Partner accept only UPDATEs allowlisted columns, and
--     partner decline only DELETEs pending_interleague rows, which the
--     carve-out below already permits.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enforcement trigger
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_division_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Columns a locked division still permits changing: the rainout and
  -- reschedule surface, nothing more. Anything else -> blocked.
  v_allow text[] := array[
    'status',
    'scheduled_at',
    'venue_id',
    'proposed_scheduled_at',
    'proposed_venue_name',
    'external_team_name',
    'updated_at'
  ];
  v_old_div uuid;
  v_new_div uuid;
  v_locked_name text;
begin
  if coalesce(current_setting('fieldslate.lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Check BOTH sides on UPDATE: if home_team_id moved between divisions, a
  -- lock on either end must apply. (That move is outside the allowlist and so
  -- is blocked regardless, but the division must be resolved to say WHICH
  -- division refused.)
  if tg_op <> 'INSERT' then
    select t.division_id into v_old_div from public.teams t where t.id = old.home_team_id;
  end if;
  if tg_op <> 'DELETE' then
    select t.division_id into v_new_div from public.teams t where t.id = new.home_team_id;
  end if;

  select d.name into v_locked_name
  from public.divisions d
  where d.id in (v_old_div, v_new_div)
    and d.locked
  limit 1;

  -- Not locked (or no division at all) -> nothing to enforce.
  if v_locked_name is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception
      'division_locked: % is locked — unlock it to add games.', v_locked_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    -- Carve-out: pending_interleague rows stay deletable. They are excluded
    -- from every export and from the Reports matrix by countsAsScheduledGame,
    -- so they were NEVER on the schedule parents received — deleting one
    -- cannot make a posted schedule stale. This is the same reasoning 0079
    -- uses to keep pending games deletable, and it is what lets an anonymous
    -- partner's decline work under a lock with no bypass.
    if old.status = 'pending_interleague' then
      return old;
    end if;
    raise exception
      'division_locked: % is locked — unlock it to delete games.', v_locked_name
      using errcode = 'P0001';
  end if;

  -- UPDATE: allowed only if every changed column is in the allowlist.
  if (to_jsonb(old) - v_allow) is distinct from (to_jsonb(new) - v_allow) then
    raise exception
      'division_locked: % is locked — only rainouts and reschedules are allowed.', v_locked_name
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Name sorts before set_games_updated_at — see header.
drop trigger if exists enforce_division_lock on public.games;
create trigger enforce_division_lock
  before insert or update or delete on public.games
  for each row execute function public.enforce_division_lock();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. posted auto-clear
--
-- STATEMENT-level with transition tables, not per row: the generator inserts
-- in batches of 500, and a row trigger would issue 500 updates against the
-- same divisions row. One set-based UPDATE per statement instead.
--
-- ANY games change clears posted — not just rainouts and reschedules. That is
-- the documented contract ("auto-clearing on schedule change"), and putting it
-- in one trigger means no future path can forget to clear it. SECURITY DEFINER
-- so it cannot fail on a permission edge (anon calling a partner RPC).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.clear_division_posted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip while a container-destroying delete is running: the division is on
  -- its way out, so clearing its flag first is pure waste.
  if coalesce(current_setting('fieldslate.lock_bypass', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    update public.divisions d
       set posted = false, posted_at = null
     where d.posted
       and d.id in (select t.division_id from newrows n
                      join public.teams t on t.id = n.home_team_id);
  elsif tg_op = 'DELETE' then
    update public.divisions d
       set posted = false, posted_at = null
     where d.posted
       and d.id in (select t.division_id from oldrows o
                      join public.teams t on t.id = o.home_team_id);
  else
    update public.divisions d
       set posted = false, posted_at = null
     where d.posted
       and d.id in (
         select t.division_id from newrows n join public.teams t on t.id = n.home_team_id
         union
         select t.division_id from oldrows o join public.teams t on t.id = o.home_team_id
       );
  end if;

  return null;
end;
$$;

drop trigger if exists clear_division_posted_insert on public.games;
create trigger clear_division_posted_insert
  after insert on public.games
  referencing new table as newrows
  for each statement execute function public.clear_division_posted();

drop trigger if exists clear_division_posted_update on public.games;
create trigger clear_division_posted_update
  after update on public.games
  referencing old table as oldrows new table as newrows
  for each statement execute function public.clear_division_posted();

drop trigger if exists clear_division_posted_delete on public.games;
create trigger clear_division_posted_delete
  after delete on public.games
  referencing old table as oldrows
  for each statement execute function public.clear_division_posted();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The two container-destroying RPCs gain the bypass
--
-- Both are re-created VERBATIM from their own migrations (0065, 0081) with a
-- single added set_config line — no other change. A locked division must stay
-- deletable, and a locked division inside an archived season must not block
-- that season's permanent delete.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_league_permanently(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league public.leagues%rowtype;
  v_divisions int;
  v_teams int;
  v_games int;
  v_umpires int;
begin
  select * into v_league
  from public.leagues
  where id = p_league_id
  for update;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if v_league.archived_at is null then
    raise exception 'league_not_archived' using errcode = 'P0001';
  end if;

  -- Schedule-lock bypass (0082). Set AFTER the authorization and archived
  -- gates, never before: the bypass must not be reachable by a caller who
  -- would have been refused anyway. Transaction-local.
  perform set_config('fieldslate.lock_bypass', 'on', true);

  select count(*) into v_divisions from public.divisions where league_id = p_league_id;
  select count(*) into v_teams from public.teams where league_id = p_league_id;
  select count(*) into v_games from public.games where league_id = p_league_id;
  select count(*) into v_umpires from public.umpires where season_id = p_league_id;

  delete from public.games where league_id = p_league_id;
  delete from public.leagues where id = p_league_id;

  return jsonb_build_object(
    'deleted',   true,
    'name',      v_league.name,
    'divisions', v_divisions,
    'teams',     v_teams,
    'games',     v_games,
    'officials', v_umpires
  );
end;
$$;

revoke all on function public.delete_league_permanently(uuid) from public;
grant execute on function public.delete_league_permanently(uuid) to authenticated;

create or replace function public.delete_division_permanently(p_division_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_division public.divisions%rowtype;
  v_league   public.leagues%rowtype;
  v_team_ids uuid[];
  v_reasons  jsonb := '[]'::jsonb;
  v_cross_division_playoffs int;
  v_teams    int;
  v_games    int;
  v_interleague_accepted int;
  v_playoff_slots  int;
  v_umpire_links   int;
  v_snack_assigned int;
begin
  select * into v_division
  from public.divisions
  where id = p_division_id
  for update;

  if not found then
    raise exception 'division_not_found' using errcode = 'P0001';
  end if;

  -- divisions has no owner_id; membership is judged on the owning league's
  -- org, same as delete_league_permanently (0065) and delete_game_if_unblocked
  -- (0079). No lock on the league row — it is not the delete target.
  select * into v_league
  from public.leagues
  where id = v_division.league_id;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_team_ids
  from public.teams
  where division_id = p_division_id;

  -- ── Block conditions ──────────────────────────────────────────────────────
  select count(*) into v_cross_division_playoffs
  from public.playoffs
  where cross_division_opponent_id = p_division_id;

  if v_cross_division_playoffs > 0 then
    v_reasons := v_reasons || to_jsonb('cross_division_playoff_opponent'::text);
  end if;

  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object(
      'blocked', true,
      'reasons', v_reasons,
      'cross_division_playoffs', v_cross_division_playoffs
    );
  end if;

  -- Schedule-lock bypass (0082). Set AFTER the membership gate and AFTER the
  -- block conditions, so a refused call never enables it. A locked division
  -- must still be deletable — deliberately: locking must not make a division
  -- permanent. Transaction-local.
  perform set_config('fieldslate.lock_bypass', 'on', true);

  -- ── Disclosure counts, taken before the delete, same transaction ──────────
  v_teams := coalesce(array_length(v_team_ids, 1), 0);

  -- Both team columns, matching the client behavior this replaces. away_team_id
  -- is nullable (interleague rows) and `= any` handles that; home_team_id alone
  -- covers every row today (zero cross-division games live), but the away arm
  -- stays as the same defensive net the client had.
  select count(*) into v_games
  from public.games
  where home_team_id = any(v_team_ids)
     or away_team_id = any(v_team_ids);

  select count(*) into v_interleague_accepted
  from public.games
  where home_team_id = any(v_team_ids)
    and interleague_org_id is not null
    and status <> 'pending_interleague';

  -- Cross-division playoff slots that name one of these teams. This division's
  -- own playoff_games rows cascade off playoffs.division_id, so exclude them —
  -- what is left is the residue another bracket will silently lose.
  select count(*) into v_playoff_slots
  from public.playoff_games pg
  where pg.division_id is distinct from p_division_id
    and (pg.home_team_id = any(v_team_ids)
      or pg.away_team_id = any(v_team_ids)
      or pg.winner_id    = any(v_team_ids));

  select count(*) into v_umpire_links
  from public.umpires
  where team_id = any(v_team_ids);

  select count(*) into v_snack_assigned
  from public.snack_shack_blocks
  where assigned_team_id = any(v_team_ids);

  -- ── Delete, in FK-safe order ──────────────────────────────────────────────
  delete from public.games
  where home_team_id = any(v_team_ids)
     or away_team_id = any(v_team_ids);

  delete from public.teams where id = any(v_team_ids);

  delete from public.divisions where id = p_division_id;

  return jsonb_build_object(
    'deleted', true,
    'name',    v_division.name,
    'teams',   v_teams,
    'games',   v_games,
    'side_effects', jsonb_build_object(
      'interleague_accepted_games', v_interleague_accepted,
      'playoff_slots_cleared',      v_playoff_slots,
      'official_coach_links_cleared', v_umpire_links,
      'snack_shack_assignments_cleared', v_snack_assigned
    )
  );
end;
$$;

revoke all on function public.delete_division_permanently(uuid) from public;
grant execute on function public.delete_division_permanently(uuid) to authenticated;
