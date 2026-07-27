-- Hard-delete a single team, server-authoritatively. SECURITY DEFINER RPC in
-- the delete_venue_if_unreferenced (0078) / delete_game_if_unblocked (0079) /
-- delete_division_permanently (0081) family: row lock -> is_org_member gate ->
-- evaluate block conditions -> return { blocked, reasons, ... } with NO delete,
-- or delete atomically and return disclosure counts.
--
-- ── WHY THIS EXISTS — two defects it closes ─────────────────────────────────
--   Defect 1 (the dangerous one): enforce_division_lock (0082) is a BEFORE ROW
--     trigger on `games` ONLY. Nothing gates the `teams` delete. A team with
--     ZERO games therefore deletes CLEAN on a LOCKED division today, taking its
--     practice_slots, team_availability_blocks, team_game_constraints and
--     official_conflicts with it on CASCADE — no refusal, no disclosure. The
--     lock is false on this path. This RPC makes the lock authoritative for
--     team deletion by reading `divisions.locked` DIRECTLY (first block, below),
--     never by leaning on the games trigger — so it fires with zero games.
--   Defect 2 (the reported symptom): the old client path (three bare,
--     non-atomic deletes in division-schedule-panel.tsx) surfaced a locked-game
--     refusal in the panel footer while the modal closed — read as "nothing
--     happened". Fixed on the client; this RPC gives it one authoritative,
--     atomic call whose block reasons the modal renders at the action.
--
-- ── Deletion order (load-bearing) ───────────────────────────────────────────
-- games.home_team_id / away_team_id -> teams are NO ACTION (0001), so a team
-- with games cannot be deleted until its games are gone. Order: games first,
-- then the team. Everything else rides a cascade off one of those two:
--   off games (0025/0064/0039, CASCADE): game_umpires, conflict_overrides,
--     interleague_reschedule_requests
--   off teams (CASCADE): practice_slots, team_availability_blocks,
--     team_game_constraints, official_conflicts, practices_legacy (dead table,
--     ignored like the venue guard — set-null, no UI)
-- SET NULL off teams (orphaned; DISCLOSED, never blocked): playoff_games
--   home/away/winner slots, umpires.team_id (coach link),
--   snack_shack_blocks.assigned_team_id
--
-- ── Block conditions — exactly three, ALL evaluated (never first-match) ──────
--   1. Division locked (divisions.locked). BLOCK, and do NOT bypass. A team is
--      not the container the lock lives in, so the CLAUDE.md lock_bypass rule
--      (only delete_league_permanently / delete_division_permanently qualify)
--      does not apply. Read DIRECTLY and FIRST, so it fires for a zero-games
--      team — that is Defect 1, and it must not depend on the games trigger.
--   2. Accepted interleague game (mirror 0079): a game on this team with
--      interleague_org_id IS NOT NULL AND status <> 'pending_interleague'.
--      Partner leagues read our rows live; deleting silently drops them.
--   3. Recorded result (mirror 0079): a game on this team with home_score OR
--      away_score NOT NULL, OR status = 'completed'. That game is season
--      history — refused even when the division is unlocked.
--
-- ── Preview (p_commit = false) vs commit (p_commit = true) ───────────────────
-- The confirm dialog must show REAL counts and REAL block reasons BEFORE the
-- destructive click, from ONE authoritative source rather than a parallel
-- client count that could drift from this logic. So the RPC has two modes:
--   p_commit = false -> evaluate blocks + compute every disclosure count, return
--                       them, delete NOTHING.
--   p_commit = true  -> re-evaluate blocks (the lock can flip between preview and
--                       confirm) and, only if clear, delete.
-- A blocked commit deletes nothing. Counts are always real numbers — never a
-- silent 0 standing in for "did not check".
--
-- ── JSONB is NOT touched here ────────────────────────────────────────────────
-- divisions.settings.teams[] (the name-keyed copy, including cross-division
-- conflict_team back-refs) is reconciled on the client through
-- reconcile-teams.ts — the single team-name-writing path. Its cross-division
-- rewrite is name-keyed logic that belongs with the rename primitives, not
-- duplicated in plpgsql. This RPC owns only the destructive, FK-bearing
-- teams/games delete; the jsonb reconcile follows a confirmed delete.

create or replace function public.delete_team_if_unblocked(
  p_team_id uuid,
  p_commit  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team       public.teams%rowtype;
  v_league     public.leagues%rowtype;
  v_division   public.divisions%rowtype;
  v_game_ids   uuid[];
  v_reasons    jsonb := '[]'::jsonb;
  -- block-side counts
  v_interleague_accepted int;
  v_result_games int;
  -- destroyed (cascade)
  v_games int;
  v_umpire_assignments int;
  v_reschedule_requests int;
  v_override_history int;
  v_practice_slots int;
  v_availability_blocks int;
  v_team_constraints int;
  v_official_conflicts int;
  -- orphaned (SET NULL)
  v_playoff_slots int;
  v_umpire_links int;
  v_snack_assigned int;
  v_destroyed jsonb;
  v_side_effects jsonb;
begin
  select * into v_team
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    raise exception 'team_not_found' using errcode = 'P0001';
  end if;

  -- teams has league_id; membership is judged on the owning league's org, same
  -- as delete_game_if_unblocked (0079) and delete_division_permanently (0081).
  -- No lock on the league row — it is not the delete target.
  select * into v_league
  from public.leagues
  where id = v_team.league_id;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  -- The team's division. teams.division_id is SET NULL, so it may be null; a
  -- null division means NO division and therefore no lock — the same stance the
  -- lock trigger takes (null division => unlocked), not fail-closed.
  if v_team.division_id is not null then
    select * into v_division
    from public.divisions
    where id = v_team.division_id;
  end if;

  -- The team's games (home or away). Gathered once; drives both the block
  -- checks and the cascade disclosure counts.
  select coalesce(array_agg(id), '{}'::uuid[]) into v_game_ids
  from public.games
  where home_team_id = p_team_id
     or away_team_id = p_team_id;

  -- ── Block conditions — all evaluated so a blocked response tells the whole
  --    truth (same principle as 0079). ───────────────────────────────────────
  -- 1. Division locked. Read directly (Defect 1): fires with zero games.
  if v_division.id is not null and v_division.locked then
    v_reasons := v_reasons || to_jsonb('division_locked'::text);
  end if;

  -- 2. Accepted interleague games on this team.
  select count(*) into v_interleague_accepted
  from public.games
  where id = any(v_game_ids)
    and interleague_org_id is not null
    and status <> 'pending_interleague';
  if v_interleague_accepted > 0 then
    v_reasons := v_reasons || to_jsonb('interleague_accepted'::text);
  end if;

  -- 3. Recorded results on this team's games.
  select count(*) into v_result_games
  from public.games
  where id = any(v_game_ids)
    and (home_score is not null or away_score is not null or status = 'completed');
  if v_result_games > 0 then
    v_reasons := v_reasons || to_jsonb('result_recorded'::text);
  end if;

  -- ── Disclosure counts (needed by BOTH preview and the success toast) ───────
  v_games := coalesce(array_length(v_game_ids, 1), 0);

  select count(*) into v_umpire_assignments  from public.game_umpires                    where game_id = any(v_game_ids);
  select count(*) into v_reschedule_requests from public.interleague_reschedule_requests where game_id = any(v_game_ids);
  select count(*) into v_override_history    from public.conflict_overrides              where game_id = any(v_game_ids);
  select count(*) into v_practice_slots      from public.practice_slots                  where team_id = p_team_id;
  select count(*) into v_availability_blocks from public.team_availability_blocks        where team_id = p_team_id;
  select count(*) into v_team_constraints    from public.team_game_constraints           where team_id = p_team_id;
  select count(*) into v_official_conflicts  from public.official_conflicts              where team_id = p_team_id;

  select count(*) into v_playoff_slots
  from public.playoff_games
  where home_team_id = p_team_id or away_team_id = p_team_id or winner_id = p_team_id;
  select count(*) into v_umpire_links   from public.umpires            where team_id = p_team_id;
  select count(*) into v_snack_assigned from public.snack_shack_blocks where assigned_team_id = p_team_id;

  -- Assembled once; identical shape in the blocked, preview, and deleted
  -- returns so every surface reads the same keys.
  v_destroyed := jsonb_build_object(
    'games',                v_games,
    'umpire_assignments',   v_umpire_assignments,
    'reschedule_requests',  v_reschedule_requests,
    'override_history',     v_override_history,
    'practice_slots',       v_practice_slots,
    'availability_blocks',  v_availability_blocks,
    'team_constraints',     v_team_constraints,
    'official_conflicts',   v_official_conflicts
  );
  v_side_effects := jsonb_build_object(
    'playoff_slots_cleared',           v_playoff_slots,
    'official_coach_links_cleared',    v_umpire_links,
    'snack_shack_assignments_cleared', v_snack_assigned
  );

  -- Blocked: return with NO delete, in both preview and commit modes.
  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object(
      'blocked',                    true,
      'reasons',                    v_reasons,
      'team_name',                  v_team.name,
      'division_name',              v_division.name,
      'division_locked',            coalesce(v_division.locked, false),
      'interleague_accepted_games', v_interleague_accepted,
      'result_games',               v_result_games,
      'destroyed',                  v_destroyed,
      'side_effects',               v_side_effects
    );
  end if;

  -- Preview: not blocked, nothing deleted — just the counts for the dialog.
  if not p_commit then
    return jsonb_build_object(
      'blocked',       false,
      'preview',       true,
      'team_name',     v_team.name,
      'division_name', v_division.name,
      'destroyed',     v_destroyed,
      'side_effects',  v_side_effects
    );
  end if;

  -- ── Commit: delete in FK-safe order (games first, then the team) ───────────
  delete from public.games where id = any(v_game_ids);
  delete from public.teams where id = p_team_id;

  return jsonb_build_object(
    'deleted',       true,
    'team_name',     v_team.name,
    'division_name', v_division.name,
    'destroyed',     v_destroyed,
    'side_effects',  v_side_effects
  );
end;
$$;

revoke all on function public.delete_team_if_unblocked(uuid, boolean) from public;
grant execute on function public.delete_team_if_unblocked(uuid, boolean) to authenticated;
