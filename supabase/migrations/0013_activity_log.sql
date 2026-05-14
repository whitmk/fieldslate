create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues(id) on delete cascade,
  division_id uuid references public.divisions(id) on delete set null,
  event_type  text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);

create index activity_log_league_id_created_at_idx
  on public.activity_log (league_id, created_at desc);

alter table public.activity_log enable row level security;

-- Owners can read their league's log entries
create policy "league owners can read activity log"
  on public.activity_log for select
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = activity_log.league_id
        and leagues.owner_id = auth.uid()
    )
  );

-- Owners can insert log entries
create policy "league owners can insert activity log"
  on public.activity_log for insert
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id = activity_log.league_id
        and leagues.owner_id = auth.uid()
    )
  );
