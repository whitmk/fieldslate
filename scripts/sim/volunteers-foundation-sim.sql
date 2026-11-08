-- Proof for 0120 (volunteer sign-ups foundation: the feature switch, the
-- settings row and its three functions, the outbox and its drain functions,
-- the rate-event prune, and the archive wipe).
-- Assembled by volunteers-foundation-build.ts, which puts the LITERAL
-- migration text where the placeholder is — so this proves the file that
-- will be applied. It runs BEFORE 0120 is applied: the whole batch is one
-- transaction that the final RAISE always rolls back. Fixtures live in the
-- "test" proof org (bbf9afe1…, Elite) and, as the OTHER league, "Test 2"
-- (27c15406…) — never Santa Rosa American's data.
--
-- NOT RUN YET. Running it against production needs Whit's go and timing.
--
-- LOCKS for the run (a few seconds; lock_timeout 3s): the migration's
-- CREATE TRIGGER on `leagues` and its FKs take SHARE ROW EXCLUSIVE on
-- `leagues` and `profiles` (writes to both wait, reads don't), held to the end
-- of the batch; each mutant drops and re-creates the 0120 objects inside its
-- own rolled-back sub-transaction (the DROP TRIGGER takes ACCESS EXCLUSIVE on
-- `leagues` for that sub-run — season READS wait too, for a fraction of a
-- second each); row locks on the fixture rows, the test org's profile row
-- (plan flipped to pro and back) and the two seasons archived/un-archived. The
-- batch prints the locks it holds on leagues and profiles (L1) so the apply's
-- locks are known, not guessed.
--
-- Fixture: seasons S and S2 in the test org, S3 in Test 2. Volunteers vA
-- (outbox rows in S only), vB (S and S2), vC (Test 2). Test 2 gets a settings
-- row WITH a contact email but no feature row, so only the switch can stop
-- its email.
--
-- Assertions (each case returns the FIRST failing tag, or 'pass'):
--   M0  right after the migration: org_features empty, no settings rows
--   F1  switch off: set_volunteer_link(true) → feature_off; admin_state is
--       exactly {"feature": false}
--   R1  a non-member → not_authorized (set_volunteer_contact_email)
--   E1  Pro, contact set: set_volunteer_link(true) → plan_required
--   E2  Pro: set_volunteer_contact_email → plan_required
--   C1  bad emails → invalid_email ('a@b', a CR/LF header, two addresses,
--       angle brackets)
--   C2  a blank contact is stored NULL (never the owner's email) and the
--       link then refuses to turn on → contact_required
--   C3  ' Board@Example.org ' is stored trimmed
--   C4  link on → enabled, 64-hex token; clearing the contact now →
--       contact_required
--   C5  off keeps the token; on again → same token; reset → a new token,
--       still on
--   A2  admin_state with the switch on carries elite + the settings
--   G1  as authenticated: no direct write on volunteer_settings; own row
--       readable, a non-member reads 0 rows; org_features, volunteers,
--       outbox, rate events all refused (42501); service_role reads no table
--   G2  EXECUTE per role (admin functions authenticated only; take/finish
--       service_role only; org_feature_on and the trigger function none)
--   G3  table privileges: nothing beyond SELECT on volunteer_settings for
--       authenticated, for any of the five tables and four roles
--   O7  a payload carrying an 'email' (or 'last_name') key is refused
--   OS  take: the older of two game_moved rows with one coalesce key →
--       superseded
--   OF  take: Test 2's row (switch off) → failed 'feature_off'
--   O1  take returns exactly the signup row and the NEWER game_moved row,
--       each with to = email_lc, reply_to = the contact, league_name
--   O2  a second take returns nothing (rows are 'sending')
--   O3  finish ok → sent, resend_id kept
--   O4  a second finish of the same row → updated false, nothing changed
--   O5  finish failed + retry → pending, due later, not taken now
--   O6  a row 'sending' for 11 minutes is put back and taken again
--   O8  take prunes rate events older than 23 hours, keeps a 22-hour one
--   W1  archiving S AS AN AUTHENTICATED MEMBER succeeds; S's outbox rows are
--       gone, vA is gone, vB and its S2 row stay, vC (Test 2) untouched
--   W2  un-archiving S does not wipe (a row added while archived survives)
--   W3  a rename of S2 (archived_at untouched) does not wipe
-- Mutants (each must die at its own tag):
--   MU1  wipe skipped                                   → W1
--   MU2  wipe fires on un-archive                       → W2
--   MU3  wipe trigger SECURITY INVOKER                  → W1
--   MU4  outbox SELECT granted to authenticated         → G1 (the read
--        returns rows-or-none instead of 42501; G1 runs before G3)
--   MU5  blank contact defaults to the owner's email    → C2
--   MU6  membership gate removed (contact email)        → R1
--   MU7  switch gate removed (link)                     → F1
--   MU8  Elite gate removed (link on)                   → E1
--   MU9  take doesn't mark rows 'sending'               → O2
--   MU10 coalescing removed                             → OS
--   MU11 take's switch check removed                    → OF
--   MU12 finish not limited to 'sending' rows           → O4
--   MU13 rate-event prune removed                       → O8
--   MU14 payload name/email guard removed               → O7
--   MU15 stale-'sending' requeue removed                → O6
--   MU16 take EXECUTE granted to authenticated          → G2
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h120_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;

-- Drops everything 0120 creates, so a mutated copy can be applied from the
-- real starting point. Only ever called inside a rolled-back sub-transaction.
create or replace function pg_temp.h120_drop() returns void language plpgsql as $f$
begin
  drop trigger if exists wipe_volunteer_data_on_archive on public.leagues;
  drop function if exists public.wipe_volunteer_data_on_archive();
  drop function if exists public.volunteer_outbox_take(integer);
  drop function if exists public.volunteer_outbox_finish(bigint, boolean, text, text, boolean);
  drop function if exists public.volunteer_admin_state(uuid);
  drop function if exists public.set_volunteer_contact_email(uuid, text);
  drop function if exists public.set_volunteer_link(uuid, boolean);
  drop function if exists public.reset_volunteer_link(uuid);
  drop table if exists public.volunteer_outbox;
  drop table if exists public.volunteer_rate_events;
  drop table if exists public.volunteers;
  drop table if exists public.volunteer_settings;
  drop function if exists public.org_feature_on(uuid, text);
  drop table if exists public.org_features;
end;
$f$;

create or replace function pg_temp.h120_case() returns text language plpgsql as $f$
declare
  v_org  uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_org2 uuid := '27c15406-fdda-43ce-bc31-1a071fe254e4';
  v_plan text := (select plan from public.profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6');
  v_s  uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid(); v_s3 uuid := gen_random_uuid();
  v_va uuid := gen_random_uuid(); v_vb uuid := gen_random_uuid(); v_vc uuid := gen_random_uuid();
  o_sign bigint; o_mv1 bigint; o_mv2 bigint; o_b1 bigint; o_b2 bigint; o_c bigint; o_x bigint;
  v_tok1 text; v_tok2 text;
  v_r text; j jsonb;
  e text;
begin
  -- M0 — the migration turned nothing on.
  if exists (select 1 from public.org_features) or exists (select 1 from public.volunteer_settings) then
    return 'M0 rows exist right after the migration';
  end if;

  update public.profiles set plan = 'elite' where id = v_org;

  -- F1 — switch off (no feature row yet).
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.set_volunteer_link(%L, true)::text', v_org));
  if v_r not like '%feature_off%' then return 'F1 link on with the switch off: ' || v_r; end if;
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.volunteer_admin_state(%L)::text', v_org));
  if v_r is distinct from '{"feature": false}' then return 'F1 admin_state: ' || coalesce(v_r, 'null'); end if;

  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'volunteers', true);

  -- R1 — a non-member.
  v_r := pg_temp.h120_as(gen_random_uuid(), 'authenticated',
    format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, 'x@example.org'));
  if v_r not like '%not_authorized%' then return 'R1 non-member: ' || v_r; end if;

  -- E2 / E1 — Elite only.
  update public.profiles set plan = 'pro' where id = v_org;
  v_r := pg_temp.h120_as(v_org, 'authenticated',
    format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, 'board@example.org'));
  if v_r not like '%plan_required%' then return 'E2 contact on Pro: ' || v_r; end if;
  update public.profiles set plan = 'elite' where id = v_org;
  v_r := pg_temp.h120_as(v_org, 'authenticated',
    format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, 'board@example.org'));
  if v_r like 'ERR%' then return 'E1 setup: ' || v_r; end if;
  update public.profiles set plan = 'pro' where id = v_org;
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.set_volunteer_link(%L, true)::text', v_org));
  if v_r not like '%plan_required%' then return 'E1 link on, Pro: ' || v_r; end if;
  update public.profiles set plan = 'elite' where id = v_org;

  -- C1 — shapes.
  foreach e in array array['a@b', E'x@example.org\r\nBcc: y@example.org', 'x@example.org,y@example.org',
                           '<x@example.org>', 'x y@example.org', '"x"@example.org'] loop
    v_r := pg_temp.h120_as(v_org, 'authenticated',
      format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, e));
    if v_r not like '%invalid_email%' then return 'C1 accepted ' || e || ': ' || v_r; end if;
  end loop;

  -- C2 — blank is NULL, never the owner's email; link then refuses.
  v_r := pg_temp.h120_as(v_org, 'authenticated',
    format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, '   '));
  if v_r like 'ERR%' then return 'C2 clear refused: ' || v_r; end if;
  if (select contact_email from public.volunteer_settings where owner_id = v_org) is not null then
    return 'C2 blank stored as ' || (select contact_email from public.volunteer_settings where owner_id = v_org);
  end if;
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.set_volunteer_link(%L, true)::text', v_org));
  if v_r not like '%contact_required%' then return 'C2 link on without contact: ' || v_r; end if;

  -- C3 — trimmed.
  v_r := pg_temp.h120_as(v_org, 'authenticated',
    format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, ' Board@Example.org '));
  if (select contact_email from public.volunteer_settings where owner_id = v_org) is distinct from 'Board@Example.org' then
    return 'C3 stored: ' || coalesce((select contact_email from public.volunteer_settings where owner_id = v_org), 'null') || ' / ' || v_r;
  end if;

  -- C4 — on, then clearing is refused.
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.set_volunteer_link(%L, true)::text', v_org));
  if v_r like 'ERR%' then return 'C4 link on refused: ' || v_r; end if;
  j := v_r::jsonb; v_tok1 := j ->> 'link_token';
  if (j ->> 'link_enabled') is distinct from 'true' or v_tok1 !~ '^[0-9a-f]{64}$' then return 'C4 reply: ' || v_r; end if;
  v_r := pg_temp.h120_as(v_org, 'authenticated',
    format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, ''));
  if v_r not like '%contact_required%' then return 'C4 cleared while on: ' || v_r; end if;

  -- C5 — off keeps the token; reset replaces it.
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.set_volunteer_link(%L, false)::text', v_org));
  if (v_r::jsonb ->> 'link_token') is distinct from v_tok1
     or (select link_enabled from public.volunteer_settings where owner_id = v_org) then
    return 'C5 off: ' || v_r;
  end if;
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.set_volunteer_link(%L, true)::text', v_org));
  if (v_r::jsonb ->> 'link_token') is distinct from v_tok1 then return 'C5 on again: ' || v_r; end if;
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.reset_volunteer_link(%L)::text', v_org));
  v_tok2 := v_r::jsonb ->> 'link_token';
  if v_tok2 is null or v_tok2 = v_tok1 or (v_r::jsonb ->> 'link_enabled') is distinct from 'true'
     or (select link_token from public.volunteer_settings where owner_id = v_org) is distinct from v_tok2 then
    return 'C5 reset: ' || v_r;
  end if;

  -- A2 — admin_state with the switch on.
  v_r := pg_temp.h120_as(v_org, 'authenticated', format('select public.volunteer_admin_state(%L)::text', v_org));
  j := v_r::jsonb;
  if (j ->> 'feature') is distinct from 'true' or (j ->> 'elite') is distinct from 'true'
     or (j #>> '{settings,link_token}') is distinct from v_tok2
     or (j #>> '{settings,contact_email}') is distinct from 'Board@Example.org' then
    return 'A2 admin_state: ' || v_r;
  end if;

  -- G1 — table access as each role.
  v_r := pg_temp.h120_as(v_org, 'authenticated', format(
    'with u as (update public.volunteer_settings set contact_email = %L where owner_id = %L returning 1) select count(*)::text from u',
    'evil@example.org', v_org));
  if v_r not like 'ERR 42501%' then return 'G1 direct settings update: ' || coalesce(v_r, 'null'); end if;
  v_r := pg_temp.h120_as(v_org, 'authenticated', format(
    'select count(*)::text from public.volunteer_settings where owner_id = %L', v_org));
  if v_r is distinct from '1' then return 'G1 own settings read: ' || coalesce(v_r, 'null'); end if;
  v_r := pg_temp.h120_as(gen_random_uuid(), 'authenticated', format(
    'select count(*)::text from public.volunteer_settings where owner_id = %L', v_org));
  if v_r is distinct from '0' then return 'G1 non-member read: ' || coalesce(v_r, 'null'); end if;
  foreach e in array array['org_features', 'volunteers', 'volunteer_outbox', 'volunteer_rate_events'] loop
    v_r := pg_temp.h120_as(v_org, 'authenticated', format('select count(*)::text from public.%I', e));
    if v_r not like 'ERR 42501%' then return 'G1 authenticated read ' || e || ': ' || coalesce(v_r, 'null'); end if;
  end loop;
  foreach e in array array['org_features', 'volunteer_settings', 'volunteers', 'volunteer_outbox', 'volunteer_rate_events'] loop
    v_r := pg_temp.h120_as(v_org, 'service_role', format('select count(*)::text from public.%I', e));
    if v_r not like 'ERR 42501%' then return 'G1 service_role read ' || e || ': ' || coalesce(v_r, 'null'); end if;
  end loop;

  -- G2 — function privileges.
  if not (has_function_privilege('authenticated', 'public.volunteer_admin_state(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.set_volunteer_contact_email(uuid, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.set_volunteer_link(uuid, boolean)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.reset_volunteer_link(uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.volunteer_outbox_take(integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.volunteer_outbox_finish(bigint, boolean, text, text, boolean)', 'EXECUTE')) then
    return 'G2 a needed grant is missing';
  end if;
  if exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) r,
           unnest(array['public.org_feature_on(uuid, text)', 'public.wipe_volunteer_data_on_archive()',
                        'public.volunteer_outbox_take(integer)',
                        'public.volunteer_outbox_finish(bigint, boolean, text, text, boolean)',
                        'public.volunteer_admin_state(uuid)', 'public.set_volunteer_contact_email(uuid, text)',
                        'public.set_volunteer_link(uuid, boolean)', 'public.reset_volunteer_link(uuid)']) f
     where has_function_privilege(r, f, 'EXECUTE')
       and not (r = 'authenticated' and f in ('public.volunteer_admin_state(uuid)', 'public.set_volunteer_contact_email(uuid, text)',
                                              'public.set_volunteer_link(uuid, boolean)', 'public.reset_volunteer_link(uuid)'))
       and not (r = 'service_role' and f in ('public.volunteer_outbox_take(integer)',
                                             'public.volunteer_outbox_finish(bigint, boolean, text, text, boolean)'))) then
    return 'G2 an extra grant: ' || (
      select string_agg(r || ' ' || f, '; ')
        from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) r,
             unnest(array['public.volunteer_outbox_take(integer)', 'public.org_feature_on(uuid, text)']) f
       where has_function_privilege(r, f, 'EXECUTE'));
  end if;

  -- G3 — table privileges.
  if exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role', 'dashboard_readonly']) r,
           unnest(array['org_features', 'volunteer_settings', 'volunteers', 'volunteer_outbox', 'volunteer_rate_events']) t,
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
     where has_table_privilege(r, 'public.' || t, p)
       and not (t = 'volunteer_settings' and r = 'authenticated' and p = 'SELECT')) then
    return 'G3 an extra table privilege';
  end if;

  -- ── outbox fixtures (as postgres) ────────────────────────────────────────
  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (v_s,  'ZZ120 S',  'Baseball', 'Fall 2026', v_org,  '2026-09-01', '2026-12-31'),
    (v_s2, 'ZZ120 S2', 'Baseball', 'Fall 2026', v_org,  '2026-09-01', '2026-12-31'),
    (v_s3, 'ZZ120 S3', 'Baseball', 'Fall 2026', v_org2, '2026-09-01', '2026-12-31');
  insert into public.volunteers (id, owner_id, email_lc, first_initial, last_name, adult_confirmed_at) values
    (v_va, v_org,  'zz120-a@example.org', 'A', 'Alpha', now()),
    (v_vb, v_org,  'zz120-b@example.org', 'B', 'Bravo', now()),
    (v_vc, v_org2, 'zz120-c@example.org', 'C', 'Charlie', now());
  insert into public.volunteer_settings (owner_id, contact_email) values (v_org2, 'other@example.org');

  -- O7 — no name or address in a payload.
  begin
    insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
    values (v_org, v_s, v_va, 'signup_confirmed', '{"email": "zz120-a@example.org"}');
    return 'O7 payload with an email key accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
    values (v_org, v_s, v_va, 'signup_confirmed', '{"last_name": "Alpha"}');
    return 'O7 payload with a last_name key accepted';
  exception when check_violation then null;
  end;

  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
    values (v_org, v_s, v_va, 'signup_confirmed', '{"claim_id": "c1"}') returning id into o_sign;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, coalesce_key)
    values (v_org, v_s, v_vb, 'game_moved', '{"claim_id": "c2", "at": "10:00"}', 'claim:c2') returning id into o_mv1;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, coalesce_key)
    values (v_org, v_s, v_vb, 'game_moved', '{"claim_id": "c2", "at": "11:00"}', 'claim:c2') returning id into o_mv2;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
    values (v_org2, v_s3, v_vc, 'signup_confirmed', '{}') returning id into o_c;
  insert into public.volunteer_rate_events (kind, key_hash, at) values
    ('claim_ip', repeat('a', 64), now() - interval '23 hours 1 minute'),
    ('claim_ip', repeat('b', 64), now() - interval '22 hours');

  -- ── take #1 ─────────────────────────────────────────────────────────────
  v_r := pg_temp.h120_as(v_org, 'service_role', 'select public.volunteer_outbox_take(10)::text');
  if v_r like 'ERR%' then return 'O1 take refused: ' || v_r; end if;
  j := v_r::jsonb;
  if (select status from public.volunteer_outbox where id = o_mv1) is distinct from 'superseded' then
    return 'OS older game_moved: ' || (select status from public.volunteer_outbox where id = o_mv1);
  end if;
  if (select status || '/' || coalesce(error, '') from public.volunteer_outbox where id = o_c) is distinct from 'failed/feature_off' then
    return 'OF Test 2 row: ' || (select status || '/' || coalesce(error, '') from public.volunteer_outbox where id = o_c);
  end if;
  if jsonb_array_length(j) <> 2
     or (j -> 0 ->> 'id')::bigint <> o_sign or (j -> 1 ->> 'id')::bigint <> o_mv2
     or (j -> 0 ->> 'to') is distinct from 'zz120-a@example.org'
     or (j -> 1 ->> 'to') is distinct from 'zz120-b@example.org'
     or (j -> 0 ->> 'reply_to') is distinct from 'Board@Example.org'
     or (j -> 0 ->> 'league_name') is distinct from (select org_name from public.profiles where id = v_org)
     or (j -> 1 #>> '{payload,at}') is distinct from '11:00' then
    return 'O1 take returned: ' || left(v_r, 300);
  end if;
  if (select count(*) from public.volunteer_rate_events where key_hash in (repeat('a', 64), repeat('b', 64))) <> 1
     or not exists (select 1 from public.volunteer_rate_events where key_hash = repeat('b', 64)) then
    return 'O8 prune: ' || (select count(*) from public.volunteer_rate_events where key_hash in (repeat('a', 64), repeat('b', 64)))::text;
  end if;

  -- O2 — nothing twice.
  v_r := pg_temp.h120_as(v_org, 'service_role', 'select public.volunteer_outbox_take(10)::text');
  if v_r is distinct from '[]' then return 'O2 second take: ' || left(coalesce(v_r, 'null'), 300); end if;

  -- O3 / O4 — finish once.
  v_r := pg_temp.h120_as(v_org, 'service_role',
    format('select public.volunteer_outbox_finish(%s, true, %L, null, false)::text', o_sign, 're_123'));
  if (select status || '/' || coalesce(resend_id, '') from public.volunteer_outbox where id = o_sign) is distinct from 'sent/re_123' then
    return 'O3 finish ok: ' || coalesce(v_r, 'null');
  end if;
  v_r := pg_temp.h120_as(v_org, 'service_role',
    format('select public.volunteer_outbox_finish(%s, false, null, %L, false)::text', o_sign, 'late'));
  if (v_r::jsonb ->> 'updated') is distinct from 'false'
     or (select status from public.volunteer_outbox where id = o_sign) is distinct from 'sent' then
    return 'O4 second finish: ' || coalesce(v_r, 'null');
  end if;

  -- O5 — retry later.
  v_r := pg_temp.h120_as(v_org, 'service_role',
    format('select public.volunteer_outbox_finish(%s, false, null, %L, true)::text', o_mv2, 'timeout'));
  if (select status from public.volunteer_outbox where id = o_mv2) is distinct from 'pending'
     or (select next_attempt_at from public.volunteer_outbox where id = o_mv2) <= now() then
    return 'O5 retry: ' || coalesce(v_r, 'null');
  end if;
  v_r := pg_temp.h120_as(v_org, 'service_role', 'select public.volunteer_outbox_take(10)::text');
  if v_r is distinct from '[]' then return 'O5 retried row taken early: ' || left(coalesce(v_r, 'null'), 300); end if;

  -- O6 — a stuck 'sending' row comes back.
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status, locked_at, attempts)
    values (v_org, v_s2, v_vb, 'reminder', '{}', 'sending', now() - interval '11 minutes', 1) returning id into o_b2;
  v_r := pg_temp.h120_as(v_org, 'service_role', 'select public.volunteer_outbox_take(10)::text');
  if v_r like 'ERR%' or jsonb_array_length(v_r::jsonb) <> 1 or ((v_r::jsonb) -> 0 ->> 'id')::bigint <> o_b2 then
    return 'O6 stuck row: ' || left(coalesce(v_r, 'null'), 300);
  end if;

  -- ── the archive wipe ────────────────────────────────────────────────────
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status)
    values (v_org, v_s, v_vb, 'reminder', '{}', 'sent') returning id into o_b1;
  v_r := pg_temp.h120_as(v_org, 'authenticated', format(
    'with u as (update public.leagues set archived_at = now() where id = %L returning 1) select count(*)::text from u', v_s));
  if v_r is distinct from '1' then return 'W1 archive as a member refused: ' || coalesce(v_r, 'null'); end if;
  if exists (select 1 from public.volunteer_outbox where season_id = v_s) then
    return 'W1 S rows left: ' || (select count(*) from public.volunteer_outbox where season_id = v_s)::text;
  end if;
  if exists (select 1 from public.volunteers where id = v_va) then return 'W1 vA kept'; end if;
  if not exists (select 1 from public.volunteers where id = v_vb)
     or not exists (select 1 from public.volunteer_outbox where id = o_b2)
     or not exists (select 1 from public.volunteers where id = v_vc)
     or not exists (select 1 from public.volunteer_outbox where id = o_c) then
    return 'W1 wiped too much';
  end if;

  -- W2 — un-archiving restores nothing and wipes nothing.
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status)
    values (v_org, v_s, v_vb, 'reminder', '{}', 'sent') returning id into o_x;
  update public.leagues set archived_at = null where id = v_s;
  if not exists (select 1 from public.volunteer_outbox where id = o_x) then return 'W2 un-archive wiped'; end if;

  -- W3 — a rename leaves everything.
  update public.leagues set name = 'ZZ120 S2 renamed' where id = v_s2;
  if not exists (select 1 from public.volunteer_outbox where id = o_b2) then return 'W3 rename wiped'; end if;

  update public.profiles set plan = v_plan where id = v_org;
  return 'pass';
end;
$f$;

do $h$
declare
  v_mig text := $mig120$
-- @@MIGRATION_0120@@
$mig120$;
  v_out text := '';
  v_body text;
  v_res text;
  v_mut text;
  m record;
begin
  execute v_mig;
  if strpos(v_mig, '-- Verify, or the whole migration rolls back.') = 0 then
    raise exception 'harness: verify marker not found in 0120';
  end if;
  v_body := left(v_mig, strpos(v_mig, '-- Verify, or the whole migration rolls back.') - 1);

  v_out := v_out || 'md5 ' || (
    select string_agg(proname || '=' || md5(prosrc), ' ' order by proname) from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('org_feature_on', 'volunteer_admin_state', 'set_volunteer_contact_email', 'set_volunteer_link',
                       'reset_volunteer_link', 'volunteer_outbox_take', 'volunteer_outbox_finish',
                       'wipe_volunteer_data_on_archive')) || E'\n';
  v_out := v_out || 'L1 locks: ' || coalesce((
    select string_agg(c.relname || ' ' || l.mode, ', ' order by c.relname, l.mode)
      from pg_locks l join pg_class c on c.oid = l.relation
     where l.pid = pg_backend_pid() and c.relname in ('leagues', 'profiles')), 'none') || E'\n';
  v_out := v_out || 'K1 feature rows ' || (select count(*) from public.org_features)::text
                 || ', real league row ' || (select count(*) from public.org_features
                                              where owner_id::text like '8fde72f9%')::text || E'\n';

  begin
    v_res := pg_temp.h120_case();
    raise exception 'H120CASE:%', v_res;
  exception when others then
    v_out := v_out || 'BASELINE ' || replace(sqlerrm, 'H120CASE:', '') || E'\n';
  end;

  for m in select * from (values
    ('MU1', 'W1', $r1$  delete from public.volunteer_outbox where season_id = new.id;$r1$, $r1b$  perform 1;$r1b$),
    ('MU2', 'W2', $r2$  when (old.archived_at is null and new.archived_at is not null)$r2$,
                  $r2b$  when (old.archived_at is distinct from new.archived_at)$r2b$),
    ('MU3', 'W1', $r3$returns trigger
language plpgsql
security definer$r3$, $r3b$returns trigger
language plpgsql
security invoker$r3b$),
    ('MU4', 'G1', $r4$grant select on table public.volunteer_settings to authenticated;$r4$,
                  $r4b$grant select on table public.volunteer_settings to authenticated;
grant select on table public.volunteer_outbox to authenticated;$r4b$),
    ('MU5', 'C2', $r5$  v_email   text := nullif(btrim(coalesce(p_email, '')), '');$r5$,
                  $r5b$  v_email   text := coalesce(nullif(btrim(coalesce(p_email, '')), ''), (select p0.email from public.profiles p0 where p0.id = p_org_id));$r5b$),
    ('MU6', 'R1', $r6$  v_email   text := nullif(btrim(coalesce(p_email, '')), '');
  v_enabled boolean;
begin
  if p_org_id is null or not public.is_org_member(p_org_id) then$r6$, $r6b$  v_email   text := nullif(btrim(coalesce(p_email, '')), '');
  v_enabled boolean;
begin
  if p_org_id is null then$r6b$),
    ('MU7', 'F1', $r7$    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if not public.org_feature_on(p_org_id, 'volunteers') then$r7$, $r7b$    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if false then$r7b$),
    ('MU8', 'E1', $r8$  select p.plan into v_plan from public.profiles p where p.id = p_org_id;
  if v_plan is distinct from 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  select s.contact_email into v_contact$r8$, $r8b$  select s.contact_email into v_contact$r8b$),
    ('MU9', 'O2', $r9$       set status = 'sending', locked_at = now(), attempts = o.attempts + 1$r9$,
                  $r9b$       set locked_at = now(), attempts = o.attempts + 1$r9b$),
    ('MU10', 'OS', $r10$     set status = 'superseded', error = 'superseded by a newer change'$r10$,
                   $r10b$     set error = o.error$r10b$),
    ('MU11', 'OF', $r11$     set status = 'failed', error = 'feature_off'$r11$, $r11b$     set error = o.error$r11b$),
    ('MU12', 'O4', $r12$   where o.id = p_id and o.status = 'sending'$r12$, $r12b$   where o.id = p_id$r12b$),
    ('MU13', 'O8', $r13$  delete from public.volunteer_rate_events where at < now() - interval '23 hours';$r13$,
                   $r13b$  perform 1;$r13b$),
    ('MU14', 'O7', $r14$                    check (jsonb_typeof(payload) = 'object'
                           and not (payload ?| array['email', 'email_lc', 'to',
                                                     'first_initial', 'last_name', 'name'])),$r14$,
                   $r14b$                    check (jsonb_typeof(payload) = 'object'),$r14b$),
    ('MU15', 'O6', $r15$   where status = 'sending' and locked_at < now() - interval '10 minutes';$r15$,
                   $r15b$   where false;$r15b$),
    ('MU16', 'G2', $r16$grant execute on function public.volunteer_outbox_take(integer)          to service_role;$r16$,
                   $r16b$grant execute on function public.volunteer_outbox_take(integer)          to service_role, authenticated;$r16b$)
  ) as t(id, expect, find, repl)
  loop
    if (length(v_body) - length(replace(v_body, m.find, ''))) / length(m.find) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      perform pg_temp.h120_drop();
      execute replace(v_body, m.find, m.repl);
      v_res := pg_temp.h120_case();
      raise exception 'H120CASE:%', v_res;
    exception when others then
      v_mut := replace(sqlerrm, 'H120CASE:', '');
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 180), m.expect);
    end;
  end loop;

  -- V1: the migration's own verify block refuses the grant and trigger mutants.
  for m in select * from (values
    ('MU3', $v3$returns trigger
language plpgsql
security definer$v3$, $v3b$returns trigger
language plpgsql
security invoker$v3b$),
    ('MU4', $v4$grant select on table public.volunteer_settings to authenticated;$v4$,
            $v4b$grant select on table public.volunteer_settings to authenticated;
grant select on table public.volunteer_outbox to authenticated;$v4b$),
    ('MU16', $v16$grant execute on function public.volunteer_outbox_take(integer)          to service_role;$v16$,
             $v16b$grant execute on function public.volunteer_outbox_take(integer)          to service_role, authenticated;$v16b$)
  ) as t(id, find, repl)
  loop
    begin
      perform pg_temp.h120_drop();
      execute replace(v_mig, m.find, m.repl);
      raise exception 'V1MISS';
    exception when others then
      v_out := v_out || format(E'V1 %s %s\n', m.id,
        case when sqlerrm like '0120 verify:%' then 'refused by the verify block' else 'NOT refused: ' || left(sqlerrm, 120) end);
    end;
  end loop;

  raise exception E'ROLLED BACK — 0120 proof\n%', v_out;
end $h$;

-- Leak check (run separately afterwards; every value must be 0 / false until
-- 0120 is applied):
-- select (select count(*) from public.leagues where name like 'ZZ120%'),
--        (select count(*) from pg_class where relname in ('org_features', 'volunteer_settings', 'volunteers',
--                                                        'volunteer_outbox', 'volunteer_rate_events')),
--        (select count(*) from pg_proc where proname in ('org_feature_on', 'volunteer_outbox_take',
--                                                       'wipe_volunteer_data_on_archive')),
--        (select count(*) from pg_trigger where tgname = 'wipe_volunteer_data_on_archive'),
--        (select plan from public.profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6');

-- ── RUN LOG ──────────────────────────────────────────────────────────────────
-- (not run yet — needs Whit's go and timing)
