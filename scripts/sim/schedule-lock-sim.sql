-- Schedule-lock enforcement harness (migrations 0080-0083).
--
-- ── HOW TO RUN, AND WHY IT IS NOT `npm run sim:*` ───────────────────────────
-- Paste this whole file into the Supabase MCP / SQL editor and run it. It is
-- NOT runnable via the tsx sim harnesses and NOT runnable in CI. Two hard
-- reasons, both verified 2026-07-23:
--   1. service_role has NO SELECT/INSERT/UPDATE/DELETE on games, divisions,
--      teams, or leagues (only REFERENCES/TRIGGER/TRUNCATE). A service-role
--      tsx harness 42501s on its first write. Widening production grants to
--      make a test run would be the wrong trade.
--   2. scripts/sim/fake-supabase.ts is an in-memory fake. It cannot simulate a
--      Postgres trigger, CHECK, or FK — the very things under test here.
-- This is a real gap versus the officials/round-order sims. Do not describe it
-- as equivalent. See CLAUDE.md "Harness standard — SQL-level exceptions".
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
-- The whole body runs inside a DO block that ALWAYS ends in `raise exception`.
-- That is not an error — it is the mechanism: the raise carries the results out
-- AND guarantees every fixture row is rolled back. There is no COMMIT path.
-- A "P0001: HARNESS PASS ..." error is the SUCCESS output.
-- After running, confirm cleanup with the leak check at the bottom.
--
-- ── WHAT IT COVERS (12 assertions, 12 anti-vacuity counters) ────────────────
--   T1  INSERT refused in a locked division
--   T2  DELETE refused in a locked division
--   T3  CARVE-OUT: pending_interleague DELETE allowed (partner decline path,
--       which is why partner decline needs no bypass)
--   T4  allowlisted UPDATEs allowed: rainout (status), reschedule
--       (scheduled_at/venue_id), partner accept (external_team_name+status)
--   T5  non-allowlisted UPDATEs refused: home_score, away_team_id, AND notes.
--       `notes` is the one that proves the check is SUBTRACTION-based rather
--       than an enumerated blocklist — drop it and mutant M4 survives.
--   T6  CARVE-OUT: NULL division_id => not locked => row stays mutable
--   T7  unlocked division is entirely unrestricted
--   T8  posted auto-clears on an ALLOWED change inside a LOCKED division
--   T9  delete_game_if_unblocked reports division_locked as a third reason
--   T10 that RPC does NOT report it for pending_interleague (trigger parity —
--       the two guards must agree about the same row)
--   T11 BYPASS: a locked division is still deletable
--   T12 BYPASS: an archived season holding a locked division is still deletable
--
-- ── MUTATION PASS (all 9 killed, 2026-07-23) ────────────────────────────────
-- Install each mutant, re-run the baseline, confirm the named assertion FAILS,
-- then roll back. Mutant "killed" means the baseline assertion failed.
--   M1 remove the INSERT block                    -> T1 fails
--   M2 remove the DELETE block                    -> T2 fails
--   M3 remove the pending_interleague carve-out   -> T3 fails
--   M4 subtraction check -> enumerated blocklist  -> T5c (notes) fails
--   M5 remove set_config bypass from
--      delete_division_permanently                -> T11 fails
--   M6 make NULL division fail CLOSED             -> T6 fails
--   M7 make clear_division_posted a no-op         -> T8 fails
--   M8 remove division_locked from the RPC        -> T9 fails
--   M9 remove the RPC's pending exclusion         -> T10 fails
-- Run mutants inside the SAME always-raising DO pattern so the mutated
-- function can never commit. AFTER any mutation run, re-verify md5(prosrc)
-- against the repo migration bodies — a surviving mutant in production would
-- be far worse than a failing test.

do $h$
declare
  v_user uuid; v_lg uuid; v_lgArch uuid;
  v_locked uuid; v_open uuid; v_archDiv uuid;
  v_tL uuid; v_tL2 uuid; v_tO uuid; v_tO2 uuid; v_tArch uuid; v_tOrphan uuid;
  v_gNorm uuid; v_gPend uuid; v_gOpen uuid; v_gOrphan uuid; v_gAcc uuid;
  v_org uuid; v_res jsonb; v_ok boolean; v_fail text := '';
  c_ins_blocked int := 0; c_del_blocked int := 0; c_pending_del_ok int := 0;
  c_upd_allowed int := 0; c_upd_blocked int := 0; c_orphan_ok int := 0;
  c_bypass_div int := 0; c_bypass_lg int := 0; c_posted int := 0;
  c_rpc_locked int := 0; c_rpc_pending int := 0; c_open_ok int := 0;
begin
  select owner_id into v_user from public.leagues where owner_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  insert into public.leagues (name,sport,season,owner_id) values ('ZZ_H','baseball','H',v_user) returning id into v_lg;
  insert into public.leagues (name,sport,season,owner_id,archived_at) values ('ZZ_HA','baseball','HA',v_user,now()) returning id into v_lgArch;
  insert into public.interleague_orgs (owner_id,name,admin_email) values (v_user,'ZZ_HORG','h@example.invalid') returning id into v_org;

  insert into public.divisions (league_id,name,locked,posted) values (v_lg,'LockedDiv',true,true) returning id into v_locked;
  insert into public.divisions (league_id,name,locked,posted) values (v_lg,'OpenDiv',false,true) returning id into v_open;
  insert into public.divisions (league_id,name,locked) values (v_lgArch,'ArchLocked',true) returning id into v_archDiv;

  insert into public.teams (league_id,division_id,name) values (v_lg,v_locked,'L1') returning id into v_tL;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_locked,'L2') returning id into v_tL2;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'O1') returning id into v_tO;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'O2') returning id into v_tO2;
  insert into public.teams (league_id,division_id,name) values (v_lgArch,v_archDiv,'A1') returning id into v_tArch;
  insert into public.teams (league_id,division_id,name) values (v_lg,null,'ORPHAN') returning id into v_tOrphan;

  -- Plant fixtures with the lock OFF, then turn it on — the trigger would
  -- otherwise refuse the seed inserts it is being tested against.
  update public.divisions set locked=false where id in (v_locked, v_archDiv);
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at)
    values (v_lg,v_tL,v_tL2,now()) returning id into v_gNorm;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at,interleague_org_id,status,is_away)
    values (v_lg,v_tL,null,now(),v_org,'pending_interleague',true) returning id into v_gPend;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at,interleague_org_id,status,external_team_name)
    values (v_lg,v_tL2,null,now(),v_org,'scheduled','Partner') returning id into v_gAcc;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at)
    values (v_lg,v_tO,v_tO2,now()) returning id into v_gOpen;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at)
    values (v_lg,v_tOrphan,v_tO2,now()) returning id into v_gOrphan;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at) values (v_lgArch,v_tArch,v_tArch,now());
  update public.divisions set locked=true, posted=true where id in (v_locked, v_archDiv);
  update public.divisions set posted=true where id = v_open;

  v_ok:=false;
  begin insert into public.games (league_id,home_team_id,away_team_id,scheduled_at) values (v_lg,v_tL,v_tL2,now());
  exception when others then v_ok:=true; c_ins_blocked:=c_ins_blocked+1; end;
  if not v_ok then v_fail:=v_fail||'T1 insert-not-blocked; '; end if;

  v_ok:=false;
  begin delete from public.games where id=v_gNorm;
  exception when others then v_ok:=true; c_del_blocked:=c_del_blocked+1; end;
  if not v_ok then v_fail:=v_fail||'T2 delete-not-blocked; '; end if;

  v_ok:=true;
  begin delete from public.games where id=v_gPend; c_pending_del_ok:=c_pending_del_ok+1;
  exception when others then v_ok:=false; end;
  if not v_ok then v_fail:=v_fail||'T3 pending-delete-wrongly-blocked; '; end if;

  v_ok:=true;
  begin
    update public.games set status='cancelled' where id=v_gNorm;
    update public.games set scheduled_at=now()+interval '1 day', status='scheduled' where id=v_gNorm;
    update public.games set external_team_name='Partner B', status='scheduled' where id=v_gAcc;
    c_upd_allowed:=c_upd_allowed+3;
  exception when others then v_ok:=false; end;
  if not v_ok then v_fail:=v_fail||'T4 allowed-update-blocked: '||SQLERRM||'; '; end if;

  v_ok:=false;
  begin update public.games set home_score=5 where id=v_gNorm;
  exception when others then v_ok:=true; c_upd_blocked:=c_upd_blocked+1; end;
  if not v_ok then v_fail:=v_fail||'T5a score-update-not-blocked; '; end if;
  v_ok:=false;
  begin update public.games set away_team_id=v_tO where id=v_gNorm;
  exception when others then v_ok:=true; c_upd_blocked:=c_upd_blocked+1; end;
  if not v_ok then v_fail:=v_fail||'T5b opponent-update-not-blocked; '; end if;
  v_ok:=false;
  begin update public.games set notes='x' where id=v_gNorm;
  exception when others then v_ok:=true; c_upd_blocked:=c_upd_blocked+1; end;
  if not v_ok then v_fail:=v_fail||'T5c notes-update-not-blocked (subtraction check missed a column); '; end if;

  v_ok:=true;
  begin
    update public.games set home_score=3 where id=v_gOrphan;
    delete from public.games where id=v_gOrphan;
    c_orphan_ok:=c_orphan_ok+1;
  exception when others then v_ok:=false; end;
  if not v_ok then v_fail:=v_fail||'T6 orphan-row-immutable; '; end if;

  v_ok:=true;
  begin update public.games set home_score=9 where id=v_gOpen; delete from public.games where id=v_gOpen; c_open_ok:=c_open_ok+1;
  exception when others then v_ok:=false; end;
  if not v_ok then v_fail:=v_fail||'T7 unlocked-division-restricted; '; end if;

  update public.divisions set posted=true where id=v_locked;
  update public.games set status='cancelled' where id=v_gNorm;
  if (select posted from public.divisions where id=v_locked) then
    v_fail:=v_fail||'T8 posted-not-cleared; ';
  else c_posted:=c_posted+1; end if;

  v_res := public.delete_game_if_unblocked(v_gNorm);
  if not (v_res ? 'blocked') or not (v_res->'reasons' @> '["division_locked"]'::jsonb) then
    v_fail:=v_fail||'T9 rpc-missing-division_locked: '||v_res::text||'; ';
  else c_rpc_locked:=c_rpc_locked+1; end if;

  update public.divisions set locked=false where id=v_locked;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at,interleague_org_id,status,is_away)
    values (v_lg,v_tL,null,now(),v_org,'pending_interleague',true) returning id into v_gPend;
  update public.divisions set locked=true where id=v_locked;
  v_res := public.delete_game_if_unblocked(v_gPend);
  if not (v_res ? 'deleted') then
    v_fail:=v_fail||'T10 rpc-refused-pending-that-trigger-allows: '||v_res::text||'; ';
  else c_rpc_pending:=c_rpc_pending+1; end if;

  v_res := public.delete_division_permanently(v_locked);
  if not (v_res ? 'deleted') then v_fail:=v_fail||'T11 locked-division-undeletable: '||v_res::text||'; ';
  else c_bypass_div:=c_bypass_div+1; end if;

  v_res := public.delete_league_permanently(v_lgArch);
  if not (v_res ? 'deleted') then v_fail:=v_fail||'T12 locked-season-undeletable: '||v_res::text||'; ';
  else c_bypass_lg:=c_bypass_lg+1; end if;

  -- Anti-vacuity: a conditional invariant whose condition never fires passes
  -- while checking nothing. Every carve-out must have actually been exercised.
  if c_ins_blocked=0 then v_fail:=v_fail||'VACUOUS insert-block; '; end if;
  if c_del_blocked=0 then v_fail:=v_fail||'VACUOUS delete-block; '; end if;
  if c_pending_del_ok=0 then v_fail:=v_fail||'VACUOUS pending-carveout; '; end if;
  if c_upd_allowed<3 then v_fail:=v_fail||'VACUOUS allowlist; '; end if;
  if c_upd_blocked<3 then v_fail:=v_fail||'VACUOUS subtraction-check; '; end if;
  if c_orphan_ok=0 then v_fail:=v_fail||'VACUOUS orphan-carveout; '; end if;
  if c_open_ok=0 then v_fail:=v_fail||'VACUOUS unlocked-path; '; end if;
  if c_posted=0 then v_fail:=v_fail||'VACUOUS posted-clear; '; end if;
  if c_rpc_locked=0 then v_fail:=v_fail||'VACUOUS rpc-locked; '; end if;
  if c_rpc_pending=0 then v_fail:=v_fail||'VACUOUS rpc-pending-parity; '; end if;
  if c_bypass_div=0 then v_fail:=v_fail||'VACUOUS bypass-division; '; end if;
  if c_bypass_lg=0 then v_fail:=v_fail||'VACUOUS bypass-league; '; end if;

  raise exception E'HARNESS %\ncounters ins=% del=% pend=% updOK=% updNO=% orphan=% open=% posted=% rpcLock=% rpcPend=% bypDiv=% bypLg=%',
    case when v_fail='' then 'PASS' else 'FAIL -> '||v_fail end,
    c_ins_blocked,c_del_blocked,c_pending_del_ok,c_upd_allowed,c_upd_blocked,
    c_orphan_ok,c_open_ok,c_posted,c_rpc_locked,c_rpc_pending,c_bypass_div,c_bypass_lg;
end
$h$;

-- ── LEAK CHECK — run after every harness or mutation run ────────────────────
-- All five counts must be 0. A non-zero disabled_triggers or a function whose
-- md5 no longer matches its migration means a mutant or a disabled guard
-- survived into production; fix that before anything else.
--
-- select
--   (select count(*) from public.leagues where name like 'ZZ_%')          as scratch_leagues,
--   (select count(*) from public.interleague_orgs where name like 'ZZ_%') as scratch_orgs,
--   (select count(*) from public.divisions where locked)                  as locked_divisions,
--   (select count(*) from public.divisions where posted)                  as posted_divisions,
--   (select count(*) from pg_trigger where tgrelid='public.games'::regclass
--      and not tgisinternal and tgenabled <> 'O')                         as disabled_triggers;
