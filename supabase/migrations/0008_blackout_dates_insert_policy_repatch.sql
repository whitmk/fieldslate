-- Repatch: drop and recreate the INSERT policy to ensure it was applied cleanly.
drop policy if exists "blackout_dates: insert for owner" on public.blackout_dates;

create policy "blackout_dates: insert for owner"
  on public.blackout_dates
  for insert
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id = blackout_dates.league_id
        and leagues.owner_id = auth.uid()
    )
  );
