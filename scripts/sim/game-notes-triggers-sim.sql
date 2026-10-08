-- SQL-level harness for migrations 0095 (notes attribution + lock allowlist)
-- and 0096 (posted ignores note-only edits) — the two 0082 triggers, changed.
--
-- WHY SQL (CLAUDE.md "Harness standard — SQL-level exceptions"): triggers.
-- NOT `npm run`-able, NOT in CI. Run via the Supabase MCP.
--
-- HOW TO RUN: ONE batch = 0095's text, 0096's text, then this DO block. The
-- block ALWAYS raises, so the batch — both migrations included — rolls back.
-- Run scripts/sim/schedule-lock-sim.sql (T5c re-keyed to home_team_id) in the
-- same way to prove every EXISTING lock assertion still passes. Leak check
-- afterwards: md5(prosrc) of both functions, zero ZZ_N% rows.
--
-- EACH PASS IS ITS OWN SUB-TRANSACTION (the 0091/0094 pattern). Pass 0 is the
-- baseline; each later pass rewrites one function via
-- execute replace(pg_get_functiondef(...)) and must fail at its TARGET tag.
--
-- Assertions
--   T5a  locked: home_score update refused            (unchanged protection)
--   T5c  locked: home_team_id update refused          (RE-KEYED from notes —
--        see schedule-lock-sim.sql's header for why home_team_id)
--   N1a  locked: a NOTE edit is allowed
--   N1b  …and attributed: notes_updated_by = the caller, notes_updated_at set
--   N2   locked division stays POSTED after a note-only edit
--   N3   open division stays POSTED after a note-only edit
--   N4   MIXED edit (note + scheduled_at) CLEARS posted
--   N5   a real edit alone (venue_id) CLEARS posted        (unchanged)
--   N6   removing the note clears both attribution columns
--   N7   a 501-character note is refused; 500 is accepted
--   N8   INSERT still clears posted                         (branch untouched)
--   N9   a non-note edit leaves the attribution columns alone
--   K1   THE PARTNER'S SCHEDULE PAGE NEVER CARRIES A NOTE: an accepted
--        interleague game with the note 'ZZ_SECRET_NOTE' is read through
--        get_interleague_schedule_by_token and the JSON must not contain it
--        (behavioural — catches a leak by any means, not just the obvious one)
--   K2   no token RPC's prosrc mentions `notes` at all (the cheap scan)
-- Mutants (target tag in brackets)
--   NM1  lock allowlist loses 'notes'                          [N1a]
--   NM2  posted trigger's ignore set loses 'notes' (a note clears) [N3]
--   NM3  M4 RE-KEYED: subtraction check -> enumerated blocklist naming
--        home_score + away_team_id only                        [T5c]
--   NM4  attribution trigger writes null for the editor         [N1b]
--   NM5  posted UPDATE branch never clears                      [N4]
--   NM6  get_interleague_schedule_by_token emits the note
--        (`'notes', g.notes` added beside every `'is_away'`)     [K1]
-- Anti-vacuity: c_note_only, c_mixed, c_locked_note_allowed, c_real_cleared —
-- all must be > 0 on the baseline pass.

do $harness$
declare
  out        text := '';
  total_fail int := 0;
  f          text[];
  pass       int;
  orig_def   text;
  mut_def    text;
  m_fn   text[] := array[
    'public.enforce_division_lock()',
    'public.clear_division_posted()',
    'public.enforce_division_lock()',
    'public.set_games_notes_attribution()',
    'public.clear_division_posted()',
    'public.get_interleague_schedule_by_token(text)'
  ];
  m_old  text[] := array[
    E'    ''notes'',\n',
    E'(to_jsonb(n) - ''notes'' - ''notes_updated_at''',
    E'  if (to_jsonb(old) - v_allow) is distinct from (to_jsonb(new) - v_allow) then',
    E'      new.notes_updated_by := auth.uid();',
    E'     where d.posted\n       and d.id in (\n         select t.division_id\n           from newrows n',
    E'''is_away'','
  ];
  m_new  text[] := array[
    E'',
    E'(to_jsonb(n) - ''notes_updated_at''',
    E'  if new.home_score is distinct from old.home_score or new.away_team_id is distinct from old.away_team_id then',
    E'      new.notes_updated_by := null;',
    E'     where false\n       and d.id in (\n         select t.division_id\n           from newrows n',
    E'''notes'', g.notes, ''is_away'','
  ];
  m_tag  text[] := array['N1a', 'N3', 'T5c', 'N1b', 'N4', 'K1'];
  m_name text[] := array[
    'NM1 lock allowlist loses notes (note edit refused on a locked division)',
    'NM2 posted ignore set loses notes (a note-only edit clears posted)',
    'NM3 M4 re-keyed: subtraction check -> enumerated blocklist (home_team_id slips through)',
    'NM4 attribution writes null for the editor',
    'NM5 posted UPDATE branch never clears (a mixed edit keeps posted)',
    'NM6 get_interleague_schedule_by_token emits the note (a partner page could show it)'
  ];
  c_note_only int := 0; c_mixed int := 0; c_locked_note_allowed int := 0; c_real_cleared int := 0;
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
        v_user uuid; v_lg uuid; v_locked uuid; v_open uuid;
        v_tL uuid; v_tL2 uuid; v_tO uuid; v_tO2 uuid;
        v_gL uuid; v_gO uuid; v_gMix uuid; v_gReal uuid; v_gIL uuid; v_org uuid;
        v_ok boolean; g record; j jsonb;
      begin
        select owner_id into v_user from public.leagues where owner_id is not null limit 1;
        perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', v_user::text, true);

        insert into public.leagues (name,sport,season,owner_id) values ('ZZ_N','baseball','N',v_user) returning id into v_lg;
        insert into public.divisions (league_id,name) values (v_lg,'ZZ_N_Locked') returning id into v_locked;
        insert into public.divisions (league_id,name) values (v_lg,'ZZ_N_Open') returning id into v_open;
        insert into public.teams (league_id,division_id,name) values (v_lg,v_locked,'L1') returning id into v_tL;
        insert into public.teams (league_id,division_id,name) values (v_lg,v_locked,'L2') returning id into v_tL2;
        insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'O1') returning id into v_tO;
        insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'O2') returning id into v_tO2;
        insert into public.games (league_id,home_team_id,away_team_id,scheduled_at) values (v_lg,v_tL,v_tL2,now()) returning id into v_gL;
        insert into public.games (league_id,home_team_id,away_team_id,scheduled_at) values (v_lg,v_tO,v_tO2,now()) returning id into v_gO;
        insert into public.games (league_id,home_team_id,away_team_id,scheduled_at) values (v_lg,v_tO,v_tO2,now()+interval '1 day') returning id into v_gMix;
        insert into public.games (league_id,home_team_id,away_team_id,scheduled_at) values (v_lg,v_tO,v_tO2,now()+interval '2 day') returning id into v_gReal;
        -- An ACCEPTED interleague game carrying a note, readable by the partner's
        -- schedule token — the surface a note must never reach.
        insert into public.interleague_orgs (owner_id,name,admin_email) values (v_user,'ZZ_N_ORG','zzn@example.invalid') returning id into v_org;
        insert into public.interleague_invites (token,sender_user_id,interleague_org_id,season_id,recipient_email,status,schedule_token)
          values ('ZZ_N_INV', v_user, v_org, v_lg, 'zzn@example.invalid', 'accepted', 'ZZ_N_SCHED');
        insert into public.games (league_id,home_team_id,away_team_id,scheduled_at,interleague_org_id,status,external_team_name,notes)
          values (v_lg,v_tO,null,now()+interval '4 day',v_org,'scheduled','Rockies','ZZ_SECRET_NOTE lights out') returning id into v_gIL;
        update public.divisions set locked=true, posted=true, posted_at=now() where id=v_locked;
        update public.divisions set posted=true, posted_at=now() where id=v_open;

        ---------------------------------------------------------- K1 / K2: the partner never sees a note
        j := public.get_interleague_schedule_by_token('ZZ_N_SCHED');
        if j::text ~ 'ZZ_SECRET_NOTE' then f := f || 'K1'::text; end if;
        if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname like 'get_%_by_token'
               -- Comments are not returned: strip them first (2026-10-08). The
               -- 0099 calendar reader and the 0105 league reader both SAY in a
               -- comment that the body must not emit notes, which made the
               -- unstripped scan fire on the very rule it checks. NOT re-run
               -- since this edit.
               and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\mnotes\M') > 0 then
          f := f || 'K2'::text;
        end if;

        ---------------------------------------------------------- T5a / T5c on the LOCKED game
        v_ok:=false;
        begin update public.games set home_score=5 where id=v_gL;
        exception when others then v_ok:=true; end;
        if not v_ok then f := f || 'T5a'::text; end if;
        v_ok:=false;
        begin update public.games set home_team_id=v_tL2 where id=v_gL;
        exception when others then v_ok:=true; end;
        if not v_ok then f := f || 'T5c'::text; end if;

        ---------------------------------------------------------- N1 / N2: a note on a LOCKED game
        v_ok:=true;
        begin update public.games set notes='Lights out on field 2' where id=v_gL;
        exception when others then v_ok:=false; end;
        if not v_ok then f := f || 'N1a'::text;
        elsif pass = 0 then c_locked_note_allowed := c_locked_note_allowed + 1; end if;
        select * into g from public.games where id=v_gL;
        if v_ok and (g.notes_updated_by is distinct from v_user or g.notes_updated_at is null) then f := f || 'N1b'::text; end if;
        if not (select posted from public.divisions where id=v_locked) then f := f || 'N2'::text;
        elsif v_ok and pass = 0 then c_note_only := c_note_only + 1; end if;

        ---------------------------------------------------------- N3: note-only on an OPEN posted division
        update public.games set notes='Bring the extra bases' where id=v_gO;
        if not (select posted from public.divisions where id=v_open) then f := f || 'N3'::text;
        elsif pass = 0 then c_note_only := c_note_only + 1; end if;

        ---------------------------------------------------------- N4: MIXED edit clears
        update public.games set notes='moved for lights', scheduled_at = scheduled_at + interval '1 hour' where id=v_gMix;
        if (select posted from public.divisions where id=v_open) then f := f || 'N4'::text;
        elsif pass = 0 then c_mixed := c_mixed + 1; end if;

        ---------------------------------------------------------- N5: a real edit alone clears (unchanged)
        update public.divisions set posted=true where id=v_open;
        update public.games set status='cancelled' where id=v_gReal;
        if (select posted from public.divisions where id=v_open) then f := f || 'N5'::text;
        elsif pass = 0 then c_real_cleared := c_real_cleared + 1; end if;

        ---------------------------------------------------------- N9: a non-note edit leaves attribution alone
        select * into g from public.games where id=v_gO;
        update public.games set venue_id=null where id=v_gO;
        if (select notes_updated_at from public.games where id=v_gO) is distinct from g.notes_updated_at
           or (select notes_updated_by from public.games where id=v_gO) is distinct from g.notes_updated_by then
          f := f || 'N9'::text;
        end if;

        ---------------------------------------------------------- N6: removing the note clears attribution
        update public.games set notes=null where id=v_gO;
        select * into g from public.games where id=v_gO;
        if g.notes_updated_at is not null or g.notes_updated_by is not null then f := f || 'N6'::text; end if;

        ---------------------------------------------------------- N7: the 500 CHECK
        v_ok:=false;
        begin update public.games set notes=repeat('x',501) where id=v_gO;
        exception when others then v_ok:=true; end;
        if not v_ok then f := f || 'N7'::text; end if;
        v_ok:=true;
        begin update public.games set notes=repeat('x',500) where id=v_gO;
        exception when others then v_ok:=false; end;
        if not v_ok then f := f || 'N7'::text; end if;

        ---------------------------------------------------------- N8: INSERT branch untouched
        update public.divisions set posted=true where id=v_open;
        insert into public.games (league_id,home_team_id,away_team_id,scheduled_at) values (v_lg,v_tO,v_tO2,now()+interval '3 day');
        if (select posted from public.divisions where id=v_open) then f := f || 'N8'::text; end if;

        raise exception 'HARNESS_PASS_END';
      end;
    exception when others then
      if sqlerrm <> 'HARNESS_PASS_END' then
        f := f || ('ERR:' || sqlerrm)::text;
      end if;
    end;

    if pass = 0 then
      if array_length(f, 1) is null then out := out || E'BASELINE PASS\n';
      else total_fail := total_fail + 1; out := out || format(E'BASELINE FAIL %s\n', f); end if;
    elsif m_tag[pass] = any(f) then
      out := out || format(E'KILLED  %s — by %s (all: %s)\n', m_name[pass], m_tag[pass], f);
    else
      total_fail := total_fail + 1;
      out := out || format(E'SURVIVED %s — target %s not in %s\n', m_name[pass], m_tag[pass], f);
    end if;
  end loop;

  if c_note_only = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_note_only\n'; end if;
  if c_mixed = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_mixed\n'; end if;
  if c_locked_note_allowed = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_locked_note_allowed\n'; end if;
  if c_real_cleared = 0 then total_fail := total_fail + 1; out := out || E'VACUOUS c_real_cleared\n'; end if;
  out := out || format(E'counters note_only=%s mixed=%s locked_note_allowed=%s real_cleared=%s\n',
    c_note_only, c_mixed, c_locked_note_allowed, c_real_cleared);
  out := out || case when total_fail = 0 then 'RESULT PASS' else format('RESULT FAIL (%s)', total_fail) end;
  raise exception E'HARNESS-NOTES\n%', out;
end
$harness$;

-- ── Run log ──────────────────────────────────────────────────────────────────
--
-- 2026-09-28, BEFORE 0095/0096 were applied. Batch = 0095's text, 0096's
-- text, this DO block.
--   BASELINE PASS
--   KILLED  NM1 lock allowlist loses notes           — by N1a (only N1a)
--   KILLED  NM2 posted ignore set loses notes        — by N3 (+N2)
--   KILLED  NM3 M4 re-keyed (enumerated blocklist)   — by T5c (+N2: the
--           unblocked home_team_id move re-homed the game, clearing posted)
--   KILLED  NM4 attribution writes null              — by N1b (only N1b)
--   KILLED  NM5 posted UPDATE branch never clears    — by N4 (+N5)
--   counters note_only=2 mixed=1 locked_note_allowed=1 real_cleared=1
-- After apply, with the K1/K2 partner-leak fixture and NM6 added (live
-- functions, every pass rolled back): BASELINE PASS; NM1–NM5 as above;
--   KILLED  NM6 schedule RPC emits the note                — by K1 (+K2)
-- Leak check afterwards: all four md5s unchanged (lock 39c43a87…, posted
-- e1a09324…, attribution 6190ad28…, schedule RPC 61f67505…), zero ZZ_%
-- rows across leagues / interleague_orgs / interleague_invites, games 663.
-- The same batch with scripts/sim/schedule-lock-sim.sql's DO block (T5c
-- re-keyed to home_team_id) in place of this one: HARNESS PASS, counters
-- ins=1 del=1 pend=1 updOK=3 updNO=3 orphan=1 open=1 posted=1 rpcLock=1
-- rpcPend=1 bypDiv=1 bypLg=1 — every pre-existing lock assertion holds.
-- Leak check: lock md5 still c14bd2cc…, posted 0d7faba2…, no attribution
-- function or columns, zero ZZ_% rows, games 663.
--
-- Then 0095 and 0096 applied verbatim via apply_migration. Live md5(prosrc):
-- enforce_division_lock 39c43a87d4b95a76c63cb63205ab95c0,
-- clear_division_posted e1a0932427550ddbca0725f6f7620855,
-- set_games_notes_attribution 6190ad28b15a7a7cef1566230b75832d — each equal
-- to its repo body. Six triggers on games, all enabled. FK
-- games_notes_updated_by_fkey → profiles; CHECK games_notes_length.
