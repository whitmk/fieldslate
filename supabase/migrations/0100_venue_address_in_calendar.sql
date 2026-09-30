-- 0100: an optional street address for fields, shown ONLY in the team
-- calendar feed's LOCATION line so a phone can open it in Maps.
--
-- NO NEW COLUMN. `venues.address` (0001) and `locations.address` (0085) have
-- existed since their tables were created and were never written by any form;
-- every row is null on the day this is applied (36 venues, 6 locations,
-- checked 2026-09-30). This migration:
--
--   1. Constrains both columns: at most 200 characters and no control
--      characters (a pasted multi-line address must never reach a LOCATION
--      line). Every existing row is null, so the checks cannot fail on apply.
--      Trimming, whitespace collapsing and blank-as-null are done by the UI
--      (src/lib/venues/address.ts) and, for the feed, by the reader below.
--   2. Re-creates get_team_calendar_by_token with ONE added key inside the
--      `venue` object: `address` — the venue's own address, else its park's,
--      each trimmed with blank read as null. Every other line of the function
--      is 0099's, verbatim (live md5(prosrc) matched the repo file before this
--      was written: e26761da58e9782bf1f39cf5d8705005).
--
-- WHERE THE ADDRESS DOES NOT GO, by construction: the Sports Connect and
-- generic CSVs, every print region and the three partner token functions
-- (0087) select `venues(name, location:locations(name))` or name the columns
-- they emit, so none of them can pick this up. `anon` and `service_role` hold
-- no SELECT on venues or locations; the SECURITY DEFINER reader is the only
-- anonymous path to the value, and it answers only a valid token on a locked
-- division of a Pro/Elite org.
--
-- GRANTS: create or replace keeps the function's ACL; the revoke/grant pair is
-- restated so the file says what is true. Verified at the end.
--
-- Proof: scripts/sim/venue-address-calendar-sim.sql (assembled by
-- venue-address-calendar-build.ts), run BEFORE applying, always rolled back.
-- After applying, verify md5(prosrc) against this file's function body.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Shape checks on the two address columns
-- ────────────────────────────────────────────────────────────────────────────
alter table public.venues
  add constraint venues_address_shape
  check (address is null or (length(address) <= 200 and address !~ '[[:cntrl:]]'));

alter table public.locations
  add constraint locations_address_shape
  check (address is null or (length(address) <= 200 and address !~ '[[:cntrl:]]'));

comment on column public.venues.address is
  'Optional street address of this field. Shown ONLY in the team calendar feed (LOCATION line); never in exports, prints or partner pages. Overrides the park''s address when set.';
comment on column public.locations.address is
  'Optional street address of this park/complex. Used by the team calendar feed for a field that has no address of its own; never in exports, prints or partner pages.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The reader — 0099's body plus the one `address` key (see header)
-- ────────────────────────────────────────────────────────────────────────────
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
  --
  -- venue.address (0100) is the ONLY place a street address leaves the
  -- database. Partner-facing token functions do not emit it.
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
                                   else null end,
                                 -- 0100: the field's street address, so a phone
                                 -- can open the LOCATION line in Maps. The
                                 -- venue's own, else its park's, trimmed, blank
                                 -- as null. Emitted HERE and nowhere else: the
                                 -- CSV exports, prints and partner RPCs name
                                 -- their columns and never select it.
                                 'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), ''))
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
-- 3. Grants — unchanged from 0099, restated
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.get_team_calendar_by_token(text) from public, anon, authenticated, service_role, dashboard_readonly;
grant  execute on function public.get_team_calendar_by_token(text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Verify — RAISES if anything above is not as stated
-- ────────────────────────────────────────────────────────────────────────────
do $verify$
declare
  v_src text;
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_address_shape' and conrelid = 'public.venues'::regclass) then
    raise exception '0100 verify: venues_address_shape is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_address_shape' and conrelid = 'public.locations'::regclass) then
    raise exception '0100 verify: locations_address_shape is missing';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.get_team_calendar_by_token(text)'::regprocedure;
  if v_src !~ $q$'address', coalesce\(nullif\(btrim\(v\.address\), ''\), nullif\(btrim\(loc\.address\), ''\)\)$q$ then
    raise exception '0100 verify: the reader does not emit venue.address as specified';
  end if;
  if not has_function_privilege('anon', 'public.get_team_calendar_by_token(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_team_calendar_by_token(text)', 'execute')
     or has_function_privilege('dashboard_readonly', 'public.get_team_calendar_by_token(text)', 'execute')
     or has_function_privilege('service_role', 'public.get_team_calendar_by_token(text)', 'execute') then
    raise exception '0100 verify: reader EXECUTE privileges are not anon + authenticated only';
  end if;
end;
$verify$;
