-- SQL-level harness for migration 0092 (partner sees CANCELLED games).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): what is under
-- test is a WHERE clause inside a SECURITY DEFINER function reached by `anon`.
-- The fake Supabase client cannot run it and service_role has no DML on
-- games/teams/divisions/leagues. NOT `npm run`-able, NOT in CI.
--
-- SPLIT, same as the 0090 pair: this file proves WHICH ROWS the RPC emits.
-- What the page DOES with them is `npm run sim:recipient-schedule`.
--
-- HOW TO RUN: one batch, this file alone (0092 is applied). To run it BEFORE
-- applying, prepend the text of
--   supabase/migrations/0092_recipient_sees_cancelled_games.sql
-- The DO block ALWAYS raises, so the whole batch — a prepended
-- `create or replace` included — rolls back. Leak check afterwards: live
-- md5(prosrc) unchanged, zero HARNESS-0092 rows.
--
-- MUTANTS RUN IN THE SAME BATCH. Pass 0 is the baseline and must be clean.
-- Each later pass rewrites the function via
-- `execute replace(pg_get_functiondef(...), old, new)`, re-runs every
-- assertion, records the failing TAGS, then restores the original definition.
-- A mutant is KILLED only if its named target tag is among its failures
-- (CLAUDE.md: killed by the assertion written to catch it, not merely by
-- something). A mutant whose replace() changes nothing FAILS the run.
--
-- THE TWO MUTANTS ARE THE TWO WAYS THIS CAN GO WRONG:
--   CM1 the new key's filter reverted (cancelled_games always empty) — the
--       defect itself, back again.
--   CM2 cancelled folded into `games` instead of its own key. That LOOKS like
--       a fix and is the thing 0092 refuses: `games` means "confirmed and
--       going ahead", and /api/invite/[token]/accept builds the acceptance
--       confirmation email from it, so a cancelled game there is listed to the
--       partner as one they just agreed to. C3 is the assertion that catches
--       it.

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
  g_unanswer uuid := gen_random_uuid();
  g_cancel   uuid := gen_random_uuid();
  g_cancel2  uuid := gen_random_uuid();
  g_cnclaway uuid := gen_random_uuid();
  g_otherorg uuid := gen_random_uuid();
  g_otherssn uuid := gen_random_uuid();
  v_sched_tok text := 'HARNESS-0092-SCHED';
  j          jsonb;
  ids        text[];
  out        text := '';
  total_fail int := 0;
  f          text[];
  m_old  text[] := array[
    E'        and g.status = ''cancelled''\n    )\n  ) into v_result;',
    E'and g.status in (''scheduled'', ''reschedule_pending'')'
  ];
  m_new  text[] := array[
    E'        and g.status = ''cancelled'' and false\n    )\n  ) into v_result;',
    E'and g.status in (''scheduled'', ''reschedule_pending'', ''cancelled'')'
  ];
  m_tag  text[] := array['C1', 'C3'];
  m_name text[] := array[
    'CM1 cancelled_games filter neutered (the defect restored)',
    'CM2 cancelled folded into `games` (would reach the acceptance email)'
  ];
  orig_def   text;
  mut_def    text;
  pass       int;
  -- anti-vacuity counters (baseline pass only): a ZERO fails the run
  c_cancelled_shown   int := 0;  -- a cancelled row really appeared
  c_live_shown        int := 0;  -- and a live row really appeared
  c_cancel_not_in_games int := 0;
  c_unanswered_excluded int := 0;
  c_other_pair_excluded int := 0;
begin
  ---------------------------------------------------------------- fixtures
  select id into v_owner from profiles order by created_at limit 1;

  insert into leagues(id, owner_id, name, sport, season, start_date, end_date)
    values (v_league,  v_owner, 'HARNESS-0092',   'baseball', 'HARNESS', '2026-09-01', '2026-11-30'),
           (v_league2, v_owner, 'HARNESS-0092-B', 'baseball', 'HARNESS', '2026-09-01', '2026-11-30');
  insert into divisions(id, league_id, name, settings)
    values (v_div, v_league, 'HARNESS-0092-DIV', '{"game_duration": 90}'::jsonb);
  insert into teams(id, league_id, division_id, name)
    values (v_team,  v_league,  v_div, 'HARNESS-0092-T'),
           (v_team2, v_league2, v_div, 'HARNESS-0092-T2');
  insert into venues(id, owner_id, name, availability, availability_configured)
    values (v_venue, v_owner, 'HARNESS-0092-FIELD', '{}'::jsonb, true);
  insert into interleague_orgs(id, owner_id, name, admin_email)
    values (v_org,  v_owner, 'HARNESS-0092-ORG',  'harness-0092@example.invalid'),
           (v_org2, v_owner, 'HARNESS-0092-ORG2', 'harness-0092b@example.invalid');
  insert into interleague_invites(token, sender_user_id, interleague_org_id,
                                  season_id, recipient_email, status, schedule_token)
    values ('HARNESS-0092-INV-ACC', v_owner, v_org, v_league,
            'harness-0092@example.invalid', 'accepted', v_sched_tok);

  -- TWO cancelled games, one of them an AWAY game with no venue of ours: the
  -- away branch is where a null venue must still render, and a single cancelled
  -- fixture would let an ordering or venue bug hide behind the happy case.
  insert into games(id, league_id, home_team_id, venue_id, scheduled_at, status,
                    interleague_org_id, is_away, external_team_name,
                    proposed_scheduled_at, proposed_venue_name)
  values
    (g_sched,    v_league,  v_team,  v_venue, '2026-10-03T10:00:00+00', 'scheduled',           v_org,  false, 'Rockies', null, null),
    (g_resched,  v_league,  v_team,  v_venue, '2026-10-10T10:00:00+00', 'reschedule_pending',  v_org,  false, 'Rockies', null, null),
    (g_counter,  v_league,  v_team,  v_venue, '2026-10-17T10:00:00+00', 'pending_interleague', v_org,  false, 'Rockies', '2026-10-18T13:00:00+00', null),
    (g_unanswer, v_league,  v_team,  v_venue, '2026-10-24T10:00:00+00', 'pending_interleague', v_org,  false, null,      null, null),
    (g_cancel,   v_league,  v_team,  v_venue, '2026-10-31T10:00:00+00', 'cancelled',           v_org,  false, 'Rockies', null, null),
    (g_cancel2,  v_league,  v_team,  v_venue, '2026-11-02T10:00:00+00', 'cancelled',           v_org,  false, 'Rockies', null, null),
    (g_cnclaway, v_league,  v_team,  null,    '2026-11-05T10:00:00+00', 'cancelled',           v_org,  true,  'Rockies', null, 'Riverside Field A'),
    (g_otherorg, v_league,  v_team,  v_venue, '2026-11-07T10:00:00+00', 'cancelled',           v_org2, false, 'Others',  null, null),
    (g_otherssn, v_league2, v_team2, v_venue, '2026-11-14T10:00:00+00', 'cancelled',           v_org,  false, 'Rockies', null, null);

  for pass in 0 .. array_length(m_old, 1) loop
    if pass > 0 then
      orig_def := pg_get_functiondef('public.get_interleague_schedule_by_token(text)'::regprocedure);
      mut_def  := replace(orig_def, m_old[pass], m_new[pass]);
      if mut_def = orig_def then
        total_fail := total_fail + 1;
        out := out || format(E'STALE %s: replace() matched nothing\n', m_name[pass]);
        continue;
      end if;
      execute mut_def;
    end if;
    f := array[]::text[];

    j := get_interleague_schedule_by_token(v_sched_tok);

    -- C1: the three cancelled games of THIS pair are emitted, in time order.
    select array_agg(e->>'id' order by ord) into ids
      from jsonb_array_elements(coalesce(j->'cancelled_games','[]')) with ordinality t(e, ord);
    if ids is distinct from array[g_cancel::text, g_cancel2::text, g_cnclaway::text] then
      f := f || 'C1'::text;
    elsif pass = 0 then c_cancelled_shown := c_cancelled_shown + 3; end if;

    -- C2: each carries what the page renders, and the AWAY one carries a null
    -- venue with its partner-side field name instead.
    if not exists (select 1 from jsonb_array_elements(coalesce(j->'cancelled_games','[]')) e
                   where e->>'id' = g_cancel::text
                     and e->>'status' = 'cancelled'
                     and e->'home_team'->>'name' = 'HARNESS-0092-T'
                     and e->'division'->>'name' = 'HARNESS-0092-DIV'
                     and e->'venue'->>'name' = 'HARNESS-0092-FIELD') then
      f := f || 'C2'::text; end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(j->'cancelled_games','[]')) e
                   where e->>'id' = g_cnclaway::text
                     and (e->>'is_away')::boolean
                     and (e->'venue') = 'null'::jsonb) then
      f := f || 'C2b'::text; end if;

    -- C3 THE SEPARATION. A cancelled game must NOT be in `games` — that key
    -- feeds the acceptance confirmation email.
    if exists (select 1 from jsonb_array_elements(coalesce(j->'games','[]')) e
               where e->>'id' in (g_cancel::text, g_cancel2::text, g_cnclaway::text)) then
      f := f || 'C3'::text;
    elsif pass = 0 then c_cancel_not_in_games := c_cancel_not_in_games + 1; end if;
    -- nor in countered_games
    if exists (select 1 from jsonb_array_elements(coalesce(j->'countered_games','[]')) e
               where e->>'id' in (g_cancel::text, g_cancel2::text, g_cnclaway::text)) then
      f := f || 'C4'::text; end if;

    -- S1: the live games are untouched by this change — both still in `games`.
    select array_agg(e->>'id' order by e->>'scheduled_at') into ids
      from jsonb_array_elements(coalesce(j->'games','[]')) e;
    if ids is distinct from array[g_sched::text, g_resched::text] then
      f := f || 'S1'::text;
    elsif pass = 0 then c_live_shown := c_live_shown + 2; end if;

    -- S2: countered_games is untouched.
    if not exists (select 1 from jsonb_array_elements(coalesce(j->'countered_games','[]')) e
                   where e->>'id' = g_counter::text) then
      f := f || 'S2'::text; end if;

    -- W1: an unanswered pending game still appears NOWHERE, including the new key.
    if exists (select 1 from jsonb_array_elements(
                 coalesce(j->'games','[]') || coalesce(j->'countered_games','[]') || coalesce(j->'cancelled_games','[]')) e
               where e->>'id' = g_unanswer::text) then
      f := f || 'W1'::text;
    elsif pass = 0 then c_unanswered_excluded := c_unanswered_excluded + 1; end if;

    -- W2: the new key is scoped to this (season, org) pair like every other key.
    -- A cancelled game of ANOTHER org, or another season, must not leak.
    if exists (select 1 from jsonb_array_elements(coalesce(j->'cancelled_games','[]')) e
               where e->>'id' in (g_otherorg::text, g_otherssn::text)) then
      f := f || 'W2'::text;
    elsif pass = 0 then c_other_pair_excluded := c_other_pair_excluded + 2; end if;

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
  if c_cancelled_shown     = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_cancelled_shown\n'; end if;
  if c_live_shown          = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_live_shown\n'; end if;
  if c_cancel_not_in_games = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_cancel_not_in_games\n'; end if;
  if c_unanswered_excluded = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_unanswered_excluded\n'; end if;
  if c_other_pair_excluded = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_other_pair_excluded\n'; end if;
  out := out || format(E'counters cancelled_shown=%s live_shown=%s cancel_not_in_games=%s unanswered_excl=%s other_pair_excl=%s\n',
    c_cancelled_shown, c_live_shown, c_cancel_not_in_games, c_unanswered_excluded, c_other_pair_excluded);
  out := out || case when total_fail = 0 then 'RESULT PASS' else format('RESULT FAIL (%s)', total_fail) end;

  -- ALWAYS raise: carries results out and rolls the whole batch back.
  raise exception E'HARNESS-0092\n%', out;
end
$harness$;

-- ── Run log ──────────────────────────────────────────────────────────────────
--
-- 2026-09-24, run AFTER 0092 was applied (this file alone, via the Supabase
-- MCP):
--   BASELINE PASS
--   KILLED  CM1 cancelled_games filter neutered — by C1 (all failures {C1,C2,C2b})
--   KILLED  CM2 cancelled folded into `games`   — by C3 (all failures {C3,S1})
--   counters cancelled_shown=3 live_shown=2 cancel_not_in_games=1
--            unanswered_excl=1 other_pair_excl=2
--   RESULT PASS
--
-- Leak check immediately after: live md5(prosrc) of
-- get_interleague_schedule_by_token still 61f6750598a4b103836d40aa87e78b3a
-- (equal to the repo file's body, so both mutants' create-or-replace rolled
-- back); zero HARNESS-0092 leagues / orgs / invites / venues; games total 663
-- unchanged.
--
-- Note on CM2's second failure (S1): folding cancelled into `games` also breaks
-- the "live games are exactly these two" assertion, which is correct and not a
-- problem — C3, the assertion written for it, is among its failures.
