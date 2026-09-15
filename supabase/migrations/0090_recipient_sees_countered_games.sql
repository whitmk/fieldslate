-- A partner league that COUNTER-PROPOSES a game must still be able to see it.
--
-- THE DEFECT. On the public invite page a recipient can accept, decline or
-- counter each game. `accept_interleague_invite` then marks the whole invite
-- `accepted` — even when some games were only countered — so the invite link
-- shows "already accepted" and the form is gone. The countered games stay
-- `pending_interleague`, and the live schedule page (this RPC) returned only
-- `status = 'scheduled'`. From the moment they countered until the host acted,
-- the recipient had NO view of those games anywhere: not the invite page, not
-- the schedule page, and the confirmation email gave only a count.
--
-- The same filter also hid a CONFIRMED game while a reschedule request was
-- outstanding on it (`reschedule_pending`, set by both reschedule-request
-- creators), i.e. the game disappeared from the partner's schedule at exactly
-- the moment they were asked to respond about it. Zero live rows today.
--
-- THE MECHANISM, and why the invite status is NOT changed. Marking a partly
-- countered invite something other than `accepted` would ripple through the
-- 0074/0075 supersede rules, the dashboard badge, and schedule_token issuance
-- (only accepted invites get one). Instead the invite stays accepted and:
--
--   get_interleague_schedule_by_token
--     * `games` now carries a `status` key and includes `reschedule_pending`
--       alongside `scheduled` — both are confirmed games the partner agreed to.
--     * NEW key `countered_games`: `pending_interleague` games that carry a
--       recipient response (`external_team_name IS NOT NULL`). That column is
--       written on a pending game ONLY by accept_interleague_invite's counter
--       branch, so the filter is exactly "games this pair's recipient answered
--       with a different time and the host has not resolved".
--     * `sender` gains `org_name` so the page can name the league it is
--       waiting on (the payload's `org` is the RECIPIENT's own org — the naming
--       trap recorded in CLAUDE.md).
--
--   get_interleague_invite_by_token
--     * NEW `schedule_token` — the invite's own token, non-null only once THIS
--       invite was accepted, so the "already accepted" screen can link to the
--       live schedule. A superseded or declined invite never had one. Both
--       tokens were emailed to the same recipient address.
--     * NEW `countered_game_count` for that screen's wording.
--
-- DELIBERATELY NOT WIDENED:
--   * Unanswered `pending_interleague` games (no `external_team_name`) — they
--     belong to an invite that has not been responded to, or were generated
--     after the response; they arrive through an invite, not this page.
--   * `cancelled`, `postponed`, `in_progress`, `completed` — not part of this
--     defect; `cancelled` hiding a rained-out confirmed game is a separate
--     question and is flagged, not decided, here.
--
-- BACKWARD COMPATIBLE WITH THE CODE DEPLOYED WHEN THIS IS APPLIED. `games`
-- only gains rows in a status with zero live rows and a key old code ignores;
-- every other change is a NEW key. Old page code renders nothing new.
--
-- Bodies are verbatim from 0087 except where marked "0090".

-- ── get_interleague_schedule_by_token (was 0087) ────────────────────────────
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

-- ── get_interleague_invite_by_token (was 0087) ──────────────────────────────
create or replace function public.get_interleague_invite_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.interleague_invites%rowtype;
  v_result jsonb;
begin
  select * into v_invite from public.interleague_invites where token = p_token;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'invite', jsonb_build_object(
      'id',              v_invite.id,
      'token',           v_invite.token,
      'status',          v_invite.status,
      'personal_note',   v_invite.personal_note,
      'created_at',      v_invite.created_at,
      'updated_at',      v_invite.updated_at,
      'recipient_email', v_invite.recipient_email,
      -- 0090: non-null only once THIS invite was accepted.
      'schedule_token',  v_invite.schedule_token
    ),
    'scheduled_game_count', (
      select count(*)
      from public.games g
      where g.league_id = v_invite.season_id
        and g.interleague_org_id = v_invite.interleague_org_id
        and g.status = 'scheduled'
    ),
    -- 0090: same predicate as get_interleague_schedule_by_token's countered_games.
    'countered_game_count', (
      select count(*)
      from public.games g
      where g.league_id = v_invite.season_id
        and g.interleague_org_id = v_invite.interleague_org_id
        and g.status = 'pending_interleague'
        and g.external_team_name is not null
    ),
    'sender', (
      select jsonb_build_object('full_name', p.full_name, 'email', p.email)
      from public.profiles p where p.id = v_invite.sender_user_id
    ),
    'org', (
      select jsonb_build_object('id', o.id, 'name', o.name)
      from public.interleague_orgs o where o.id = v_invite.interleague_org_id
    ),
    'season', (
      select jsonb_build_object(
        'id',         l.id,
        'name',       l.name,
        'season',     l.season,
        'start_date', l.start_date,
        'end_date',   l.end_date
      )
      from public.leagues l where l.id = v_invite.season_id
    ),
    'games', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                    g.id,
          'scheduled_at',          g.scheduled_at,
          'is_away',               g.is_away,
          'external_team_name',    g.external_team_name,
          'proposed_scheduled_at', g.proposed_scheduled_at,
          'proposed_venue_name',   g.proposed_venue_name,
          'home_team',             jsonb_build_object('name', ht.name),
          'division',              jsonb_build_object('id', d.id, 'name', d.name),
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
        order by g.is_away asc, g.scheduled_at asc, ht.name asc
      ), '[]'::jsonb)
      from public.games g
      join public.teams ht on ht.id = g.home_team_id
      join public.divisions d on d.id = ht.division_id
      left join public.venues v on v.id = g.venue_id
      where g.league_id = v_invite.season_id
        and g.interleague_org_id = v_invite.interleague_org_id
        and g.status = 'pending_interleague'
    )
  ) into v_result;

  return v_result;
end;
$$;
