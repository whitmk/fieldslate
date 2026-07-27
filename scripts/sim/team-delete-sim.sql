-- Guarded team-delete harness (migration 0084, delete_team_if_unblocked).
--
-- ── HOW TO RUN, AND WHY IT IS NOT `npm run sim:*` ───────────────────────────
-- Paste this whole file into the Supabase MCP / SQL editor and run the DO
-- block. It is NOT runnable via the tsx sim harnesses and NOT in CI, for the
-- same two reasons as schedule-lock-sim.sql: service_role has no DML on teams/
-- games/divisions/leagues, and fake-supabase.ts cannot simulate an FK cascade,
-- a SET NULL, or the row-lock/gate logic this RPC is made of. See CLAUDE.md
-- "Harness standard — SQL-level exceptions".
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
-- The whole body runs inside a DO block that ALWAYS ends in `raise exception`.
-- That raise carries the results out AND guarantees every scratch row rolls
-- back. There is no COMMIT path. "P0001: HARNESS PASS ..." is the SUCCESS
-- output. Run the leak check at the bottom afterward.
--
-- ── WHAT IT COVERS (12 assertions, 10 anti-vacuity counters) ────────────────
--   A1  preview: team WITH games in a LOCKED division -> blocked division_locked
--   A2  commit:  same team -> blocked, nothing deleted (team still present)
--   A3  preview: team with ZERO games in a LOCKED division -> blocked
--       division_locked   ★ Defect 1 — the hole this whole RPC exists to close
--   A4  commit:  same zero-games locked team -> blocked, team STILL PRESENT
--       ★ Defect 1 — proves the zero-games team is NOT silently deleted
--   A5  preview: team with a recorded result (unlocked) -> blocked
--       result_recorded
--   A6  preview: team with an accepted interleague game -> blocked
--       interleague_accepted
--   A7  preview: orphan team (division_id NULL) -> NOT blocked (null=>no lock)
--   A8  preview: deletable team -> not blocked; destroyed counts are REAL
--       (practice_slots/availability_blocks/team_constraints/official_conflicts/
--        games/umpire_assignments all = 1) and side_effects coach link = 1;
--       AND the team + its practice slot STILL EXIST after preview (preview is
--       non-destructive)
--   A9  commit: deletable team -> deleted=true; then team gone, game gone,
--       practice_slots/game_umpires/official_conflicts cascade-gone, and the
--       umpire's coach link (umpires.team_id) is SET NULL, not deleted
--
-- ── MUTATION PASS — 5 mutants, each killed by its OWN assertion ──────────────
-- Install each mutant with `create or replace` and re-run the baseline DO in
-- the SAME statement (so the raise rolls the mutant back — it can never
-- commit), confirm the NAMED assertion is in the FAIL list, then re-verify
-- md5(prosrc) == the repo body (725e6e9d5bc00ca3f4252e1ba40f13d2). "Killed"
-- means the baseline assertion failed — not merely that behavior changed.
--   M1 remove the division_locked block entirely          -> A3/A4 fail
--   M2 gate division_locked on `array_length(v_game_ids,1) > 0`
--      (i.e. lean on the games trigger)                   -> A3/A4 fail, A1 ok
--      ★ THE Defect-1 mutant: with games it still blocks, empty it leaks.
--   M3 remove the interleague_accepted block              -> A6 fails
--   M4 remove the result_recorded block                   -> A5 fails
--   M5 remove the `if not p_commit` preview guard
--      (preview deletes)                                  -> A8 non-destructive
--                                                            (c_preview_intact) fails
-- Each mutant targets an assertion nothing earlier can pre-empt: A1 (with
-- games) stays green under M2 precisely so the FAIL is attributed to the
-- empty-locked assertions A3/A4, not to a generic "lock broke".

do $h$
declare
  v_user uuid; v_lg uuid; v_org uuid; v_ump uuid;
  v_locked uuid; v_open uuid;
  v_tLockGames uuid; v_tLockOpp uuid; v_tLockEmpty uuid;
  v_tDel uuid; v_tOpp uuid; v_tResult uuid; v_tIL uuid; v_tOrphan uuid;
  v_gLock uuid; v_gDel uuid; v_gResult uuid; v_gIL uuid;
  v_res jsonb; v_fail text := '';
  c_lock_games int := 0; c_lock_games_safe int := 0;
  c_lock_empty int := 0; c_lock_empty_safe int := 0;
  c_result int := 0; c_il int := 0; c_orphan int := 0;
  c_preview_counts int := 0; c_preview_intact int := 0;
  c_commit_deleted int := 0; c_cascade_gone int := 0; c_setnull int := 0;
begin
  select owner_id into v_user from public.leagues where owner_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  insert into public.leagues (name,sport,season,owner_id) values ('ZZ_TD','baseball','TD',v_user) returning id into v_lg;
  insert into public.interleague_orgs (owner_id,name,admin_email) values (v_user,'ZZ_TDORG','td@example.invalid') returning id into v_org;
  insert into public.umpires (season_id,name,designation) values (v_lg,'ZZ_TDUMP','adult') returning id into v_ump;

  insert into public.divisions (league_id,name,locked) values (v_lg,'TDLocked',false) returning id into v_locked;
  insert into public.divisions (league_id,name,locked) values (v_lg,'TDOpen',false)   returning id into v_open;

  insert into public.teams (league_id,division_id,name) values (v_lg,v_locked,'LG')      returning id into v_tLockGames;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_locked,'LOpp')    returning id into v_tLockOpp;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_locked,'LEmpty')  returning id into v_tLockEmpty;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'Del')       returning id into v_tDel;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'Opp')       returning id into v_tOpp;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'Res')       returning id into v_tResult;
  insert into public.teams (league_id,division_id,name) values (v_lg,v_open,'IL')        returning id into v_tIL;
  insert into public.teams (league_id,division_id,name) values (v_lg,null,'Orphan')      returning id into v_tOrphan;

  -- Games (locked division still OFF so the trigger allows the seed).
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at)
    values (v_lg,v_tLockGames,v_tLockOpp,now()) returning id into v_gLock;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at)
    values (v_lg,v_tDel,v_tOpp,now()) returning id into v_gDel;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at,home_score)
    values (v_lg,v_tResult,v_tOpp,now(),5) returning id into v_gResult;
  insert into public.games (league_id,home_team_id,away_team_id,scheduled_at,interleague_org_id,status,external_team_name)
    values (v_lg,v_tIL,null,now(),v_org,'scheduled','Partner') returning id into v_gIL;

  -- Cascade + SET NULL fixtures on the deletable team.
  insert into public.practice_slots (team_id)                 values (v_tDel);
  insert into public.team_availability_blocks (team_id,day_of_week) values (v_tDel,'Mo');
  insert into public.team_game_constraints (team_id,day_of_week,severity) values (v_tDel,'Mo','block');
  insert into public.official_conflicts (umpire_id,team_id,relationship) values (v_ump,v_tDel,'parent');
  insert into public.game_umpires (game_id,umpire_id,role) values (v_gDel,v_ump,'PU');
  update public.umpires set team_id = v_tDel where id = v_ump;   -- coach link (SET NULL side effect)

  update public.divisions set locked=true where id=v_locked;

  -- NOTE: block-detection uses coalesce((v_res->>'blocked')::boolean,false), NOT
  -- `v_res ? 'blocked'` — the preview/deleted responses also carry a 'blocked'
  -- key (false / absent), so the `?` existence test evaluates to NULL and would
  -- SILENTLY SWALLOW a preview-level assertion under a mutant (learned running
  -- M2). Truthiness attributes the kill to the right assertion.

  -- ── A1 / A2: locked division, team WITH games ──────────────────────────────
  v_res := public.delete_team_if_unblocked(v_tLockGames, false);
  if coalesce((v_res->>'blocked')::boolean,false) and (v_res->'reasons' @> '["division_locked"]'::jsonb)
    then c_lock_games:=c_lock_games+1;
    else v_fail:=v_fail||'A1 locked+games preview not blocked: '||v_res::text||'; ';
  end if;
  v_res := public.delete_team_if_unblocked(v_tLockGames, true);
  if coalesce((v_res->>'blocked')::boolean,false) and exists(select 1 from public.teams where id=v_tLockGames)
    then c_lock_games_safe:=c_lock_games_safe+1;
    else v_fail:=v_fail||'A2 locked+games commit deleted something: '||v_res::text||'; ';
  end if;

  -- ── A3 / A4: locked division, team with ZERO games  ★ Defect 1 ─────────────
  v_res := public.delete_team_if_unblocked(v_tLockEmpty, false);
  if coalesce((v_res->>'blocked')::boolean,false) and (v_res->'reasons' @> '["division_locked"]'::jsonb)
    then c_lock_empty:=c_lock_empty+1;
    else v_fail:=v_fail||'A3 locked+EMPTY preview not blocked (Defect 1): '||v_res::text||'; ';
  end if;
  v_res := public.delete_team_if_unblocked(v_tLockEmpty, true);
  if coalesce((v_res->>'blocked')::boolean,false) and exists(select 1 from public.teams where id=v_tLockEmpty)
    then c_lock_empty_safe:=c_lock_empty_safe+1;
    else v_fail:=v_fail||'A4 locked+EMPTY commit DELETED the team (Defect 1): '||v_res::text||'; ';
  end if;

  -- ── A5: recorded result blocks even unlocked ───────────────────────────────
  v_res := public.delete_team_if_unblocked(v_tResult, false);
  if coalesce((v_res->>'blocked')::boolean,false) and (v_res->'reasons' @> '["result_recorded"]'::jsonb)
    then c_result:=c_result+1;
    else v_fail:=v_fail||'A5 result not blocked: '||v_res::text||'; ';
  end if;

  -- ── A6: accepted interleague blocks ────────────────────────────────────────
  v_res := public.delete_team_if_unblocked(v_tIL, false);
  if coalesce((v_res->>'blocked')::boolean,false) and (v_res->'reasons' @> '["interleague_accepted"]'::jsonb)
    then c_il:=c_il+1;
    else v_fail:=v_fail||'A6 interleague not blocked: '||v_res::text||'; ';
  end if;

  -- ── A7: orphan (null division) not blocked ─────────────────────────────────
  v_res := public.delete_team_if_unblocked(v_tOrphan, false);
  if (v_res->>'blocked')::boolean = false
    then c_orphan:=c_orphan+1;
    else v_fail:=v_fail||'A7 orphan wrongly blocked: '||v_res::text||'; ';
  end if;

  -- ── A8: deletable team preview — real counts, non-destructive ──────────────
  v_res := public.delete_team_if_unblocked(v_tDel, false);
  if (v_res->>'blocked')::boolean = false
     and (v_res->'destroyed'->>'games')::int = 1
     and (v_res->'destroyed'->>'practice_slots')::int = 1
     and (v_res->'destroyed'->>'availability_blocks')::int = 1
     and (v_res->'destroyed'->>'team_constraints')::int = 1
     and (v_res->'destroyed'->>'official_conflicts')::int = 1
     and (v_res->'destroyed'->>'umpire_assignments')::int = 1
     and (v_res->'side_effects'->>'official_coach_links_cleared')::int = 1
    then c_preview_counts:=c_preview_counts+1;
    else v_fail:=v_fail||'A8a preview counts wrong: '||v_res::text||'; ';
  end if;
  if exists(select 1 from public.teams where id=v_tDel)
     and exists(select 1 from public.practice_slots where team_id=v_tDel)
    then c_preview_intact:=c_preview_intact+1;
    else v_fail:=v_fail||'A8b preview DELETED something (not read-only); ';
  end if;

  -- ── A9: commit deletes; cascades gone; coach link SET NULL ─────────────────
  v_res := public.delete_team_if_unblocked(v_tDel, true);
  if (v_res ? 'deleted') then c_commit_deleted:=c_commit_deleted+1;
    else v_fail:=v_fail||'A9a deletable commit not deleted: '||v_res::text||'; ';
  end if;
  if not exists(select 1 from public.teams where id=v_tDel)
     and not exists(select 1 from public.games where id=v_gDel)
     and not exists(select 1 from public.practice_slots where team_id=v_tDel)
     and not exists(select 1 from public.game_umpires where game_id=v_gDel)
     and not exists(select 1 from public.official_conflicts where team_id=v_tDel)
    then c_cascade_gone:=c_cascade_gone+1;
    else v_fail:=v_fail||'A9b cascade rows survived; ';
  end if;
  if (select team_id from public.umpires where id=v_ump) is null
    then c_setnull:=c_setnull+1;
    else v_fail:=v_fail||'A9c coach link not SET NULL (was hard-deleted?); ';
  end if;

  -- ── Anti-vacuity: every guarded scenario must have actually fired ──────────
  if c_lock_games=0      then v_fail:=v_fail||'VACUOUS lock+games; '; end if;
  if c_lock_games_safe=0 then v_fail:=v_fail||'VACUOUS lock+games-safe; '; end if;
  if c_lock_empty=0      then v_fail:=v_fail||'VACUOUS lock+EMPTY (Defect 1); '; end if;
  if c_lock_empty_safe=0 then v_fail:=v_fail||'VACUOUS lock+EMPTY-safe (Defect 1); '; end if;
  if c_result=0          then v_fail:=v_fail||'VACUOUS result; '; end if;
  if c_il=0              then v_fail:=v_fail||'VACUOUS interleague; '; end if;
  if c_orphan=0          then v_fail:=v_fail||'VACUOUS orphan; '; end if;
  if c_preview_counts=0  then v_fail:=v_fail||'VACUOUS preview-counts; '; end if;
  if c_preview_intact=0  then v_fail:=v_fail||'VACUOUS preview-intact; '; end if;
  if c_commit_deleted=0  then v_fail:=v_fail||'VACUOUS commit-deleted; '; end if;
  if c_cascade_gone=0    then v_fail:=v_fail||'VACUOUS cascade-gone; '; end if;
  if c_setnull=0         then v_fail:=v_fail||'VACUOUS setnull; '; end if;

  raise exception E'HARNESS %\ncounters lockG=% lockGsafe=% lockE=% lockEsafe=% result=% il=% orphan=% prevCnt=% prevIntact=% commit=% cascade=% setnull=%',
    case when v_fail='' then 'PASS' else 'FAIL -> '||v_fail end,
    c_lock_games,c_lock_games_safe,c_lock_empty,c_lock_empty_safe,c_result,c_il,
    c_orphan,c_preview_counts,c_preview_intact,c_commit_deleted,c_cascade_gone,c_setnull;
end
$h$;

-- ── LEAK CHECK — run after every harness or mutation run ────────────────────
-- Both counts must be 0, and the md5 must match the repo body. A surviving
-- scratch row or a drifted md5 means a mutant or scratch data leaked into prod.
--
-- select
--   (select count(*) from public.leagues where name like 'ZZ_TD%')          as scratch_leagues,
--   (select count(*) from public.interleague_orgs where name like 'ZZ_TD%') as scratch_orgs,
--   (select md5(prosrc) from pg_proc where proname='delete_team_if_unblocked') as fn_md5;
--   -- expected fn_md5 = 725e6e9d5bc00ca3f4252e1ba40f13d2
