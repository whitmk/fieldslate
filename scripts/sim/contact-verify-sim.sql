-- Proof for 0126 (contact email verification). Assembled by
-- contact-verify-build.ts, which puts the LITERAL migration text where the
-- placeholder is. One transaction the final RAISE always rolls back; the
-- migration is applied in a rolled-back sub-run for the baseline and again for
-- every mutant. Fixture: the "test" proof org (bbf9afe1…, Elite) only; the
-- non-member caller is SRALL's owner (aa21d01c…), as in the 0108/0125 proofs.
-- Never Santa Rosa American's data.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/contact-verify-build.ts
-- > proof.sql`, send it as ONE batch, read the raised message, then the leak
-- check at the bottom. `--md5` prints the md5(prosrc) the apply must match.
--
-- THROUGH THE APP'S OWN FUNCTIONS (CLAUDE.md, 2026-11-09): every setting
-- change goes through the function the app calls, as the role that calls it —
--   * BEFORE the migration, the seed saves the test org's two addresses and
--     turns both switches on with the OLD functions the old cards called
--     (set_volunteer_contact_email / set_volunteer_link,
--     set_official_signup_contact / set_official_signup_enabled);
--   * AFTER it: contact_verify_begin / _state / contact_email_remove and the
--     two switch functions as `authenticated`; contact_verify_take / _peek /
--     _confirm as `service_role` (the route and the confirm page).
-- The ONLY direct writes: org_features (the switch is set in the SQL editor —
-- that IS its path) and moving the CLOCK (sent_at / expires_at pushed into the
-- past to stand for a minute or 7 days passing; marked "clock" below).
--
-- LOCKS: the migration's own (ACCESS EXCLUSIVE on the new table; SHARE ROW
-- EXCLUSIVE on profiles and auth.users for its foreign keys; ROW EXCLUSIVE on
-- volunteer_settings and official_signup_settings) plus the test org's rows.
-- In the run, the migration ALSO moves SRALL's two addresses — rolled back.
--
-- Assertions (each kind runs CV1–CV11; the case returns the FIRST failing tag):
--   CM1 an address saved before 0126 waits for confirmation: the settings
--       address is cleared, the switch is OFF, a waiting row holds it with no
--       link; Resend sends the first link
--   CV1 saving a new address writes NOTHING to the settings table; the state
--       shows it waiting; turning the switch on is refused (contact_required)
--   CV2 begin's reply carries no token; take mints one (64 hex), stores only
--       its sha256, and is refused to `authenticated`; the table is unreadable
--       to `authenticated`
--   CV3 peek doesn't use the link up (twice ok); confirm makes the address the
--       contact and deletes the row; the same link again is `unknown`
--       (single use); the switch can then be turned on
--   CV4 changing the address while on: the old one stays in use until the new
--       one is confirmed, then the new one replaces it
--   CV5 a link 7 days old is `expired` on peek and confirm; nothing changes
--   CV6 Resend: refused within a minute (too_soon); after it, a new link, and
--       the old link is `unknown`
--   CV7 at most 5 sends a day (too_many on the 6th)
--   CV8 take acts only on a fresh, unsent request (nothing otherwise; a second
--       take of the same request is nothing)
--   CV9 saving the address already in use (any case) sends nothing and drops
--       a waiting one
--   CV10 Cancel drops the waiting address (its link unknown); removing the
--       confirmed address is refused while the switch is on, allowed when off
--   CV11 a non-member, a bad address, an unknown kind are refused; with the
--       feature switched off a live link reads `unknown`
--   CP1 EXECUTE per role; the two old writers are gone; no role holds any
--       privilege on the new table
-- Mutants (each must die at its own tag):
--   MC1 begin writes the new address straight into the settings table   → CV1
--   MC2 take callable by authenticated                                  → CV2
--   MC3 confirm doesn't delete the row (the link works twice)           → CV3
--   MC4 confirm ignores the expiry                                      → CV5
--   MC5 a re-request keeps the old link working                         → CV6
--   MC6 no one-minute wait between sends                                → CV6
--   MC7 no daily cap                                                    → CV7
--   MC8 take ignores how old the request is                             → CV8
--   MC9 the confirmed address can be removed while the switch is on     → CV10
--   MC10 existing addresses stay in use (the move skipped)              → CM1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '120s', true);

create or replace function pg_temp.h126_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

-- The test org's owner (an authenticated admin of it) and the service role.
create or replace function pg_temp.h126_admin(p_sql text) returns text language sql as $f$
  select pg_temp.h126_as('bbf9afe1-9e62-41e0-becc-895085bfc9d6', 'authenticated', p_sql)
$f$;
create or replace function pg_temp.h126_svc(p_sql text) returns text language sql as $f$
  select pg_temp.h126_as(null, 'service_role', p_sql)
$f$;

-- Seed, BEFORE the migration, through the old app functions.
-- A reply's status, or the reply itself when it isn't JSON (an "ERR …" line):
-- a refusal must fail its own assertion, never crash the case.
create or replace function pg_temp.h126_st(p text) returns text language plpgsql as $f$
begin
  return p::jsonb->>'status';
exception when others then
  return p;
end;
$f$;

-- Any reply as jsonb; a non-JSON reply ("ERR …") becomes {"status": <it>}.
create or replace function pg_temp.h126_j(p text) returns jsonb language plpgsql as $f$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('status', p);
end;
$f$;

create or replace function pg_temp.h126_seed() returns text language plpgsql as $f$
declare
  v_org uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_r text;
begin
  insert into public.org_features (owner_id, feature, enabled) values
    (v_org, 'volunteers', true), (v_org, 'official_signup', true)
  on conflict (owner_id, feature) do update set enabled = true;
  delete from public.volunteer_settings where owner_id = v_org;
  delete from public.official_signup_settings where owner_id = v_org;
  v_r := pg_temp.h126_admin(format('select public.set_volunteer_contact_email(%L, %L)::text', v_org, 'old-vol@zz126.test'));
  if v_r like 'ERR%' then return 'seed vol contact: ' || v_r; end if;
  v_r := pg_temp.h126_admin(format('select public.set_volunteer_link(%L, true)::text', v_org));
  if v_r like 'ERR%' then return 'seed vol link: ' || v_r; end if;
  v_r := pg_temp.h126_admin(format('select public.set_official_signup_contact(%L, %L)::text', v_org, 'old-off@zz126.test'));
  if v_r like 'ERR%' then return 'seed off contact: ' || v_r; end if;
  v_r := pg_temp.h126_admin(format('select public.set_official_signup_enabled(%L, true)::text', v_org));
  if v_r like 'ERR%' then return 'seed off on: ' || v_r; end if;
  return 'ok';
end;
$f$;

create or replace function pg_temp.h126_switch(p_kind text, p_on boolean) returns text language sql as $f$
  select pg_temp.h126_admin(case when p_kind = 'volunteers'
    then format('select public.set_volunteer_link(%L, %L::boolean)::text', 'bbf9afe1-9e62-41e0-becc-895085bfc9d6', p_on::text)
    else format('select public.set_official_signup_enabled(%L, %L::boolean)::text', 'bbf9afe1-9e62-41e0-becc-895085bfc9d6', p_on::text) end)
$f$;

create or replace function pg_temp.h126_contact(p_kind text) returns text language sql as $f$
  select case when p_kind = 'volunteers'
    then (select contact_email from public.volunteer_settings where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6')
    else (select contact_email from public.official_signup_settings where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') end
$f$;

create or replace function pg_temp.h126_on(p_kind text) returns boolean language sql as $f$
  select coalesce(case when p_kind = 'volunteers'
    then (select link_enabled from public.volunteer_settings where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6')
    else (select enabled from public.official_signup_settings where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') end, false)
$f$;

-- One kind, CV1–CV11.
create or replace function pg_temp.h126_kind(k text) returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_other uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';
  v_r text; v_t jsonb; v_tok text; v_tok2 text; i int;
  e1 text := k || '-one@zz126.test';
  e2 text := k || '-two@zz126.test';
  begin_sql text := 'select public.contact_verify_begin(%L, %L, %L)::text';
  take_sql  text := 'select public.contact_verify_take(%L, %L)::text';
begin
  -- Start this kind from: nothing confirmed, switch off, nothing waiting.
  perform pg_temp.h126_switch(k, false);
  perform pg_temp.h126_admin(format('select public.contact_email_remove(%L, %L, %L)::text', v_org, k, 'pending'));
  perform pg_temp.h126_admin(format('select public.contact_email_remove(%L, %L, %L)::text', v_org, k, 'contact'));

  -- CV1
  v_r := pg_temp.h126_admin(format(begin_sql, v_org, k, e1));
  if pg_temp.h126_st(v_r) is distinct from 'requested' or pg_temp.h126_contact(k) is not null then
    return format('CV1 %s save: %s (contact now %s)', k, v_r, pg_temp.h126_contact(k));
  end if;
  v_t := pg_temp.h126_j(pg_temp.h126_admin(format('select public.contact_verify_state(%L, %L)::text', v_org, k)));
  if v_t->'pending'->>'email' is distinct from e1 or v_t->>'contact_email' is not null then return format('CV1 %s state: %s', k, v_t); end if;
  v_r := pg_temp.h126_switch(k, true);
  if v_r not like '%contact_required%' then return format('CV1 %s switch on before confirming: %s', k, v_r); end if;

  -- CV2
  if (pg_temp.h126_admin(format(begin_sql, v_org, k, e1)) || '') like '%token%' then
    return format('CV2 %s begin returned a token', k);
  end if;
  -- (that second begin is "too_soon"? No — nothing was sent yet, so it is a
  -- fresh request for the same address.)
  v_r := pg_temp.h126_admin(format(take_sql, v_org, k));
  if v_r not like 'ERR 42501%' then return format('CV2 %s take as authenticated: %s', k, left(v_r, 120)); end if;
  v_r := pg_temp.h126_admin('select count(*)::text from public.contact_email_verifications');
  if v_r not like 'ERR 42501%' then return format('CV2 %s table readable by authenticated: %s', k, v_r); end if;
  v_t := pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)));
  v_tok := v_t->>'token';
  if v_t->>'status' is distinct from 'ok' or v_tok !~ '^[0-9a-f]{64}$' or v_t->>'email' is distinct from e1
     or not exists (select 1 from public.contact_email_verifications
                     where owner_id = v_org and kind = k and token_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex'))
     or exists (select 1 from public.contact_email_verifications where token_hash = v_tok) then
    return format('CV2 %s take: %s', k, v_t);
  end if;

  -- CV3
  for i in 1..2 loop
    v_r := pg_temp.h126_svc(format('select public.contact_verify_peek(%L)::text', v_tok));
    if pg_temp.h126_st(v_r) is distinct from 'ok' or pg_temp.h126_j(v_r)->>'email' is distinct from e1 then
      return format('CV3 %s peek %s: %s', k, i, v_r);
    end if;
  end loop;
  v_r := pg_temp.h126_svc(format('select public.contact_verify_confirm(%L)::text', v_tok));
  if pg_temp.h126_st(v_r) is distinct from 'confirmed' or pg_temp.h126_contact(k) is distinct from e1
     or exists (select 1 from public.contact_email_verifications where owner_id = v_org and kind = k) then
    return format('CV3 %s confirm: %s (contact %s)', k, v_r, pg_temp.h126_contact(k));
  end if;
  v_r := pg_temp.h126_svc(format('select public.contact_verify_confirm(%L)::text', v_tok));
  if pg_temp.h126_st(v_r) is distinct from 'unknown' then return format('CV3 %s link used twice: %s', k, v_r); end if;
  v_r := pg_temp.h126_switch(k, true);
  if v_r like 'ERR%' or not pg_temp.h126_on(k) then return format('CV3 %s switch on after confirming: %s', k, v_r); end if;

  -- CV4 — change while on.
  perform pg_temp.h126_admin(format(begin_sql, v_org, k, e2));
  if pg_temp.h126_contact(k) is distinct from e1 or not pg_temp.h126_on(k) then
    return format('CV4 %s new address used before confirming (contact %s)', k, pg_temp.h126_contact(k));
  end if;
  v_tok := pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'token';
  v_r := pg_temp.h126_svc(format('select public.contact_verify_confirm(%L)::text', v_tok));
  if pg_temp.h126_st(v_r) is distinct from 'confirmed' or pg_temp.h126_contact(k) is distinct from e2 then
    return format('CV4 %s confirm the change: %s', k, v_r);
  end if;

  -- CV5 — expiry (clock).
  perform pg_temp.h126_admin(format(begin_sql, v_org, k, e1));
  v_tok := pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'token';
  update public.contact_email_verifications set expires_at = now() - interval '1 second', sent_at = now() - interval '7 days 1 second'
   where owner_id = v_org and kind = k;                                                     -- clock
  if pg_temp.h126_j(pg_temp.h126_svc(format('select public.contact_verify_peek(%L)::text', v_tok)))->>'status' is distinct from 'expired'
     or pg_temp.h126_j(pg_temp.h126_svc(format('select public.contact_verify_confirm(%L)::text', v_tok)))->>'status' is distinct from 'expired'
     or pg_temp.h126_contact(k) is distinct from e2 then
    return format('CV5 %s an expired link (contact %s)', k, pg_temp.h126_contact(k));
  end if;

  -- CV6 — resend.
  v_r := pg_temp.h126_admin(format(begin_sql, v_org, k, null));
  if pg_temp.h126_st(v_r) is distinct from 'requested' then return format('CV6 %s resend of an expired link: %s', k, v_r); end if;
  v_tok := pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'token';
  v_r := pg_temp.h126_admin(format(begin_sql, v_org, k, null));
  if v_r not like '%too_soon%' then return format('CV6 %s resend within a minute: %s', k, v_r); end if;
  update public.contact_email_verifications set sent_at = now() - interval '61 seconds' where owner_id = v_org and kind = k;  -- clock
  perform pg_temp.h126_admin(format(begin_sql, v_org, k, null));
  v_tok2 := pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'token';
  if v_tok2 is null or v_tok2 = v_tok
     or pg_temp.h126_j(pg_temp.h126_svc(format('select public.contact_verify_peek(%L)::text', v_tok)))->>'status' is distinct from 'unknown'
     or pg_temp.h126_j(pg_temp.h126_svc(format('select public.contact_verify_peek(%L)::text', v_tok2)))->>'status' is distinct from 'ok' then
    return format('CV6 %s the old link after a resend', k);
  end if;

  -- CV7 — the day's cap: this row has 3 sends today (CV5 begin, CV6 twice).
  for i in 1..2 loop
    update public.contact_email_verifications set sent_at = now() - interval '61 seconds' where owner_id = v_org and kind = k;  -- clock
    v_r := pg_temp.h126_admin(format(begin_sql, v_org, k, null));
    if v_r like 'ERR%' then return format('CV7 %s send %s of 5: %s', k, i + 3, v_r); end if;
    perform pg_temp.h126_svc(format(take_sql, v_org, k));
  end loop;
  update public.contact_email_verifications set sent_at = now() - interval '61 seconds' where owner_id = v_org and kind = k;  -- clock
  v_r := pg_temp.h126_admin(format(begin_sql, v_org, k, null));
  if v_r not like '%too_many%' then return format('CV7 %s the sixth send: %s', k, v_r); end if;

  -- CV8 — take only a fresh, unsent request.
  if pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'status' is distinct from 'nothing' then
    return format('CV8 %s take of an already-sent request', k);
  end if;
  perform pg_temp.h126_admin(format('select public.contact_email_remove(%L, %L, %L)::text', v_org, k, 'pending'));
  perform pg_temp.h126_admin(format(begin_sql, v_org, k, e1));
  update public.contact_email_verifications set requested_at = now() - interval '6 minutes' where owner_id = v_org and kind = k;  -- clock
  if pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'status' is distinct from 'nothing' then
    return format('CV8 %s take of a request 6 minutes old', k);
  end if;

  -- CV9 — the address already in use.
  v_r := pg_temp.h126_admin(format(begin_sql, v_org, k, upper(e2)));
  if pg_temp.h126_st(v_r) is distinct from 'already_confirmed'
     or exists (select 1 from public.contact_email_verifications where owner_id = v_org and kind = k) then
    return format('CV9 %s the address in use: %s', k, v_r);
  end if;

  -- CV10 — cancel; remove.
  perform pg_temp.h126_admin(format(begin_sql, v_org, k, e1));
  v_tok := pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'token';
  perform pg_temp.h126_admin(format('select public.contact_email_remove(%L, %L, %L)::text', v_org, k, 'pending'));
  if pg_temp.h126_j(pg_temp.h126_svc(format('select public.contact_verify_peek(%L)::text', v_tok)))->>'status' is distinct from 'unknown' then
    return format('CV10 %s a cancelled link still works', k);
  end if;
  v_r := pg_temp.h126_admin(format('select public.contact_email_remove(%L, %L, %L)::text', v_org, k, 'contact'));
  if v_r not like '%contact_required%' or pg_temp.h126_contact(k) is distinct from e2 then
    return format('CV10 %s removing the address while on: %s', k, v_r);
  end if;
  perform pg_temp.h126_switch(k, false);
  v_r := pg_temp.h126_admin(format('select public.contact_email_remove(%L, %L, %L)::text', v_org, k, 'contact'));
  if v_r like 'ERR%' or pg_temp.h126_contact(k) is not null then return format('CV10 %s removing when off: %s', k, v_r); end if;

  -- CV11 — refusals.
  v_r := pg_temp.h126_as(v_other, 'authenticated', format(begin_sql, v_org, k, e1));
  if v_r not like '%not_authorized%' then return format('CV11 %s non-member: %s', k, v_r); end if;
  v_r := pg_temp.h126_admin(format(begin_sql, v_org, k, 'not an address'));
  if v_r not like '%invalid_email%' then return format('CV11 %s bad address: %s', k, v_r); end if;
  v_r := pg_temp.h126_admin(format(begin_sql, v_org, 'payroll', e1));
  if v_r not like '%invalid_kind%' then return format('CV11 %s unknown kind: %s', k, v_r); end if;
  perform pg_temp.h126_admin(format(begin_sql, v_org, k, e1));
  v_tok := pg_temp.h126_j(pg_temp.h126_svc(format(take_sql, v_org, k)))->>'token';
  update public.org_features set enabled = false where owner_id = v_org and feature = k;
  v_r := pg_temp.h126_svc(format('select public.contact_verify_confirm(%L)::text', v_tok));
  update public.org_features set enabled = true where owner_id = v_org and feature = k;
  if pg_temp.h126_st(v_r) is distinct from 'unknown' or pg_temp.h126_contact(k) is not null then
    return format('CV11 %s confirm with the feature off: %s', k, v_r);
  end if;

  return 'pass';
end;
$f$;

create or replace function pg_temp.h126_case() returns text language plpgsql as $f$
declare
  v_org uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_r text; v_tok text; k text; f text; r text;
  v_auth text[] := array['public.contact_verify_begin(uuid, text, text)', 'public.contact_verify_state(uuid, text)',
                         'public.contact_email_remove(uuid, text, text)'];
  v_svc  text[] := array['public.contact_verify_take(uuid, text)', 'public.contact_verify_peek(text)',
                         'public.contact_verify_confirm(text)'];
  v_none text[] := array['public.contact_verify_gate(uuid, text, boolean)', 'public.contact_verify_current(uuid, text)'];
begin
  -- CM1 — the seeded addresses wait; Resend sends the first link.
  foreach k in array array['volunteers', 'official_signup'] loop
    if pg_temp.h126_contact(k) is not null or pg_temp.h126_on(k)
       or not exists (select 1 from public.contact_email_verifications
                       where owner_id = v_org and kind = k and token_hash is null and sent_at is null
                         and email = case when k = 'volunteers' then 'old-vol@zz126.test' else 'old-off@zz126.test' end) then
      return format('CM1 %s after the migration: contact %s, on %s', k, pg_temp.h126_contact(k), pg_temp.h126_on(k));
    end if;
    v_r := pg_temp.h126_admin(format('select public.contact_verify_begin(%L, %L, null)::text', v_org, k));
    v_tok := pg_temp.h126_j(pg_temp.h126_svc(format('select public.contact_verify_take(%L, %L)::text', v_org, k)))->>'token';
    if pg_temp.h126_st(v_r) is distinct from 'requested' or v_tok is null then
      return format('CM1 %s first Resend: %s', k, v_r);
    end if;
  end loop;

  foreach k in array array['volunteers', 'official_signup'] loop
    v_r := pg_temp.h126_kind(k);
    if v_r <> 'pass' then return v_r; end if;
  end loop;

  -- CP1
  foreach f in array v_auth || v_svc || v_none loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') <>
         ((r = 'authenticated' and f = any(v_auth)) or (r = 'service_role' and f = any(v_svc))) then
        return format('CP1 %s EXECUTE on %s is wrong', r, f);
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('set_volunteer_contact_email', 'set_official_signup_contact')) then
    return 'CP1 an old contact writer still exists';
  end if;
  foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if has_table_privilege(r, 'public.contact_email_verifications', 'SELECT,INSERT,UPDATE,DELETE') then
      return format('CP1 %s has a privilege on the table', r);
    end if;
  end loop;
  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig126$
-- @@MIGRATION_0126@@
$mig126$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_seed  text;
  v_out   text := E'\n';
  m       record;
begin
  if strpos(v_body, '-- 8. Verify') = 0 then raise exception 'harness: verify marker not found in 0126'; end if;
  v_nover := split_part(v_body, '-- 8. Verify', 1);

  begin
    v_seed := pg_temp.h126_seed();
    if v_seed <> 'ok' then raise exception 'H126SEED:%', v_seed; end if;
    execute v_body;
    v_res := pg_temp.h126_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || 'md5(prosrc) ' || (
      select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname)
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('contact_verify_gate', 'contact_verify_current', 'contact_verify_begin', 'contact_verify_state',
                           'contact_email_remove', 'contact_verify_take', 'contact_verify_peek', 'contact_verify_confirm')) || E'\n';
    raise exception 'H126ROLLBACK';
  exception when others then
    if sqlerrm <> 'H126ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MC1', 'CV1', $r$  return jsonb_build_object('status', 'requested', 'email', v_email);$r$,
                   $r$  if p_kind = 'volunteers' then
    update public.volunteer_settings set contact_email = v_email where owner_id = p_org_id;
  else
    update public.official_signup_settings set contact_email = v_email where owner_id = p_org_id;
  end if;
  return jsonb_build_object('status', 'requested', 'email', v_email);$r$),
    ('MC2', 'CV2', $r$grant execute on function public.contact_verify_take(uuid, text)        to service_role;$r$,
                   $r$grant execute on function public.contact_verify_take(uuid, text)        to service_role, authenticated;$r$),
    ('MC3', 'CV3', $r$  delete from public.contact_email_verifications where owner_id = v_row.owner_id and kind = v_row.kind;
$r$, $r$$r$),
    ('MC4', 'CV5', $r$  if v_row.expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'kind', v_row.kind,
      'league_name', (select p.org_name from public.profiles p where p.id = v_row.owner_id));
  end if;

  if v_row.kind = 'volunteers' then$r$,
                   $r$  if v_row.kind = 'volunteers' then$r$),
    ('MC5', 'CV6', $r$         token_hash = null,          -- the previous link stops working now
$r$, $r$$r$),
    ('MC6', 'CV6', $r$  if v_row.sent_at is not null and v_row.sent_at > now() - interval '60 seconds' then$r$,
                   $r$  if false then$r$),
    ('MC7', 'CV7', $r$  if v_row.send_day = v_today and v_row.send_count >= 5 then$r$,
                   $r$  if false then$r$),
    ('MC8', 'CV8', $r$     and v.sent_at is null and v.requested_at > now() - interval '5 minutes'$r$,
                   $r$     and v.requested_at is not null$r$),
    ('MC9', 'CV10', $r$      if coalesce(v_on, false) then raise exception 'contact_required' using errcode = 'P0001'; end if;
      update public.volunteer_settings$r$,
                    $r$      update public.volunteer_settings$r$),
    ('MC10', 'CM1', $r$update public.volunteer_settings
   set link_enabled = false, contact_email = null, updated_at = now()
 where contact_email is not null;
update public.official_signup_settings
   set enabled = false, contact_email = null, updated_at = now()
 where contact_email is not null;$r$, $r$$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      v_seed := pg_temp.h126_seed();
      if v_seed <> 'ok' then raise exception 'H126CASE:SEED %', v_seed; end if;
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h126_case();
      raise exception 'H126CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H126CASE:%' then replace(sqlerrm, 'H126CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0126 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname like 'contact_verify%' or proname = 'contact_email_remove') as new_functions_must_be_0,
--   (select count(*) from pg_proc where proname in ('set_volunteer_contact_email', 'set_official_signup_contact')) as old_writers_must_be_2,
--   (select to_regclass('public.contact_email_verifications')) as table_must_be_null,
--   (select json_agg(row_to_json(s)) from volunteer_settings s) as vol_rows_as_before,
--   (select json_agg(row_to_json(s)) from official_signup_settings s) as off_rows_as_before,
--   (select json_agg(row_to_json(f)) from org_features f where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_features_as_before,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-10 (UTC), against production, rolled back, on Whit's go (sent as one
-- batch, comment-stripped harness, the migration byte-exact).
--   Run 1 — HARNESS FAULT: h126_switch wrote the boolean into the SQL with %s,
--     so set_volunteer_link(…, t) read `t` as a column (42703). MC1 and MC10
--     were killed at their own tag; the other eight died at that line. md5s
--     already matched. Fixed: %L::boolean.
--   Run 2 — baseline GREEN, md5s matched, 9/10 at their own tag; MC5 CRASHED
--     the case (CV6 cast an "ERR …" reply to jsonb) instead of failing CV6 —
--     a harness fault. Fixed: every reply read goes through h126_st / h126_j,
--     which never raise.
--   Run 3 — GREEN: baseline pass; 10/10 KILLED at their own tag; md5(prosrc)
--     of all eight = `contact-verify-build.ts --md5`.
--   Leak check: identical to the pre-run snapshot (no 0126 objects, both old
--     writers present, SRALL's rows unchanged, the test org's features
--     unchanged, no h126 functions, no idle transaction).
--   Applied right after (apply_migration, verbatim): catalog 20261110004535;
--     verify block passed; md5s, DEFINER/INVOKER, search_path, EXECUTE per
--     role, table privileges and RLS checked live; SRALL's two addresses
--     waiting (no link sent), both switches off.
