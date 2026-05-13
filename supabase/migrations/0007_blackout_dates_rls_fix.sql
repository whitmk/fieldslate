-- Drop the original catch-all policy that lacked an explicit WITH CHECK clause,
-- which caused INSERT/UPDATE to be rejected under strict RLS enforcement.
drop policy if exists "League owners can manage blackout dates" on public.blackout_dates;

-- Owners can read blackout dates for their leagues.
create policy "blackout_dates: select for owner"
  on public.blackout_dates
  for select
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = blackout_dates.league_id
        and leagues.owner_id = auth.uid()
    )
  );

-- Owners can insert new blackout dates into their leagues.
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

-- Owners can update blackout dates in their leagues.
create policy "blackout_dates: update for owner"
  on public.blackout_dates
  for update
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = blackout_dates.league_id
        and leagues.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id = blackout_dates.league_id
        and leagues.owner_id = auth.uid()
    )
  );

-- Owners can delete blackout dates from their leagues.
create policy "blackout_dates: delete for owner"
  on public.blackout_dates
  for delete
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = blackout_dates.league_id
        and leagues.owner_id = auth.uid()
    )
  );
