-- SQL-level harness for migration 0097 (Interleague Case A: a signed-in league
-- accepts an invite onto its own schedule).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- lives in a SECURITY INVOKER wrapper that calls an anon-granted SECURITY
-- DEFINER token function, under RLS, with a trigger (0082) in the path. NOT
-- `npm run`-able, NOT in CI. The page/route/form side is
-- `npm run sim:invite-page`.
--
-- HOW TO RUN: ONE batch, in this order, via the Supabase MCP against the live
-- DB, AFTER 0097 is applied =
--   1. the SETUP block (pg_temp helpers + the PRE-0097 accept body rebuilt as
--      pg_temp.old_accept_interleague_invite — the live body before 0097 was
--      the repo 0074 body minus three comment lines, md5 fe50e8b9…; T0 pins
--      that the rebuild is that exact text),
--   2. the HARNESS block.
-- The harness ALWAYS raises, so every scratch row and every mutant rolls back.
-- Leak check afterwards: zero rows whose name/token starts with HARNESS-0097,
-- and md5(prosrc) of all three 0097 functions equal to the repo file.
--
-- EACH PASS IS ITS OWN SUB-TRANSACTION (the 0091/0094 pattern). Pass 0 is the
-- baseline; each later pass rewrites the wrapper via
-- execute replace(pg_get_functiondef(...)) (asserting the replace BIT — a
-- no-op mutant is reported as MUTANT_NOOP, never as a kill). Fixtures are
-- inserted inside the pass and the pass ends by raising PASS_END with the
-- failure tags in the DETAIL, so both roll back before the next pass.
-- A mutant is KILLED only if its named target tag is among its failures.
--
-- IMPERSONATION: the wrapper is called under `set local role authenticated`
-- with request.jwt.claims.sub = the recipient's user id, exactly what
-- PostgREST does for a signed-in browser. Assertions run back as postgres.
--
-- FIXTURES (all scratch, all rolled back): host = the founder's SRALL test org
-- (aa21d01c…, season "Fall 2026" b921214d…, T-Ball teams Yankees/Red Sox);
-- recipient = the "test" org (bbf9afe1…, season "QA Fall 2026" 4f72caa9…,
-- Majors teams). Four host games: G1 host-home (we travel), G2 host-away (we
-- host — needs our field), G3 (we counter), G4 (we decline).
--
-- Assertions
--   T0   rebuilt pre-0097 accept body md5 = fe50e8b9d676e615b26f1d85d989dab4
--   T1   twin fixtures: OLD vs NEW accept — game rows, invite row, response
--        row and returned JSON (volatile keys stripped) identical
--   A1h  host side after a signed-in accept: G1/G2 scheduled, external_team_name
--        = our team NAMES, G2.proposed_venue_name = our field's qualified label
--   A1i  invite accepted, response row exists, schedule_token issued
--   A1o  our rows: exactly 2, away_team_id NULL on both, is_away inverted,
--        external_team_name = host team name, venue/proposed venue per side,
--        scheduled_at equal
--   A1p  partner card in OUR org named after the host LEAGUE (profiles.org_name)
--        with the sending admin's email; returned partner_org_name matches
--   A2   countered G3: host row pending with our name + proposed time; NOTHING
--        created on our side for it
--   A3   declined G4: host row deleted; nothing ours
--   A4   own_invite: a member of the SENDING org is refused, nothing written
--   A5   privileges: anon/dashboard_readonly cannot execute; authenticated can;
--        a call as anon raises 42501
--   A6   a team id from ANOTHER league raises team_not_found, nothing written
--   A7   we host + no venue raises venue_required
--   A8   ATOMICITY: our division locked → the 0082 trigger raises AND the host
--        side is rolled back (invite still pending, G1 still pending, no card)
--   A10  an existing card with the host league's name (any case) is REUSED
-- Mutants (target tag)
--   SM1 host half skipped (fabricated inner result)        → A1h (+A1i)
--   SM2 our row's away_team_id points at the host's team    → A1o
--   SM3 own-invite guard removed                            → A4
--   SM4 a countered game also gets our row                  → A2
--   SM5 is_away not inverted                                → A1o
--   SM6 our insert wrapped in a swallowing exception block  → A8
--   SM7 wrapper granted to anon                             → A5
--   SM8 venue_required raise removed                        → A7
-- Anti-vacuity counters (each must be > 0 on the baseline pass):
--   c_signed_in_accept  the wrapper returned success
--   c_anon_accept       the token RPC was driven directly (old AND new)
--   c_we_host           a hosted-by-us game produced our row with a venue
--   c_we_travel         a hosted-by-them game produced our row without one
--   c_refused           a refusal path raised and left nothing behind
--
-- RUN LOG 2026-09-28 (live DB, after 0097 applied; md5s verified before and
-- after): PASS 0 ALL GREEN, counters signed_in=2 anon=2 we_host=1 we_travel=1
-- refused=5. SM1 killed at A1h (+A1i/A2/A3), SM2 at A1o (away_team_id set),
-- SM3 at A4 ("no error/accepted/1/1" — the sending org accepted its own
-- invite and grew a card), SM4 at A2 (+A1:result/A1o:count — a third row for
-- the countered game), SM5 at A1o, SM6 at A8 ("no error/accepted/scheduled/
-- 0/0" — the invite accepted and the host game confirmed while OUR row was
-- swallowed: exactly the split the wrapper exists to prevent), SM7 at A5
-- (both the grant check and the anon call), SM8 at A7 (tag only — see the
-- note above). Leak check: zero HARNESS-0097 rows in locations, venues,
-- interleague_orgs, interleague_invites; zero new recipient games; host
-- T-Ball still locked, recipient Majors still unlocked; pg_temp copy gone.
-- First run crashed four mutant passes on `text[] || 'literal'` (parsed as
-- an array literal) and mis-scoped three refusal assertions against state
-- left by the main case in the same pass — both fixed before this log.

-- ── SETUP ────────────────────────────────────────────────────────────────────
do $setup$
declare d text;
begin
  d := pg_get_functiondef('public.accept_interleague_invite(text, jsonb)'::regprocedure);
  d := replace(d, 'public.accept_interleague_invite', 'pg_temp.old_accept_interleague_invite');
  d := replace(d, ' SECURITY DEFINER', '');
  d := replace(d,
    E'  -- Supersede sibling pending invites for the same season + partner org.\n'
    || E'  -- Duplicate sends happen (retries, email typos); once any one is answered\n'
    || E'  -- the others can never be meaningfully accepted, and leaving them \'pending\'\n'
    || E'  -- is what kept resurrecting the "still shows pending" report.\n',
    E'  -- Supersede sibling pending invites for the same season + partner org.\n');
  execute d;
end
$setup$;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Scratch fixtures. Returns the ids the baseline needs.
create or replace function pg_temp.fx(p_suffix text) returns jsonb language plpgsql as $$
declare
  host_org  uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';
  host_szn  uuid := 'b921214d-ef2d-41c8-8331-ca6597c57d20';
  yankees   uuid := 'b5d39661-86b5-41a1-ba9b-f74f8615e2a6';
  redsox    uuid := '642b23be-7977-4bf0-8b2f-acae4cb67ca2';
  rec_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  rec_szn   uuid := '4f72caa9-9088-4118-be3e-fc7cdddd79a0';
  rec_t1    uuid := '0355d1be-339b-42d2-b59d-6372e936bd83';  -- Majors Team 1
  rec_t2    uuid := '9bba9710-4e67-497c-a836-cd02e2fd31b1';  -- Majors Team 2
  rec_div   uuid := '7a2580dd-1f4d-41dd-8123-0746ac6e9c5f';  -- Majors
  h_loc uuid; h_ven uuid; card uuid; inv uuid; g1 uuid; g2 uuid; g3 uuid; g4 uuid;
  r_loc uuid; r_ven uuid;
begin
  -- The host's T-Ball division is locked live; the fixture unlocks it for the
  -- pass (rolled back with everything else) so its pending games can exist.
  update public.divisions set locked = false where id = 'f11ca4a8-2622-4d07-9a1d-48bb419f13ef';
  insert into public.locations (owner_id, name) values (host_org, 'HARNESS-0097 Park ' || p_suffix) returning id into h_loc;
  insert into public.venues (owner_id, name, location_id) values (host_org, 'HARNESS-0097 Field ' || p_suffix, h_loc) returning id into h_ven;
  insert into public.interleague_orgs (owner_id, name, admin_email)
    values (host_org, 'HARNESS-0097 Partner ' || p_suffix, 'harness-0097@example.test') returning id into card;
  insert into public.interleague_invites (token, sender_user_id, interleague_org_id, season_id, recipient_email, status)
    values ('HARNESS-0097-tok-' || p_suffix, host_org, card, host_szn, 'harness-0097@example.test', 'pending') returning id into inv;
  insert into public.games (league_id, home_team_id, away_team_id, interleague_org_id, venue_id, scheduled_at, status, is_away)
    values (host_szn, yankees, null, card, h_ven, '2026-10-10T09:00:00+00:00', 'pending_interleague', false) returning id into g1;
  insert into public.games (league_id, home_team_id, away_team_id, interleague_org_id, venue_id, scheduled_at, status, is_away)
    values (host_szn, redsox, null, card, null, '2026-10-17T11:00:00+00:00', 'pending_interleague', true) returning id into g2;
  insert into public.games (league_id, home_team_id, away_team_id, interleague_org_id, venue_id, scheduled_at, status, is_away)
    values (host_szn, yankees, null, card, h_ven, '2026-10-24T13:00:00+00:00', 'pending_interleague', false) returning id into g3;
  insert into public.games (league_id, home_team_id, away_team_id, interleague_org_id, venue_id, scheduled_at, status, is_away)
    values (host_szn, redsox, null, card, h_ven, '2026-10-31T15:00:00+00:00', 'pending_interleague', false) returning id into g4;
  insert into public.locations (owner_id, name) values (rec_org, 'HARNESS-0097 Complex ' || p_suffix) returning id into r_loc;
  insert into public.venues (owner_id, name, location_id) values (rec_org, 'HARNESS-0097 Home Field ' || p_suffix, r_loc) returning id into r_ven;
  return jsonb_build_object(
    'host_org', host_org, 'host_szn', host_szn, 'yankees', yankees, 'redsox', redsox,
    'rec_org', rec_org, 'rec_szn', rec_szn, 'rec_t1', rec_t1, 'rec_t2', rec_t2, 'rec_div', rec_div,
    'h_ven', h_ven, 'h_label', 'HARNESS-0097 Park ' || p_suffix || ' — ' || 'HARNESS-0097 Field ' || p_suffix,
    'card', card, 'inv', inv, 'token', 'HARNESS-0097-tok-' || p_suffix,
    'g1', g1, 'g2', g2, 'g3', g3, 'g4', g4,
    'r_ven', r_ven, 'r_label', 'HARNESS-0097 Complex ' || p_suffix || ' — ' || 'HARNESS-0097 Home Field ' || p_suffix);
end $$;

-- The baseline scenario. Raises PASS_END with failure tags in DETAIL so the
-- caller's sub-transaction rolls back everything the pass did.
create or replace function pg_temp.baseline() returns void language plpgsql as $$
declare
  f text[] := '{}';
  c_signed_in_accept int := 0; c_anon_accept int := 0; c_we_host int := 0; c_we_travel int := 0; c_refused int := 0;
  x jsonb; r jsonb; n int; s text; t text; p timestamptz; card_id uuid; o1 record; o2 record;
  x2 jsonb; r_old jsonb; r_new jsonb; rows_old jsonb; rows_new jsonb; inv_old jsonb; inv_new jsonb; resp_old int; resp_new int;
  pre_card uuid; err text; state text; g0 int; g1 int; o0 int; o1n int;
  responses jsonb;
begin
  -- ── T0: the rebuilt pre-0097 body is the exact pre-change live text ──
  select md5(prosrc) into s from pg_proc where proname = 'old_accept_interleague_invite' and pronamespace = pg_my_temp_schema();
  if s <> 'fe50e8b9d676e615b26f1d85d989dab4' then f := array_append(f, ('T0:' || coalesce(s, 'missing'))); end if;

  -- ── T1: twin fixtures, OLD vs NEW accept, anonymous shape ──
  x  := pg_temp.fx('twinA');
  x2 := pg_temp.fx('twinB');
  responses := jsonb_build_array(
    jsonb_build_object('game_id', x->>'g1', 'team_name', 'Wildcats', 'action', 'accept'),
    jsonb_build_object('game_id', x->>'g2', 'team_name', 'Wildcats', 'action', 'accept', 'venue_name', 'Riverside A'),
    jsonb_build_object('game_id', x->>'g3', 'team_name', 'Bears', 'action', 'counter', 'proposed_scheduled_at', '2026-10-25T10:00:00+00:00'),
    jsonb_build_object('game_id', x->>'g4', 'team_name', '', 'action', 'decline'));
  r_old := pg_temp.old_accept_interleague_invite(x->>'token', responses);
  c_anon_accept := c_anon_accept + 1;
  responses := replace(replace(replace(replace(responses::text, x->>'g1', x2->>'g1'), x->>'g2', x2->>'g2'), x->>'g3', x2->>'g3'), x->>'g4', x2->>'g4')::jsonb;
  r_new := public.accept_interleague_invite(x2->>'token', responses);
  c_anon_accept := c_anon_accept + 1;
  select coalesce(jsonb_agg(jsonb_build_object('t', g.home_team_id, 'v', g.venue_id, 'at', g.scheduled_at, 'st', g.status, 'aw', g.is_away, 'ext', g.external_team_name, 'pv', g.proposed_venue_name, 'pat', g.proposed_scheduled_at) order by g.scheduled_at), '[]'::jsonb)
    into rows_old from public.games g where g.interleague_org_id = (x->>'card')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('t', g.home_team_id, 'v', g.venue_id, 'at', g.scheduled_at, 'st', g.status, 'aw', g.is_away, 'ext', g.external_team_name, 'pv', g.proposed_venue_name, 'pat', g.proposed_scheduled_at) order by g.scheduled_at), '[]'::jsonb)
    into rows_new from public.games g where g.interleague_org_id = (x2->>'card')::uuid;
  -- twin B's venue ids differ from twin A's by construction; compare venue PRESENCE
  rows_old := (select jsonb_agg(e - 'v' - 't' || jsonb_build_object('hasv', (e->>'v') is not null)) from jsonb_array_elements(rows_old) e);
  rows_new := (select jsonb_agg(e - 'v' - 't' || jsonb_build_object('hasv', (e->>'v') is not null)) from jsonb_array_elements(rows_new) e);
  select jsonb_build_object('status', status, 'has_token', schedule_token is not null) into inv_old from public.interleague_invites where id = (x->>'inv')::uuid;
  select jsonb_build_object('status', status, 'has_token', schedule_token is not null) into inv_new from public.interleague_invites where id = (x2->>'inv')::uuid;
  select count(*) into resp_old from public.interleague_invite_responses where invite_id = (x->>'inv')::uuid;
  select count(*) into resp_new from public.interleague_invite_responses where invite_id = (x2->>'inv')::uuid;
  r_old := r_old - 'invite_id' - 'response_id' - 'schedule_token' - 'org_name';
  r_new := r_new - 'invite_id' - 'response_id' - 'schedule_token' - 'org_name';
  if rows_old <> rows_new then f := array_append(f, 'T1:rows'); end if;
  if inv_old <> inv_new or resp_old <> resp_new or resp_new <> 1 then f := array_append(f, 'T1:invite'); end if;
  if r_old <> r_new then f := array_append(f, ('T1:json ' || r_old::text || ' vs ' || r_new::text)); end if;
  if (r_new->>'accepted')::int <> 2 or (r_new->>'countered')::int <> 1 or (r_new->>'declined')::int <> 1 then f := array_append(f, 'T1:counts'); end if;

  -- ── A1/A2/A3: the signed-in accept ──
  x := pg_temp.fx('main');
  perform pg_temp.as_user((x->>'rec_org')::uuid);
  r := public.accept_interleague_invite_as_member(x->>'token', (x->>'rec_szn')::uuid, jsonb_build_array(
    jsonb_build_object('game_id', x->>'g1', 'action', 'accept', 'team_id', x->>'rec_t1'),
    jsonb_build_object('game_id', x->>'g2', 'action', 'accept', 'team_id', x->>'rec_t2', 'venue_id', x->>'r_ven'),
    jsonb_build_object('game_id', x->>'g3', 'action', 'counter', 'team_id', x->>'rec_t1', 'proposed_scheduled_at', '2026-10-25T10:00:00+00:00'),
    jsonb_build_object('game_id', x->>'g4', 'action', 'decline')));
  perform pg_temp.as_postgres();
  c_signed_in_accept := c_signed_in_accept + 1;
  if (r->>'accepted')::int <> 2 or (r->>'countered')::int <> 1 or (r->>'declined')::int <> 1 or (r->>'created')::int <> 2 then
    f := array_append(f, ('A1:result ' || r::text));
  end if;
  -- A1h host side
  select status, external_team_name, proposed_venue_name into s, t, err from public.games where id = (x->>'g1')::uuid;
  if s is distinct from 'scheduled' or t is distinct from 'Team 1' or err is not null then f := array_append(f, ('A1h:g1 ' || coalesce(s,'?') || '/' || coalesce(t,'?'))); end if;
  select status, external_team_name, proposed_venue_name into s, t, err from public.games where id = (x->>'g2')::uuid;
  if s is distinct from 'scheduled' or t is distinct from 'Team 2' or err is distinct from (x->>'r_label') then f := array_append(f, ('A1h:g2 ' || coalesce(s,'?') || '/' || coalesce(t,'?') || '/' || coalesce(err,'?'))); end if;
  -- A1i invite
  select status, schedule_token into s, t from public.interleague_invites where id = (x->>'inv')::uuid;
  select count(*) into n from public.interleague_invite_responses where invite_id = (x->>'inv')::uuid;
  if s is distinct from 'accepted' or t is null or n <> 1 then f := array_append(f, 'A1i'); end if;
  -- A1p partner card
  select id into card_id from public.interleague_orgs where owner_id = (x->>'rec_org')::uuid and name = 'SRALL' and admin_email = 'whitking10@gmail.com';
  if card_id is null or (r->>'partner_org_id')::uuid is distinct from card_id or r->>'partner_org_name' is distinct from 'SRALL' then f := array_append(f, 'A1p'); end if;
  -- A1o our rows
  select count(*) into n from public.games where league_id = (x->>'rec_szn')::uuid and interleague_org_id = card_id;
  if n <> 2 then f := array_append(f, ('A1o:count ' || n)); end if;
  select * into o1 from public.games where league_id = (x->>'rec_szn')::uuid and interleague_org_id = card_id and scheduled_at = '2026-10-10T09:00:00+00:00';
  select * into o2 from public.games where league_id = (x->>'rec_szn')::uuid and interleague_org_id = card_id and scheduled_at = '2026-10-17T11:00:00+00:00';
  if o1.id is null or o1.home_team_id <> (x->>'rec_t1')::uuid or o1.away_team_id is not null or o1.is_away <> true
     or o1.venue_id is not null or o1.external_team_name is distinct from 'Yankees' or o1.proposed_venue_name is distinct from (x->>'h_label')
     or o1.status <> 'scheduled' then
    f := array_append(f, ('A1o:travel ' || coalesce(to_jsonb(o1)::text, 'missing')));
  else c_we_travel := c_we_travel + 1; end if;
  if o2.id is null or o2.home_team_id <> (x->>'rec_t2')::uuid or o2.away_team_id is not null or o2.is_away <> false
     or o2.venue_id is distinct from (x->>'r_ven')::uuid or o2.external_team_name is distinct from 'Red Sox' or o2.proposed_venue_name is not null
     or o2.status <> 'scheduled' then
    f := array_append(f, ('A1o:host ' || coalesce(to_jsonb(o2)::text, 'missing')));
  else c_we_host := c_we_host + 1; end if;
  if o1.away_team_id is not null or o2.away_team_id is not null then f := array_append(f, 'A1o:away_team_id'); end if;
  -- A2 countered
  select status, external_team_name, proposed_scheduled_at into s, t, p from public.games where id = (x->>'g3')::uuid;
  select count(*) into n from public.games where league_id = (x->>'rec_szn')::uuid and interleague_org_id = card_id and scheduled_at in ('2026-10-24T13:00:00+00:00', '2026-10-25T10:00:00+00:00');
  if s is distinct from 'pending_interleague' or t is distinct from 'Team 1' or p is distinct from '2026-10-25T10:00:00+00:00'::timestamptz or n <> 0 then
    f := array_append(f, ('A2 ' || coalesce(s,'?') || '/' || n));
  end if;
  -- A3 declined
  select count(*) into n from public.games where id = (x->>'g4')::uuid;
  if n <> 0 then f := array_append(f, 'A3'); end if;

  -- ── A4: own invite (a member of the sending org) ──
  x := pg_temp.fx('own');
  select count(*) into g0 from public.games where league_id = (x->>'host_szn')::uuid;
  select count(*) into o0 from public.interleague_orgs where owner_id = (x->>'host_org')::uuid;
  perform pg_temp.as_user((x->>'host_org')::uuid);
  begin
    r := public.accept_interleague_invite_as_member(x->>'token', (x->>'host_szn')::uuid, jsonb_build_array(
      jsonb_build_object('game_id', x->>'g1', 'action', 'accept', 'team_id', x->>'yankees')));
    err := 'no error';
  exception when others then err := sqlerrm; end;
  perform pg_temp.as_postgres();
  select status into s from public.interleague_invites where id = (x->>'inv')::uuid;
  select count(*) into g1 from public.games where league_id = (x->>'host_szn')::uuid;
  select count(*) into o1n from public.interleague_orgs where owner_id = (x->>'host_org')::uuid;
  if err <> 'own_invite' or s <> 'pending' or g1 <> g0 or o1n <> o0 then f := array_append(f, ('A4 ' || err || '/' || s || '/' || (g1 - g0) || '/' || (o1n - o0))); else c_refused := c_refused + 1; end if;

  -- ── A5: privileges ──
  if has_function_privilege('anon', 'public.accept_interleague_invite_as_member(text, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('dashboard_readonly', 'public.accept_interleague_invite_as_member(text, uuid, jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.accept_interleague_invite_as_member(text, uuid, jsonb)', 'EXECUTE') then
    f := array_append(f, 'A5:grants');
  end if;
  x := pg_temp.fx('anon');
  execute 'set local role anon';
  begin
    r := public.accept_interleague_invite_as_member(x->>'token', (x->>'rec_szn')::uuid, '[]'::jsonb);
    state := 'none';
  exception when others then state := sqlstate; end;
  perform pg_temp.as_postgres();
  if state <> '42501' then f := array_append(f, ('A5:anon-call ' || state)); else c_refused := c_refused + 1; end if;

  -- ── A6: a team from another league ──
  x := pg_temp.fx('team');
  select count(*) into g0 from public.games where league_id = (x->>'rec_szn')::uuid;
  select count(*) into o0 from public.interleague_orgs where owner_id = (x->>'rec_org')::uuid;
  perform pg_temp.as_user((x->>'rec_org')::uuid);
  begin
    r := public.accept_interleague_invite_as_member(x->>'token', (x->>'rec_szn')::uuid, jsonb_build_array(
      jsonb_build_object('game_id', x->>'g1', 'action', 'accept', 'team_id', x->>'yankees')));
    err := 'no error';
  exception when others then err := sqlerrm; end;
  perform pg_temp.as_postgres();
  select status into s from public.interleague_invites where id = (x->>'inv')::uuid;
  select count(*) into g1 from public.games where league_id = (x->>'rec_szn')::uuid;
  select count(*) into o1n from public.interleague_orgs where owner_id = (x->>'rec_org')::uuid;
  if err <> 'team_not_found' or s <> 'pending' or g1 <> g0 or o1n <> o0 then f := array_append(f, ('A6 ' || err || '/' || s || '/' || (g1 - g0) || '/' || (o1n - o0))); else c_refused := c_refused + 1; end if;

  -- ── A7: we host, no venue ──
  x := pg_temp.fx('venue');
  select count(*) into g0 from public.games where league_id = (x->>'rec_szn')::uuid;
  perform pg_temp.as_user((x->>'rec_org')::uuid);
  begin
    r := public.accept_interleague_invite_as_member(x->>'token', (x->>'rec_szn')::uuid, jsonb_build_array(
      jsonb_build_object('game_id', x->>'g2', 'action', 'accept', 'team_id', x->>'rec_t2')));
    err := 'no error';
  exception when others then err := sqlerrm; end;
  perform pg_temp.as_postgres();
  select status into s from public.interleague_invites where id = (x->>'inv')::uuid;
  select count(*) into g1 from public.games where league_id = (x->>'rec_szn')::uuid;
  if err <> 'venue_required' or s <> 'pending' or g1 <> g0 then f := array_append(f, ('A7 ' || err || '/' || s || '/' || (g1 - g0))); else c_refused := c_refused + 1; end if;

  -- ── A8: ATOMICITY under a locked division ──
  x := pg_temp.fx('lock');
  select count(*) into g0 from public.games where league_id = (x->>'rec_szn')::uuid;
  select count(*) into o0 from public.interleague_orgs where owner_id = (x->>'rec_org')::uuid;
  update public.divisions set locked = true where id = (x->>'rec_div')::uuid;
  perform pg_temp.as_user((x->>'rec_org')::uuid);
  begin
    r := public.accept_interleague_invite_as_member(x->>'token', (x->>'rec_szn')::uuid, jsonb_build_array(
      jsonb_build_object('game_id', x->>'g1', 'action', 'accept', 'team_id', x->>'rec_t1')));
    err := 'no error';
  exception when others then err := sqlerrm; end;
  perform pg_temp.as_postgres();
  select status into s from public.interleague_invites where id = (x->>'inv')::uuid;
  select status into t from public.games where id = (x->>'g1')::uuid;
  select count(*) into g1 from public.games where league_id = (x->>'rec_szn')::uuid;
  select count(*) into o1n from public.interleague_orgs where owner_id = (x->>'rec_org')::uuid;
  if position('division_locked' in err) = 0 or s <> 'pending' or t <> 'pending_interleague' or g1 <> g0 or o1n <> o0 then
    f := array_append(f, ('A8 ' || err || '/' || s || '/' || coalesce(t,'?') || '/' || (g1 - g0) || '/' || (o1n - o0)));
  else c_refused := c_refused + 1; end if;
  update public.divisions set locked = false where id = (x->>'rec_div')::uuid;

  -- ── A10: an existing card is reused ──
  x := pg_temp.fx('reuse');
  insert into public.interleague_orgs (owner_id, name, admin_email) values ((x->>'rec_org')::uuid, 'srall', 'old@example.test') returning id into pre_card;
  select count(*) into o0 from public.interleague_orgs where owner_id = (x->>'rec_org')::uuid;
  perform pg_temp.as_user((x->>'rec_org')::uuid);
  r := public.accept_interleague_invite_as_member(x->>'token', (x->>'rec_szn')::uuid, jsonb_build_array(
    jsonb_build_object('game_id', x->>'g1', 'action', 'accept', 'team_id', x->>'rec_t1')));
  perform pg_temp.as_postgres();
  c_signed_in_accept := c_signed_in_accept + 1;
  -- The 'main' case above already created a 'SRALL' card in this pass, so the
  -- proof here is: NO new card, and the id returned is one that already existed.
  select count(*) into o1n from public.interleague_orgs where owner_id = (x->>'rec_org')::uuid;
  if o1n <> o0 or not exists (select 1 from public.interleague_orgs where id = (r->>'partner_org_id')::uuid and owner_id = (x->>'rec_org')::uuid and lower(name) = 'srall') then
    f := array_append(f, ('A10 ' || (o1n - o0)));
  end if;

  -- ── anti-vacuity ──
  if c_signed_in_accept = 0 then f := array_append(f, 'VAC:c_signed_in_accept'); end if;
  if c_anon_accept = 0 then f := array_append(f, 'VAC:c_anon_accept'); end if;
  if c_we_host = 0 then f := array_append(f, 'VAC:c_we_host'); end if;
  if c_we_travel = 0 then f := array_append(f, 'VAC:c_we_travel'); end if;
  if c_refused = 0 then f := array_append(f, 'VAC:c_refused'); end if;

  raise exception 'PASS_END' using detail = array_to_string(f, ' | ')
    || ' ## counters signed_in=' || c_signed_in_accept || ' anon=' || c_anon_accept || ' we_host=' || c_we_host || ' we_travel=' || c_we_travel || ' refused=' || c_refused;
end $$;

-- ── HARNESS ──────────────────────────────────────────────────────────────────
do $harness$
declare
  out text := '';
  pass int;
  det text;
  orig_def text;
  mut_def text;
  m_from text[] := array[
    -- SM1 host half skipped
    $m$v_result := public.accept_interleague_invite(p_token, v_responses);$m$,
    -- SM2 away_team_id → the host's team
    $m$      null,
      v_partner_id,$m$,
    -- SM3 own-invite guard removed
    $m$if exists (select 1 from public.leagues where id = v_season_id) then$m$,
    -- SM4 a countered game falls through into accept planning
    $m$      v_planned_cnt := v_planned_cnt + 1;
      continue;$m$,
    -- SM5 is_away not inverted
    $m$'is_away',             not (v_host->>'is_away')::boolean,$m$,
    -- SM6 our insert swallows errors
    $m$    returning id into v_new_id;
    v_created_ids := v_created_ids || v_new_id;
  end loop;$m$,
    -- SM7 (grant, applied separately)
    $m$SM7$m$,
    -- SM8 venue_required removed
    $m$      if v_venue_id is null then
        raise exception 'venue_required' using errcode = 'P0001';
      end if;$m$
  ];
  m_to text[] := array[
    $m$v_result := jsonb_build_object('accepted', v_planned_acc, 'countered', v_planned_cnt, 'declined', v_planned_dec, 'total', v_planned_acc + v_planned_cnt + v_planned_dec, 'sender_org_name', 'SRALL', 'sender_name', 'Whit Mellon-King', 'sender_email', 'whitking10@gmail.com', 'schedule_token', 'x', 'recipient_email', 'x');$m$,
    $m$      'b5d39661-86b5-41a1-ba9b-f74f8615e2a6'::uuid,
      v_partner_id,$m$,
    $m$if false then$m$,
    $m$      v_planned_cnt := v_planned_cnt + 1;$m$,
    $m$'is_away',             (v_host->>'is_away')::boolean,$m$,
    $m$    returning id into v_new_id;
    v_created_ids := v_created_ids || v_new_id;
    exception when others then null;
    end;
  end loop;$m$,
    $m$SM7$m$,
    $m$      $m$
  ];
  m_target text[] := array['A1h', 'A1o', 'A4', 'A2', 'A1o', 'A8', 'A5', 'A7'];
  m_killed boolean;
begin
  orig_def := pg_get_functiondef('public.accept_interleague_invite_as_member(text, uuid, jsonb)'::regprocedure);

  for pass in 0..8 loop
    begin
      if pass > 0 then
        if pass = 7 then
          execute 'grant execute on function public.accept_interleague_invite_as_member(text, uuid, jsonb) to anon';
        else
          if position(m_from[pass] in orig_def) = 0 then
            raise exception 'PASS_END' using detail = 'MUTANT_NOOP';
          end if;
          -- SM6 wraps the insert: needs a matching `begin` before the insert
          mut_def := replace(orig_def, m_from[pass], m_to[pass]);
          if pass = 6 then
            mut_def := replace(mut_def, $x$    insert into public.games ($x$, $x$    begin
    insert into public.games ($x$);
          end if;
          execute mut_def;
        end if;
      end if;
      perform pg_temp.baseline();
    exception when others then
      get stacked diagnostics det = pg_exception_detail;
      if sqlerrm = 'PASS_END' then
        if pass = 0 then
          out := out || E'\nPASS 0 baseline: ' || case when det like ' ## %' then 'ALL GREEN' || det else 'FAILURES ' || det end;
        else
          m_killed := position(m_target[pass] in split_part(det, ' ## ', 1)) > 0;
          out := out || E'\nSM' || pass || ' (target ' || m_target[pass] || '): ' || case when det = 'MUTANT_NOOP' then 'MUTANT_NOOP' when m_killed then 'KILLED at ' || split_part(det, ' ## ', 1) else 'SURVIVED (' || split_part(det, ' ## ', 1) || ')' end;
        end if;
      else
        out := out || E'\nPASS ' || pass || ' CRASH: ' || sqlerrm;
      end if;
    end;
  end loop;

  raise exception 'HARNESS-0097 RESULTS (everything rolled back):%', out;
end
$harness$;
