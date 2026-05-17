-- Public read-only schedule view: each accepted invite gets a long-lived token
-- distinct from the original invite token (which expires after the response
-- is submitted). The non-FieldSlate admin can bookmark /schedule/[token] and
-- always see the current state of the games.

alter table public.interleague_invites
  add column schedule_token text;

-- Backfill existing accepted invites with a fresh token so old recipients
-- get a working link too.
update public.interleague_invites
set schedule_token = gen_random_uuid()::text
where schedule_token is null
  and status = 'accepted';

create unique index interleague_invites_schedule_token_idx
  on public.interleague_invites (schedule_token)
  where schedule_token is not null;

-- ── accept_interleague_invite now ensures a schedule_token and returns it ────

create or replace function public.accept_interleague_invite(
  p_token     text,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.interleague_invites%rowtype;
  v_response_id uuid;
  v_resp jsonb;
  v_game_id uuid;
  v_team text;
  v_action text;
  v_venue text;
  v_proposed timestamptz;
  v_match int;
  v_total int := 0;
  v_accepted int := 0;
  v_countered int := 0;
  v_sender_email text;
  v_sender_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
  v_schedule_token text;
begin
  select * into v_invite
  from public.interleague_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0001';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending' using errcode = 'P0001';
  end if;

  insert into public.interleague_invite_responses (invite_id, team_names, selected_slots, status)
  values (v_invite.id, coalesce(p_responses, '[]'::jsonb), '[]'::jsonb, 'accepted')
  returning id into v_response_id;

  for v_resp in
    select * from jsonb_array_elements(coalesce(p_responses, '[]'::jsonb))
  loop
    v_game_id  := nullif(v_resp->>'game_id', '')::uuid;
    v_team     := trim(coalesce(v_resp->>'team_name', ''));
    v_action   := coalesce(v_resp->>'action', 'accept');
    v_venue    := nullif(trim(coalesce(v_resp->>'venue_name', '')), '');
    v_proposed := nullif(v_resp->>'proposed_scheduled_at', '')::timestamptz;

    if v_game_id is null or length(v_team) = 0 then
      continue;
    end if;

    select 1 into v_match
    from public.games g
    where g.id = v_game_id
      and g.league_id = v_invite.season_id
      and g.interleague_org_id = v_invite.interleague_org_id
      and g.status = 'pending_interleague'
    limit 1;
    if not found then
      continue;
    end if;

    v_total := v_total + 1;

    if v_action = 'accept' then
      update public.games set
        external_team_name  = v_team,
        proposed_venue_name = coalesce(v_venue, proposed_venue_name),
        status              = 'scheduled',
        updated_at          = now()
      where id = v_game_id;
      v_accepted := v_accepted + 1;
    else
      update public.games set
        external_team_name    = v_team,
        proposed_venue_name   = coalesce(v_venue, proposed_venue_name),
        proposed_scheduled_at = coalesce(v_proposed, proposed_scheduled_at),
        updated_at            = now()
      where id = v_game_id;
      v_countered := v_countered + 1;
    end if;
  end loop;

  update public.interleague_invites
  set status         = 'accepted',
      schedule_token = coalesce(schedule_token, gen_random_uuid()::text),
      updated_at     = now()
  where id = v_invite.id
  returning schedule_token into v_schedule_token;

  select p.email, p.full_name into v_sender_email, v_sender_name
  from public.profiles p where p.id = v_invite.sender_user_id;
  select o.name into v_org_name
  from public.interleague_orgs o where o.id = v_invite.interleague_org_id;
  select l.name, l.season into v_season_name, v_season_label
  from public.leagues l where l.id = v_invite.season_id;

  return jsonb_build_object(
    'invite_id',       v_invite.id,
    'response_id',     v_response_id,
    'total',           v_total,
    'accepted',        v_accepted,
    'countered',       v_countered,
    'sender_email',    v_sender_email,
    'sender_name',     v_sender_name,
    'org_name',        v_org_name,
    'season_name',     v_season_name,
    'season_label',    v_season_label,
    'recipient_email', v_invite.recipient_email,
    'schedule_token',  v_schedule_token
  );
end;
$$;

grant execute on function public.accept_interleague_invite(text, jsonb) to anon, authenticated;

-- ── Public schedule read RPC ──────────────────────────────────────────────────

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
                                   then jsonb_build_object('name', v.name)
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

grant execute on function public.get_interleague_schedule_by_token(text) to anon, authenticated;
