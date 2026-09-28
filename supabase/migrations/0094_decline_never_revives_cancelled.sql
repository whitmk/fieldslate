-- 0094: a partner's decline never revives a rained-out game.
--
-- CONTEXT. A rained-out interleague game is now rescheduled directly: the host
-- proposes a makeup time on the CANCELLED game (the game stays cancelled until
-- the partner answers), and accept_reschedule_request_by_token — unchanged —
-- sets it 'scheduled' at the new time. That makes the shared decline path
-- dangerous: decline_reschedule_request_by_token released the game to
-- 'scheduled' for every status except pending_interleague (0091), so a partner
-- declining a makeup would have quietly put a rained-out game back on the
-- schedule at its rained-out time. This adds `status <> 'cancelled'` to that
-- UPDATE and changes nothing else.
--
-- SHARED PATH PROVEN, NOT ASSUMED: scripts/sim/cancelled-reschedule-rpc-sim.sql
-- runs the pre-0094 body (captured live as pg_temp.old_decline_*) and this one
-- on twin reschedule_pending fixtures and compares the game row, the request
-- row and the returned JSON; and runs accept old-vs-new the same way (it is not
-- changed here — the comparison is what says so). Mutants: the new condition
-- removed (a declined makeup revives the game) and the SCHEDULED path broken.
--
-- Body is verbatim from 0091 except the lines marked "0094".

create or replace function public.decline_reschedule_request_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.interleague_reschedule_requests%rowtype;
  v_sender_email text;
  v_sender_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
  v_recipient_email text;
  v_home_team text;
  v_external_team text;
  v_division text;
  v_game_iso timestamptz;
  v_is_away boolean;
  v_league_id uuid;
  v_interleague_org_id uuid;
  v_game_status text;
  v_standing timestamptz;
begin
  select * into v_req
  from public.interleague_reschedule_requests
  where token = p_token
  for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = 'P0001';
  end if;
  -- 0091: a reschedule TOKEN is the partner league's credential, and it is only
  -- ever emailed for a request the HOST created. A token for a partner-created
  -- request is never sent to anyone. Refuse to act through one anyway: without
  -- this, whoever held it could accept the partner's own request (moving the
  -- game without the host) or counter it and have the new row recorded as
  -- partner-initiated. With it, a token action always answers a host request,
  -- so the partner attribution below is true by construction.
  if v_req.requested_by_user_id is null then
    raise exception 'request_not_actionable_by_token' using errcode = 'P0001';
  end if;

  select g.scheduled_at, g.is_away, g.league_id, g.interleague_org_id, g.external_team_name,
         g.status, g.proposed_scheduled_at
  into v_game_iso, v_is_away, v_league_id, v_interleague_org_id, v_external_team,
       v_game_status, v_standing
  from public.games g where g.id = v_req.game_id;

  -- Only release the game to 'scheduled' if no other pending request remains.
  -- (Defensive — usually only one pending request exists at a time.)
  update public.games set
    status     = 'scheduled',
    updated_at = now()
  where id = v_req.game_id
    -- 0091: NEVER on a pending_interleague game. A partner declining the host's
    -- different time on a game they never agreed to must leave it pending —
    -- flipping it to 'scheduled' would CONFIRM the original time, which the
    -- partner had already rejected by countering. The game returns to the
    -- host with the partner's own proposal still standing. For every other
    -- status (a confirmed game in reschedule_pending) behavior is unchanged.
    and status <> 'pending_interleague'
    -- 0094: NEVER on a cancelled game either. A rained-out interleague game is
    -- rescheduled DIRECTLY (host proposes a makeup time while the game stays
    -- cancelled; the partner's accept sets it 'scheduled' at the new time). A
    -- partner declining that makeup must leave the game cancelled — flipping
    -- it to 'scheduled' would quietly revive a game that was rained out, at a
    -- time nobody is going to play. Same class of bug as the pending-game
    -- decline above. Every other status behaves exactly as before.
    and status <> 'cancelled'
    and not exists (
      select 1 from public.interleague_reschedule_requests
      where game_id = v_req.game_id
        and status = 'pending'
        and id <> v_req.id
    );

  update public.interleague_reschedule_requests set
    status     = 'declined',
    updated_at = now()
  where id = v_req.id;

  if v_req.requested_by_user_id is not null then
    select p.email, p.full_name into v_sender_email, v_sender_name
    from public.profiles p where p.id = v_req.requested_by_user_id;
  end if;

  select i.recipient_email into v_recipient_email
  from public.interleague_invites i
  where i.interleague_org_id = v_interleague_org_id
    and i.season_id = v_league_id
    and i.status = 'accepted'
  order by i.created_at desc limit 1;

  select o.name into v_org_name from public.interleague_orgs o
    where o.id = v_interleague_org_id;
  select ht.name, d.name into v_home_team, v_division
  from public.teams ht
  join public.divisions d on d.id = ht.division_id
  join public.games g on g.home_team_id = ht.id
  where g.id = v_req.game_id;
  select l.name, l.season into v_season_name, v_season_label
  from public.leagues l where l.id = v_league_id;

  return jsonb_build_object(
    'request_id',        v_req.id,
    'game_id',           v_req.game_id,
    'game_scheduled_at', v_game_iso,
    'is_away',           v_is_away,
    'home_team',         v_home_team,
    'external_team',     v_external_team,
    'division',          v_division,
    'sender_email',      v_sender_email,
    'sender_name',       v_sender_name,
    'recipient_email',   v_recipient_email,
    'org_name',          v_org_name,
    'season_name',       v_season_name,
    'season_label',      v_season_label,
    'requested_by_side', case when v_req.requested_by_user_id is not null
                           then 'fieldslate' else 'external' end,
    -- 0091: for the email on a not-yet-agreed game.
    'was_pending',       v_game_status = 'pending_interleague',
    'standing_proposal', v_standing
  );
end;
$$;
