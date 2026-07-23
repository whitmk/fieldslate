-- Hard-delete a single game, server-authoritatively. SECURITY DEFINER RPC
-- modeled on delete_venue_if_unreferenced (0078) and delete_league_permanently
-- (0065): row lock -> is_org_member gate -> evaluate block conditions ->
-- return { blocked, reasons } with NO delete, or delete atomically.
--
-- Honesty note: RLS (0049 is_org_member policies) already permits org members
-- to delete games client-side — the schedule panel's team-delete does bulk
-- game deletes today. This RPC does not add a missing permission gate; it
-- exists so the BLOCK CONDITIONS are evaluated server-side, atomically with
-- the delete, and can never be skipped by a client path.
--
-- Divergence from 0078: there, every reference BLOCKS the delete. Here, all
-- three FK references to games.id cascade BY DESIGN — they are meaningless
-- without the game:
--   game_umpires.game_id                  (0025, CASCADE) -- umpire assignments
--   conflict_overrides.game_id            (0064, CASCADE) -- override audit trail
--   interleague_reschedule_requests.game_id (0039, CASCADE) -- reschedule requests
-- The cascade of conflict_overrides deliberately erases that game's override
-- audit history — accepted: the audit's subject is gone. The check-counts
-- principle still holds (never lean on an FK error); the counts here are
-- DISCLOSURE (returned so the UI can say what was removed), not gates.
-- playoff_games does not reference games at all (parallel table, 0021) — a
-- regular-season game cannot be mid-bracket, so no playoff condition exists.
-- interleague_invite_responses.team_names holds game_id strings in jsonb
-- (write-once, unread in src/) — accepted as dead-id residue, not cleaned.
--
-- Block conditions — exactly two:
--   1. Accepted interleague game: interleague_org_id IS NOT NULL AND
--      status <> 'pending_interleague'. Partner leagues read our games rows
--      LIVE via the schedule/invite token RPCs (0037/0074); deleting an
--      accepted game silently drops it from their view with no notification.
--      This includes reschedule_pending and rained-out (cancelled) accepted
--      games — acceptance is the point of no return; the interleague resolve
--      flow (which emails the partner) is the deletion path for those.
--      Pending games stay DELETABLE on purpose: a dead invite must not
--      strand a row. (Declined pending games are already deleted by the
--      invite RPCs themselves.)
--   2. Recorded result: home_score IS NOT NULL OR away_score IS NOT NULL OR
--      status = 'completed'. A game with a result is season history. Nothing
--      in the product writes scores or 'completed' to games today (only
--      playoff_games has result entry), so this guards raw-SQL-created
--      history and any future results feature.

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
