-- 0118 — Renaming an official role carries its assignments, pay rates and
-- division role lists with it (2026-11-07).
--
-- WHY. Assignments (`game_umpires.role`), per-role pay rates
-- (`umpire_role_rates.role`) and each division's legacy `umpire_roles` list
-- name a role by its TEXT. The Officials page renamed only
-- `official_roles.name`, so after "Plate" → "Plate umpire":
--   * every existing slot read Open next to a leftover "Plate" row, and the
--     Open slot could be filled — two plate officials on one game (the
--     (game_id, role) unique index is on the text, so it allowed it);
--   * the renamed role paid $0 (rates are looked up by text);
--   * the next division-wizard save re-created "Plate" from the stale
--     `divisions.umpire_roles` list.
--
-- WHAT.
--   1. `rename_official_role(p_role_id, p_new_name)` — SECURITY DEFINER,
--      `search_path = public, pg_temp`, EXECUTE for authenticated only. In ONE
--      transaction: lock the role row → `is_org_member` on the season's org →
--      the new name (trimmed) must be non-blank and must not match another
--      role of the season TRIMMED AND CASE-INSENSITIVELY → refuse a rename the
--      text uniques would reject → rename the role, every assignment and pay
--      rate of THIS SEASON that points at it (by `role_id`, or by the old text
--      where `role_id` is null — legacy rows), setting `role_id` on each so a
--      later move to id-keyed slots starts clean, and the old name in every
--      division's `umpire_roles` of this season → log it.
--   2. THE DATABASE IS THE GUARD, not a source check: UPDATE on
--      `official_roles` is revoked from every browser role (from PUBLIC too —
--      a role-level revoke alone is a no-op for inherited grants) and granted
--      back for `sort_order` only, which the role reordering writes. So this
--      function is the ONLY way to change a role's name. INSERT, SELECT and
--      DELETE are unchanged (adding a role, and ensureSeasonRoleIds'
--      `on conflict do nothing` upsert, need no UPDATE).
--
-- NOT TOUCHED. The lock and "Sent to parents" triggers are on `games` only;
-- `game_umpires`, `umpire_role_rates` and `official_roles` have no triggers.
-- The `divisions` UPDATE fires `set_divisions_updated_at` (bumps updated_at)
-- and `team_calendar_links_on_division_lock`, which is `UPDATE OF locked …
-- WHEN (new.locked AND NOT old.locked)` — this function never writes
-- `locked`, so it cannot fire. Pre-0062 assignments whose text matches no
-- role at all are left alone (5 in the test org, archived season).
--
-- Refusals (raised; nothing written): role_not_found, not_authorized,
-- name_required, name_taken, assignment_role_conflict, rate_role_conflict.

create or replace function public.rename_official_role(p_role_id uuid, p_new_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role    record;
  v_owner   uuid;
  v_name    text := btrim(coalesce(p_new_name, ''));
  v_assign  integer := 0;
  v_rates   integer := 0;
  v_divs    integer := 0;
  v_n       integer;
begin
  -- 1. The role, locked, and its season's org.
  select r.id, r.season_id, r.name
    into v_role
    from public.official_roles r
   where r.id = p_role_id
     for update;
  if not found then
    raise exception 'role_not_found';
  end if;

  select l.owner_id into v_owner from public.leagues l where l.id = v_role.season_id;
  if v_owner is null or not public.is_org_member(v_owner) then
    raise exception 'not_authorized';
  end if;

  -- 2. The new name.
  if v_name = '' then
    raise exception 'name_required';
  end if;
  if v_name = v_role.name then
    return jsonb_build_object(
      'committed', true, 'changed', false, 'role_id', p_role_id, 'name', v_name,
      'assignments', 0, 'rates', 0, 'divisions', 0);
  end if;
  -- "Plate" and "plate " are the same name. The role itself is excluded, so
  -- a case-only rename of a role ("Plate" → "plate") is allowed.
  if exists (
    select 1 from public.official_roles r
     where r.season_id = v_role.season_id
       and r.id <> p_role_id
       and lower(btrim(r.name)) = lower(v_name)
  ) then
    raise exception 'name_taken';
  end if;

  -- 3. Renames the text uniques would refuse. A game may already carry a
  -- leftover row with the new text (a pre-role-list assignment); renaming
  -- would put two rows with one role on that game. Counted, never left to a
  -- raw unique-violation.
  if exists (
    select 1
      from public.game_umpires a
      join public.games g on g.id = a.game_id
     where g.league_id = v_role.season_id
       and (a.role_id = p_role_id
            or (a.role_id is null and a.role = v_role.name)
            or a.role = v_name)
     group by a.game_id
    having count(*) > 1
  ) then
    raise exception 'assignment_role_conflict';
  end if;
  if (
    select count(*)
      from public.umpire_role_rates rr
     where rr.season_id = v_role.season_id
       and (rr.role_id = p_role_id
            or (rr.role_id is null and rr.role = v_role.name)
            or rr.role = v_name)
  ) > 1 then
    raise exception 'rate_role_conflict';
  end if;

  -- 4. The writes. Every assignment/rate of THIS season that points at the
  -- role — by id, or by the old text on a legacy row — takes the new name AND
  -- the role's id.
  update public.official_roles set name = v_name where id = p_role_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'nothing_saved';
  end if;

  update public.game_umpires a
     set role = v_name,
         role_id = p_role_id
    from public.games g
   where g.id = a.game_id
     and g.league_id = v_role.season_id
     and (a.role_id = p_role_id or (a.role_id is null and a.role = v_role.name));
  get diagnostics v_assign = row_count;

  update public.umpire_role_rates rr
     set role = v_name,
         role_id = p_role_id
   where rr.season_id = v_role.season_id
     and (rr.role_id = p_role_id or (rr.role_id is null and rr.role = v_role.name));
  get diagnostics v_rates = row_count;

  -- The legacy per-division list: the old name (matched trimmed, as
  -- ensureSeasonRoleIds trims) becomes the new one, order kept. Only lists
  -- that hold it are written, so no other division's updated_at moves.
  update public.divisions d
     set umpire_roles = (
       select coalesce(
                jsonb_agg(
                  case
                    when jsonb_typeof(x.e) = 'string' and btrim(x.e #>> '{}') = v_role.name
                      then to_jsonb(v_name)
                    else x.e
                  end
                  order by x.ord),
                '[]'::jsonb)
         from jsonb_array_elements(d.umpire_roles) with ordinality as x(e, ord))
   where d.league_id = v_role.season_id
     and jsonb_typeof(d.umpire_roles) = 'array'
     and exists (
       select 1 from jsonb_array_elements(d.umpire_roles) as y(e)
        where jsonb_typeof(y.e) = 'string' and btrim(y.e #>> '{}') = v_role.name);
  get diagnostics v_divs = row_count;

  -- 5. The log.
  insert into public.activity_log (league_id, event_type, message)
  values (
    v_role.season_id,
    'official_role_renamed',
    format('Official role renamed: %s → %s (%s assignment%s, %s pay rate%s, %s division%s updated).',
      v_role.name, v_name,
      v_assign, case when v_assign = 1 then '' else 's' end,
      v_rates, case when v_rates = 1 then '' else 's' end,
      v_divs, case when v_divs = 1 then '' else 's' end));

  return jsonb_build_object(
    'committed', true, 'changed', true, 'role_id', p_role_id, 'name', v_name,
    'assignments', v_assign, 'rates', v_rates, 'divisions', v_divs);
end;
$$;

revoke all on function public.rename_official_role(uuid, text) from public;
revoke all on function public.rename_official_role(uuid, text) from anon, service_role, dashboard_readonly;
grant execute on function public.rename_official_role(uuid, text) to authenticated;

-- The guard: no browser role may write a role's name directly.
revoke update on table public.official_roles from public;
revoke update on table public.official_roles from anon, authenticated, service_role, dashboard_readonly;
grant update (sort_order) on table public.official_roles to authenticated;

-- Verify, or the whole migration rolls back.
do $v$
declare
  r text;
begin
  if not has_function_privilege('authenticated', 'public.rename_official_role(uuid, text)', 'EXECUTE') then
    raise exception '0118 verify: authenticated cannot execute rename_official_role';
  end if;
  foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
    if has_function_privilege(r, 'public.rename_official_role(uuid, text)', 'EXECUTE') then
      raise exception '0118 verify: % can execute rename_official_role', r;
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if has_column_privilege(r, 'public.official_roles', 'name', 'UPDATE') then
      raise exception '0118 verify: % can update official_roles.name', r;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.official_roles', 'sort_order', 'UPDATE') then
    raise exception '0118 verify: authenticated cannot update official_roles.sort_order';
  end if;
  if not has_table_privilege('authenticated', 'public.official_roles', 'INSERT')
     or not has_table_privilege('authenticated', 'public.official_roles', 'DELETE')
     or not has_table_privilege('authenticated', 'public.official_roles', 'SELECT') then
    raise exception '0118 verify: authenticated lost INSERT/DELETE/SELECT on official_roles';
  end if;
end
$v$;
