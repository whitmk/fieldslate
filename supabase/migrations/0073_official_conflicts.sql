-- Conflicts of interest for officials: non-coach relationships (parent,
-- sibling, other family) linking an official to a team whose games they
-- shouldn't work. Additive to umpires.team_id (0063), which stays the coach
-- link and keeps driving coach-conflict behavior unchanged. One row per
-- official-team pair; `relationship` says why. Behavior mirrors the coach
-- conflict: manual assignment warns with override, auto-assign hard-blocks.
--
-- NOT related to conflict_overrides (0064) — that is the game-scheduling
-- override audit trail (venue/team double-book reasons). Same naming-trap
-- class as blackout_dates vs official_blackouts.
--
-- RLS mirrors the 0062 officials tables: one org-member FOR ALL policy via
-- umpires -> leagues -> is_org_member(owner_id). Authenticated-client path —
-- standard authenticated grant, no service_role involvement.

create table public.official_conflicts (
  id uuid primary key default gen_random_uuid(),
  umpire_id uuid not null references public.umpires(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  relationship text not null check (relationship in ('parent','sibling','family','other')),
  note text,
  created_at timestamptz not null default now(),
  unique(umpire_id, team_id)
);

-- The unique index covers umpire_id-prefixed lookups; team_id needs its own.
create index official_conflicts_team_id_idx on public.official_conflicts(team_id);

alter table public.official_conflicts enable row level security;

create policy "Org members can manage official_conflicts"
  on public.official_conflicts for all
  using (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_conflicts.umpire_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.umpires u
      join public.leagues l on l.id = u.season_id
      where u.id = official_conflicts.umpire_id
        and public.is_org_member(l.owner_id)
    )
  );

grant all on public.official_conflicts to authenticated;
