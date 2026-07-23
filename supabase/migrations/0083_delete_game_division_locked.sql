-- delete_game_if_unblocked gains a THIRD block reason: division_locked.
--
-- Re-created verbatim from 0079 with one added condition and its declare —
-- every other line, comment included, is unchanged.
--
-- ── Why the RPC needs this when the trigger already exists ──────────────────
-- The 0082 trigger would refuse the delete regardless, but it refuses by
-- RAISING — the caller gets a raw SQL error instead of this RPC's structured
-- { blocked, reasons } contract that the UI already renders as a list. The
-- check here turns that into an honest, named refusal alongside the existing
-- two. The trigger remains the backstop: this function deliberately does NOT
-- set the lock bypass (it deletes a game, not the container the lock lives
-- in), so if this check were ever removed the trigger would still refuse.
--
-- ── The pending_interleague exclusion is a CONSISTENCY REQUIREMENT ──────────
-- The 0082 trigger permits deleting a pending_interleague row in a locked
-- division (it was never on any exported schedule, so removing it cannot make
-- a posted schedule stale, and that carve-out is what lets an anonymous
-- partner's decline work with no bypass). If division_locked fired here for
-- pending rows, this RPC would refuse something the trigger allows — the two
-- guards would disagree about the same row. They must match exactly. Note
-- this also composes with 0079's own reasoning, which already keeps pending
-- games deletable so a dead invite cannot strand a row.
--
-- All three conditions are still evaluated (not first-match) so a blocked
-- response tells the whole truth.

create or replace function public.delete_game_if_unblocked(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game    public.games%rowtype;
  v_league  public.leagues%rowtype;
  v_reasons jsonb := '[]'::jsonb;
  v_umpire_assignments int;
  v_override_history   int;
  v_reschedule_requests int;
  v_division_locked boolean;
begin
  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;

  -- games has no owner_id; membership is judged on the owning league's org,
  -- same as delete_league_permanently. No lock needed on the league row —
  -- it is not the delete target.
  select * into v_league
  from public.leagues
  where id = v_game.league_id;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  -- Both conditions are evaluated (not first-match) so a blocked response
  -- always tells the whole truth.
  if v_game.interleague_org_id is not null
     and v_game.status <> 'pending_interleague' then
    v_reasons := v_reasons || to_jsonb('interleague_accepted'::text);
  end if;
  if v_game.home_score is not null
     or v_game.away_score is not null
     or v_game.status = 'completed' then
    v_reasons := v_reasons || to_jsonb('result_recorded'::text);
  end if;

  -- Third condition (0083): the game's division is locked. Derived through
  -- home_team_id -> teams.division_id, since games has no division_id. A NULL
  -- division is not locked (no division, no lock) — same stance as the 0082
  -- trigger. pending_interleague is excluded to match the trigger's carve-out
  -- exactly; see this migration's header.
  select d.locked into v_division_locked
  from public.teams t
  join public.divisions d on d.id = t.division_id
  where t.id = v_game.home_team_id;

  if coalesce(v_division_locked, false)
     and v_game.status <> 'pending_interleague' then
    v_reasons := v_reasons || to_jsonb('division_locked'::text);
  end if;

  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object(
      'blocked', true,
      'reasons', v_reasons
    );
  end if;

  -- Disclosure counts: what the cascade is about to remove alongside the
  -- game. Counted before the delete, in the same transaction.
  select count(*) into v_umpire_assignments
    from public.game_umpires where game_id = p_game_id;
  select count(*) into v_override_history
    from public.conflict_overrides where game_id = p_game_id;
  select count(*) into v_reschedule_requests
    from public.interleague_reschedule_requests where game_id = p_game_id;

  delete from public.games where id = p_game_id;

  return jsonb_build_object(
    'deleted', true,
    'cascaded', jsonb_build_object(
      'umpire_assignments',   v_umpire_assignments,
      'override_history',     v_override_history,
      'reschedule_requests',  v_reschedule_requests
    )
  );
end;
$$;

revoke all on function public.delete_game_if_unblocked(uuid) from public;
grant execute on function public.delete_game_if_unblocked(uuid) to authenticated;
