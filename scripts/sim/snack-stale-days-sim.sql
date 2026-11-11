-- Proof for 0131 (snack shack stale-day marks + the names-only read).
-- Assembled by snack-stale-days-build.ts, which puts the LITERAL text of the
-- migration where the placeholder is. One transaction the final RAISE always
-- rolls back; the migration is applied in a rolled-back sub-run for the
-- baseline and again for every mutant.
--
-- FIXTURES — the "test" proof org only (bbf9afe1…, Elite, volunteers on),
-- its season "QA Fall 2026" (4f72caa9…), North Field (a shack field) and
-- South Field (not), two Rookies teams. Inside each run:
--   * a snack_shack_settings row for that season (DIRECT write — the wizard
--     writes it from the browser; the season has none today);
--   * games dated 20–22 days ahead (UTC date), and one 3 days back;
--     SM7 inserts as the signed-in member (the browser's path), the rest are
--     direct writes as postgres — the trigger fires the same way for both;
--   * a snack shack role, two shifts, two volunteers and their claims
--     (direct writes: fixtures of the volunteer feature, which has its own
--     proofs; the canceled claim is written active, then canceled);
--   * Rookies' locked and posted flags (SM8), set and restored directly.
-- Santa Rosa American and SRALL are never read or written.
--
-- HOW TO RUN (only on Whit's go — it takes locks, below):
--   npx tsx scripts/sim/snack-stale-days-build.ts > proof.sql
-- send it as ONE batch, read the raised message, then run the leak check at
-- the bottom as a separate statement. `--md5` prints the md5(prosrc) the
-- apply must match.
--
-- LOCKS for the run: SHARE ROW EXCLUSIVE on `games` (CREATE TRIGGER, each
-- sub-run) — blocks game writes, not reads, for the length of the batch
-- (a few seconds); ACCESS EXCLUSIVE on the two new tables only (not
-- visible outside the run); SHARE ROW EXCLUSIVE on snack_shack_settings
-- (the new FK) — blocks writes to it for the run; row locks on the test
-- org's rows it writes. lock_timeout 3s: if anything is holding `games`,
-- the batch gives up rather than queue behind it.
--
-- Assertions (the case returns the FIRST failing tag, or 'pass'):
--   RL1 (baseline only) applying 0131 changes no existing snack shack row
--   SM7  a game inserted by the signed-in member (browser path) marks its date
--   SM1  a move at a shack field marks BOTH the old and the new date
--   SM9  a note-only edit marks nothing
--   SM10 a game at a field that is not a shack field marks nothing; a move
--        from a shack field to another field marks the date it left
--   SM2  a past date is not marked
--   SM4  a 30-row insert (one statement) gives one mark per date, and all
--        three mark triggers are statement-level and enabled
--   SM5  a delete marks the deleted game's date
--   SM3  a season with no snack shack writes nothing
--   SM6  a failure inside the trigger doesn't block the game write and is
--        recorded in snack_shack_stale_failures
--   SM8  "Sent to parents" still clears on a move; the lock still refuses an
--        insert into a locked division
--   ST1  snack_shack_stale_state: the member sees the upcoming marked dates
--        and failed_since; a non-member is refused
--   SC1  clear_snack_shack_stale_days deletes only marks made at or before
--        `before`, only the dates given (null = all); a non-member is refused
--   SN1  volunteer_shift_claims_for_blocks returns exactly block_id,
--        claim_id, first_initial, last_name — never an email
--   SN2  …and only ACTIVE sign-ups on the given shifts
--   SN3  …and refuses a non-member
--   SP1  privileges: the three functions authenticated only, the trigger
--        function and both tables no role
-- Mutants (each must die at its own tag):
--   MS1 the insert trigger row-level                   → SM4
--   MS2 past dates marked (insert)                     → SM2
--   MS3 an update marks the NEW row only               → SM1
--   MS4 a delete marks nothing                         → SM5
--   MS5 a failure re-raises (blocks the game write)    → SM6
--   MS6 the trigger function SECURITY INVOKER          → SM7
--   MS7 any update marks (the column check dropped)    → SM9
--   MS8 the shack-field filter dropped (insert)        → SM10
--   MN1 the names read returns the email too           → SN1
--   MN2 canceled sign-ups returned                     → SN2
--   MN3 the names read's gate dropped                  → SN3
--   MC1 the clear ignores `before`                     → SC1
--   MP1 the names read granted to anon                 → SP1
select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '60s', true);

create or replace function pg_temp.h131_as(p_sub uuid, p_role text, p_sql text) returns text language plpgsql as $f$
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

create or replace function pg_temp.h131_fingerprint() returns text language sql as $f$
  select md5(
    coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from public.snack_shack_settings s), '') || '#' ||
    coalesce((select string_agg(to_jsonb(b)::text, '|' order by b.id) from public.snack_shack_blocks b), ''));
$f$;

-- "YYYY-MM-DD 10:00:00+00" for current_date + n (the stored wall clock).
create or replace function pg_temp.h131_at(n integer, hhmm text default '10:00') returns timestamptz language sql as $f$
  select ((current_date + n)::text || ' ' || hhmm || ':00+00')::timestamptz;
$f$;

create or replace function pg_temp.h131_marks(p_shack uuid) returns text language sql as $f$
  select coalesce(string_agg(to_char(d.date, 'YYYY-MM-DD'), ',' order by d.date), '')
    from public.snack_shack_stale_days d where d.snack_shack_id = p_shack;
$f$;

create or replace function pg_temp.h131_case() returns text language plpgsql as $f$
declare
  v_org   uuid := 'bbf9afe1-9e62-41e0-becc-895085bfc9d6';  -- "test"
  v_out   uuid := '00000000-0000-4000-8000-000000000131';  -- a member of nothing
  v_s     uuid := '4f72caa9-9088-4118-be3e-fc7cdddd79a0';  -- QA Fall 2026
  v_div   uuid := 'b34adef4-89c1-4eb7-9fca-ff6f3d0788ea';  -- Rookies
  v_t1    uuid := '245801b9-5118-4f8c-9e01-336695f5bcd0';
  v_t2    uuid := '70536ac7-a736-465b-8738-f144a9180a67';
  v_north uuid := '331a5bf6-9489-4ecf-a1d0-0b6cd7f6d225';  -- shack field
  v_south uuid := '256d0326-195e-4f43-9756-bf60ba2d6e36';  -- not
  v_shack uuid;
  v_g     uuid;
  v_g2    uuid;
  v_role  uuid;
  b1      uuid;
  b2      uuid;
  v1      uuid;
  v2      uuid;
  c1      uuid;
  c2      uuid;
  v_fail  integer;
  v_t     timestamptz;
  d20 text := to_char(current_date + 20, 'YYYY-MM-DD');
  d21 text := to_char(current_date + 21, 'YYYY-MM-DD');
  d22 text := to_char(current_date + 22, 'YYYY-MM-DD');
  d23 text := to_char(current_date + 23, 'YYYY-MM-DD');
  d24 text := to_char(current_date + 24, 'YYYY-MM-DD');
  d25 text := to_char(current_date + 25, 'YYYY-MM-DD');
  j  jsonb;
  r  text;
begin
  if exists (select 1 from public.snack_shack_settings where season_id = v_s) then
    return 'FIXTURE the test season already has a snack shack';
  end if;
  insert into public.snack_shack_settings (season_id, start_date, end_date, days_of_week, home_venue_ids)
    values (v_s, current_date, current_date + 60, '["Sa","Su"]', jsonb_build_array(v_north::text))
    returning id into v_shack;

  -- ── SM7 the browser's path ─────────────────────────────────────────────
  r := pg_temp.h131_as(v_org, 'authenticated', format(
    'insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status) values (%L, %L, %L, %L, %L, %L) returning id::text',
    v_s, v_t1, v_t2, v_north, pg_temp.h131_at(20), 'scheduled'));
  if r like 'ERR%' then return 'SM7 the member could not insert a game: ' || r; end if;
  v_g := r::uuid;
  if pg_temp.h131_marks(v_shack) <> d20 then
    return 'SM7 a member''s insert should mark ' || d20 || ', got [' || pg_temp.h131_marks(v_shack) || ']';
  end if;

  -- ── SM1 a move marks old and new ───────────────────────────────────────
  delete from public.snack_shack_stale_days where snack_shack_id = v_shack;
  update public.games set scheduled_at = pg_temp.h131_at(21) where id = v_g;
  if pg_temp.h131_marks(v_shack) <> d20 || ',' || d21 then
    return 'SM1 a move ' || d20 || ' → ' || d21 || ' should mark both, got [' || pg_temp.h131_marks(v_shack) || ']';
  end if;

  -- ── SM9 a note edit marks nothing ──────────────────────────────────────
  delete from public.snack_shack_stale_days where snack_shack_id = v_shack;
  update public.games set notes = 'proof note' where id = v_g;
  if pg_temp.h131_marks(v_shack) <> '' then
    return 'SM9 a note-only edit marked [' || pg_temp.h131_marks(v_shack) || ']';
  end if;

  -- ── SM10 not a shack field ─────────────────────────────────────────────
  insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
    values (v_s, v_t1, v_t2, v_south, pg_temp.h131_at(22), 'scheduled') returning id into v_g2;
  if pg_temp.h131_marks(v_shack) <> '' then
    return 'SM10 a game at a non-shack field marked [' || pg_temp.h131_marks(v_shack) || ']';
  end if;
  update public.games set venue_id = v_south where id = v_g;   -- North → South, on d21
  if pg_temp.h131_marks(v_shack) <> d21 then
    return 'SM10 a game leaving the shack field should mark ' || d21 || ', got [' || pg_temp.h131_marks(v_shack) || ']';
  end if;

  -- ── SM2 past dates ─────────────────────────────────────────────────────
  delete from public.snack_shack_stale_days where snack_shack_id = v_shack;
  insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
    values (v_s, v_t1, v_t2, v_north, pg_temp.h131_at(-3), 'scheduled');
  if pg_temp.h131_marks(v_shack) <> '' then
    return 'SM2 a past date was marked [' || pg_temp.h131_marks(v_shack) || ']';
  end if;

  -- ── SM4 one statement, one mark per date; statement-level ─────────────
  insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
    select v_s, v_t1, v_t2, v_north, pg_temp.h131_at(23 + (i % 3), to_char(time '08:00' + i * interval '10 minutes', 'HH24:MI')), 'scheduled'
      from generate_series(1, 30) i;
  if pg_temp.h131_marks(v_shack) <> d23 || ',' || d24 || ',' || d25 then
    return 'SM4 a 30-game insert should mark exactly 3 dates, got [' || pg_temp.h131_marks(v_shack) || ']';
  end if;
  if (select count(*) from pg_trigger
       where tgrelid = 'public.games'::regclass and tgname like 'snack_shack_mark_stale_%'
         and tgenabled = 'O' and (tgtype & 1) = 0) <> 3 then
    return 'SM4 the three mark triggers must be statement-level and enabled';
  end if;

  -- ── SM5 delete ─────────────────────────────────────────────────────────
  delete from public.snack_shack_stale_days where snack_shack_id = v_shack;
  update public.games set venue_id = v_north, scheduled_at = pg_temp.h131_at(22, '13:00') where id = v_g2;
  delete from public.snack_shack_stale_days where snack_shack_id = v_shack;
  delete from public.games where id = v_g2;
  if pg_temp.h131_marks(v_shack) <> d22 then
    return 'SM5 a delete should mark ' || d22 || ', got [' || pg_temp.h131_marks(v_shack) || ']';
  end if;

  -- ── SM3 no snack shack, no marks ───────────────────────────────────────
  delete from public.snack_shack_settings where id = v_shack;            -- its marks cascade
  insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
    values (v_s, v_t1, v_t2, v_north, pg_temp.h131_at(26), 'scheduled');
  if exists (select 1 from public.snack_shack_stale_days d
              where not exists (select 1 from public.snack_shack_settings s where s.id = d.snack_shack_id)) then
    return 'SM3 a mark exists for a missing snack shack';
  end if;
  if exists (select 1 from public.snack_shack_stale_days d join public.snack_shack_settings s on s.id = d.snack_shack_id
              where s.season_id = v_s) then
    return 'SM3 a season with no snack shack got a mark';
  end if;
  insert into public.snack_shack_settings (season_id, start_date, end_date, days_of_week, home_venue_ids)
    values (v_s, current_date, current_date + 60, '["Sa","Su"]', jsonb_build_array(v_north::text))
    returning id into v_shack;

  -- ── SM6 a failure never blocks the write ───────────────────────────────
  v_fail := (select count(*) from public.snack_shack_stale_failures);
  alter table public.snack_shack_stale_days add constraint h131_fail check (date < date '2000-01-01') not valid;
  begin
    insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
      values (v_s, v_t1, v_t2, v_north, pg_temp.h131_at(27), 'scheduled');
  exception when others then
    alter table public.snack_shack_stale_days drop constraint h131_fail;
    return 'SM6 a failing mark blocked the game insert: ' || sqlstate || ' ' || sqlerrm;
  end;
  alter table public.snack_shack_stale_days drop constraint h131_fail;
  if (select count(*) from public.snack_shack_stale_failures) <> v_fail + 1 then
    return 'SM6 the failure should be recorded once';
  end if;
  if pg_temp.h131_marks(v_shack) <> '' then
    return 'SM6 a failed mark left a row';
  end if;

  -- ── SM8 posted and the lock are untouched ──────────────────────────────
  update public.divisions set posted = true, posted_at = now() where id = v_div;
  update public.games set scheduled_at = pg_temp.h131_at(21, '11:00') where id = v_g;
  if (select posted from public.divisions where id = v_div) then
    return 'SM8 a move should still clear "Sent to parents"';
  end if;
  update public.divisions set locked = true where id = v_div;
  r := pg_temp.h131_as(v_org, 'authenticated', format(
    'insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status) values (%L, %L, %L, %L, %L, %L) returning id::text',
    v_s, v_t1, v_t2, v_north, pg_temp.h131_at(28), 'scheduled'));
  update public.divisions set locked = false where id = v_div;
  if r not like 'ERR%' then
    return 'SM8 the lock should still refuse an insert into a locked division, got ' || r;
  end if;

  -- ── ST1 the state read ─────────────────────────────────────────────────
  delete from public.snack_shack_stale_days where snack_shack_id = v_shack;
  insert into public.snack_shack_stale_days (snack_shack_id, date) values
    (v_shack, current_date + 30), (v_shack, current_date - 2);
  j := pg_temp.h131_as(v_org, 'authenticated', format('select public.snack_shack_stale_state(%L)::text', v_s))::jsonb;
  if j -> 'dates' <> jsonb_build_array(to_char(current_date + 30, 'YYYY-MM-DD'))
     or (j ->> 'snack_shack_id')::uuid is distinct from v_shack
     or j ->> 'failed_since' <> 'true' then
    return 'ST1 the member should see one upcoming date, the shack and failed_since true: ' || j::text;
  end if;
  r := pg_temp.h131_as(v_out, 'authenticated', format('select public.snack_shack_stale_state(%L)::text', v_s));
  if r not like 'ERR 42501%' then return 'ST1 a non-member should be refused, got ' || r; end if;

  -- ── SC1 the clear ──────────────────────────────────────────────────────
  delete from public.snack_shack_stale_days where snack_shack_id = v_shack;
  insert into public.snack_shack_stale_days (snack_shack_id, date, marked_at) values
    (v_shack, current_date + 30, now() - interval '10 minutes'),
    (v_shack, current_date + 31, now() - interval '10 minutes'),
    (v_shack, current_date + 32, now() + interval '10 minutes');   -- made after `before`
  v_t := now();
  r := pg_temp.h131_as(v_org, 'authenticated', format(
    'select public.clear_snack_shack_stale_days(%L, %L::date[], %L)::text', v_shack, '{' || (current_date + 30) || '}', v_t));
  if r <> '1' or pg_temp.h131_marks(v_shack) <> to_char(current_date + 31, 'YYYY-MM-DD') || ',' || to_char(current_date + 32, 'YYYY-MM-DD') then
    return 'SC1 clearing one date should delete 1: ' || r || ' [' || pg_temp.h131_marks(v_shack) || ']';
  end if;
  r := pg_temp.h131_as(v_org, 'authenticated', format(
    'select public.clear_snack_shack_stale_days(%L, null, %L)::text', v_shack, v_t));
  if r <> '1' or pg_temp.h131_marks(v_shack) <> to_char(current_date + 32, 'YYYY-MM-DD') then
    return 'SC1 clearing every date should keep the mark made after `before`: ' || r || ' [' || pg_temp.h131_marks(v_shack) || ']';
  end if;
  r := pg_temp.h131_as(v_out, 'authenticated', format(
    'select public.clear_snack_shack_stale_days(%L, null, %L)::text', v_shack, v_t));
  if r not like 'ERR 42501%' then return 'SC1 a non-member should be refused, got ' || r; end if;

  -- ── SN names ───────────────────────────────────────────────────────────
  insert into public.volunteer_roles (season_id, owner_id, name, kind, spots, lead_minutes, signups_open, counts_toward_goal)
    values (v_s, v_org, 'Proof snack shack', 'snack_shack', 1, 0, true, true) returning id into v_role;
  insert into public.snack_shack_blocks (snack_shack_id, date, start_time, end_time, is_recurring)
    values (v_shack, current_date + 20, '09:30', '11:30', true) returning id into b1;
  insert into public.snack_shack_blocks (snack_shack_id, date, start_time, end_time, is_recurring)
    values (v_shack, current_date + 20, '11:30', '13:30', true) returning id into b2;
  insert into public.volunteers (owner_id, email_lc, first_initial, last_name, adult_confirmed_at)
    values (v_org, 'h131-one@example.test', 'J', 'Smith', now()) returning id into v1;
  insert into public.volunteers (owner_id, email_lc, first_initial, last_name, adult_confirmed_at)
    values (v_org, 'h131-two@example.test', 'K', 'Lee', now()) returning id into v2;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, snack_shack_block_id, role_id, position, created_by)
    values (v_org, v_s, v1, v_t1, b1, v_role, 1, 'admin') returning id into c1;
  insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, snack_shack_block_id, role_id, position, created_by)
    values (v_org, v_s, v2, v_t1, b2, v_role, 1, 'admin') returning id into c2;
  update public.volunteer_claims set status = 'canceled', canceled_at = now() where id = c2;

  j := pg_temp.h131_as(v_org, 'authenticated', format(
    'select public.volunteer_shift_claims_for_blocks(%L, %L::uuid[])::text', v_s, '{' || b1 || ',' || b2 || '}'))::jsonb;
  if jsonb_typeof(j) <> 'array' or jsonb_array_length(j) < 1
     or exists (select 1 from jsonb_array_elements(j) x
                 where (select array_agg(k order by k) from jsonb_object_keys(x) k)
                       <> array['block_id', 'claim_id', 'first_initial', 'last_name']) then
    return 'SN1 the names read must return exactly block_id, claim_id, first_initial, last_name: ' || coalesce(j::text, 'null');
  end if;
  if j <> jsonb_build_array(jsonb_build_object('block_id', b1, 'claim_id', c1, 'first_initial', 'J', 'last_name', 'Smith')) then
    return 'SN2 only the active sign-up on the given shifts: ' || j::text;
  end if;
  r := pg_temp.h131_as(v_out, 'authenticated', format(
    'select public.volunteer_shift_claims_for_blocks(%L, %L::uuid[])::text', v_s, '{' || b1 || '}'));
  if r not like 'ERR 42501%' then return 'SN3 a non-member should be refused, got ' || r; end if;

  -- ── SP1 privileges ─────────────────────────────────────────────────────
  foreach r in array array['public.snack_shack_stale_state(uuid)', 'public.clear_snack_shack_stale_days(uuid, date[], timestamptz)',
                           'public.volunteer_shift_claims_for_blocks(uuid, uuid[])', 'public.snack_shack_mark_stale_days()'] loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = r::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
       or has_function_privilege('anon', r, 'EXECUTE') or has_function_privilege('service_role', r, 'EXECUTE')
       or has_function_privilege('dashboard_readonly', r, 'EXECUTE')
       or has_function_privilege('authenticated', r, 'EXECUTE') <> (r <> 'public.snack_shack_mark_stale_days()') then
      return 'SP1 wrong EXECUTE on ' || r;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.snack_shack_stale_days', 'SELECT')
     or has_table_privilege('anon', 'public.snack_shack_stale_failures', 'SELECT') then
    return 'SP1 a role can read a new table';
  end if;

  return 'pass';
end;
$f$;

do $h$
declare
  v_body  text := $mig131$
-- @@MIGRATION_0131@@
$mig131$;
  v_nover text;
  v_res   text;
  v_mut   text;
  v_fp    text;
  v_out   text := E'\n';
  m       record;
begin
  if strpos(v_body, '-- 5. Verify') = 0 then raise exception 'harness: verify marker not found in 0131'; end if;
  v_nover := split_part(v_body, '-- 5. Verify', 1);

  begin
    v_fp := pg_temp.h131_fingerprint();
    execute v_body;
    v_out := v_out || case when pg_temp.h131_fingerprint() = v_fp then 'RL1 pass (no snack shack row changed)'
                           else 'RL1 FAILED: applying 0131 changed a snack shack row' end || E'\n';
    v_res := pg_temp.h131_case();
    v_out := v_out || 'BASELINE ' || v_res || E'\n';
    v_out := v_out || 'md5(prosrc) ' || (select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname)
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('snack_shack_mark_stale_days', 'snack_shack_stale_state', 'clear_snack_shack_stale_days',
                         'volunteer_shift_claims_for_blocks')) || E'\n';
    raise exception 'H131ROLLBACK';
  exception when others then
    if sqlerrm <> 'H131ROLLBACK' then
      v_out := v_out || 'BASELINE CRASH ' || sqlstate || ' ' || sqlerrm || E'\n';
    end if;
  end;

  for m in
    select * from (values
    ('MS1', 'SM4', $r$  after insert on public.games
  referencing new table as newrows
  for each statement$r$, $r$  after insert on public.games
  referencing new table as newrows
  for each row$r$),
    ('MS2', 'SM2', $r$         and (n.scheduled_at at time zone 'UTC')::date >= (now() at time zone p.timezone)::date
$r$, ''),
    ('MS3', 'SM1', $r$          select o.league_id, o.scheduled_at, o.venue_id$r$, $r$          select n.league_id, n.scheduled_at, n.venue_id$r$),
    ('MS4', 'SM5', $r$    elsif tg_op = 'DELETE' then$r$, $r$    elsif false then$r$),
    ('MS5', 'SM6', $r$    begin
      insert into public.snack_shack_stale_failures (sqlstate) values (sqlstate);
    exception when others then
      null;
    end;$r$, $r$    raise;$r$),
    ('MS6', 'SM7', $r$security definer
set search_path = public, pg_temp
as $$
begin
  -- A season or division delete$r$, $r$security invoker
set search_path = public, pg_temp
as $$
begin
  -- A season or division delete$r$),
    ('MS7', 'SM9', $r$           where (o.scheduled_at, o.venue_id, o.status, o.home_team_id)
                 is distinct from (n.scheduled_at, n.venue_id, n.status, n.home_team_id)
          union all$r$, $r$           where true
          union all$r$),
    ('MS8', 'SM10', $r$         and s.home_venue_ids ? n.venue_id::text
$r$, ''),
    ('MN1', 'SN1', $r$             'last_name', v.last_name)$r$, $r$             'last_name', v.last_name, 'email', v.email_lc)$r$),
    ('MN2', 'SN2', $r$       and c.status = 'active'
$r$, ''),
    ('MN3', 'SN3', $r$  perform public.volunteer_admin_gate(p_season_id, false);
$r$, ''),
    ('MC1', 'SC1', $r$     and d.marked_at <= p_before
$r$, ''),
    ('MP1', 'SP1', $r$grant  execute on function public.volunteer_shift_claims_for_blocks(uuid, uuid[])       to authenticated;$r$,
                   $r$grant  execute on function public.volunteer_shift_claims_for_blocks(uuid, uuid[])       to authenticated, anon;$r$)
    ) as t(id, expect, find, repl)
  loop
    if (length(v_nover) - length(replace(v_nover, m.find, ''))) / greatest(length(m.find), 1) <> 1 then
      v_out := v_out || format(E'%s STALE (find text not exactly once)\n', m.id);
      continue;
    end if;
    begin
      execute replace(v_nover, m.find, m.repl);
      v_res := pg_temp.h131_case();
      raise exception 'H131CASE:%', v_res;
    exception when others then
      v_mut := case when sqlerrm like 'H131CASE:%' then replace(sqlerrm, 'H131CASE:', '')
                    else 'CRASH ' || sqlstate || ' ' || sqlerrm end;
      v_out := v_out || format(E'%s %s (first failure %s, expected %s)\n', m.id,
        case when split_part(v_mut, ' ', 1) = m.expect then 'KILLED'
             when v_mut = 'pass' then 'SURVIVED'
             else 'KILLED AT THE WRONG TAG' end,
        left(v_mut, 220), m.expect);
    end;
  end loop;
  raise exception E'ROLLED BACK — 0131 proof\n%', v_out;
end $h$;

-- ── LEAK CHECK — run as a SEPARATE statement after the batch ────────────────
-- select
--   (select count(*) from pg_class where relname in ('snack_shack_stale_days', 'snack_shack_stale_failures')) as new_tables_0,
--   (select count(*) from pg_proc where proname in ('snack_shack_mark_stale_days', 'snack_shack_stale_state',
--      'clear_snack_shack_stale_days', 'volunteer_shift_claims_for_blocks')) as new_functions_0,
--   (select count(*) from pg_trigger where tgname like 'snack_shack_mark_stale_%') as triggers_0,
--   (select count(*) from snack_shack_settings where season_id = '4f72caa9-9088-4118-be3e-fc7cdddd79a0') as test_shack_0,
--   (select count(*) from games where league_id = '4f72caa9-9088-4118-be3e-fc7cdddd79a0') as test_games_30,
--   (select locked::text || '/' || posted::text from divisions where id = 'b34adef4-89c1-4eb7-9fca-ff6f3d0788ea') as rookies_false_false,
--   (select count(*) from volunteers where email_lc like 'h131-%') as proof_volunteers_0,
--   (select count(*) from pg_proc where proname like 'h131%') as temp_fns_0,
--   (select count(*) from pg_stat_activity where state = 'idle in transaction') as idle_tx_must_be_0;
--
-- ── RUN LOG ───────────────────────────────────────────────────────────────
-- (not run yet — held for Whit's go)
