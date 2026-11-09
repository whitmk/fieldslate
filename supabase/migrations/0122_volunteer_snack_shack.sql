-- 0122 — Volunteer sign-ups: snack shack shifts (2026-11-09, branch
-- feat/volunteer-snack-shack). The proof is scripts/sim/volunteer-snack-sim.sql.
--
-- DECIDED (2026-11-09):
--   * Any family may take a spot on any shift (honor system). A shift
--     assigned to a team reads "For <team> families" on the sign-up page; a
--     shift with no team is open to anyone. Nothing in the database checks
--     the family's team against the shift's team.
--   * A shift's spots are its HEADCOUNT — the shift's own number, else the
--     season's people per shift (0119; effectivePeople in headcount.ts,
--     `volunteer_shift_people` here). There is no second number.
--   * A league turns shifts on by adding the season's SNACK SHACK ROLE (one
--     per season; kind `snack_shack`, on the roles screen as "Shifts come from
--     the Snack shack page"), with its own "Open on the public sign-up link".
--     Its spots, lead and divisions are not used (stored 1 / 0 / none).
--
-- WHAT.
--   1. Schema: the role kind `snack_shack` (one per season); claims on
--      `snack_shack_block_id` (0121's v1 CHECK dropped, playoff spots still
--      held NULL); one person per shift spot (partial unique index); spot
--      numbers up to 20 (a shift's headcount, 0119's range);
--      `volunteer_trigger_failures` takes `shift_insert` and a block id.
--   2. `volunteer_season_shifts` (callable by no role) — every shift of the
--      season with its spots and how many are taken; `volunteer_overlaps` —
--      0121's overlap check, now across game spots AND shifts.
--   3. Re-created VERBATIM from 0121 with marked edits: save_volunteer_role
--      (the snack shack kind; a game role's strand check reads game spots
--      only), volunteer_signup_page (+ `shifts`), volunteer_manage_page
--      (shift spots too), volunteer_cancel, volunteer_admin_signups
--      (+ `snack_shack_block_id`), volunteer_set_no_show,
--      volunteer_admin_remind, volunteer_email_spots (shift details).
--   4. volunteer_claim and volunteer_admin_assign gain `p_block_id uuid
--      DEFAULT NULL` as their LAST argument (the old signatures are dropped
--      — one overload each). A call without it is exactly 0121's game claim,
--      so the code on main keeps working between the apply and the deploy.
--   5. Triggers on `snack_shack_blocks` (SECURITY DEFINER — members edit
--      shifts from the browser): a deleted shift's sign-ups DETACH and a
--      held spot_lost email is queued (0121's game rule); a new shift with
--      the same date and start takes them back within 10 minutes (a
--      regenerate) when its headcount has room for their spot number; a
--      lowered headcount cancels the spots above it on shifts still ahead
--      and emails each volunteer (shift_canceled, reason headcount). The
--      season number (`snack_shack_settings.people_per_shift`) does the same
--      for every future shift without its own number.
--   6. regenerate_snack_shack_shifts re-created VERBATIM from 0119 plus the
--      sign-ups count: it returns `claims_carried` / `claims_lost` (the
--      triggers do the moving). The keys are new; nothing else in the reply
--      changes, so the code on main reads it as before.
--   7. `volunteer_shift_claim_counts(season)` — members only: each shift's
--      number of active sign-ups, for the regenerate preview (counts, never
--      names).
--   8. (Whit's review, 2026-11-09) A shift that comes back with the same
--      date and start but a different END (a regenerate changed its hours)
--      keeps its sign-ups and emails each volunteer the new hours: the new
--      outbox kind `shift_changed` (payload: the claim and the old end), its
--      manage link attached at send time — so `volunteer_outbox_take` is
--      re-created VERBATIM from 0121 with that kind added to its list.
--   9. (Whit's review, 2026-11-09) No "spot gone" email for a spot whose
--      start has already passed — for shifts AND games. The sign-up is still
--      detached (it's history); only the email is skipped.
--      `volunteer_on_game_delete` is re-created VERBATIM from 0121 with that
--      condition added.
-- Nothing here writes a game, a division, a team, a season or a shift's
-- own columns. The snack shack print, emails and exports read none of the
-- volunteer tables (sim:snack-print goldens, sim:volunteer-leaks).
--
-- LOCKS when applied: ACCESS EXCLUSIVE on `volunteer_roles`,
-- `volunteer_claims`, `volunteer_trigger_failures` and `volunteer_outbox`
-- (constraints, a column) — `games` is not locked: only the body of its
-- delete trigger's function is replaced; SHARE ROW EXCLUSIVE on `snack_shack_blocks` and
-- `snack_shack_settings` (the triggers) — writes to those wait, reads don't.
-- Well under a second.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Schema
-- ────────────────────────────────────────────────────────────────────────────
alter table public.volunteer_roles drop constraint volunteer_roles_kind_check;
alter table public.volunteer_roles add constraint volunteer_roles_kind_check
  check (kind in ('per_game', 'per_team', 'snack_shack'));
-- One snack shack role per season.
create unique index volunteer_roles_one_snack_shack
  on public.volunteer_roles (season_id) where kind = 'snack_shack';

alter table public.volunteer_claims drop constraint volunteer_claims_v1_games_only;
-- Playoff spots come later.
alter table public.volunteer_claims add constraint volunteer_claims_no_playoff
  check (playoff_game_id is null);
alter table public.volunteer_claims add constraint volunteer_claims_shift_has_role
  check (snack_shack_block_id is null or role_id is not null or status <> 'active');
-- A shift's spots are its headcount (1–20, 0119); a game role's stay 1–10.
alter table public.volunteer_claims drop constraint volunteer_claims_position_check;
alter table public.volunteer_claims add constraint volunteer_claims_position_check
  check (position between 1 and 20);

-- One person per shift spot.
create unique index volunteer_claims_one_per_shift_spot
  on public.volunteer_claims (snack_shack_block_id, position)
  where status = 'active' and snack_shack_block_id is not null;
create index volunteer_claims_block_idx on public.volunteer_claims (snack_shack_block_id);

alter table public.volunteer_trigger_failures drop constraint volunteer_trigger_failures_trigger_name_check;
alter table public.volunteer_trigger_failures add constraint volunteer_trigger_failures_trigger_name_check
  check (trigger_name in ('game_change', 'game_insert', 'shift_insert'));
alter table public.volunteer_trigger_failures add column snack_shack_block_id uuid;

-- A shift's hours changed under its sign-ups (item 8).
alter table public.volunteer_outbox drop constraint volunteer_outbox_kind_check;
alter table public.volunteer_outbox add constraint volunteer_outbox_kind_check
  check (kind in ('signup_confirmed', 'manage_link', 'canceled_by_volunteer',
                  'switched', 'admin_assigned', 'admin_canceled',
                  'game_moved', 'rained_out', 'makeup_set', 'back_on',
                  'spot_lost', 'shift_canceled', 'reminder', 'nudge',
                  'shift_changed'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Shift helpers (callable by no role)
-- ────────────────────────────────────────────────────────────────────────────
-- A shift's spots: its own headcount, else the season's — the TypeScript
-- effectivePeople rule (src/lib/snack-shack/headcount.ts), clamped to 0119's
-- 1–20.
create or replace function public.volunteer_shift_people(p_people_needed integer, p_people_per_shift integer)
returns integer
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select least(greatest(coalesce(p_people_needed, p_people_per_shift, 1), 1), 20);
$$;

-- Every shift of the season's snack shack, as volunteer spots: its times
-- (wall clock), its spots, how many are taken, its team, and whether the
-- season's snack shack role is open on the link. No snack shack role → no
-- rows: a league turns shifts on by adding the role.
create or replace function public.volunteer_season_shifts(p_season_id uuid)
returns table (
  block_id uuid, role_id uuid, start_wall timestamp, end_wall timestamp,
  spots integer, taken integer, assigned_team_id uuid, signups_open boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select b.id, vr.id, b.date + b.start_time, b.date + b.end_time,
         public.volunteer_shift_people(b.people_needed, s.people_per_shift),
         (select count(*)::integer from public.volunteer_claims c
           where c.snack_shack_block_id = b.id and c.status = 'active'),
         b.assigned_team_id, vr.signups_open
    from public.snack_shack_settings s
    join public.snack_shack_blocks b on b.snack_shack_id = s.id
    join public.volunteer_roles vr on vr.season_id = s.season_id and vr.kind = 'snack_shack'
   where s.season_id = p_season_id;
$$;

-- Does this volunteer hold an active spot whose [start, end) meets
-- [p_start, p_end)? A game spot runs from its shifted start to game end (the
-- game half is 0121's claim check, verbatim); a shift from start to end.
create or replace function public.volunteer_overlaps(p_volunteer uuid, p_start timestamp, p_end timestamp)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
           select 1
             from public.volunteer_claims c
             join public.games g on g.id = c.game_id
             join public.volunteer_roles vr on vr.id = c.role_id
             join public.teams ht on ht.id = g.home_team_id
             join public.divisions hd on hd.id = ht.division_id
            where c.volunteer_id = p_volunteer and c.status = 'active'
              and public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes) < p_end
              and p_start < (g.scheduled_at at time zone 'UTC')::timestamp
                            + make_interval(secs => public.volunteer_game_minutes(hd.settings) * 60))
      or exists (
           select 1
             from public.volunteer_claims c
             join public.snack_shack_blocks b on b.id = c.snack_shack_block_id
            where c.volunteer_id = p_volunteer and c.status = 'active'
              and b.date + b.start_time < p_end
              and p_start < b.date + b.end_time);
$$;

-- A shift trigger that failed (the insert's reattach). Never blocks the
-- shift edit; recorded where the sign-up list and the daily check see it.
create or replace function public.volunteer_record_shift_failure(p_season_id uuid, p_block_id uuid, p_sqlstate text)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.volunteer_trigger_failures (owner_id, season_id, snack_shack_block_id, trigger_name, error_code)
  select l.owner_id, l.id, p_block_id, 'shift_insert', coalesce(nullif(p_sqlstate, ''), 'XX000')
    from public.leagues l where l.id = p_season_id;
$$;

-- Cancels a shift's active spots above p_people and emails each volunteer
-- (shift_canceled, reason headcount). Returns how many.
create or replace function public.volunteer_cancel_shift_spots(p_block_id uuid, p_people integer)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  with c as (
    update public.volunteer_claims
       set status = 'canceled', canceled_at = now()
     where snack_shack_block_id = p_block_id and status = 'active' and position > p_people
    returning id, owner_id, season_id, volunteer_id
  ), q as (
    insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
    select c.owner_id, c.season_id, c.volunteer_id, 'shift_canceled',
           jsonb_build_object('claim_id', c.id, 'block_id', p_block_id, 'reason', 'headcount')
      from c
    returning 1
  )
  select count(*) into v_n from q;
  return v_n;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Re-created from 0121 (verbatim + the 0122 edits)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.save_volunteer_role(
  p_role_id      uuid,
  p_season_id    uuid,
  p_name         text,
  p_kind         text,
  p_spots        integer,
  p_lead_minutes integer,
  p_signups_open boolean,
  p_counts       boolean,
  p_division_ids uuid[],
  p_commit       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner     uuid;
  v_name      text := btrim(coalesce(p_name, ''));
  v_divs      uuid[] := coalesce((select array_agg(distinct d) from unnest(coalesce(p_division_ids, '{}')) d where d is not null), '{}');
  v_role      public.volunteer_roles%rowtype;
  v_cancel    uuid[] := '{}';
  v_id        uuid;
  v_canceled  integer := 0;
begin
  v_owner := public.volunteer_admin_gate(p_season_id, true);

  if v_name = '' or length(v_name) > 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('per_game', 'per_team', 'snack_shack') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  -- 0122: the snack shack role takes each shift's headcount as its spots and
  -- covers no division and no lead — those inputs are stored as 1 / 0 / none.
  if p_kind = 'snack_shack' then
    p_spots := 1;
    p_lead_minutes := 0;
    v_divs := '{}';
  end if;
  if p_spots is null or p_spots < 1 or p_spots > 10 then
    raise exception 'invalid_spots' using errcode = 'P0001';
  end if;
  if p_lead_minutes is null or p_lead_minutes < 0 or p_lead_minutes > 120 then
    raise exception 'invalid_lead' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_divs) d
              where not exists (select 1 from public.divisions x where x.id = d and x.league_id = p_season_id)) then
    raise exception 'division_not_in_season' using errcode = 'P0001';
  end if;

  if p_role_id is not null then
    select * into v_role from public.volunteer_roles r
     where r.id = p_role_id and r.season_id = p_season_id for update;
    if v_role.id is null then
      raise exception 'role_not_found' using errcode = 'P0002';
    end if;
  end if;

  if exists (select 1 from public.volunteer_roles r
              where r.season_id = p_season_id
                and lower(btrim(r.name)) = lower(v_name)
                and r.id is distinct from p_role_id) then
    raise exception 'name_taken' using errcode = 'P0001';
  end if;
  -- 0122: one snack shack role per season.
  if p_kind = 'snack_shack' and exists (
       select 1 from public.volunteer_roles r
        where r.season_id = p_season_id and r.kind = 'snack_shack' and r.id is distinct from p_role_id) then
    raise exception 'snack_role_exists' using errcode = 'P0001';
  end if;

  if v_role.id is not null then
    if v_role.kind <> p_kind and exists (
         select 1 from public.volunteer_claims c where c.role_id = v_role.id and c.status = 'active') then
      raise exception 'kind_locked' using errcode = 'P0001';
    end if;
    -- The claims this change strands: spots above the new count, or games in
    -- a division the role no longer covers. A per_team spot belongs to its
    -- team's division; a per_game spot to the home team's.
    select coalesce(array_agg(c.id), '{}') into v_cancel
      from public.volunteer_claims c
      left join public.games g on g.id = c.game_id
      left join public.teams t on t.id = coalesce(c.for_team_id, g.home_team_id)
     where c.role_id = v_role.id and c.status = 'active' and c.game_id is not null  -- 0122: game spots only
       and (c.position > p_spots or t.division_id is null or not (t.division_id = any (v_divs)));
  end if;

  if not coalesce(p_commit, false) then
    return jsonb_build_object('committed', false, 'claims_to_cancel', coalesce(array_length(v_cancel, 1), 0));
  end if;

  if v_role.id is null then
    insert into public.volunteer_roles (owner_id, season_id, name, kind, spots, lead_minutes, signups_open,
                                        counts_toward_goal, sort_order)
    values (v_owner, p_season_id, v_name, p_kind, p_spots, p_lead_minutes, coalesce(p_signups_open, true), coalesce(p_counts, true),
            coalesce((select max(r.sort_order) + 1 from public.volunteer_roles r where r.season_id = p_season_id), 0))
    returning id into v_id;
  else
    v_canceled := public.volunteer_cancel_claims(v_cancel, v_role.name);
    update public.volunteer_roles
       set name = v_name, kind = p_kind, spots = p_spots, lead_minutes = p_lead_minutes,
           signups_open = coalesce(p_signups_open, true),
           counts_toward_goal = coalesce(p_counts, true), updated_at = now()
     where id = v_role.id;
    v_id := v_role.id;
    delete from public.volunteer_role_divisions rd where rd.role_id = v_id and not (rd.division_id = any (v_divs));
  end if;

  insert into public.volunteer_role_divisions (role_id, division_id)
  select v_id, d from unnest(v_divs) d
  on conflict do nothing;

  return jsonb_build_object('committed', true, 'role_id', v_id, 'claims_canceled', v_canceled);
end;
$$;

create or replace function public.volunteer_signup_page(p_token text, p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid := public.volunteer_link_owner(p_token);
  v_plan    text;
  v_now     timestamp;
  v_today   date;
  v_seasons jsonb;
  v_season  uuid;
begin
  if v_owner is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;
  v_now := public.volunteer_org_now(v_owner);
  v_today := v_now::date;

  -- Open seasons: unarchived, at least one locked division, not past the
  -- schedule's own 7-day window.
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.start_date nulls last, l.name, l.id), '[]')
    into v_seasons
    from public.leagues l
   where l.owner_id = v_owner and l.archived_at is null
     and exists (select 1 from public.divisions d where d.league_id = l.id and d.locked)
     and (public.season_last_day(l.id) is null or public.season_last_day(l.id) + 7 >= v_today);

  select (e ->> 'id')::uuid into v_season
    from jsonb_array_elements(v_seasons) e
   where p_season_id is null or (e ->> 'id')::uuid = p_season_id
   limit 1;

  return jsonb_build_object(
    'status', 'ok',
    'league_name', (select p.org_name from public.profiles p where p.id = v_owner),
    'now', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI'),
    'seasons', v_seasons,
    'season_id', v_season,
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name,
               'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name, t.id)
                                    from public.teams t where t.division_id = d.id), '[]'))
             order by d.priority, d.name, d.id)
        from public.divisions d where d.league_id = v_season and d.locked), '[]'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', vr.id, 'name', vr.name, 'kind', vr.kind) order by vr.sort_order, vr.name)
        from public.volunteer_roles vr where vr.season_id = v_season and vr.signups_open), '[]'),
    'spots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'game_id', sp.game_id, 'role_id', sp.role_id, 'for_team_id', sp.for_team_id,
               'for_team_name', ft.name, 'division_id', sp.division_id, 'division_name', d.name,
               'home_team_name', ht.name, 'away_team_name', coalesce(at.name, g.external_team_name),
               'interleague', g.interleague_org_id is not null, 'is_away', g.is_away,
               'field', v.name, 'park', loc.name,
               'start', to_char(sp.spot_start, 'YYYY-MM-DD"T"HH24:MI'),
               'game_start', to_char(sp.game_start, 'YYYY-MM-DD"T"HH24:MI'),
               'end', to_char(sp.game_end, 'YYYY-MM-DD"T"HH24:MI'),
               'state', public.volunteer_slot_state(sp.game_status),
               'spots', sp.spots, 'taken', least(sp.taken, sp.spots))
             order by sp.spot_start, d.name, ht.name, sp.role_id, ft.name nulls first)
        from public.volunteer_season_spots(v_season) sp
        join public.games g on g.id = sp.game_id
        join public.teams ht on ht.id = g.home_team_id
        left join public.teams at on at.id = g.away_team_id
        left join public.teams ft on ft.id = sp.for_team_id
        join public.divisions d on d.id = sp.division_id
        left join public.venues v on v.id = g.venue_id
        left join public.locations loc on loc.id = v.location_id
       where sp.division_locked and sp.signups_open and sp.spot_start > v_now), '[]'),
    -- 0122: snack shack shifts still ahead, when the season's snack shack
    -- role is open. The shift's team names who it's for; never a volunteer.
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'block_id', sh.block_id, 'role_id', sh.role_id,
               'start', to_char(sh.start_wall, 'YYYY-MM-DD"T"HH24:MI'),
               'end', to_char(sh.end_wall, 'YYYY-MM-DD"T"HH24:MI'),
               'assigned_team_name', at.name,
               'spots', sh.spots, 'taken', least(sh.taken, sh.spots))
             order by sh.start_wall, sh.end_wall, sh.block_id)
        from public.volunteer_season_shifts(v_season) sh
        left join public.teams at on at.id = sh.assigned_team_id
       where sh.signups_open and sh.start_wall > v_now), '[]')
  );
end;
$$;

-- volunteer_claim and volunteer_admin_assign gain `p_block_id` (last, default
-- NULL). The old signatures go, so each keeps ONE overload.
drop function public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean);
drop function public.volunteer_admin_assign(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, boolean);

create or replace function public.volunteer_claim(
  p_token           text,
  p_game_id         uuid,
  p_role_id         uuid,
  p_for_team_id     uuid,
  p_division_id     uuid,
  p_team_id         uuid,
  p_first_initial   text,
  p_last_name       text,
  p_email           text,
  p_adult           boolean,
  p_ip_hash         text,
  p_email_hash      text,
  p_confirm_overlap boolean,
  p_block_id        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid := public.volunteer_link_owner(p_token);
  v_plan    text;
  v_initial text := upper(btrim(coalesce(p_first_initial, '')));
  v_last    text := btrim(coalesce(p_last_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_now     timestamp;
  v_season  uuid;
  v_spot    record;
  v_why     text;
  v_vol     uuid;
  v_pos     integer;
  v_claim   uuid;
  v_token   text;
  v_shift   record;
  v_start   timestamp;
  v_end     timestamp;
  v_spots   integer;
begin
  if v_owner is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;

  if v_initial !~ '^[A-Z]$'
     or length(v_last) not between 1 and 60 or v_last ~ '[[:cntrl:]<>]'
     or length(v_email) > 254
     or v_email !~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$'
     or not coalesce(p_adult, false)
     or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_email_hash, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  -- Rate limits (windows ≤ 23 hours — the take prunes at 23). Every attempt
  -- that gets this far counts, refused or not. 100 an hour per IP (decided
  -- 2026-11-08: families at a league meeting or on carrier NAT share one IP;
  -- the captcha and the per-email limit carry the spam load), 10 a day per
  -- email.
  if (select count(*) from public.volunteer_rate_events e
       where e.kind = 'claim_ip' and e.key_hash = p_ip_hash and e.at > now() - interval '1 hour') >= 100
     or (select count(*) from public.volunteer_rate_events e
          where e.kind = 'claim_email' and e.key_hash = p_email_hash and e.at > now() - interval '23 hours') >= 10 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  insert into public.volunteer_rate_events (kind, key_hash) values ('claim_ip', p_ip_hash), ('claim_email', p_email_hash);

  -- 0122: exactly one target — a game spot or a snack shack shift.
  if (p_game_id is null) = (p_block_id is null) then
    return jsonb_build_object('status', 'no_slot');
  end if;

  -- The family's team: in that division, in a LOCKED division of the
  -- target's season, of this league.
  if p_block_id is not null then
    select s.season_id into v_season
      from public.snack_shack_blocks b
      join public.snack_shack_settings s on s.id = b.snack_shack_id
      join public.leagues l on l.id = s.season_id
     where b.id = p_block_id and l.owner_id = v_owner and l.archived_at is null
       for key share of b;
  else
    select g.league_id into v_season
      from public.games g join public.leagues l on l.id = g.league_id
     where g.id = p_game_id and l.owner_id = v_owner and l.archived_at is null
       for key share of g;
  end if;
  if v_season is null then
    return jsonb_build_object('status', 'no_slot');
  end if;
  if not exists (select 1 from public.teams t join public.divisions d on d.id = t.division_id
                  where t.id = p_team_id and t.division_id = p_division_id
                    and d.league_id = v_season and d.locked) then
    return jsonb_build_object('status', 'wrong_team');
  end if;

  if p_block_id is not null then
    -- 0122: a shift. One shift at a time; its spots are its headcount. It
    -- has no division to publish, so the shared refusal runs with
    -- "published" true, the shift's start, and the shift's role check.
    perform pg_advisory_xact_lock(hashtextextended('shift:' || p_block_id::text, 122));
    v_now := public.volunteer_org_now(v_owner);
    select * into v_shift from public.volunteer_season_shifts(v_season) sh where sh.block_id = p_block_id;
    v_why := public.volunteer_claim_refusal('scheduled', v_shift.start_wall, v_now,
                                            v_shift.block_id is not null and v_shift.role_id = p_role_id,
                                            true, v_shift.signups_open);
    v_start := v_shift.start_wall;
    v_end := v_shift.end_wall;
    v_spots := v_shift.spots;
  else
    -- One spot set at a time: concurrent claims on it queue here.
    perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':' || coalesce(p_role_id::text, '') || ':'
                                                   || coalesce(p_for_team_id::text, ''), 121));

    v_now := public.volunteer_org_now(v_owner);
    select * into v_spot from public.volunteer_season_spots(v_season) sp
     where sp.game_id = p_game_id and sp.role_id = p_role_id
       and sp.for_team_id is not distinct from p_for_team_id;
    select g.status into v_why from public.games g where g.id = p_game_id;
    v_why := public.volunteer_claim_refusal(v_why, v_spot.spot_start, v_now, v_spot.game_id is not null,
                                            v_spot.division_locked, v_spot.signups_open);
    v_start := v_spot.spot_start;
    v_end := v_spot.game_end;
    v_spots := v_spot.spots;
  end if;
  if v_why is not null then
    return jsonb_build_object('status', v_why);
  end if;

  select v.id into v_vol from public.volunteers v where v.owner_id = v_owner and v.email_lc = v_email;

  if v_vol is not null then
    if exists (select 1 from public.volunteer_claims c
                where c.volunteer_id = v_vol and c.status = 'active'
                  and (case when p_block_id is not null then c.snack_shack_block_id = p_block_id
                            else c.game_id = p_game_id and c.role_id = p_role_id
                                 and c.for_team_id is not distinct from p_for_team_id end)) then
      return jsonb_build_object('status', 'already_signed_up');
    end if;
    -- Overlap: any active spot of this email — a game spot or a shift —
    -- whose [start, end) meets the new one's. Answered generically; the
    -- reply names nothing.
    if not coalesce(p_confirm_overlap, false) and public.volunteer_overlaps(v_vol, v_start, v_end) then
      return jsonb_build_object('status', 'overlap_confirm_needed');
    end if;
  end if;

  select min(n) into v_pos
    from generate_series(1, v_spots) n
   where not exists (select 1 from public.volunteer_claims c
                      where c.status = 'active' and c.position = n
                        and (case when p_block_id is not null then c.snack_shack_block_id = p_block_id
                            else c.game_id = p_game_id and c.role_id = p_role_id
                                 and c.for_team_id is not distinct from p_for_team_id end));
  if v_pos is null then
    return jsonb_build_object('status', 'just_taken');
  end if;

  if v_vol is null then
    -- The first sign-up names the volunteer; a later one with the same email
    -- never renames them (identity is the email, never the name).
    insert into public.volunteers (owner_id, email_lc, first_initial, last_name, adult_confirmed_at)
    values (v_owner, v_email, v_initial, v_last, now())
    returning id into v_vol;
  else
    update public.volunteers set adult_confirmed_at = now() where id = v_vol;
  end if;

  begin
    insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, game_id,
                                         snack_shack_block_id, role_id, for_team_id, position, created_by)
    values (v_owner, v_season, v_vol, p_team_id, p_game_id, p_block_id, p_role_id,
            case when p_block_id is null then p_for_team_id end, v_pos, 'volunteer')
    returning id into v_claim;
  exception when unique_violation then
    return jsonb_build_object('status', 'just_taken');
  end;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.volunteer_manage_links (token_hash, volunteer_id, season_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_vol, v_season);
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_owner, v_season, v_vol, 'signup_confirmed',
          jsonb_build_object('claim_id', v_claim, 'manage_token', v_token));

  return jsonb_build_object('status', 'claimed', 'claim_id', v_claim, 'position', v_pos);
end;
$$;

create or replace function public.volunteer_manage_page(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link  public.volunteer_manage_links%rowtype;
  v_owner uuid;
  v_plan  text;
  v_now   timestamp;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select k.* into v_link from public.volunteer_manage_links k
   where k.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and k.revoked_at is null;
  select l.owner_id into v_owner from public.leagues l where l.id = v_link.season_id and l.archived_at is null;
  if v_owner is null or not public.org_feature_on(v_owner, 'volunteers') then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;
  v_now := public.volunteer_org_now(v_owner);

  return (
    select jsonb_build_object(
      'status', 'ok',
      'league_name', (select p.org_name from public.profiles p where p.id = v_owner),
      'contact_email', (select s.contact_email from public.volunteer_settings s where s.owner_id = v_owner),
      'signup_token', (select s.link_token from public.volunteer_settings s where s.owner_id = v_owner and s.link_enabled),
      'first_initial', v.first_initial, 'last_name', v.last_name,
      'claims', coalesce((
        select jsonb_agg(x.j order by x.sort_at, x.role_name, x.claim_id) from (
        select g.scheduled_at as sort_at, vr.name as role_name, c.id as claim_id, jsonb_build_object(
                 'claim_id', c.id, 'kind', 'game', 'role_name', vr.name, 'for_team_name', ft.name,
                 'family_team_name', fam.name, 'family_division_name', famd.name,
                 'home_team_name', ht.name, 'away_team_name', coalesce(at.name, g.external_team_name),
                 'interleague', g.interleague_org_id is not null, 'is_away', g.is_away,
                 'field', ve.name, 'park', loc.name,
                 'start', to_char(public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes), 'YYYY-MM-DD"T"HH24:MI'),
                 'state', public.volunteer_slot_state(g.status),
                 'moved_from', c.moved_from,
                 'was_start', case when c.moved_from ? 'start'
                                   then to_char(public.volunteer_spot_start((c.moved_from ->> 'start')::timestamp, vr.lead_minutes), 'YYYY-MM-DD"T"HH24:MI') end,
                 'was_field', (select wv.name from public.venues wv where wv.id = (c.moved_from ->> 'venue_id')::uuid),
                 'can_change', public.volunteer_change_allowed(
                                 public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes), v_now)) as j
          from public.volunteer_claims c
          join public.games g on g.id = c.game_id
          join public.volunteer_roles vr on vr.id = c.role_id
          join public.teams ht on ht.id = g.home_team_id
          left join public.teams at on at.id = g.away_team_id
          left join public.teams ft on ft.id = c.for_team_id
          left join public.teams fam on fam.id = c.family_team_id
          left join public.divisions famd on famd.id = fam.division_id
          left join public.venues ve on ve.id = g.venue_id
          left join public.locations loc on loc.id = ve.location_id
         where c.volunteer_id = v.id and c.season_id = v_link.season_id and c.status = 'active'
        union all
        -- 0122: the volunteer's snack shack shifts.
        select (b.date + b.start_time) at time zone 'UTC', vr.name, c.id, jsonb_build_object(
                 'claim_id', c.id, 'kind', 'shift', 'role_name', vr.name, 'for_team_name', null::text,
                 'assigned_team_name', bt.name,
                 'family_team_name', fam.name, 'family_division_name', famd.name,
                 'home_team_name', null::text, 'away_team_name', null::text,
                 'interleague', false, 'is_away', false, 'field', null::text, 'park', null::text,
                 'start', to_char(b.date + b.start_time, 'YYYY-MM-DD"T"HH24:MI'),
                 'end', to_char(b.date + b.end_time, 'YYYY-MM-DD"T"HH24:MI'),
                 'state', 'open', 'moved_from', null::jsonb, 'was_start', null::text, 'was_field', null::text,
                 'can_change', public.volunteer_change_allowed(b.date + b.start_time, v_now))
          from public.volunteer_claims c
          join public.snack_shack_blocks b on b.id = c.snack_shack_block_id
          join public.volunteer_roles vr on vr.id = c.role_id
          left join public.teams bt on bt.id = b.assigned_team_id
          left join public.teams fam on fam.id = c.family_team_id
          left join public.divisions famd on famd.id = fam.division_id
         where c.volunteer_id = v.id and c.season_id = v_link.season_id and c.status = 'active'
        ) x), '[]'))
      from public.volunteers v where v.id = v_link.volunteer_id);
end;
$$;

create or replace function public.volunteer_cancel(p_token text, p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link  public.volunteer_manage_links%rowtype;
  v_owner uuid;
  v_plan  text;
  v_claim public.volunteer_claims%rowtype;
  v_start timestamp;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select k.* into v_link from public.volunteer_manage_links k
   where k.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and k.revoked_at is null;
  select l.owner_id into v_owner from public.leagues l where l.id = v_link.season_id and l.archived_at is null;
  if v_owner is null or not public.org_feature_on(v_owner, 'volunteers') then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.plan into v_plan from public.profiles p where p.id = v_owner;
  if v_plan is distinct from 'elite' then
    return jsonb_build_object('status', 'plan');
  end if;

  select c.* into v_claim from public.volunteer_claims c
   where c.id = p_claim_id and c.volunteer_id = v_link.volunteer_id and c.season_id = v_link.season_id
     and c.status = 'active'
     for update;
  if v_claim.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes) into v_start
    from public.games g join public.volunteer_roles vr on vr.id = v_claim.role_id
   where g.id = v_claim.game_id;
  -- 0122: a shift's spot starts when the shift does.
  if v_claim.snack_shack_block_id is not null then
    select b.date + b.start_time into v_start
      from public.snack_shack_blocks b where b.id = v_claim.snack_shack_block_id;
  end if;
  if not public.volunteer_change_allowed(v_start, public.volunteer_org_now(v_owner)) then
    return jsonb_build_object('status', 'change_closed',
      'contact_email', (select s.contact_email from public.volunteer_settings s where s.owner_id = v_owner));
  end if;

  update public.volunteer_claims set status = 'canceled', canceled_at = now() where id = v_claim.id;
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_owner, v_claim.season_id, v_claim.volunteer_id, 'canceled_by_volunteer', jsonb_build_object('claim_id', v_claim.id));
  return jsonb_build_object('status', 'canceled');
end;
$$;

create or replace function public.volunteer_admin_signups(p_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.volunteer_admin_gate(p_season_id, false);
begin
  return jsonb_build_object(
    'season_id', p_season_id,
    'today', to_char(public.volunteer_org_now(v_owner), 'YYYY-MM-DD"T"HH24:MI'),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
               'claim_id', c.id, 'status', c.status, 'game_id', c.game_id,
               'snack_shack_block_id', c.snack_shack_block_id, 'role_id', c.role_id,
               'for_team_id', c.for_team_id, 'position', c.position, 'family_team_id', c.family_team_id,
               'created_by', c.created_by, 'created_at', c.created_at, 'canceled_at', c.canceled_at,
               'no_show', c.no_show, 'last_reminded_at', c.last_reminded_at,
               'last_reminded_on', to_char(c.last_reminded_at at time zone
                                     (select p.timezone from public.profiles p where p.id = v_owner), 'YYYY-MM-DD'),
               'detached_from', c.detached_from, 'detached_at', c.detached_at, 'moved_from', c.moved_from,
               'volunteer_id', v.id, 'first_initial', v.first_initial, 'last_name', v.last_name,
               'email', v.email_lc)
             order by c.created_at, c.id)
        from public.volunteer_claims c
        join public.volunteers v on v.id = c.volunteer_id
       where c.season_id = p_season_id), '[]'::jsonb));
end;
$$;

create or replace function public.volunteer_admin_assign(
  p_season_id       uuid,
  p_game_id         uuid,
  p_role_id         uuid,
  p_for_team_id     uuid,
  p_team_id         uuid,
  p_first_initial   text,
  p_last_name       text,
  p_email           text,
  p_adult           boolean,
  p_confirm_overlap boolean,
  p_block_id        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid := public.volunteer_admin_gate(p_season_id, true);
  v_initial text := upper(btrim(coalesce(p_first_initial, '')));
  v_last    text := btrim(coalesce(p_last_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_now     timestamp;
  v_spot    record;
  v_why     text;
  v_vol     uuid;
  v_pos     integer;
  v_claim   uuid;
  v_token   text;
  v_shift   record;
  v_start   timestamp;
  v_end     timestamp;
  v_spots   integer;
begin
  if v_initial !~ '^[A-Z]$'
     or length(v_last) not between 1 and 60 or v_last ~ '[[:cntrl:]<>]'
     or length(v_email) > 254
     or v_email !~ '^[^@[:space:][:cntrl:]<>"(),;:\\]+@[^@[:space:][:cntrl:]<>"(),;:\\]+\.[^@[:space:][:cntrl:]<>"(),;:\\]+$'
     or not coalesce(p_adult, false) then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  -- 0122: exactly one target — a game spot or a snack shack shift of this
  -- season.
  if (p_game_id is null) = (p_block_id is null) then
    return jsonb_build_object('status', 'no_slot');
  end if;
  if p_block_id is not null then
    if not exists (select 1 from public.snack_shack_blocks b
                     join public.snack_shack_settings s on s.id = b.snack_shack_id
                    where b.id = p_block_id and s.season_id = p_season_id) then
      return jsonb_build_object('status', 'no_slot');
    end if;
  elsif not exists (select 1 from public.games g where g.id = p_game_id and g.league_id = p_season_id) then
    return jsonb_build_object('status', 'no_slot');
  end if;
  if not exists (select 1 from public.teams t join public.divisions d on d.id = t.division_id
                  where t.id = p_team_id and d.league_id = p_season_id) then
    return jsonb_build_object('status', 'wrong_team');
  end if;

  if p_block_id is not null then
    -- 0122: a shift (the public claim's rule; an admin may fill a shift
    -- while the snack shack role is closed on the link).
    perform pg_advisory_xact_lock(hashtextextended('shift:' || p_block_id::text, 122));
    v_now := public.volunteer_org_now(v_owner);
    select * into v_shift from public.volunteer_season_shifts(p_season_id) sh where sh.block_id = p_block_id;
    v_why := public.volunteer_claim_refusal('scheduled', v_shift.start_wall, v_now,
                                            v_shift.block_id is not null and v_shift.role_id = p_role_id,
                                            true, true);
    v_start := v_shift.start_wall;
    v_end := v_shift.end_wall;
    v_spots := v_shift.spots;
  else
    perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':' || coalesce(p_role_id::text, '') || ':'
                                                   || coalesce(p_for_team_id::text, ''), 121));

    v_now := public.volunteer_org_now(v_owner);
    select * into v_spot from public.volunteer_season_spots(p_season_id) sp
     where sp.game_id = p_game_id and sp.role_id = p_role_id
       and sp.for_team_id is not distinct from p_for_team_id;
    select g.status into v_why from public.games g where g.id = p_game_id;
    v_why := public.volunteer_claim_refusal(v_why, v_spot.spot_start, v_now, v_spot.game_id is not null,
                                            v_spot.division_locked, true);
    v_start := v_spot.spot_start;
    v_end := v_spot.game_end;
    v_spots := v_spot.spots;
  end if;
  if v_why is not null then
    return jsonb_build_object('status', v_why);
  end if;

  select v.id into v_vol from public.volunteers v where v.owner_id = v_owner and v.email_lc = v_email;
  if v_vol is not null then
    if exists (select 1 from public.volunteer_claims c
                where c.volunteer_id = v_vol and c.status = 'active'
                  and (case when p_block_id is not null then c.snack_shack_block_id = p_block_id
                            else c.game_id = p_game_id and c.role_id = p_role_id
                                 and c.for_team_id is not distinct from p_for_team_id end)) then
      return jsonb_build_object('status', 'already_signed_up');
    end if;
    if not coalesce(p_confirm_overlap, false) and public.volunteer_overlaps(v_vol, v_start, v_end) then
      return jsonb_build_object('status', 'overlap_confirm_needed');
    end if;
  end if;

  select min(n) into v_pos
    from generate_series(1, v_spots) n
   where not exists (select 1 from public.volunteer_claims c
                      where c.status = 'active' and c.position = n
                        and (case when p_block_id is not null then c.snack_shack_block_id = p_block_id
                            else c.game_id = p_game_id and c.role_id = p_role_id
                                 and c.for_team_id is not distinct from p_for_team_id end));
  if v_pos is null then
    return jsonb_build_object('status', 'just_taken');
  end if;

  if v_vol is null then
    insert into public.volunteers (owner_id, email_lc, first_initial, last_name, adult_confirmed_at)
    values (v_owner, v_email, v_initial, v_last, now())
    returning id into v_vol;
  end if;

  begin
    insert into public.volunteer_claims (owner_id, season_id, volunteer_id, family_team_id, game_id,
                                         snack_shack_block_id, role_id, for_team_id, position, created_by)
    values (v_owner, p_season_id, v_vol, p_team_id, p_game_id, p_block_id, p_role_id,
            case when p_block_id is null then p_for_team_id end, v_pos, 'admin')
    returning id into v_claim;
  exception when unique_violation then
    return jsonb_build_object('status', 'just_taken');
  end;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.volunteer_manage_links (token_hash, volunteer_id, season_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_vol, p_season_id);
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload)
  values (v_owner, p_season_id, v_vol, 'admin_assigned',
          jsonb_build_object('claim_id', v_claim, 'manage_token', v_token));

  return jsonb_build_object('status', 'assigned', 'claim_id', v_claim, 'position', v_pos);
end;
$$;

create or replace function public.volunteer_set_no_show(p_claim_id uuid, p_no_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_season uuid;
  v_owner  uuid;
  v_start  timestamp;
begin
  select c.season_id into v_season from public.volunteer_claims c where c.id = p_claim_id;
  if v_season is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_owner := public.volunteer_admin_gate(v_season, false);
  -- 0122: a game spot or a shift.
  select coalesce(public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes),
                  b.date + b.start_time) into v_start
    from public.volunteer_claims c
    left join public.games g on g.id = c.game_id
    left join public.snack_shack_blocks b on b.id = c.snack_shack_block_id
    join public.volunteer_roles vr on vr.id = c.role_id
   where c.id = p_claim_id and c.status = 'active';
  if v_start is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_start::date >= public.volunteer_org_now(v_owner)::date then
    return jsonb_build_object('status', 'not_past');
  end if;
  update public.volunteer_claims set no_show = coalesce(p_no_show, false) where id = p_claim_id;
  return jsonb_build_object('status', 'saved');
end;
$$;

create or replace function public.volunteer_admin_remind(p_season_id uuid, p_claim_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner  uuid := public.volunteer_admin_gate(p_season_id, true);
  v_now    timestamp := public.volunteer_org_now(v_owner);
  v_asked  integer := coalesce(cardinality(p_claim_ids), 0);
  v_vol    record;
  v_token  text;
  v_queued integer := 0;
  v_covered integer := 0;
begin
  for v_vol in
    select c.volunteer_id, array_agg(c.id order by c.id) as claim_ids
      from public.volunteer_claims c
      left join public.games g on g.id = c.game_id
      left join public.snack_shack_blocks b on b.id = c.snack_shack_block_id  -- 0122: shifts too
      join public.volunteer_roles vr on vr.id = c.role_id
     where c.id = any (coalesce(p_claim_ids, '{}'::uuid[])) and c.season_id = p_season_id and c.status = 'active'
       and coalesce(public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes),
                    b.date + b.start_time) > v_now
     group by c.volunteer_id
  loop
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.volunteer_manage_links (token_hash, volunteer_id, season_id)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_vol.volunteer_id, p_season_id);
    update public.volunteer_outbox o set status = 'superseded', error = 'replaced by a newer reminder'
     where o.status = 'pending' and o.coalesce_key = 'remind:' || v_vol.volunteer_id;
    insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, coalesce_key)
    values (v_owner, p_season_id, v_vol.volunteer_id, 'reminder',
            jsonb_build_object('claim_ids', to_jsonb(v_vol.claim_ids), 'manage_token', v_token),
            'remind:' || v_vol.volunteer_id);
    update public.volunteer_claims set last_reminded_at = now() where id = any (v_vol.claim_ids);
    v_queued := v_queued + 1;
    v_covered := v_covered + cardinality(v_vol.claim_ids);
  end loop;
  return jsonb_build_object('queued', v_queued, 'reminded', v_covered, 'skipped', v_asked - v_covered);
end;
$$;

create or replace function public.volunteer_email_spots(p_claim_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(s.spot order by s.sort_at, s.claim_id), '[]'::jsonb)
    from (
      select c.id as claim_id,
             coalesce(g.scheduled_at, (b.date + b.start_time) at time zone 'UTC',
                      ((c.detached_from ->> 'start')::timestamp at time zone 'UTC')) as sort_at,
             jsonb_build_object(
               'claim_id', c.id,
               -- 0122: a snack shack shift — its times and its team, no game.
               'kind', case when b.id is not null or c.detached_from ->> 'kind' = 'shift' then 'shift' else 'game' end,
               'end', case when b.id is not null then to_char(b.date + b.end_time, 'YYYY-MM-DD"T"HH24:MI')
                           when c.detached_from ->> 'kind' = 'shift' then c.detached_from ->> 'end' end,
               'assigned_team_name', bt.name,
               'role_name', vr.name,
               'for_team_name', ft.name,
               'home_team_name', coalesce(ht.name, dht.name),
               'away_team_name', case when g.id is not null then coalesce(at.name, g.external_team_name) else dat.name end,
               'field', ve.name,
               'park', loc.name,
               'start', case
                          when b.id is not null then to_char(b.date + b.start_time, 'YYYY-MM-DD"T"HH24:MI')
                          when g.id is not null then to_char(public.volunteer_spot_start((g.scheduled_at at time zone 'UTC')::timestamp, vr.lead_minutes), 'YYYY-MM-DD"T"HH24:MI')
                          when c.detached_from ? 'start' then to_char(public.volunteer_spot_start((c.detached_from ->> 'start')::timestamp, coalesce(vr.lead_minutes, 0)), 'YYYY-MM-DD"T"HH24:MI')
                        end,
               'state', case when g.id is not null then public.volunteer_slot_state(g.status)
                             when b.id is not null then 'open' else 'gone' end,
               'was_start', case when c.moved_from ? 'start'
                                 then to_char(public.volunteer_spot_start((c.moved_from ->> 'start')::timestamp, coalesce(vr.lead_minutes, 0)), 'YYYY-MM-DD"T"HH24:MI') end,
               'was_field', (select wv.name from public.venues wv where wv.id = (c.moved_from ->> 'venue_id')::uuid)
             ) as spot
        from public.volunteer_claims c
        left join public.games g on g.id = c.game_id
        left join public.volunteer_roles vr on vr.id = coalesce(c.role_id, (c.detached_from ->> 'role_id')::uuid)
        left join public.teams ht on ht.id = g.home_team_id
        left join public.teams at on at.id = g.away_team_id
        left join public.teams ft on ft.id = c.for_team_id
        left join public.teams dht on dht.id = (c.detached_from ->> 'home_team_id')::uuid
        left join public.teams dat on dat.id = (c.detached_from ->> 'away_team_id')::uuid
        left join public.venues ve on ve.id = g.venue_id
        left join public.locations loc on loc.id = ve.location_id
        left join public.snack_shack_blocks b on b.id = c.snack_shack_block_id
        left join public.teams bt on bt.id = coalesce(b.assigned_team_id, (c.detached_from ->> 'assigned_team_id')::uuid)
       where c.id = any (coalesce(p_claim_ids, '{}'::uuid[]))
    ) s;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Shift triggers (SECURITY DEFINER: members edit shifts from the browser
--    and hold nothing on the volunteer tables)
-- ────────────────────────────────────────────────────────────────────────────
-- A deleted shift's sign-ups DETACH (before the foreign key nulls them),
-- remember what the shift was, and queue a spot_lost email held 10 minutes —
-- long enough for a regenerate's same-start shift to take them back. 0121's
-- game rule. A shift that has already started gets NO email (item 9) — its
-- sign-ups are still detached, as history. Not swallowed: if this fails the
-- delete fails, visibly.
create or replace function public.volunteer_on_shift_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ahead boolean;
begin
  v_ahead := old.date + old.start_time > public.volunteer_org_now(
    (select l.owner_id from public.snack_shack_settings s join public.leagues l on l.id = s.season_id
      where s.id = old.snack_shack_id));
  with d as (
    update public.volunteer_claims c
       set status = 'detached',
           detached_at = now(),
           detached_from = jsonb_build_object(
             'kind', 'shift', 'block_id', old.id, 'snack_shack_id', old.snack_shack_id,
             'start', to_char(old.date + old.start_time, 'YYYY-MM-DD"T"HH24:MI'),
             'end', to_char(old.date + old.end_time, 'YYYY-MM-DD"T"HH24:MI'),
             'assigned_team_id', old.assigned_team_id, 'role_id', c.role_id, 'position', c.position)
     where c.snack_shack_block_id = old.id and c.status = 'active'
    returning c.id, c.owner_id, c.season_id, c.volunteer_id
  )
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, coalesce_key, next_attempt_at)
  select d.owner_id, d.season_id, d.volunteer_id, 'spot_lost', jsonb_build_object('claim_id', d.id),
         'lost:' || d.id, now() + interval '10 minutes'
    from d
   where v_ahead;
  return old;
end;
$$;

create trigger volunteer_on_shift_delete
  before delete on public.snack_shack_blocks
  for each row
  execute function public.volunteer_on_shift_delete();

-- A new shift takes back sign-ups detached from this snack shack in the last
-- 10 minutes with the SAME date and start (regenerate's notes rule), each in
-- its own spot number when the new shift's headcount has room for it and the
-- spot is free. Reattached → its held spot_lost email is withdrawn. A failure
-- never blocks the insert and is recorded.
create or replace function public.volunteer_on_shift_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        record;
  v_season uuid;
  v_people integer;
  v_wall   text := to_char(new.date + new.start_time, 'YYYY-MM-DD"T"HH24:MI');
begin
  select s.season_id, public.volunteer_shift_people(new.people_needed, s.people_per_shift)
    into v_season, v_people
    from public.snack_shack_settings s where s.id = new.snack_shack_id;
  if not exists (select 1 from public.volunteer_claims c
                  where c.season_id = v_season and c.status = 'detached'
                    and c.detached_at > now() - interval '10 minutes'
                    and c.detached_from ->> 'kind' = 'shift') then
    return null;
  end if;

  for r in
    select c.* from public.volunteer_claims c
     where c.season_id = v_season and c.status = 'detached'
       and c.detached_at > now() - interval '10 minutes'
       and c.role_id is not null
       and c.detached_from ->> 'kind' = 'shift'
       and c.detached_from ->> 'snack_shack_id' = new.snack_shack_id::text
       and c.detached_from ->> 'start' = v_wall
     order by c.position, c.created_at, c.id
     for update of c
  loop
    if r.position <= v_people
       and not exists (select 1 from public.volunteer_claims x
                        where x.snack_shack_block_id = new.id and x.status = 'active' and x.position = r.position) then
      update public.volunteer_claims
         set status = 'active', snack_shack_block_id = new.id, detached_from = null, detached_at = null
       where id = r.id;
      update public.volunteer_outbox
         set status = 'superseded', error = 'reattached after a regenerate'
       where coalesce_key = 'lost:' || r.id and status = 'pending';
      -- Item 8: the shift came back with a different END — the spot is kept
      -- and the volunteer is told the new hours.
      if r.detached_from ->> 'end' is distinct from to_char(new.date + new.end_time, 'YYYY-MM-DD"T"HH24:MI') then
        insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, coalesce_key)
        values (r.owner_id, r.season_id, r.volunteer_id, 'shift_changed',
                jsonb_build_object('claim_id', r.id, 'was_end', r.detached_from ->> 'end'), 'changed:' || r.id);
      end if;
    end if;
  end loop;
  return null;
exception when others then
  perform public.volunteer_record_shift_failure(v_season, new.id, sqlstate);
  raise warning 'volunteer_on_shift_insert: % %', sqlstate, sqlerrm;
  return null;
end;
$$;

create trigger volunteer_on_shift_insert
  after insert on public.snack_shack_blocks
  for each row
  execute function public.volunteer_on_shift_insert();

-- A shift's own headcount went down: its spots above the new number are
-- canceled and each volunteer is emailed — on a shift still ahead only (a
-- past shift's sign-ups are history). Not swallowed: the edit and the
-- cancels are one change.
create or replace function public.volunteer_on_shift_headcount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_people integer;
  v_owner  uuid;
begin
  select public.volunteer_shift_people(new.people_needed, s.people_per_shift), l.owner_id
    into v_people, v_owner
    from public.snack_shack_settings s join public.leagues l on l.id = s.season_id
   where s.id = new.snack_shack_id;
  if new.date + new.start_time <= public.volunteer_org_now(v_owner) then
    return null;
  end if;
  perform public.volunteer_cancel_shift_spots(new.id, v_people);
  return null;
end;
$$;

create trigger volunteer_on_shift_headcount
  after update of people_needed on public.snack_shack_blocks
  for each row
  when (old.people_needed is distinct from new.people_needed)
  execute function public.volunteer_on_shift_headcount();

-- The season's people per shift went down: every shift still ahead without
-- its own number loses the spots above it, as above.
create or replace function public.volunteer_on_shack_headcount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b       record;
  v_owner uuid;
  v_now   timestamp;
begin
  select l.owner_id into v_owner from public.leagues l where l.id = new.season_id;
  v_now := public.volunteer_org_now(v_owner);
  for b in
    select x.id from public.snack_shack_blocks x
     where x.snack_shack_id = new.id and x.people_needed is null and x.date + x.start_time > v_now
  loop
    perform public.volunteer_cancel_shift_spots(b.id, public.volunteer_shift_people(null, new.people_per_shift));
  end loop;
  return null;
end;
$$;

create trigger volunteer_on_shack_headcount
  after update of people_per_shift on public.snack_shack_settings
  for each row
  when (old.people_per_shift is distinct from new.people_per_shift)
  execute function public.volunteer_on_shack_headcount();

-- Each shift's number of active sign-ups (members; counts, never names) —
-- for the snack shack regenerate preview: {block_id: count}.
create or replace function public.volunteer_shift_claim_counts(p_season_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select l.owner_id into v_owner from public.leagues l where l.id = p_season_id;
  if v_owner is null or not public.is_org_member(v_owner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(x.block_id, x.n)
      from (select c.snack_shack_block_id as block_id, count(*)::integer as n
              from public.volunteer_claims c
             where c.season_id = p_season_id and c.status = 'active' and c.snack_shack_block_id is not null
             group by c.snack_shack_block_id) x), '{}'::jsonb);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4b. Re-created from 0121 (verbatim + one edit each): the game delete skips
--     the email for a spot already started (item 9); the take attaches a
--     fresh manage link to shift_changed too (item 8)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.volunteer_on_game_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with d as (
    update public.volunteer_claims c
       set status = 'detached',
           detached_at = now(),
           detached_from = jsonb_build_object(
             'game_id', old.id,
             'start', to_char((old.scheduled_at at time zone 'UTC')::timestamp, 'YYYY-MM-DD"T"HH24:MI'),
             'home_team_id', old.home_team_id, 'away_team_id', old.away_team_id,
             'for_team_id', c.for_team_id, 'role_id', c.role_id, 'position', c.position)
     where c.game_id = old.id and c.status = 'active'
    returning c.id, c.owner_id, c.season_id, c.volunteer_id, c.role_id
  )
  insert into public.volunteer_outbox (owner_id, season_id, volunteer_id, kind, payload, coalesce_key, next_attempt_at)
  select d.owner_id, d.season_id, d.volunteer_id, 'spot_lost', jsonb_build_object('claim_id', d.id),
         'lost:' || d.id, now() + interval '10 minutes'
    from d
   -- 0122 (item 9): no email for a spot that has already started.
   where public.volunteer_spot_start((old.scheduled_at at time zone 'UTC')::timestamp,
                                     (select vr.lead_minutes from public.volunteer_roles vr where vr.id = d.role_id))
         > public.volunteer_org_now(d.owner_id);
  return old;
end;
$$;

create or replace function public.volunteer_outbox_take(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 100);
  v_rows  jsonb;
  v_out   jsonb := '[]'::jsonb;
  r       jsonb;
  v_ids   uuid[];
  v_token text;
begin
  -- a. Rate-limit keys older than 23 hours go (privacy policy: up to 24h).
  delete from public.volunteer_rate_events where at < now() - interval '23 hours';

  -- b. A drain that died mid-send leaves rows `sending`; after 10 minutes
  --    they are due again. The send carries an idempotency key per row, so a
  --    row that did go out is not sent twice by the provider.
  update public.volunteer_outbox
     set status = 'pending', locked_at = null
   where status = 'sending' and locked_at < now() - interval '10 minutes';

  -- c. One email per coalesce key: every pending row older than the newest
  --    pending row with the same key is superseded.
  update public.volunteer_outbox o
     set status = 'superseded', error = 'superseded by a newer change'
   where o.status = 'pending'
     and o.coalesce_key is not null
     and exists (select 1 from public.volunteer_outbox n
                  where n.coalesce_key = o.coalesce_key
                    and n.status = 'pending'
                    and (n.created_at, n.id) > (o.created_at, o.id));

  -- d. Rows that must not be sent are failed, visibly, never silently kept.
  update public.volunteer_outbox o
     set status = 'failed', error = 'feature_off'
   where o.status = 'pending'
     and not public.org_feature_on(o.owner_id, 'volunteers');
  update public.volunteer_outbox o
     set status = 'failed', error = 'no_contact_email'
   where o.status = 'pending'
     and not exists (select 1 from public.volunteer_settings s
                      where s.owner_id = o.owner_id and s.contact_email is not null);

  -- e. Claim the due rows. SKIP LOCKED: a second drain running at the same
  --    time takes different rows or none.
  with due as (
    select o.id
      from public.volunteer_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.next_attempt_at, o.id
     limit v_limit
       for update skip locked
  ), took as (
    update public.volunteer_outbox o
       set status = 'sending', locked_at = now(), attempts = o.attempts + 1
      from due
     where o.id = due.id
    returning o.id, o.owner_id, o.season_id, o.volunteer_id, o.kind, o.payload, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'kind', t.kind,
           'payload', t.payload,
           'attempts', t.attempts,
           'season_id', t.season_id,
           'volunteer_id', t.volunteer_id,
           'to', v.email_lc,
           'league_name', p.org_name,
           'reply_to', s.contact_email,
           'signup_token', case when s.link_enabled then s.link_token end
         ) order by t.id), '[]'::jsonb)
    into v_rows
    from took t
    join public.volunteers v on v.id = t.volunteer_id
    join public.profiles p on p.id = t.owner_id
    left join public.volunteer_settings s on s.owner_id = t.owner_id;

  -- f. Each row's spots, and a fresh manage link where the email needs one.
  for r in select * from jsonb_array_elements(v_rows) loop
    v_ids := case
               when jsonb_typeof(r -> 'payload' -> 'claim_ids') = 'array'
                 then array(select x::uuid from jsonb_array_elements_text(r -> 'payload' -> 'claim_ids') x)
               when r -> 'payload' ? 'claim_id' then array[(r -> 'payload' ->> 'claim_id')::uuid]
               else '{}'::uuid[]
             end;
    v_token := null;
    if r ->> 'kind' in ('game_moved', 'rained_out', 'makeup_set', 'back_on', 'shift_changed') then  -- 0122: + shift_changed
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      insert into public.volunteer_manage_links (token_hash, volunteer_id, season_id)
      values (encode(extensions.digest(v_token, 'sha256'), 'hex'), (r ->> 'volunteer_id')::uuid, (r ->> 'season_id')::uuid);
    end if;
    v_out := v_out || jsonb_build_array(
      (r - 'volunteer_id')
      || jsonb_build_object('spots', public.volunteer_email_spots(v_ids),
                            'manage_token', coalesce(v_token, r -> 'payload' ->> 'manage_token')));
  end loop;

  return v_out;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. regenerate_snack_shack_shifts — re-created VERBATIM from 0119 plus the
--    sign-ups count. Returns 0119's keys plus claims_carried / claims_lost.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.regenerate_snack_shack_shifts(
  p_snack_shack_id uuid,
  p_shifts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.snack_shack_settings%rowtype;
  v_league   public.leagues%rowtype;
  v_elem     jsonb;
  v_i        integer := 0;
  v_date     text;
  v_start    text;
  v_end      text;
  v_team     text;
  v_n        integer;
  v_distinct integer;
  v_kept     integer;
  v_created  integer;
  v_removed  integer;
  v_carried  integer;
  v_removed_assignments jsonb;
  v_created_shifts      jsonb;
  v_carry    jsonb;
  v_lost     jsonb;
  v_claims   uuid[];
  v_claims_carried integer;
  v_claims_lost    integer;
begin
  if p_shifts is null or jsonb_typeof(p_shifts) <> 'array' then
    raise exception 'shifts_not_array' using errcode = 'P0001';
  end if;

  select * into v_settings
  from public.snack_shack_settings
  where id = p_snack_shack_id
  for update;

  if not found then
    raise exception 'snack_shack_not_found' using errcode = 'P0001';
  end if;

  select * into v_league
  from public.leagues
  where id = v_settings.season_id;

  if not found then
    raise exception 'league_not_found' using errcode = 'P0001';
  end if;
  if not public.is_org_member(v_league.owner_id) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  -- ── Validate everything before writing anything ───────────────────────────
  for v_elem in select * from jsonb_array_elements(p_shifts) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'shift_%_not_object', v_i using errcode = 'P0001';
    end if;
    v_date  := v_elem ->> 'date';
    v_start := v_elem ->> 'start';
    v_end   := v_elem ->> 'end';
    v_team  := nullif(v_elem ->> 'assigned_team_id', '');
    if v_date is null or v_date !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'shift_%_bad_date', v_i using errcode = 'P0001';
    end if;
    if v_start is null or v_start !~ '^\d{2}:\d{2}(:\d{2})?$' then
      raise exception 'shift_%_bad_start', v_i using errcode = 'P0001';
    end if;
    if v_end is null or v_end !~ '^\d{2}:\d{2}(:\d{2})?$' then
      raise exception 'shift_%_bad_end', v_i using errcode = 'P0001';
    end if;
    if v_end::time <= v_start::time then
      raise exception 'shift_%_end_not_after_start', v_i using errcode = 'P0001';
    end if;
    if v_team is not null then
      if v_team !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'shift_%_bad_team', v_i using errcode = 'P0001';
      end if;
      -- The FK only says "a team exists"; the team must be THIS season's.
      if not exists (select 1 from public.teams t where t.id = v_team::uuid and t.league_id = v_settings.season_id) then
        raise exception 'shift_%_team_not_in_season', v_i using errcode = 'P0001';
      end if;
    end if;
  end loop;

  select count(*),
         count(distinct (e ->> 'date') || '|' || (e ->> 'start')::time::text || '|' || (e ->> 'end')::time::text)
    into v_n, v_distinct
  from jsonb_array_elements(p_shifts) e;
  if v_n <> v_distinct then
    raise exception 'duplicate_shift' using errcode = 'P0001';
  end if;

  -- ── 0104: capture what the doomed rows carry, BEFORE the delete ───────────
  -- A row about to be removed may hold a note (with its attribution) and a
  -- cash person — and, since 0119, a headcount of its own. The INSERT below
  -- copies them onto the new row with the SAME
  -- date and start — in the INSERT, so the BEFORE UPDATE attribution trigger
  -- does not re-stamp the regenerating admin as the author. Doomed rows with
  -- no same-start replacement are reported in `lost`.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', b.date, 'start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'),
           'notes', b.notes, 'notes_updated_at', b.notes_updated_at, 'notes_updated_by', b.notes_updated_by,
           'cash_person_id', b.cash_person_id, 'people_needed', b.people_needed)
           order by b.date, b.start_time, b.end_time), '[]'::jsonb)
    into v_carry
  from public.snack_shack_blocks b
  where b.snack_shack_id = p_snack_shack_id
    and b.is_recurring
    and (b.notes is not null or b.cash_person_id is not null or b.people_needed is not null)
    and not exists (
      select 1 from jsonb_array_elements(p_shifts) e
      where (e ->> 'date')::date  = b.date
        and (e ->> 'start')::time = b.start_time
        and (e ->> 'end')::time   = b.end_time
    );

  -- ── 0122: the sign-ups on the doomed rows, BEFORE the delete ─────────────
  -- The delete trigger detaches them; the insert trigger takes back each one
  -- whose shift comes back with the same date and start and a spot for its
  -- number. Whatever is still detached at the end is lost (its volunteer is
  -- emailed, held 10 minutes).
  select coalesce(array_agg(c.id), '{}') into v_claims
    from public.volunteer_claims c
    join public.snack_shack_blocks b on b.id = c.snack_shack_block_id
   where b.snack_shack_id = p_snack_shack_id
     and b.is_recurring
     and c.status = 'active'
     and not exists (
       select 1 from jsonb_array_elements(p_shifts) e
       where (e ->> 'date')::date  = b.date
         and (e ->> 'start')::time = b.start_time
         and (e ->> 'end')::time   = b.end_time
     );

  -- ── Remove derived rows that are no longer derived ────────────────────────
  -- Manual rows are excluded by is_recurring; the desired set is matched on
  -- date + start + end (all three — a changed end is a different shift).
  with gone as (
    delete from public.snack_shack_blocks b
    where b.snack_shack_id = p_snack_shack_id
      and b.is_recurring
      and not exists (
        select 1 from jsonb_array_elements(p_shifts) e
        where (e ->> 'date')::date  = b.date
          and (e ->> 'start')::time = b.start_time
          and (e ->> 'end')::time   = b.end_time
      )
    returning b.date, b.start_time, b.end_time, b.assigned_team_id
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'date', g.date, 'start', to_char(g.start_time, 'HH24:MI'), 'end', to_char(g.end_time, 'HH24:MI'),
           'team_id', g.assigned_team_id) order by g.date, g.start_time)
           filter (where g.assigned_team_id is not null), '[]'::jsonb)
    into v_removed, v_removed_assignments
  from gone g;

  -- Kept rows are never updated: what survived the delete IS the kept set,
  -- assignment, note, cash person and headcount and all. (kept rows are never updated)
  select count(*) into v_kept
  from public.snack_shack_blocks b
  where b.snack_shack_id = p_snack_shack_id
    and b.is_recurring;

  -- ── Insert the desired slots that have no derived row ─────────────────────
  -- The NOT EXISTS sees the table as of statement start, so the rows this
  -- statement inserts never match themselves; duplicates within p_shifts
  -- were refused above. 0104/0119: the five carried columns come from the capture
  -- above, matched on date + start (the earliest-ending doomed row wins if
  -- two shared a start).
  with ins as (
    insert into public.snack_shack_blocks
      (snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring,
       notes, notes_updated_at, notes_updated_by, cash_person_id, people_needed)
    select p_snack_shack_id,
           (e ->> 'date')::date,
           (e ->> 'start')::time,
           (e ->> 'end')::time,
           nullif(e ->> 'assigned_team_id', '')::uuid,
           true,
           c.notes, c.notes_updated_at, c.notes_updated_by, c.cash_person_id, c.people_needed
    from jsonb_array_elements(p_shifts) e
    left join lateral (
      select (x ->> 'notes')                           as notes,
             (x ->> 'notes_updated_at')::timestamptz   as notes_updated_at,
             (x ->> 'notes_updated_by')::uuid          as notes_updated_by,
             (x ->> 'cash_person_id')::uuid            as cash_person_id,
             (x ->> 'people_needed')::smallint         as people_needed
      from jsonb_array_elements(v_carry) x
      where (x ->> 'date')::date  = (e ->> 'date')::date
        and (x ->> 'start')::time = (e ->> 'start')::time
      order by (x ->> 'end')::time
      limit 1
    ) c on true
    where not exists (
      select 1 from public.snack_shack_blocks b
      where b.snack_shack_id = p_snack_shack_id
        and b.is_recurring
        and b.date       = (e ->> 'date')::date
        and b.start_time = (e ->> 'start')::time
        and b.end_time   = (e ->> 'end')::time
    )
    returning date, start_time, end_time, assigned_team_id,
              (notes is not null or cash_person_id is not null or people_needed is not null) as carried
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'date', i.date, 'start', to_char(i.start_time, 'HH24:MI'), 'end', to_char(i.end_time, 'HH24:MI'),
           'team_id', i.assigned_team_id) order by i.date, i.start_time), '[]'::jsonb),
         count(*) filter (where i.carried)
    into v_created, v_created_shifts, v_carried
  from ins i;

  -- ── 0104: what could not be carried ───────────────────────────────────────
  select coalesce(jsonb_agg((x - 'notes_updated_at' - 'notes_updated_by')
           order by x ->> 'date', x ->> 'start'), '[]'::jsonb)
    into v_lost
  from jsonb_array_elements(v_carry) x
  where not exists (
    select 1 from jsonb_array_elements(v_created_shifts) i
    where i ->> 'date' = x ->> 'date' and i ->> 'start' = x ->> 'start'
  );

  -- 0122: where those sign-ups ended up.
  select count(*) filter (where c.status = 'active'), count(*) filter (where c.status = 'detached')
    into v_claims_carried, v_claims_lost
    from public.volunteer_claims c
   where c.id = any (v_claims);

  update public.snack_shack_settings
     set shifts_generated_at = now(),
         updated_at          = now()
   where id = p_snack_shack_id;

  return jsonb_build_object(
    'kept',                v_kept,
    'created',             v_created,
    'removed',             v_removed,
    'removed_assignments', v_removed_assignments,
    'created_shifts',      v_created_shifts,
    'carried',             v_carried,
    'lost',                v_lost,
    'claims_carried',      v_claims_carried,
    'claims_lost',         v_claims_lost
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Function privileges (revoke from PUBLIC and every role, grant back)
-- ────────────────────────────────────────────────────────────────────────────
revoke execute on function public.volunteer_shift_people(integer, integer) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_season_shifts(uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_overlaps(uuid, timestamp, timestamp) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_record_shift_failure(uuid, uuid, text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_cancel_shift_spots(uuid, integer) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_email_spots(uuid[]) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_on_shift_delete() from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_on_shift_insert() from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_on_shift_headcount() from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_on_shack_headcount() from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_on_game_delete() from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_admin_signups(uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_admin_assign(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_set_no_show(uuid, boolean) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_admin_remind(uuid, uuid[]) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_shift_claim_counts(uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.regenerate_snack_shack_shifts(uuid, jsonb) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_signup_page(text, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_manage_page(text) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_cancel(text, uuid) from public, anon, authenticated, service_role, dashboard_readonly;
revoke execute on function public.volunteer_outbox_take(integer) from public, anon, authenticated, service_role, dashboard_readonly;

grant execute on function public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean) to authenticated;
grant execute on function public.volunteer_admin_signups(uuid) to authenticated;
grant execute on function public.volunteer_admin_assign(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, boolean, uuid) to authenticated;
grant execute on function public.volunteer_set_no_show(uuid, boolean) to authenticated;
grant execute on function public.volunteer_admin_remind(uuid, uuid[]) to authenticated;
grant execute on function public.volunteer_shift_claim_counts(uuid) to authenticated;
grant execute on function public.regenerate_snack_shack_shifts(uuid, jsonb) to authenticated;
grant execute on function public.volunteer_signup_page(text, uuid) to service_role;
grant execute on function public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean, uuid) to service_role;
grant execute on function public.volunteer_manage_page(text) to service_role;
grant execute on function public.volunteer_cancel(text, uuid) to service_role;
grant execute on function public.volunteer_outbox_take(integer) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Verify — RAISES if anything is not as stated
-- ────────────────────────────────────────────────────────────────────────────
do $v$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.save_volunteer_role(uuid, uuid, text, text, integer, integer, boolean, boolean, uuid[], boolean)',
    'public.volunteer_admin_signups(uuid)',
    'public.volunteer_admin_assign(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, boolean, uuid)',
    'public.volunteer_set_no_show(uuid, boolean)',
    'public.volunteer_admin_remind(uuid, uuid[])',
    'public.volunteer_shift_claim_counts(uuid)',
    'public.regenerate_snack_shack_shifts(uuid, jsonb)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0122 verify: authenticated cannot execute %', f;
    end if;
    foreach r in array array['anon', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0122 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.volunteer_signup_page(text, uuid)',
    'public.volunteer_claim(text, uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, text, text, boolean, uuid)',
    'public.volunteer_manage_page(text)',
    'public.volunteer_cancel(text, uuid)',
    'public.volunteer_outbox_take(integer)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0122 verify: service_role cannot execute %', f;
    end if;
    foreach r in array array['anon', 'authenticated', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0122 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  foreach f in array array[
    'public.volunteer_shift_people(integer, integer)',
    'public.volunteer_season_shifts(uuid)',
    'public.volunteer_overlaps(uuid, timestamp, timestamp)',
    'public.volunteer_record_shift_failure(uuid, uuid, text)',
    'public.volunteer_cancel_shift_spots(uuid, integer)',
    'public.volunteer_email_spots(uuid[])',
    'public.volunteer_on_shift_delete()',
    'public.volunteer_on_shift_insert()',
    'public.volunteer_on_shift_headcount()',
    'public.volunteer_on_shack_headcount()',
    'public.volunteer_on_game_delete()'] loop
    foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception '0122 verify: % can execute %', r, f;
      end if;
    end loop;
  end loop;

  -- One overload each of the two functions whose signature changed.
  if (select count(*) from pg_proc where proname = 'volunteer_claim' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = 'volunteer_admin_assign' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0122 verify: volunteer_claim / volunteer_admin_assign must have exactly one overload';
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.volunteer_on_shift_delete()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.volunteer_on_shift_insert()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.volunteer_on_shift_headcount()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.volunteer_on_shack_headcount()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.volunteer_on_game_delete()'::regprocedure) then
    raise exception '0122 verify: a shift trigger function is not SECURITY DEFINER';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.snack_shack_blocks'::regclass and tgenabled = 'O'
        and tgname in ('volunteer_on_shift_delete', 'volunteer_on_shift_insert', 'volunteer_on_shift_headcount')) <> 3
     or (select count(*) from pg_trigger where tgrelid = 'public.snack_shack_settings'::regclass and tgenabled = 'O'
        and tgname = 'volunteer_on_shack_headcount') <> 1 then
    raise exception '0122 verify: a shift trigger is missing or disabled';
  end if;

  foreach r in array array['anon', 'authenticated', 'service_role', 'dashboard_readonly'] loop
    if has_table_privilege(r, 'public.volunteer_claims', 'SELECT') then
      raise exception '0122 verify: % can read volunteer_claims', r;
    end if;
  end loop;
end
$v$;
