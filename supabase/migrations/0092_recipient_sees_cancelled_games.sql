-- A CANCELLED interleague game must not vanish from the partner's schedule.
--
-- THE DEFECT. `get_interleague_schedule_by_token` returns `games` filtered to
-- ('scheduled', 'reschedule_pending'). Cancelling a game therefore removed it
-- from the partner's page entirely: no row, no message, nothing. Their league
-- can turn up to a field for a game that was called off. Zero cancelled
-- INTERLEAGUE games exist today (20 cancelled games live, all intra-division),
-- so this is preventive — but every cancel path is a bare client-side
-- `games.update({status:'cancelled'})` and NONE of them filters interleague
-- out, so one rainout reaches it.
--
-- A NEW KEY, NOT A WIDER `games` FILTER. `games` means "confirmed and going
-- ahead", and it has a second reader: /api/invite/[token]/accept builds the
-- acceptance confirmation email from it. That RPC returns every game for the
-- (season, partner) pair rather than only the newly accepted ones, so widening
-- the filter would list a previously cancelled game in an email telling the
-- partner what they had just agreed to. `cancelled_games` mirrors 0090's
-- `countered_games` exactly: a new key old code ignores, each reader opting in.
--
-- WHAT THIS DOES NOT DO — and the sentence belongs next to the feature, not
-- buried: THIS MAKES THE TRUTH AVAILABLE, IT DOES NOT DELIVER IT. Nothing
-- emails the partner when a game is cancelled. The page is now honest for a
-- partner who opens it; a partner who does not open it still learns nothing.
--
-- DELIBERATELY STILL HIDDEN: unanswered `pending_interleague` games (they
-- arrive through the invite link, and showing an unagreed game on the
-- confirmed-schedule page would misrepresent it); `postponed`, `in_progress`
-- and `completed` (no code path writes any of them).
--
-- Body is VERBATIM from 0091 except the `cancelled_games` key marked "0092".

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
    ),
    -- 0092: games that were CANCELLED. A cancelled game used to leave the
    -- `games` filter and simply disappear from the partner's schedule — no
    -- row, no message — so the only way for them to learn a game was off was
    -- an email nobody sends (see the header). A SEPARATE KEY, not a widening
    -- of `games`: that key means "confirmed and going ahead", and the invite
    -- acceptance route builds its confirmation email from it, so a cancelled
    -- game inside it would be listed to the partner as one they just agreed
    -- to. Same mechanism as 0090's `countered_games`: old page code ignores a
    -- key it does not know.
    'cancelled_games', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',                  g.id,
          'status',              g.status,
          'scheduled_at',        g.scheduled_at,
          'is_away',             g.is_away,
          'external_team_name',  g.external_team_name,
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
        order by g.scheduled_at asc, g.id asc
      ), '[]'::jsonb)
      from public.games g
      join public.teams ht on ht.id = g.home_team_id
      join public.divisions d on d.id = ht.division_id
      left join public.venues v on v.id = g.venue_id
      where g.league_id = v_invite.season_id
        and g.interleague_org_id = v_invite.interleague_org_id
        and g.status = 'cancelled'
    )
  ) into v_result;

  return v_result;
end;
$$;
