-- SQL-level harness for migration 0094 (a partner's decline never revives a
-- rained-out game) and for the SHARED accept path a rained-out makeup relies on.
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): the behavior
-- lives in SECURITY DEFINER token functions reached by `anon`. NOT
-- `npm run`-able, NOT in CI. The host-side decisions (which statuses may be
-- proposed on, the host respond route's decline) are `npm run sim:picker-guard`.
--
-- HOW TO RUN: ONE batch, in this order =
--   1. the SETUP block below (captures the LIVE pre-0094 decline and accept
--      bodies as pg_temp.old_* — exact, not pasted),
--   2. supabase/migrations/0094_decline_never_revives_cancelled.sql (the text),
--   3. the HARNESS block.
-- The harness block ALWAYS raises, so the batch — the migration included — rolls
-- back. Leak check afterwards: live md5(prosrc) of decline unchanged (before
-- apply) / equal to the repo file (after); zero HARNESS-0094 rows.
--
-- EACH PASS IS ITS OWN SUB-TRANSACTION (the 0091 harness pattern). Pass 0 is
-- the baseline; each later pass rewrites one function via
-- execute replace(pg_get_functiondef(...)). Fixtures are inserted INSIDE the
-- pass and the pass ends by raising, so both roll back before the next pass.
-- A mutant is KILLED only if its named target tag is among its failures.
--
-- "SCHEDULED PATH UNCHANGED" IS PROVEN: the pre-0094 bodies run as pg_temp.old_*
-- on twin reschedule_pending fixtures and the game row, request row and
-- returned JSON are compared with the new functions' (ids, tokens, timestamps
-- stripped). accept is NOT changed by 0094 — the comparison is what says so.
--
-- Assertions
--   X1  decline on a CANCELLED game leaves it cancelled, at its rained-out time,
--       request declined                                    (the 0094 change)
--   X2  accept on a CANCELLED game sets it scheduled AT THE PROPOSED time —
--       the makeup goes live                                (shared accept path)
--   X3  decline on a reschedule_pending game: new = old, and it is 'scheduled'
--   X4  accept on a reschedule_pending game: new = old
--   X5  decline on a pending_interleague game leaves it pending (0091 D1 kept)
-- Mutants
--   XM1 decline: the 0094 condition removed        → X1 (a declined makeup revives the game)
--   XM2 decline: condition retargeted at reschedule_pending → X3 (SCHEDULED path broken)
--   XM3 accept: the `status = 'scheduled'` write removed → X2 (+X4)
-- Anti-vacuity: c_cancelled_decline_kept, c_cancelled_makeup_live,
-- c_sched_compared — each must be > 0 on the baseline pass.

-- ── SETUP: live pre-0094 bodies as pg_temp.old_* ─────────────────────────────
do $setup$
declare d text;
begin
  d := pg_get_functiondef('public.decline_reschedule_request_by_token(text)'::regprocedure);
  d := replace(d, 'public.decline_reschedule_request_by_token', 'pg_temp.old_decline_reschedule_request_by_token');
  d := replace(d, ' SECURITY DEFINER', '');
  execute d;
  d := pg_get_functiondef('public.accept_reschedule_request_by_token(text)'::regprocedure);
  d := replace(d, 'public.accept_reschedule_request_by_token', 'pg_temp.old_accept_reschedule_request_by_token');
  d := replace(d, ' SECURITY DEFINER', '');
  execute d;
end
$setup$;

-- ── (2) paste supabase/migrations/0094_decline_never_revives_cancelled.sql here ──

-- ── HARNESS ──────────────────────────────────────────────────────────────────
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
    'public.decline_reschedule_request_by_token(text)',
    'public.accept_reschedule_request_by_token(text)'
  ];
  m_old  text[] := array[
    E'    and status <> ''cancelled''\n',
    E'    and status <> ''cancelled''\n',
    E'    status              = ''scheduled'',\n'
  ];
  m_new  text[] := array[
    E'',
    E'    and status <> ''reschedule_pending''\n',
    E''
  ];
  m_tag  text[] := array['X1', 'X3', 'X2'];
  m_name text[] := array[
    'XM1 decline: 0094 condition removed (a declined makeup revives the game)',
    'XM2 decline: condition retargeted (breaks the SCHEDULED path)',
    'XM3 accept: status write removed (a makeup never goes live)'
  ];
  c_cancelled_decline_kept int := 0;
  c_cancelled_makeup_live  int := 0;
  c_sched_compared         int := 0;
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
        c_dec uuid := gen_random_uuid(); c_acc uuid := gen_random_uuid();
        s_dec_n uuid := gen_random_uuid(); s_dec_o uuid := gen_random_uuid();
        s_acc_n uuid := gen_random_uuid(); s_acc_o uuid := gen_random_uuid();
        p_dec uuid := gen_random_uuid();
        r0 timestamptz := '2026-10-03T10:00:00+00';  -- the rained-out time
        y  timestamptz := '2026-10-25T15:00:00+00';  -- host's makeup proposal
        x  timestamptz := '2026-10-18T13:00:00+00';  -- partner's standing proposal (pending fixture)
        j jsonb; jo jsonb;
        gn jsonb; go jsonb; rn jsonb; ro jsonb;
      begin
        select id into v_owner from profiles order by created_at limit 1;
        insert into leagues(id, owner_id, name, sport, season, start_date, end_date)
          values (v_league, v_owner, 'HARNESS-0094', 'baseball', 'HARNESS', '2026-09-01', '2026-11-30');
        insert into divisions(id, league_id, name, settings)
          values (v_div, v_league, 'HARNESS-0094-DIV', '{"game_duration": 90}'::jsonb);
        insert into teams(id, league_id, division_id, name) values (v_team, v_league, v_div, 'HARNESS-0094-T');
        insert into venues(id, owner_id, name, availability, availability_configured)
          values (v_venue, v_owner, 'HARNESS-0094-FIELD', '{}'::jsonb, true);
        insert into interleague_orgs(id, owner_id, name, admin_email)
          values (v_org, v_owner, 'HARNESS-0094-ORG', 'harness-0094@example.invalid');
        insert into interleague_invites(token, sender_user_id, interleague_org_id, season_id,
                                        recipient_email, status, schedule_token)
          values ('HARNESS-0094-INV', v_owner, v_org, v_league, 'harness-0094@example.invalid',
                  'accepted', 'HARNESS-0094-SCHED');

        insert into games(id, league_id, home_team_id, venue_id, scheduled_at, status,
                          interleague_org_id, is_away, external_team_name, proposed_scheduled_at)
        values
          (c_dec,   v_league, v_team, v_venue, r0, 'cancelled', v_org, false, 'Rockies', null),
          (c_acc,   v_league, v_team, v_venue, r0, 'cancelled', v_org, false, 'Rockies', null),
          (s_dec_n, v_league, v_team, v_venue, '2026-10-10T10:00:00+00', 'reschedule_pending', v_org, false, 'Rockies', null),
          (s_dec_o, v_league, v_team, v_venue, '2026-10-10T10:00:00+00', 'reschedule_pending', v_org, false, 'Rockies', null),
          (s_acc_n, v_league, v_team, v_venue, '2026-10-10T12:00:00+00', 'reschedule_pending', v_org, false, 'Rockies', null),
          (s_acc_o, v_league, v_team, v_venue, '2026-10-10T12:00:00+00', 'reschedule_pending', v_org, false, 'Rockies', null),
          (p_dec,   v_league, v_team, v_venue, '2026-10-17T10:00:00+00', 'pending_interleague', v_org, false, 'Rockies', x);

        insert into interleague_reschedule_requests(game_id, token, requested_by_user_id, proposed_scheduled_at, note)
        values
          (c_dec,   'HARNESS-0094-C-DEC',   v_owner, y, 'makeup'),
          (c_acc,   'HARNESS-0094-C-ACC',   v_owner, y, 'makeup'),
          (s_dec_n, 'HARNESS-0094-S-DEC-N', v_owner, y, 'n'),
          (s_dec_o, 'HARNESS-0094-S-DEC-O', v_owner, y, 'n'),
          (s_acc_n, 'HARNESS-0094-S-ACC-N', v_owner, y, 'n'),
          (s_acc_o, 'HARNESS-0094-S-ACC-O', v_owner, y, 'n'),
          (p_dec,   'HARNESS-0094-P-DEC',   v_owner, y, null);

        ---------------------------------------------------------- X1: decline keeps a rained-out game cancelled
        j := decline_reschedule_request_by_token('HARNESS-0094-C-DEC');
        select to_jsonb(g) into gn from games g where g.id = c_dec;
        if gn->>'status' is distinct from 'cancelled'
           or (gn->>'scheduled_at')::timestamptz is distinct from r0
           or (select status from interleague_reschedule_requests where token = 'HARNESS-0094-C-DEC') is distinct from 'declined' then
          f := f || 'X1'::text;
        elsif pass = 0 then c_cancelled_decline_kept := c_cancelled_decline_kept + 1; end if;

        ---------------------------------------------------------- X2: accept makes the makeup live
        j := accept_reschedule_request_by_token('HARNESS-0094-C-ACC');
        select to_jsonb(g) into gn from games g where g.id = c_acc;
        if gn->>'status' is distinct from 'scheduled'
           or (gn->>'scheduled_at')::timestamptz is distinct from y
           or (select status from interleague_reschedule_requests where token = 'HARNESS-0094-C-ACC') is distinct from 'accepted' then
          f := f || 'X2'::text;
        elsif pass = 0 then c_cancelled_makeup_live := c_cancelled_makeup_live + 1; end if;

        ---------------------------------------------------------- X3: SCHEDULED decline path unchanged (twins)
        j  := decline_reschedule_request_by_token('HARNESS-0094-S-DEC-N');
        jo := pg_temp.old_decline_reschedule_request_by_token('HARNESS-0094-S-DEC-O');
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into gn from games g where g.id = s_dec_n;
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into go from games g where g.id = s_dec_o;
        select to_jsonb(r) - 'id' - 'token' - 'game_id' - 'updated_at' - 'created_at' into rn from interleague_reschedule_requests r where r.token = 'HARNESS-0094-S-DEC-N';
        select to_jsonb(r) - 'id' - 'token' - 'game_id' - 'updated_at' - 'created_at' into ro from interleague_reschedule_requests r where r.token = 'HARNESS-0094-S-DEC-O';
        if gn is distinct from go or rn is distinct from ro
           or (j - 'request_id' - 'game_id') is distinct from (jo - 'request_id' - 'game_id')
           or gn->>'status' is distinct from 'scheduled' then
          f := f || 'X3'::text;
        elsif pass = 0 then c_sched_compared := c_sched_compared + 1; end if;

        ---------------------------------------------------------- X4: SCHEDULED accept path unchanged (twins)
        j  := accept_reschedule_request_by_token('HARNESS-0094-S-ACC-N');
        jo := pg_temp.old_accept_reschedule_request_by_token('HARNESS-0094-S-ACC-O');
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into gn from games g where g.id = s_acc_n;
        select to_jsonb(g) - 'id' - 'updated_at' - 'created_at' into go from games g where g.id = s_acc_o;
        if gn is distinct from go
           or (j - 'request_id' - 'game_id') is distinct from (jo - 'request_id' - 'game_id')
           or gn->>'status' is distinct from 'scheduled' then
          f := f || 'X4'::text;
        elsif pass = 0 then c_sched_compared := c_sched_compared + 1; end if;

        ---------------------------------------------------------- X5: 0091's pending-game decline still holds
        j := decline_reschedule_request_by_token('HARNESS-0094-P-DEC');
        select to_jsonb(g) into gn from games g where g.id = p_dec;
        if gn->>'status' is distinct from 'pending_interleague'
           or (gn->>'proposed_scheduled_at')::timestamptz is distinct from x then
          f := f || 'X5'::text;
        end if;

        raise exception 'HARNESS_PASS_END';
      end;
    exception when others then
      if sqlerrm <> 'HARNESS_PASS_END' then
        f := f || ('ERR:' || sqlerrm)::text;
      end if;
    end;

    if pass = 0 then
      if array_length(f, 1) is null then
        out := out || E'BASELINE PASS\n';
      else
        total_fail := total_fail + 1;
        out := out || format(E'BASELINE FAIL %s\n', f);
      end if;
    elsif m_tag[pass] = any(f) then
      out := out || format(E'KILLED  %s — by %s (all: %s)\n', m_name[pass], m_tag[pass], f);
    else
      total_fail := total_fail + 1;
      out := out || format(E'SURVIVED %s — target %s not in %s\n', m_name[pass], m_tag[pass], f);
    end if;
  end loop;

  if c_cancelled_decline_kept = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_cancelled_decline_kept\n'; end if;
  if c_cancelled_makeup_live  = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_cancelled_makeup_live\n'; end if;
  if c_sched_compared         = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_sched_compared\n'; end if;
  out := out || format(E'counters cancelled_decline_kept=%s cancelled_makeup_live=%s sched_compared=%s\n',
    c_cancelled_decline_kept, c_cancelled_makeup_live, c_sched_compared);
  out := out || case when total_fail = 0 then 'RESULT PASS' else format('RESULT FAIL (%s)', total_fail) end;
  raise exception E'HARNESS-0094\n%', out;
end
$harness$;

-- ── Run log ──────────────────────────────────────────────────────────────────
--
-- 2026-09-28, BEFORE 0094 was applied. Batch = SETUP (live pre-0094 decline and
-- accept captured as pg_temp.old_*), 0094's text, then the HARNESS block.
--   BASELINE PASS
--   KILLED  XM1 decline: 0094 condition removed        — by X1 (only X1)
--   KILLED  XM2 decline: condition retargeted          — by X3 (+X1: retargeting
--           also drops the cancelled condition, so a makeup revives too)
--   KILLED  XM3 accept: status write removed           — by X2 (+X4)
--   counters cancelled_decline_kept=1 cancelled_makeup_live=1 sched_compared=2
--   Leak check: decline md5 still aab56ef2… (pre-0094), accept ef59eb42…;
--   zero HARNESS-0094 rows; games 663; interleague_reschedule_requests 3.
--
-- 0094 then applied verbatim via apply_migration. Live md5(prosrc) of decline =
-- 5064820fa4e2baa8bf1f6be3857eeb41 = the repo file's body; accept unchanged;
-- anon still holds EXECUTE on both (it must — they are the partner's token
-- functions).
