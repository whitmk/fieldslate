-- Interleague Case A: a SIGNED-IN FieldSlate league accepts an invite onto its
-- own schedule (2026-09-28).
--
-- Today an invite goes to an email address and the recipient answers
-- anonymously through the token link; that path is UNCHANGED. When the person
-- holding the link is signed in, the page recognises them and accepting also
-- creates the games in THEIR league — ordinary Case B interleague rows (their
-- team as home_team_id, away_team_id NULL, interleague_org_id → their contact
-- card for the host, external_team_name = the host's team name, is_away from
-- their perspective). After acceptance the two leagues' rows are independent:
-- no link column, no syncing; a change goes through the reschedule request
-- flow, which already needs both sides to agree.
--
-- Three parts:
--
--   1. accept_interleague_invite — RE-APPLIED VERBATIM from 0074. NOT changed.
--      The live body had drifted from the repo by three trimmed comment lines
--      (the 0079 failure class: comments inside $$…$$ are part of prosrc);
--      re-applying the repo text closes the drift so md5(prosrc) matches the
--      file again. Logic byte-identical before and after — the twin-fixture
--      harness (scripts/sim/signed-in-accept-rpc-sim.sql) proves it.
--
--   2. get_interleague_invite_by_token — gains sender.org_name (additive JSON
--      key). The signed-in page names the partner card after the host LEAGUE;
--      until now the payload carried only the admin's personal name and email.
--
--   3. NEW accept_interleague_invite_as_member(p_token, p_league_id, p_games)
--      — SECURITY INVOKER, authenticated only. The wrapper the signed-in route
--      calls. Why a wrapper and not a route doing two calls: the token is
--      single-use, so "host RPC succeeded, our inserts failed" would leave an
--      accepted invite with nothing on the recipient's schedule and no retry.
--      In ONE transaction it (a) reads the invite through the token function,
--      (b) refuses if the caller is a member of the SENDING org (the season is
--      visible under the caller's RLS iff they are — live on the founder's own
--      accounts today, so reachable, not hypothetical), (c) turns our team /
--      venue IDs into the NAMES the host side stores, (d) calls the existing
--      anon token RPC to do the host half exactly as an anonymous partner
--      would, (e) finds or creates our contact card for the host from the
--      RPC's OWN return (never from client input), and (f) inserts our game
--      rows for ACCEPTED games only, under our own RLS. Countered games create
--      nothing on our side (a pending row that never syncs is the drift this
--      design rejects); declined games create nothing. Any raise — including
--      the 0082 lock trigger on a locked division — rolls back BOTH halves.
--      Every per-game input is looked up under the caller's RLS, so a foreign
--      team or venue id raises rather than binds.
--      A count mismatch between what the host confirmed and what we planned
--      (the host regenerated between page load and click) raises
--      host_games_changed and rolls back — the two sides must agree.

-- ── 1. accept_interleague_invite: verbatim 0074 ─────────────────────────────

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

-- ── 2. get_interleague_invite_by_token: + sender.org_name ───────────────────

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
      -- 0097: org_name (the host LEAGUE) so a signed-in recipient's partner
      -- card is named after the league, not the admin. Additive; the
      -- anonymous page never renders it.
      select jsonb_build_object('full_name', p.full_name, 'email', p.email, 'org_name', p.org_name)
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

grant execute on function public.get_interleague_invite_by_token(text) to anon, authenticated;

-- ── 3. accept_interleague_invite_as_member ──────────────────────────────────

create or replace function public.accept_interleague_invite_as_member(
  p_token     text,
  p_league_id uuid,
  p_games     jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller        uuid := auth.uid();
  v_payload       jsonb;
  v_season_id     uuid;
  v_league        public.leagues%rowtype;
  v_item          jsonb;
  v_host          jsonb;
  v_game_id       uuid;
  v_action        text;
  v_team_id       uuid;
  v_team_name     text;
  v_venue_id      uuid;
  v_venue_label   text;
  v_responses     jsonb := '[]'::jsonb;
  v_ours          jsonb := '[]'::jsonb;
  v_planned_acc   int := 0;
  v_planned_cnt   int := 0;
  v_planned_dec   int := 0;
  v_result        jsonb;
  v_partner_id    uuid;
  v_partner_name  text;
  v_partner_email text;
  v_new_id        uuid;
  v_created_ids   uuid[] := '{}';
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- The token is the credential, exactly as on the anonymous path: the invite
  -- is read through the same SECURITY DEFINER function the page uses.
  v_payload := public.get_interleague_invite_by_token(p_token);
  if v_payload is null then
    raise exception 'invite_not_found' using errcode = 'P0001';
  end if;
  if (v_payload->'invite'->>'status') <> 'pending' then
    raise exception 'invite_not_pending' using errcode = 'P0001';
  end if;
  v_season_id := (v_payload->'season'->>'id')::uuid;

  -- Own-invite guard. This function is SECURITY INVOKER, so the host's season
  -- row is visible here iff the caller is a member of the host org. A member
  -- of the sending league must never accept its own invite onto its own
  -- schedule (an admin of two leagues, signed into the wrong one).
  if exists (select 1 from public.leagues where id = v_season_id) then
    raise exception 'own_invite' using errcode = 'P0001';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if v_league.archived_at is not null then
    raise exception 'league_archived' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  -- Turn our ids into the NAMES the host side stores, and plan our rows.
  for v_item in
    select * from jsonb_array_elements(coalesce(p_games, '[]'::jsonb))
  loop
    v_game_id := nullif(v_item->>'game_id', '')::uuid;
    v_action  := coalesce(v_item->>'action', 'accept');
    if v_game_id is null then
      continue;
    end if;

    select g into v_host
    from jsonb_array_elements(coalesce(v_payload->'games', '[]'::jsonb)) g
    where (g->>'id')::uuid = v_game_id;
    if v_host is null then
      raise exception 'game_not_in_invite' using errcode = 'P0001';
    end if;

    if v_action = 'decline' then
      v_responses := v_responses || jsonb_build_object(
        'game_id', v_game_id, 'team_name', '', 'action', 'decline');
      v_planned_dec := v_planned_dec + 1;
      continue;
    end if;

    v_team_id := nullif(v_item->>'team_id', '')::uuid;
    select t.name into v_team_name
    from public.teams t
    where t.id = v_team_id and t.league_id = p_league_id;
    if v_team_name is null then
      raise exception 'team_not_found' using errcode = 'P0001';
    end if;

    -- The host marked the game away ⇒ WE host it ⇒ our field is required, and
    -- its qualified label ("Complex — Field", the chooser label) is what the
    -- host's row stores as proposed_venue_name — as a typed name would be.
    v_venue_id    := nullif(v_item->>'venue_id', '')::uuid;
    v_venue_label := null;
    if (v_host->>'is_away')::boolean then
      if v_venue_id is null then
        raise exception 'venue_required' using errcode = 'P0001';
      end if;
      select case when loc.name is not null and length(trim(loc.name)) > 0
                  then trim(loc.name) || ' — ' || v.name
                  else v.name end
      into v_venue_label
      from public.venues v
      left join public.locations loc on loc.id = v.location_id
      where v.id = v_venue_id and v.owner_id = v_league.owner_id;
      if v_venue_label is null then
        raise exception 'venue_not_found' using errcode = 'P0001';
      end if;
    end if;

    if v_action = 'counter' then
      v_responses := v_responses || jsonb_build_object(
        'game_id',               v_game_id,
        'team_name',             v_team_name,
        'action',                'counter',
        'venue_name',            v_venue_label,
        'proposed_scheduled_at', v_item->>'proposed_scheduled_at');
      v_planned_cnt := v_planned_cnt + 1;
      continue;
    end if;

    v_responses := v_responses || jsonb_build_object(
      'game_id',    v_game_id,
      'team_name',  v_team_name,
      'action',     'accept',
      'venue_name', v_venue_label);
    v_planned_acc := v_planned_acc + 1;

    -- Our row, from OUR perspective: the host's home team becomes the text
    -- opponent; the host's field (when they host) becomes our proposed venue.
    v_ours := v_ours || jsonb_build_object(
      'home_team_id',        v_team_id,
      'venue_id',            case when (v_host->>'is_away')::boolean then v_venue_id else null end,
      'scheduled_at',        v_host->>'scheduled_at',
      'is_away',             not (v_host->>'is_away')::boolean,
      'external_team_name',  v_host->'home_team'->>'name',
      'proposed_venue_name', case when (v_host->>'is_away')::boolean then null
                                  when v_host->'venue' is null or v_host->'venue' = 'null'::jsonb then null
                                  when v_host->'venue'->'location'->>'name' is not null
                                    then (v_host->'venue'->'location'->>'name') || ' — ' || (v_host->'venue'->>'name')
                                  else v_host->'venue'->>'name' end);
  end loop;

  -- The host half, exactly as an anonymous partner would do it. Raises if the
  -- invite is no longer pending; row-locks it otherwise.
  v_result := public.accept_interleague_invite(p_token, v_responses);

  -- The two sides must agree. The token RPC silently skips a game that is no
  -- longer pending (the host regenerated between page load and click); a row
  -- created here for a game the host never confirmed would be a phantom.
  if (v_result->>'accepted')::int  <> v_planned_acc
     or (v_result->>'countered')::int <> v_planned_cnt
     or (v_result->>'declined')::int  <> v_planned_dec then
    raise exception 'host_games_changed' using errcode = 'P0001';
  end if;

  -- Our contact card for the host: named after the host LEAGUE, contact = the
  -- sending admin. From the RPC's own return, never from client input.
  v_partner_name := coalesce(
    nullif(trim(coalesce(v_result->>'sender_org_name', '')), ''),
    nullif(trim(coalesce(v_result->>'sender_name', '')), ''),
    v_result->>'sender_email');
  v_partner_email := v_result->>'sender_email';
  if v_partner_name is null or v_partner_email is null then
    raise exception 'host_contact_unknown' using errcode = 'P0001';
  end if;

  select o.id into v_partner_id
  from public.interleague_orgs o
  where o.owner_id = v_league.owner_id
    and lower(o.name) = lower(v_partner_name)
  order by o.created_at asc
  limit 1;
  if v_partner_id is null then
    insert into public.interleague_orgs (owner_id, name, admin_email)
    values (v_league.owner_id, v_partner_name, v_partner_email)
    returning id into v_partner_id;
  end if;

  -- Our rows, ACCEPTED games only. Under our own RLS; the 0082 lock trigger
  -- raises on a locked division and rolls back everything above.
  for v_item in
    select * from jsonb_array_elements(v_ours)
  loop
    insert into public.games (
      league_id, home_team_id, away_team_id, interleague_org_id, venue_id,
      scheduled_at, status, is_away, external_team_name, proposed_venue_name
    ) values (
      p_league_id,
      (v_item->>'home_team_id')::uuid,
      null,
      v_partner_id,
      nullif(v_item->>'venue_id', '')::uuid,
      (v_item->>'scheduled_at')::timestamptz,
      'scheduled',
      (v_item->>'is_away')::boolean,
      v_item->>'external_team_name',
      v_item->>'proposed_venue_name'
    )
    returning id into v_new_id;
    v_created_ids := v_created_ids || v_new_id;
  end loop;

  return v_result || jsonb_build_object(
    'league_id',        p_league_id,
    'partner_org_id',   v_partner_id,
    'partner_org_name', v_partner_name,
    'created',          coalesce(array_length(v_created_ids, 1), 0),
    'created_game_ids', to_jsonb(v_created_ids)
  );
end;
$$;

-- authenticated only. Postgres grants EXECUTE on a new function to PUBLIC, and
-- this project's default privileges add dashboard_readonly; revoke from public
-- (a role-level revoke alone is a silent no-op — see CLAUDE.md) and grant back
-- exactly the one role that needs it.
revoke execute on function public.accept_interleague_invite_as_member(text, uuid, jsonb) from public;
revoke execute on function public.accept_interleague_invite_as_member(text, uuid, jsonb) from dashboard_readonly;
grant  execute on function public.accept_interleague_invite_as_member(text, uuid, jsonb) to authenticated;
