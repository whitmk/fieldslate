-- 0115: deleting a division is no longer blocked by another bracket's
-- cross-division opponent setting (2026-10-20, Whit).
--
-- WHY. delete_division_permanently (0081, live body from 0082) refused with
-- `cross_division_playoff_opponent` whenever any playoffs row named the
-- division in cross_division_opponent_id (an FK with NO ACTION). That setting
-- does nothing — the bracket planner never reads it — and the playoff
-- wizard's Cross-div step is now HIDDEN, so nothing in the app can clear it: a
-- division named there could never be deleted.
--
-- WHAT. delete_division_permanently is re-created VERBATIM from 0082 except:
--   1. the cross-division block condition is gone (v_reasons stays empty, so
--      the function never returns `blocked`);
--   2. before the division row is deleted, every playoffs row naming it gets
--      cross_division_enabled = false and cross_division_opponent_id = null,
--      in the same transaction, counted into side_effects as
--      `cross_division_settings_cleared`.
-- Everything else — the row lock, the org gate, the lock bypass after the
-- gates, the disclosure counts, the FK-safe delete order — is unchanged.
--
-- PRIVILEGES: unchanged — `revoke all … from public`, EXECUTE to authenticated
-- (the 0082 statements, repeated). Verify per role after applying.
--
-- LOCKS WHEN APPLIED: CREATE OR REPLACE FUNCTION only — no table lock.
--
-- APPLY VERBATIM, comments included (CLAUDE.md). Verify md5(prosrc).
--
-- DEPLOY ORDER: none required. The app already handles a non-blocked reply
-- (it always did); the `cross_division_playoff_opponent` sentence in
-- division-section.tsx simply stops being reachable.

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
  v_cross_division_cleared int;
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
  -- None since 0115. Until then another bracket naming this division as its
  -- cross-division opponent (playoffs.cross_division_opponent_id, NO ACTION)
  -- blocked the delete — but that setting does nothing (the planner never
  -- reads it) and its wizard step is hidden, so nothing in the app could clear
  -- it. The setting is now cleared below, in this transaction. v_reasons stays
  -- so a future block condition slots in here.
  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object(
      'blocked', true,
      'reasons', v_reasons
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

  -- 0115: another bracket's cross-division opponent setting that names this
  -- division is cleared (it does nothing; see Block conditions). Counted and
  -- cleared before the division row goes, so the NO ACTION FK never fires.
  update public.playoffs
     set cross_division_enabled = false,
         cross_division_opponent_id = null,
         updated_at = now()
   where cross_division_opponent_id = p_division_id;
  get diagnostics v_cross_division_cleared = row_count;

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
      'snack_shack_assignments_cleared', v_snack_assigned,
      'cross_division_settings_cleared', v_cross_division_cleared
    )
  );
end;
$$;

revoke all on function public.delete_division_permanently(uuid) from public;
grant execute on function public.delete_division_permanently(uuid) to authenticated;
