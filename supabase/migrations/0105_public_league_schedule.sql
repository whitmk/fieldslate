-- 0105: the public league schedule — one link per league, for families and for
-- the league's own website (/s/<token>, embeddable; /s/<token>.ics, the
-- all-games calendar). This migration is the DATABASE half: the home-park flag,
-- the link table, the anonymous reader and the admin functions. The page, the
-- feed route and the Settings card are separate commits and read what is
-- defined here.
--
-- APPLY VERBATIM, comments included (CLAUDE.md, "Apply migrations VERBATIM").
-- Comments inside a function body are part of pg_proc.prosrc; verify
-- md5(prosrc) against this file after applying. The final DO block verifies
-- every grant and RAISES if one is wrong.
--
-- LOCKS THIS TAKES when applied: ACCESS EXCLUSIVE on `locations` (add column
-- with a constant default — no table rewrite; 6 live rows) and SHARE ROW
-- EXCLUSIVE on `profiles` (the new table's FK). Nothing on `games`, `teams`,
-- `divisions`, `leagues` or `venues`. Each is held for its own statement if
-- applied statement by statement, or for the whole migration if applied in
-- one transaction (well under a second either way).
--
-- ────────────────────────────────────────────────────────────────────────────
-- THE RULES THIS ENCODES
-- ────────────────────────────────────────────────────────────────────────────
-- 1. HOME vs AWAY IS DECIDED BY THE PARK. A game is Home when its field
--    belongs to a park (location) the league marked `is_home_park`; anything
--    else — a field in another league's park, a field in no park, an
--    interleague game at the partner's field — is Away. The reader emits the
--    FACT (`venue.home_park`); the classification is one TypeScript function
--    (src/lib/public-schedule/classify.ts) so the page, the print and the
--    harness share it. Nothing about the field TABLE says "ours": an org's
--    venues include other leagues' fields it plays at (the real league's 272
--    games are at four parks, one of them its own).
-- 2. ONE LINK PER ORG, and it FOLLOWS THE CURRENT SEASON. The token never
--    names a season, so a website embed keeps working season after season.
--    Turning the page OFF keeps the token (turning it back on restores the
--    same link); RESET writes a new token into the same row, and the old one
--    answers 'unknown' from that moment.
-- 3. THE READER TAKES ONLY A TOKEN, names every column it returns, and returns
--    no league data unless the answer is 'ok'. Statuses:
--      unknown  no such link (or not a well-formed token)
--      off      the league turned the page off
--      plan     the org is not on Pro or Elite (the page shows "turned off")
--      ok       { org, today, seasons[] } — seasons may be EMPTY ("no current
--               season"); the page and the feed render that honestly.
-- 4. ONLY LOCKED DIVISIONS. A division that is not locked contributes its NAME
--    to `unpublished` and nothing else: no teams, no games, no playoff games.
--    A schedule being edited never goes public. (`posted` is not a gate — it
--    clears itself on every rainout, the moment the page matters most.)
-- 5. STATUS RULES, games: an unagreed interleague proposal
--    (`pending_interleague`) never leaves the database. Every other status is
--    returned WITH its status, and the page labels it: cancelled (the rainout
--    flow is the only writer of that status) → "Rained out", shown struck
--    through; reschedule_pending → shown at its current time, "Time may
--    change"; scheduled / completed / in_progress / postponed → per the
--    page's label table.
--    Playoff games: only brackets that are not `draft`; every game of those
--    brackets is returned (the page shows only DATED ones, and uses the rest
--    to name "Winner of Game N" in an open slot).
-- 6. WHICH SEASONS: the org's seasons that are not archived, have at least one
--    locked division, and did not end more than 7 days ago — "today" computed
--    in the ORG's timezone (never current_date), the same window as the team
--    calendar feed. The reader returns `today` so the page picks the default
--    season without reading a clock: the season containing today, else the
--    next to start, else the latest to end. More than one season → a picker.
-- 7. NEVER RETURNED, by construction (every key is named below): game notes and
--    their attribution, scores, winners, officials, snack shack, the
--    interleague partner's org id and contact details, teams.contact_email,
--    coach metadata in divisions.settings, the counter-proposal on a pending
--    game. `anon` holds no SELECT on any table this reads (verified
--    2026-10-08); this SECURITY DEFINER function is the only anonymous path.
--    The field's STREET ADDRESS is returned (venue's own, else its park's), as
--    the team calendar feed does — the public page shows it with a Maps link.
-- 8. TOKENS are 32 random bytes, hex-encoded (64 characters).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Home park
-- ────────────────────────────────────────────────────────────────────────────
-- Written by org members under the existing locations policy ("Org members can
-- manage locations", is_org_member(owner_id)) — the same plain update as a
-- park rename. No new grant.
alter table public.locations
  add column is_home_park boolean not null default false;

comment on column public.locations.is_home_park is
  'True when this park belongs to the league. Games on its fields show as Home '
  'on the public league schedule; games anywhere else show as Away. Applies to '
  'every season (locations are org-scoped).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The link table — one row per org
-- ────────────────────────────────────────────────────────────────────────────
create table public.public_schedule_links (
  org_id           uuid primary key references public.profiles(id) on delete cascade,
  token            text not null unique
                     default encode(extensions.gen_random_bytes(32), 'hex')
                     check (token ~ '^[0-9a-f]{64}$'),
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  token_changed_at timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.public_schedule_links is
  'One public league schedule link per org. Off keeps the token; reset writes a '
  'new one. Rows are written ONLY by the functions in 0105 — no role holds '
  'INSERT/UPDATE/DELETE.';

alter table public.public_schedule_links enable row level security;

-- Org members may READ their org's link (the Settings card). No write policy:
-- with RLS on and no policy for a command, that command is refused.
create policy "Org members can read their public schedule link"
  on public.public_schedule_links
  for select
  to authenticated
  using (public.is_org_member(org_id));

-- Remove every default privilege and grant exactly one back (same reasoning as
-- 0099: a table of live tokens must not be readable by dashboard_readonly).
revoke all on table public.public_schedule_links from public;
revoke all on table public.public_schedule_links from anon;
revoke all on table public.public_schedule_links from authenticated;
revoke all on table public.public_schedule_links from service_role;
revoke all on table public.public_schedule_links from dashboard_readonly;
grant select on table public.public_schedule_links to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. The anonymous reader
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_league_schedule_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_enabled  boolean;
  v_org_name text;
  v_plan     text;
  v_timezone text;
  v_today    date;
  v_seasons  jsonb;
begin
  -- A malformed token is answered without touching the table.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;

  select k.org_id, k.enabled
    into v_org_id, v_enabled
    from public.public_schedule_links k
   where k.token = p_token;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if not v_enabled then
    return jsonb_build_object('status', 'off');
  end if;

  select p.org_name, p.plan, p.timezone
    into v_org_name, v_plan, v_timezone
    from public.profiles p
   where p.id = v_org_id;
  if not found or v_timezone is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  if v_plan is null or v_plan not in ('pro', 'elite') then
    return jsonb_build_object('status', 'plan');
  end if;

  -- "Today" in the ORG's zone. Never current_date, never the server's zone.
  v_today := (now() at time zone v_timezone)::date;

  -- Every key is named. NEVER to_jsonb(g), never g.*: games carries notes,
  -- scores and attribution; teams carries contact_email; divisions.settings
  -- carries coach metadata (only the game_duration key is projected).
  --
  -- scheduled_at is WALL-CLOCK text with a literal +00 (see game-time.ts); it
  -- is rendered explicitly so the result does not depend on the session's
  -- TimeZone setting.
  --
  -- A division is published iff it is LOCKED. Games have no division_id: a
  -- game belongs to its home team's division (CLAUDE.md, schedule lock).
  select coalesce(jsonb_agg(s.season order by s.sort_start nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_seasons
    from (
      select l.id, l.created_at, l.start_date as sort_start,
        jsonb_build_object(
          'id',         l.id,
          'name',       l.name,
          'start_date', l.start_date,
          'end_date',   l.end_date,

          'divisions', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',            d.id,
                     'name',          d.name,
                     'game_duration', d.settings -> 'game_duration'
                   ) order by d.name, d.id), '[]'::jsonb)
              from public.divisions d
             where d.league_id = l.id and d.locked
          ),

          -- Names only: what the page lists as "not published yet".
          'unpublished', (
            select coalesce(jsonb_agg(d.name order by d.name, d.id), '[]'::jsonb)
              from public.divisions d
             where d.league_id = l.id and not d.locked
          ),

          'teams', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',          t.id,
                     'name',        t.name,
                     'division_id', t.division_id
                   ) order by t.name, t.id), '[]'::jsonb)
              from public.teams t
              join public.divisions d on d.id = t.division_id
             where t.league_id = l.id and d.locked
          ),

          'games', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',                  g.id,
                     'scheduled_at',        to_char(g.scheduled_at at time zone 'UTC',
                                                    'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00',
                     'status',              g.status,
                     'is_away',             g.is_away,
                     'interleague',         g.interleague_org_id is not null,
                     'division_id',         ht.division_id,
                     'home_team_id',        g.home_team_id,
                     'away_team_id',        g.away_team_id,
                     'external_team_name',  g.external_team_name,
                     -- The PARTNER's field, away games only; on a home game it
                     -- can hold a stale counter-proposal.
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
                                                  else null end,
                                                'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), '')),
                                                'home_park', coalesce(loc.is_home_park, false)
                                              )
                                              else null end
                   ) order by g.scheduled_at, g.id), '[]'::jsonb)
              from public.games g
              join public.teams ht on ht.id = g.home_team_id
              join public.divisions hd on hd.id = ht.division_id
              left join public.teams awt on awt.id = g.away_team_id
              left join public.venues v on v.id = g.venue_id
              left join public.locations loc on loc.id = v.location_id
             where g.league_id = l.id
               and hd.locked
               -- An unagreed interleague proposal never leaves the database.
               and g.status <> 'pending_interleague'
          ),

          'playoff_games', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',             pg.id,
                     'playoff_id',     pg.playoff_id,
                     'format',         po.format,
                     'division_id',    pg.division_id,
                     'round',          pg.round,
                     'game_number',    pg.game_number,
                     'scheduled_date', pg.scheduled_date,
                     'start_time',     to_char(pg.start_time, 'HH24:MI'),
                     'status',         pg.status,
                     'home_team',      case when pht.id is not null
                                         then jsonb_build_object('id', pht.id, 'name', pht.name)
                                         else null end,
                     'away_team',      case when pat.id is not null
                                         then jsonb_build_object('id', pat.id, 'name', pat.name)
                                         else null end,
                     'venue',          case when v.id is not null
                                         then jsonb_build_object(
                                           'name', v.name,
                                           'location', case when loc.id is not null
                                             then jsonb_build_object('name', loc.name)
                                             else null end,
                                           'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), '')),
                                           'home_park', coalesce(loc.is_home_park, false)
                                         )
                                         else null end
                   ) order by pg.scheduled_date nulls last, pg.start_time nulls last, pg.game_number, pg.id), '[]'::jsonb)
              from public.playoff_games pg
              join public.playoffs po on po.id = pg.playoff_id
              join public.divisions d on d.id = pg.division_id
              left join public.teams pht on pht.id = pg.home_team_id
              left join public.teams pat on pat.id = pg.away_team_id
              left join public.venues v on v.id = pg.venue_id
              left join public.locations loc on loc.id = v.location_id
             where pg.league_id = l.id
               and d.locked
               and po.status <> 'draft'
          )
        ) as season
        from public.leagues l
       where l.owner_id = v_org_id
         and l.archived_at is null
         and (l.end_date is null or v_today <= l.end_date + 7)
         and exists (select 1 from public.divisions d where d.league_id = l.id and d.locked)
    ) s;

  return jsonb_build_object(
    'status',  'ok',
    'org',     jsonb_build_object('name', v_org_name, 'timezone', v_timezone),
    'today',   v_today,
    'seasons', v_seasons
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Admin functions
-- ────────────────────────────────────────────────────────────────────────────
-- GATE: is_org_member. Every org member is an admin today, so membership IS
-- the admin check. If a non-admin member role (e.g. coach) is ever added,
-- set_public_schedule_enabled and reset_public_schedule_link must be
-- restricted to admins (CLAUDE.md, "is_org_member IS the admin gate").

-- Turn the page on or off. ON creates the org's link the first time and is
-- Pro/Elite only; OFF is allowed on any plan (it only ever removes access) and
-- KEEPS the token, so turning it back on restores the same link.
create or replace function public.set_public_schedule_enabled(
  p_org_id  uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan  text;
  v_token text;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;

  if not p_enabled then
    update public.public_schedule_links
       set enabled = false, updated_at = now()
     where org_id = p_org_id
    returning token into v_token;
    return jsonb_build_object('enabled', false, 'token', v_token);
  end if;

  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  insert into public.public_schedule_links (org_id, created_by)
  values (p_org_id, auth.uid())
  on conflict (org_id) do update
     set enabled = true, updated_at = now()
  returning token into v_token;

  return jsonb_build_object('enabled', true, 'token', v_token);
end;
$$;

-- Replace the token. The old link stops answering in the same statement; the
-- on/off state is unchanged.
create or replace function public.reset_public_schedule_link(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    text;
  v_token   text;
  v_enabled boolean;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  update public.public_schedule_links
     set token = encode(extensions.gen_random_bytes(32), 'hex'),
         token_changed_at = now(),
         updated_at = now()
   where org_id = p_org_id
  returning token, enabled into v_token, v_enabled;

  if not found then
    raise exception 'no_link' using errcode = 'P0002';
  end if;

  return jsonb_build_object('enabled', v_enabled, 'token', v_token);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Function privileges
-- ────────────────────────────────────────────────────────────────────────────
-- Revoke from PUBLIC and from each role (a role-level revoke alone is a silent
-- no-op while PUBLIC holds EXECUTE — CLAUDE.md, found applying 0093), then
-- grant back exactly what is needed.
--   get_league_schedule_by_token   anon, authenticated   (the page + feed)
--   set_public_schedule_enabled    authenticated
--   reset_public_schedule_link     authenticated
revoke execute on function public.get_league_schedule_by_token(text)          from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.set_public_schedule_enabled(uuid, boolean)  from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.reset_public_schedule_link(uuid)            from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.get_league_schedule_by_token(text)         to anon, authenticated;
grant execute on function public.set_public_schedule_enabled(uuid, boolean) to authenticated;
grant execute on function public.reset_public_schedule_link(uuid)           to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Verify — RAISES if anything above is not as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  r       record;
  v_wrong text := '';
begin
  for r in
    select * from (values
      ('public.get_league_schedule_by_token(text)',          true,  true,  false, false),
      ('public.set_public_schedule_enabled(uuid, boolean)',  false, true,  false, false),
      ('public.reset_public_schedule_link(uuid)',            false, true,  false, false)
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
    if has_table_privilege(r.role_name, 'public.public_schedule_links', r.priv)
       <> (r.role_name = 'authenticated' and r.priv = 'SELECT')
    then
      v_wrong := v_wrong || format(' [table %s %s]', r.role_name, r.priv);
    end if;
  end loop;

  -- The reader is the only anonymous path: anon must read none of these.
  for r in
    select unnest(array['games', 'teams', 'divisions', 'leagues', 'venues', 'locations',
                        'playoff_games', 'playoffs', 'profiles']) as t
  loop
    if has_table_privilege('anon', 'public.' || r.t, 'SELECT') then
      v_wrong := v_wrong || format(' [anon can SELECT %s]', r.t);
    end if;
  end loop;

  if v_wrong <> '' then
    raise exception '0105 verification failed:%', v_wrong;
  end if;
end;
$$;
