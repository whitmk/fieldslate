-- Permanent division deletion, server-authoritatively. SECURITY DEFINER RPC in
-- the 0065 / 0078 / 0079 family: row lock -> is_org_member gate -> evaluate
-- block conditions -> return { blocked, reasons } with NO delete, or delete
-- atomically and return disclosure counts.
--
-- WHY THIS EXISTS: division delete was a bare client-side sequence in
-- division-section.tsx — three unguarded statements (delete games, delete
-- teams, delete division) run from the browser under RLS. It is the most
-- destructive path in the product and had no server-side gate, no atomicity
-- (a failure between statements left a half-deleted division), and no
-- disclosure of what was about to go. This RPC is worth landing on its own
-- merits; it is ALSO where the schedule-lock bypass will live (later chunk),
-- which is why it lands before the enforcement trigger rather than after.
--
-- ── Deletion order (load-bearing) ───────────────────────────────────────────
-- games -> teams FKs are NO ACTION (0001), and teams.division_id is SET NULL,
-- so deleting the division alone orphans its teams instead of removing them.
-- The explicit order is therefore: games, then teams, then the division.
-- Everything else rides a cascade off one of those three.
--
-- ── Block condition — exactly one ───────────────────────────────────────────
-- playoffs.cross_division_opponent_id -> divisions is NO ACTION. A division
-- named as ANOTHER division's cross-division playoff opponent cannot be
-- deleted without a raw FK error, and the house rule (0078) is that a guard
-- never leans on an FK error. So it is counted explicitly and BLOCKS with a
-- named reason. This is the right call on the merits too: everything else this
-- RPC removes belongs TO the division, but a cross-division playoff reference
-- is another division's configuration. Deleting through it would silently
-- break someone else's bracket. Clear the opponent link there first.
--
-- ── Side effects DISCLOSED but not blocked ──────────────────────────────────
-- These fire on the teams delete and are reported in the return value so the
-- UI can name them. They are not block conditions — blocking on them would
-- make divisions undeletable for reasons an admin cannot see or clear:
--   playoff_games.home_team_id / away_team_id / winner_id  (SET NULL) --
--       a playoff slot in a DIFFERENT division that names one of these teams
--       is blanked, not deleted. This division's own playoff rows cascade
--       away via playoff_games.division_id, so the count here is strictly
--       cross-division residue. Rare, but silent, so it gets disclosed.
--   umpires.team_id            (SET NULL) -- an official's coach link
--   snack_shack_blocks.assigned_team_id (SET NULL) -- snack shack assignment
--   activity_log.division_id   (SET NULL) -- the division's history survives
--       with a null division rather than being erased. Deliberate: the log is
--       the record that the delete happened.
--
-- Cascades (silent by design, not counted — they are meaningless without their
-- parent): division_venues, division_interleague_games, practice_time_slots,
-- playoffs + playoff_games for THIS division, practices_legacy, and off teams:
-- practice_slots, team_availability_blocks, team_game_constraints,
-- official_conflicts. Games' own cascades (game_umpires, conflict_overrides,
-- interleague_reschedule_requests) are documented in 0079.
--
-- ── Interleague ─────────────────────────────────────────────────────────────
-- Accepted interleague games are counted and returned so the confirm dialog
-- can warn that the partner org is NOT notified. Unlike delete_game_if_unblocked
-- (0079), an accepted interleague game does NOT block here: deleting a whole
-- division is an explicit, acknowledged act, and blocking it would strand the
-- division behind games only the partner flow can remove one at a time.

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
