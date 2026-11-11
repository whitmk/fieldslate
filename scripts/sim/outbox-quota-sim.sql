-- Proof for 0128 (outbox quota hold + email problems). Assembled by
-- outbox-quota-build.ts, which puts the LITERAL migration text where the
-- placeholder is. One transaction the final RAISE always rolls back; the
-- migration is applied in a rolled-back sub-run for the baseline and again for
-- every mutant. Fixture: the "test" proof org (bbf9afe1…, Elite) and its
-- season "QA Fall 2026" (4f72caa9…) — never Santa Rosa American's data.
--
-- DIRECT WRITES (the app has no function that creates these, so the fixture
-- writes them; stated per the 2026-11-09 rule): a volunteer, two detached
-- sign-ups (one whose spot started two hours ago, one tomorrow), outbox rows
-- in each state, a volunteer trigger-failure row, an official and an
-- officials outbox row, and the two feature switches set on. Every call under
-- test goes through the 0128 functions, as the role the app uses (the drain:
-- service_role; the banner: the signed-in member).
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/outbox-quota-build.ts
-- > proof.sql`, send it as ONE batch, read the raised message, then the leak
-- check at the bottom. `--md5` prints the md5(prosrc) the apply must match.
--
-- LOCKS: ACCESS EXCLUSIVE on volunteer_outbox, official_outbox and
-- volunteer_trigger_failures for the run (the ADD COLUMN, re-applied in each
-- sub-run) — the two drains wait until the run ends (seconds; they run every
-- 5 minutes and retry). No lock on games, leagues or profiles beyond the FK
-- checks of the fixture inserts.
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   QF1 volunteer_outbox_hold puts a `sending` row back to pending at the
--       given time with the take's attempt given back; official_outbox_hold
--       the same
--   QF1b a hold on a row that isn't `sending` changes nothing; a bad reason
--       is refused
--   QF2 drop_started supersedes a pending spot_lost whose spot started
--       (error game_started) and keeps one whose spot is tomorrow
--   QF2b it never drops a kind that isn't about a game time
--       (signup_confirmed for the started spot stays pending)
--   QF3 volunteer_email_problems, as the member: the failed row with the
--       volunteer's name and spot, the waiting count and reason, the trigger
--       failure count; a non-member is refused; official_email_problems
--       names the official
--   QF4 ack hides the acknowledged rows and the trigger failures; a
--       non-member's ack is refused and changes nothing
--   P1  EXECUTE: hold/drop service_role only; problems/ack authenticated
--       only; anon and dashboard_readonly none
-- Mutants (each must die at its own tag):
--   MQ1 the hold uses the attempt (no refund)                → QF1
--   MQ2 the drop ignores the kind (drops a confirmation)     → QF2b
--   MQ3 the drop ignores the start (drops tomorrow's notice) → QF2
--   MQ4 the problems function skips the admin gate           → QF3
--   MQ5 the problems function is granted to anon             → P1
--   MQ6 the ack ignores the ids (acks every failed row)      → QF4
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h128_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

create or replace function pg_temp.h128_case() returns text language plpgsql as $f$
declare
  v_org     uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_season  uuid := '4f72caa9-9088-4118-be3e-fc7cdddd79a0';
  v_other   uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';  -- a real profile, not a member of "test"
  v_vol     uuid;
  v_ump     uuid;
  v_c_past  uuid;
  v_c_next  uuid;
  v_now     timestamp;
  v_send    bigint;
  v_sendo   bigint;
  v_pend    bigint;
  v_lost_p  bigint;
  v_lost_n  bigint;
  v_conf    bigint;
  v_fail    bigint;
  v_fail2   bigint;
  v_wait    bigint;
  v_ofail   bigint;
  v_until   timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day';
  v_r       text;
  v_j       jsonb;
  v_st      text;
  v_att     integer;
  v_next    timestamptz;
  v_err     text;
  r         text;
begin
  insert into public.org_features (owner_id, feature, enabled) values (v_org, 'volunteers', true), (v_org, 'official_signup', true)
    on conflict (owner_id, feature) do update set enabled = true;
  v_now := public.volunteer_org_now(v_org);

  insert into public.volunteers (owner_id, email_lc, first_initial, last_name, adult_confirmed_at)
  values (v_org, 'q128@zz128.test', 'Q', 'Proofwright', now()) returning id into v_vol;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, position, status, created_by, detached_at, detached_from)
  values (v_org, v_season, v_vol, 1, 'detached', 'admin', now(),
          jsonb_build_object('start', to_char(v_now - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI')))
  returning id into v_c_past;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, position, status, created_by, detached_at, detached_from)
  values (v_org, v_season, v_vol, 1, 'detached', 'admin', now(),
          jsonb_build_object('start', to_char(v_now + interval '1 day', 'YYYY-MM-DD"T"HH24:MI')))
  returning id into v_c_next;

  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status, attempts, locked_at)
  values (v_org, v_season, v_vol, 'reminder', '{}'::jsonb, 'sending', 2, now()) returning id into v_send;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status, attempts)
  values (v_org, v_season, v_vol, 'reminder', '{}'::jsonb, 'pending', 1) returning id into v_pend;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_org, v_season, v_vol, 'spot_lost', jsonb_build_object('claim_id', v_c_past)) returning id into v_lost_p;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_org, v_season, v_vol, 'spot_lost', jsonb_build_object('claim_id', v_c_next)) returning id into v_lost_n;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_org, v_season, v_vol, 'signup_confirmed', jsonb_build_object('claim_id', v_c_past)) returning id into v_conf;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status, error)
  values (v_org, v_season, v_vol, 'spot_lost', jsonb_build_object('claim_id', v_c_next), 'failed', 'bad_recipient') returning id into v_fail;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status, error)
  values (v_org, v_season, v_vol, 'reminder', '{}'::jsonb, 'failed', 'send failed') returning id into v_fail2;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, status, error, next_attempt_at)
  values (v_org, v_season, v_vol, 'reminder', '{}'::jsonb, 'pending', 'quota_daily', v_until) returning id into v_wait;
  insert into public.volunteer_trigger_failures (owner_id, season_id, game_id, trigger_name, error_code)
  values (v_org, v_season, null, 'game_change', 'XX000');

  insert into public.umpires (season_id, name, designation) values (v_season, 'Proof Umpire 128', 'adult') returning id into v_ump;
  insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload, status, attempts, locked_at)
  values (v_org, v_season, v_ump, 'help_request', '{}'::jsonb, 'sending', 1, now()) returning id into v_sendo;
  insert into public.official_outbox (owner_id, season_id, umpire_id, kind, payload, status, error)
  values (v_org, v_season, v_ump, 'help_request', '{}'::jsonb, 'failed', 'bad_recipient') returning id into v_ofail;

  -- QF1 — the hold gives the attempt back.
  v_r := pg_temp.h128_as(v_org, 'service_role', format('select public.volunteer_outbox_hold(%s, %L, %L)::text', v_send, v_until, 'quota_daily'));
  select o.status, o.attempts, o.next_attempt_at, o.error into v_st, v_att, v_next, v_err from public.volunteer_outbox o where o.id = v_send;
  if v_r is distinct from '{"updated": true}' or v_st <> 'pending' or v_att <> 1 or v_next <> v_until or v_err <> 'quota_daily' then
    return format('QF1 volunteer hold: %s (%s, attempts %s, %s, %s)', v_r, v_st, v_att, v_next, v_err);
  end if;
  v_r := pg_temp.h128_as(v_org, 'service_role', format('select public.official_outbox_hold(%s, %L, %L)::text', v_sendo, v_until, 'rate_limited'));
  select o.status, o.attempts, o.error into v_st, v_att, v_err from public.official_outbox o where o.id = v_sendo;
  if v_r is distinct from '{"updated": true}' or v_st <> 'pending' or v_att <> 0 or v_err <> 'rate_limited' then
    return format('QF1 official hold: %s (%s, attempts %s, %s)', v_r, v_st, v_att, v_err);
  end if;

  -- QF1b — not `sending` → nothing; a bad reason → refused.
  v_r := pg_temp.h128_as(v_org, 'service_role', format('select public.volunteer_outbox_hold(%s, %L, %L)::text', v_pend, v_until, 'quota_daily'));
  select o.attempts, o.error into v_att, v_err from public.volunteer_outbox o where o.id = v_pend;
  if v_r is distinct from '{"updated": false}' or v_att <> 1 or v_err is not null then
    return format('QF1b hold on a pending row: %s (attempts %s, %s)', v_r, v_att, v_err);
  end if;
  v_r := pg_temp.h128_as(v_org, 'service_role', format('select public.volunteer_outbox_hold(%s, %L, %L)::text', v_pend, v_until, 'whatever'));
  if v_r not like '%bad_reason%' then return 'QF1b a bad reason: ' || v_r; end if;

  -- QF2 — the started spot's notice goes; tomorrow's stays.
  v_r := pg_temp.h128_as(v_org, 'service_role', 'select public.volunteer_outbox_drop_started()::text');
  if v_r like 'ERR%' then return 'QF2 drop_started: ' || v_r; end if;
  select o.status, o.error into v_st, v_err from public.volunteer_outbox o where o.id = v_lost_n;
  if v_st <> 'pending' then return format('QF2 tomorrow''s notice was dropped (%s, %s)', v_st, v_err); end if;
  select o.status, o.error into v_st, v_err from public.volunteer_outbox o where o.id = v_lost_p;
  if v_st <> 'superseded' or v_err <> 'game_started' then return format('QF2 the started notice: %s, %s', v_st, v_err); end if;

  -- QF2b — a confirmation is never dropped.
  select o.status into v_st from public.volunteer_outbox o where o.id = v_conf;
  if v_st <> 'pending' then return 'QF2b a confirmation was dropped: ' || v_st; end if;

  -- QF3 — what the banner reads.
  v_r := pg_temp.h128_as(v_org, 'authenticated', format('select public.volunteer_email_problems(%L)::text', v_season));
  if v_r like 'ERR%' then return 'QF3 member read: ' || v_r; end if;
  v_j := v_r::jsonb;
  if not exists (select 1 from jsonb_array_elements(v_j -> 'failed') e
                  where (e ->> 'id')::bigint = v_fail and e ->> 'last_name' = 'Proofwright' and e ->> 'first_initial' = 'Q'
                    and e ->> 'error' = 'bad_recipient' and e -> 'spot' ->> 'start' is not null) then
    return 'QF3 the failed row with name and spot: ' || left(v_r, 300);
  end if;
  if (v_j -> 'waiting' ->> 'count')::int < 1 or v_j -> 'waiting' ->> 'reason' <> 'quota_daily'
     or (v_j ->> 'trigger_failures')::int < 1 then
    return 'QF3 waiting and trigger failures: ' || left(v_r, 300);
  end if;
  v_r := pg_temp.h128_as(v_other, 'authenticated', format('select public.volunteer_email_problems(%L)::text', v_season));
  if v_r not like '%not_authorized%' then return 'QF3 a non-member read: ' || left(v_r, 200); end if;
  v_r := pg_temp.h128_as(v_org, 'authenticated', format('select public.official_email_problems(%L)::text', v_season));
  if v_r like 'ERR%' or not exists (select 1 from jsonb_array_elements(v_r::jsonb -> 'failed') e
                                     where (e ->> 'id')::bigint = v_ofail and e ->> 'official_name' = 'Proof Umpire 128') then
    return 'QF3 officials read: ' || left(v_r, 300);
  end if;

  -- QF4 — ack.
  v_r := pg_temp.h128_as(v_other, 'authenticated', format('select public.volunteer_email_problems_ack(%L, array[%s]::bigint[], true)::text', v_season, v_fail));
  if v_r not like '%not_authorized%' or exists (select 1 from public.volunteer_outbox where id = v_fail and acknowledged_at is not null) then
    return 'QF4 a non-member ack: ' || left(v_r, 200);
  end if;
  v_r := pg_temp.h128_as(v_org, 'authenticated', format('select public.volunteer_email_problems_ack(%L, array[%s]::bigint[], true)::text', v_season, v_fail));
  if v_r like 'ERR%' then return 'QF4 ack: ' || v_r; end if;
  if exists (select 1 from public.volunteer_outbox where id = v_fail2 and acknowledged_at is not null) then
    return 'QF4 a row not in the ids was acknowledged';
  end if;
  v_j := pg_temp.h128_as(v_org, 'authenticated', format('select public.volunteer_email_problems(%L)::text', v_season))::jsonb;
  if exists (select 1 from jsonb_array_elements(v_j -> 'failed') e where (e ->> 'id')::bigint = v_fail)
     or (v_j ->> 'trigger_failures')::int <> 0 then
    return 'QF4 acknowledged rows still listed: ' || left(v_j::text, 300);
  end if;
  v_r := pg_temp.h128_as(v_org, 'authenticated', format('select public.official_email_problems_ack(%L, array[%s]::bigint[])::text', v_season, v_ofail));
  if v_r is distinct from '{"acknowledged": 1}' then return 'QF4 officials ack: ' || v_r; end if;

  -- P1 — privileges.
  foreach r in array array['public.volunteer_outbox_hold(bigint, timestamptz, text)', 'public.official_outbox_hold(bigint, timestamptz, text)',
                           'public.volunteer_outbox_drop_started()'] loop
    if not has_function_privilege('service_role', r, 'EXECUTE') or has_function_privilege('authenticated', r, 'EXECUTE')
       or has_function_privilege('anon', r, 'EXECUTE') or has_function_privilege('dashboard_readonly', r, 'EXECUTE') then
      return 'P1 ' || r || ' must be service_role only';
    end if;
  end loop;
  foreach r in array array['public.volunteer_email_problems(uuid)', 'public.official_email_problems(uuid)',
                           'public.volunteer_email_problems_ack(uuid, bigint[], boolean)', 'public.official_email_problems_ack(uuid, bigint[])'] loop
    if not has_function_privilege('authenticated', r, 'EXECUTE') or has_function_privilege('service_role', r, 'EXECUTE')
       or has_function_privilege('anon', r, 'EXECUTE') or has_function_privilege('dashboard_readonly', r, 'EXECUTE') then
      return 'P1 ' || r || ' must be authenticated only';
    end if;
  end loop;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig128$
-- @@MIGRATION_0128@@
$mig128$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\n';
  m       record;
begin
  if strpos(v_body, '-- 7. Verify') = 0 then raise exception 'harness: verify marker not found in 0128'; end if;
  v_nover := split_part(v_body, '-- 7. Verify', 1);

  begin
    execute v_body;
    v_res := pg_temp.h128_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || (select string_agg(p.proname || '=' || md5(p.prosrc), E'\n' order by p.proname)
                         from pg_proc p where p.pronamespace = 'public'::regnamespace
                          and p.proname in ('volunteer_outbox_hold', 'official_outbox_hold', 'volunteer_outbox_drop_started',
                                            'volunteer_email_problems', 'official_email_problems',
                                            'volunteer_email_problems_ack', 'official_email_problems_ack')) || E'\n';
    raise exception 'H128ROLLBACK';
  exception when others then
    if sqlerrm <> 'H128ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MQ1', 'QF1', $r$  update public.volunteer_outbox
     set status = 'pending', locked_at = null,
         next_attempt_at = greatest(coalesce(p_until, now()), now()),
         attempts = greatest(attempts - 1, 0),$r$,
                   $r$  update public.volunteer_outbox
     set status = 'pending', locked_at = null,
         next_attempt_at = greatest(coalesce(p_until, now()), now()),
         attempts = attempts,$r$),
    ('MQ2', 'QF2b', $r$       and o.kind in ('game_moved', 'rained_out', 'makeup_set', 'back_on', 'shift_changed', 'spot_lost')
$r$, $r$$r$),
    ('MQ3', 'QF2', $r$              <= public.volunteer_org_now(o.owner_id))$r$,
                   $r$              <= public.volunteer_org_now(o.owner_id) + interval '7 days')$r$),
    ('MQ4', 'QF3', $r$  v_owner := public.volunteer_admin_gate(p_season_id, false);
  return jsonb_build_object($r$,
                   $r$  v_owner := (select l.owner_id from public.leagues l where l.id = p_season_id);
  return jsonb_build_object($r$),
    ('MQ5', 'P1', $r$grant execute on function public.volunteer_email_problems(uuid)                          to authenticated;$r$,
                  $r$grant execute on function public.volunteer_email_problems(uuid)                          to authenticated, anon;$r$),
    ('MQ6', 'QF4', $r$  update public.volunteer_outbox
     set acknowledged_at = now()
   where season_id = p_season_id and status = 'failed' and acknowledged_at is null
     and id = any (coalesce(p_ids, '{}'::bigint[]));$r$,
                   $r$  update public.volunteer_outbox
     set acknowledged_at = now()
   where season_id = p_season_id and status = 'failed' and acknowledged_at is null;$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h128_case();
      raise exception 'H128CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H128CASE:%' then replace(sqlerrm, 'H128CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0128 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname in ('volunteer_outbox_hold', 'official_outbox_hold',
--      'volunteer_outbox_drop_started', 'volunteer_email_problems', 'official_email_problems',
--      'volunteer_email_problems_ack', 'official_email_problems_ack')) as must_be_0_before_apply,
--   (select count(*) from information_schema.columns where column_name = 'acknowledged_at'
--      and table_name in ('volunteer_outbox', 'official_outbox', 'volunteer_trigger_failures')) as must_be_0_before_apply_cols,
--   (select count(*) from volunteers where email_lc = 'q128@zz128.test') as fixture_volunteer_must_be_0,
--   (select count(*) from umpires where name = 'Proof Umpire 128') as fixture_umpire_must_be_0,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-10 ~18:28 UTC, against production, rolled back, on Whit's go (sent
-- as one batch, the migration byte-exact; pre-check: no transaction open > 5 s,
-- both outboxes empty).
--   Run 1 — GREEN: baseline pass; the seven md5(prosrc) = `--md5`; MQ1–MQ6
--     KILLED at their own tag (MQ1 QF1, MQ2 QF2b, MQ3 QF2, MQ4 QF3, MQ5 P1,
--     MQ6 QF4).
--   Leak check: no 0128 functions or columns, no fixture volunteer or
--     umpire, the test org's two feature rows unchanged, no idle transaction.
-- Applied right after: catalog 20261110182927, the row's text = the file
--   (md5 3ff334cb…); every md5(prosrc) matched; one overload each, DEFINER,
--   search_path=public, pg_temp; EXECUTE exactly as stated per role.
