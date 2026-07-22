-- Delete a venue, but ONLY when nothing live still references it (Option A —
-- delete-if-empty). The whole safety of this feature is that the reference
-- check is COMPLETE and lives server-side, so this is a SECURITY DEFINER RPC
-- modeled on delete_league_permanently (0065):
--   1. Caller must be an org member (is_org_member on the venue's owner_id) —
--      a delete may only ever touch a venue the caller's org owns.
--   2. Every live reference is counted EXPLICITLY here — the guard never leans
--      on a foreign-key error. A raw delete would fire one loud FK error
--      (games, NO ACTION) and six silent set-null / cascade / orphan effects,
--      so counting is the only honest guard.
--   3. If any reference exists, the function returns { blocked: true, counts }
--      and does NOT delete. Only a truly-zero-reference venue is removed, and
--      the count + delete share one transaction so nothing can be scheduled
--      onto the venue between the check and the delete.
--
-- References checked (7 — the full live set):
--   games.venue_id                     (NO ACTION)  -- scheduled games
--   playoff_games.venue_id             (SET NULL)   -- playoff games
--   practice_slots.field_id            (SET NULL)   -- live practice slots
--   division_venues.venue_id           (CASCADE)    -- division<->venue assignment
--   divisions.practice_venue_id        (SET NULL)   -- division default practice venue
--   teams.preferred_field_id           (SET NULL)   -- team preferred field
--   snack_shack_settings.home_venue_ids (jsonb, NO FK) -- checked explicitly;
--       there is no foreign key on this jsonb array, so an FK sweep misses it
--       entirely and a raw delete would silently orphan the id inside it.
--
-- Deliberately NOT checked: practices_legacy.venue_id. That table (0015,
-- renamed in 0040) is historical, is not read anywhere in the app, and its
-- FK is SET NULL — a delete cleanly nulls dead rows no user can see or clear,
-- so blocking on it would make venues undeletable for an invisible reason.

create or replace function public.delete_venue_if_unreferenced(p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue         public.venues%rowtype;
  v_games         int;
  v_playoff_games int;
  v_practices     int;
  v_division_venues int;
  v_division_default int;
  v_team_preferred  int;
  v_snack_shack   int;
  v_total         int;
begin
  select * into v_venue
  from public.venues
  where id = p_venue_id
  for update;

  if not found then
    raise exception 'venue_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_venue.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select count(*) into v_games
    from public.games where venue_id = p_venue_id;
  select count(*) into v_playoff_games
    from public.playoff_games where venue_id = p_venue_id;
  select count(*) into v_practices
    from public.practice_slots where field_id = p_venue_id;
  select count(*) into v_division_venues
    from public.division_venues where venue_id = p_venue_id;
  select count(*) into v_division_default
    from public.divisions where practice_venue_id = p_venue_id;
  select count(*) into v_team_preferred
    from public.teams where preferred_field_id = p_venue_id;
  -- No FK backs this jsonb array of venue-id strings, so it must be checked
  -- by hand — this is the reference an FK-only guard would silently orphan.
  select count(*) into v_snack_shack
    from public.snack_shack_settings
    where home_venue_ids @> to_jsonb(p_venue_id::text);

  v_total := v_games + v_playoff_games + v_practices + v_division_venues
           + v_division_default + v_team_preferred + v_snack_shack;

  if v_total > 0 then
    return jsonb_build_object(
      'blocked', true,
      'name',    v_venue.name,
      'counts',  jsonb_build_object(
        'games',             v_games,
        'playoff_games',     v_playoff_games,
        'practices',         v_practices,
        'division_venues',   v_division_venues,
        'division_default',  v_division_default,
        'team_preferred',    v_team_preferred,
        'snack_shack',       v_snack_shack
      )
    );
  end if;

  delete from public.venues where id = p_venue_id;

  return jsonb_build_object(
    'deleted', true,
    'name',    v_venue.name
  );
end;
$$;

revoke all on function public.delete_venue_if_unreferenced(uuid) from public;
grant execute on function public.delete_venue_if_unreferenced(uuid) to authenticated;
