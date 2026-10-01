-- 0101: demo_requests — one row per "Request a demo" form submission.
--
-- Written ONLY by the server (the /api/demo-request route, through the
-- service-role admin client) and read by nobody in the app: the row is the
-- durable copy of what the prospect typed, and the email to hello@ is the
-- working copy. Whit replies to the email; nothing in the dashboard lists
-- these rows.
--
-- ACCESS, stated exactly:
--   * RLS is ENABLED and there are NO policies. anon and authenticated can
--     never read or write a row from the browser, whatever grants exist.
--   * This project's default privileges hand anon, authenticated and
--     service_role only TRUNCATE / REFERENCES / TRIGGER / MAINTAIN on a new
--     table in public (checked 2026-09-30 against pg_default_acl) and give
--     dashboard_readonly SELECT. So: service_role is GRANTED select, insert
--     and update explicitly (CLAUDE.md: service_role gets no DML by default —
--     the 0070 outage), and anon / authenticated / public are REVOKED
--     entirely, so a prospect's phone number cannot be truncated or
--     referenced by a client role either.
--   * dashboard_readonly is GRANTED SELECT deliberately — it is the role
--     behind Whit's local morning dashboard, and the rows are prospects he
--     wants to see there. It is a grant in this file, not the inherited
--     default, and the verify block requires exactly SELECT and nothing else.
--
-- SHAPE: every answer is text. The four pick-lists are CHECK-constrained to
-- their options so a bad client cannot store anything else; every column has
-- a length cap as a backstop for the route's own validation. email_sent /
-- email_error record whether the notification reached Resend, so a row with
-- email_sent = false is one Whit never saw.

create table public.demo_requests (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),
  name                    text not null,
  email                   text not null,
  league_name             text not null,
  role                    text not null,
  sport                   text not null,
  phone                   text,
  divisions_teams         text,
  fields_parks            text,
  plays_interleague       text,
  current_scheduling_tool text,
  registration_platform   text,
  next_season_start       text,
  timezone                text,
  best_times              text,
  notes                   text,
  email_sent              boolean not null default false,
  email_error             text,

  constraint demo_requests_role_check
    check (role in ('President', 'Scheduler', 'Board member', 'Other')),
  constraint demo_requests_sport_check
    check (sport in ('Baseball/softball', 'Soccer', 'Flag football', 'Other')),
  constraint demo_requests_interleague_check
    check (plays_interleague is null or plays_interleague in ('Yes', 'No', 'Not sure')),
  constraint demo_requests_timezone_check
    check (timezone is null or timezone in ('Pacific', 'Mountain', 'Central', 'Eastern', 'Other')),
  constraint demo_requests_lengths_check check (
    length(name) between 1 and 200
    and length(email) between 3 and 320
    and length(league_name) between 1 and 200
    and (phone is null or length(phone) <= 50)
    and (divisions_teams is null or length(divisions_teams) <= 500)
    and (fields_parks is null or length(fields_parks) <= 500)
    and (current_scheduling_tool is null or length(current_scheduling_tool) <= 200)
    and (registration_platform is null or length(registration_platform) <= 200)
    and (next_season_start is null or length(next_season_start) <= 200)
    and (best_times is null or length(best_times) <= 500)
    and (notes is null or length(notes) <= 5000)
    and (email_error is null or length(email_error) <= 2000)
  )
);

comment on table public.demo_requests is
  'Request-a-demo form submissions. Server-written only (service_role); no client policy exists on purpose.';

alter table public.demo_requests enable row level security;

revoke all on table public.demo_requests from public, anon, authenticated;
grant select, insert, update on table public.demo_requests to service_role;
revoke all on table public.demo_requests from dashboard_readonly;
grant select on table public.demo_requests to dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- Verify — RAISES if the access story above is not exactly true
-- ────────────────────────────────────────────────────────────────────────────
do $verify$
declare
  v_rls boolean;
  v_pol integer;
  r     text;
  p     text;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.demo_requests'::regclass;
  if not coalesce(v_rls, false) then
    raise exception '0101 verify: RLS is not enabled on demo_requests';
  end if;
  select count(*) into v_pol from pg_policies where schemaname = 'public' and tablename = 'demo_requests';
  if v_pol <> 0 then
    raise exception '0101 verify: demo_requests has % polic(ies); it must have none', v_pol;
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.demo_requests', p) then
        raise exception '0101 verify: % still holds % on demo_requests', r, p;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role', 'public.demo_requests', 'SELECT')
     or not has_table_privilege('service_role', 'public.demo_requests', 'INSERT')
     or not has_table_privilege('service_role', 'public.demo_requests', 'UPDATE') then
    raise exception '0101 verify: service_role lacks select/insert/update on demo_requests';
  end if;
  if has_table_privilege('service_role', 'public.demo_requests', 'DELETE') then
    raise exception '0101 verify: service_role must not hold DELETE on demo_requests';
  end if;
  if not has_table_privilege('dashboard_readonly', 'public.demo_requests', 'SELECT') then
    raise exception '0101 verify: dashboard_readonly lacks the deliberate SELECT on demo_requests';
  end if;
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('dashboard_readonly', 'public.demo_requests', p) then
      raise exception '0101 verify: dashboard_readonly holds % on demo_requests; SELECT only', p;
    end if;
  end loop;
end;
$verify$;
