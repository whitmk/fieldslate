-- Permanent season deletion (archive is the soft path; this is the hard one).
--
-- SECURITY DEFINER RPC so the invariants live server-side regardless of
-- client paths or RLS drift:
--   1. Caller must be an org member (is_org_member, same as every other
--      destructive action).
--   2. The season must already be ARCHIVED — no client can hard-delete an
--      active season; archive-then-delete is a deliberate two-step.
--
-- Deletion order: games are deleted explicitly before the league row. The
-- games -> teams FKs are NO ACTION, and while a single cascading DELETE
-- statement would normally satisfy them at statement end, the explicit
-- ordering removes any dependence on constraint-timing subtleties. Everything
-- else (divisions, teams, umpires + their 0062 tables, official_roles,
-- playoffs, snack shack, interleague invites, activity log, blackout dates,
-- umpire_role_rates, conflict_overrides via games) cascades from leagues or
-- the rows deleted here. Venues are org-scoped and survive.

create or replace function public.delete_league_permanently(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league public.leagues%rowtype;
  v_divisions int;
  v_teams int;
  v_games int;
  v_umpires int;
begin
  select * into v_league
  from public.leagues
  where id = p_league_id
  for update;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if v_league.archived_at is null then
    raise exception 'league_not_archived' using errcode = 'P0001';
  end if;

  select count(*) into v_divisions from public.divisions where league_id = p_league_id;
  select count(*) into v_teams from public.teams where league_id = p_league_id;
  select count(*) into v_games from public.games where league_id = p_league_id;
  select count(*) into v_umpires from public.umpires where season_id = p_league_id;

  delete from public.games where league_id = p_league_id;
  delete from public.leagues where id = p_league_id;

  return jsonb_build_object(
    'deleted',   true,
    'name',      v_league.name,
    'divisions', v_divisions,
    'teams',     v_teams,
    'games',     v_games,
    'officials', v_umpires
  );
end;
$$;

revoke all on function public.delete_league_permanently(uuid) from public;
grant execute on function public.delete_league_permanently(uuid) to authenticated;
