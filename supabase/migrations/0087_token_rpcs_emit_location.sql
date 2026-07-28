-- Partner-facing venue labels: the three token RPCs now EMIT the venue's
-- location alongside its name, so TypeScript can render the qualified
-- "Complex — Field" label (qualifiedVenueLabel) for partners exactly as the
-- internal chooser surfaces do.
--
-- Why in the RPC and not a direct query: these RPCs feed ANONYMOUS surfaces
-- (public token schedule page, public invite page, acceptance-confirmation
-- email), and `anon` has NO grant on `locations`. A direct anon embed of
-- location would return null and the label would silently degrade to the bare
-- name in a partner's inbox. The RPCs are SECURITY DEFINER, so they can read
-- locations without exposing the table to anon — that is exactly why the plan
-- routes location through them.
--
-- FORMATTING STAYS IN TYPESCRIPT. Each RPC only EMITS a nested location object
-- ({ name } or null) alongside the existing venue name; the one shared
-- qualifiedVenueLabel formatter does all concatenation. Emitting the nested
-- shape (not a flat location_name) means the RPC results and the authenticated
-- direct-query embeds share ONE formatter signature.
--
-- The ONLY change to each function body is the venue emit:
--   before: jsonb_build_object('name', v.name)
--   after:  jsonb_build_object('name', v.name, 'location', <{name} | null>)
-- where the location subquery returns null when v.location_id is null (a venue
-- with no location behaves exactly as today). Everything else is verbatim from
-- 0037 / 0074 / 0039. All three are updated together so no token RPC is left
-- with a different venue shape (a silent-degradation trap for the next person
-- who adds venue display to the reschedule page, whose consumer renders no
-- venue today).

-- ── get_interleague_schedule_by_token (was 0037) ─────────────────────────────
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
      select jsonb_build_object('full_name', p.full_name, 'email', p.email)
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
        and g.status = 'scheduled'
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ── get_interleague_invite_by_token (was 0074) ───────────────────────────────
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
      'recipient_email', v_invite.recipient_email
    ),
    'scheduled_game_count', (
      select count(*)
      from public.games g
      where g.league_id = v_invite.season_id
        and g.interleague_org_id = v_invite.interleague_org_id
        and g.status = 'scheduled'
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

-- ── get_reschedule_request_by_token (was 0039) ───────────────────────────────
-- Its consumer (/reschedule/[token]) renders NO venue today, so this changes
-- nothing user-visible now. Updated for CONSISTENCY: all three token RPCs must
-- share one venue shape, so a future venue display on that page can't silently
-- degrade to the bare name for a reason no one would suspect.
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
    )
  ) into v_result;
  return v_result;
end;
$$;
