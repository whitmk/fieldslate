-- Locations: an org-scoped "park / complex" that groups venues (fields).
-- The venue stays the atomic bookable unit; a location holds NO schedule data
-- and NOTHING scheduling-related reads location_id (the scope fence — see
-- CLAUDE.md). Only the CSV export, the display/label formatter, and the
-- partner-facing surfaces read it.
--
-- Modeled EXACTLY on venues: same owner_id → profiles(id) on delete cascade,
-- the same single FOR ALL is_org_member(owner_id) RLS policy, and a grant to
-- `authenticated` ONLY. Per the project's no-default-grants rule, service_role
-- gets NO grant — every consumer of this table is the client-side (authed)
-- Supabase browser client, never the admin client.

create table public.locations (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  address text,
  city text,
  state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.locations enable row level security;

-- Mirror the venues policy verbatim (see 0049): org members manage their own.
create policy "Org members can manage locations"
  on public.locations for all
  using      (public.is_org_member(owner_id))
  with check (public.is_org_member(owner_id));

create trigger set_locations_updated_at before update on public.locations
  for each row execute procedure public.set_updated_at();

-- Authenticated (client) gets full DML, matching venues' final grant state.
-- No anon grant, no service_role grant.
grant select, insert, update, delete on public.locations to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- venues.location_id — the ONLY link between the two tables.
-- NULLABLE (a venue with no location behaves exactly as it does today).
-- ON DELETE RESTRICT: a location may not be deleted while venues still point at
-- it. RESTRICT is a BACKSTOP ONLY — the delete RPC below counts references and
-- refuses first, so the raw FK error is never the thing a user sees.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.venues
  add column location_id uuid references public.locations(id) on delete restrict;

create index venues_location_id_idx on public.venues (location_id);

-- ────────────────────────────────────────────────────────────────────────────
-- delete_location_if_unreferenced — modeled on delete_venue_if_unreferenced
-- (0078). The COUNT is the guard; the ON DELETE RESTRICT FK is a backstop we
-- never lean on. A location owns nothing but its grouping of venues, so the
-- only reference is venues.location_id.
--   1. Row-lock the location; must exist.
--   2. Caller must be an org member on the location's owner_id.
--   3. Count venues still pointing at it. Nonzero → return { blocked, count,
--      venue_names } and DELETE NOTHING; the confirm UI names the fields.
--   4. Zero → delete, in the same transaction as the count.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_location_if_unreferenced(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location    public.locations%rowtype;
  v_venues      int;
  v_venue_names text[];
begin
  select * into v_location
  from public.locations
  where id = p_location_id
  for update;

  if not found then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_location.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select count(*), coalesce(array_agg(name order by name), '{}')
    into v_venues, v_venue_names
    from public.venues where location_id = p_location_id;

  if v_venues > 0 then
    return jsonb_build_object(
      'blocked',     true,
      'name',        v_location.name,
      'count',       v_venues,
      'venue_names', to_jsonb(v_venue_names)
    );
  end if;

  delete from public.locations where id = p_location_id;

  return jsonb_build_object(
    'deleted', true,
    'name',    v_location.name
  );
end;
$$;

revoke all on function public.delete_location_if_unreferenced(uuid) from public;
grant execute on function public.delete_location_if_unreferenced(uuid) to authenticated;
