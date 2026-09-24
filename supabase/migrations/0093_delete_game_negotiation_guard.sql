-- A live interleague negotiation survives the single-game delete.
--
-- THE DEFECT. delete_game_if_unblocked permits deleting a pending_interleague
-- game — deliberately, so a dead invite cannot strand a row. But a pending game
-- the PARTNER has touched is not a dead invite. Deleting it cascades the
-- interleague_reschedule_requests row away and kills the token they answer
-- through; their link then reads "This link is no longer active … reach out to
-- the league admin", and that admin has no record of it either. Nobody is
-- emailed. The RPC already counted those request rows as DISCLOSURE and deleted
-- anyway.
--
-- SAME HOLE, OTHER DOOR. The regenerate delete had it too and was closed first
-- (2026-09-23). This uses the SAME definition of "protected", now written once
-- in SQL as is_protected_interleague_game and once in TypeScript as
-- isProtectedInterleagueGame, pinned together by a shared truth table — see
-- that function's header.
--
-- THE 0082 LOCK TRIGGER IS NOT TOUCHED, and this does not require it to be.
-- Its pending_interleague carve-out exists so an anonymous partner's DECLINE is
-- not refused by a lock, and a partner decline goes through the token RPCs
-- (accept/decline_interleague_invite, which delete games directly), never
-- through this one. Verified again here: `anon` holds NO execute on
-- delete_game_if_unblocked.
--
-- COUNT-FIRST, never an FK error — the house rule from 0078/0081. The request
-- rows are counted inside the same transaction as the row lock, so nothing can
-- be inserted between the check and the delete.
--
-- Live rows protected by this today: ZERO. All 10 pending interleague games are
-- untouched invites, and the one reschedule_pending game is already blocked by
-- `interleague_accepted`. Preventive, exactly like the regenerate guard.
--
-- delete_game_if_unblocked's body is VERBATIM from 0083 except the fourth block
-- condition marked "0093".

-- ── is_protected_interleague_game ───────────────────────────────────────────
--
-- ONE DEFINITION OF "this interleague game is mid-negotiation and must not be
-- destroyed", in SQL. Its TypeScript twin is isProtectedInterleagueGame in
-- src/lib/schedule/generate-schedule.ts, which guards the REGENERATE delete.
-- The two doors have to agree about the same rows, and neither can be derived
-- from the other, so the truth table in
-- scripts/sim/delete-game-negotiation-sim.sql drives BOTH of them: the SQL
-- harness asserts this function against it, and npm run
-- sim:regenerate-pending-guard parses that same table out of that same file and
-- asserts the TypeScript predicate against it.
--
-- WHAT COUNTS AS PROTECTED, and why each arm:
--   * reschedule_pending — an ACCEPTED game with a change outstanding. 0079's
--     rule is that accepted interleague games are never silently deleted.
--   * pending_interleague WITH partner involvement — they countered
--     (external_team_name), their proposed time is on the row
--     (proposed_scheduled_at), or a reschedule request row exists. A live
--     conversation.
--   * an UNTOUCHED pending game is NOT protected: it is an unanswered
--     proposal, and keeping it would let a dead invite strand a row forever.
--     That is the carve-out this deliberately preserves.
--
-- `p_has_request` is passed in rather than looked up here so the function stays
-- immutable and side-effect free — the caller counts, in its own transaction.
create or replace function public.is_protected_interleague_game(
  p_status                text,
  p_interleague_org_id    uuid,
  p_external_team_name    text,
  p_proposed_scheduled_at timestamptz,
  p_has_request           boolean
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_interleague_org_id is null then false
    when p_status = 'reschedule_pending' then true
    when p_status <> 'pending_interleague' then false
    else p_external_team_name is not null
      or p_proposed_scheduled_at is not null
      or coalesce(p_has_request, false)
  end;
$$;

-- Nothing anonymous needs this: it is called from inside
-- delete_game_if_unblocked, which is SECURITY DEFINER and therefore runs it as
-- the owner. It reads no tables and only re-states its arguments, so this is
-- least-privilege tidiness rather than a fix for an exposure.
--
-- REVOKE FROM `public`, NOT FROM `anon`. Postgres grants EXECUTE on every new
-- function to PUBLIC, and `anon` inherits it from there — a
-- `revoke … from anon` runs without error and changes NOTHING
-- (has_function_privilege('anon', …) stays true). Confirmed the hard way while
-- applying this. `authenticated` is then granted back explicitly, because the
-- project's default privileges are what the rest of the schema relies on and a
-- silent difference for one function is worse than a broad grant.
revoke execute on function public.is_protected_interleague_game(
  text, uuid, text, timestamptz, boolean
) from public;
grant execute on function public.is_protected_interleague_game(
  text, uuid, text, timestamptz, boolean
) to authenticated;

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
  -- 0093: counted BEFORE the block decision, because the count IS the guard.
  v_open_requests int;
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

  -- ALL conditions are evaluated (not first-match) so a blocked response
  -- always tells the whole truth. 0093 added the fourth.
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

  -- Fourth condition (0093): a LIVE NEGOTIATION on a pending game.
  --
  -- The pending_interleague carve-out above exists so a dead invite cannot
  -- strand a row, and it stays. But a pending game the partner has TOUCHED is
  -- not a dead invite: deleting it cascades interleague_reschedule_requests
  -- away, and the partner's token then shows "no longer active" and tells them
  -- to contact an admin who no longer has a record of it either. No email to
  -- anyone. This RPC already counted those request rows as disclosure and
  -- deleted anyway.
  --
  -- COUNT FIRST — the count is the guard, never an FK error (house rule from
  -- 0078/0081). Counted here, in the same transaction as the row lock, so a
  -- request row inserted concurrently cannot slip between the check and the
  -- delete.
  --
  -- The predicate is is_protected_interleague_game, which is also the SQL half
  -- of the definition the REGENERATE guard uses in TypeScript
  -- (isProtectedInterleagueGame in src/lib/schedule/generate-schedule.ts). The
  -- two must never drift; the truth table in
  -- scripts/sim/delete-game-negotiation-sim.sql pins them together.
  select count(*) into v_open_requests
    from public.interleague_reschedule_requests
   where game_id = p_game_id;

  if public.is_protected_interleague_game(
       v_game.status,
       v_game.interleague_org_id,
       v_game.external_team_name,
       v_game.proposed_scheduled_at,
       v_open_requests > 0
     ) then
    v_reasons := v_reasons || to_jsonb('interleague_negotiation'::text);
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
