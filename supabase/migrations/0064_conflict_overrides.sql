-- Conflict overrides: required-reason audit trail for admin overrides of
-- schedule conflicts (venue double-book, venue hours, team double-book).
-- Written by the Add Game modal and the conflict resolver's manual move;
-- surfaced read-only in the game detail modal's "Conflict history" section.
-- Deliberately separate from games.notes (free-form commissioner notes).
--
-- NOTE: games has no division_id column — membership resolves through
-- games.league_id -> leagues.owner_id, the same path toggle_assignment_paid
-- (0062) uses.

create table public.conflict_overrides (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  overridden_by uuid not null references public.profiles(id),
  conflict_type text not null check (
    conflict_type in ('venue_double_book', 'venue_hours', 'team_double_book')
  ),
  reason text not null check (length(reason) > 0 and length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index conflict_overrides_game_id_idx on public.conflict_overrides(game_id);

alter table public.conflict_overrides enable row level security;

create policy "Org members can read conflict overrides"
  on public.conflict_overrides for select
  using (
    exists (
      select 1 from public.games g
      join public.leagues l on l.id = g.league_id
      where g.id = conflict_overrides.game_id
        and public.is_org_member(l.owner_id)
    )
  );

create policy "Org members can insert conflict overrides"
  on public.conflict_overrides for insert
  with check (
    exists (
      select 1 from public.games g
      join public.leagues l on l.id = g.league_id
      where g.id = conflict_overrides.game_id
        and public.is_org_member(l.owner_id)
    )
  );

-- Select + insert only: override rows are an immutable audit trail (no
-- update/delete policies, and the grant doesn't extend that far either).
grant select, insert on public.conflict_overrides to authenticated;
