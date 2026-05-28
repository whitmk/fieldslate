-- Cleanup of leftover split owner-check policies on leagues, venues, teams,
-- and games. These appear to have been created out of band (likely via the
-- Supabase dashboard) and were not captured in any prior migration file, so
-- migration 0049 didn't know to drop them. Behavior was correct because RLS
-- unions permissive policies, but they would have left owner-only gates on
-- INSERT/UPDATE/DELETE that Chunk B admins should also pass.
--
-- `drop policy if exists` makes this a no-op for any environment that didn't
-- have the out-of-band policies in the first place.

drop policy if exists "Owners can select own leagues" on public.leagues;
drop policy if exists "Owners can insert own leagues" on public.leagues;
drop policy if exists "Owners can update own leagues" on public.leagues;
drop policy if exists "Owners can delete own leagues" on public.leagues;

drop policy if exists "Owners can select own venues"  on public.venues;
drop policy if exists "Owners can insert own venues"  on public.venues;
drop policy if exists "Owners can update own venues"  on public.venues;
drop policy if exists "Owners can delete own venues"  on public.venues;

drop policy if exists "League owners can select teams" on public.teams;
drop policy if exists "League owners can insert teams" on public.teams;
drop policy if exists "League owners can update teams" on public.teams;
drop policy if exists "League owners can delete teams" on public.teams;

drop policy if exists "League owners can select games" on public.games;
drop policy if exists "League owners can insert games" on public.games;
drop policy if exists "League owners can update games" on public.games;
drop policy if exists "League owners can delete games" on public.games;
