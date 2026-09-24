-- SQL-level harness for migration 0090 (recipient sees countered games).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): what is under
-- test is WHERE clauses inside SECURITY DEFINER functions reached by `anon`. The
-- fake Supabase client cannot run them and service_role has no DML on
-- games/teams/divisions/leagues. NOT `npm run`-able, NOT in CI.
--
-- SPLIT: this file proves WHICH ROWS each RPC emits. What the page, invite
-- screen and email DO with them is `npm run sim:recipient-schedule`.
--
-- HOW TO RUN: ONE batch = the text of
--   supabase/migrations/0090_recipient_sees_countered_games.sql
-- followed by this file. (After 0090 is applied for real, this file alone.)
-- The DO block ALWAYS raises, so the whole batch — the migration's
-- `create or replace` included — rolls back. Leak check afterwards: live
-- md5(prosrc) of both functions unchanged, zero HARNESS-0090 rows.
--
-- MUTANTS RUN IN THE SAME BATCH. Pass 0 is the baseline and must be clean.
-- Each later pass rewrites ONE function via
-- `execute replace(pg_get_functiondef(...), old, new)`, re-runs every
-- assertion, records the failing assertion TAGS, then restores the original
-- definition. A mutant is KILLED only if its named target tag is among its
-- failures (CLAUDE.md: killed by the assertion written to catch it, not merely
-- by something). A mutant whose replace() changes nothing FAILS the run, so a
-- stale mutant cannot pass silently.

do $harness$
declare
  v_owner    uuid;
  v_league   uuid := gen_random_uuid();
  v_league2  uuid := gen_random_uuid();
  v_div      uuid := gen_random_uuid();
  v_team     uuid := gen_random_uuid();
  v_team2    uuid := gen_random_uuid();
  v_venue    uuid := gen_random_uuid();
  v_org      uuid := gen_random_uuid();
  v_org2     uuid := gen_random_uuid();
  g_sched    uuid := gen_random_uuid();
  g_resched  uuid := gen_random_uuid();
  g_counter  uuid := gen_random_uuid();
  g_ctr_away uuid := gen_random_uuid();
  g_unanswer uuid := gen_random_uuid();
  g_cancel   uuid := gen_random_uuid();
  g_otherorg uuid := gen_random_uuid();
  g_otherssn uuid := gen_random_uuid();
  v_sched_tok text := 'HARNESS-0090-SCHED';
  j          jsonb;
  ids        text[];
  out        text := '';
  total_fail int := 0;
  -- per-pass
  f          text[];
  -- mutants: function, old text, new text, target tag
  m_fn   text[] := array[
    'public.get_interleague_schedule_by_token(text)',
    'public.get_interleague_schedule_by_token(text)',
    'public.get_interleague_invite_by_token(text)'
  ];
  m_old  text[] := array[
    E'        and g.status = ''pending_interleague''\n        and g.external_team_name is not null\n    )\n  ) into v_result;',
    E'and g.status in (''scheduled'', ''reschedule_pending'')',
    E'''schedule_token'',  v_invite.schedule_token'
  ];
  m_new  text[] := array[
    E'        and g.status = ''pending_interleague''\n    )\n  ) into v_result;',
    E'and g.status = ''scheduled''',
    E'''schedule_token'',  (select i2.schedule_token from public.interleague_invites i2 where i2.season_id = v_invite.season_id and i2.interleague_org_id = v_invite.interleague_org_id and i2.schedule_token is not null limit 1)'
  ];
  m_tag  text[] := array['W1', 'S2', 'I4'];
  m_name text[] := array[
    'SM1 countered_games drops the external_team_name guard (exposes unanswered games)',
    'SM2 games filter reverts to scheduled only (reschedule_pending vanishes)',
    'SM3 pending invite leaks a sibling accepted invite''s schedule token'
  ];
  orig_def   text;
  mut_def    text;
  pass       int;
  -- anti-vacuity counters (baseline pass only): a ZERO fails the run
  c_resched_included    int := 0;
  c_countered_included  int := 0;
  c_unanswered_excluded int := 0;
  c_cancelled_excluded  int := 0;
  c_other_pair_excluded int := 0;
  c_pending_no_token    int := 0;
begin
  ---------------------------------------------------------------- fixtures
  select id into v_owner from profiles order by created_at limit 1;

  insert into leagues(id, owner_id, name, sport, season, start_date, end_date)
    values (v_league,  v_owner, 'HARNESS-0090',   'baseball', 'HARNESS', '2026-09-01', '2026-11-30'),
           (v_league2, v_owner, 'HARNESS-0090-B', 'baseball', 'HARNESS', '2026-09-01', '2026-11-30');
  insert into divisions(id, league_id, name, settings)
    values (v_div, v_league, 'HARNESS-0090-DIV', '{"game_duration": 90}'::jsonb);
  insert into teams(id, league_id, division_id, name)
    values (v_team,  v_league,  v_div, 'HARNESS-0090-T'),
           (v_team2, v_league2, v_div, 'HARNESS-0090-T2');
  insert into venues(id, owner_id, name, availability, availability_configured)
    values (v_venue, v_owner, 'HARNESS-0090-FIELD', '{}'::jsonb, true);
  insert into interleague_orgs(id, owner_id, name, admin_email)
    values (v_org,  v_owner, 'HARNESS-0090-ORG',  'harness-0090@example.invalid'),
           (v_org2, v_owner, 'HARNESS-0090-ORG2', 'harness-0090b@example.invalid');
  insert into interleague_invites(token, sender_user_id, interleague_org_id,
                                  season_id, recipient_email, status, schedule_token)
    values ('HARNESS-0090-INV-ACC',  v_owner, v_org, v_league,
            'harness-0090@example.invalid', 'accepted', v_sched_tok),
           ('HARNESS-0090-INV-PEND', v_owner, v_org, v_league,
            'harness-0090@example.invalid', 'pending', null);

  insert into games(id, league_id, home_team_id, venue_id, scheduled_at, status,
                    interleague_org_id, is_away, external_team_name,
                    proposed_scheduled_at, proposed_venue_name)
  values
    (g_sched,    v_league,  v_team,  v_venue, '2026-10-03T10:00:00+00', 'scheduled',           v_org,  false, 'Rockies', null, null),
    (g_resched,  v_league,  v_team,  v_venue, '2026-10-10T10:00:00+00', 'reschedule_pending',  v_org,  false, 'Rockies', null, null),
    (g_counter,  v_league,  v_team,  v_venue, '2026-10-17T10:00:00+00', 'pending_interleague', v_org,  false, 'Rockies', '2026-10-18T13:00:00+00', null),
    (g_ctr_away, v_league,  v_team,  null,    '2026-10-19T10:00:00+00', 'pending_interleague', v_org,  true,  'Rockies', null, 'Riverside Field A'),
    (g_unanswer, v_league,  v_team,  v_venue, '2026-10-24T10:00:00+00', 'pending_interleague', v_org,  false, null,      null, null),
    (g_cancel,   v_league,  v_team,  v_venue, '2026-10-31T10:00:00+00', 'cancelled',           v_org,  false, 'Rockies', null, null),
    (g_otherorg, v_league,  v_team,  v_venue, '2026-11-07T10:00:00+00', 'pending_interleague', v_org2, false, 'Others',  '2026-11-08T10:00:00+00', null),
    (g_otherssn, v_league2, v_team2, v_venue, '2026-11-14T10:00:00+00', 'scheduled',           v_org,  false, 'Rockies', null, null);

  for pass in 0 .. array_length(m_fn, 1) loop
    if pass > 0 then
      orig_def := pg_get_functiondef(m_fn[pass]::regprocedure);
      mut_def  := replace(orig_def, m_old[pass], m_new[pass]);
      if mut_def = orig_def then
        total_fail := total_fail + 1;
        out := out || format(E'STALE %s: replace() matched nothing\n', m_name[pass]);
        continue;
      end if;
      execute mut_def;
    end if;
    f := array[]::text[];

    ------------------------------------------------------------ schedule RPC
    j := get_interleague_schedule_by_token('HARNESS-0090-NOPE');
    if j is not null then f := f || 'S0'::text; end if;

    j := get_interleague_schedule_by_token(v_sched_tok);

    select array_agg(e->>'id' order by e->>'scheduled_at') into ids
      from jsonb_array_elements(j->'games') e;
    if ids is distinct from array[g_sched::text, g_resched::text] then f := f || 'S1'::text; end if;

    -- S2: a confirmed game with a reschedule request outstanding stays visible.
    if exists (select 1 from jsonb_array_elements(j->'games') e
               where e->>'id' = g_resched::text and e->>'status' = 'reschedule_pending') then
      if pass = 0 then c_resched_included := c_resched_included + 1; end if;
    else f := f || 'S2'::text; end if;

    if not exists (select 1 from jsonb_array_elements(j->'games') e
                   where e->>'id' = g_sched::text and e->>'status' = 'scheduled') then
      f := f || 'S3'::text; end if;

    -- S4: countered_games is exactly the two countered games.
    select array_agg(e->>'id' order by e->>'id') into ids
      from jsonb_array_elements(j->'countered_games') e;
    if ids is distinct from (select array_agg(x order by x) from unnest(array[g_counter::text, g_ctr_away::text]) x) then
      f := f || 'S4'::text;
    elsif pass = 0 then c_countered_included := c_countered_included + 2; end if;

    if not exists (select 1 from jsonb_array_elements(j->'countered_games') e
                   where e->>'id' = g_counter::text and (e->>'proposed_scheduled_at') is not null
                     and e->>'status' = 'pending_interleague') then
      f := f || 'S5'::text; end if;
    if not exists (select 1 from jsonb_array_elements(j->'countered_games') e
                   where e->>'id' = g_ctr_away::text and e->>'proposed_venue_name' = 'Riverside Field A'
                     and (e->'venue') = 'null'::jsonb) then
      f := f || 'S6'::text; end if;

    -- W1 ANTI-WIDENING: an unanswered pending game appears nowhere.
    if exists (select 1 from jsonb_array_elements(coalesce(j->'countered_games','[]') || coalesce(j->'games','[]')) e
               where e->>'id' = g_unanswer::text) then
      f := f || 'W1'::text;
    elsif pass = 0 then c_unanswered_excluded := c_unanswered_excluded + 1; end if;
    -- W2: cancelled appears in NEITHER of the keys 0090 owns. Since 0092 a
    -- cancelled game IS emitted, in its own `cancelled_games` key — this
    -- assertion is about those two keys only and stays true. See
    -- scripts/sim/cancelled-visibility-rpc-sim.sql.
    if exists (select 1 from jsonb_array_elements(coalesce(j->'countered_games','[]') || coalesce(j->'games','[]')) e
               where e->>'id' = g_cancel::text) then
      f := f || 'W2'::text;
    elsif pass = 0 then c_cancelled_excluded := c_cancelled_excluded + 1; end if;
    -- W3: another org's or season's game appears nowhere.
    if exists (select 1 from jsonb_array_elements(coalesce(j->'countered_games','[]') || coalesce(j->'games','[]')) e
               where e->>'id' in (g_otherorg::text, g_otherssn::text)) then
      f := f || 'W3'::text;
    elsif pass = 0 then c_other_pair_excluded := c_other_pair_excluded + 2; end if;

    if j->'sender' is null or not (j->'sender' ? 'org_name') then f := f || 'S7'::text; end if;

    ------------------------------------------------------------ invite RPC
    j := get_interleague_invite_by_token('HARNESS-0090-INV-ACC');
    if j->'invite'->>'schedule_token' is distinct from v_sched_tok then f := f || 'I1'::text; end if;
    if (j->>'countered_game_count')::int is distinct from 2 then f := f || 'I2'::text; end if;
    if (j->>'scheduled_game_count')::int is distinct from 1 then f := f || 'I3'::text; end if;

    j := get_interleague_invite_by_token('HARNESS-0090-INV-PEND');
    -- I4: a pending invite exposes no schedule token (key present, value null).
    if (j->'invite' ? 'schedule_token') and (j->'invite'->'schedule_token') = 'null'::jsonb then
      if pass = 0 then c_pending_no_token := c_pending_no_token + 1; end if;
    else f := f || 'I4'::text; end if;
    -- I5: the invite form still lists every pending game of the pair (unchanged).
    if jsonb_array_length(j->'games') is distinct from 3 then f := f || 'I5'::text; end if;

    ------------------------------------------------------------ record pass
    if pass = 0 then
      if cardinality(f) > 0 then
        total_fail := total_fail + cardinality(f);
        out := out || format(E'BASELINE FAIL %s\n', f);
      else
        out := out || E'BASELINE PASS\n';
      end if;
    else
      if m_tag[pass] = any(f) then
        out := out || format(E'KILLED  %s — by %s (all failures: %s)\n', m_name[pass], m_tag[pass], f);
      else
        total_fail := total_fail + 1;
        out := out || format(E'SURVIVED %s — target %s not among failures %s\n', m_name[pass], m_tag[pass], f);
      end if;
      execute orig_def;  -- restore before the next pass
    end if;
  end loop;

  ---------------------------------------------------------------- counters
  if c_resched_included    = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_resched_included\n'; end if;
  if c_countered_included  = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_countered_included\n'; end if;
  if c_unanswered_excluded = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_unanswered_excluded\n'; end if;
  if c_cancelled_excluded  = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_cancelled_excluded\n'; end if;
  if c_other_pair_excluded = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_other_pair_excluded\n'; end if;
  if c_pending_no_token    = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_pending_no_token\n'; end if;
  out := out || format(E'counters resched=%s countered=%s unanswered_excl=%s cancel_excl=%s other_pair_excl=%s pending_no_token=%s\n',
    c_resched_included, c_countered_included, c_unanswered_excluded, c_cancelled_excluded, c_other_pair_excluded, c_pending_no_token);
  out := out || case when total_fail = 0 then 'RESULT PASS' else format('RESULT FAIL (%s)', total_fail) end;

  -- ALWAYS raise: carries results out and rolls the whole batch back.
  raise exception E'HARNESS-0090\n%', out;
end
$harness$;

-- ── Run log ──────────────────────────────────────────────────────────────────
--
-- 2026-09-15, BEFORE 0090 was applied (batch = migration text + this file):
--   BASELINE PASS
--   KILLED SM1 countered_games drops the external_team_name guard — by W1
--          (all failures {S4,W1})
--   KILLED SM2 games filter reverts to scheduled only — by S2 (all {S1,S2})
--   KILLED SM3 pending invite leaks a sibling's schedule token — by I4 (only I4)
--   counters resched=1 countered=2 unanswered_excl=1 cancel_excl=1
--            other_pair_excl=2 pending_no_token=1
--   Leak check: both functions' md5(prosrc) still the 0087 values
--   (90106a22… / a5b2ecd2…) — the batch's DDL rolled back; zero HARNESS-0090
--   rows; games total 663 unchanged.
--
-- 0090 then applied verbatim via apply_migration. Live md5(prosrc):
--   get_interleague_schedule_by_token 7734ce5bad13521aedd8515fd5c99b52
--   get_interleague_invite_by_token   69894219b2d7d35ca7bd49b8a5dabb64
-- both equal to the repo file's bodies; EXECUTE grants unchanged.
-- Live read: the QA-Riverside Fall 2026 accepted invite's schedule now returns
-- its 2 countered games (2026-09-09 → 09-29, 2026-09-05 → 09-30); every other
-- accepted pair's `games` count unchanged (no live reschedule_pending rows).
