-- 0113: two-stage playoffs — "Round robin, then bracket" (approved mockup
-- docs/mockups/two-stage-playoffs.html, 2026-10-19).
--
-- Stage 1 is a round robin; Stage 2 is a single-elimination bracket for the
-- top N, created at setup WITH dates and fields but NO teams — each slot
-- waiting for a team carries a SEED NUMBER — and seeded by the admin once
-- Stage 1 is over. FieldSlate never ranks teams: the admin orders the seeds.
-- Every rule and sentence lives in src/lib/playoffs/two-stage.ts; this file
-- enforces them.
--
-- WHAT THIS FILE DOES
--   1. Schema. playoffs: the one-bracket-per-division rule becomes one per
--      division PER STAGE; `stage` (1 or 2), `parent_playoff_id` (Stage 2 →
--      its Stage 1; deleting Stage 1 deletes Stage 2), `advance_count`,
--      `games_per_team_per_day` (1 or 2, default 1 — both stages, and the
--      plain round robin), `seeded_at`, `seeded_by`, `stage1_changed_at`.
--      playoff_games: `seed_home`, `seed_away`, and `pool` — NULL and read by
--      nothing in this build (pools are a planned follow-up; NULL = no pools).
--      Every existing bracket becomes stage 1 with no parent and is otherwise
--      untouched.
--   2. replace_playoff_games (from 0112) refuses either half of a two-stage
--      pair (`two_stage_pair`) and stores the round robin's per-day limit.
--   3. delete_playoff_bracket (from 0112): deleting EITHER stage deletes both
--      (decided 2026-10-19, D4); the counts cover both.
--   4. enter_playoff_result (0108) and clear_playoff_result (0112): a Stage 1
--      result can be neither changed nor cleared once Stage 2 has a result
--      (`blocked` / `next_stage_started`); a change after seeding flags Stage
--      2 for a re-check (`stage1_changed_at`) and logs it. Ties are still
--      refused.
--   5. get_league_schedule_by_token (0112) also emits each playoff game's
--      `stage`, `seed_home` and `seed_away`, so the public page can say
--      "Seed 4". Nothing else changes; no records exist in the database.
--   6. New, SECURITY DEFINER, EXECUTE for `authenticated` only:
--        replace_two_stage_games  — builds BOTH stages in one transaction, or
--                                   Stage 2 alone (Stage 1's games kept, its
--                                   seeds re-applied)
--        seed_playoff_stage       — fills Stage 2's team slots IN PLACE from
--                                   the admin's order; its own preview
--        acknowledge_stage_seeds  — "Seeds are still right"
--      and two helpers callable by NO role: playoff_write_stage,
--      playoff_apply_seeds.
--
-- TWO WRITERS, PINNED. replace_playoff_games keeps its own body (the 0107 and
-- 0108 proofs re-run against this file unchanged); playoff_write_stage is the
-- two-stage writer and re-states its payload checks. The proof requires both
-- to write IDENTICAL rows for the same Stage 1 payload (EQ1). Change one,
-- change the other.
--
-- SEEDING RULES (decided 2026-10-19): allowed when every Stage 1 game has a
-- result, OR every game without one is rained out (`cancelled`), has no date,
-- or is dated before today in the ORG's timezone ("Seed anyway"); refused
-- while any Stage 2 game has a result. The order must be exactly Stage 1's
-- teams. Seeding writes team ids into the seeded slots only — dates, times,
-- fields and game numbers are untouched — and stores the order on Stage 2's
-- `seeding` row. Re-seeding ("Change seeds") is the same call.
--
-- LOCK ORDER, every function that touches both stages: Stage 1 row → Stage 1
-- games → Stage 2 row → Stage 2 games. A Stage 2 result entry locks Stage 2
-- only. No cycle.
--
-- HONEST SCOPE. playoffs and playoff_games are RLS ALL for org members (0049),
-- so a member can still write any of these columns straight from the
-- browser, as with every bracket today. These functions make the product's
-- writes atomic, checked and logged; they are not a permission fence.
--
-- GATE: is_org_member + Elite, as 0107/0108.
--
-- LOCKS WHEN APPLIED: ACCESS EXCLUSIVE on `playoffs` and `playoff_games` for
-- the ALTERs (no rewrite: every new column is nullable or has a constant
-- default; the new unique index scans every playoffs row — five today). It
-- blocks the Playoffs page, the public schedule reader, auto-archive's
-- playoff read and the snack shack's playoff read for that moment. Applied
-- in one transaction, for the whole migration (well under a second).
--
-- APPLY VERBATIM, comments included (CLAUDE.md). The verify block at the end
-- raises if a privilege is wrong. Verify md5(prosrc) of every function.
--
-- DEPLOY ORDER: apply BEFORE the two-stage code reaches main — the wizard
-- writes the new columns and calls the new functions. The code already on
-- main reads none of them and keeps working.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Schema
-- ────────────────────────────────────────────────────────────────────────────
alter table public.playoffs drop constraint playoffs_league_id_division_id_key;

alter table public.playoffs
  add column stage                  smallint    not null default 1,
  add column parent_playoff_id      uuid        references public.playoffs(id) on delete cascade,
  add column advance_count          smallint,
  add column games_per_team_per_day smallint    not null default 1,
  add column seeded_at              timestamptz,
  -- Attribution only (the activity log names the event). No FK: one to
  -- profiles would take SHARE ROW EXCLUSIVE on profiles while applying.
  add column seeded_by              uuid,
  add column stage1_changed_at      timestamptz;

alter table public.playoffs
  add constraint playoffs_stage_check
    check (stage in (1, 2)),
  add constraint playoffs_stage_parent_check
    check ((stage = 1 and parent_playoff_id is null) or (stage = 2 and parent_playoff_id is not null)),
  add constraint playoffs_stage2_shape_check
    check (stage = 1 or (format = 'single_elimination' and advance_count is not null)),
  add constraint playoffs_advance_count_check
    check (advance_count is null or advance_count >= 2),
  add constraint playoffs_games_per_team_per_day_check
    check (games_per_team_per_day in (1, 2)),
  add constraint playoffs_league_division_stage_key
    unique (league_id, division_id, stage);

-- One Stage 2 per Stage 1.
create unique index playoffs_one_stage2_per_parent
  on public.playoffs (parent_playoff_id) where parent_playoff_id is not null;

alter table public.playoff_games
  add column seed_home smallint,
  add column seed_away smallint,
  -- Planned follow-up (pools for Stage 1, needed for soccer). Written NULL and
  -- read by nothing in this build; NULL means no pools.
  add column pool      text;

alter table public.playoff_games
  add constraint playoff_games_seed_check
    check ((seed_home is null or seed_home >= 1) and (seed_away is null or seed_away >= 1)),
  add constraint playoff_games_pool_check
    check (pool is null or char_length(pool) between 1 and 40);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. replace_playoff_games — from 0112_feed_cutoff_last_day.sql; two-stage guard and per-day limit added
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.replace_playoff_games(
  p_playoff_id uuid,
  p_settings   jsonb,
  p_games      jsonb,
  p_commit     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po          public.playoffs%rowtype;
  v_league      public.leagues%rowtype;
  v_plan        text;
  v_tz          text;
  v_div_name    text;
  v_games       integer;
  v_dated       integer;
  v_results     integer;
  v_public_now  integer;
  v_new         integer;
  v_new_dated   integer;
  v_public_ok   boolean;
  v_public_after integer;
  v_inserted    integer;
  v_format      text;
  v_format_lbl  text;
  v_seeding     jsonb;
  v_start       date;
  v_end         date;
  v_days        text[];
  v_windows     jsonb;
  v_venues      jsonb;
  v_cross_on    boolean;
  v_cross_div   uuid;
  v_per_day     smallint;
  v_bad         integer;
  v_event       text;
  v_message     text;
begin
  if p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then its games.
  select * into v_po from public.playoffs where id = p_playoff_id for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_po.id for update;

  -- 2. Membership.
  select * into v_league from public.leagues where id = v_po.league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 3b. Two-stage (0113): either half of a pair is rebuilt only by
  --     replace_two_stage_games, which writes both stages in one transaction.
  if v_po.stage = 2 or exists (select 1 from public.playoffs c where c.parent_playoff_id = v_po.id) then
    raise exception 'two_stage_pair' using errcode = 'P0001';
  end if;

  -- 4. Settings. Every key is required and typed; a value that will not cast
  --    is invalid_settings, raised before anything is written.
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or jsonb_typeof(p_settings -> 'seeding') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'playing_days') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'day_windows') is distinct from 'object'
     or jsonb_typeof(p_settings -> 'venue_assignments') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'cross_division_enabled') is distinct from 'boolean'
     or (p_settings ->> 'format') is null
     or (p_settings ->> 'format') not in ('single_elimination', 'double_elimination', 'round_robin')
     -- 0113: the round robin's per-team daily limit, 1 or 2 (absent → 1).
     or coalesce(p_settings ->> 'games_per_team_per_day', '1') not in ('1', '2') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  begin
    v_format    := p_settings ->> 'format';
    v_seeding   := p_settings -> 'seeding';
    v_start     := nullif(p_settings ->> 'start_date', '')::date;
    v_end       := nullif(p_settings ->> 'end_date', '')::date;
    v_days      := array(select jsonb_array_elements_text(p_settings -> 'playing_days'));
    v_windows   := p_settings -> 'day_windows';
    v_venues    := p_settings -> 'venue_assignments';
    v_cross_on  := (p_settings ->> 'cross_division_enabled')::boolean;
    v_cross_div := nullif(p_settings ->> 'cross_division_opponent_id', '')::uuid;
    v_per_day   := coalesce((p_settings ->> 'games_per_team_per_day')::smallint, 1);
  exception when others then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end;
  -- The cross-division opponent must be another division of this season
  -- (the FK alone would accept any org's division).
  if v_cross_div is not null and not exists (
       select 1 from public.divisions d
        where d.id = v_cross_div and d.league_id = v_po.league_id and d.id <> v_po.division_id) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;

  -- 5. Games: a non-empty array of objects with a round and a game number;
  --    distinct game numbers (advancement resolves targets by number); every
  --    team in this season; every field in this org.
  if p_games is null or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) = 0 then
    raise exception 'no_games' using errcode = 'P0001';
  end if;
  select count(*) into v_bad
    from jsonb_array_elements(p_games) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(btrim(e ->> 'round'), '') = ''
      or coalesce(e ->> 'game_number', '') !~ '^[0-9]{1,6}$';
  if v_bad > 0 then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  if (select count(distinct (e ->> 'game_number')::integer) from jsonb_array_elements(p_games) e)
     <> jsonb_array_length(p_games) then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  begin
    select count(*) into v_bad
      from jsonb_array_elements(p_games) e,
           lateral (values (nullif(e ->> 'home_team_id', '')::uuid), (nullif(e ->> 'away_team_id', '')::uuid)) t(team_id)
     where t.team_id is not null
       and not exists (select 1 from public.teams tm where tm.id = t.team_id and tm.league_id = v_po.league_id);
  exception when invalid_text_representation then
    raise exception 'invalid_games' using errcode = 'P0001';
  end;
  if v_bad > 0 then
    raise exception 'team_not_in_season' using errcode = 'P0001';
  end if;
  begin
    select count(*) into v_bad
      from jsonb_array_elements(p_games) e
     where nullif(e ->> 'venue_id', '') is not null
       and not exists (select 1 from public.venues v
                        where v.id = (e ->> 'venue_id')::uuid and v.owner_id = v_league.owner_id);
  exception when invalid_text_representation then
    raise exception 'invalid_games' using errcode = 'P0001';
  end;
  if v_bad > 0 then
    raise exception 'venue_not_in_org' using errcode = 'P0001';
  end if;

  -- 6. Counts, before and after.
  select count(*),
         count(*) filter (where g.scheduled_date is not null),
         count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null)
    into v_games, v_dated, v_results
    from public.playoff_games g
   where g.playoff_id = v_po.id;

  v_new := jsonb_array_length(p_games);
  select count(*) into v_new_dated
    from jsonb_array_elements(p_games) e
   where nullif(e ->> 'scheduled_date', '') is not null;

  -- Whether this bracket's dated games show on the public schedule — see the
  -- header; mirrors 0105. "Now" uses the bracket's current status; "after"
  -- uses 'active', which a commit sets.
  select count(*) into v_public_now
    from public.playoff_games g
    join public.divisions d on d.id = g.division_id
   where g.playoff_id = v_po.id
     and g.scheduled_date is not null
     and d.locked
     and v_po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);
  -- New games are written with the bracket's own division_id.
  v_public_ok := v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.divisions d where d.id = v_po.division_id and d.locked)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);
  v_public_after := case when v_public_ok then v_new_dated else 0 end;

  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;

  -- 7. Results block a rebuild (commit or preview); nothing is written.
  if v_results > 0 then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reasons', jsonb_build_array('results_entered'),
      'playoff_id', v_po.id, 'division_id', v_po.division_id, 'division_name', v_div_name,
      'status', v_po.status,
      'games', v_games, 'dated_games', v_dated, 'games_with_results', v_results,
      'public_games', v_public_now,
      'new_games', v_new, 'new_dated_games', v_new_dated, 'public_games_after', v_public_after);
  end if;

  -- 8. The write: settings, games, status, log — one transaction.
  if p_commit then
    update public.playoffs
       set format = v_format,
           seeding = v_seeding,
           start_date = v_start,
           end_date = v_end,
           playing_days = v_days,
           day_windows = v_windows,
           venue_assignments = v_venues,
           cross_division_enabled = v_cross_on,
           cross_division_opponent_id = case when v_cross_on then v_cross_div else null end,
           games_per_team_per_day = v_per_day,
           updated_at = now()
     where id = v_po.id;

    delete from public.playoff_games where playoff_id = v_po.id;

    insert into public.playoff_games
      (playoff_id, league_id, division_id, round, game_number,
       home_team_id, away_team_id, venue_id, scheduled_date, start_time, status)
    select v_po.id, v_po.league_id, v_po.division_id,
           btrim(e ->> 'round'), (e ->> 'game_number')::integer,
           nullif(e ->> 'home_team_id', '')::uuid, nullif(e ->> 'away_team_id', '')::uuid,
           nullif(e ->> 'venue_id', '')::uuid,
           nullif(e ->> 'scheduled_date', '')::date, nullif(e ->> 'start_time', '')::time,
           'scheduled'
      from jsonb_array_elements(p_games) e;

    -- The bracket holds exactly the new games, or nothing is saved.
    select count(*) into v_inserted from public.playoff_games where playoff_id = v_po.id;
    if v_inserted <> v_new then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;

    update public.playoffs set status = 'active', updated_at = now() where id = v_po.id;

    v_format_lbl := case v_format
                      when 'single_elimination' then 'single elimination'
                      when 'double_elimination' then 'double elimination'
                      else 'round robin' end;
    if v_games = 0 then
      v_event := 'playoff_bracket_generated';
      v_message := format('%s playoff bracket generated (%s, %s %s, %s dated)',
        coalesce(v_div_name, 'Division'), v_format_lbl,
        v_new, case when v_new = 1 then 'game' else 'games' end, v_new_dated);
    else
      v_event := 'playoff_bracket_rebuilt';
      v_message := format('%s playoff bracket rebuilt (%s, %s %s replaced with %s, %s dated)',
        coalesce(v_div_name, 'Division'), v_format_lbl,
        v_games, case when v_games = 1 then 'game' else 'games' end, v_new, v_new_dated);
    end if;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, v_event, v_message);
  end if;

  return jsonb_build_object(
    'committed', p_commit, 'blocked', false, 'reasons', '[]'::jsonb,
    'playoff_id', v_po.id, 'division_id', v_po.division_id, 'division_name', v_div_name,
    'status', case when p_commit then 'active' else v_po.status end,
    'games', v_games, 'dated_games', v_dated, 'games_with_results', v_results,
    'public_games', v_public_now,
    'new_games', v_new, 'new_dated_games', v_new_dated, 'public_games_after', v_public_after);
end;
$$;

revoke execute on function public.replace_playoff_games(uuid, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.replace_playoff_games(uuid, jsonb, jsonb, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. delete_playoff_bracket — from 0112_feed_cutoff_last_day.sql; either stage deletes both
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_playoff_bracket(
  p_playoff_id uuid,
  p_commit     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po        public.playoffs%rowtype;
  v_league    public.leagues%rowtype;
  v_plan      text;
  v_tz        text;
  v_div_name  text;
  v_games     integer;
  v_dated     integer;
  v_results   integer;
  v_public    integer;
  v_format    text;
  v_message   text;
  v_root      uuid;
  v_ids       uuid[];
  v_pair      boolean;
begin
  if p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then its games. Two-stage (0113): deleting
  --    EITHER stage deletes both (decided 2026-10-19, D4) — the Stage 1 row is
  --    locked and deleted (Stage 2 cascades), then Stage 2, then all games.
  select coalesce(p.parent_playoff_id, p.id) into v_root from public.playoffs p where p.id = p_playoff_id;
  select * into v_po from public.playoffs where id = v_root for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoffs where parent_playoff_id = v_po.id for update;
  select array_agg(p.id order by p.stage) into v_ids
    from public.playoffs p where p.id = v_po.id or p.parent_playoff_id = v_po.id;
  v_pair := cardinality(v_ids) > 1;
  perform 1 from public.playoff_games where playoff_id = any (v_ids) for update;

  -- 2. Membership, judged on the season's org.
  select * into v_league from public.leagues where id = v_po.league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Counts (the confirm's numbers; taken after the locks).
  select count(*),
         count(*) filter (where g.scheduled_date is not null),
         count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null)
    into v_games, v_dated, v_results
    from public.playoff_games g
   where g.playoff_id = any (v_ids);

  -- On the public schedule right now — see the header; mirrors 0105.
  select count(*) into v_public
    from public.playoff_games g
    join public.divisions d on d.id = g.division_id
   where g.playoff_id = any (v_ids)
     and g.scheduled_date is not null
     and d.locked
     and exists (select 1 from public.playoffs po where po.id = g.playoff_id and po.status <> 'draft')
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);

  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;

  if p_commit then
    delete from public.playoffs where id = v_po.id;
    if not found then
      raise exception 'nothing_deleted' using errcode = 'P0001';
    end if;

    v_format := case when v_pair then 'round robin, then bracket' else case v_po.format
                  when 'single_elimination' then 'single elimination'
                  when 'double_elimination' then 'double elimination'
                  when 'round_robin' then 'round robin'
                  else v_po.format end end;
    v_message := format('%s playoff bracket deleted (%s, %s %s, %s with results, %s dated)',
      coalesce(v_div_name, 'Division'), v_format,
      v_games, case when v_games = 1 then 'game' else 'games' end,
      v_results, v_dated);
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_bracket_deleted', v_message);
  end if;

  return jsonb_build_object(
    'committed',          p_commit,
    'blocked',            false,
    'reasons',            '[]'::jsonb,
    'playoff_id',         v_po.id,
    'division_id',        v_po.division_id,
    'division_name',      v_div_name,
    'format',             v_po.format,
    'two_stage',          v_pair,
    'status',             v_po.status,
    'games',              v_games,
    'dated_games',        v_dated,
    'games_with_results', v_results,
    'public_games',       v_public
  );
end;
$$;

revoke execute on function public.delete_playoff_bracket(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.delete_playoff_bracket(uuid, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. enter_playoff_result — from 0108_playoff_result_enter_clear.sql; Stage 1 freeze and re-check flag added
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.enter_playoff_result(
  p_game_id    uuid,
  p_home_score integer,
  p_away_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po_id      uuid;
  v_po         public.playoffs%rowtype;
  v_league     public.leagues%rowtype;
  v_game       public.playoff_games%rowtype;
  v_target     public.playoff_games%rowtype;
  v_plan       text;
  v_div_name   text;
  v_winner     uuid;
  v_had_result boolean;
  v_target_id  uuid;
  v_field      text;
  v_slot       uuid;
  v_advanced   boolean := false;
  v_rows       integer;
  v_home_name  text;
  v_away_name  text;
  v_win_name   text;
  v_message    text;
  v_child      public.playoffs%rowtype;
  v_has_child  boolean := false;
  v_started    integer;
begin
  if p_game_id is null or p_home_score is null or p_away_score is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'invalid_scores' using errcode = 'P0001';
  end if;
  if p_home_score = p_away_score then
    raise exception 'tied_score' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then every game in it (0107's order).
  select g.playoff_id into v_po_id from public.playoff_games g where g.id = p_game_id;
  if v_po_id is null then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  select * into v_po from public.playoffs where id = v_po_id for update;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_po.id for update;
  select * into v_game from public.playoff_games where id = p_game_id and playoff_id = v_po.id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;

  -- 2. Membership, judged on the season's org.
  select * into v_league from public.leagues where id = v_po.league_id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan into v_plan from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Format: single elimination and round robin only.
  if v_po.format is distinct from 'single_elimination' and v_po.format is distinct from 'round_robin' then
    raise exception 'format_not_supported' using errcode = 'P0001';
  end if;

  -- 4b. Two-stage (0113): a round-robin game whose Stage 2 already has a
  --     result can be neither changed nor cleared (decided 2026-10-19). Stage
  --     2's row and games are locked after this bracket's — Stage 1 first,
  --     every two-stage function's order.
  select * into v_child from public.playoffs where parent_playoff_id = v_po.id for update;
  v_has_child := found;
  if v_has_child then
    perform 1 from public.playoff_games where playoff_id = v_child.id for update;
    select min(g.game_number) into v_started
      from public.playoff_games g
     where g.playoff_id = v_child.id
       and (g.status = 'completed' or g.home_score is not null
            or g.away_score is not null or g.winner_id is not null);
    if v_started is not null then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_stage_started',
        'game_id', v_game.id, 'stage2_game_number', v_started);
    end if;
  end if;

  -- 5. The game: both teams, not cancelled.
  if v_game.home_team_id is null or v_game.away_team_id is null then
    raise exception 'teams_missing' using errcode = 'P0001';
  end if;
  if v_game.status = 'cancelled' then
    raise exception 'game_cancelled' using errcode = 'P0001';
  end if;

  v_winner := case when p_home_score > p_away_score then v_game.home_team_id else v_game.away_team_id end;
  v_had_result := v_game.status = 'completed' or v_game.home_score is not null
               or v_game.away_score is not null or v_game.winner_id is not null;

  -- 6. Where the winner goes (single elimination). A next game with a result
  --    blocks the save; a slot holding a team this game did not put there is
  --    never overwritten.
  if v_po.format = 'single_elimination' then
    select t.target_id, t.target_field into v_target_id, v_field
      from public.playoff_single_elim_target(v_game.id) t;
    if v_target_id is not null then
      select * into v_target from public.playoff_games where id = v_target_id;
      if v_target.status = 'completed' or v_target.home_score is not null
         or v_target.away_score is not null or v_target.winner_id is not null then
        return jsonb_build_object(
          'committed', false, 'blocked', true, 'reason', 'next_game_has_result',
          'game_id', v_game.id,
          'next_game', jsonb_build_object(
            'game_id', v_target.id, 'game_number', v_target.game_number, 'round', v_target.round,
            'home_name', (select name from public.teams where id = v_target.home_team_id),
            'away_name', (select name from public.teams where id = v_target.away_team_id),
            'home_score', v_target.home_score, 'away_score', v_target.away_score));
      end if;
      v_slot := case when v_field = 'home_team_id' then v_target.home_team_id else v_target.away_team_id end;
      if v_slot is not null and v_slot <> v_winner
         and (v_game.winner_id is null or v_slot <> v_game.winner_id) then
        raise exception 'slot_occupied' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- 7. The result, conditional on what was read under the lock.
  update public.playoff_games
     set home_score = p_home_score,
         away_score = p_away_score,
         winner_id  = v_winner,
         status     = 'completed',
         updated_at = now()
   where id = v_game.id
     and status = v_game.status
     and home_team_id = v_game.home_team_id
     and away_team_id = v_game.away_team_id
     and home_score is not distinct from v_game.home_score
     and away_score is not distinct from v_game.away_score
     and winner_id  is not distinct from v_game.winner_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  -- 8. The advancement, conditional on the slot and on the next game still
  --    having no result.
  if v_target_id is not null and v_slot is distinct from v_winner then
    update public.playoff_games
       set home_team_id = case when v_field = 'home_team_id' then v_winner else home_team_id end,
           away_team_id = case when v_field = 'away_team_id' then v_winner else away_team_id end,
           updated_at   = now()
     where id = v_target_id
       and status <> 'completed'
       and home_score is null and away_score is null and winner_id is null
       and (case when v_field = 'home_team_id' then home_team_id else away_team_id end)
           is not distinct from v_slot;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;
    v_advanced := true;
  end if;

  -- 9. Log.
  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;
  select name into v_home_name from public.teams where id = v_game.home_team_id;
  select name into v_away_name from public.teams where id = v_game.away_team_id;
  select name into v_win_name from public.teams where id = v_winner;
  v_message := format('%s playoffs: Game %s (%s) %s %s, %s %s — %s won',
    coalesce(v_div_name, 'Division'), v_game.game_number, v_game.round,
    coalesce(v_home_name, 'Home'), p_home_score, coalesce(v_away_name, 'Away'), p_away_score,
    coalesce(v_win_name, 'the winner'));
  if v_had_result then
    v_message := v_message || format(' (result changed; was %s–%s)',
      coalesce(v_game.home_score::text, '?'), coalesce(v_game.away_score::text, '?'));
  end if;
  if v_advanced then
    v_message := v_message || format('; %s moved into Game %s (%s)',
      coalesce(v_win_name, 'the winner'), v_target.game_number, v_target.round);
  end if;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_po.league_id, v_po.division_id, 'playoff_result_entered', v_message);

  -- Two-stage (0113): a round-robin result entered or changed after Stage 2 was seeded
  -- flags Stage 2 so the admin re-checks the seeds. The seeds never move.
  if v_has_child and v_child.seeded_at is not null then
    update public.playoffs set stage1_changed_at = now(), updated_at = now() where id = v_child.id;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_stage1_changed_after_seeding',
            format('%s playoffs: RR Game %s result changed after Stage 2 was seeded — re-check the seeds',
                   coalesce(v_div_name, 'Division'), v_game.game_number));
  end if;

  return jsonb_build_object(
    'committed', true, 'blocked', false,
    'game_id', v_game.id, 'playoff_id', v_po.id,
    'winner_id', v_winner, 'was_edit', v_had_result,
    'stage2_recheck', v_has_child and v_child.seeded_at is not null,
    'advanced', case when v_target_id is not null then jsonb_build_object(
                  'game_id', v_target.id, 'game_number', v_target.game_number,
                  'round', v_target.round, 'field', v_field, 'team_id', v_winner)
                else null end);
end;
$$;

revoke execute on function public.enter_playoff_result(uuid, integer, integer)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.enter_playoff_result(uuid, integer, integer)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. clear_playoff_result — from 0112_feed_cutoff_last_day.sql; Stage 1 freeze and re-check flag added
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.clear_playoff_result(
  p_game_id uuid,
  p_commit  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po_id      uuid;
  v_po         public.playoffs%rowtype;
  v_league     public.leagues%rowtype;
  v_game       public.playoff_games%rowtype;
  v_target     public.playoff_games%rowtype;
  v_plan       text;
  v_tz         text;
  v_div_name   text;
  v_target_id  uuid;
  v_field      text;
  v_slot       uuid;
  v_remove     boolean := false;
  v_public     boolean;
  v_rows       integer;
  v_home_name  text;
  v_away_name  text;
  v_win_name   text;
  v_message    text;
  v_child      public.playoffs%rowtype;
  v_has_child  boolean := false;
  v_started    integer;
begin
  if p_game_id is null or p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock the bracket row, then every game in it (0107's order).
  select g.playoff_id into v_po_id from public.playoff_games g where g.id = p_game_id;
  if v_po_id is null then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  select * into v_po from public.playoffs where id = v_po_id for update;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_po.id for update;
  select * into v_game from public.playoff_games where id = p_game_id and playoff_id = v_po.id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;

  -- 2. Membership, judged on the season's org.
  select * into v_league from public.leagues where id = v_po.league_id;
  if not found then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Format: single elimination and round robin only.
  if v_po.format is distinct from 'single_elimination' and v_po.format is distinct from 'round_robin' then
    raise exception 'format_not_supported' using errcode = 'P0001';
  end if;

  -- 4b. Two-stage (0113): a round-robin game whose Stage 2 already has a
  --     result can be neither changed nor cleared (decided 2026-10-19). Stage
  --     2's row and games are locked after this bracket's — Stage 1 first,
  --     every two-stage function's order.
  select * into v_child from public.playoffs where parent_playoff_id = v_po.id for update;
  v_has_child := found;
  if v_has_child then
    perform 1 from public.playoff_games where playoff_id = v_child.id for update;
    select min(g.game_number) into v_started
      from public.playoff_games g
     where g.playoff_id = v_child.id
       and (g.status = 'completed' or g.home_score is not null
            or g.away_score is not null or g.winner_id is not null);
    if v_started is not null then
      return jsonb_build_object(
        'committed', false, 'blocked', true, 'reason', 'next_stage_started',
        'game_id', v_game.id, 'stage2_game_number', v_started);
    end if;
  end if;

  -- 5. There must be a result to clear.
  if not (v_game.status = 'completed' or v_game.home_score is not null
          or v_game.away_score is not null or v_game.winner_id is not null) then
    raise exception 'no_result' using errcode = 'P0001';
  end if;

  -- 6. The game this one advanced its winner into (single elimination).
  if v_po.format = 'single_elimination' then
    select t.target_id, t.target_field into v_target_id, v_field
      from public.playoff_single_elim_target(v_game.id) t;
    if v_target_id is not null then
      select * into v_target from public.playoff_games where id = v_target_id;
      if v_target.status = 'completed' or v_target.home_score is not null
         or v_target.away_score is not null or v_target.winner_id is not null then
        return jsonb_build_object(
          'committed', false, 'blocked', true, 'reason', 'next_game_has_result',
          'game_id', v_game.id,
          'next_game', jsonb_build_object(
            'game_id', v_target.id, 'game_number', v_target.game_number, 'round', v_target.round,
            'home_name', (select name from public.teams where id = v_target.home_team_id),
            'away_name', (select name from public.teams where id = v_target.away_team_id),
            'home_score', v_target.home_score, 'away_score', v_target.away_score));
      end if;
      v_slot := case when v_field = 'home_team_id' then v_target.home_team_id else v_target.away_team_id end;
      if v_slot is not null and v_game.winner_id is not null and v_slot = v_game.winner_id then
        v_remove := true;
      elsif v_slot is not null and v_game.winner_id is not null then
        -- The slot holds a team this game did not put there. Never guess.
        raise exception 'advancement_mismatch' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- 7. On the public schedule — mirrors 0105 (see the header).
  select count(*) > 0 into v_public
    from public.playoff_games g
    join public.divisions d on d.id = g.division_id
   where g.id in (v_game.id, case when v_remove then v_target_id else v_game.id end)
     and g.scheduled_date is not null
     and d.locked
     and v_po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);

  select d.name into v_div_name from public.divisions d where d.id = v_po.division_id;
  select name into v_home_name from public.teams where id = v_game.home_team_id;
  select name into v_away_name from public.teams where id = v_game.away_team_id;
  select name into v_win_name from public.teams where id = v_game.winner_id;

  -- 8. The write: the game, then the next game's slot, then the log.
  if p_commit then
    update public.playoff_games
       set home_score = null,
           away_score = null,
           winner_id  = null,
           status     = 'scheduled',
           updated_at = now()
     where id = v_game.id
       and status = v_game.status
       and home_score is not distinct from v_game.home_score
       and away_score is not distinct from v_game.away_score
       and winner_id  is not distinct from v_game.winner_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'nothing_saved' using errcode = 'P0001';
    end if;

    if v_remove then
      update public.playoff_games
         set home_team_id = case when v_field = 'home_team_id' then null else home_team_id end,
             away_team_id = case when v_field = 'away_team_id' then null else away_team_id end,
             updated_at   = now()
       where id = v_target_id
         and status <> 'completed'
         and home_score is null and away_score is null and winner_id is null
         and (case when v_field = 'home_team_id' then home_team_id else away_team_id end) = v_game.winner_id;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'nothing_saved' using errcode = 'P0001';
      end if;
    end if;

    v_message := format('%s playoffs: result cleared for Game %s (%s) — was %s %s, %s %s',
      coalesce(v_div_name, 'Division'), v_game.game_number, v_game.round,
      coalesce(v_home_name, 'Home'), coalesce(v_game.home_score::text, '?'),
      coalesce(v_away_name, 'Away'), coalesce(v_game.away_score::text, '?'));
    if v_win_name is not null then
      v_message := v_message || format(' (%s won)', v_win_name);
    end if;
    if v_remove then
      v_message := v_message || format('; %s removed from Game %s (%s)',
        coalesce(v_win_name, 'the winner'), v_target.game_number, v_target.round);
    end if;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_result_cleared', v_message);
  end if;

  -- Two-stage (0113): a round-robin result cleared after Stage 2 was seeded
  -- flags Stage 2 so the admin re-checks the seeds. The seeds never move.
  if p_commit and v_has_child and v_child.seeded_at is not null then
    update public.playoffs set stage1_changed_at = now(), updated_at = now() where id = v_child.id;
    insert into public.activity_log (league_id, division_id, event_type, message)
    values (v_po.league_id, v_po.division_id, 'playoff_stage1_changed_after_seeding',
            format('%s playoffs: RR Game %s result cleared after Stage 2 was seeded — re-check the seeds',
                   coalesce(v_div_name, 'Division'), v_game.game_number));
  end if;

  return jsonb_build_object(
    'committed', p_commit, 'blocked', false,
    'game_id', v_game.id, 'playoff_id', v_po.id,
    'game_number', v_game.game_number, 'round', v_game.round,
    'home_name', v_home_name, 'away_name', v_away_name,
    'home_score', v_game.home_score, 'away_score', v_game.away_score,
    'winner_name', v_win_name,
    'stage2_recheck', p_commit and v_has_child and v_child.seeded_at is not null,
    'on_public_schedule', coalesce(v_public, false),
    'removed', case when v_remove then jsonb_build_object(
                 'game_id', v_target.id, 'game_number', v_target.game_number,
                 'round', v_target.round, 'field', v_field, 'team_name', v_win_name)
               else null end);
end;
$$;

revoke execute on function public.clear_playoff_result(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.clear_playoff_result(uuid, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. get_league_schedule_by_token — from 0112_feed_cutoff_last_day.sql; stage and seeds emitted
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_league_schedule_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_enabled  boolean;
  v_org_name text;
  v_plan     text;
  v_timezone text;
  v_today    date;
  v_seasons  jsonb;
begin
  -- A malformed token is answered without touching the table.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;

  select k.org_id, k.enabled
    into v_org_id, v_enabled
    from public.public_schedule_links k
   where k.token = p_token;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if not v_enabled then
    return jsonb_build_object('status', 'off');
  end if;

  select p.org_name, p.plan, p.timezone
    into v_org_name, v_plan, v_timezone
    from public.profiles p
   where p.id = v_org_id;
  if not found or v_timezone is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  if v_plan is null or v_plan not in ('pro', 'elite') then
    return jsonb_build_object('status', 'plan');
  end if;

  -- "Today" in the ORG's zone. Never current_date, never the server's zone.
  v_today := (now() at time zone v_timezone)::date;

  -- Every key is named. NEVER to_jsonb(g), never g.*: games carries notes,
  -- scores and attribution; teams carries contact_email; divisions.settings
  -- carries coach metadata (only the game_duration key is projected).
  --
  -- scheduled_at is WALL-CLOCK text with a literal +00 (see game-time.ts); it
  -- is rendered explicitly so the result does not depend on the session's
  -- TimeZone setting.
  --
  -- A division is published iff it is LOCKED. Games have no division_id: a
  -- game belongs to its home team's division (CLAUDE.md, schedule lock).
  select coalesce(jsonb_agg(s.season order by s.sort_start nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_seasons
    from (
      select l.id, l.created_at, l.start_date as sort_start,
        jsonb_build_object(
          'id',         l.id,
          'name',       l.name,
          'start_date', l.start_date,
          'end_date',   l.end_date,

          'divisions', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',            d.id,
                     'name',          d.name,
                     'game_duration', d.settings -> 'game_duration'
                   ) order by d.name, d.id), '[]'::jsonb)
              from public.divisions d
             where d.league_id = l.id and d.locked
          ),

          -- Names only: what the page lists as "not published yet".
          'unpublished', (
            select coalesce(jsonb_agg(d.name order by d.name, d.id), '[]'::jsonb)
              from public.divisions d
             where d.league_id = l.id and not d.locked
          ),

          'teams', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',          t.id,
                     'name',        t.name,
                     'division_id', t.division_id
                   ) order by t.name, t.id), '[]'::jsonb)
              from public.teams t
              join public.divisions d on d.id = t.division_id
             where t.league_id = l.id and d.locked
          ),

          'games', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',                  g.id,
                     'scheduled_at',        to_char(g.scheduled_at at time zone 'UTC',
                                                    'YYYY-MM-DD"T"HH24:MI:SS') || '+00:00',
                     'status',              g.status,
                     'is_away',             g.is_away,
                     'interleague',         g.interleague_org_id is not null,
                     'division_id',         ht.division_id,
                     'home_team_id',        g.home_team_id,
                     'away_team_id',        g.away_team_id,
                     'external_team_name',  g.external_team_name,
                     -- The PARTNER's field, away games only; on a home game it
                     -- can hold a stale counter-proposal.
                     'proposed_venue_name', case when g.is_away then g.proposed_venue_name
                                                 else null end,
                     'home_team',           jsonb_build_object('name', ht.name),
                     'away_team',           case when awt.id is not null
                                              then jsonb_build_object('name', awt.name)
                                              else null end,
                     'venue',               case when v.id is not null
                                              then jsonb_build_object(
                                                'name', v.name,
                                                'location', case when loc.id is not null
                                                  then jsonb_build_object('name', loc.name)
                                                  else null end,
                                                'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), '')),
                                                'home_park', coalesce(loc.is_home_park, false)
                                              )
                                              else null end
                   ) order by g.scheduled_at, g.id), '[]'::jsonb)
              from public.games g
              join public.teams ht on ht.id = g.home_team_id
              join public.divisions hd on hd.id = ht.division_id
              left join public.teams awt on awt.id = g.away_team_id
              left join public.venues v on v.id = g.venue_id
              left join public.locations loc on loc.id = v.location_id
             where g.league_id = l.id
               and hd.locked
               -- An unagreed interleague proposal never leaves the database.
               and g.status <> 'pending_interleague'
          ),

          'playoff_games', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'id',             pg.id,
                     'playoff_id',     pg.playoff_id,
                     'format',         po.format,
                     'division_id',    pg.division_id,
                     'round',          pg.round,
                     'game_number',    pg.game_number,
                     'scheduled_date', pg.scheduled_date,
                     'start_time',     to_char(pg.start_time, 'HH24:MI'),
                     'status',         pg.status,
                     -- 0113: Stage 2 slots waiting for seeding say "Seed N".
                     'stage',          po.stage,
                     'seed_home',      pg.seed_home,
                     'seed_away',      pg.seed_away,
                     'home_team',      case when pht.id is not null
                                         then jsonb_build_object('id', pht.id, 'name', pht.name)
                                         else null end,
                     'away_team',      case when pat.id is not null
                                         then jsonb_build_object('id', pat.id, 'name', pat.name)
                                         else null end,
                     'venue',          case when v.id is not null
                                         then jsonb_build_object(
                                           'name', v.name,
                                           'location', case when loc.id is not null
                                             then jsonb_build_object('name', loc.name)
                                             else null end,
                                           'address', coalesce(nullif(btrim(v.address), ''), nullif(btrim(loc.address), '')),
                                           'home_park', coalesce(loc.is_home_park, false)
                                         )
                                         else null end
                   ) order by pg.scheduled_date nulls last, pg.start_time nulls last, pg.game_number, pg.id), '[]'::jsonb)
              from public.playoff_games pg
              join public.playoffs po on po.id = pg.playoff_id
              join public.divisions d on d.id = pg.division_id
              left join public.teams pht on pht.id = pg.home_team_id
              left join public.teams pat on pat.id = pg.away_team_id
              left join public.venues v on v.id = pg.venue_id
              left join public.locations loc on loc.id = v.location_id
             where pg.league_id = l.id
               and d.locked
               and po.status <> 'draft'
          )
        ) as season
        from public.leagues l
       where l.owner_id = v_org_id
         and l.archived_at is null
         and (l.end_date is null or v_today <= public.season_last_day(l.id) + 7)
         and exists (select 1 from public.divisions d where d.league_id = l.id and d.locked)
    ) s;

  return jsonb_build_object(
    'status',  'ok',
    'org',     jsonb_build_object('name', v_org_name, 'timezone', v_timezone),
    'today',   v_today,
    'seasons', v_seasons
  );
end;
$$;

revoke execute on function public.get_league_schedule_by_token(text)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.get_league_schedule_by_token(text)
  to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. playoff_write_stage — the two-stage writer (helper; callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.playoff_write_stage(
  p_po         public.playoffs,
  p_owner      uuid,
  p_settings   jsonb,
  p_games      jsonb,
  p_team_count integer,
  p_write      boolean
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_format   text;
  v_seeding  jsonb;
  v_start    date;
  v_end      date;
  v_days     text[];
  v_windows  jsonb;
  v_venues   jsonb;
  v_per_day  smallint;
  v_adv      integer;
  v_bad      integer;
  v_seeds    integer[];
  v_new      integer;
  v_inserted integer;
begin
  -- Validates one stage's settings and games and, with p_write, writes them.
  -- The checks re-state replace_playoff_games' (TWO WRITERS, PINNED — see the
  -- header) plus the stage's own: Stage 1 is a round robin whose games carry
  -- teams and no seeds; Stage 2 is single elimination whose games carry seeds
  -- (exactly 1…advance_count, once each) and no teams. Called with
  -- p_write = false for both stages before either is written.

  -- Settings.
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or jsonb_typeof(p_settings -> 'seeding') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'playing_days') is distinct from 'array'
     or jsonb_typeof(p_settings -> 'day_windows') is distinct from 'object'
     or jsonb_typeof(p_settings -> 'venue_assignments') is distinct from 'array'
     or (p_settings ->> 'format') is distinct from
          (case when p_po.stage = 1 then 'round_robin' else 'single_elimination' end)
     or coalesce(p_settings ->> 'games_per_team_per_day', '1') not in ('1', '2') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  begin
    v_format  := p_settings ->> 'format';
    v_seeding := p_settings -> 'seeding';
    v_start   := nullif(p_settings ->> 'start_date', '')::date;
    v_end     := nullif(p_settings ->> 'end_date', '')::date;
    v_days    := array(select jsonb_array_elements_text(p_settings -> 'playing_days'));
    v_windows := p_settings -> 'day_windows';
    v_venues  := p_settings -> 'venue_assignments';
    v_per_day := coalesce((p_settings ->> 'games_per_team_per_day')::smallint, 1);
    v_adv     := nullif(p_settings ->> 'advance_count', '')::integer;
  exception when others then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end;
  if p_po.stage = 2 and (v_adv is null or v_adv < 2 or v_adv > coalesce(p_team_count, 0)
                         or jsonb_array_length(v_seeding) <> 0) then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  if p_po.stage = 1 then
    -- Stage 1's seeding is the teams IN, each a team of this season, once.
    begin
      select count(*) into v_bad
        from jsonb_array_elements(v_seeding) e
       where jsonb_typeof(e) <> 'object'
          or not exists (select 1 from public.teams tm
                          where tm.id = (e ->> 'team_id')::uuid and tm.league_id = p_po.league_id);
    exception when others then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end;
    if v_bad > 0 then
      raise exception 'team_not_in_season' using errcode = 'P0001';
    end if;
    if jsonb_array_length(v_seeding) < 2
       or (select count(distinct e ->> 'team_id') from jsonb_array_elements(v_seeding) e)
          <> jsonb_array_length(v_seeding) then
      raise exception 'invalid_settings' using errcode = 'P0001';
    end if;
  end if;

  -- Games: replace_playoff_games' checks.
  if p_games is null or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) = 0 then
    raise exception 'no_games' using errcode = 'P0001';
  end if;
  select count(*) into v_bad
    from jsonb_array_elements(p_games) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(btrim(e ->> 'round'), '') = ''
      or coalesce(e ->> 'game_number', '') !~ '^[0-9]{1,6}$';
  if v_bad > 0 then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  if (select count(distinct (e ->> 'game_number')::integer) from jsonb_array_elements(p_games) e)
     <> jsonb_array_length(p_games) then
    raise exception 'invalid_games' using errcode = 'P0001';
  end if;
  begin
    select count(*) into v_bad
      from jsonb_array_elements(p_games) e,
           lateral (values (nullif(e ->> 'home_team_id', '')::uuid), (nullif(e ->> 'away_team_id', '')::uuid)) t(team_id)
     where t.team_id is not null
       and not exists (select 1 from public.teams tm where tm.id = t.team_id and tm.league_id = p_po.league_id);
  exception when invalid_text_representation then
    raise exception 'invalid_games' using errcode = 'P0001';
  end;
  if v_bad > 0 then
    raise exception 'team_not_in_season' using errcode = 'P0001';
  end if;
  begin
    select count(*) into v_bad
      from jsonb_array_elements(p_games) e
     where nullif(e ->> 'venue_id', '') is not null
       and not exists (select 1 from public.venues v
                        where v.id = (e ->> 'venue_id')::uuid and v.owner_id = p_owner);
  exception when invalid_text_representation then
    raise exception 'invalid_games' using errcode = 'P0001';
  end;
  if v_bad > 0 then
    raise exception 'venue_not_in_org' using errcode = 'P0001';
  end if;

  -- The stage's own shape.
  if p_po.stage = 1 then
    if exists (select 1 from jsonb_array_elements(p_games) e
                where nullif(e ->> 'seed_home', '') is not null or nullif(e ->> 'seed_away', '') is not null) then
      raise exception 'invalid_games' using errcode = 'P0001';
    end if;
  else
    if exists (select 1 from jsonb_array_elements(p_games) e
                where nullif(e ->> 'home_team_id', '') is not null or nullif(e ->> 'away_team_id', '') is not null) then
      raise exception 'invalid_games' using errcode = 'P0001';
    end if;
    begin
      select coalesce(array_agg(s.seed order by s.seed), array[]::integer[]) into v_seeds
        from jsonb_array_elements(p_games) e,
             lateral (values (nullif(e ->> 'seed_home', '')::integer), (nullif(e ->> 'seed_away', '')::integer)) s(seed)
       where s.seed is not null;
    exception when others then
      raise exception 'invalid_games' using errcode = 'P0001';
    end;
    if v_seeds is distinct from array(select generate_series(1, v_adv)) then
      raise exception 'invalid_games' using errcode = 'P0001';
    end if;
  end if;

  if not p_write then
    return;
  end if;

  -- The write: settings, games, status — inside the caller's transaction.
  update public.playoffs
     set format = v_format,
         seeding = v_seeding,
         start_date = v_start,
         end_date = v_end,
         playing_days = v_days,
         day_windows = v_windows,
         venue_assignments = v_venues,
         cross_division_enabled = false,
         cross_division_opponent_id = null,
         games_per_team_per_day = v_per_day,
         advance_count = case when p_po.stage = 2 then v_adv else null end,
         updated_at = now()
   where id = p_po.id;

  delete from public.playoff_games where playoff_id = p_po.id;

  insert into public.playoff_games
    (playoff_id, league_id, division_id, round, game_number,
     home_team_id, away_team_id, seed_home, seed_away, venue_id, scheduled_date, start_time, status)
  select p_po.id, p_po.league_id, p_po.division_id,
         btrim(e ->> 'round'), (e ->> 'game_number')::integer,
         nullif(e ->> 'home_team_id', '')::uuid, nullif(e ->> 'away_team_id', '')::uuid,
         nullif(e ->> 'seed_home', '')::smallint, nullif(e ->> 'seed_away', '')::smallint,
         nullif(e ->> 'venue_id', '')::uuid,
         nullif(e ->> 'scheduled_date', '')::date, nullif(e ->> 'start_time', '')::time,
         'scheduled'
    from jsonb_array_elements(p_games) e;

  v_new := jsonb_array_length(p_games);
  select count(*) into v_inserted from public.playoff_games where playoff_id = p_po.id;
  if v_inserted <> v_new then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  update public.playoffs set status = 'active', updated_at = now() where id = p_po.id;
end;
$$;

revoke execute on function public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. playoff_apply_seeds — fill Stage 2's seeded slots (helper; no role)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.playoff_apply_seeds(p_stage2_id uuid, p_order uuid[])
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_want integer;
  v_rows integer;
begin
  -- Every slot carrying seed k gets p_order[k] (1-based). In place: dates,
  -- times, fields and game numbers are not touched; a slot with no seed is
  -- left alone (later rounds fill by advancement). Only games with no result
  -- are written — the callers have already refused a Stage 2 with any result,
  -- so a short count means the rows changed underneath: nothing_saved.
  select count(*) into v_want
    from public.playoff_games g
   where g.playoff_id = p_stage2_id
     and (g.seed_home is not null or g.seed_away is not null);
  update public.playoff_games g
     set home_team_id = case when g.seed_home is not null then p_order[g.seed_home] else g.home_team_id end,
         away_team_id = case when g.seed_away is not null then p_order[g.seed_away] else g.away_team_id end,
         updated_at   = now()
   where g.playoff_id = p_stage2_id
     and (g.seed_home is not null or g.seed_away is not null)
     and g.status <> 'completed'
     and g.home_score is null and g.away_score is null and g.winner_id is null;
  get diagnostics v_rows = row_count;
  if v_rows <> v_want then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;
  return v_rows;
end;
$$;

revoke execute on function public.playoff_apply_seeds(uuid, uuid[])
  from public, anon, authenticated, service_role, dashboard_readonly;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. replace_two_stage_games — build both stages, or Stage 2 alone
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.replace_two_stage_games(
  p_stage1_id  uuid,
  p_settings1  jsonb,
  p_games1     jsonb,
  p_stage2_id  uuid,
  p_settings2  jsonb,
  p_games2     jsonb,
  p_commit     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s1         public.playoffs%rowtype;
  v_s2         public.playoffs%rowtype;
  v_league     public.leagues%rowtype;
  v_plan       text;
  v_tz         text;
  v_div_name   text;
  v_rebuild1   boolean;
  v_keep_seeds boolean;
  v_r1         integer;
  v_r2         integer;
  v_first2     integer;
  v_g1         integer;
  v_g2         integer;
  v_new1       integer;
  v_new2       integer;
  v_dated_new  integer;
  v_teams      integer;
  v_end1       date;
  v_start2     date;
  v_public_now integer;
  v_public_ok  boolean;
  v_order      uuid[];
  v_event      text;
  v_message    text;
begin
  if p_commit is null or p_stage1_id is null or p_stage2_id is null
     or p_settings2 is null or p_games2 is null
     or ((p_settings1 is null) <> (p_games1 is null)) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;
  -- No Stage 1 payload = rebuild Stage 2 only (its dates and fields), keeping
  -- Stage 1's games and results (decided 2026-10-19, D5).
  v_rebuild1 := p_settings1 is not null;

  -- 1. Lock Stage 1, Stage 2, then their games; they must be one pair.
  select * into v_s1 from public.playoffs where id = p_stage1_id for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  select * into v_s2 from public.playoffs where id = p_stage2_id for update;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if v_s1.stage <> 1 or v_s2.stage <> 2 or v_s2.parent_playoff_id is distinct from v_s1.id
     or v_s2.league_id <> v_s1.league_id or v_s2.division_id <> v_s1.division_id then
    raise exception 'not_a_pair' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_s1.id for update;
  perform 1 from public.playoff_games where playoff_id = v_s2.id for update;

  -- 2. Membership.
  select * into v_league from public.leagues where id = v_s1.league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  -- 4. Results. Stage 2 with a result: nothing is rebuilt. Stage 1 with a
  --    result: only a Stage-2-only rebuild is allowed.
  select count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null),
         count(*)
    into v_r1, v_g1
    from public.playoff_games g where g.playoff_id = v_s1.id;
  select count(*) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null),
         min(g.game_number) filter (where g.status = 'completed' or g.home_score is not null
                             or g.away_score is not null or g.winner_id is not null),
         count(*)
    into v_r2, v_first2, v_g2
    from public.playoff_games g where g.playoff_id = v_s2.id;
  select d.name into v_div_name from public.divisions d where d.id = v_s1.division_id;
  if v_r2 > 0 then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reasons', jsonb_build_array('stage2_started'),
      'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
      'stage2_game_number', v_first2);
  end if;
  if v_rebuild1 and v_r1 > 0 then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reasons', jsonb_build_array('results_entered'),
      'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
      'games_with_results', v_r1);
  end if;

  -- 5. Validate BOTH stages before writing either.
  if v_rebuild1 then
    perform public.playoff_write_stage(v_s1, v_league.owner_id, p_settings1, p_games1, null, false);
    v_teams := jsonb_array_length(p_settings1 -> 'seeding');
    v_end1 := nullif(p_settings1 ->> 'end_date', '')::date;
  else
    v_teams := jsonb_array_length(v_s1.seeding);
    v_end1 := v_s1.end_date;
  end if;
  perform public.playoff_write_stage(v_s2, v_league.owner_id, p_settings2, p_games2, v_teams, false);
  v_start2 := nullif(p_settings2 ->> 'start_date', '')::date;
  if v_end1 is not null and v_start2 is not null and v_start2 <= v_end1 then
    raise exception 'stage_order' using errcode = 'P0001';
  end if;
  -- A Stage-2-only rebuild of a seeded bracket keeps its seeds.
  v_keep_seeds := not v_rebuild1 and v_s2.seeded_at is not null;

  v_new1 := case when v_rebuild1 then jsonb_array_length(p_games1) else v_g1 end;
  v_new2 := jsonb_array_length(p_games2);
  select count(*) into v_dated_new
    from jsonb_array_elements(coalesce(p_games1, '[]'::jsonb) || p_games2) e
   where nullif(e ->> 'scheduled_date', '') is not null;
  if not v_rebuild1 then
    v_dated_new := v_dated_new + (select count(*) from public.playoff_games g
                                   where g.playoff_id = v_s1.id and g.scheduled_date is not null);
  end if;

  -- On the public schedule — mirrors the 0105 reader, as 0107 does, for both
  -- stages: now (by each stage's status) and after (both active).
  select count(*) into v_public_now
    from public.playoff_games g
    join public.playoffs po on po.id = g.playoff_id
    join public.divisions d on d.id = g.division_id
   where g.playoff_id in (v_s1.id, v_s2.id)
     and g.scheduled_date is not null
     and d.locked
     and po.status <> 'draft'
     and v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);
  v_public_ok := v_league.archived_at is null
     and v_tz is not null
     and (v_league.end_date is null or (now() at time zone v_tz)::date <= public.season_last_day(v_league.id) + 7)
     and exists (select 1 from public.divisions d where d.id = v_s1.division_id and d.locked)
     and exists (select 1 from public.public_schedule_links k
                  where k.org_id = v_league.owner_id and k.enabled);

  if not p_commit then
    return jsonb_build_object(
      'committed', false, 'blocked', false, 'reasons', '[]'::jsonb,
      'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
      'rebuild_stage1', v_rebuild1, 'keeps_seeds', v_keep_seeds,
      'stage1_games', v_g1, 'stage2_games', v_g2,
      'new_stage1_games', v_new1, 'new_stage2_games', v_new2,
      'public_games', v_public_now,
      'public_games_after', case when v_public_ok then v_dated_new else 0 end);
  end if;

  -- 6. The write — one transaction.
  if v_rebuild1 then
    perform public.playoff_write_stage(v_s1, v_league.owner_id, p_settings1, p_games1, null, true);
  end if;
  perform public.playoff_write_stage(v_s2, v_league.owner_id, p_settings2, p_games2, v_teams, true);
  update public.playoffs
     set seeding           = case when v_keep_seeds then v_s2.seeding else '[]'::jsonb end,
         seeded_at         = case when v_keep_seeds then v_s2.seeded_at else null end,
         seeded_by         = case when v_keep_seeds then v_s2.seeded_by else null end,
         stage1_changed_at = case when v_keep_seeds then v_s2.stage1_changed_at else null end,
         updated_at        = now()
   where id = v_s2.id;
  if v_keep_seeds then
    select array_agg((e.value ->> 'team_id')::uuid order by e.ordinality) into v_order
      from jsonb_array_elements(v_s2.seeding) with ordinality e;
    perform public.playoff_apply_seeds(v_s2.id, v_order);
  end if;

  if v_rebuild1 then
    v_event := case when v_g1 = 0 and v_g2 = 0 then 'playoff_two_stage_generated' else 'playoff_two_stage_rebuilt' end;
    v_message := format('%s playoffs (round robin, then bracket) %s: %s round-robin %s, %s bracket %s',
      coalesce(v_div_name, 'Division'),
      case when v_event = 'playoff_two_stage_generated' then 'generated' else 'rebuilt' end,
      v_new1, case when v_new1 = 1 then 'game' else 'games' end,
      v_new2, case when v_new2 = 1 then 'game' else 'games' end);
  else
    v_event := 'playoff_stage2_rebuilt';
    v_message := format('%s playoffs: Stage 2 rebuilt (%s bracket %s)%s',
      coalesce(v_div_name, 'Division'), v_new2, case when v_new2 = 1 then 'game' else 'games' end,
      case when v_keep_seeds then '; seeds kept' else '' end);
  end if;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_s1.league_id, v_s1.division_id, v_event, v_message);

  return jsonb_build_object(
    'committed', true, 'blocked', false, 'reasons', '[]'::jsonb,
    'stage1_id', v_s1.id, 'stage2_id', v_s2.id, 'division_name', v_div_name,
    'rebuild_stage1', v_rebuild1, 'keeps_seeds', v_keep_seeds,
    'stage1_games', v_g1, 'stage2_games', v_g2,
    'new_stage1_games', v_new1, 'new_stage2_games', v_new2,
    'public_games', v_public_now,
    'public_games_after', case when v_public_ok then v_dated_new else 0 end);
end;
$$;

revoke execute on function public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. seed_playoff_stage — the admin's order into Stage 2, in place
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.seed_playoff_stage(
  p_stage2_id uuid,
  p_order     uuid[],
  p_commit    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent    uuid;
  v_s1        public.playoffs%rowtype;
  v_s2        public.playoffs%rowtype;
  v_league    public.leagues%rowtype;
  v_plan      text;
  v_tz        text;
  v_today     date;
  v_div_name  text;
  v_first2    integer;
  v_upcoming  integer;
  v_missing   integer;
  v_never     jsonb;
  v_teams     uuid[];
  v_was       boolean;
  v_seeding   jsonb;
  v_rows      integer;
  v_list      text;
  v_out       text;
  v_never_txt text;
  v_message   text;
begin
  if p_stage2_id is null or p_order is null or p_commit is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- 1. Lock Stage 1, Stage 2, then their games (every two-stage function's
  --    order).
  select p.parent_playoff_id into v_parent from public.playoffs p where p.id = p_stage2_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if v_parent is null then
    raise exception 'not_stage2' using errcode = 'P0001';
  end if;
  select * into v_s1 from public.playoffs where id = v_parent for update;
  select * into v_s2 from public.playoffs where id = p_stage2_id for update;
  if v_s1.id is null or v_s2.parent_playoff_id is distinct from v_s1.id then
    raise exception 'not_stage2' using errcode = 'P0001';
  end if;
  perform 1 from public.playoff_games where playoff_id = v_s1.id for update;
  perform 1 from public.playoff_games where playoff_id = v_s2.id for update;

  -- 2. Membership.
  select * into v_league from public.leagues where id = v_s1.league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- 3. Plan: Elite.
  select p.plan, p.timezone into v_plan, v_tz from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;
  select d.name into v_div_name from public.divisions d where d.id = v_s1.division_id;

  -- 4. A bracket with a result can't be (re-)seeded.
  select min(g.game_number) into v_first2
    from public.playoff_games g
   where g.playoff_id = v_s2.id
     and (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null);
  if v_first2 is not null then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reason', 'bracket_started',
      'stage2_id', v_s2.id, 'stage2_game_number', v_first2);
  end if;

  -- 5. Stage 1 must be over: every game without a result is rained out, has
  --    no date, or is dated before today in the ORG's timezone.
  v_today := (now() at time zone v_tz)::date;
  select count(*) filter (where g.status <> 'cancelled' and g.scheduled_date is not null
                             and g.scheduled_date >= v_today),
         count(*)
    into v_upcoming, v_missing
    from public.playoff_games g
   where g.playoff_id = v_s1.id
     and not (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null);
  if v_today is null or v_upcoming > 0 then
    return jsonb_build_object(
      'committed', false, 'blocked', true, 'reason', 'stage1_in_progress',
      'stage2_id', v_s2.id, 'remaining', v_missing, 'upcoming', coalesce(v_upcoming, 0));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'game_number', g.game_number,
           'home_name', ht.name, 'away_name', awt.name,
           'reason', case when g.status = 'cancelled' then 'rained_out'
                          when g.scheduled_date is null then 'no_date'
                          else 'past' end)
           order by g.game_number), '[]'::jsonb)
    into v_never
    from public.playoff_games g
    left join public.teams ht on ht.id = g.home_team_id
    left join public.teams awt on awt.id = g.away_team_id
   where g.playoff_id = v_s1.id
     and not (g.status = 'completed' or g.home_score is not null or g.away_score is not null or g.winner_id is not null);

  -- 6. The order is exactly Stage 1's teams, once each.
  select coalesce(array_agg((e ->> 'team_id')::uuid), array[]::uuid[]) into v_teams
    from jsonb_array_elements(v_s1.seeding) e;
  if cardinality(p_order) <> cardinality(v_teams)
     or array_position(p_order, null) is not null
     or (select count(distinct x) from unnest(p_order) x) <> cardinality(p_order)
     or exists (select 1 from unnest(p_order) x where not (x = any (v_teams))) then
    raise exception 'invalid_order' using errcode = 'P0001';
  end if;
  v_was := v_s2.seeded_at is not null;

  if not p_commit then
    return jsonb_build_object(
      'committed', false, 'blocked', false,
      'stage2_id', v_s2.id, 'advance_count', v_s2.advance_count,
      'reseed', v_was, 'never_played', v_never);
  end if;

  -- 7. The write: the slots, the order, the log.
  perform public.playoff_apply_seeds(v_s2.id, p_order);

  select jsonb_agg(jsonb_build_object('team_id', t.id, 'team_name', t.name) order by o.ord),
         string_agg(o.ord || ' ' || t.name, ', ' order by o.ord) filter (where o.ord <= v_s2.advance_count),
         string_agg(t.name, ', ' order by o.ord) filter (where o.ord > v_s2.advance_count)
    into v_seeding, v_list, v_out
    from unnest(p_order) with ordinality o(id, ord)
    join public.teams t on t.id = o.id;
  if jsonb_array_length(coalesce(v_seeding, '[]'::jsonb)) <> cardinality(p_order) then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  update public.playoffs
     set seeding = v_seeding,
         seeded_at = now(),
         seeded_by = auth.uid(),
         stage1_changed_at = null,
         updated_at = now()
   where id = v_s2.id
     and parent_playoff_id = v_s1.id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  select string_agg(format('RR Game %s (%s)', n ->> 'game_number',
                           case n ->> 'reason' when 'rained_out' then 'rained out'
                                               when 'no_date' then 'no date' else 'no result' end), ', '
                    order by (n ->> 'game_number')::integer)
    into v_never_txt
    from jsonb_array_elements(v_never) n;
  v_message := format('%s playoffs: Stage 2 %s — %s', coalesce(v_div_name, 'Division'),
    case when v_was then 're-seeded' else 'seeded' end, coalesce(v_list, ''));
  if v_out is not null then
    v_message := v_message || format('; not advancing: %s', v_out);
  end if;
  if v_never_txt is not null then
    v_message := v_message || format('; seeded with games never played: %s', v_never_txt);
  end if;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_s1.league_id, v_s1.division_id, 'playoff_stage_seeded', v_message);

  return jsonb_build_object(
    'committed', true, 'blocked', false,
    'stage2_id', v_s2.id, 'advance_count', v_s2.advance_count,
    'reseed', v_was, 'never_played', v_never);
end;
$$;

revoke execute on function public.seed_playoff_stage(uuid, uuid[], boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.seed_playoff_stage(uuid, uuid[], boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. acknowledge_stage_seeds — "Seeds are still right"
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.acknowledge_stage_seeds(p_stage2_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent   uuid;
  v_s1       public.playoffs%rowtype;
  v_s2       public.playoffs%rowtype;
  v_league   public.leagues%rowtype;
  v_plan     text;
  v_div_name text;
  v_rows     integer;
begin
  if p_stage2_id is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  select p.parent_playoff_id into v_parent from public.playoffs p where p.id = p_stage2_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if v_parent is null then
    raise exception 'not_stage2' using errcode = 'P0001';
  end if;
  select * into v_s1 from public.playoffs where id = v_parent for update;
  select * into v_s2 from public.playoffs where id = p_stage2_id for update;
  if v_s1.id is null or v_s2.parent_playoff_id is distinct from v_s1.id then
    raise exception 'not_stage2' using errcode = 'P0001';
  end if;

  select * into v_league from public.leagues where id = v_s1.league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan <> 'elite' then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  if v_s2.stage1_changed_at is null then
    return jsonb_build_object('committed', false, 'cleared', false, 'stage2_id', v_s2.id);
  end if;

  update public.playoffs
     set stage1_changed_at = null, updated_at = now()
   where id = v_s2.id and stage1_changed_at is not distinct from v_s2.stage1_changed_at;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  select d.name into v_div_name from public.divisions d where d.id = v_s1.division_id;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_s1.league_id, v_s1.division_id, 'playoff_stage_seeds_kept',
          format('%s playoffs: Stage 2 seeds kept after a round-robin result changed', coalesce(v_div_name, 'Division')));

  return jsonb_build_object('committed', true, 'cleared', true, 'stage2_id', v_s2.id);
end;
$$;

revoke execute on function public.acknowledge_stage_seeds(uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.acknowledge_stage_seeds(uuid)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. Verify — RAISES if anything is not exactly as stated
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_wrong text := '';
  v_role  text;
  r       record;
begin
  for r in
    select * from (values
      ('public.replace_playoff_games(uuid, jsonb, jsonb, boolean)',                          'authenticated', true),
      ('public.delete_playoff_bracket(uuid, boolean)',                                       'authenticated', true),
      ('public.enter_playoff_result(uuid, integer, integer)',                                'authenticated', true),
      ('public.clear_playoff_result(uuid, boolean)',                                         'authenticated', true),
      ('public.get_league_schedule_by_token(text)',                                          'anon,authenticated', true),
      ('public.replace_two_stage_games(uuid, jsonb, jsonb, uuid, jsonb, jsonb, boolean)',    'authenticated', true),
      ('public.seed_playoff_stage(uuid, uuid[], boolean)',                                   'authenticated', true),
      ('public.acknowledge_stage_seeds(uuid)',                                               'authenticated', true),
      ('public.playoff_write_stage(public.playoffs, uuid, jsonb, jsonb, integer, boolean)',  '', false),
      ('public.playoff_apply_seeds(uuid, uuid[])',                                           '', false)
    ) as t(fn, allowed, definer)
  loop
    foreach v_role in array array['public', 'anon', 'authenticated', 'service_role', 'dashboard_readonly']
    loop
      if has_function_privilege(v_role, r.fn, 'EXECUTE')
         <> (v_role = any (string_to_array(r.allowed, ','))) then
        v_wrong := v_wrong || format(' [%s EXECUTE on %s is %s]', v_role, r.fn,
                                     has_function_privilege(v_role, r.fn, 'EXECUTE'));
      end if;
    end loop;
    if (select prosecdef from pg_proc where oid = r.fn::regprocedure) <> r.definer then
      v_wrong := v_wrong || format(' [%s SECURITY DEFINER should be %s]', r.fn, r.definer);
    end if;
  end loop;

  if exists (select 1 from public.playoffs where stage <> 1 or parent_playoff_id is not null) then
    v_wrong := v_wrong || ' [an existing bracket is not stage 1]';
  end if;
  if exists (select 1 from pg_constraint where conname = 'playoffs_league_id_division_id_key') then
    v_wrong := v_wrong || ' [the old one-bracket-per-division key is still there]';
  end if;

  if v_wrong <> '' then
    raise exception '0113 verification failed:%', v_wrong;
  end if;
end;
$$;
