-- 0116: the public bracket page — one read-only page per division's playoffs
-- at /s/<token>/bracket/<division id> (2026-10-20, Whit; mockup
-- docs/mockups/public-bracket.html, approved 2026-10-20).
--
-- WHAT.
--   1. playoffs.public_scores (boolean, default TRUE): whether the public
--      bracket page shows SCORES for this bracket. Off = the reader sends no
--      score at all for that bracket — only who won.
--   2. set_playoff_public_scores(p_playoff_id, p_show): the Playoffs card's
--      "Show scores publicly" switch. A two-stage pair is ONE setting: either
--      stage's id sets both rows. Logged.
--   3. get_league_bracket_by_token(p_token, p_division_id): the page's reader.
--
-- WHY A SEPARATE READER. get_league_schedule_by_token (0105, last re-created
-- by 0114) must stay score-free: the public schedule shows no scores, and
-- sim:game-notes [O1-public-reader], KY1 in the 0114 proof and
-- sim:playoff-series S12 hold it to that. This function is the ONLY anonymous
-- path to playoff results, and it is NOT a change to the schedule reader.
--
-- THE GATES, IN ORDER (the schedule reader's, then the division's):
--   token shape → link row → enabled → org profile + timezone → plan Pro/Elite
--   (a league that dropped from Elite to Pro keeps its public bracket — decided
--   2026-10-20) → the division belongs to a season THIS org owns, unarchived,
--   within 7 days of season_last_day in the org's timezone (the schedule's
--   window) → the division is LOCKED → it has a non-draft bracket → no
--   bracket of the division is double elimination (not shareable yet).
--   A division id that is unknown, deleted, another org's, or in a season
--   outside the window gets ONE answer, `unavailable`, which never says which.
--
-- WHAT LEAVES. Every key is named; never to_jsonb(row), never x.*. Per game:
-- the bracket position, series game and length, date, time, status, seeds,
-- both teams (id + name), the winner's team id, the field (name + park name),
-- and the two scores ONLY when the bracket's public_scores is on. Never: notes,
-- the seeding list, stage1_changes, seeded_by, a field's lights or address,
-- team contacts, or anything from `games`. Not-needed games never leave.
--
-- PRIVILEGES: the reader is EXECUTE anon + authenticated; the setter
-- authenticated only; both revoked from public first (a role-level revoke is a
-- no-op). The final DO block checks every role and raises on a mismatch.
--
-- LOCKS WHEN APPLIED: ADD COLUMN with a constant default takes ACCESS
-- EXCLUSIVE on `playoffs` for an instant (no rewrite; a handful of rows) —
-- the Playoffs page, the public schedule's playoff rows and every bracket
-- function wait behind it. The functions are CREATE only.
--
-- APPLY VERBATIM, comments included (CLAUDE.md). Verify md5(prosrc) of both
-- functions against this file after applying.
--
-- DEPLOY ORDER: apply BEFORE the code that selects `public_scores` or calls
-- either function reaches `main`.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The setting
-- ────────────────────────────────────────────────────────────────────────────
alter table public.playoffs
  add column public_scores boolean not null default true;

comment on column public.playoffs.public_scores is
  'Whether the public bracket page (/s/<token>/bracket/<division>) shows scores for this bracket. False = winners and advancement only; get_league_bracket_by_token sends no scores. Written by set_playoff_public_scores (0116); a two-stage pair is kept equal.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. set_playoff_public_scores
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.set_playoff_public_scores(p_playoff_id uuid, p_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_root     uuid;
  v_league_id uuid;
  v_league   public.leagues%rowtype;
  v_plan     text;
  v_div_id   uuid;
  v_div_name text;
  v_ids      uuid[];
  v_changed  integer;
  v_rows     integer;
begin
  if p_playoff_id is null or p_show is null then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  -- A two-stage pair is one setting: resolve either stage to Stage 1.
  select coalesce(p.parent_playoff_id, p.id) into v_root from public.playoffs p where p.id = p_playoff_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;

  -- Lock order everywhere: Stage 1 row, then Stage 2 row.
  perform 1 from public.playoffs where id = v_root for update;
  perform 1 from public.playoffs where parent_playoff_id = v_root for update;

  select p.league_id, p.division_id into v_league_id, v_div_id from public.playoffs p where p.id = v_root;
  select * into v_league from public.leagues where id = v_league_id;
  if not found then
    raise exception 'playoff_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_league.owner_id;
  if v_plan is null or v_plan not in ('pro', 'elite') then
    raise exception 'plan_required' using errcode = 'P0001';
  end if;

  select array_agg(p.id order by p.stage, p.id),
         count(*) filter (where p.public_scores is distinct from p_show)
    into v_ids, v_changed
    from public.playoffs p
   where p.id = v_root or p.parent_playoff_id = v_root;

  if v_changed = 0 then
    return jsonb_build_object('committed', true, 'changed', false, 'show_scores', p_show, 'playoff_ids', to_jsonb(v_ids));
  end if;

  update public.playoffs
     set public_scores = p_show, updated_at = now()
   where (id = v_root or parent_playoff_id = v_root)
     and public_scores is distinct from p_show;
  get diagnostics v_rows = row_count;
  if v_rows <> v_changed then
    raise exception 'nothing_saved' using errcode = 'P0001';
  end if;

  select d.name into v_div_name from public.divisions d where d.id = v_div_id;
  insert into public.activity_log (league_id, division_id, event_type, message)
  values (v_league.id, v_div_id, 'playoff_public_scores_changed',
          format('%s playoffs: scores %s on the public bracket page', coalesce(v_div_name, 'Division'),
                 case when p_show then 'shown' else 'hidden' end));

  return jsonb_build_object('committed', true, 'changed', true, 'show_scores', p_show, 'playoff_ids', to_jsonb(v_ids));
end;
$$;

revoke execute on function public.set_playoff_public_scores(uuid, boolean)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.set_playoff_public_scores(uuid, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. get_league_bracket_by_token
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_league_bracket_by_token(p_token text, p_division_id uuid)
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
  v_div      record;
  v_brackets jsonb;
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

  -- The division must belong to a season THIS org owns, inside the public
  -- schedule's window. The org comes from the token alone; the division id is
  -- the one input the token does not vouch for, so a miss on ANY of these is
  -- one answer that never says which.
  select d.id, d.name, d.locked, l.id as season_id, l.name as season_name
    into v_div
    from public.divisions d
    join public.leagues l on l.id = d.league_id
   where d.id = p_division_id
     and l.owner_id = v_org_id
     and l.archived_at is null
     and (l.end_date is null or v_today <= public.season_last_day(l.id) + 7);
  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Published iff LOCKED (the schedule's rule). The name is already public:
  -- the schedule lists unpublished division names.
  if not v_div.locked then
    return jsonb_build_object('status', 'unpublished', 'division', jsonb_build_object('name', v_div.name));
  end if;

  if not exists (select 1 from public.playoffs po
                  where po.division_id = v_div.id and po.league_id = v_div.season_id
                    and po.status <> 'draft') then
    return jsonb_build_object('status', 'no_bracket', 'division', jsonb_build_object('name', v_div.name));
  end if;

  -- Double elimination is not shareable yet (decided 2026-10-20).
  if exists (select 1 from public.playoffs po
              where po.division_id = v_div.id and po.league_id = v_div.season_id
                and po.status <> 'draft' and po.format = 'double_elimination') then
    return jsonb_build_object('status', 'not_shareable', 'division', jsonb_build_object('name', v_div.name));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',            po.id,
           'stage',         po.stage,
           'format',        po.format,
           'advance_count', po.advance_count,
           'show_scores',   po.public_scores,
           'games', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id',             pg.id,
                      'round',          pg.round,
                      'game_number',    pg.game_number,
                      'series_game',    pg.series_game,
                      'series_length',  (select max(s.series_game) from public.playoff_games s
                                          where s.playoff_id = pg.playoff_id and s.round = pg.round
                                            and s.game_number = pg.game_number),
                      'scheduled_date', pg.scheduled_date,
                      'start_time',     to_char(pg.start_time, 'HH24:MI'),
                      'status',         pg.status,
                      'seed_home',      pg.seed_home,
                      'seed_away',      pg.seed_away,
                      'home_team',      case when pht.id is not null
                                          then jsonb_build_object('id', pht.id, 'name', pht.name)
                                          else null end,
                      'away_team',      case when pat.id is not null
                                          then jsonb_build_object('id', pat.id, 'name', pat.name)
                                          else null end,
                      'winner_id',      pg.winner_id,
                      -- Scores leave ONLY when the bracket shows them.
                      'home_score',     case when po.public_scores then pg.home_score else null end,
                      'away_score',     case when po.public_scores then pg.away_score else null end,
                      'venue',          case when v.id is not null
                                          then jsonb_build_object(
                                            'name', v.name,
                                            'location', case when loc.id is not null
                                              then jsonb_build_object('name', loc.name)
                                              else null end)
                                          else null end
                    ) order by pg.game_number, pg.series_game, pg.id), '[]'::jsonb)
               from public.playoff_games pg
               left join public.teams pht on pht.id = pg.home_team_id
               left join public.teams pat on pat.id = pg.away_team_id
               left join public.venues v on v.id = pg.venue_id
               left join public.locations loc on loc.id = v.location_id
              where pg.playoff_id = po.id
                and pg.league_id = v_div.season_id
                -- A game its series never needed is never shown.
                and pg.status <> 'not_needed'
           )
         ) order by po.stage, po.id), '[]'::jsonb)
    into v_brackets
    from public.playoffs po
   where po.division_id = v_div.id
     and po.league_id = v_div.season_id
     and po.status <> 'draft';

  return jsonb_build_object(
    'status',   'ok',
    'org',      jsonb_build_object('name', v_org_name, 'timezone', v_timezone),
    'today',    v_today,
    'season',   jsonb_build_object('id', v_div.season_id, 'name', v_div.season_name),
    'division', jsonb_build_object('id', v_div.id, 'name', v_div.name),
    'brackets', v_brackets
  );
end;
$$;

revoke execute on function public.get_league_bracket_by_token(text, uuid)
  from public, anon, authenticated, service_role, dashboard_readonly;
grant execute on function public.get_league_bracket_by_token(text, uuid)
  to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Verify privileges per role (a mismatch aborts the migration)
-- ────────────────────────────────────────────────────────────────────────────
do $verify$
declare
  r record;
  v_has boolean;
begin
  for r in select * from (values
      ('public.get_league_bracket_by_token(text, uuid)', 'anon', true),
      ('public.get_league_bracket_by_token(text, uuid)', 'authenticated', true),
      ('public.get_league_bracket_by_token(text, uuid)', 'service_role', false),
      ('public.get_league_bracket_by_token(text, uuid)', 'dashboard_readonly', false),
      ('public.get_league_bracket_by_token(text, uuid)', 'public', false),
      ('public.set_playoff_public_scores(uuid, boolean)', 'authenticated', true),
      ('public.set_playoff_public_scores(uuid, boolean)', 'anon', false),
      ('public.set_playoff_public_scores(uuid, boolean)', 'service_role', false),
      ('public.set_playoff_public_scores(uuid, boolean)', 'dashboard_readonly', false),
      ('public.set_playoff_public_scores(uuid, boolean)', 'public', false)
    ) as t(fn, role_name, expected)
  loop
    v_has := has_function_privilege(r.role_name, r.fn, 'EXECUTE');
    if v_has is distinct from r.expected then
      raise exception '0116 privilege check failed: % EXECUTE on % is %, expected %', r.role_name, r.fn, v_has, r.expected;
    end if;
  end loop;
end
$verify$;
