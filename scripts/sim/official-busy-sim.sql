-- Proof for 0129 (one rule for "is this official busy?"). Assembled by
-- official-busy-build.ts, which puts the LITERAL migration text where the
-- placeholder is. One transaction the final RAISE always rolls back; the
-- migration is applied in a rolled-back sub-run for the baseline and again for
-- every mutant. Fixtures in the "test" proof org (bbf9afe1…, Elite): a season,
-- division, teams, games and officials of its own — never Santa Rosa
-- American's data.
--
-- DIRECT WRITES (the app has no function that creates these, so the fixture
-- writes them; stated per the 2026-11-09 rule): the season, division, teams,
-- games in each status, officials and their assignments. Every call under
-- test goes through the 0129 functions, as the role the app uses.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/official-busy-build.ts
-- > proof.sql`, send it as ONE batch, read the raised message, then the leak
-- check at the bottom. `--md5` prints the md5(prosrc) the apply must match.
-- `regress0124` builds the 0124 proof's assertions against 0129.
--
-- LOCKS: 0129 itself takes none on any table. The fixture writes take ROW
-- EXCLUSIVE on leagues, divisions, teams, games, umpires and game_umpires for
-- the run (seconds; lock_timeout 3s) — other rows stay writable.
--
-- Fixture (now = the org's wall clock, day D = today + 5):
--   season S (+ S2, another season), division DV (90 min, 2 per game)
--   gT  D 10:00 scheduled — the game being checked
--   gC  D 10:30 cancelled · gP D 10:30 postponed · gS D 10:30 scheduled
--   gR  D+1 10:00 reschedule_pending · gD D+2 10:00 completed
--   gW  D-1 18:00 postponed (same Mon–Sun week as gT unless D is a Monday —
--       the fixture moves gW to D+1 then; the cap check reads the week)
--   officials: uC on gC only · uP on gP only · uS on gS only ·
--              uW (weekly limit 1) on gW only · uAll on gC, gP, gS, gR, gD ·
--              uO in S2
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   OB1  official_game_busy: cancelled and postponed not busy; scheduled,
--        reschedule_pending, pending_interleague, in_progress, completed, a
--        new status and null busy
--   OB1b official_bookings, as the owner: uAll's busy games are exactly gS,
--        gR and gD (not gC, not gP), with minutes and team names
--   OB2  an official of another season is not returned
--   OB3  official_slot_problem for gT: uC and uP free (a rained-out /
--        postponed overlap), uS 'time_conflict', uW free (a postponed game
--        doesn't count toward the weekly limit)
--   OB4  a non-member is refused (not_authorized)
--   P1   EXECUTE: official_bookings authenticated only; the rule and
--        official_slot_problem callable by no role
-- Mutants (each must die at its own tag):
--   MB1 the rule counts cancelled                                  → OB1
--   MB2 the rule becomes an allowlist that forgets reschedule_pending → OB1
--   MB3 official_slot_problem keeps its own `<> 'cancelled'`       → OB3
--   MB4 official_bookings returns games of every status            → OB1b
--   MB5 official_bookings drops the owner/admin check              → OB4
--   MB6 official_bookings granted to anon                          → P1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h129_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

create or replace function pg_temp.h129_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_other uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';  -- a real profile, not a member of "test"
  v_now   timestamp;
  v_d     date;
  v_wday  date;
  vS uuid := gen_random_uuid(); vS2 uuid := gen_random_uuid();
  dv uuid := gen_random_uuid(); dv2 uuid := gen_random_uuid();
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid(); tX uuid := gen_random_uuid(); tY uuid := gen_random_uuid();
  gT uuid := gen_random_uuid(); gC uuid := gen_random_uuid(); gP uuid := gen_random_uuid(); gS uuid := gen_random_uuid();
  gR uuid := gen_random_uuid(); gD uuid := gen_random_uuid(); gW uuid := gen_random_uuid(); gO uuid := gen_random_uuid();
  uC uuid := gen_random_uuid(); uP uuid := gen_random_uuid(); uS uuid := gen_random_uuid(); uW uuid := gen_random_uuid();
  uAll uuid := gen_random_uuid(); uO uuid := gen_random_uuid();
  v_r text;
  v_j jsonb;
  r record;
begin
  -- ── OB1 — the rule ──────────────────────────────────────────────────────
  for r in
    select * from (values
      ('cancelled', false), ('postponed', false), ('scheduled', true), ('reschedule_pending', true),
      ('pending_interleague', true), ('in_progress', true), ('completed', true), ('zz_new_status', true), (null, true)
    ) as x(status, busy)
  loop
    if public.official_game_busy(r.status) is distinct from r.busy then
      return format('OB1 %s: want busy=%s, got %s', coalesce(r.status, 'null'), r.busy, public.official_game_busy(r.status));
    end if;
  end loop;

  -- ── Fixture ─────────────────────────────────────────────────────────────
  v_now := public.official_org_now(v_org);
  v_d := v_now::date + 5;
  v_wday := case when extract(isodow from v_d) = 1 then v_d + 1 else v_d - 1 end;
  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (vS,  'ZZ129 Season', 'Baseball', 'Fall', v_org, v_now::date - 20, v_now::date + 30),
    (vS2, 'ZZ129 Other',  'Baseball', 'Fall', v_org, v_now::date - 20, v_now::date + 30);
  insert into public.divisions (id, league_id, name, settings, umpires_per_game) values
    (dv, vS, 'ZZ129 Majors', '{"game_duration": 90}', 2),
    (dv2, vS2, 'ZZ129 Other', '{"game_duration": 90}', 1);
  insert into public.teams (id, league_id, division_id, name) values
    (tA, vS, dv, 'ZZ129 Expos'), (tB, vS, dv, 'ZZ129 Mets'), (tX, vS2, dv2, 'ZZ129 X'), (tY, vS2, dv2, 'ZZ129 Y');
  insert into public.games (id, league_id, home_team_id, away_team_id, scheduled_at, status) values
    (gT, vS, tA, tB, (v_d + time '10:00') at time zone 'UTC', 'scheduled'),
    (gC, vS, tB, tA, (v_d + time '10:30') at time zone 'UTC', 'cancelled'),
    (gP, vS, tB, tA, (v_d + time '10:30') at time zone 'UTC', 'postponed'),
    (gS, vS, tB, tA, (v_d + time '10:30') at time zone 'UTC', 'scheduled'),
    (gR, vS, tA, tB, ((v_d + 1) + time '10:00') at time zone 'UTC', 'reschedule_pending'),
    (gD, vS, tA, tB, ((v_d + 2) + time '10:00') at time zone 'UTC', 'completed'),
    (gW, vS, tA, tB, (v_wday + time '18:00') at time zone 'UTC', 'postponed'),
    (gO, vS2, tX, tY, (v_d + time '10:30') at time zone 'UTC', 'scheduled');
  insert into public.umpires (id, season_id, name, designation, max_games_per_week) values
    (uC, vS, 'ZZ129 Cal', 'adult', null), (uP, vS, 'ZZ129 Pat', 'adult', null), (uS, vS, 'ZZ129 Sam', 'adult', null),
    (uW, vS, 'ZZ129 Wes', 'adult', 1), (uAll, vS, 'ZZ129 All', 'adult', null), (uO, vS2, 'ZZ129 Other', 'adult', null);
  insert into public.game_umpires (game_id, umpire_id, role) values
    (gC, uC, 'ZZ Plate'), (gP, uP, 'ZZ Plate'), (gS, uS, 'ZZ Plate'), (gW, uW, 'ZZ Plate'),
    (gC, uAll, 'ZZ Base'), (gP, uAll, 'ZZ Base'), (gS, uAll, 'ZZ Base'), (gR, uAll, 'ZZ Base'), (gD, uAll, 'ZZ Base'),
    (gO, uO, 'ZZ Plate');

  -- ── OB1b — official_bookings, as the owner ──────────────────────────────
  v_r := pg_temp.h129_as(v_org, 'authenticated', format('select public.official_bookings(%L, array[%L]::uuid[])::text', vS, uAll));
  if v_r like 'ERR%' then return 'OB1b bookings read: ' || v_r; end if;
  v_j := v_r::jsonb;
  if (select array_agg(e ->> 'game_id' order by e ->> 'game_id') from jsonb_array_elements(v_j) e)
       is distinct from (select array_agg(x::text order by x::text) from unnest(array[gS, gR, gD]) x) then
    return 'OB1b uAll''s busy games must be exactly gS, gR, gD: ' || left(v_r, 300);
  end if;
  if not exists (select 1 from jsonb_array_elements(v_j) e
                  where e ->> 'game_id' = gS::text and (e ->> 'minutes')::int = 90
                    and e ->> 'home' = 'ZZ129 Mets' and e ->> 'away' = 'ZZ129 Expos'
                    and e ->> 'scheduled_at' = to_char(v_d + time '10:30', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00') then
    return 'OB1b a booking''s fields: ' || left(v_r, 300);
  end if;

  -- ── OB2 — another season's official is not returned ─────────────────────
  v_r := pg_temp.h129_as(v_org, 'authenticated', format('select public.official_bookings(%L, array[%L]::uuid[])::text', vS, uO));
  if v_r is distinct from '[]' then return 'OB2 another season''s official: ' || left(v_r, 200); end if;

  -- ── OB3 — official_slot_problem uses the rule ───────────────────────────
  for r in
    select * from (values (uC, null::text, 'rained-out overlap'), (uP, null, 'postponed overlap'),
                          (uS, 'time_conflict', 'scheduled overlap'), (uW, null, 'postponed game in the week, limit 1'))
      as x(ump, want, what)
  loop
    v_r := public.official_slot_problem(r.ump, gT, 'ZZ Plate', false);
    if v_r is distinct from r.want then
      return format('OB3 %s: want %s, got %s', r.what, coalesce(r.want, 'null'), coalesce(v_r, 'null'));
    end if;
  end loop;

  -- ── OB4 — a non-member is refused ───────────────────────────────────────
  v_r := pg_temp.h129_as(v_other, 'authenticated', format('select public.official_bookings(%L, array[%L]::uuid[])::text', vS, uAll));
  if v_r not like '%not_authorized%' then return 'OB4 a non-member: ' || left(v_r, 200); end if;

  -- ── P1 — privileges ─────────────────────────────────────────────────────
  if not has_function_privilege('authenticated', 'public.official_bookings(uuid, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.official_bookings(uuid, uuid[])', 'EXECUTE')
     or has_function_privilege('service_role', 'public.official_bookings(uuid, uuid[])', 'EXECUTE')
     or has_function_privilege('dashboard_readonly', 'public.official_bookings(uuid, uuid[])', 'EXECUTE') then
    return 'P1 official_bookings must be authenticated only';
  end if;
  foreach v_r in array array['public.official_game_busy(text)', 'public.official_slot_problem(uuid, uuid, text, boolean)'] loop
    if has_function_privilege('authenticated', v_r, 'EXECUTE') or has_function_privilege('anon', v_r, 'EXECUTE')
       or has_function_privilege('service_role', v_r, 'EXECUTE') or has_function_privilege('dashboard_readonly', v_r, 'EXECUTE') then
      return 'P1 ' || v_r || ' must be callable by no role';
    end if;
  end loop;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig129$
-- @@MIGRATION_0129@@
$mig129$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\n';
  m       record;
begin
  if strpos(v_body, '-- 5. Verify') = 0 then raise exception 'harness: verify marker not found in 0129'; end if;
  v_nover := split_part(v_body, '-- 5. Verify', 1);

  begin
    execute v_body;
    v_res := pg_temp.h129_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || (select string_agg(p.proname || '=' || md5(p.prosrc), E'\n' order by p.proname)
                         from pg_proc p where p.pronamespace = 'public'::regnamespace
                          and p.proname in ('official_game_busy', 'official_slot_problem', 'official_bookings')) || E'\n';
    raise exception 'H129ROLLBACK';
  exception when others then
    if sqlerrm <> 'H129ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MB1', 'OB1', $r$  select p_status is null or p_status not in ('cancelled', 'postponed');$r$,
                   $r$  select p_status is null or p_status not in ('postponed');$r$),
    ('MB2', 'OB1', $r$  select p_status is null or p_status not in ('cancelled', 'postponed');$r$,
                   $r$  select p_status is null or p_status in ('scheduled', 'pending_interleague', 'in_progress', 'completed');$r$),
    ('MB3', 'OB3', $r$and public.official_game_busy(g2.status)),$r$,
                   $r$and g2.status <> 'cancelled'),$r$),
    ('MB4', 'OB1b', $r$       and public.official_game_busy(g.status)
$r$, $r$$r$),
    ('MB5', 'OB4', $r$  if not exists (select 1 from public.organization_members m
                  where m.org_id = v_owner and m.user_id = auth.uid() and m.role in ('owner', 'admin')) then$r$,
                   $r$  if false then$r$),
    ('MB6', 'P1', $r$grant  execute on function public.official_bookings(uuid, uuid[])           to authenticated;$r$,
                  $r$grant  execute on function public.official_bookings(uuid, uuid[])           to authenticated, anon;$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h129_case();
      raise exception 'H129CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H129CASE:%' then replace(sqlerrm, 'H129CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0129 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname in ('official_game_busy', 'official_bookings')) as must_be_0_before_apply,
--   (select md5(prosrc) from pg_proc where proname = 'official_slot_problem') as must_be_0124_value,
--   (select count(*) from leagues where name like 'ZZ129%') as fixture_seasons_must_be_0,
--   (select count(*) from umpires where name like 'ZZ129%') as fixture_officials_must_be_0,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-10, against production, rolled back, on Whit's go ("rolled-back
-- proof in the test org"), sent as one batch, the migration byte-exact;
-- pre-check: live official_slot_problem md5 e1e756e3… = `--md5`'s method
-- check, no transaction open > 5 s.
--   Run 1 — GREEN: baseline pass; md5(prosrc) official_bookings 1d253cb4…,
--     official_game_busy 2d31e2e3…, official_slot_problem 9d93f78e… =
--     `--md5`; MB1–MB6 KILLED at their own tag (MB1 OB1, MB2 OB1, MB3 OB3,
--     MB4 OB1b, MB5 OB4, MB6 P1).
--   regress0124 (the 0124 proof's assertions against 0129) — GREEN: baseline
--     pass; MO5 (re-aimed at 0129's official_slot_problem) KILLED at OC1.
--   Leak check after each: no 0129 functions, official_slot_problem still
--     0124's e1e756e3…, no ZZ12x seasons or officials, the test org still
--     Elite, officials queue empty, no idle transaction.
-- APPLIED 2026-11-10 22:44 UTC on Whit's go, catalog 20261110224402
--   (catalog row's text = the file, md5 2379c0bd…). Live md5(prosrc) =
--   `--md5` for all three, one overload each; EXECUTE official_bookings
--   authenticated only, the other two no role; leak check clean.
