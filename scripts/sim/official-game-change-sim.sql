-- Proof for 0130 (officials emailed when their games change). Assembled by
-- official-game-change-build.ts, which puts the LITERAL migration text where
-- the placeholder is. One transaction the final RAISE always rolls back; the
-- migration is applied in a rolled-back sub-run for the baseline and again for
-- every mutant. Fixtures in the "test" proof org (bbf9afe1…, Elite, Los
-- Angeles): a season, divisions, teams, fields, games and officials of its
-- own — never Santa Rosa American's or SRALL's data. The SRALL owner
-- (aa21d01c…) appears only as a non-member caller id; nothing of theirs is
-- written.
--
-- SETTINGS GO THROUGH THE APP'S OWN FUNCTIONS, in screen order (the 0124/0125
-- lesson): the officials contact is saved and confirmed with
-- contact_verify_begin (as the signed-in owner) → contact_verify_take →
-- contact_verify_confirm (as the send route and the confirm page do), the
-- notify switch with set_official_notify_game_changes, the contact removed
-- with contact_email_remove.
--
-- DIRECT WRITES (no app function exists for these; stated per the 2026-11-09
-- rule): the season, divisions, teams, fields, games, officials, their
-- assignments (the slot UI inserts game_umpires directly too), an
-- interleague partner and a host reschedule request (GC7), a division's
-- locked/posted flags (the panel writes them directly), the org's plan and
-- the org_features row (GC5 — Stripe and the SQL editor own those), and the
-- harness's own bookkeeping: making queued rows due now, and a test trigger
-- on official_outbox that raises on demand (GC8, GC14). Games are moved,
-- rained out and deleted by plain UPDATE/DELETE as the signed-in owner —
-- games have no function; that is the browser's real write.
--
-- HOW TO RUN (only on Whit's go): `npx tsx scripts/sim/official-game-change-build.ts
-- > proof.sql`, send it as ONE batch, read the raised message, then the leak
-- check at the bottom. `--md5` prints the md5(prosrc) the apply must match.
-- `regress0124` / `regress0106` build those proofs' assertions against 0130.
--
-- LOCKS (for the run; lock_timeout 3s): what 0130 itself takes — SHARE ROW
-- EXCLUSIVE on games (the two CREATE TRIGGERs; game WRITES wait, reads don't),
-- ACCESS EXCLUSIVE on official_outbox and official_signup_settings — plus
-- SHARE ROW EXCLUSIVE on official_outbox for the test trigger, row locks on
-- the fixture rows and the test org's profiles row, and FOR UPDATE SKIP
-- LOCKED on any due officials outbox row the take reaches (rolled back).
--
-- Fixture (now = the org's wall clock; D = today + 5):
--   season vS; division dv (90 min, 2 per game); dvL (LOCKED + posted, GC11)
--   fields f1, f2 (test org); officials u1…u19 (each named per assertion)
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   GC1  a field move (u1/g1), a rainout (u2/g2), a makeup (u3/g3) and a
--        back-on (u4/g4) each queue exactly one game_changes row per
--        official, held 10 minutes; at take each says the right was→now
--   KY1  the exact key set of a taken row and of its entries — no other
--        official's name, no notes
--   GC2  a bulk rainout of 3 games (one UPDATE) is ONE row for u5 with 3
--        entries
--   GC3  move and move back (u6) → superseded no_net_change at take
--   GC4  both times past (u7) → nothing queued
--   GC4b a game moved from ahead into the past (u20) is queued, then dropped
--        at take ("past" is judged at send time) → superseded no_net_change
--   GC6  an official with no email (u8) → failed no_email, and
--        official_email_problems lists it
--   GC7  a partner league's token accept (anon) moves the game → u9 queued
--   GC8  a failure inside the change trigger doesn't block the UPDATE and
--        records one official_trigger_failures row
--   GC9  no assignment_conflicts row exists after GC1–GC8 (none had a
--        problem); then a move into an overlap (u10) queues exactly that
--        entry; moving it back → superseded no_conflicts at take
--   GC10 that overlap move left game_umpires byte-identical (nothing
--        unassigned)
--   GC11 a LOCKED, posted division: the move is still allowed, posted still
--        clears, and the official is still queued (u11)
--   GC12 record_game_played (a correction for later today) queues nothing
--        for its official (u12) …
--   GC12b … and in the SAME transaction an ordinary move right after it
--        does (u13)
--   GC13 deleting upcoming assigned games queues one row for u14 with two
--        "removed" entries; a past assigned game (u15) queues nothing; a
--        move then a delete (u16) reads as one "removed"
--   GC14 a failure inside the delete trigger aborts the delete
--   GC15b a rainout runs no re-check: u19 (an existing overlap) gets no
--        conflict entry and the rained-out entry carries no problem
--   GC15 u18 on A, A rained out (email sent), u18 put on overlapping B, A's
--        rainout removed → one conflict entry naming u18 on A; u18's row says
--        back on (was rained out, same start) with problem time_conflict;
--        game_umpires unchanged
--   SK1  only record_game_played and official_on_game_change name the skip
--        setting, and no function callable by anon, authenticated or
--        service_role calls set_config with a non-literal name
--   P1   EXECUTE per role
--   GC5  each gate off → nothing queued: not Elite, the feature off, the
--        league's notify switch off, no confirmed contact (last: it can't be
--        re-confirmed within the minute)
-- Mutants (each must die at its own tag): see the driver below.
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '120s', true);

create or replace function pg_temp.h130_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', case when p_sub is null then json_build_object('role', p_role)
                                                else json_build_object('sub', p_sub, 'role', p_role) end::text, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_out, 'NULL');
end;
$f$;

-- Rows queued for one official (pending game_changes).
create or replace function pg_temp.h130_q(p_ump uuid) returns integer language sql as $f$
  select count(*)::int from public.official_outbox o
   where o.umpire_id = p_ump and o.kind = 'game_changes' and o.status = 'pending';
$f$;

-- Make the season's pending rows due, take, and return only this season's
-- taken rows (the take serves every org; the run rolls back).
create or replace function pg_temp.h130_take(p_season uuid) returns jsonb language plpgsql as $f$
declare v_ids bigint[]; v_r text;
begin
  update public.official_outbox set next_attempt_at = now() - interval '1 second'
   where season_id = p_season and status = 'pending';
  select coalesce(array_agg(id), '{}') into v_ids from public.official_outbox where season_id = p_season and status = 'pending';
  v_r := pg_temp.h130_as(null, 'service_role', 'select public.official_outbox_take(100)::text');
  if v_r like 'ERR%' then raise exception 'h130_take: %', v_r; end if;
  return (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_r::jsonb) e
           where (e ->> 'id')::bigint = any (v_ids));
end;
$f$;

-- The test trigger's switch (GC8, GC14): raises on an outbox insert for the
-- fixture season while zz130.boom = 'on'.
create or replace function public.zz130_boom() returns trigger language plpgsql as $f$
begin
  if current_setting('zz130.boom', true) = 'on' then
    raise exception 'zz130 boom' using errcode = 'P0001';
  end if;
  return new;
end;
$f$;

create or replace function pg_temp.h130_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';
  v_other uuid := 'aa21d01c-66dc-4c37-b15c-7b743c557eea';  -- a real profile, not a member of "test"
  v_now   timestamp;
  v_d     date;
  vS uuid := gen_random_uuid();
  dv uuid := gen_random_uuid(); dvL uuid := gen_random_uuid();
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid(); tL uuid := gen_random_uuid(); tM uuid := gen_random_uuid();
  f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid(); io uuid := gen_random_uuid();
  g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); g3 uuid := gen_random_uuid(); g4 uuid := gen_random_uuid();
  h1 uuid := gen_random_uuid(); h2 uuid := gen_random_uuid(); h3 uuid := gen_random_uuid();
  g6 uuid := gen_random_uuid(); g7 uuid := gen_random_uuid(); g8 uuid := gen_random_uuid(); gI uuid := gen_random_uuid();
  gF uuid := gen_random_uuid(); gA uuid := gen_random_uuid(); gB uuid := gen_random_uuid(); gL uuid := gen_random_uuid();
  gR uuid := gen_random_uuid(); gR2 uuid := gen_random_uuid();
  gX1 uuid := gen_random_uuid(); gX2 uuid := gen_random_uuid(); gXp uuid := gen_random_uuid(); gX3 uuid := gen_random_uuid();
  gY uuid := gen_random_uuid(); gA2 uuid := gen_random_uuid(); gB2 uuid := gen_random_uuid();
  gC1 uuid := gen_random_uuid(); gC2 uuid := gen_random_uuid(); gG uuid := gen_random_uuid(); g20 uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid();
  u5 uuid := gen_random_uuid(); u6 uuid := gen_random_uuid(); u7 uuid := gen_random_uuid(); u8 uuid := gen_random_uuid();
  u9 uuid := gen_random_uuid(); uF uuid := gen_random_uuid(); u10 uuid := gen_random_uuid(); u11 uuid := gen_random_uuid();
  u12 uuid := gen_random_uuid(); u13 uuid := gen_random_uuid(); u14 uuid := gen_random_uuid(); u15 uuid := gen_random_uuid();
  u16 uuid := gen_random_uuid(); u17 uuid := gen_random_uuid(); u18 uuid := gen_random_uuid(); u19 uuid := gen_random_uuid();
  uG uuid := gen_random_uuid(); u20 uuid := gen_random_uuid();
  v_tok   text;
  v_r     text;
  v_j     jsonb;
  v_e     jsonb;
  v_n     integer;
  v_fp    text;
  v_fp2   text;
  v_gu    uuid;
  v_t     timestamp;
  r       record;
  begin_sql text := 'select public.contact_verify_begin(%L, %L, %L)::text';
begin
  v_now := public.official_org_now(v_org);
  v_d := v_now::date + 5;

  -- ── Settings, through the app's functions ───────────────────────────────
  v_r := pg_temp.h130_as(v_org, 'authenticated', format(begin_sql, v_org, 'official_signup', 'zz130-contact@zz130.test'));
  if v_r like 'ERR%' then return 'SETUP contact begin: ' || v_r; end if;
  v_r := pg_temp.h130_as(null, 'service_role', format('select public.contact_verify_take(%L, %L)::text', v_org, 'official_signup'));
  v_tok := (v_r::jsonb) ->> 'token';
  if v_tok is null then return 'SETUP contact take: ' || v_r; end if;
  v_r := pg_temp.h130_as(null, 'service_role', format('select public.contact_verify_confirm(%L)::text', v_tok));
  if v_r like 'ERR%' or not exists (select 1 from public.official_signup_settings s
                                     where s.owner_id = v_org and s.contact_email = 'zz130-contact@zz130.test') then
    return 'SETUP contact confirm: ' || v_r;
  end if;
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('select public.set_official_notify_game_changes(%L, true)::text', v_org));
  if v_r like 'ERR%' then return 'SETUP notify on: ' || v_r; end if;
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('select public.official_notice_state(%L)::text', v_org));
  if (v_r::jsonb) ->> 'on' is distinct from 'true' then return 'SETUP notice state: ' || v_r; end if;

  -- ── Fixture ─────────────────────────────────────────────────────────────
  insert into public.leagues (id, name, sport, season, owner_id, start_date, end_date) values
    (vS, 'ZZ130 Season', 'Baseball', 'Fall', v_org, v_now::date - 20, v_now::date + 40);
  insert into public.divisions (id, league_id, name, settings, umpires_per_game) values
    (dv, vS, 'ZZ130 Majors', '{"game_duration": 90}', 2),
    (dvL, vS, 'ZZ130 Locked', '{"game_duration": 90}', 2);
  insert into public.teams (id, league_id, division_id, name) values
    (tA, vS, dv, 'ZZ130 Expos'), (tB, vS, dv, 'ZZ130 Mets'), (tL, vS, dvL, 'ZZ130 Cubs'), (tM, vS, dvL, 'ZZ130 Reds');
  insert into public.venues (id, owner_id, name) values (f1, v_org, 'ZZ130 Field 1'), (f2, v_org, 'ZZ130 Field 2');
  insert into public.interleague_orgs (id, owner_id, name, admin_email) values (io, v_org, 'ZZ130 Partner', 'zz130-partner@zz130.test');
  insert into public.games (id, league_id, home_team_id, away_team_id, venue_id, scheduled_at, status) values
    (g1, vS, tA, tB, f1, (v_d + time '10:00') at time zone 'UTC', 'scheduled'),
    (g2, vS, tA, tB, f1, ((v_d + 1) + time '10:00') at time zone 'UTC', 'scheduled'),
    (g3, vS, tA, tB, f1, ((v_d + 2) + time '10:00') at time zone 'UTC', 'cancelled'),
    (g4, vS, tA, tB, f1, ((v_d + 3) + time '10:00') at time zone 'UTC', 'cancelled'),
    (h1, vS, tA, tB, f1, ((v_d + 4) + time '09:00') at time zone 'UTC', 'scheduled'),
    (h2, vS, tA, tB, f1, ((v_d + 4) + time '12:00') at time zone 'UTC', 'scheduled'),
    (h3, vS, tA, tB, f1, ((v_d + 4) + time '15:00') at time zone 'UTC', 'scheduled'),
    (g6, vS, tA, tB, f1, ((v_d + 5) + time '15:00') at time zone 'UTC', 'scheduled'),
    (g7, vS, tA, tB, f1, ((v_now::date - 3) + time '10:00') at time zone 'UTC', 'scheduled'),
    (g8, vS, tA, tB, f1, ((v_d + 6) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gF, vS, tA, tB, f1, ((v_d + 7) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gA, vS, tA, tB, f1, ((v_d + 9) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gB, vS, tA, tB, f2, ((v_d + 9) + time '14:00') at time zone 'UTC', 'scheduled'),
    (gL, vS, tL, tM, f1, ((v_d + 10) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gR, vS, tA, tB, f1, ((v_d + 11) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gR2, vS, tA, tB, f1, ((v_d + 11) + time '14:00') at time zone 'UTC', 'scheduled'),
    (gX1, vS, tA, tB, f1, ((v_d + 12) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gX2, vS, tA, tB, f1, ((v_d + 12) + time '14:00') at time zone 'UTC', 'scheduled'),
    (gXp, vS, tA, tB, f1, ((v_now::date - 2) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gX3, vS, tA, tB, f1, ((v_d + 13) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gY, vS, tA, tB, f1, ((v_d + 14) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gA2, vS, tA, tB, f1, ((v_d + 15) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gB2, vS, tA, tB, f2, ((v_d + 15) + time '10:30') at time zone 'UTC', 'scheduled'),
    (gC1, vS, tA, tB, f1, ((v_d + 16) + time '10:00') at time zone 'UTC', 'scheduled'),
    (gC2, vS, tA, tB, f2, ((v_d + 16) + time '10:30') at time zone 'UTC', 'scheduled'),
    (gG, vS, tA, tB, f1, ((v_d + 17) + time '10:00') at time zone 'UTC', 'scheduled'),
    (g20, vS, tA, tB, f1, ((v_d + 18) + time '10:00') at time zone 'UTC', 'scheduled');
  insert into public.games (id, league_id, home_team_id, away_team_id, venue_id, scheduled_at, status,
                            interleague_org_id, is_away, external_team_name) values
    (gI, vS, tA, null, f1, ((v_d + 8) + time '10:00') at time zone 'UTC', 'reschedule_pending', io, false, 'ZZ130 Partner Owls');
  insert into public.umpires (id, season_id, name, designation, email) values
    (u1, vS, 'ZZ130 One', 'adult', 'zz130-1@zz130.test'), (u2, vS, 'ZZ130 Two', 'adult', 'zz130-2@zz130.test'),
    (u3, vS, 'ZZ130 Three', 'adult', 'zz130-3@zz130.test'), (u4, vS, 'ZZ130 Four', 'youth', 'zz130-4@zz130.test'),
    (u5, vS, 'ZZ130 Five', 'adult', 'zz130-5@zz130.test'), (u6, vS, 'ZZ130 Six', 'adult', 'zz130-6@zz130.test'),
    (u7, vS, 'ZZ130 Seven', 'adult', 'zz130-7@zz130.test'), (u8, vS, 'ZZ130 Eight', 'adult', '  '),
    (u9, vS, 'ZZ130 Nine', 'adult', 'zz130-9@zz130.test'), (uF, vS, 'ZZ130 Eff', 'adult', 'zz130-f@zz130.test'),
    (u10, vS, 'ZZ130 Ten', 'adult', 'zz130-10@zz130.test'), (u11, vS, 'ZZ130 Eleven', 'adult', 'zz130-11@zz130.test'),
    (u12, vS, 'ZZ130 Twelve', 'adult', 'zz130-12@zz130.test'), (u13, vS, 'ZZ130 Thirteen', 'adult', 'zz130-13@zz130.test'),
    (u14, vS, 'ZZ130 Fourteen', 'adult', 'zz130-14@zz130.test'), (u15, vS, 'ZZ130 Fifteen', 'adult', 'zz130-15@zz130.test'),
    (u16, vS, 'ZZ130 Sixteen', 'adult', 'zz130-16@zz130.test'), (u17, vS, 'ZZ130 Seventeen', 'adult', 'zz130-17@zz130.test'),
    (u18, vS, 'ZZ130 Eighteen', 'adult', 'zz130-18@zz130.test'), (u19, vS, 'ZZ130 Nineteen', 'adult', 'zz130-19@zz130.test'),
    (uG, vS, 'ZZ130 Gate', 'adult', 'zz130-g@zz130.test'), (u20, vS, 'ZZ130 Twenty', 'adult', 'zz130-20@zz130.test');
  insert into public.game_umpires (game_id, umpire_id, role) values
    (g1, u1, 'ZZ Plate'), (g2, u2, 'ZZ Plate'), (g3, u3, 'ZZ Plate'), (g4, u4, 'ZZ Plate'),
    (h1, u5, 'ZZ Plate'), (h2, u5, 'ZZ Plate'), (h3, u5, 'ZZ Plate'),
    (g6, u6, 'ZZ Plate'), (g7, u7, 'ZZ Plate'), (g8, u8, 'ZZ Plate'), (gI, u9, 'ZZ Plate'), (gF, uF, 'ZZ Plate'),
    (gA, u10, 'ZZ Plate'), (gB, u10, 'ZZ Plate'), (gL, u11, 'ZZ Plate'), (gR, u12, 'ZZ Plate'), (gR2, u13, 'ZZ Plate'),
    (gX1, u14, 'ZZ Plate'), (gX2, u14, 'ZZ Plate'), (gXp, u15, 'ZZ Plate'), (gX3, u16, 'ZZ Plate'),
    (gY, u17, 'ZZ Plate'), (gA2, u18, 'ZZ Plate'),
    (gC1, u19, 'ZZ Plate'), (gC2, u19, 'ZZ Plate'), (gG, uG, 'ZZ Plate'), (g20, u20, 'ZZ Plate');
  insert into public.interleague_reschedule_requests (game_id, token, requested_by_user_id, proposed_scheduled_at, status)
  values (gI, 'zz130-token-' || gI::text, v_org, ((v_d + 8) + time '13:00') at time zone 'UTC', 'pending');
  update public.divisions set locked = true, posted = true, posted_at = now() where id = dvL;
  create trigger zz130_boom before insert on public.official_outbox
    for each row execute function public.zz130_boom();

  if exists (select 1 from public.official_outbox where season_id = vS) then
    return 'SETUP inserting the fixture queued something';
  end if;

  -- ── GC1 — move (field), rainout, makeup, back on ────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set venue_id = %L where id = %L returning 1', f2, g1));
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set status = %L where id = %L returning 1', 'cancelled', g2));
  perform pg_temp.h130_as(v_org, 'authenticated', format(
    'update public.games set status = %L, scheduled_at = %L where id = %L returning 1',
    'scheduled', ((v_d + 2) + time '16:00') at time zone 'UTC', g3));
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set status = %L where id = %L returning 1', 'scheduled', g4));
  foreach v_gu in array array[u1, u2, u3, u4] loop
    if pg_temp.h130_q(v_gu) <> 1 then
      return format('GC1 official %s: want exactly 1 queued row, got %s', (select name from public.umpires where id = v_gu), pg_temp.h130_q(v_gu));
    end if;
  end loop;
  if exists (select 1 from public.official_outbox o where o.season_id = vS and o.kind = 'game_changes'
              and (o.next_attempt_at < now() + interval '9 minutes' or o.next_attempt_at > now() + interval '11 minutes')) then
    return 'GC1 rows must be held about 10 minutes';
  end if;
  v_j := pg_temp.h130_take(vS);
  if jsonb_array_length(v_j) <> 4 then return 'GC1 take: want 4 rows, got ' || jsonb_array_length(v_j); end if;
  for r in select * from (values
      (u1, false, false, to_char(v_d + time '10:00', 'YYYY-MM-DD"T"HH24:MI'), 'ZZ130 Field 1', 'ZZ130 Field 2'),
      (u2, false, true,  to_char((v_d + 1) + time '10:00', 'YYYY-MM-DD"T"HH24:MI'), 'ZZ130 Field 1', 'ZZ130 Field 1'),
      (u3, true,  false, to_char((v_d + 2) + time '10:00', 'YYYY-MM-DD"T"HH24:MI'), 'ZZ130 Field 1', 'ZZ130 Field 1'),
      (u4, true,  false, to_char((v_d + 3) + time '10:00', 'YYYY-MM-DD"T"HH24:MI'), 'ZZ130 Field 1', 'ZZ130 Field 1'))
    as x(ump, was_cx, now_cx, was_start, was_field, now_field)
  loop
    v_e := (select e from jsonb_array_elements(v_j) e
             where e ->> 'official_name' = (select name from public.umpires where id = r.ump));
    if v_e is null or v_e ->> 'kind' <> 'game_changes' or jsonb_array_length(v_e -> 'changes') <> 1 then
      return format('GC1 %s taken row: %s', r.ump, left(coalesce(v_e::text, 'missing'), 300));
    end if;
    v_e := v_e -> 'changes' -> 0;
    if v_e ->> 'change' <> 'changed' or (v_e ->> 'cancelled')::boolean <> r.now_cx
       or (v_e -> 'was' ->> 'cancelled')::boolean <> r.was_cx or v_e -> 'was' ->> 'start' <> r.was_start
       or v_e -> 'was' ->> 'field' <> r.was_field or v_e ->> 'field' <> r.now_field
       or v_e ->> 'problem' is not null or v_e ->> 'home' <> 'ZZ130 Expos' or v_e ->> 'away' <> 'ZZ130 Mets'
       or v_e ->> 'division' <> 'ZZ130 Majors' or v_e ->> 'role' <> 'ZZ Plate' then
      return format('GC1 %s entry: %s', r.ump, left(v_e::text, 400));
    end if;
  end loop;
  if (select e ->> 'to' from jsonb_array_elements(v_j) e where e ->> 'official_name' = 'ZZ130 One') <> 'zz130-1@zz130.test'
     or (select (e ->> 'youth')::boolean from jsonb_array_elements(v_j) e where e ->> 'official_name' = 'ZZ130 Four') is not true
     or (select e ->> 'reply_to' from jsonb_array_elements(v_j) e where e ->> 'official_name' = 'ZZ130 One') <> 'zz130-contact@zz130.test' then
    return 'GC1 recipient / youth / reply-to';
  end if;

  -- ── KY1 — exact key sets ────────────────────────────────────────────────
  v_e := v_j -> 0;
  if (select array_agg(k order by k) from jsonb_object_keys(v_e) k) is distinct from
     array['attempts', 'changes', 'claims', 'conflicts', 'game', 'id', 'kind', 'league_name', 'link_token', 'official_name',
           'payload', 'reply_to', 'season_name', 'spots', 'to', 'youth'] then
    return 'KY1 row keys: ' || (select string_agg(k, ',' order by k) from jsonb_object_keys(v_e) k);
  end if;
  for v_e in select c from jsonb_array_elements(v_j) e, jsonb_array_elements(e -> 'changes') c loop
    if (select array_agg(k order by k) from jsonb_object_keys(v_e) k) is distinct from
       array['away', 'cancelled', 'change', 'division', 'field', 'game_id', 'game_umpire_id', 'home', 'minutes', 'problem', 'role', 'start', 'was']
       or (select array_agg(k order by k) from jsonb_object_keys(v_e -> 'was') k) is distinct from array['cancelled', 'field', 'start'] then
      return 'KY1 entry keys: ' || left(v_e::text, 300);
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(v_j) e
              where (e -> 'payload') ?| array['email', 'to', 'name', 'official_name', 'contact_email', 'notes']) then
    return 'KY1 payload carries a name or an address';
  end if;

  -- ── GC2 — a bulk rainout is one row ─────────────────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format(
    'update public.games set status = %L where id in (%L, %L, %L) returning 1', 'cancelled', h1, h2, h3));
  if pg_temp.h130_q(u5) <> 1
     or (select count(*) from public.official_outbox o, jsonb_object_keys(o.payload -> 'changes') k
          where o.umpire_id = u5 and o.status = 'pending') <> 3 then
    return format('GC2 bulk rainout: %s rows, want 1 with 3 entries', pg_temp.h130_q(u5));
  end if;

  -- ── GC3 — move and move back ────────────────────────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 5) + time '17:00') at time zone 'UTC', g6));
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 5) + time '15:00') at time zone 'UTC', g6));
  if pg_temp.h130_q(u6) <> 1 then return 'GC3 queued rows: ' || pg_temp.h130_q(u6); end if;
  v_j := pg_temp.h130_take(vS);
  if exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'official_name' = 'ZZ130 Six')
     or not exists (select 1 from public.official_outbox o where o.umpire_id = u6 and o.status = 'superseded' and o.error = 'no_net_change') then
    return 'GC3 a move and a move back must be superseded no_net_change: ' || left(v_j::text, 300);
  end if;

  -- ── GC4 — both times past ───────────────────────────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_now::date - 2) + time '10:00') at time zone 'UTC', g7));
  if pg_temp.h130_q(u7) <> 0 then return 'GC4 a past game queued a row'; end if;

  -- ── GC4b — "past" is judged again at send time ──────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_now::date - 1) + time '10:00') at time zone 'UTC', g20));
  if pg_temp.h130_q(u20) <> 1 then return 'GC4b a game moved into the past is queued (its old time was ahead)'; end if;
  v_j := pg_temp.h130_take(vS);
  if exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'official_name' = 'ZZ130 Twenty')
     or not exists (select 1 from public.official_outbox o where o.umpire_id = u20 and o.status = 'superseded' and o.error = 'no_net_change') then
    return 'GC4b a game that has started by send time must be dropped: ' || left(v_j::text, 300);
  end if;

  -- ── GC6 — no email ──────────────────────────────────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 6) + time '12:00') at time zone 'UTC', g8));
  v_j := pg_temp.h130_take(vS);
  if not exists (select 1 from public.official_outbox o where o.umpire_id = u8 and o.status = 'failed' and o.error = 'no_email') then
    return 'GC6 no email must fail no_email';
  end if;
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('select public.official_email_problems(%L)::text', vS));
  if v_r like 'ERR%' or not exists (select 1 from jsonb_array_elements((v_r::jsonb) -> 'failed') f
                                     where f ->> 'official_name' = 'ZZ130 Eight' and f ->> 'error' = 'no_email'
                                       and f ->> 'kind' = 'game_changes') then
    return 'GC6 email problems: ' || left(v_r, 300);
  end if;

  -- ── GC7 — a partner league's token accept ───────────────────────────────
  v_r := pg_temp.h130_as(null, 'anon', format('select public.accept_reschedule_request_by_token(%L)::text', 'zz130-token-' || gI::text));
  if v_r like 'ERR%' then return 'GC7 token accept: ' || v_r; end if;
  if pg_temp.h130_q(u9) <> 1 then return 'GC7 the partner''s accept queued ' || pg_temp.h130_q(u9) || ' rows for the official'; end if;

  -- ── GC8 — a failure inside the change trigger ───────────────────────────
  v_n := (select count(*) from public.official_trigger_failures where season_id = vS);
  perform set_config('zz130.boom', 'on', true);
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 7) + time '12:00') at time zone 'UTC', gF));
  perform set_config('zz130.boom', '', true);
  if v_r like 'ERR%' or (select scheduled_at from public.games where id = gF) <> ((v_d + 7) + time '12:00') at time zone 'UTC' then
    return 'GC8 the UPDATE must go through: ' || v_r;
  end if;
  if (select count(*) from public.official_trigger_failures where season_id = vS and game_id = gF and trigger_name = 'game_change') <> v_n + 1 then
    return 'GC8 one failure row must be recorded';
  end if;

  -- ── GC9 (a) — nothing so far was a problem ──────────────────────────────
  if exists (select 1 from public.official_outbox o where o.season_id = vS and o.kind = 'assignment_conflicts') then
    return 'GC9 no move so far had a problem, yet a conflicts row exists: '
      || (select left(payload::text, 300) from public.official_outbox o where o.season_id = vS and o.kind = 'assignment_conflicts' limit 1);
  end if;

  -- ── GC10 + GC9 (b) — a move into an overlap ─────────────────────────────
  v_fp := (select md5(string_agg(to_jsonb(gu)::text, ',' order by gu.id)) from public.game_umpires gu
            join public.games g on g.id = gu.game_id where g.league_id = vS);
  v_fp2 := (select md5((to_jsonb(g) - 'scheduled_at' - 'updated_at')::text) from public.games g where g.id = gB);
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 9) + time '10:30') at time zone 'UTC', gB));
  if (select md5(string_agg(to_jsonb(gu)::text, ',' order by gu.id)) from public.game_umpires gu
       join public.games g on g.id = gu.game_id where g.league_id = vS) is distinct from v_fp
     or (select md5((to_jsonb(g) - 'scheduled_at' - 'updated_at')::text) from public.games g where g.id = gB) is distinct from v_fp2 then
    return 'GC10 a move into an overlap changed game_umpires or games beyond the edit';
  end if;
  v_gu := (select id from public.game_umpires where game_id = gB and umpire_id = u10);
  if (select array_agg(k) from public.official_outbox o, jsonb_object_keys(o.payload -> 'entries') k
       where o.season_id = vS and o.kind = 'assignment_conflicts' and o.status = 'pending') is distinct from array[v_gu::text] then
    return 'GC9 the overlap must queue exactly u10-on-gB';
  end if;
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 9) + time '14:00') at time zone 'UTC', gB));
  v_j := pg_temp.h130_take(vS);
  if not exists (select 1 from public.official_outbox o where o.season_id = vS and o.kind = 'assignment_conflicts'
                  and o.status = 'superseded' and o.error = 'no_conflicts')
     or exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'kind' = 'assignment_conflicts') then
    return 'GC9 moved back: the conflicts row must be superseded no_conflicts';
  end if;

  -- ── GC11 — a locked, posted division ────────────────────────────────────
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 10) + time '12:00') at time zone 'UTC', gL));
  if v_r like 'ERR%' then return 'GC11 a move on a locked division must be allowed: ' || v_r; end if;
  if (select posted from public.divisions where id = dvL) or not (select locked from public.divisions where id = dvL) then
    return 'GC11 posted must still clear and the lock stay';
  end if;
  if pg_temp.h130_q(u11) <> 1 then return 'GC11 the official must still be queued'; end if;

  -- ── GC12 / GC12b — a correction, then an ordinary move ──────────────────
  v_t := date_trunc('minute', v_now) + interval '2 minutes';
  if v_t::date <> v_now::date then
    return 'GC12 NOT EXERCISABLE within 2 minutes of the league''s midnight — run again';
  end if;
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('select public.record_game_played(%L, %L, %L, %L)::text',
    gR, to_char(v_t, 'YYYY-MM-DD"T"HH24:MI'), f1, 'zz130'));
  if v_r like 'ERR%' then return 'GC12 record_game_played: ' || v_r; end if;
  if pg_temp.h130_q(u12) <> 0 then return 'GC12 a correction queued an official email'; end if;
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 11) + time '16:00') at time zone 'UTC', gR2));
  if pg_temp.h130_q(u13) <> 1 then return 'GC12b an ordinary move after a correction, same transaction, must queue'; end if;

  -- ── GC13 — deletes: "taken off" ─────────────────────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 13) + time '12:00') at time zone 'UTC', gX3));
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('delete from public.games where id in (%L, %L, %L, %L) returning 1',
    gX1, gX2, gXp, gX3));
  if v_r like 'ERR%' then return 'GC13 delete: ' || v_r; end if;
  if pg_temp.h130_q(u15) <> 0 then return 'GC13 a past game''s official was queued'; end if;
  if pg_temp.h130_q(u14) <> 1 or pg_temp.h130_q(u16) <> 1 then
    return format('GC13 rows: u14 %s, u16 %s (want 1 each)', pg_temp.h130_q(u14), pg_temp.h130_q(u16));
  end if;
  v_j := pg_temp.h130_take(vS);
  v_e := (select e from jsonb_array_elements(v_j) e where e ->> 'official_name' = 'ZZ130 Fourteen');
  if v_e is null or jsonb_array_length(v_e -> 'changes') <> 2
     or exists (select 1 from jsonb_array_elements(v_e -> 'changes') c where c ->> 'change' <> 'removed')
     or (v_e -> 'changes' -> 0 ->> 'start') <> to_char((v_d + 12) + time '10:00', 'YYYY-MM-DD"T"HH24:MI')
     or (v_e -> 'changes' -> 0 ->> 'home') <> 'ZZ130 Expos' then
    return 'GC13 u14: ' || left(coalesce(v_e::text, 'missing'), 400);
  end if;
  v_e := (select e from jsonb_array_elements(v_j) e where e ->> 'official_name' = 'ZZ130 Sixteen');
  if v_e is null or jsonb_array_length(v_e -> 'changes') <> 1 or v_e -> 'changes' -> 0 ->> 'change' <> 'removed' then
    return 'GC13 u16 (move then delete) must read as one removal: ' || left(coalesce(v_e::text, 'missing'), 300);
  end if;
  for v_e in select c from jsonb_array_elements(v_j) e, jsonb_array_elements(e -> 'changes') c where c ->> 'change' = 'removed' loop
    if (select array_agg(k order by k) from jsonb_object_keys(v_e) k) is distinct from
       array['away', 'change', 'division', 'field', 'game_umpire_id', 'home', 'minutes', 'role', 'start'] then
      return 'KY1 removed-entry keys: ' || left(v_e::text, 300);
    end if;
  end loop;

  -- ── GC14 — a failure in the delete trigger aborts the delete ────────────
  perform set_config('zz130.boom', 'on', true);
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('delete from public.games where id = %L returning 1', gY));
  perform set_config('zz130.boom', '', true);
  if v_r not like 'ERR%' or not exists (select 1 from public.games where id = gY) then
    return 'GC14 the delete must fail when the notice can''t be queued: ' || v_r;
  end if;

  -- ── GC15b — a rainout runs no re-check ──────────────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set status = %L where id = %L returning 1', 'cancelled', gC1));
  v_gu := (select id from public.game_umpires where game_id = gC1 and umpire_id = u19);
  if exists (select 1 from public.official_outbox o where o.season_id = vS and o.kind = 'assignment_conflicts'
              and o.status = 'pending' and (o.payload -> 'entries') ? v_gu::text) then
    return 'GC15b a rained-out game got a conflict entry';
  end if;
  v_j := pg_temp.h130_take(vS);
  v_e := (select c from jsonb_array_elements(v_j) e, jsonb_array_elements(e -> 'changes') c
           where e ->> 'official_name' = 'ZZ130 Nineteen');
  if v_e is null or (v_e ->> 'cancelled')::boolean is not true or v_e ->> 'problem' is not null then
    return 'GC15b the rained-out entry must carry no problem: ' || left(coalesce(v_e::text, 'missing'), 300);
  end if;

  -- ── GC15 — rainout removed: the re-check ────────────────────────────────
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set status = %L where id = %L returning 1', 'cancelled', gA2));
  v_j := pg_temp.h130_take(vS);
  for r in select (e ->> 'id')::bigint as id from jsonb_array_elements(v_j) e loop
    perform pg_temp.h130_as(null, 'service_role', format('select public.official_outbox_finish(%s, true, %L, null, false)::text', r.id, 're_zz130'));
  end loop;
  insert into public.game_umpires (game_id, umpire_id, role) values (gB2, u18, 'ZZ Plate');
  v_fp := (select md5(string_agg(to_jsonb(gu)::text, ',' order by gu.id)) from public.game_umpires gu
            join public.games g on g.id = gu.game_id where g.league_id = vS);
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set status = %L where id = %L returning 1', 'scheduled', gA2));
  v_gu := (select id from public.game_umpires where game_id = gA2 and umpire_id = u18);
  if (select array_agg(k) from public.official_outbox o, jsonb_object_keys(o.payload -> 'entries') k
       where o.season_id = vS and o.kind = 'assignment_conflicts' and o.status = 'pending') is distinct from array[v_gu::text] then
    return 'GC15 removing the rainout must queue exactly u18-on-A for the coordinator: '
      || coalesce((select string_agg(payload::text, ' ') from public.official_outbox o where o.season_id = vS
                    and o.kind = 'assignment_conflicts' and o.status = 'pending'), 'none');
  end if;
  if (select md5(string_agg(to_jsonb(gu)::text, ',' order by gu.id)) from public.game_umpires gu
       join public.games g on g.id = gu.game_id where g.league_id = vS) is distinct from v_fp then
    return 'GC15 game_umpires changed';
  end if;
  v_j := pg_temp.h130_take(vS);
  v_e := (select c from jsonb_array_elements(v_j) e, jsonb_array_elements(e -> 'changes') c
           where e ->> 'official_name' = 'ZZ130 Eighteen');
  if v_e is null or (v_e ->> 'cancelled')::boolean or not (v_e -> 'was' ->> 'cancelled')::boolean
     or v_e ->> 'start' <> v_e -> 'was' ->> 'start' or v_e ->> 'problem' is distinct from 'time_conflict' then
    return 'GC15 u18''s back-on entry: ' || left(coalesce(v_e::text, 'missing'), 400);
  end if;
  v_e := (select e from jsonb_array_elements(v_j) e where e ->> 'kind' = 'assignment_conflicts');
  if v_e is null or v_e ->> 'to' <> 'zz130-contact@zz130.test' or jsonb_array_length(v_e -> 'conflicts') <> 1
     or v_e -> 'conflicts' -> 0 ->> 'official_name' <> 'ZZ130 Eighteen'
     or v_e -> 'conflicts' -> 0 ->> 'problem' <> 'time_conflict'
     or v_e -> 'conflicts' -> 0 -> 'other' ->> 'game_id' <> gB2::text then
    return 'GC15 the coordinator''s row: ' || left(coalesce(v_e::text, 'missing'), 400);
  end if;

  -- ── SK1 — the skip setting's fence ──────────────────────────────────────
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_temp%'
                and n.nspname not like 'pg_toast%'
                and p.prosrc like '%official_notice_skip%'
                and not (n.nspname = 'public' and p.proname in ('record_game_played', 'official_on_game_change'))) then
    return 'SK1 another function names official_notice_skip';
  end if;
  v_r := (select string_agg(n.nspname || '.' || p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_temp%'
             and n.nspname not like 'pg_toast%'
             and p.prolang in (select oid from pg_language where lanname in ('sql', 'plpgsql'))
             and p.prosrc ~* 'set_config\s*\(\s*[^''[:space:]]'
             and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  or has_function_privilege('service_role', p.oid, 'EXECUTE')));
  if v_r is not null then return 'SK1 callable functions set a non-literal setting: ' || v_r; end if;

  -- ── P1 — privileges ─────────────────────────────────────────────────────
  for r in select * from (values
      ('public.official_outbox_take(integer)', false, true),
      ('public.official_notice_state(uuid)', true, false),
      ('public.set_official_notify_game_changes(uuid, boolean)', true, false),
      ('public.official_email_problems(uuid)', true, false),
      ('public.official_email_problems_ack(uuid, bigint[])', true, false),
      ('public.record_game_played(uuid, text, uuid, text)', true, false),
      ('public.official_on_game_change()', false, false),
      ('public.official_on_game_delete()', false, false),
      ('public.official_move_problem(uuid, uuid)', false, false),
      ('public.official_change_entries(jsonb, uuid, uuid)', false, false),
      ('public.official_conflict_entries(jsonb, uuid)', false, false),
      ('public.official_notice_on(uuid)', false, false))
    as x(fn, authn, svc)
  loop
    if has_function_privilege('anon', r.fn, 'EXECUTE') or has_function_privilege('dashboard_readonly', r.fn, 'EXECUTE')
       or has_function_privilege('authenticated', r.fn, 'EXECUTE') <> r.authn
       or has_function_privilege('service_role', r.fn, 'EXECUTE') <> r.svc then
      return 'P1 ' || r.fn;
    end if;
  end loop;

  -- ── GC5 — each gate off → nothing queued (contact last) ─────────────────
  update public.profiles set plan = 'pro' where id = v_org;
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 17) + time '11:00') at time zone 'UTC', gG));
  update public.profiles set plan = 'elite' where id = v_org;
  if pg_temp.h130_q(uG) <> 0 then return 'GC5 not Elite: queued'; end if;
  update public.org_features set enabled = false where owner_id = v_org and feature = 'official_signup';
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 17) + time '12:00') at time zone 'UTC', gG));
  update public.org_features set enabled = true where owner_id = v_org and feature = 'official_signup';
  if pg_temp.h130_q(uG) <> 0 then return 'GC5 feature off: queued'; end if;
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('select public.set_official_notify_game_changes(%L, false)::text', v_org));
  if v_r like 'ERR%' then return 'GC5 notify off: ' || v_r; end if;
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 17) + time '13:00') at time zone 'UTC', gG));
  perform pg_temp.h130_as(v_org, 'authenticated', format('select public.set_official_notify_game_changes(%L, true)::text', v_org));
  if pg_temp.h130_q(uG) <> 0 then return 'GC5 notify off: queued'; end if;
  v_r := pg_temp.h130_as(v_org, 'authenticated', format('select public.contact_email_remove(%L, %L, %L)::text', v_org, 'official_signup', 'contact'));
  if v_r like 'ERR%' or exists (select 1 from public.official_signup_settings where owner_id = v_org and contact_email is not null) then
    return 'GC5 contact remove: ' || v_r;
  end if;
  perform pg_temp.h130_as(v_org, 'authenticated', format('update public.games set scheduled_at = %L where id = %L returning 1',
    ((v_d + 17) + time '14:00') at time zone 'UTC', gG));
  if pg_temp.h130_q(uG) <> 0 then return 'GC5 no contact: queued'; end if;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig130$
-- @@MIGRATION_0130@@
$mig130$;
  v_nover text;
  v_mtext text;
  v_res   text;
  v_mut   text;
  v_out   text := E'\n';
  m       record;
begin
  if strpos(v_body, '-- 10. Verify') = 0 then raise exception 'harness: verify marker not found in 0130'; end if;
  v_nover := split_part(v_body, '-- 10. Verify', 1);

  begin
    execute v_body;
    v_res := pg_temp.h130_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || (select string_agg(p.proname || '=' || md5(p.prosrc), E'\n' order by p.proname)
                         from pg_proc p where p.pronamespace = 'public'::regnamespace
                          and p.proname in ('official_notice_on', 'official_field_label', 'official_move_problem',
                                            'official_change_entries', 'official_conflict_entries', 'official_record_failure',
                                            'official_on_game_change', 'official_on_game_delete', 'record_game_played',
                                            'official_outbox_take', 'official_email_problems', 'official_email_problems_ack',
                                            'official_notice_state', 'set_official_notify_game_changes')) || E'\n';
    raise exception 'H130ROLLBACK';
  exception when others then
    if sqlerrm <> 'H130ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    -- @@MUTANTS@@
    ('', '', '', '', null::text, null::text)
    ) as t(id, expect, find, repl, find2, repl2)
    where t.id <> ''
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1
       or (m.find2 is not null and (length(v_nover) - length(replace(v_nover, m.find2, ''))) / greatest(length(m.find2), 1) <> 1) then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    v_mtext := replace(v_nover, m.find, m.repl);
    if m.find2 is not null then v_mtext := replace(v_mtext, m.find2, m.repl2); end if;
    begin
      execute v_mtext;
      v_res := pg_temp.h130_case();
      raise exception 'H130CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H130CASE:%' then replace(sqlerrm, 'H130CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0130 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_proc where proname in ('official_on_game_change', 'official_move_problem', 'zz130_boom')) as must_be_0_before_apply,
--   (select md5(prosrc) from pg_proc where proname = 'official_outbox_take') as must_be_0124_value,
--   (select md5(prosrc) from pg_proc where proname = 'record_game_played') as must_be_0106_value,
--   (select count(*) from pg_trigger where tgname in ('official_on_game_change', 'official_on_game_delete', 'zz130_boom')) as triggers_must_be_0,
--   (select count(*) from leagues where name like 'ZZ130%') as fixture_seasons_must_be_0,
--   (select count(*) from umpires where name like 'ZZ130%') as fixture_officials_must_be_0,
--   (select count(*) from official_signup_settings where owner_id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_settings_must_be_0,
--   (select plan from profiles where id = 'bbf9afe1-9e62-41e0-becc-895085bfc9d6') as test_plan_must_be_elite,
--   (select count(*) from contact_email_verifications where email like '%zz130%') as verifications_must_be_0,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- 2026-11-11 ~16:50 UTC, against production, rolled back, on Whit's go
-- ("rolled-back proof in the test org with every mutant in the plan"), sent as
-- one batch, the migration byte-exact. Pre-check: live official_outbox_take
-- md5 a9d3c29c… and record_game_played bab8adef… = `--md5`'s method checks;
-- no active client backend, no idle transaction.
--   Run 1 — GREEN: baseline pass; every md5(prosrc) = `--md5`; MG1–MG22 and
--     MG20b, 23/23 KILLED at their own tag (MG1 GC4, MG2 GC2, MG3 GC3, MG4
--     GC3, MG5–MG7 GC5, MG8 GC8, MG9 GC10, MG10 GC9, MG11 KY1, MG12 P1, MG13
--     GC1, MG14 GC12, MG15 GC13, MG16 GC14, MG17 GC12b, MG18 SK1, MG19 GC15,
--     MG20 GC15b, MG20b GC15b, MG21 GC4b, MG22 GC6).
--   regress0124 (the 0124 proof's assertions against 0130) — GREEN: baseline
--     pass; MO12 (re-aimed at 0130's take) KILLED at OX1.
--   regress0106 (the 0106 proof against 0130; fixtures moved to "test", the
--     non-member "Test 2") — GREEN: baseline 0 failures; MU1, MU2, MU4–MU8
--     KILLED at their own tag; MU3 (today in UTC) SURVIVED as expected at
--     16:59 UTC — only killable 00:00–10:00 UTC (the same owed run as 0106's
--     own). record_game_played md5 d20f5ead… = `--md5`; clear_division_posted
--     unchanged before and after.
--   Leak check after each: no 0130 function, trigger, column or table; the
--     take and record_game_played still 0124's / 0106's md5; no ZZ130/ZZ124/
--     ZZ106 rows; no officials settings row for "test"; "test" still Elite,
--     Los Angeles; official_outbox 7 rows as before; no disabled trigger on
--     games; no idle transaction.
-- NOT APPLIED — held for Whit's timing.
