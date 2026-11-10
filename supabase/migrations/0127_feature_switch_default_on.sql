-- 0127 — Volunteer sign-ups and officials sign-up on by default (2026-11-09,
-- branch feat/launch-volunteers-officials).
--
-- THE CHANGE: org_feature_on (0120) treated a league with no org_features row
-- as OFF, so both features reached only the leagues someone switched on in the
-- SQL editor. It now treats NO ROW as ON for exactly two features, by name:
-- 'volunteers' and 'official_signup' (decided 2026-11-09). Any other feature
-- name with no row stays OFF — a feature added to the table later is off until
-- a migration says otherwise. A row still decides: `enabled = false` turns a
-- feature off for that league (the per-org switch, set in the SQL editor as
-- before); `enabled = true` keeps it on. A null feature name is OFF, never
-- null — every caller writes `if not org_feature_on(…)`, and `not null` would
-- let it through.
--
-- WHAT THIS TURNS ON, AND WHAT IT DOESN'T: every Elite league (Santa Rosa
-- American Little League included — approved by Whit 2026-11-09) gets the
-- admin screens: the Volunteers pages, the two Settings cards, and "Ask for
-- help" / the link button / the divisions control on the Officials page. Pro
-- and Free leagues get the same entry points showing an Elite upgrade prompt
-- (every function still checks the plan on its own). NOTHING GOES PUBLIC: no
-- row is written here, a league's volunteer sign-up link starts off
-- (volunteer_settings.link_enabled default false) and so does officials
-- sign-up (official_signup_settings.enabled default false); each needs an
-- admin to confirm a contact email (0126) and turn it on.
--
-- WRITES NO ROW. Signature, language sql, STABLE, SECURITY INVOKER,
-- search_path and EXECUTE (no role) unchanged. LOCKS when applied: none beyond
-- the function's own catalog row (CREATE OR REPLACE FUNCTION) and the table's
-- comment (COMMENT ON takes SHARE UPDATE EXCLUSIVE on org_features — two rows,
-- blocks only other DDL on that table).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The function
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.org_feature_on(p_owner_id uuid, p_feature text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- Callable by no role; the SECURITY DEFINER functions reach it as their
  -- owner. A row decides. No row = ON for 'volunteers' and 'official_signup'
  -- only (0127); any other feature, or a null name, = OFF.
  select coalesce(
    (select f.enabled from public.org_features f
      where f.owner_id = p_owner_id and f.feature = p_feature),
    coalesce(p_feature in ('volunteers', 'official_signup'), false));
$$;

comment on table public.org_features is
  'Per-org feature switches. No role holds any privilege: set in the SQL editor '
  'only. Read through org_feature_on (callable by no role). No row = ON for '
  'volunteers and official_signup (0127), OFF for any other feature; a row with '
  'enabled = false turns a feature off for that league.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Privileges (unchanged by CREATE OR REPLACE; restated so the file says it)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.org_feature_on(uuid, text) from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Verify, or the whole migration rolls back
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  r text;
  v_nobody uuid := '00000000-0000-0000-0000-000000000127';
begin
  if (select count(*) from pg_proc where proname = 'org_feature_on' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0127 verify: org_feature_on must have exactly one overload';
  end if;
  if exists (select 1 from pg_proc where proname = 'org_feature_on' and pronamespace = 'public'::regnamespace
              and (prosecdef or provolatile <> 's')) then
    raise exception '0127 verify: org_feature_on must stay SECURITY INVOKER and STABLE';
  end if;
  if public.org_feature_on(v_nobody, 'volunteers') is distinct from true
     or public.org_feature_on(v_nobody, 'official_signup') is distinct from true then
    raise exception '0127 verify: no row must mean on for volunteers and official_signup';
  end if;
  if public.org_feature_on(v_nobody, 'zz_unknown_feature') is distinct from false
     or public.org_feature_on(v_nobody, null) is distinct from false then
    raise exception '0127 verify: an unknown or null feature with no row must be off';
  end if;
  foreach r in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if r = 'public' then
      if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.proname = 'org_feature_on' and p.pronamespace = 'public'::regnamespace
                    and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
        raise exception '0127 verify: PUBLIC can execute org_feature_on';
      end if;
    elsif has_function_privilege(r, 'public.org_feature_on(uuid, text)', 'EXECUTE') then
      raise exception '0127 verify: % can execute org_feature_on', r;
    end if;
  end loop;
end $v$;
