-- "Propose a different time" on counter-proposed interleague games, and the
-- three places the reschedule-request flow was wrong for a game not yet agreed.
--
-- THE FEATURE. When a partner league counter-proposes a pending game, the host
-- could only accept it, keep the original, Edit (which CONFIRMED a time the
-- partner never agreed to) or decline. Now the host can send a different time
-- back. It reuses interleague_reschedule_requests: the host's proposal is a
-- request row (requested_by_user_id = the host), its token is emailed to the
-- partner, and the GAME STAYS `pending_interleague` until someone agrees. The
-- row insert itself happens in the authenticated host route under RLS; this
-- migration changes only what the partner's token functions do with it.
--
-- WHY pending_interleague AND NOT reschedule_pending. `countsAsScheduledGame`
-- (game-days.ts) lists pending_interleague as "not a real game" and does not
-- know reschedule_pending at all, so flipping an unagreed game there would
-- start counting it as scheduled in exports and reports. Staying pending
-- changes the meaning for no existing reader.
--
-- THE MODEL for a pending game, one place per fact:
--   games.proposed_*            — the PARTNER's newest proposal (set by the
--                                  invite response, and now by a token counter)
--   pending request, host row   — the HOST's outstanding proposal (awaiting partner)
--   pending request, partner row— the partner's counter-back (awaiting host);
--                                  mirrored into games.proposed_* in the same
--                                  statement so the host's existing actions
--                                  ("Accept proposal" etc.) apply the latest time
-- Past request rows (declined/accepted) are the negotiation's history.
--
-- ── The three fixes, and whether each is SHARED or BRANCHED ─────────────────
--
-- 1. decline_reschedule_request_by_token set the game to 'scheduled'. On a
--    pending game that confirms the original time the partner already
--    rejected. BRANCHED on game status: the UPDATE now also requires
--    `status <> 'pending_interleague'`. Every other status behaves exactly as
--    before (the harness compares old and new function outcomes on a
--    reschedule_pending game).
--
-- 2. accept_reschedule_request_by_token left games.proposed_scheduled_at in
--    place, so a partner's stale counter survived on an agreed game. SHARED:
--    the UPDATE clears it for every game. On confirmed games the column is
--    always null already (no path sets it on scheduled/reschedule_pending;
--    live count 0), so the shared change is a no-op there — asserted, not
--    assumed, by the old-vs-new comparison.
--
-- 3. counter_reschedule_request_by_token inserted requested_by_user_id = null
--    whoever called it. SHARED, as a guard in all three token functions: a
--    token may act ONLY on a host-authored request. Tokens are only ever
--    emailed for host rows, so no reachable flow changes, but the RPCs no
--    longer rely on that. Behind the guard, "the caller is the partner" is
--    true, so the null attribution is correct by construction. In addition,
--    BRANCHED: countering on a pending game mirrors the new time into
--    games.proposed_* (see THE MODEL).
--
-- READS. get_reschedule_request_by_token emits the game's status, its standing
-- proposed time and a proposal_count. get_interleague_schedule_by_token emits,
-- per game, the host's open proposal WITH its token (host rows only) and a
-- proposal_count, so the partner can answer from the schedule page.
--
-- NOT CHANGED: create_reschedule_request_by_schedule_token (partner-created
-- requests) still requires status = 'scheduled' — a partner answers a pending
-- game through the host's request token, never by opening a new request.
--
-- BACKWARD COMPATIBLE WITH THE CODE DEPLOYED WHEN APPLIED: zero request rows
-- exist; every read change is a new key; the guard refuses only token uses
-- that no email ever produced.
--
-- Bodies are verbatim from 0039 (token actions), 0087 (request read) and 0090
-- (schedule read) except where marked "0091".

-- ── accept_reschedule_request_by_token (was 0039) ───────────────────────────
create or replace function public.accept_reschedule_request_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.interleague_reschedule_requests%rowtype;
  v_old_iso timestamptz;
  v_old_venue text;
  v_sender_email text;
  v_sender_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
  v_recipient_email text;
  v_game_id uuid;
  v_is_away boolean;
  v_external_team text;
  v_home_team text;
  v_division text;
  v_league_id uuid;
  v_interleague_org_id uuid;
  v_game_status text;
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

  select g.scheduled_at, g.id, g.is_away, g.external_team_name,
         g.proposed_venue_name, g.league_id, g.interleague_org_id, g.status
  into v_old_iso, v_game_id, v_is_away, v_external_team,
       v_old_venue, v_league_id, v_interleague_org_id, v_game_status
  from public.games g where g.id = v_req.game_id for update;

  -- Apply the proposed change. For away games we update proposed_venue_name
  -- (the venue we display); for home games we leave venue_id alone since the
  -- request couldn't have changed which of our venues it's at.
  update public.games set
    scheduled_at        = v_req.proposed_scheduled_at,
    proposed_venue_name = coalesce(v_req.proposed_venue_name, proposed_venue_name),
    status              = 'scheduled',
    -- 0091: the game is now agreed, so no proposal is outstanding on it. On a
    -- pending_interleague game this clears the partner's earlier counter,
    -- which would otherwise survive on the row and keep the game listed as
    -- "counter-proposed". On a confirmed game the column is already null (no
    -- path sets it on a scheduled or reschedule_pending game), so this is a
    -- no-op there — proven by the harness's old-vs-new comparison.
    proposed_scheduled_at = null,
    updated_at          = now()
  where id = v_req.game_id;

  update public.interleague_reschedule_requests set
    status     = 'accepted',
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
  where g.id = v_game_id;
  select l.name, l.season into v_season_name, v_season_label
  from public.leagues l where l.id = v_league_id;

  return jsonb_build_object(
    'request_id',         v_req.id,
    'game_id',            v_game_id,
    'old_scheduled_at',   v_old_iso,
    'new_scheduled_at',   v_req.proposed_scheduled_at,
    'proposed_venue_name',v_req.proposed_venue_name,
    'old_venue_name',     v_old_venue,
    'is_away',            v_is_away,
    'home_team',          v_home_team,
    'external_team',      v_external_team,
    'division',           v_division,
    'sender_email',       v_sender_email,
    'sender_name',        v_sender_name,
    'recipient_email',    v_recipient_email,
    'org_name',           v_org_name,
    'season_name',        v_season_name,
    'season_label',       v_season_label,
    'requested_by_side',  case when v_req.requested_by_user_id is not null
                            then 'fieldslate' else 'external' end,
    -- 0091: lets the route word the email for a not-yet-agreed game.
    'was_pending',        v_game_status = 'pending_interleague'
  );
end;
$$;

-- ── decline_reschedule_request_by_token (was 0039) ──────────────────────────
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

-- ── counter_reschedule_request_by_token (was 0039) ──────────────────────────
create or replace function public.counter_reschedule_request_by_token(
  p_token                  text,
  p_proposed_scheduled_at  timestamptz,
  p_proposed_venue_name    text,
  p_note                   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.interleague_reschedule_requests%rowtype;
  v_new_id uuid;
  v_sender_email text;
  v_sender_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
  v_home_team text;
  v_external_team text;
  v_division text;
  v_is_away boolean;
  v_league_id uuid;
  v_interleague_org_id uuid;
  v_proposed_venue text;
  v_game_status text;
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
  if p_proposed_scheduled_at is null then
    raise exception 'invalid_proposal' using errcode = 'P0001';
  end if;

  select g.is_away, g.league_id, g.interleague_org_id, g.external_team_name, g.status
  into v_is_away, v_league_id, v_interleague_org_id, v_external_team, v_game_status
  from public.games g where g.id = v_req.game_id;

  v_proposed_venue := nullif(trim(coalesce(p_proposed_venue_name, '')), '');

  -- Decline the old request and create a new one going the other direction.
  update public.interleague_reschedule_requests set
    status     = 'declined',
    updated_at = now()
  where id = v_req.id;

  insert into public.interleague_reschedule_requests
    (game_id, requested_by_user_id, proposed_scheduled_at, proposed_venue_name, note)
  values
    (v_req.game_id, null, p_proposed_scheduled_at, v_proposed_venue,
     nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_new_id;

  -- 0091: on a game not yet agreed, the partner's newest proposal is ALSO the
  -- game's standing counter-proposal. games.proposed_* is what the host's
  -- counter-proposed list, "Accept proposal" and the partner's schedule page
  -- read, so it must track the latest proposal — otherwise a later decline or
  -- withdrawal would resurface an older time the partner already moved past.
  -- Confirmed games (reschedule_pending) are untouched, exactly as before.
  if v_game_status = 'pending_interleague' then
    update public.games set
      proposed_scheduled_at = p_proposed_scheduled_at,
      proposed_venue_name   = coalesce(v_proposed_venue, proposed_venue_name),
      updated_at            = now()
    where id = v_req.game_id;
  end if;

  -- A confirmed game stays in 'reschedule_pending' — no UPDATE needed.
  -- (0091: reworded; a pending game's only update is the mirror above.)

  if v_req.requested_by_user_id is not null then
    select p.email, p.full_name into v_sender_email, v_sender_name
    from public.profiles p where p.id = v_req.requested_by_user_id;
  end if;

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
    'old_request_id',          v_req.id,
    'new_request_id',          v_new_id,
    'game_id',                 v_req.game_id,
    'proposed_scheduled_at',   p_proposed_scheduled_at,
    'proposed_venue_name',     v_proposed_venue,
    'note',                    nullif(trim(coalesce(p_note, '')), ''),
    'is_away',                 v_is_away,
    'home_team',               v_home_team,
    'external_team',           v_external_team,
    'division',                v_division,
    'sender_email',            v_sender_email,
    'sender_name',             v_sender_name,
    'org_name',                v_org_name,
    'season_name',             v_season_name,
    'season_label',            v_season_label,
    -- 0091
    'was_pending',             v_game_status = 'pending_interleague'
  );
end;
$$;

-- ── get_reschedule_request_by_token (was 0087) ──────────────────────────────
create or replace function public.get_reschedule_request_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.interleague_reschedule_requests%rowtype;
  v_result jsonb;
begin
  select * into v_req
  from public.interleague_reschedule_requests
  where token = p_token;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'request', jsonb_build_object(
      'id',                    v_req.id,
      'status',                v_req.status,
      'proposed_scheduled_at', v_req.proposed_scheduled_at,
      'proposed_venue_name',   v_req.proposed_venue_name,
      'note',                  v_req.note,
      'created_at',            v_req.created_at,
      'requested_by_side',     case when v_req.requested_by_user_id is not null
                                 then 'fieldslate' else 'external' end
    ),
    'sender', case when v_req.requested_by_user_id is not null then (
      select jsonb_build_object('full_name', p.full_name, 'email', p.email)
      from public.profiles p where p.id = v_req.requested_by_user_id
    ) else null end,
    'game', (
      select jsonb_build_object(
        'id',                  g.id,
        -- 0091: the page words a not-yet-agreed game differently, and shows the
        -- partner's own standing proposal next to the host's.
        'status',                g.status,
        'proposed_scheduled_at', g.proposed_scheduled_at,
        'scheduled_at',        g.scheduled_at,
        'is_away',             g.is_away,
        'external_team_name',  g.external_team_name,
        'proposed_venue_name', g.proposed_venue_name,
        'home_team',           jsonb_build_object('name', ht.name),
        'division',            jsonb_build_object('name', d.name),
        'venue',               case when g.venue_id is not null
                                 then jsonb_build_object(
                                   'name', v.name,
                                   'location', (
                                     select jsonb_build_object('name', l.name)
                                     from public.locations l where l.id = v.location_id
                                   )
                                 )
                                 else null end,
        'interleague_org',     (
          select jsonb_build_object('name', o.name)
          from public.interleague_orgs o where o.id = g.interleague_org_id
        )
      )
      from public.games g
      join public.teams ht on ht.id = g.home_team_id
      join public.divisions d on d.id = ht.division_id
      left join public.venues v on v.id = g.venue_id
      where g.id = v_req.game_id
    ),
    'season', (
      select jsonb_build_object('name', l.name, 'season', l.season)
      from public.leagues l
      join public.games g on g.league_id = l.id
      where g.id = v_req.game_id
    ),
    -- 0091: how many proposals this game has exchanged through requests, so
    -- both sides can see how long a negotiation has run. No cap is enforced.
    'proposal_count', (
      select count(*) from public.interleague_reschedule_requests r
      where r.game_id = v_req.game_id
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ── get_interleague_schedule_by_token (was 0090) ────────────────────────────
create or replace function public.get_interleague_schedule_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.interleague_invites%rowtype;
  v_result jsonb;
begin
  select * into v_invite
  from public.interleague_invites
  where schedule_token = p_token;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'sender', (
      -- 0090: org_name, so the page can name the league it is waiting on.
      select jsonb_build_object('full_name', p.full_name, 'email', p.email,
                                'org_name', p.org_name)
      from public.profiles p where p.id = v_invite.sender_user_id
    ),
    'org', (
      select jsonb_build_object('name', o.name)
      from public.interleague_orgs o where o.id = v_invite.interleague_org_id
    ),
    'season', (
      select jsonb_build_object('name', l.name, 'season', l.season)
      from public.leagues l where l.id = v_invite.season_id
    ),
    'games', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                  g.id,
          'status',              g.status,
          'open_host_proposal',  (
            -- 0091: the host's outstanding proposal on this game, if any, with
            -- ITS token so the partner can answer from the schedule page. Only
            -- HOST-authored rows are emitted: the schedule token's holder is
            -- the partner, the intended recipient of exactly those tokens. A
            -- partner-authored row's token is never exposed.
            select jsonb_build_object(
              'token',                 r.token,
              'proposed_scheduled_at', r.proposed_scheduled_at,
              'proposed_venue_name',   r.proposed_venue_name,
              'note',                  r.note,
              'created_at',            r.created_at
            )
            from public.interleague_reschedule_requests r
            where r.game_id = g.id
              and r.status = 'pending'
              and r.requested_by_user_id is not null
            order by r.created_at desc
            limit 1
          ),
          'scheduled_at',        g.scheduled_at,
          'is_away',             g.is_away,
          'external_team_name',  g.external_team_name,
          'proposed_venue_name', g.proposed_venue_name,
          'home_team',           jsonb_build_object('name', ht.name),
          'division',            jsonb_build_object('name', d.name),
          'venue',               case when g.venue_id is not null
                                   then jsonb_build_object(
                                     'name', v.name,
                                     'location', (
                                       select jsonb_build_object('name', l.name)
                                       from public.locations l where l.id = v.location_id
                                     )
                                   )
                                   else null end
        )
        order by g.scheduled_at asc
      ), '[]'::jsonb)
      from public.games g
      join public.teams ht on ht.id = g.home_team_id
      join public.divisions d on d.id = ht.division_id
      left join public.venues v on v.id = g.venue_id
      where g.league_id = v_invite.season_id
        and g.interleague_org_id = v_invite.interleague_org_id
        -- 0090: a confirmed game with a reschedule request outstanding is
        -- still the partner's confirmed game; it must not vanish.
        and g.status in ('scheduled', 'reschedule_pending')
    ),
    -- 0090: games the recipient countered that the host has not resolved.
    'countered_games', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                    g.id,
          'status',                g.status,
          'open_host_proposal',    (
            -- 0091: the host's outstanding proposal on this game, if any, with
            -- ITS token so the partner can answer from the schedule page. Only
            -- HOST-authored rows are emitted: the schedule token's holder is
            -- the partner, the intended recipient of exactly those tokens. A
            -- partner-authored row's token is never exposed.
            select jsonb_build_object(
              'token',                 r.token,
              'proposed_scheduled_at', r.proposed_scheduled_at,
              'proposed_venue_name',   r.proposed_venue_name,
              'note',                  r.note,
              'created_at',            r.created_at
            )
            from public.interleague_reschedule_requests r
            where r.game_id = g.id
              and r.status = 'pending'
              and r.requested_by_user_id is not null
            order by r.created_at desc
            limit 1
          ),
          -- 0091: proposals exchanged through requests (the partner's first
          -- counter on the invite is not a request row).
          'proposal_count',        (
            select count(*) from public.interleague_reschedule_requests r
            where r.game_id = g.id
          ),
          'scheduled_at',          g.scheduled_at,
          'proposed_scheduled_at', g.proposed_scheduled_at,
          'proposed_venue_name',   g.proposed_venue_name,
          'is_away',               g.is_away,
          'external_team_name',    g.external_team_name,
          'home_team',             jsonb_build_object('name', ht.name),
          'division',              jsonb_build_object('name', d.name),
          'venue',                 case when g.venue_id is not null
                                     then jsonb_build_object(
                                       'name', v.name,
                                       'location', (
                                         select jsonb_build_object('name', l.name)
                                         from public.locations l where l.id = v.location_id
                                       )
                                     )
                                     else null end
        )
        order by coalesce(g.proposed_scheduled_at, g.scheduled_at) asc, g.id asc
      ), '[]'::jsonb)
      from public.games g
      join public.teams ht on ht.id = g.home_team_id
      join public.divisions d on d.id = ht.division_id
      left join public.venues v on v.id = g.venue_id
      where g.league_id = v_invite.season_id
        and g.interleague_org_id = v_invite.interleague_org_id
        and g.status = 'pending_interleague'
        and g.external_team_name is not null
    )
  ) into v_result;

  return v_result;
end;
$$;
