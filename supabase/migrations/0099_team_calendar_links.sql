-- 0099: team calendar links + per-org timezone.
--
-- A parent adds one link to their phone's calendar and their team's games
-- stay current. This migration is the DATABASE half: the org timezone, the
-- link table, automatic link creation, the anonymous token reader, and the
-- admin functions. The feed route, the Settings dropdown and the admin dialog
-- are separate commits and read what is defined here.
--
-- REQUIRES 0098 (profiles column grants + protect_profiles_columns trigger),
-- applied 2026-09-29. The verification block at the end refuses to pass
-- without it.
--
-- APPLY VERBATIM, comments included (CLAUDE.md, "Apply migrations VERBATIM").
-- Comments inside a function body are part of pg_proc.prosrc; verify
-- md5(prosrc) against this file after applying. The final DO block verifies
-- every grant and RAISES if one is wrong, so a silent no-op revoke cannot
-- pass unnoticed.
--
-- LOCKS THIS TAKES, briefly, when applied: ACCESS EXCLUSIVE on `profiles`
-- (add column — a constant default, so no table rewrite) and SHARE ROW
-- EXCLUSIVE on `divisions` and `teams` (create trigger). Each is held only
-- for its own statement's duration if applied statement by statement, or for
-- the whole migration if applied in one transaction.
--
-- ────────────────────────────────────────────────────────────────────────────
-- THE RULES THIS ENCODES
-- ────────────────────────────────────────────────────────────────────────────
-- 1. ONE CURRENT LINK PER TEAM, guaranteed by the database. A link row is
--    'active', 'off' (an admin turned it off) or 'replaced' (superseded by a
--    regenerate). The partial unique index `team_calendar_links_one_current`
--    allows at most ONE row per team that is not 'replaced'. So a team can
--    never have two working links, and a link an admin turned off is never
--    quietly resurrected — the automatic creation below inserts only when the
--    team has NO current row.
-- 2. LINKS ARE CREATED AUTOMATICALLY: when a division is locked, when a team
--    joins a locked division, and once here for divisions already locked.
--    No admin action creates a link. divisions.locked is NOT NULL DEFAULT
--    false (0080); no function or app path inserts a division with
--    locked = true (verified 2026-09-29: create_division and
--    create_division_atomic are the only inserters and neither names the
--    column, and there is no season copy/duplicate feature). A division
--    inserted locked by hand has no teams yet, and each team that later joins
--    it gets its link from the teams trigger — so no AFTER INSERT trigger on
--    divisions is needed.
-- 3. THE READER TAKES ONLY A TOKEN and derives everything else. It names
--    every column it returns and never returns a whole row. It returns NO
--    team data unless the answer is 'ok'.
-- 4. PENDING INTERLEAGUE GAMES NEVER LEAVE THE DATABASE through the reader.
--    The TypeScript side (normalizeExportGames) excludes them again; the two
--    rules are pinned together by the harness. Cancelled games ARE returned —
--    the feed shows them as cancelled instead of letting them vanish.
-- 5. EXPIRY IS COMPUTED IN THE ORG'S TIMEZONE, in the database: a link stops
--    working 7 days after the season's end date, where "today" is today in
--    the org's zone — never the server's UTC date. (The auto-archive helper
--    compares against the server's date and therefore archives a season
--    around 5pm Pacific on its final day; this must not inherit that.)
-- 6. TOKENS are 32 random bytes, hex-encoded (64 characters). Never an id,
--    never sequential.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Org timezone
-- ────────────────────────────────────────────────────────────────────────────
-- The org IS its owner's profiles row (leagues.owner_id → profiles.id), so
-- the zone lives there beside org_name and plan. The seven names are the same
-- list as ORG_TIMEZONES in src/lib/calendar/timezones.ts — change one, change
-- the other. Existing rows take the default.
--
-- HOW THIS INTERACTS WITH 0098 (profiles' column-level grants + trigger):
--   * `authenticated` holds UPDATE on four named columns only, so this new
--     column is NOT writable by a signed-in user — no grant is added here, on
--     purpose, and the verification block asserts it stays that way.
--   * 0098's trigger protects every column outside its editable list, so a
--     direct write of `timezone` from a browser session would be refused even
--     if a grant slipped in.
--   * set_org_timezone() below is SECURITY DEFINER and runs as its owner
--     (postgres), so it passes both layers. It is THE ONLY way an admin
--     changes the org's timezone. Nothing else may write this column from a
--     user session.
alter table public.profiles
  add column timezone text not null default 'America/Los_Angeles'
  constraint profiles_timezone_check check (
    timezone in (
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu'
    )
  );

comment on column public.profiles.timezone is
  'The org''s timezone (IANA name, one of seven US zones). Game times are '
  'stored as wall-clock text and are NOT converted by this; it LABELS them '
  '(team calendar feed) and decides what "today" is (link expiry).';

-- profiles' UPDATE policy is own-row only, so an admin who is not the org
-- owner cannot write the org's row. This is the one path for every admin.
-- The CHECK constraint is the single list of valid zones; its violation is
-- translated rather than the list being repeated here.
--
-- GATE: is_org_member. Every org member is an admin today, so membership IS
-- the admin check. If a non-admin member role (e.g. coach) is ever added,
-- set_org_timezone, regenerate_team_calendar_link and
-- set_team_calendar_link_enabled must be restricted to admins.
create or replace function public.set_org_timezone(p_org_id uuid, p_timezone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  begin
    update public.profiles
       set timezone = p_timezone
     where id = p_org_id;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid_timezone' using errcode = '22023';
  end;

  if not found then
    raise exception 'org_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('timezone', p_timezone);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The link table
-- ────────────────────────────────────────────────────────────────────────────
create table public.team_calendar_links (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams(id) on delete cascade,
  token             text not null unique
                      default encode(extensions.gen_random_bytes(32), 'hex')
                      check (token ~ '^[0-9a-f]{64}$'),
  status            text not null default 'active'
                      check (status in ('active', 'off', 'replaced')),
  created_at        timestamptz not null default now(),
  -- NULL = created automatically (lock, team joined, backfill).
  created_by        uuid references auth.users(id) on delete set null,
  status_changed_at timestamptz
);

comment on table public.team_calendar_links is
  'One CURRENT calendar link per team (active or off), plus replaced ones '
  'kept so an old link can be answered "this link was replaced" rather than '
  '"unknown". Rows are written ONLY by the functions and triggers in 0099 — '
  'no role holds INSERT/UPDATE/DELETE.';

-- THE GUARANTEE. At most one row per team that is not 'replaced'.
create unique index team_calendar_links_one_current
  on public.team_calendar_links (team_id)
  where status <> 'replaced';

alter table public.team_calendar_links enable row level security;

-- Org members may READ their own teams' links (the admin dialog). There is
-- no write policy: with RLS on and no policy for a command, that command is
-- refused for everyone who is subject to RLS.
create policy "Org members can read their teams' calendar links"
  on public.team_calendar_links
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.teams t
        join public.leagues l on l.id = t.league_id
       where t.id = team_calendar_links.team_id
         and public.is_org_member(l.owner_id)
    )
  );

-- Table privileges. This project's default privileges hand a NEW table
-- TRUNCATE/REFERENCES/TRIGGER to anon, authenticated and service_role, and
-- SELECT to dashboard_readonly (verified against pg_default_acl 2026-09-29).
-- A table of live tokens must not be readable by dashboard_readonly, so every
-- default is removed and exactly one privilege is granted back.
--   anon              nothing — the feed reads through the token function.
--   authenticated     SELECT only (under the policy above).
--   service_role      nothing — no consumer uses the admin client. If one
--                     ever does, it needs an explicit grant here (CLAUDE.md:
--                     service_role gets no default DML on new tables).
--   dashboard_readonly nothing.
revoke all on table public.team_calendar_links from public;
revoke all on table public.team_calendar_links from anon;
revoke all on table public.team_calendar_links from authenticated;
revoke all on table public.team_calendar_links from service_role;
revoke all on table public.team_calendar_links from dashboard_readonly;
grant select on table public.team_calendar_links to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Automatic creation
-- ────────────────────────────────────────────────────────────────────────────
-- Gives every team in the division a link if it has no CURRENT one. A team
-- whose link is 'off' has a current row, so it is left alone.
create or replace function public.ensure_team_calendar_links(p_division_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  insert into public.team_calendar_links (team_id)
  select t.id
    from public.teams t
   where t.division_id = p_division_id
  on conflict (team_id) where status <> 'replaced' do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

-- A division was just locked.
create or replace function public.team_calendar_links_on_division_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_team_calendar_links(new.id);
  return null;
end;
$$;

create trigger team_calendar_links_on_division_lock
  after update of locked on public.divisions
  for each row
  when (new.locked and not old.locked)
  execute function public.team_calendar_links_on_division_lock();

-- A team was created in, or moved into, a division. Only a LOCKED division
-- gives it a link; an unlocked one will when it is locked.
create or replace function public.team_calendar_links_on_team_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.division_id is not null
     and exists (
       select 1 from public.divisions d
        where d.id = new.division_id and d.locked
     )
  then
    insert into public.team_calendar_links (team_id)
    values (new.id)
    on conflict (team_id) where status <> 'replaced' do nothing;
  end if;
  return null;
end;
$$;

create trigger team_calendar_links_on_team_insert
  after insert on public.teams
  for each row
  execute function public.team_calendar_links_on_team_change();

create trigger team_calendar_links_on_team_move
  after update of division_id on public.teams
  for each row
  when (new.division_id is distinct from old.division_id)
  execute function public.team_calendar_links_on_team_change();

-- Backfill: divisions that are ALREADY locked when this ships.
insert into public.team_calendar_links (team_id)
select t.id
  from public.teams t
  join public.divisions d on d.id = t.division_id
 where d.locked
on conflict (team_id) where status <> 'replaced' do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. The anonymous reader
-- ────────────────────────────────────────────────────────────────────────────
-- Returns { status } and, ONLY when status = 'ok', the calendar's data.
--   unknown   no such link (or not a well-formed token)
--   revoked   the link was replaced by a regenerate
--   off       an admin turned the team's calendar off
--   expired   the season is archived, or ended more than 7 days ago
--   plan      the org is not on Pro or Elite
--   unlocked  the division is not locked (the schedule is a draft)
--   ok
create or replace function public.get_team_calendar_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status        text;
  v_team_id       uuid;
  v_team_name     text;
  v_league_id     uuid;
  v_division_id   uuid;
  v_division_name text;
  v_duration      jsonb;
  v_locked        boolean;
  v_season_name   text;
  v_end_date      date;
  v_archived_at   timestamptz;
  v_org_name      text;
  v_plan          text;
  v_timezone      text;
  v_today         date;
  v_games         jsonb;
begin
  -- A malformed token is answered without touching the table.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;

  select k.status, k.team_id
    into v_status, v_team_id
    from public.team_calendar_links k
   where k.token = p_token;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_status = 'replaced' then
    return jsonb_build_object('status', 'revoked');
  end if;
  if v_status = 'off' then
    return jsonb_build_object('status', 'off');
  end if;

  -- A link whose team, season or org row is gone is answered 'unknown'
  -- EXPLICITLY — never by whichever later check happens to trip on a null.
  select t.name, t.league_id, t.division_id
    into v_team_name, v_league_id, v_division_id
    from public.teams t
   where t.id = v_team_id;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  select l.name, l.end_date, l.archived_at, p.org_name, p.plan, p.timezone
    into v_season_name, v_end_date, v_archived_at, v_org_name, v_plan, v_timezone
    from public.leagues l
    join public.profiles p on p.id = l.owner_id
   where l.id = v_league_id;
  if not found or v_timezone is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  -- "Today" in the ORG's zone. Never current_date, never the server's zone.
  v_today := (now() at time zone v_timezone)::date;

  if v_archived_at is not null
     or (v_end_date is not null and v_today > v_end_date + 7)
  then
    return jsonb_build_object('status', 'expired');
  end if;

  if v_plan is null or v_plan not in ('pro', 'elite') then
    return jsonb_build_object('status', 'plan');
  end if;

  -- A team with no division has no locked division.
  select d.name, d.settings -> 'game_duration', d.locked
    into v_division_name, v_duration, v_locked
    from public.divisions d
   where d.id = v_division_id;

  if not found or not coalesce(v_locked, false) then
    return jsonb_build_object('status', 'unlocked');
  end if;

  -- Every column is named. NEVER to_jsonb(g), never g.*: games carries notes,
  -- scores and attribution, and teams carries contact_email.
  --
  -- scheduled_at is WALL-CLOCK text with a literal +00 (see game-time.ts); it
  -- is rendered explicitly so the result does not depend on the session's
  -- TimeZone setting. updated_at is a real instant, rendered in UTC.
  --
  -- proposed_venue_name is the PARTNER's field and is returned for away games
  -- only; on a home game it can hold a stale counter-proposal.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',                  g.id,
      'scheduled_at',        to_char(g.scheduled_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00',
      'updated_at',          to_char(g.updated_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'status',              g.status,
      'is_away',             g.is_away,
      'home_team_id',        g.home_team_id,
      'away_team_id',        g.away_team_id,
      'external_team_name',  g.external_team_name,
      'proposed_venue_name', case when g.is_away then g.proposed_venue_name
                                  else null end,
      'home_team',           jsonb_build_object('name', ht.name),
      'away_team',           case when awt.id is not null
                               then jsonb_build_object('name', awt.name)
                               else null end,
      'venue',               case when v.id is not null
                               then jsonb_build_object(
                                 'name', v.name,
                                 'location', case when loc.id is not null
                                   then jsonb_build_object('name', loc.name)
                                   else null end
                               )
                               else null end
    )
    order by g.scheduled_at asc, g.id asc
  ), '[]'::jsonb)
    into v_games
    from public.games g
    join public.teams ht on ht.id = g.home_team_id
    left join public.teams awt on awt.id = g.away_team_id
    left join public.venues v on v.id = g.venue_id
    left join public.locations loc on loc.id = v.location_id
   where g.league_id = v_league_id
     and (g.home_team_id = v_team_id or g.away_team_id = v_team_id)
     -- An unagreed interleague proposal never leaves the database.
     and g.status <> 'pending_interleague';

  return jsonb_build_object(
    'status',   'ok',
    'team',     jsonb_build_object('id', v_team_id, 'name', v_team_name),
    'division', jsonb_build_object('name', v_division_name,
                                   'game_duration', v_duration),
    'season',   jsonb_build_object('name', v_season_name),
    'org',      jsonb_build_object('name', v_org_name, 'timezone', v_timezone),
    'games',    v_games
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Admin functions
-- ────────────────────────────────────────────────────────────────────────────
-- Shared gate: the team exists, the caller is an org member, and (for
-- anything that produces a working link) the org is on Pro or Elite.
-- Returns the org's plan; raises otherwise.
--
-- GATE: is_org_member. Every org member is an admin today, so membership IS
-- the admin check. If a non-admin member role (e.g. coach) is ever added,
-- set_org_timezone, regenerate_team_calendar_link and
-- set_team_calendar_link_enabled must be restricted to admins.
create or replace function public.team_calendar_admin_gate(p_team_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_plan  text;
begin
  select l.owner_id, p.plan
    into v_owner, v_plan
    from public.teams t
    join public.leagues l on l.id = t.league_id
    join public.profiles p on p.id = l.owner_id
   where t.id = p_team_id;

  if not found then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_owner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return v_plan;
end;
$$;

-- Replace the team's link. The old one stops working in the same
-- transaction; there is no moment with two working links or with none.
create or replace function public.regenerate_team_calendar_link(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    text;
  v_current public.team_calendar_links%rowtype;
  v_token   text;
begin
  v_plan := public.team_calendar_admin_gate(p_team_id);
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  select * into v_current
    from public.team_calendar_links k
   where k.team_id = p_team_id and k.status <> 'replaced'
   for update;

  if not found then
    raise exception 'no_link' using errcode = 'P0002';
  end if;
  -- Regenerating must not switch a turned-off calendar back on.
  if v_current.status = 'off' then
    raise exception 'link_off' using errcode = 'P0001';
  end if;

  update public.team_calendar_links
     set status = 'replaced', status_changed_at = now()
   where id = v_current.id;

  insert into public.team_calendar_links (team_id, created_by)
  values (p_team_id, auth.uid())
  returning token into v_token;

  return jsonb_build_object('status', 'active', 'token', v_token);
end;
$$;

-- Turn a team's calendar off or back on.
--   off: the current link stops working and stays the team's current row, so
--        locking the division again does not bring it back.
--   on:  ALWAYS a new token. The link that was turned off stays dead.
create or replace function public.set_team_calendar_link_enabled(
  p_team_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    text;
  v_current public.team_calendar_links%rowtype;
  v_found   boolean;
  v_token   text;
begin
  v_plan := public.team_calendar_admin_gate(p_team_id);

  if p_enabled is null then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;

  select * into v_current
    from public.team_calendar_links k
   where k.team_id = p_team_id and k.status <> 'replaced'
   for update;
  v_found := found;

  if not p_enabled then
    -- Turning OFF is allowed on any plan: it only ever removes access.
    if not v_found then
      insert into public.team_calendar_links (team_id, status, created_by, status_changed_at)
      values (p_team_id, 'off', auth.uid(), now());
    elsif v_current.status = 'active' then
      update public.team_calendar_links
         set status = 'off', status_changed_at = now()
       where id = v_current.id;
    end if;
    return jsonb_build_object('status', 'off');
  end if;

  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  if v_found and v_current.status = 'active' then
    return jsonb_build_object('status', 'active', 'token', v_current.token);
  end if;

  if v_found then
    update public.team_calendar_links
       set status = 'replaced', status_changed_at = now()
     where id = v_current.id;
  end if;

  insert into public.team_calendar_links (team_id, created_by)
  values (p_team_id, auth.uid())
  returning token into v_token;

  return jsonb_build_object('status', 'active', 'token', v_token);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Function privileges
-- ────────────────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE on every new function to PUBLIC, and this
-- project's default privileges add dashboard_readonly. Revoking from a ROLE
-- alone is a silent no-op while PUBLIC still holds it (CLAUDE.md, found
-- applying 0093) — so: revoke from PUBLIC and from each role, then grant back
-- exactly what is needed.
--
--   get_team_calendar_by_token        anon, authenticated   (the feed)
--   set_org_timezone                  authenticated
--   regenerate_team_calendar_link     authenticated
--   set_team_calendar_link_enabled    authenticated
--   ensure_team_calendar_links        nobody (called by triggers)
--   team_calendar_admin_gate          nobody (called by the admin functions)
--   the two trigger functions         nobody
revoke execute on function public.get_team_calendar_by_token(text)               from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_org_timezone(uuid, text)                   from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.regenerate_team_calendar_link(uuid)            from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_team_calendar_link_enabled(uuid, boolean)  from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.ensure_team_calendar_links(uuid)               from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.team_calendar_admin_gate(uuid)                 from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.team_calendar_links_on_division_lock()         from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.team_calendar_links_on_team_change()           from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.get_team_calendar_by_token(text)              to anon, authenticated;
grant execute on function public.set_org_timezone(uuid, text)                  to authenticated;
grant execute on function public.regenerate_team_calendar_link(uuid)           to authenticated;
grant execute on function public.set_team_calendar_link_enabled(uuid, boolean) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Verify — RAISES if any privilege is not exactly as stated above
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  r         record;
  v_wrong   text := '';
  v_missing integer;
begin
  -- Functions: (signature, anon, authenticated, service_role, dashboard_readonly)
  for r in
    select * from (values
      ('public.get_team_calendar_by_token(text)',               true,  true,  false, false),
      ('public.set_org_timezone(uuid, text)',                   false, true,  false, false),
      ('public.regenerate_team_calendar_link(uuid)',            false, true,  false, false),
      ('public.set_team_calendar_link_enabled(uuid, boolean)',  false, true,  false, false),
      ('public.ensure_team_calendar_links(uuid)',               false, false, false, false),
      ('public.team_calendar_admin_gate(uuid)',                 false, false, false, false),
      ('public.team_calendar_links_on_division_lock()',         false, false, false, false),
      ('public.team_calendar_links_on_team_change()',           false, false, false, false)
    ) as t(fn, want_anon, want_auth, want_service, want_dash)
  loop
    if has_function_privilege('anon', r.fn, 'execute') <> r.want_anon then
      v_wrong := v_wrong || format(' [%s anon]', r.fn);
    end if;
    if has_function_privilege('authenticated', r.fn, 'execute') <> r.want_auth then
      v_wrong := v_wrong || format(' [%s authenticated]', r.fn);
    end if;
    if has_function_privilege('service_role', r.fn, 'execute') <> r.want_service then
      v_wrong := v_wrong || format(' [%s service_role]', r.fn);
    end if;
    if has_function_privilege('dashboard_readonly', r.fn, 'execute') <> r.want_dash then
      v_wrong := v_wrong || format(' [%s dashboard_readonly]', r.fn);
    end if;
  end loop;

  -- Table: authenticated may SELECT; nobody else may do anything.
  for r in
    select role_name, priv
      from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) as role_name
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as priv
  loop
    if has_table_privilege(r.role_name, 'public.team_calendar_links', r.priv)
       <> (r.role_name = 'authenticated' and r.priv = 'SELECT')
    then
      v_wrong := v_wrong || format(' [table %s %s]', r.role_name, r.priv);
    end if;
  end loop;

  -- 0099 depends on 0098: profiles.timezone must be writable ONLY through
  -- set_org_timezone(). A signed-in user must hold no column UPDATE on it,
  -- 0098's trigger must be in place, and set_org_timezone must be SECURITY
  -- DEFINER (or it would run as the caller and be refused by both layers).
  if has_column_privilege('authenticated', 'public.profiles', 'timezone', 'UPDATE') then
    v_wrong := v_wrong || ' [authenticated can update profiles.timezone directly]';
  end if;
  if has_column_privilege('anon', 'public.profiles', 'timezone', 'UPDATE') then
    v_wrong := v_wrong || ' [anon can update profiles.timezone directly]';
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    v_wrong := v_wrong || ' [authenticated holds table-level UPDATE on profiles — 0098 missing?]';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.profiles'::regclass
       and t.tgname = 'protect_profiles_columns'
       and t.tgenabled = 'O' and not p.prosecdef
  ) then
    v_wrong := v_wrong || ' [0098 trigger protect_profiles_columns missing or disabled]';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_org_timezone' and p.prosecdef
  ) then
    v_wrong := v_wrong || ' [set_org_timezone is not SECURITY DEFINER]';
  end if;

  -- Backfill: every team in a locked division has exactly one current link.
  select count(*) into v_missing
    from public.teams t
    join public.divisions d on d.id = t.division_id
   where d.locked
     and (select count(*) from public.team_calendar_links k
           where k.team_id = t.id and k.status <> 'replaced') <> 1;
  if v_missing <> 0 then
    v_wrong := v_wrong || format(' [%s team(s) in a locked division without exactly one current link]', v_missing);
  end if;

  if v_wrong <> '' then
    raise exception '0099 verification failed:%', v_wrong;
  end if;
end;
$$;
