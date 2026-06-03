-- Item 13.5a: server-side enforcement of the 1-active-season cap for ALL tiers.
--
-- Seasons are the unit of sale — every plan includes 1 active season; more are
-- PURCHASED (Stripe → webhook inserts the row directly via the service-role
-- client, NOT through this RPC). create_league is the FREE create path used by
-- the new-season form, so it must block the org's 2nd+ active season for every
-- tier. Previously only Free was blocked here, leaving a route-guard-only gap:
-- a Pro/Elite user could navigate straight to /dashboard/leagues/new and
-- create extra active seasons for free. This closes that gap.
--
-- Change vs migration 0055: the cap check now fires for any plan once the org
-- has >= 1 active season (archived_at IS NULL) — previously gated on
-- `v_plan = 'free'`. The count already excludes archived seasons, so archiving
-- a season still frees the slot. Body is otherwise identical to 0055; the
-- cap_reached JSON still reports the caller's actual plan.

create or replace function public.create_league(
  p_org_id     uuid,
  p_name       text,
  p_sport      text,
  p_season     text,
  p_start_date date,
  p_end_date   date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_plan     text;
  v_count    int;
  v_row      public.leagues%rowtype;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'not_org_member' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.leagues
   where owner_id    = p_org_id
     and archived_at is null;

  v_plan := coalesce(
    (select plan from public.profiles where id = p_org_id),
    'free'
  );

  -- All tiers include exactly 1 active season; additional active seasons are
  -- purchased (and provisioned by the Stripe webhook, which bypasses this RPC).
  if v_count >= 1 then
    return jsonb_build_object(
      'error', 'cap_reached',
      'cap',   'activeSeasons',
      'limit', 1,
      'plan',  v_plan
    );
  end if;

  insert into public.leagues (
    name, sport, season, status, owner_id, start_date, end_date
  ) values (
    p_name, p_sport, p_season, 'active', p_org_id, p_start_date, p_end_date
  )
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_league(uuid, text, text, text, date, date) from public;
grant execute on function public.create_league(uuid, text, text, text, date, date) to authenticated;
