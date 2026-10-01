-- SQL-level proof for migration 0100 (field address in the team calendar feed).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- is two CHECK constraints and a SECURITY DEFINER reader called as `anon`,
-- with the trigger-created calendar link in the path. The in-memory fake
-- client cannot model any of it. NOT `npm run`-able, NOT in CI.
--
-- THIS HARNESS APPLIES 0100 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK. It is the proof to run BEFORE the migration is applied for real. It
-- leaves nothing behind: no constraint, no function change, no row.
--
-- HOW TO RUN
--   1. `npx tsx scripts/sim/venue-address-calendar-build.ts > <file>`
--      substitutes the LITERAL text of
--      supabase/migrations/0100_venue_address_in_calendar.sql for the
--      placeholder line below, so what is proven is the file that will be
--      applied, not a copy that can drift.
--   2. Send the output as ONE batch through the Supabase MCP (execute_sql).
--      A batch runs in a single transaction (probed 2026-09-29).
--   3. The last statement ALWAYS raises. The raised message IS the result.
--   Evenings only. Get an explicit go-ahead first.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: one to two seconds)
--   ACCESS EXCLUSIVE on public.venues AND public.locations, from the two
--   ADD CONSTRAINT statements in the migration. That BLOCKS READS AND WRITES
--   of both tables for the run: the Venues page, every field picker, the
--   Schedule page's venue embed, the generator's venue reads. In effect most
--   dashboard pages stall for a second or two. lock_timeout = 3s: the run
--   gives up rather than queue behind a writer; statement_timeout = 15s
--   bounds the whole thing. CM4 re-adds the venues constraint inside the
--   same transaction (the lock is already held). Nothing drops or disables a
--   trigger.
--
-- ROWS TOUCHED (all rolled back): the "test" org's division D1 (locked
-- false, then true — the 0099 trigger creates links), plus scratch rows
-- named HARNESS-0100: one location, three venues, three games between two
-- existing D1 teams. Every fixture write was checked against the live
-- CHECKs, required columns, FKs and triggers of games, venues, locations and
-- divisions (games_opponent_required: away_team_id set; enforce_division_lock:
-- inserts happen while D1 is unlocked; set_games_notes_attribution: no note;
-- clear_division_posted: fires, rolled back). No other org's row is read
-- for a write.
--
-- IMPERSONATION: the reader is called as `anon` (`set local role anon`, no
-- JWT), exactly what the feed route does. Assertions read back as postgres.
--
-- ASSERTIONS (in order — a mutant must die FIRST at its own tag)
--   R0   the reader returns ok for team A's token
--   K1   every venue object's keys are on {name, location, address}
--   K2   every venue object CARRIES the key `address` (named, present even
--        when null — never omitted)
--   A1   a field with its own address: venue.address is that address,
--        TRIMMED (the fixture is padded with spaces)
--   A2   a field whose own address is whitespace-only, in a park with an
--        address: venue.address is the PARK's, trimmed
--   A3   a field with no address and no park: venue.address is null
--   A4   every game-level key is still on the 0099 allowlist (the address
--        rides INSIDE venue, never beside it)
--   A5   with venue.address removed from the payload, neither planted
--        address string appears anywhere else in it
--   C1   venues.address: 201 characters refused, a control character
--        refused, 200 characters accepted
--   C2   the same three on locations.address
--   N1   the three partner token functions (0087) do not mention `address`
--        in their bodies, and all three exist
--   G1   reader EXECUTE: anon and authenticated only
--
-- MUTANTS — each in its own rolled-back block, KILLED only if its FIRST
-- failure is its own tag:
--   CM1  park fallback removed (venue's address only)        → A2
--   CM2  trimming removed (raw coalesce)                     → A1
--   CM3  address ALSO emitted at game level                  → A4
--   CM4  venues CHECK loosened to 300 characters             → C1
--
-- RUN LOG (2026-09-30, ~19:10 Pacific, against production, rolled back; leak
-- check clean: no HARNESS-0100 rows, no constraints, reader md5 = 0099's,
-- test org links 0, Majors unlocked as before). 0100 was NOT applied when
-- this was run; it was applied right after, md5(prosrc) =
-- 235e480fd14c7580504558e0366b376c = the repo file's body.
--
--   RUN 1 — GREEN on the first run. Baseline: zero failures. Counters:
--     venue_keys_scanned 3, venue_address 1, park_fallback 1, null_address 1,
--     leak_scanned 2, check_refused 4, check_accepted 2,
--     partner_prosrc_scanned 3, grants_checked 1. No zero or absent counter.
--     CM1 → KILLED at [A2]  (park fallback gone: null came back)
--     CM2 → KILLED at [A1]  (untrimmed: the padded value came back; A2 also
--                            fell, with the whitespace-only value)
--     CM3 → KILLED at [A4]  (game key "address" off the allowlist; A5 then
--                            saw the string outside venue.address)
--     CM4 → KILLED at [C1]  (201 characters accepted)
--     AFTER MUTANTS: zero failures.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '15s', true);

-- Run a SELECT returning one jsonb as a role; {ok, result} or {ok:false, err}.
create function pg_temp.h100_call(p_role text, p_uid uuid, p_sql text)
returns jsonb
language plpgsql
as $fn$
declare
  v_res jsonb;
  v_out jsonb;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end,
    true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_res;
    v_out := jsonb_build_object('ok', true, 'result', v_res);
  exception when others then
    v_out := jsonb_build_object('ok', false, 'err', sqlstate || ' ' || sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

-- Current token of a team (as postgres). plpgsql on purpose (0099 run 1).
create function pg_temp.h100_token(p_team uuid)
returns text
language plpgsql
as $fn$
begin
  return (select token from public.team_calendar_links
           where team_id = p_team and status <> 'replaced');
end;
$fn$;

-- The reader, called as anon with a token.
create function pg_temp.h100_read(p_token text)
returns jsonb
language plpgsql
as $fn$
declare
  v jsonb;
begin
  v := pg_temp.h100_call('anon', null,
         format('select public.get_team_calendar_by_token(%L)', p_token));
  if not (v ->> 'ok')::boolean then
    return jsonb_build_object('status', 'CALL-ERR', 'err', v ->> 'err');
  end if;
  return v -> 'result';
end;
$fn$;

-- Fixtures + every assertion. Returns { fails: [...], counters: {...} }.
-- Everything it writes is rolled back by the caller's block.
create function pg_temp.h100_run()
returns jsonb
language plpgsql
as $fn$
declare
  v_fails   text[] := array[]::text[];
  c         jsonb := '{}'::jsonb;
  v_org     uuid;
  v_season  uuid;
  v_d1      uuid;
  v_a       uuid;  v_b uuid;
  v_loc     uuid;
  v_v1      uuid;  v_v2 uuid;  v_v3 uuid;
  v_g1      uuid;  v_g2 uuid;  v_g3 uuid;
  v_when    timestamptz;
  v_tok     text;
  v_r       jsonb; v_games jsonb; v_g jsonb;
  v_n       integer;
  v_txt     text;
  v_bad     text[];
  v_keys    text[];
  v_allow   constant text[] := array['id','scheduled_at','updated_at','status','is_away',
    'home_team_id','away_team_id','external_team_name','proposed_venue_name',
    'home_team','away_team','venue'];
  v_venue_addr constant text := 'HARNESS-0100-VENUE-ADDR 12 Field St';
  v_park_addr  constant text := 'HARNESS-0100-PARK-ADDR 1 Park Way, Santa Rosa, CA';
begin
  -- ── setup ────────────────────────────────────────────────────────────────
  select id into v_org from public.profiles where org_name = 'test';
  select id into v_season from public.leagues where owner_id = v_org and archived_at is null
   order by created_at desc limit 1;
  if v_org is null or v_season is null then
    raise exception 'H100 SETUP: test org/season not found';
  end if;

  -- D1: the test division with the most games (the 0099 choice).
  select d.id into v_d1 from public.divisions d
   where d.league_id = v_season
   order by (select count(*) from public.games g join public.teams t on t.id = g.home_team_id
              where t.division_id = d.id) desc, d.created_at limit 1;
  if v_d1 is null then
    raise exception 'H100 SETUP: no division in the test season';
  end if;
  -- Unlocked while the fixture games are inserted (enforce_division_lock).
  update public.divisions set locked = false where id = v_d1;

  select id into v_a from public.teams where division_id = v_d1 order by created_at limit 1;
  select id into v_b from public.teams where division_id = v_d1 and id <> v_a order by created_at limit 1;
  if v_a is null or v_b is null then
    raise exception 'H100 SETUP: D1 needs two teams';
  end if;

  -- Scratch park and fields. The addresses are PADDED so trimming is proven.
  insert into public.locations (owner_id, name, address)
  values (v_org, 'HARNESS-0100 Park', '   ' || v_park_addr || '   ')
  returning id into v_loc;
  insert into public.venues (owner_id, name, location_id, address)
  values (v_org, 'HARNESS-0100 Field A', v_loc, '   ' || v_venue_addr || '   ')
  returning id into v_v1;
  insert into public.venues (owner_id, name, location_id, address)
  values (v_org, 'HARNESS-0100 Field B', v_loc, '      ')
  returning id into v_v2;
  insert into public.venues (owner_id, name, location_id, address)
  values (v_org, 'HARNESS-0100 Field C', null, null)
  returning id into v_v3;

  -- Three scratch games for team A, after every live game of the season.
  select coalesce(max(scheduled_at), now()) + interval '30 days' into v_when
    from public.games where league_id = v_season;
  insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
  values (v_season, v_a, v_b, v_v1, v_when, 'scheduled') returning id into v_g1;
  insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
  values (v_season, v_a, v_b, v_v2, v_when + interval '1 day', 'scheduled') returning id into v_g2;
  insert into public.games (league_id, home_team_id, away_team_id, venue_id, scheduled_at, status)
  values (v_season, v_a, v_b, v_v3, v_when + interval '2 days', 'scheduled') returning id into v_g3;

  -- Lock D1: the 0099 trigger creates the links.
  update public.divisions set locked = true where id = v_d1;
  v_tok := pg_temp.h100_token(v_a);
  if v_tok is null then
    raise exception 'H100 SETUP: locking D1 created no link for team A';
  end if;

  -- ── R0 ───────────────────────────────────────────────────────────────────
  v_r := pg_temp.h100_read(v_tok);
  if (v_r ->> 'status') is distinct from 'ok' then
    v_fails := array_append(v_fails, 'R0: reader did not return ok: ' || v_r::text);
    return jsonb_build_object('fails', to_jsonb(v_fails), 'counters', c);
  end if;
  v_games := coalesce(v_r -> 'games', '[]'::jsonb);

  -- ── K1 / K2: the venue object's keys ─────────────────────────────────────
  select array_agg(distinct k) into v_keys
    from jsonb_array_elements(v_games) g, jsonb_object_keys(g -> 'venue') k
   where jsonb_typeof(g -> 'venue') = 'object';
  select array_agg(k) into v_bad from unnest(v_keys) k where not (k = any (array['name','location','address']));
  if v_keys is null or v_bad is not null then
    v_fails := array_append(v_fails, 'K1: venue keys off the allowlist: ' || coalesce(array_to_string(v_bad, ','), '(no venue objects)'));
  else
    c := c || jsonb_build_object('venue_keys_scanned', coalesce(array_length(v_keys, 1), 0));
  end if;
  select count(*) into v_n
    from jsonb_array_elements(v_games) g
   where jsonb_typeof(g -> 'venue') = 'object' and not (g -> 'venue' ? 'address');
  if v_n > 0 then
    v_fails := array_append(v_fails, format('K2: %s venue object(s) without the address key', v_n));
  end if;

  -- ── A1: the field's own address, trimmed ────────────────────────────────
  select g into v_g from jsonb_array_elements(v_games) g where g ->> 'id' = v_g1::text;
  if v_g is null or (v_g -> 'venue' ->> 'address') is distinct from v_venue_addr then
    v_fails := array_append(v_fails, 'A1: own address not returned trimmed: ' || coalesce(v_g -> 'venue' ->> 'address', '(null)'));
  else
    c := c || jsonb_build_object('venue_address', 1);
  end if;

  -- ── A2: whitespace-only own address → the park's, trimmed ────────────────
  select g into v_g from jsonb_array_elements(v_games) g where g ->> 'id' = v_g2::text;
  if v_g is null or (v_g -> 'venue' ->> 'address') is distinct from v_park_addr then
    v_fails := array_append(v_fails, 'A2: park fallback not returned trimmed: ' || coalesce(v_g -> 'venue' ->> 'address', '(null)'));
  else
    c := c || jsonb_build_object('park_fallback', 1);
  end if;

  -- ── A3: no address anywhere → null ───────────────────────────────────────
  select g into v_g from jsonb_array_elements(v_games) g where g ->> 'id' = v_g3::text;
  if v_g is null or jsonb_typeof(v_g -> 'venue' -> 'address') is distinct from 'null' then
    v_fails := array_append(v_fails, 'A3: expected a null address, got: ' || coalesce((v_g -> 'venue' -> 'address')::text, '(missing)'));
  else
    c := c || jsonb_build_object('null_address', 1);
  end if;

  -- ── A4: game-level keys unchanged (0099 allowlist) ───────────────────────
  select array_agg(distinct k) into v_keys
    from jsonb_array_elements(v_games) g, jsonb_object_keys(g) k;
  select array_agg(k) into v_bad from unnest(v_keys) k where not (k = any (v_allow));
  if v_bad is not null or v_keys is null then
    v_fails := array_append(v_fails, 'A4: game keys off the allowlist: ' || coalesce(array_to_string(v_bad, ','), '(no games)'));
  end if;

  -- ── A5: the address text lives in venue.address and nowhere else ─────────
  v_txt := lower((select coalesce(jsonb_agg(g #- '{venue,address}'), '[]'::jsonb) from jsonb_array_elements(v_games) g)::text)
        || lower((v_r - 'games')::text);
  if position(lower('HARNESS-0100-VENUE-ADDR') in v_txt) > 0
     or position(lower('HARNESS-0100-PARK-ADDR') in v_txt) > 0 then
    v_fails := array_append(v_fails, 'A5: an address string appears outside venue.address');
  else
    c := c || jsonb_build_object('leak_scanned', 2);
  end if;

  -- ── C1: venues.address CHECK ─────────────────────────────────────────────
  begin
    update public.venues set address = repeat('x', 201) where id = v_v3;
    v_fails := array_append(v_fails, 'C1: 201 characters accepted on venues.address');
  exception when check_violation then
    c := c || jsonb_build_object('check_refused', coalesce((c ->> 'check_refused')::integer, 0) + 1);
  end;
  begin
    update public.venues set address = 'a' || chr(10) || 'b' where id = v_v3;
    v_fails := array_append(v_fails, 'C1: a control character accepted on venues.address');
  exception when check_violation then
    c := c || jsonb_build_object('check_refused', coalesce((c ->> 'check_refused')::integer, 0) + 1);
  end;
  begin
    update public.venues set address = repeat('y', 200) where id = v_v3;
    c := c || jsonb_build_object('check_accepted', coalesce((c ->> 'check_accepted')::integer, 0) + 1);
  exception when others then
    v_fails := array_append(v_fails, 'C1: 200 characters refused on venues.address: ' || sqlerrm);
  end;

  -- ── C2: locations.address CHECK ──────────────────────────────────────────
  begin
    update public.locations set address = repeat('x', 201) where id = v_loc;
    v_fails := array_append(v_fails, 'C2: 201 characters accepted on locations.address');
  exception when check_violation then
    c := c || jsonb_build_object('check_refused', coalesce((c ->> 'check_refused')::integer, 0) + 1);
  end;
  begin
    update public.locations set address = 'a' || chr(13) || 'b' where id = v_loc;
    v_fails := array_append(v_fails, 'C2: a control character accepted on locations.address');
  exception when check_violation then
    c := c || jsonb_build_object('check_refused', coalesce((c ->> 'check_refused')::integer, 0) + 1);
  end;
  begin
    update public.locations set address = repeat('y', 200) where id = v_loc;
    c := c || jsonb_build_object('check_accepted', coalesce((c ->> 'check_accepted')::integer, 0) + 1);
  exception when others then
    v_fails := array_append(v_fails, 'C2: 200 characters refused on locations.address: ' || sqlerrm);
  end;

  -- ── N1: the partner token functions never mention address ───────────────
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_interleague_schedule_by_token', 'get_interleague_invite_by_token', 'get_reschedule_request_by_token');
  select array_agg(p.proname::text) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_interleague_schedule_by_token', 'get_interleague_invite_by_token', 'get_reschedule_request_by_token')
     and p.prosrc ~* '\maddress\M';
  if v_n <> 3 then
    v_fails := array_append(v_fails, format('N1: expected the three partner functions, found %s', v_n));
  elsif v_bad is not null then
    v_fails := array_append(v_fails, 'N1: a partner function mentions address: ' || array_to_string(v_bad, ','));
  else
    c := c || jsonb_build_object('partner_prosrc_scanned', v_n);
  end if;

  -- ── G1: reader privileges ────────────────────────────────────────────────
  if not has_function_privilege('anon', 'public.get_team_calendar_by_token(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_team_calendar_by_token(text)', 'execute')
     or has_function_privilege('dashboard_readonly', 'public.get_team_calendar_by_token(text)', 'execute')
     or has_function_privilege('service_role', 'public.get_team_calendar_by_token(text)', 'execute') then
    v_fails := array_append(v_fails, 'G1: reader EXECUTE is not anon + authenticated only');
  else
    c := c || jsonb_build_object('grants_checked', 1);
  end if;

  return jsonb_build_object('fails', to_jsonb(v_fails), 'counters', c);
end;
$fn$;

do $h100$
declare
  v_base  jsonb;
  v_m     jsonb;
  v_out   text := '';
  v_def   text;
  v_mut   text;
  m       record;
  v_first text;
  v_tag   text;
  v_zero  text := '';
  k       text;
begin
  -- The migration, verbatim.
  execute $mig100$
-- @@MIGRATION_0100@@
  $mig100$;

  -- Baseline, in its own rolled-back block.
  begin
    v_base := pg_temp.h100_run();
    raise exception 'H100_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H100_ROLLBACK' then
      v_base := jsonb_build_object('fails', jsonb_build_array('CRASH-baseline: ' || sqlstate || ' ' || sqlerrm), 'counters', '{}'::jsonb);
    end if;
  end;

  for k in select jsonb_object_keys(v_base -> 'counters') loop
    if (v_base -> 'counters' ->> k)::integer = 0 then v_zero := v_zero || ' ' || k; end if;
  end loop;
  foreach k in array array['venue_keys_scanned','venue_address','park_fallback','null_address','leak_scanned',
                            'check_refused','check_accepted','partner_prosrc_scanned','grants_checked'] loop
    if not (v_base -> 'counters') ? k then v_zero := v_zero || ' ' || k || '(absent)'; end if;
  end loop;

  v_out := format(E'H100 RESULTS\nBASELINE failures: %s\nBASELINE counters: %s\nZERO/ABSENT counters:%s\n',
    v_base -> 'fails', v_base -> 'counters', case when v_zero = '' then ' none' else v_zero end);

  for m in
    select * from (values
      ('CM1', 'park fallback removed (venue address only)', 'A2', 'reader'),
      ('CM2', 'trimming removed (raw coalesce)',            'A1', 'reader'),
      ('CM3', 'address also emitted at game level',         'A4', 'reader'),
      ('CM4', 'venues CHECK loosened to 300 characters',    'C1', 'check')
    ) as t(id, what, target, kind)
  loop
    begin
      if m.kind = 'check' then
        alter table public.venues drop constraint venues_address_shape;
        alter table public.venues add constraint venues_address_shape
          check (address is null or (length(address) <= 300 and address !~ '[[:cntrl:]]'));
      else
        v_def := pg_get_functiondef('public.get_team_calendar_by_token(text)'::regprocedure);
        if m.id = 'CM1' then
          v_mut := replace(v_def,
            $a$coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), ''))$a$,
            $a$nullif(btrim(v.address), '')$a$);
        elsif m.id = 'CM2' then
          v_mut := replace(v_def,
            $a$coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), ''))$a$,
            $a$coalesce(v.address, loc.address)$a$);
        else
          v_mut := replace(v_def, $a$'id',                  g.id,$a$, $a$'id', g.id, 'address', v.address,$a$);
        end if;
        if v_mut = v_def then raise exception 'MUTANT_NOOP'; end if;
        execute v_mut;
      end if;

      v_m := pg_temp.h100_run();
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      raise exception 'H100_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (text to replace not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H100_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  begin
    v_m := pg_temp.h100_run();
    v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');
    raise exception 'H100_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H100_ROLLBACK' then
      v_out := v_out || format(E'AFTER MUTANTS → CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  -- ALWAYS raise: this is what rolls everything back, migration included.
  raise exception '%', v_out;
end;
$h100$;
