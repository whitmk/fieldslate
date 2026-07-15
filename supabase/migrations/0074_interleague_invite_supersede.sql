-- Interleague invites: supersede sibling pending invites + org-name identity
-- + revisit-page fields.
--
-- Field report 2026-07-14: "invite still shows pending after the other league
-- accepted." Investigation found no broken code — the recurring symptom comes
-- from duplicate invites: accepting one invite never touched OTHER pending
-- invites for the same season + partner org, so they sat 'pending' forever on
-- the sender dashboard (with live Resend buttons). Three additive changes:
--
--   1. New invite status 'superseded'. accept_interleague_invite and
--      decline_interleague_invite now mark all sibling pending invites
--      (same season_id + interleague_org_id, different id) superseded in the
--      same transaction that records the response.
--   2. Both RPCs return sender_org_name (profiles.org_name) alongside the
--      existing sender_name, so response emails can identify the sending
--      LEAGUE instead of the admin's personal name. The responding recipient
--      is anonymous and cannot read profiles under RLS — the SECURITY DEFINER
--      RPC is the only path for this value.
--   3. get_interleague_invite_by_token returns invite.updated_at and a
--      scheduled_game_count so the public invite page can render a real
--      "accepted on <date>" screen for revisited links instead of the
--      "invite not found" screen.
--
-- Per-game handling (accept / counter / decline) is unchanged from 0038.

-- ── 1. Widen the status CHECK ─────────────────────────────────────────────────

alter table public.interleague_invites
  drop constraint interleague_invites_status_check;

alter table public.interleague_invites
  add constraint interleague_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'superseded'));

-- ── 2a. accept_interleague_invite: supersede siblings, return sender org name ─

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
  v_declined int := 0;
  v_sender_email text;
  v_sender_name text;
  v_sender_org_name text;
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

    if v_game_id is null then
      continue;
    end if;
    if v_action <> 'decline' and length(v_team) = 0 then
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
    elsif v_action = 'decline' then
      delete from public.games where id = v_game_id;
      v_declined := v_declined + 1;
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

  -- Supersede sibling pending invites for the same season + partner org.
  -- Duplicate sends happen (retries, email typos); once any one is answered
  -- the others can never be meaningfully accepted, and leaving them 'pending'
  -- is what kept resurrecting the "still shows pending" report.
  update public.interleague_invites
  set status     = 'superseded',
      updated_at = now()
  where season_id          = v_invite.season_id
    and interleague_org_id = v_invite.interleague_org_id
    and id                <> v_invite.id
    and status             = 'pending';

  select p.email, p.full_name, p.org_name
  into v_sender_email, v_sender_name, v_sender_org_name
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
    'declined',        v_declined,
    'sender_email',    v_sender_email,
    'sender_name',     v_sender_name,
    'sender_org_name', v_sender_org_name,
    'org_name',        v_org_name,
    'season_name',     v_season_name,
    'season_label',    v_season_label,
    'recipient_email', v_invite.recipient_email,
    'schedule_token',  v_schedule_token
  );
end;
$$;

grant execute on function public.accept_interleague_invite(text, jsonb) to anon, authenticated;

-- ── 2b. decline_interleague_invite: same supersede + org name, symmetric ─────

create or replace function public.decline_interleague_invite(
  p_token  text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.interleague_invites%rowtype;
  v_sender_email text;
  v_sender_name text;
  v_sender_org_name text;
  v_org_name text;
  v_season_name text;
  v_season_label text;
  v_deleted int;
  v_reason text;
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

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  with del as (
    delete from public.games
    where league_id = v_invite.season_id
      and interleague_org_id = v_invite.interleague_org_id
      and status = 'pending_interleague'
    returning 1
  )
  select count(*) into v_deleted from del;

  update public.interleague_invites
  set status         = 'declined',
      decline_reason = v_reason,
      updated_at     = now()
  where id = v_invite.id;

  -- Same supersede rule as accept: a decline also answers the season+org
  -- pairing, so sibling pending invites are dead either way.
  update public.interleague_invites
  set status     = 'superseded',
      updated_at = now()
  where season_id          = v_invite.season_id
    and interleague_org_id = v_invite.interleague_org_id
    and id                <> v_invite.id
    and status             = 'pending';

  select p.email, p.full_name, p.org_name
  into v_sender_email, v_sender_name, v_sender_org_name
  from public.profiles p where p.id = v_invite.sender_user_id;
  select o.name into v_org_name
  from public.interleague_orgs o where o.id = v_invite.interleague_org_id;
  select l.name, l.season into v_season_name, v_season_label
  from public.leagues l where l.id = v_invite.season_id;

  return jsonb_build_object(
    'invite_id',       v_invite.id,
    'deleted_games',   v_deleted,
    'reason',          v_reason,
    'sender_email',    v_sender_email,
    'sender_name',     v_sender_name,
    'sender_org_name', v_sender_org_name,
    'org_name',        v_org_name,
    'season_name',     v_season_name,
    'season_label',    v_season_label,
    'recipient_email', v_invite.recipient_email
  );
end;
$$;

grant execute on function public.decline_interleague_invite(text, text) to anon, authenticated;

-- ── 3. get_interleague_invite_by_token: fields for the revisit screen ────────
-- Adds invite.updated_at (when the response landed — the set_updated_at
-- trigger stamps it on the status flip) and scheduled_game_count (confirmed
-- games for this season + partner org, which includes counters the sender
-- later resolved). Additive only; existing consumers read named fields.

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
                                     then jsonb_build_object('name', v.name)
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

grant execute on function public.get_interleague_invite_by_token(text) to anon, authenticated;
