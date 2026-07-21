-- Team-level GAME scheduling constraints: recurring (day-of-week, time-window)
-- rules with two severities.
--
--   severity 'block'  — hard: the schedule generator must never place a game
--                       for this team inside the window on its own; manual
--                       write paths get warn-with-override (later change).
--   severity 'prefer' — soft: best-effort preference. Stored from day one so
--                       the schema doesn't churn, but NOT yet enforced — the
--                       generator ignores 'prefer' rows until the preferences
--                       chunk lands.
--
-- DELIBERATE SIBLING of team_availability_blocks (0042), which is the same
-- shape for PRACTICES. The duplication is a settled product decision, not an
-- oversight: practices and games are decoupled surfaces (see 0040's header),
-- and a scope column on the practices table would couple the practice
-- auto-assign engine to game semantics. Day codes (2-char Mo..Su), the
-- time-window shape, and the whole-day convention (both times null) match
-- 0042 exactly; windows are half-open [start, end) like a calendar event.
--
-- Consumed by the client-side schedule generator
-- (src/lib/schedule/generate-schedule.ts) via the shared pure helpers in
-- src/lib/schedule/team-constraints.ts. Elite gating is UI-only (the entry
-- UI, in a later commit): the generator honors whatever rows exist
-- tier-blind, so constraints stay live if a league downgrades — deliberate,
-- matching the officials-pages precedent.

create table public.team_game_constraints (
  id          uuid        primary key default gen_random_uuid(),
  team_id     uuid        not null references public.teams(id) on delete cascade,
  day_of_week text        not null
    check (day_of_week in ('Mo','Tu','We','Th','Fr','Sa','Su')),
  -- Null start_time + null end_time = the whole day. Otherwise both must be
  -- set, with end strictly after start.
  start_time  time,
  end_time    time,
  severity    text        not null
    check (severity in ('block','prefer')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint team_game_constraints_time_shape check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index team_game_constraints_team_idx
  on public.team_game_constraints (team_id, day_of_week);

alter table public.team_game_constraints enable row level security;

-- RLS follows the current 0049 multi-admin form (is_org_member via
-- teams -> leagues), NOT 0042's original owner-only form (0049 rewrote that
-- table's policy to this same shape).
create policy "Org members can manage team_game_constraints"
  on public.team_game_constraints for all
  using (
    exists (
      select 1 from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = team_game_constraints.team_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = team_game_constraints.team_id
        and public.is_org_member(l.owner_id)
    )
  );

-- Authenticated browser clients are the only consumers (the constraint-entry
-- UI and the client-side generator both run under the user's session). No
-- service_role grant: no server route or admin client touches this table,
-- and this project's Postgres grants service_role nothing on new tables
-- (see 0072's note) — add an explicit grant only if a server-side consumer
-- ever appears.
grant select, insert, update, delete on public.team_game_constraints to authenticated;

create trigger team_game_constraints_set_updated_at
  before update on public.team_game_constraints
  for each row execute function public.set_updated_at();
