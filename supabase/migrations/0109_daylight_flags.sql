-- 0109 — Daylight flags: field lights + the league's city for sunset times.
--
-- WHAT IT ADDS
--   * venues.has_lights           boolean, NOT NULL, default FALSE.
--   * profiles.sunset_city        text, nullable — a city KEY from the shared
--                                 list in src/lib/sun/us-cities.ts (e.g.
--                                 'ca-santa-rosa'). Null = no city picked.
--   * profiles.daylight_flags_enabled  boolean, NOT NULL, default TRUE.
--   * set_org_daylight(org, city, enabled) — the ONLY writer of the two
--     profiles columns.
--
-- WHY has_lights DEFAULTS FALSE (decided 2026-10-14): the safe direction. A
-- field nobody has marked still gets flagged, so a game in the dark is never
-- hidden by a setting nobody chose. Every existing field starts unlit.
--   The only app path that INSERTs a venue is the Venues page's add form;
--   no SQL function inserts venues and no copy-season path exists, so this
--   default covers every field ever created.
--   Written like every other venue column: the shared venue editor's
--   per-field UPDATE under RLS (0049 `is_org_member`), which the table-level
--   UPDATE grant to `authenticated` (0016) already covers.
--
-- WHY THE CITY IS A KEY, CHECKED ONLY FOR SHAPE: the list lives in
-- TypeScript and may grow (its ids are pinned, additions only — sim
-- practice-planner [S8]). Repeating 142 cities here would be a second copy to
-- drift. A well-shaped key that isn't in the list reads in the app as
-- "city not recognized — pick it again", with no flags; never a fallback.
--
-- WHY ON profiles: the org's settings row, beside `timezone` (0099).
-- profiles is COLUMN-GRANTED (0098): a user may update four columns of their
-- own row and nothing else, and the guard trigger is subtraction-based, so
-- these new columns are protected BY DEFAULT. set_org_daylight is SECURITY
-- DEFINER (runs as postgres) and is the one path, for every admin — the same
-- shape as set_org_timezone.
--
-- GATE: is_org_member. Every org member is an admin today; if a non-admin
-- member role is ever added, set_org_daylight must be restricted to admins
-- along with the other is_org_member-gated writers (see CLAUDE.md).
--
-- NOTHING PUBLIC READS ANY OF THIS. The flags are admin-only: no token
-- function, print, export, email or feed. `npm run sim:daylight-leaks` scans
-- the token functions' bodies for has_lights / sunset_city.
--
-- LOCKS WHEN APPLIED
--   ACCESS EXCLUSIVE on public.venues and on public.profiles, each for its
--   ALTER TABLE ... ADD COLUMN with a constant default (no table rewrite; the
--   CHECK on sunset_city scans nothing, every row is null). profiles is read
--   on nearly every page load, so the apply blocks those reads for the
--   length of the statement — well under a second — or for the whole
--   migration if it runs as one transaction.

alter table public.venues
  add column has_lights boolean not null default false;

comment on column public.venues.has_lights is
  'Whether the field has lights. Default false: a field nobody has marked is '
  'flagged when a game on it ends after or near sunset (admin-only daylight '
  'flags, src/lib/daylight).';

alter table public.profiles
  add column sunset_city text
    constraint profiles_sunset_city_check check (
      sunset_city ~ '^[a-z]{2}-[a-z0-9]+(-[a-z0-9]+)*$' and length(sunset_city) <= 60
    ),
  add column daylight_flags_enabled boolean not null default true;

comment on column public.profiles.sunset_city is
  'The league''s city for sunset times: a key from src/lib/sun/us-cities.ts. '
  'Null = no city (no daylight flags). Written only by set_org_daylight.';
comment on column public.profiles.daylight_flags_enabled is
  'Whether daylight flags show for this league. Written only by set_org_daylight.';

-- p_city: a key, or null / '' to clear it. p_enabled: required.
create or replace function public.set_org_daylight(p_org_id uuid, p_city text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_city text := nullif(btrim(p_city), '');
  v_n    integer;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_enabled' using errcode = '22023';
  end if;

  begin
    update public.profiles
       set sunset_city = v_city,
           daylight_flags_enabled = p_enabled
     where id = p_org_id;
    get diagnostics v_n = row_count;
  exception
    when check_violation then
      raise exception 'invalid_city' using errcode = '22023';
  end;

  -- The org's row must exist; an update that touched nothing saved nothing.
  if v_n <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0002';
  end if;

  return jsonb_build_object('sunset_city', v_city, 'daylight_flags_enabled', p_enabled);
end;
$$;

-- Revoke from PUBLIC and from each role (a role-level revoke alone is a silent
-- no-op while PUBLIC holds it, and this project's default privileges grant
-- some roles directly), then grant back exactly one.
revoke execute on function public.set_org_daylight(uuid, text, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.set_org_daylight(uuid, text, boolean)
  to authenticated;

-- Refuse to finish with a wrong privilege or a writable column: the no-op
-- forms leave no error behind.
do $check$
declare
  v_fn    constant text := 'public.set_org_daylight(uuid, text, boolean)';
  v_wrong text := '';
begin
  if not has_function_privilege('authenticated', v_fn, 'execute') then v_wrong := v_wrong || ' [fn authenticated]'; end if;
  if has_function_privilege('anon', v_fn, 'execute')               then v_wrong := v_wrong || ' [fn anon]'; end if;
  if has_function_privilege('service_role', v_fn, 'execute')       then v_wrong := v_wrong || ' [fn service_role]'; end if;
  if has_function_privilege('dashboard_readonly', v_fn, 'execute') then v_wrong := v_wrong || ' [fn dashboard_readonly]'; end if;
  if has_column_privilege('authenticated', 'public.profiles', 'sunset_city', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'daylight_flags_enabled', 'update') then
    v_wrong := v_wrong || ' [profiles columns writable by authenticated]';
  end if;
  if not has_column_privilege('authenticated', 'public.venues', 'has_lights', 'update') then
    v_wrong := v_wrong || ' [venues.has_lights not updatable by authenticated]';
  end if;
  if v_wrong <> '' then
    raise exception '0109 verification failed:%', v_wrong;
  end if;
end;
$check$;
