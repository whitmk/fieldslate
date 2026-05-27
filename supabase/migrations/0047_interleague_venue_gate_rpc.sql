-- get_game_venue_context_for_gate(p_game_id, p_proposed_venue_name)
--
-- Returns the venue rows + game metadata needed by the interleague venue-hours
-- gate. The four interleague reschedule endpoints (sender propose, anon
-- respond, authed respond, anon schedule-token) all need the same pieces:
--
--   - the game's current venue (we validate it stays open at the new time)
--   - a name-matched owned venue (for "counter-proposes a new venue_name")
--   - the home team's division.game_duration (for the window check)
--   - is_away (so callers can short-circuit when the partner org hosts)
--
-- SECURITY DEFINER because the anon endpoints (token-authed external orgs)
-- can't read `venues` directly — RLS is owner-scoped. The RPC narrows the
-- venue read to (a) the venue currently on the game and (b) a single owned
-- venue matched by name, so there's no broader leakage.

create or replace function public.get_game_venue_context_for_gate(
  p_game_id uuid,
  p_proposed_venue_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_owner_id uuid;
  v_duration_min int;
  v_existing_venue jsonb;
  v_matched_venue jsonb;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then
    return null;
  end if;

  -- Look up the home team's league owner + division.settings.game_duration.
  -- We need owner_id to scope the matched-venue lookup; duration to drive
  -- the window check on the gate side.
  select l.owner_id, coalesce((d.settings->>'game_duration')::int, 0)
  into v_owner_id, v_duration_min
  from public.leagues l
  join public.teams t on t.id = v_game.home_team_id
  join public.divisions d on d.id = t.division_id
  where l.id = v_game.league_id;

  if v_game.venue_id is not null then
    select jsonb_build_object(
      'name', v.name,
      'availability', v.availability,
      'availability_configured', v.availability_configured
    )
    into v_existing_venue
    from public.venues v where v.id = v_game.venue_id;
  end if;

  if p_proposed_venue_name is not null and length(trim(p_proposed_venue_name)) > 0 then
    select jsonb_build_object(
      'name', v.name,
      'availability', v.availability,
      'availability_configured', v.availability_configured
    )
    into v_matched_venue
    from public.venues v
    where v.owner_id = v_owner_id
      and lower(v.name) = lower(trim(p_proposed_venue_name))
    limit 1;
  end if;

  return jsonb_build_object(
    'is_away', v_game.is_away,
    'duration_min', v_duration_min,
    'existing_venue', v_existing_venue,
    'matched_venue', v_matched_venue
  );
end;
$$;

grant execute on function public.get_game_venue_context_for_gate(uuid, text) to anon, authenticated;
