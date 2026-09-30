-- SQL-level proof for migration 0099 (team calendar links + org timezone).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- is a partial unique index, three triggers, SECURITY DEFINER functions, RLS
-- and column grants, exercised as `authenticated` and `anon`. The in-memory
-- fake client cannot model any of it. NOT `npm run`-able, NOT in CI.
--
-- THIS HARNESS APPLIES 0099 ITSELF, INSIDE A TRANSACTION THAT ALWAYS ROLLS
-- BACK. It is the proof to run BEFORE the migration is applied for real. It
-- leaves nothing behind: no column, no table, no trigger, no row.
--
-- HOW TO RUN
--   1. `npx tsx scripts/sim/team-calendar-links-build.ts > <file>` substitutes
--      the LITERAL text of supabase/migrations/0099_team_calendar_links.sql
--      for the placeholder line below.
--   2. Send the output as ONE batch through the Supabase MCP (execute_sql).
--      A batch runs in a single transaction (probed 2026-09-29).
--   3. The last statement ALWAYS raises. The raised message IS the result.
--   RUN ONLY BETWEEN 5PM AND 3AM PACIFIC — see S8 below. Get an explicit
--   go-ahead first.
--
-- LOCKS HELD FOR THE LENGTH OF THE RUN (expected: a few seconds)
--   ACCESS EXCLUSIVE on public.profiles (ADD COLUMN — no rewrite, but the
--   lock BLOCKS READS AND WRITES of profiles: every dashboard page load
--   reads profiles, so the app stalls for the run).
--   SHARE ROW EXCLUSIVE on public.divisions and public.teams (CREATE
--   TRIGGER — blocks writes, not reads).
--   lock_timeout = 3s: the run gives up rather than queue behind a writer.
--   statement_timeout = 60s bounds the whole thing.
--
-- ROWS TOUCHED (all rolled back): the "test" org (bbf9afe1…, Elite, season
-- "QA Fall 2026"): its profile row (plan, timezone), its season row
-- (archived_at, end_date), one division (locked on/off), two of its teams
-- (contact_email), one of its games (notes, home_score), plus scratch teams
-- and games named HARNESS-0099. The "Test 2" org's owner id is used as the
-- NON-member caller; nothing of Test 2's is written. The backfill also creates
-- (rolled-back) links for the live locked divisions of other orgs — reads
-- only, no row of theirs is changed.
--
-- IMPERSONATION: `set local role authenticated` + request.jwt.claims.sub,
-- exactly what PostgREST does. Assertions read back as postgres.
--
-- ALWAYS-DIFFERING VALUES: every refusal is tested with an expression that
-- differs from what the row holds (`not comped`-style), never a literal the
-- row might already hold — the 0098 run 1 lesson.
--
-- ASSERTIONS (in order — a mutant must die FIRST at its own tag)
--   B1   backfill: no team in a live locked division lacks exactly one
--        current link; at least one such team exists
--   B2   locking test division D1 gives EVERY team in it exactly one active
--        link, 64 hex chars, created_by null
--   B3   the unlocked division D2 has no links
--   P1   team A's pending interleague game is NOT in the reader's output
--   C1   team A's cancelled game IS, with status cancelled
--   L1   planted note, coach name/email, team contact_email and score never
--        appear anywhere in the reader's output (by text scan)
--   L2   every key of every game object, and of the top level, is on the
--        allowlist
--   R1   team A's token returns exactly the games team A is in (count) and
--        nothing else (every game names A on one side)
--   R2   a D1 game without A, and every game of the other org, are absent
--   X1   history is kept: a 'replaced' row can coexist with the current row
--        for the same team (the partial index's predicate)
--   S1   malformed tokens → unknown (short, uppercase hex, null)
--   S2   regenerate: new token works, old token → revoked, in one transaction
--   S3   turn off → off; old token → off; unlock + relock creates NO new link
--   S4   turn on → a NEW token; the turned-off token → revoked
--   S5   unlocked division → unlocked
--   S6   Free org → plan; and regenerate → plan_required, turn off still ok
--   S7   archived season → expired
--   S8   expiry in the ORG's zone (Honolulu): end date = today−8 → expired,
--        today−7 → ok. Requires the Honolulu date to differ from the UTC
--        date (5pm–3am Pacific), asserted as S8-window
--   T1   a team inserted into locked D1 gets a link
--   T2   a team inserted into unlocked D2 gets none; moving it into D1 gives
--        one; a team moved into unlocked D3 gets none
--   Z1   set_org_timezone by an org member succeeds and is read back
--   Z2   by a non-member → not_authorized
--   Z3   an invalid zone → invalid_timezone
--   Z4   a direct UPDATE of profiles.timezone as authenticated is refused
--   A1   anon holds EXECUTE on the reader ONLY; authenticated on the reader
--        and the three admin functions ONLY; nobody on the internals
--   A2   anon calling regenerate → 42501; a non-member calling it → 42501
--
-- MUTANTS — each in its own rolled-back block, KILLED only if its FIRST
-- failure is its own tag:
--   CM1  pending filter removed from the reader              → P1
--   CM2  reader returns to_jsonb(g) beside the named columns → L1
--   CM3  expiry computed with current_date                   → S8
--   CM4  anon granted EXECUTE on regenerate                  → A1
--   CM5  partial index predicate removed                     → X1
--
-- RUN LOG: not yet run.

select set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '60s', true);

-- Run one SQL string as a role; report OK/ERR; always return to postgres.
create function pg_temp.h99_try(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $fn$
declare
  v_n   integer;
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end,
    true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    v_out := 'OK rows=' || v_n;
  exception when others then
    v_out := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$fn$;

-- Run a SELECT returning one jsonb as a role; {ok, result} or {ok:false, err}.
create function pg_temp.h99_call(p_role text, p_uid uuid, p_sql text)
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

-- Current token of a team (as postgres).
create function pg_temp.h99_token(p_team uuid)
returns text
language sql
as $fn$
  select token from public.team_calendar_links
   where team_id = p_team and status <> 'replaced';
$fn$;

-- The reader, called as anon with a token.
create function pg_temp.h99_read(p_token text)
returns jsonb
language plpgsql
as $fn$
declare
  v jsonb;
begin
  v := pg_temp.h99_call('anon', null,
         format('select public.get_team_calendar_by_token(%L)', p_token));
  if not (v ->> 'ok')::boolean then
    return jsonb_build_object('status', 'CALL-ERR', 'err', v ->> 'err');
  end if;
  return v -> 'result';
end;
$fn$;

-- Fixtures + every assertion. Returns { fails: [...], counters: {...} }.
-- Everything it writes is rolled back by the caller's block.
create function pg_temp.h99_run()
returns jsonb
language plpgsql
as $fn$
declare
  v_fails    text[] := array[]::text[];
  c          jsonb := '{}'::jsonb;
  v_org      uuid;      -- "test" org = its owner's profile id
  v_owner    uuid;      -- same id, as a user
  v_other    uuid;      -- "Test 2" owner: a NON-member caller
  v_other_lg uuid;
  v_season   uuid;
  v_d1       uuid;  v_d2 uuid;  v_d3 uuid;
  v_a        uuid;  v_b uuid;   v_a_name text;
  v_g_pend   uuid;  v_g_canc uuid;  v_g_plant uuid;  v_g_noA uuid;
  v_tok      text;  v_tok2 text;  v_tok3 text;
  v_t        uuid;
  v_r        jsonb; v_call jsonb;
  v_res      text;
  v_n        integer; v_n2 integer;
  v_expected integer;
  v_today    date;
  v_txt      text;
  r          record;
  v_bad      text[];
  v_keys     text[];
  v_allow    constant text[] := array['id','scheduled_at','updated_at','status','is_away',
    'home_team_id','away_team_id','external_team_name','proposed_venue_name',
    'home_team','away_team','venue'];
begin
  -- ── setup ────────────────────────────────────────────────────────────────
  select id into v_org from public.profiles where org_name = 'test';
  v_owner := v_org;
  select id into v_other from public.profiles where org_name = 'Test 2';
  select id into v_season from public.leagues where owner_id = v_org and archived_at is null
   order by created_at desc limit 1;
  select id into v_other_lg from public.leagues where owner_id = v_other and archived_at is null
   order by created_at desc limit 1;
  if v_org is null or v_other is null or v_season is null or v_other_lg is null then
    raise exception 'H99 SETUP: test orgs/seasons not found';
  end if;

  -- D1: the test division with the most games; D2, D3: two others (unlocked).
  select d.id into v_d1 from public.divisions d
   where d.league_id = v_season
   order by (select count(*) from public.games g join public.teams t on t.id = g.home_team_id
              where t.division_id = d.id) desc, d.created_at limit 1;
  select d.id into v_d2 from public.divisions d where d.league_id = v_season and d.id <> v_d1
   order by d.created_at limit 1;
  select d.id into v_d3 from public.divisions d where d.league_id = v_season and d.id not in (v_d1, v_d2)
   order by d.created_at limit 1;
  if v_d1 is null or v_d2 is null or v_d3 is null then
    raise exception 'H99 SETUP: need three divisions in the test season';
  end if;
  update public.divisions set locked = false where id in (v_d1, v_d2, v_d3);

  -- A, B: two teams in D1 that play each other.
  select g.home_team_id, g.away_team_id into v_a, v_b
    from public.games g join public.teams t on t.id = g.home_team_id
   where t.division_id = v_d1 and g.away_team_id is not null
   order by g.scheduled_at limit 1;
  if v_a is null or v_b is null then
    raise exception 'H99 SETUP: D1 has no game with two teams';
  end if;
  select name into v_a_name from public.teams where id = v_a;

  -- Plant what must never leak. Different from whatever is there.
  select id into v_g_plant from public.games where home_team_id = v_a order by scheduled_at limit 1;
  update public.games
     set notes = 'PLANTED-NOTE-99 lights out', home_score = 987654321
   where id = v_g_plant;
  update public.teams set contact_email = 'planted-99@example.test' where id in (v_a, v_b);
  update public.divisions
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{teams}',
           coalesce(settings -> 'teams', '[]'::jsonb)
           || '[{"name":"PLANTED-TEAM","coach_name":"PLANTED-COACH-99","coach_email":"planted-coach-99@example.test"}]'::jsonb)
   where id = v_d1;

  -- Scratch games for A: one pending interleague, one cancelled.
  insert into public.games (league_id, home_team_id, away_team_id, scheduled_at, status, external_team_name)
  values (v_season, v_a, null, '2026-12-05T10:00:00+00:00', 'pending_interleague', 'HARNESS-0099 Pending Partner')
  returning id into v_g_pend;
  insert into public.games (league_id, home_team_id, away_team_id, scheduled_at, status)
  values (v_season, v_a, v_b, '2026-12-06T10:00:00+00:00', 'cancelled')
  returning id into v_g_canc;
  -- A D1 game WITHOUT team A (for R2): between B and a third D1 team.
  select id into v_t from public.teams where division_id = v_d1 and id not in (v_a, v_b) limit 1;
  if v_t is null then
    raise exception 'H99 SETUP: D1 needs a third team';
  end if;
  insert into public.games (league_id, home_team_id, away_team_id, scheduled_at, status)
  values (v_season, v_b, v_t, '2026-12-07T10:00:00+00:00', 'scheduled')
  returning id into v_g_noA;

  -- ── B: backfill and automatic creation ───────────────────────────────────
  select count(*) into v_n
    from public.teams t join public.divisions d on d.id = t.division_id
   where d.locked
     and (select count(*) from public.team_calendar_links k where k.team_id = t.id and k.status <> 'replaced') <> 1;
  select count(*) into v_n2
    from public.teams t join public.divisions d on d.id = t.division_id where d.locked;
  if v_n <> 0 or v_n2 = 0 then
    v_fails := array_append(v_fails, format('B1: %s team(s) in live locked divisions without exactly one link (of %s)', v_n, v_n2));
  end if;
  c := c || jsonb_build_object('backfilled_teams', v_n2);

  update public.divisions set locked = true where id = v_d1;   -- the lock trigger
  select count(*) into v_n2 from public.teams where division_id = v_d1;
  select count(*) into v_n
    from public.teams t
   where t.division_id = v_d1
     and (select count(*) from public.team_calendar_links k
           where k.team_id = t.id and k.status = 'active' and k.created_by is null
             and k.token ~ '^[0-9a-f]{64}$') = 1
     and (select count(*) from public.team_calendar_links k where k.team_id = t.id) = 1;
  if v_n <> v_n2 or v_n2 = 0 then
    v_fails := array_append(v_fails, format('B2: %s of %s D1 teams got exactly one active link on lock', v_n, v_n2));
  end if;
  c := c || jsonb_build_object('linked_on_lock', v_n);

  select count(*) into v_n from public.team_calendar_links k join public.teams t on t.id = k.team_id
   where t.division_id = v_d2;
  if v_n <> 0 then
    v_fails := array_append(v_fails, format('B3: unlocked D2 has %s link(s)', v_n));
  end if;

  -- ── P / C / L / R: the reader ────────────────────────────────────────────
  v_tok := pg_temp.h99_token(v_a);
  v_r := pg_temp.h99_read(v_tok);
  if v_r ->> 'status' <> 'ok' then
    v_fails := array_append(v_fails, 'R0: reader did not return ok: ' || v_r::text);
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(v_r -> 'games', '[]'::jsonb)) g where g ->> 'id' = v_g_pend::text) then
    v_fails := array_append(v_fails, 'P1: the pending interleague game is in the feed');
  else
    c := c || jsonb_build_object('pending_excluded', 1);
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_r -> 'games', '[]'::jsonb)) g
                  where g ->> 'id' = v_g_canc::text and g ->> 'status' = 'cancelled') then
    v_fails := array_append(v_fails, 'C1: the cancelled game is missing or not marked cancelled');
  else
    c := c || jsonb_build_object('cancelled_included', 1);
  end if;

  v_txt := lower(v_r::text);
  v_bad := array[]::text[];
  foreach v_res in array array['planted-note-99', 'lights out', 'planted-coach-99', 'planted-99@example.test',
                                'planted-coach-99@example.test', '987654321', 'contact_email', 'notes'] loop
    if position(v_res in v_txt) > 0 then v_bad := array_append(v_bad, v_res); end if;
  end loop;
  if array_length(v_bad, 1) is not null then
    v_fails := array_append(v_fails, 'L1: planted data in the feed: ' || array_to_string(v_bad, ' | '));
  end if;
  c := c || jsonb_build_object('planted_scanned', 8);

  select array_agg(distinct k) into v_keys
    from jsonb_array_elements(coalesce(v_r -> 'games', '[]'::jsonb)) g, jsonb_object_keys(g) k;
  select array_agg(k) into v_bad from unnest(v_keys) k where not (k = any (v_allow));
  if v_bad is not null or v_keys is null then
    v_fails := array_append(v_fails, 'L2: game keys off the allowlist: ' || coalesce(array_to_string(v_bad, ','), '(no games)'));
  end if;
  select array_agg(k) into v_bad from jsonb_object_keys(v_r) k
   where not (k = any (array['status','team','division','season','org','games']));
  if v_bad is not null then
    v_fails := array_append(v_fails, 'L2: top-level keys off the allowlist: ' || array_to_string(v_bad, ','));
  end if;

  select count(*) into v_expected from public.games g
   where g.league_id = v_season and (g.home_team_id = v_a or g.away_team_id = v_a)
     and g.status <> 'pending_interleague';
  select count(*) into v_n from jsonb_array_elements(coalesce(v_r -> 'games', '[]'::jsonb));
  if v_n <> v_expected or v_expected = 0
     or exists (select 1 from jsonb_array_elements(coalesce(v_r -> 'games', '[]'::jsonb)) g
                 where g ->> 'home_team_id' <> v_a::text and coalesce(g ->> 'away_team_id', '') <> v_a::text)
     or v_r -> 'team' ->> 'id' <> v_a::text
  then
    v_fails := array_append(v_fails, format('R1: expected %s games all naming team A, got %s', v_expected, v_n));
  end if;
  c := c || jsonb_build_object('games_returned', v_n);

  if exists (select 1 from jsonb_array_elements(coalesce(v_r -> 'games', '[]'::jsonb)) g where g ->> 'id' = v_g_noA::text)
     or exists (select 1 from jsonb_array_elements(coalesce(v_r -> 'games', '[]'::jsonb)) g
                  join public.games og on og.id = (g ->> 'id')::uuid
                 where og.league_id = v_other_lg)
  then
    v_fails := array_append(v_fails, 'R2: a game without team A, or another org''s game, is in the feed');
  end if;

  -- ── X: the partial index keeps history ───────────────────────────────────
  begin
    insert into public.team_calendar_links (team_id, status) values (v_a, 'replaced');
    c := c || jsonb_build_object('history_row_inserted', 1);
  exception when others then
    v_fails := array_append(v_fails, 'X1: a replaced row cannot coexist with the current one: ' || sqlerrm);
  end;

  -- ── S: statuses ──────────────────────────────────────────────────────────
  if (pg_temp.h99_read('abc') ->> 'status') <> 'unknown'
     or (pg_temp.h99_read(upper(v_tok)) ->> 'status') <> 'unknown'
     or (pg_temp.h99_read(left(v_tok, 63)) ->> 'status') <> 'unknown'
     or (pg_temp.h99_read(null) ->> 'status') <> 'unknown' then
    v_fails := array_append(v_fails, 'S1: a malformed token did not read as unknown');
  end if;

  v_call := pg_temp.h99_call('authenticated', v_owner,
              format('select public.regenerate_team_calendar_link(%L)', v_a));
  v_tok2 := v_call -> 'result' ->> 'token';
  if not (v_call ->> 'ok')::boolean or v_tok2 is null or v_tok2 = v_tok
     or (pg_temp.h99_read(v_tok) ->> 'status') <> 'revoked'
     or (pg_temp.h99_read(v_tok2) ->> 'status') <> 'ok'
     or pg_temp.h99_token(v_a) <> v_tok2 then
    v_fails := array_append(v_fails, 'S2: regenerate: ' || v_call::text);
  else
    c := c || jsonb_build_object('regenerated', 1);
  end if;

  v_call := pg_temp.h99_call('authenticated', v_owner,
              format('select public.set_team_calendar_link_enabled(%L, false)', v_a));
  update public.divisions set locked = false where id = v_d1;
  update public.divisions set locked = true  where id = v_d1;   -- relock: must NOT resurrect
  select count(*) into v_n from public.team_calendar_links where team_id = v_a and status <> 'replaced';
  if not (v_call ->> 'ok')::boolean or (v_call -> 'result' ->> 'status') <> 'off'
     or (pg_temp.h99_read(v_tok2) ->> 'status') <> 'off'
     or v_n <> 1 or (select status from public.team_calendar_links where team_id = v_a and status <> 'replaced') <> 'off' then
    v_fails := array_append(v_fails, format('S3: turn off / relock: %s, current rows=%s', v_call::text, v_n));
  else
    c := c || jsonb_build_object('turned_off', 1);
  end if;

  v_call := pg_temp.h99_call('authenticated', v_owner,
              format('select public.set_team_calendar_link_enabled(%L, true)', v_a));
  v_tok3 := v_call -> 'result' ->> 'token';
  if not (v_call ->> 'ok')::boolean or v_tok3 is null or v_tok3 in (v_tok, v_tok2)
     or (pg_temp.h99_read(v_tok2) ->> 'status') <> 'revoked'
     or (pg_temp.h99_read(v_tok3) ->> 'status') <> 'ok' then
    v_fails := array_append(v_fails, 'S4: turn on: ' || v_call::text);
  end if;

  update public.divisions set locked = false where id = v_d1;
  if (pg_temp.h99_read(v_tok3) ->> 'status') <> 'unlocked' then
    v_fails := array_append(v_fails, 'S5: unlocked division did not read as unlocked');
  end if;
  update public.divisions set locked = true where id = v_d1;

  update public.profiles set plan = 'free' where id = v_org;
  v_call := pg_temp.h99_call('authenticated', v_owner,
              format('select public.regenerate_team_calendar_link(%L)', v_a));
  if (pg_temp.h99_read(v_tok3) ->> 'status') <> 'plan'
     or (v_call ->> 'ok')::boolean or v_call ->> 'err' not like '%plan_required%' then
    v_fails := array_append(v_fails, 'S6: free org: ' || v_call::text);
  end if;
  v_call := pg_temp.h99_call('authenticated', v_owner,
              format('select public.set_team_calendar_link_enabled(%L, false)', v_a));
  if not (v_call ->> 'ok')::boolean then
    v_fails := array_append(v_fails, 'S6: free org cannot turn off: ' || v_call::text);
  end if;
  -- Restore: the turn-off left tok3's row 'off'; put it back to 'active'
  -- directly (as postgres) rather than re-inserting the same token.
  update public.team_calendar_links set status = 'active' where token = v_tok3;
  update public.profiles set plan = 'elite' where id = v_org;
  if (pg_temp.h99_read(v_tok3) ->> 'status') <> 'ok' then
    v_fails := array_append(v_fails, 'S6: plan restored but reader not ok');
  end if;

  update public.leagues set archived_at = now() where id = v_season;
  if (pg_temp.h99_read(v_tok3) ->> 'status') <> 'expired' then
    v_fails := array_append(v_fails, 'S7: archived season did not read as expired');
  end if;
  update public.leagues set archived_at = null where id = v_season;

  -- Expiry in the ORG's zone. Honolulu is UTC−10: its date differs from the
  -- UTC date between 00:00 and 10:00 UTC (5pm–3am Pacific during PDT).
  update public.profiles set timezone = 'Pacific/Honolulu' where id = v_org;
  v_today := (now() at time zone 'Pacific/Honolulu')::date;
  if v_today = current_date then
    v_fails := array_append(v_fails, 'S8-window: Honolulu date equals the UTC date right now — CM3 cannot be told apart; run between 5pm and 3am Pacific');
  end if;
  update public.leagues set end_date = v_today - 8 where id = v_season;
  if (pg_temp.h99_read(v_tok3) ->> 'status') <> 'expired' then
    v_fails := array_append(v_fails, 'S8: end date + 8 days (org zone) did not read as expired');
  end if;
  update public.leagues set end_date = v_today - 7 where id = v_season;
  if (pg_temp.h99_read(v_tok3) ->> 'status') <> 'ok' then
    v_fails := array_append(v_fails, 'S8: end date + 7 days (org zone) should still be ok, got ' || (pg_temp.h99_read(v_tok3) ->> 'status'));
  else
    c := c || jsonb_build_object('expiry_boundary_checked', 1);
  end if;

  -- ── T: teams joining ─────────────────────────────────────────────────────
  insert into public.teams (league_id, name, division_id) values (v_season, 'HARNESS-0099 T1', v_d1) returning id into v_t;
  if pg_temp.h99_token(v_t) is null then
    v_fails := array_append(v_fails, 'T1: a team inserted into locked D1 got no link');
  else
    c := c || jsonb_build_object('team_insert_linked', 1);
  end if;
  insert into public.teams (league_id, name, division_id) values (v_season, 'HARNESS-0099 T2', v_d2) returning id into v_t;
  if pg_temp.h99_token(v_t) is not null then
    v_fails := array_append(v_fails, 'T2: a team inserted into unlocked D2 got a link');
  end if;
  update public.teams set division_id = v_d1 where id = v_t;
  if pg_temp.h99_token(v_t) is null then
    v_fails := array_append(v_fails, 'T2: a team moved into locked D1 got no link');
  else
    c := c || jsonb_build_object('team_move_linked', 1);
  end if;
  insert into public.teams (league_id, name, division_id) values (v_season, 'HARNESS-0099 T3', v_d3) returning id into v_t;
  update public.teams set division_id = v_d2 where id = v_t;
  if pg_temp.h99_token(v_t) is not null then
    v_fails := array_append(v_fails, 'T2: a team moved into unlocked D2 got a link');
  end if;

  -- ── Z: set_org_timezone ──────────────────────────────────────────────────
  v_call := pg_temp.h99_call('authenticated', v_owner,
              format('select public.set_org_timezone(%L, %L)', v_org, 'America/Denver'));
  if not (v_call ->> 'ok')::boolean
     or (select timezone from public.profiles where id = v_org) <> 'America/Denver' then
    v_fails := array_append(v_fails, 'Z1: member could not set the timezone: ' || v_call::text);
  end if;
  v_call := pg_temp.h99_call('authenticated', v_other,
              format('select public.set_org_timezone(%L, %L)', v_org, 'America/Chicago'));
  if (v_call ->> 'ok')::boolean or v_call ->> 'err' not like '42501%'
     or (select timezone from public.profiles where id = v_org) <> 'America/Denver' then
    v_fails := array_append(v_fails, 'Z2: non-member was not refused: ' || v_call::text);
  end if;
  v_call := pg_temp.h99_call('authenticated', v_owner,
              format('select public.set_org_timezone(%L, %L)', v_org, 'Europe/London'));
  if (v_call ->> 'ok')::boolean or v_call ->> 'err' not like '22023%' then
    v_fails := array_append(v_fails, 'Z3: invalid zone was not refused: ' || v_call::text);
  end if;
  v_res := pg_temp.h99_try('authenticated', v_owner,
             format('update public.profiles set timezone = %L where id = %L', 'America/Chicago', v_org));
  if v_res not like 'ERR 42501%' or (select timezone from public.profiles where id = v_org) <> 'America/Denver' then
    v_fails := array_append(v_fails, 'Z4: direct timezone update was not refused: ' || v_res);
  end if;

  -- ── A: privileges ────────────────────────────────────────────────────────
  v_bad := array[]::text[];
  for r in
    select * from (values
      ('public.get_team_calendar_by_token(text)',               true,  true),
      ('public.set_org_timezone(uuid, text)',                   false, true),
      ('public.regenerate_team_calendar_link(uuid)',            false, true),
      ('public.set_team_calendar_link_enabled(uuid, boolean)',  false, true),
      ('public.ensure_team_calendar_links(uuid)',               false, false),
      ('public.team_calendar_admin_gate(uuid)',                 false, false),
      ('public.team_calendar_links_on_division_lock()',         false, false),
      ('public.team_calendar_links_on_team_change()',           false, false)
    ) as t(fn, want_anon, want_auth)
  loop
    if has_function_privilege('anon', r.fn, 'execute') <> r.want_anon then
      v_bad := array_append(v_bad, r.fn || ' anon');
    end if;
    if has_function_privilege('authenticated', r.fn, 'execute') <> r.want_auth then
      v_bad := array_append(v_bad, r.fn || ' authenticated');
    end if;
    if has_function_privilege('dashboard_readonly', r.fn, 'execute') then
      v_bad := array_append(v_bad, r.fn || ' dashboard_readonly');
    end if;
  end loop;
  if array_length(v_bad, 1) is not null then
    v_fails := array_append(v_fails, 'A1: ' || array_to_string(v_bad, '; '));
  end if;
  v_call := pg_temp.h99_call('anon', null, format('select public.regenerate_team_calendar_link(%L)', v_a));
  if (v_call ->> 'ok')::boolean or v_call ->> 'err' not like '42501%' then
    v_fails := array_append(v_fails, 'A2: anon could call regenerate: ' || v_call::text);
  end if;
  v_call := pg_temp.h99_call('authenticated', v_other, format('select public.regenerate_team_calendar_link(%L)', v_a));
  if (v_call ->> 'ok')::boolean or v_call ->> 'err' not like '42501%' then
    v_fails := array_append(v_fails, 'A2: non-member could call regenerate: ' || v_call::text);
  end if;
  if has_table_privilege('anon', 'public.team_calendar_links', 'SELECT')
     or has_table_privilege('dashboard_readonly', 'public.team_calendar_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.team_calendar_links', 'INSERT') then
    v_fails := array_append(v_fails, 'A3: table privileges wider than SELECT-for-authenticated');
  end if;

  return jsonb_build_object('fails', to_jsonb(v_fails), 'counters', c);
end;
$fn$;

do $h99$
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
  execute $mig99$
-- @@MIGRATION_0099@@
  $mig99$;

  -- Baseline, in its own rolled-back block.
  begin
    v_base := pg_temp.h99_run();
    raise exception 'H99_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H99_ROLLBACK' then
      v_base := jsonb_build_object('fails', jsonb_build_array('CRASH-baseline: ' || sqlstate || ' ' || sqlerrm), 'counters', '{}'::jsonb);
    end if;
  end;

  for k in select jsonb_object_keys(v_base -> 'counters') loop
    if (v_base -> 'counters' ->> k)::integer = 0 then v_zero := v_zero || ' ' || k; end if;
  end loop;
  foreach k in array array['backfilled_teams','linked_on_lock','pending_excluded','cancelled_included','planted_scanned',
                            'games_returned','history_row_inserted','regenerated','turned_off','expiry_boundary_checked',
                            'team_insert_linked','team_move_linked'] loop
    if not (v_base -> 'counters') ? k then v_zero := v_zero || ' ' || k || '(absent)'; end if;
  end loop;

  v_out := format(E'H99 RESULTS\nBASELINE failures: %s\nBASELINE counters: %s\nZERO/ABSENT counters:%s\n',
    v_base -> 'fails', v_base -> 'counters', case when v_zero = '' then ' none' else v_zero end);

  for m in
    select * from (values
      ('CM1', 'pending filter removed from the reader',              'P1', 'reader'),
      ('CM2', 'reader returns to_jsonb(g) beside the named columns', 'L1', 'reader'),
      ('CM3', 'expiry computed with current_date',                   'S8', 'reader'),
      ('CM4', 'anon granted EXECUTE on regenerate',                  'A1', 'grant'),
      ('CM5', 'partial index predicate removed',                     'X1', 'index')
    ) as t(id, what, target, kind)
  loop
    begin
      if m.kind = 'grant' then
        grant execute on function public.regenerate_team_calendar_link(uuid) to anon;
      elsif m.kind = 'index' then
        drop index public.team_calendar_links_one_current;
        create unique index team_calendar_links_one_current on public.team_calendar_links (team_id);
      else
        v_def := pg_get_functiondef('public.get_team_calendar_by_token(text)'::regprocedure);
        if m.id = 'CM1' then
          v_mut := replace(v_def,
            $a$     -- An unagreed interleague proposal never leaves the database.
     and g.status <> 'pending_interleague';$a$,
            $a$     ;$a$);
        elsif m.id = 'CM2' then
          v_mut := replace(v_def, $a$'id',                  g.id,$a$, $a$'id', g.id, 'raw', to_jsonb(g),$a$);
        else
          v_mut := replace(v_def, $a$v_today := (now() at time zone v_timezone)::date;$a$, $a$v_today := current_date;$a$);
        end if;
        if v_mut = v_def then raise exception 'MUTANT_NOOP'; end if;
        execute v_mut;
      end if;

      v_m := pg_temp.h99_run();
      v_first := v_m -> 'fails' ->> 0;
      v_tag := split_part(coalesce(v_first, '(none)'), ':', 1);
      v_out := v_out || format(E'%s %s → %s — first failure [%s], expected [%s]; %s failure(s): %s\n',
        m.id, m.what,
        case when v_first is null then 'SURVIVED'
             when v_tag = m.target then 'KILLED'
             else 'KILLED AT THE WRONG ASSERTION' end,
        v_tag, m.target, jsonb_array_length(v_m -> 'fails'), v_m -> 'fails');
      raise exception 'H99_ROLLBACK';
    exception when others then
      if sqlerrm = 'MUTANT_NOOP' then
        v_out := v_out || format(E'%s %s → MUTANT_NOOP (text to replace not found)\n', m.id, m.what);
      elsif sqlerrm <> 'H99_ROLLBACK' then
        v_out := v_out || format(E'%s %s → CRASH %s %s\n', m.id, m.what, sqlstate, sqlerrm);
      end if;
    end;
  end loop;

  begin
    v_m := pg_temp.h99_run();
    v_out := v_out || format(E'AFTER MUTANTS failures: %s\n', v_m -> 'fails');
    raise exception 'H99_ROLLBACK';
  exception when others then
    if sqlerrm <> 'H99_ROLLBACK' then
      v_out := v_out || format(E'AFTER MUTANTS → CRASH %s %s\n', sqlstate, sqlerrm);
    end if;
  end;

  -- ALWAYS raise: this is what rolls everything back, migration included.
  raise exception '%', v_out;
end;
$h99$;
