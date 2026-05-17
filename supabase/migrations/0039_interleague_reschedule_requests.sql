-- Reschedule flow for confirmed interleague games. Either side can request a
-- move; the other side accepts, declines, or counter-proposes. The game's
-- status flips to 'reschedule_pending' while a request is outstanding and back
-- to 'scheduled' once resolved. Counter-proposals supersede the prior request
-- (marking the old one 'declined') and create a fresh one in the other
-- direction.

-- Extend status check to allow the new pending state.

alter table public.games drop constraint games_status_check;
alter table public.games
  add constraint games_status_check
  check (status in (
    'scheduled',
    'in_progress',
    'completed',
    'cancelled',
    'postponed',
    'pending_interleague',
    'reschedule_pending'
  ));

-- Requests table. `requested_by_user_id` is set when a FieldSlate admin
-- initiated, NULL when the external recipient initiated. `token` is for the
-- public action URL (only used for admin→external direction but generated
-- always for simplicity).

create table public.interleague_reschedule_requests (
  id                    uuid        primary key default gen_random_uuid(),
  game_id               uuid        not null references public.games(id) on delete cascade,
  token                 text        not null unique default gen_random_uuid()::text,
  requested_by_user_id  uuid        references auth.users(id) on delete set null,
  proposed_scheduled_at timestamptz not null,
  proposed_venue_name   text,
  note                  text,
  status                text        not null default 'pending'
                        check (status in ('pending', 'accepted', 'declined')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index interleague_reschedule_requests_game_idx
  on public.interleague_reschedule_requests (game_id);

create index interleague_reschedule_requests_token_idx
  on public.interleague_reschedule_requests (token);

create index interleague_reschedule_requests_pending_idx
  on public.interleague_reschedule_requests (game_id)
  where status = 'pending';

alter table public.interleague_reschedule_requests enable row level security;

create policy "League owners manage reschedule requests"
  on public.interleague_reschedule_requests for all
  using (
    game_id in (
      select g.id
      from public.games g
      join public.leagues l on l.id = g.league_id
      where l.owner_id = auth.uid()
    )
  )
  with check (
    game_id in (
      select g.id
      from public.games g
      join public.leagues l on l.id = g.league_id
      where l.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.interleague_reschedule_requests to authenticated;

create trigger interleague_reschedule_requests_set_updated_at
  before update on public.interleague_reschedule_requests
  for each row execute function public.set_updated_at();

-- ── Public-token RPCs ────────────────────────────────────────────────────────

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
                                 then jsonb_build_object('name', v.name)
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

grant execute on function public.get_reschedule_request_by_token(text) to anon, authenticated;

-- Public accept: external accepts the FieldSlate admin's request.

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

  select g.scheduled_at, g.id, g.is_away, g.external_team_name,
         g.proposed_venue_name, g.league_id, g.interleague_org_id
  into v_old_iso, v_game_id, v_is_away, v_external_team,
       v_old_venue, v_league_id, v_interleague_org_id
  from public.games g where g.id = v_req.game_id for update;

  -- Apply the proposed change. For away games we update proposed_venue_name
  -- (the venue we display); for home games we leave venue_id alone since the
  -- request couldn't have changed which of our venues it's at.
  update public.games set
    scheduled_at        = v_req.proposed_scheduled_at,
    proposed_venue_name = coalesce(v_req.proposed_venue_name, proposed_venue_name),
    status              = 'scheduled',
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
                            then 'fieldslate' else 'external' end
  );
end;
$$;

grant execute on function public.accept_reschedule_request_by_token(text) to anon, authenticated;

-- Public decline: external declines the admin's request. Game stays put.

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

  select g.scheduled_at, g.is_away, g.league_id, g.interleague_org_id, g.external_team_name
  into v_game_iso, v_is_away, v_league_id, v_interleague_org_id, v_external_team
  from public.games g where g.id = v_req.game_id;

  -- Only release the game to 'scheduled' if no other pending request remains.
  -- (Defensive — usually only one pending request exists at a time.)
  update public.games set
    status     = 'scheduled',
    updated_at = now()
  where id = v_req.game_id
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
                           then 'fieldslate' else 'external' end
  );
end;
$$;

grant execute on function public.decline_reschedule_request_by_token(text) to anon, authenticated;

-- Public counter: external counters the admin's request. Old request is
-- marked 'declined', new request is created in the external→admin direction.
-- Game stays 'reschedule_pending'.

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
  if p_proposed_scheduled_at is null then
    raise exception 'invalid_proposal' using errcode = 'P0001';
  end if;

  select g.is_away, g.league_id, g.interleague_org_id, g.external_team_name
  into v_is_away, v_league_id, v_interleague_org_id, v_external_team
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

  -- Game stays in 'reschedule_pending' — no UPDATE needed.

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
    'season_label',            v_season_label
  );
end;
$$;

grant execute on function public.counter_reschedule_request_by_token(text, timestamptz, text, text) to anon, authenticated;

-- External initiates a brand-new reschedule request from /schedule/[token].
-- We authenticate via the schedule_token on the parent invite, then create the
-- request keyed to a game that belongs to that invite's org+season.

create or replace function public.create_reschedule_request_by_schedule_token(
  p_schedule_token         text,
  p_game_id                uuid,
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
  v_invite public.interleague_invites%rowtype;
  v_game public.games%rowtype;
  v_new_id uuid;
  v_sender_email text;
  v_sender_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
  v_home_team text;
  v_division text;
  v_proposed_venue text;
begin
  select * into v_invite
  from public.interleague_invites
  where schedule_token = p_schedule_token;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0001';
  end if;
  if p_proposed_scheduled_at is null then
    raise exception 'invalid_proposal' using errcode = 'P0001';
  end if;

  select * into v_game from public.games where id = p_game_id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if v_game.league_id <> v_invite.season_id
     or v_game.interleague_org_id <> v_invite.interleague_org_id then
    raise exception 'game_not_on_schedule' using errcode = 'P0001';
  end if;
  if v_game.status <> 'scheduled' then
    raise exception 'game_not_reschedulable' using errcode = 'P0001';
  end if;
  if v_game.scheduled_at <= now() then
    raise exception 'game_in_past' using errcode = 'P0001';
  end if;

  v_proposed_venue := nullif(trim(coalesce(p_proposed_venue_name, '')), '');

  insert into public.interleague_reschedule_requests
    (game_id, requested_by_user_id, proposed_scheduled_at, proposed_venue_name, note)
  values
    (v_game.id, null, p_proposed_scheduled_at, v_proposed_venue,
     nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_new_id;

  update public.games set
    status     = 'reschedule_pending',
    updated_at = now()
  where id = v_game.id;

  select p.email, p.full_name into v_sender_email, v_sender_name
  from public.profiles p where p.id = v_invite.sender_user_id;
  select o.name into v_org_name
  from public.interleague_orgs o where o.id = v_invite.interleague_org_id;
  select ht.name, d.name into v_home_team, v_division
  from public.teams ht
  join public.divisions d on d.id = ht.division_id
  where ht.id = v_game.home_team_id;
  select l.name, l.season into v_season_name, v_season_label
  from public.leagues l where l.id = v_invite.season_id;

  return jsonb_build_object(
    'request_id',            v_new_id,
    'game_id',               v_game.id,
    'proposed_scheduled_at', p_proposed_scheduled_at,
    'proposed_venue_name',   v_proposed_venue,
    'note',                  nullif(trim(coalesce(p_note, '')), ''),
    'is_away',               v_game.is_away,
    'home_team',             v_home_team,
    'external_team',         v_game.external_team_name,
    'division',              v_division,
    'sender_email',          v_sender_email,
    'sender_name',           v_sender_name,
    'org_name',              v_org_name,
    'season_name',           v_season_name,
    'season_label',          v_season_label
  );
end;
$$;

grant execute on function public.create_reschedule_request_by_schedule_token(text, uuid, timestamptz, text, text) to anon, authenticated;
