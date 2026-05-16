-- Responses to interleague invites, submitted by the invited (non-FieldSlate) admin.
-- Public submission flows through SECURITY DEFINER RPCs below — no direct anon writes.

create table public.interleague_invite_responses (
  id              uuid        primary key default gen_random_uuid(),
  invite_id       uuid        not null references public.interleague_invites(id) on delete cascade,
  team_names      jsonb       not null default '[]'::jsonb,
  selected_slots  jsonb       not null default '[]'::jsonb,
  status          text        not null default 'accepted'
                  check (status in ('accepted', 'declined')),
  created_at      timestamptz not null default now()
);

create index interleague_invite_responses_invite_idx
  on public.interleague_invite_responses (invite_id);

alter table public.interleague_invite_responses enable row level security;

-- Only the original sender of the parent invite can read responses
create policy "Senders can select responses to their invites"
  on public.interleague_invite_responses for select
  using (
    invite_id in (
      select id from public.interleague_invites where sender_user_id = auth.uid()
    )
  );

-- No direct INSERT/UPDATE/DELETE policies — only the SECURITY DEFINER RPC writes here.
-- RLS denies by default with RLS enabled and no matching policy.

grant select on public.interleague_invite_responses to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public read RPC: returns full invite payload by token, or null if not found.
-- SECURITY DEFINER so anonymous callers can read past the sender-only RLS on
-- interleague_invites without exposing the whole table.
-- ─────────────────────────────────────────────────────────────────────────────

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
      'id', v_invite.id,
      'token', v_invite.token,
      'status', v_invite.status,
      'personal_note', v_invite.personal_note,
      'created_at', v_invite.created_at,
      'recipient_email', v_invite.recipient_email
    ),
    'sender', (
      select jsonb_build_object(
        'full_name', p.full_name,
        'email', p.email
      )
      from public.profiles p
      where p.id = v_invite.sender_user_id
    ),
    'org', (
      select jsonb_build_object('id', o.id, 'name', o.name)
      from public.interleague_orgs o
      where o.id = v_invite.interleague_org_id
    ),
    'season', (
      select jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'season', l.season,
        'start_date', l.start_date,
        'end_date', l.end_date,
        'schedule_settings', l.schedule_settings
      )
      from public.leagues l
      where l.id = v_invite.season_id
    ),
    'divisions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'settings', d.settings,
          'start_date', d.start_date,
          'end_date', d.end_date,
          'game_count', dig.game_count,
          'team_names', (
            select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb)
            from public.teams t
            where t.division_id = d.id
          )
        ) order by d.name
      ), '[]'::jsonb)
      from public.division_interleague_games dig
      join public.divisions d on d.id = dig.division_id
      where dig.interleague_org_id = v_invite.interleague_org_id
        and d.league_id = v_invite.season_id
        and dig.game_count > 0
    ),
    'blackouts', (
      select coalesce(jsonb_agg(jsonb_build_object('date', b.date, 'label', b.label)), '[]'::jsonb)
      from public.blackout_dates b
      where b.league_id = v_invite.season_id
    ),
    'venues', (
      select coalesce(jsonb_agg(distinct jsonb_build_object('id', v.id, 'name', v.name)), '[]'::jsonb)
      from public.venues v
      join public.division_venues dv on dv.venue_id = v.id and dv.allow_games = true
      where dv.division_id in (
        select dig2.division_id
        from public.division_interleague_games dig2
        join public.divisions d2 on d2.id = dig2.division_id
        where dig2.interleague_org_id = v_invite.interleague_org_id
          and d2.league_id = v_invite.season_id
          and dig2.game_count > 0
      )
    ),
    'existing_games', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'venue_id', g.venue_id,
        'scheduled_at', g.scheduled_at
      )), '[]'::jsonb)
      from public.games g
      where g.league_id = v_invite.season_id
        and g.scheduled_at >= now()
        and g.scheduled_at <= now() + interval '70 days'
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_interleague_invite_by_token(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public accept RPC: atomically inserts the response and flips the invite to
-- 'accepted'. Returns minimal details the API route needs to email the sender.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.accept_interleague_invite(
  p_token         text,
  p_team_names    jsonb,
  p_selected_slots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.interleague_invites%rowtype;
  v_response_id uuid;
  v_sender_email text;
  v_sender_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
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
  values (v_invite.id, coalesce(p_team_names, '[]'::jsonb), coalesce(p_selected_slots, '[]'::jsonb), 'accepted')
  returning id into v_response_id;

  update public.interleague_invites
  set status = 'accepted', updated_at = now()
  where id = v_invite.id;

  select p.email, p.full_name into v_sender_email, v_sender_name
  from public.profiles p
  where p.id = v_invite.sender_user_id;

  select o.name into v_org_name
  from public.interleague_orgs o
  where o.id = v_invite.interleague_org_id;

  select l.name, l.season into v_season_name, v_season_label
  from public.leagues l
  where l.id = v_invite.season_id;

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'response_id', v_response_id,
    'sender_email', v_sender_email,
    'sender_name', v_sender_name,
    'org_name', v_org_name,
    'season_name', v_season_name,
    'season_label', v_season_label,
    'recipient_email', v_invite.recipient_email
  );
end;
$$;

grant execute on function public.accept_interleague_invite(text, jsonb, jsonb) to anon, authenticated;
