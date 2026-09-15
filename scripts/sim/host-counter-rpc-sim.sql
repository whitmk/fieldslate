-- SQL-level harness for migration 0091 (host counter on pending games).
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- under test lives in SECURITY DEFINER token functions reached by `anon`. The
-- fake Supabase client cannot run plpgsql and service_role has no DML on games.
-- NOT `npm run`-able, NOT in CI.
--
-- SPLIT: this file proves what the token FUNCTIONS do to rows. The host routes'
-- decisions (which statuses may be proposed on, the resolve refusal, the
-- respond route's decline branch, withdraw) are `npm run sim:host-counter`.
--
-- HOW TO RUN: ONE batch =
--   1. supabase/migrations/0091_host_counter_on_pending_games.sql (the text),
--   2. the OLD bodies below as pg_temp functions (pre-0091 = 0039's bodies),
--   3. the DO block.
-- The DO block ALWAYS raises, so the batch — the migration included — rolls
-- back. Leak check afterwards: the five functions' live md5(prosrc) unchanged
-- (before apply) / equal to the repo file (after), zero HARNESS-0091 rows.
--
-- EACH PASS IS ITS OWN SUB-TRANSACTION. Pass 0 is the baseline; each later pass
-- first rewrites one function via execute replace(pg_get_functiondef(...)).
-- Fixtures are inserted INSIDE the pass and the pass ends by raising, so both
-- the fixtures and the mutant roll back before the next pass; only the failure
-- tags (plpgsql variables, not transactional) survive. A mutant is KILLED only
-- if its named target tag is among its failures.
--
-- "SCHEDULED PATH UNCHANGED" IS PROVEN, NOT ASSERTED FROM MEMORY: the pre-0091
-- bodies run as pg_temp.old_* on twin fixtures, and the resulting game rows,
-- request rows and returned JSON are compared with the new functions' (ids,
-- tokens, timestamps and the new-only keys stripped).

-- ── OLD bodies (pre-0091; identical to 0039) as pg_temp functions ───────────
-- Pasted from 0039 at run time; see the run log for the exact procedure.

do $harness$
declare
  out        text := '';
  total_fail int := 0;
  f          text[];
  pass       int;
  orig_def   text;
  mut_def    text;
  m_fn   text[] := array[
    'public.decline_reschedule_request_by_token(text)',
    'public.accept_reschedule_request_by_token(text)',
    'public.counter_reschedule_request_by_token(text,timestamptz,text,text)',
    'public.counter_reschedule_request_by_token(text,timestamptz,text,text)',
    'public.get_interleague_schedule_by_token(text)',
    'public.decline_reschedule_request_by_token(text)'
  ];
  m_old  text[] := array[
    E'    and status <> ''pending_interleague''\n',
    E'    proposed_scheduled_at = null,\n',
    E'  if v_req.requested_by_user_id is null then\n    raise exception ''request_not_actionable_by_token''',
    E'  if v_game_status = ''pending_interleague'' then',
    E'              and r.requested_by_user_id is not null\n',
    E'    and status <> ''pending_interleague''\n'
  ];
  m_new  text[] := array[
    E'',
    E'',
    E'  if false then\n    raise exception ''request_not_actionable_by_token''',
    E'  if false then',
    E'',
    E'    and status <> ''reschedule_pending''\n'
  ];
  m_tag  text[] := array['D1', 'A1', 'G1c', 'C1', 'R2', 'D2'];
  m_name text[] := array[
    'HM1 decline restores old behavior on pending games (confirms the rejected original)',
    'HM2 accept no longer clears proposed_scheduled_at',
    'HM3 counter loses the host-row guard (partner row countered by token)',
    'HM4 counter on a pending game stops mirroring into games.proposed_*',
    'HM5 schedule RPC exposes a partner-authored request token',
    'HM6 decline branch inverted (breaks the SCHEDULED path)'
  ];
  -- anti-vacuity (baseline only)
  c_pending_branch int := 0;
  c_sched_compared int := 0;
  c_guard_refused  int := 0;
  c_token_exposed  int := 0;
  c_token_withheld int := 0;
begin
  for pass in 0 .. array_length(m_fn, 1) loop
    f := array[]::text[];
    begin
      if pass > 0 then
        orig_def := pg_get_functiondef(m_fn[pass]::regprocedure);
        mut_def  := replace(orig_def, m_old[pass], m_new[pass]);
        if mut_def = orig_def then
          f := f || 'STALE'::text;
          raise exception 'HARNESS_PASS_END';
        end if;
        execute mut_def;
      end if;

      declare
        v_owner  uuid;
        v_league uuid := gen_random_uuid();
        v_div    uuid := gen_random_uuid();
        v_team   uuid := gen_random_uuid();
        v_venue  uuid := gen_random_uuid();
        v_org    uuid := gen_random_uuid();
        p_dec uuid := gen_random_uuid(); p_acc uuid := gen_random_uuid(); p_cnt uuid := gen_random_uuid();
        s_dec_n uuid := gen_random_uuid(); s_dec_o uuid := gen_random_uuid();
        s_acc_n uuid := gen_random_uuid(); s_acc_o uuid := gen_random_uuid();
        s_cnt_n uuid := gen_random_uuid(); s_cnt_o uuid := gen_random_uuid();
        s_ext uuid := gen_random_uuid();
        x  timestamptz := '2026-10-18T13:00:00+00';  -- partner's standing proposal
        y  timestamptz := '2026-10-25T15:00:00+00';  -- host's proposal
        z  timestamptz := '2026-11-01T11:00:00+00';  -- partner's counter-back
        j jsonb; jo jsonb;
        gn jsonb; go jsonb; rn jsonb; ro jsonb;
        n int;
        refused boolean;
      begin
        select id into v_owner from profiles order by created_at limit 1;
        insert into leagues(id, owner_id, name, sport, season, start_date, end_date)
          values (v_league, v_owner, 'HARNESS-0091', 'baseball', 'HARNESS', '2026-09-01', '2026-11-30');
        insert into divisions(id, league_id, name, settings)
          values (v_div, v_league, 'HARNESS-0091-DIV', '{"game_duration": 90}'::jsonb);
        insert into teams(id, league_id, division_id, name) values (v_team, v_league, v_div, 'HARNESS-0091-T');
        insert into venues(id, owner_id, name, availability, availability_configured)
          values (v_venue, v_owner, 'HARNESS-0091-FIELD', '{}'::jsonb, true);
        insert into interleague_orgs(id, owner_id, name, admin_email)
          values (v_org, v_owner, 'HARNESS-0091-ORG', 'harness-0091@example.invalid');
        insert into interleague_invites(token, sender_user_id, interleague_org_id, season_id,
                                        recipient_email, status, schedule_token)
          values ('HARNESS-0091-INV', v_owner, v_org, v_league, 'harness-0091@example.invalid',
                  'accepted', 'HARNESS-0091-SCHED');

        insert into games(id, league_id, home_team_id, venue_id, scheduled_at, status,
                          interleague_org_id, is_away, external_team_name, proposed_scheduled_at)
        values
          (p_dec,   v_league, v_team, v_venue, '2026-10-17T10:00:00+00', 'pending_interleague', v_org, false, 'Rockies', x),
          (p_acc,   v_league, v_team, v_venue, '2026-10-17T12:00:00+00', 'pending_interleague', v_org, false, 'Rockies', x),
          (p_cnt,   v_league, v_team, v_venue, '2026-10-17T14:00:00+00', 'pending_interleague', v_org, false, 'Rockies', x),
          (s_dec_n, v_league, v_team, v_venue, '2026-10-10T10:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null),
          (s_dec_o, v_league, v_team, v_venue, '2026-10-10T10:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null),
          (s_acc_n, v_league, v_team, v_venue, '2026-10-10T12:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null),
          (s_acc_o, v_league, v_team, v_venue, '2026-10-10T12:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null),
          (s_cnt_n, v_league, v_team, v_venue, '2026-10-10T14:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null),
          (s_cnt_o, v_league, v_team, v_venue, '2026-10-10T14:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null),
          (s_ext,   v_league, v_team, v_venue, '2026-10-11T10:00:00+00', 'reschedule_pending',  v_org, false, 'Rockies', null);

        -- Host rows carry the host user; the one partner-created row carries null.
        insert into interleague_reschedule_requests(game_id, token, requested_by_user_id, proposed_scheduled_at, note)
        values
          (p_dec,   'HARNESS-0091-P-DEC',   v_owner, y, null),
          (p_acc,   'HARNESS-0091-P-ACC',   v_owner, y, null),
          (p_cnt,   'HARNESS-0091-P-CNT',   v_owner, y, null),
          (s_dec_n, 'HARNESS-0091-S-DEC-N', v_owner, y, 'n'),
          (s_dec_o, 'HARNESS-0091-S-DEC-O', v_owner, y, 'n'),
          (s_acc_n, 'HARNESS-0091-S-ACC-N', v_owner, y, 'n'),
          (s_acc_o, 'HARNESS-0091-S-ACC-O', v_owner, y, 'n'),
          (s_cnt_n, 'HARNESS-0091-S-CNT-N', v_owner, y, 'n'),
          (s_cnt_o, 'HARNESS-0091-S-CNT-O', v_owner, y, 'n'),
          (s_ext,   'HARNESS-0091-S-EXT',   null,    y, 'partner');

        ---------------------------------------------------------- reads first
        j := get_reschedule_request_by_token('HARNESS-0091-P-DEC');
        if j->'game'->>'status' is distinct from 'pending_interleague'
           or (j->'game'->>'proposed_scheduled_at')::timestamptz is distinct from x
           or (j->>'proposal_count')::int is distinct from 1 then
          f := f || 'R1'::text;
        end if;

        j := get_interleague_schedule_by_token('HARNESS-0091-SCHED');
        -- countered pending game with a host row: token present
        if (select e->'open_host_proposal'->>'token' from jsonb_array_elements(j->'countered_games') e
            where e->>'id' = p_acc::text) is distinct from 'HARNESS-0091-P-ACC' then
          f := f || 'R2'::text;
        elsif pass = 0 then c_token_exposed := c_token_exposed + 1; end if;
        -- confirmed game whose pending row is PARTNER-authored: no token, ever
        if (select e->'open_host_proposal' from jsonb_array_elements(j->'games') e
            where e->>'id' = s_ext::text) is distinct from 'null'::jsonb then
          f := f || 'R2'::text;
        elsif pass = 0 then c_token_withheld := c_token_withheld + 1; end if;

        ---------------------------------------------------------- D: decline
        j := decline_reschedule_request_by_token('HARNESS-0091-P-DEC');
        -- D1: a decline on a pending game leaves it pending, standing proposal intact
        select to_jsonb(g) into gn from games g where g.id = p_dec;
        if gn->>'status' is distinct from 'pending_interleague'
           or (gn->>'proposed_scheduled_at')::timestamptz is distinct from x
           or (select status from interleague_reschedule_requests where token = 'HARNESS-0091-P-DEC') is distinct from 'declined' then
          f := f || 'D1'::text;
        elsif pass = 0 then c_pending_branch := c_pending_branch + 1; end if;
        if (j->>'was_pending')::boolean is not true or (j->>'standing_proposal')::timestamptz is distinct from x then
          f := f || 'D3'::text;
        end if;

        -- D2: the SCHEDULED path is unchanged — new vs old on twins.
        j  := decline_reschedule_request_by_token('HARNESS-0091-S-DEC-N');
        jo := pg_temp.old_decline_reschedule_request_by_token('HARNESS-0091-S-DEC-O');
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into gn from games g where g.id = s_dec_n;
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into go from games g where g.id = s_dec_o;
        select to_jsonb(r) - 'id' - 'token' - 'game_id' - 'updated_at' - 'created_at' into rn from interleague_reschedule_requests r where r.token = 'HARNESS-0091-S-DEC-N';
        select to_jsonb(r) - 'id' - 'token' - 'game_id' - 'updated_at' - 'created_at' into ro from interleague_reschedule_requests r where r.token = 'HARNESS-0091-S-DEC-O';
        if gn is distinct from go or rn is distinct from ro
           or (j - 'request_id' - 'game_id' - 'was_pending' - 'standing_proposal') is distinct from (jo - 'request_id' - 'game_id')
           or gn->>'status' is distinct from 'scheduled' then
          f := f || 'D2'::text;
        elsif pass = 0 then c_sched_compared := c_sched_compared + 1; end if;

        ---------------------------------------------------------- A: accept
        j := accept_reschedule_request_by_token('HARNESS-0091-P-ACC');
        select to_jsonb(g) into gn from games g where g.id = p_acc;
        -- A1: agreed at the host's time, partner's stale counter cleared
        if gn->>'status' is distinct from 'scheduled'
           or (gn->>'scheduled_at')::timestamptz is distinct from y
           or gn->>'proposed_scheduled_at' is not null then
          f := f || 'A1'::text;
        elsif pass = 0 then c_pending_branch := c_pending_branch + 1; end if;
        if (j->>'was_pending')::boolean is not true then f := f || 'A3'::text; end if;

        j  := accept_reschedule_request_by_token('HARNESS-0091-S-ACC-N');
        jo := pg_temp.old_accept_reschedule_request_by_token('HARNESS-0091-S-ACC-O');
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into gn from games g where g.id = s_acc_n;
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into go from games g where g.id = s_acc_o;
        -- A2: scheduled path unchanged, and the shared clear is a no-op there
        if gn is distinct from go
           or (j - 'request_id' - 'game_id' - 'was_pending') is distinct from (jo - 'request_id' - 'game_id')
           or gn->>'proposed_scheduled_at' is not null then
          f := f || 'A2'::text;
        elsif pass = 0 then c_sched_compared := c_sched_compared + 1; end if;

        ---------------------------------------------------------- C: counter
        j := counter_reschedule_request_by_token('HARNESS-0091-P-CNT', z, null, 'how about this');
        select to_jsonb(g) into gn from games g where g.id = p_cnt;
        select count(*) into n from interleague_reschedule_requests r
          where r.game_id = p_cnt and r.status = 'pending' and r.requested_by_user_id is null
            and r.proposed_scheduled_at = z;
        -- C1: host row declined; partner row recorded as PARTNER; game still
        -- pending with the new time mirrored into games.proposed_*
        if gn->>'status' is distinct from 'pending_interleague'
           or (gn->>'proposed_scheduled_at')::timestamptz is distinct from z
           or n <> 1
           or (select status from interleague_reschedule_requests where token = 'HARNESS-0091-P-CNT') is distinct from 'declined'
           or (select requested_by_user_id from interleague_reschedule_requests where token = 'HARNESS-0091-P-CNT') is distinct from v_owner then
          f := f || 'C1'::text;
        elsif pass = 0 then c_pending_branch := c_pending_branch + 1; end if;

        j  := counter_reschedule_request_by_token('HARNESS-0091-S-CNT-N', z, null, 'c');
        jo := pg_temp.old_counter_reschedule_request_by_token('HARNESS-0091-S-CNT-O', z, null, 'c');
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into gn from games g where g.id = s_cnt_n;
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into go from games g where g.id = s_cnt_o;
        select jsonb_agg(to_jsonb(r) - 'id' - 'token' - 'game_id' - 'updated_at' - 'created_at' order by r.status, r.note)
          into rn from interleague_reschedule_requests r where r.game_id = s_cnt_n;
        select jsonb_agg(to_jsonb(r) - 'id' - 'token' - 'game_id' - 'updated_at' - 'created_at' order by r.status, r.note)
          into ro from interleague_reschedule_requests r where r.game_id = s_cnt_o;
        -- C2: scheduled path unchanged (game untouched, same two rows)
        if gn is distinct from go or rn is distinct from ro
           or (j - 'old_request_id' - 'new_request_id' - 'game_id' - 'was_pending') is distinct from (jo - 'old_request_id' - 'new_request_id' - 'game_id')
           or gn->>'status' is distinct from 'reschedule_pending' then
          f := f || 'C2'::text;
        elsif pass = 0 then c_sched_compared := c_sched_compared + 1; end if;

        ---------------------------------------------------------- G: guard
        -- A token for a PARTNER-authored row must be refused by all three.
        refused := false;
        begin perform decline_reschedule_request_by_token('HARNESS-0091-S-EXT');
        exception when others then refused := sqlerrm like '%request_not_actionable_by_token%'; end;
        if not refused then f := f || 'G1d'::text; elsif pass = 0 then c_guard_refused := c_guard_refused + 1; end if;

        refused := false;
        begin perform accept_reschedule_request_by_token('HARNESS-0091-S-EXT');
        exception when others then refused := sqlerrm like '%request_not_actionable_by_token%'; end;
        if not refused then f := f || 'G1a'::text; elsif pass = 0 then c_guard_refused := c_guard_refused + 1; end if;

        refused := false;
        begin perform counter_reschedule_request_by_token('HARNESS-0091-S-EXT', z, null, null);
        exception when others then refused := sqlerrm like '%request_not_actionable_by_token%'; end;
        if not refused then f := f || 'G1c'::text; elsif pass = 0 then c_guard_refused := c_guard_refused + 1; end if;

        if (select status from games where id = s_ext) is distinct from 'reschedule_pending'
           or (select count(*) from interleague_reschedule_requests where game_id = s_ext) <> 1 then
          f := f || 'G2'::text;
        end if;
      end;

      raise exception 'HARNESS_PASS_END';
    exception when others then
      if sqlerrm <> 'HARNESS_PASS_END' then
        f := f || ('ERR ' || sqlerrm);
      end if;
    end;

    if pass = 0 then
      if cardinality(f) > 0 then
        total_fail := total_fail + cardinality(f);
        out := out || format(E'BASELINE FAIL %s\n', f);
      else
        out := out || E'BASELINE PASS\n';
      end if;
    elsif m_tag[pass] = any(f) then
      out := out || format(E'KILLED  %s — by %s (all: %s)\n', m_name[pass], m_tag[pass], f);
    else
      total_fail := total_fail + 1;
      out := out || format(E'SURVIVED %s — target %s not in %s\n', m_name[pass], m_tag[pass], f);
    end if;
  end loop;

  if c_pending_branch = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_pending_branch\n'; end if;
  if c_sched_compared = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_sched_compared\n'; end if;
  if c_guard_refused  = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_guard_refused\n'; end if;
  if c_token_exposed  = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_token_exposed\n'; end if;
  if c_token_withheld = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_token_withheld\n'; end if;
  out := out || format(E'counters pending_branch=%s sched_compared=%s guard_refused=%s token_exposed=%s token_withheld=%s\n',
    c_pending_branch, c_sched_compared, c_guard_refused, c_token_exposed, c_token_withheld);
  out := out || case when total_fail = 0 then 'RESULT PASS' else format('RESULT FAIL (%s)', total_fail) end;
  raise exception E'HARNESS-0091\n%', out;
end
$harness$;

-- ── Run log ──────────────────────────────────────────────────────────────────
--
-- 2026-09-15, BEFORE 0091 was applied. Batch = 0091's five functions
-- (comment lines stripped — behavior-identical), the three OLD bodies from 0039
-- created as pg_temp.old_* (security definer dropped; the harness runs as
-- postgres), then this DO block.
--   BASELINE PASS
--   KILLED HM1 decline restores old behavior on pending games — by D1 (only D1)
--   KILLED HM2 accept no longer clears proposed_scheduled_at   — by A1 (only A1)
--   KILLED HM3 counter loses the host-row guard                — by G1c (+G2)
--   KILLED HM4 counter stops mirroring into games.proposed_*   — by C1 (only C1)
--   KILLED HM5 schedule RPC exposes a partner-authored token   — by R2 (only R2)
--   KILLED HM6 decline branch inverted (breaks SCHEDULED path) — by D2 (+D1)
--   counters pending_branch=3 sched_compared=3 guard_refused=3
--            token_exposed=1 token_withheld=1
--   Leak check: all five functions' md5(prosrc) still pre-0091
--   (accept 8fac9759…, counter 243c3390…, decline 232055b7…, schedule
--   7734ce5b…, request-read c652d7de…); zero HARNESS-0091 rows; games 663;
--   interleague_reschedule_requests still 0 rows.
--
-- Finding while preparing this run: the LIVE accept/decline/counter bodies were
-- 0039's with every in-body comment stripped (md5 of 0039 minus comment lines
-- = live md5, exactly) — the same drift CLAUDE.md records for 0079. Logic was
-- identical; 0091 replaces all three from the repo text, closing it.
--
-- 0091 then applied verbatim via apply_migration. Live md5(prosrc), each equal
-- to the repo file's body; EXECUTE grants unchanged:
--   accept_reschedule_request_by_token    ef59eb425cabf5fb1f1e2c12a6b97f72
--   decline_reschedule_request_by_token   aab56ef2b7be3ed3852922233f42a518
--   counter_reschedule_request_by_token   05121dbed31531d58c1aa04b8931723b
--   get_reschedule_request_by_token       2d222be8968cd80df1cbdb643de33e07
--   get_interleague_schedule_by_token     6e675f59d245e9958fe8cae82ee364cc
-- (counter's body differs from the harness run only by one reworded in-body
-- comment, made before apply.)
