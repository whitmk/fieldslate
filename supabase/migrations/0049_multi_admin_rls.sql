-- Multi-admin RLS rewrite (Chunk A of 2, part 2).
--
-- Replaces every owner-check policy across the schema with the membership
-- predicate is_org_member() (defined in migration 0048). After this runs,
-- access is gated by "is the calling user a member of this resource's
-- organization?" instead of "is the calling user the resource's owner?".
--
-- Today every user belongs to exactly one org (their own), so behavior is
-- identical to before. Chunk B introduces invitations that put additional
-- users in existing orgs as role='admin' -- which this policy structure
-- already handles without further changes.
--
-- For each table we DROP every prior owner-check policy by name, then
-- CREATE a single consolidated FOR ALL policy. The consolidation is safe
-- because owner and admin have identical access in this chunk; if Chunk B
-- ever introduces role-gated commands (e.g. only owners may delete), we
-- split the FOR ALL into separate policies at that point.

-- ────────────────────────────────────────────────────────────────────────────
-- Direct owner_id tables
-- ────────────────────────────────────────────────────────────────────────────

-- leagues
drop policy if exists "Owners can manage own leagues" on public.leagues;
create policy "Org members can manage leagues"
  on public.leagues for all
  using      (public.is_org_member(owner_id))
  with check (public.is_org_member(owner_id));

-- venues
drop policy if exists "Owners can manage own venues" on public.venues;
create policy "Org members can manage venues"
  on public.venues for all
  using      (public.is_org_member(owner_id))
  with check (public.is_org_member(owner_id));

-- interleague_orgs
drop policy if exists "Users can select their own interleague orgs" on public.interleague_orgs;
drop policy if exists "Users can insert their own interleague orgs" on public.interleague_orgs;
drop policy if exists "Users can update their own interleague orgs" on public.interleague_orgs;
drop policy if exists "Users can delete their own interleague orgs" on public.interleague_orgs;
create policy "Org members can manage interleague orgs"
  on public.interleague_orgs for all
  using      (public.is_org_member(owner_id))
  with check (public.is_org_member(owner_id));

-- ────────────────────────────────────────────────────────────────────────────
-- League-scoped tables (gate via leagues.owner_id through league_id)
-- ────────────────────────────────────────────────────────────────────────────

-- teams
drop policy if exists "League owners can manage teams" on public.teams;
create policy "Org members can manage teams"
  on public.teams for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = teams.league_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = teams.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- games
drop policy if exists "League owners can manage games" on public.games;
create policy "Org members can manage games"
  on public.games for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = games.league_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = games.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- divisions
drop policy if exists "League owners can manage divisions" on public.divisions;
create policy "Org members can manage divisions"
  on public.divisions for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = divisions.league_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = divisions.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- blackout_dates (originally one policy in 0005, split into 4 in 0007, INSERT repatched in 0008)
drop policy if exists "League owners can manage blackout dates" on public.blackout_dates;
drop policy if exists "blackout_dates: select for owner"        on public.blackout_dates;
drop policy if exists "blackout_dates: insert for owner"        on public.blackout_dates;
drop policy if exists "blackout_dates: update for owner"        on public.blackout_dates;
drop policy if exists "blackout_dates: delete for owner"        on public.blackout_dates;
create policy "Org members can manage blackout dates"
  on public.blackout_dates for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = blackout_dates.league_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = blackout_dates.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- activity_log (read + insert only; no UPDATE/DELETE policies exist)
drop policy if exists "league owners can read activity log"   on public.activity_log;
drop policy if exists "league owners can insert activity log" on public.activity_log;
create policy "Org members can read activity log"
  on public.activity_log for select
  using (
    exists (
      select 1 from public.leagues l
      where l.id = activity_log.league_id
        and public.is_org_member(l.owner_id)
    )
  );
create policy "Org members can insert activity log"
  on public.activity_log for insert
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = activity_log.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- practices_legacy (renamed from practices in 0040; policies preserved during rename)
drop policy if exists "League members can read practices"   on public.practices_legacy;
drop policy if exists "League members can insert practices" on public.practices_legacy;
drop policy if exists "League members can update practices" on public.practices_legacy;
drop policy if exists "League members can delete practices" on public.practices_legacy;
create policy "Org members can manage practices_legacy"
  on public.practices_legacy for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = practices_legacy.league_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = practices_legacy.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- playoffs
drop policy if exists "League owners manage playoffs" on public.playoffs;
create policy "Org members can manage playoffs"
  on public.playoffs for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = playoffs.league_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = playoffs.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- playoff_games
drop policy if exists "owners manage playoff_games" on public.playoff_games;
create policy "Org members can manage playoff_games"
  on public.playoff_games for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = playoff_games.league_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = playoff_games.league_id
        and public.is_org_member(l.owner_id)
    )
  );

-- interleague_reschedule_requests (gates via games -> leagues)
drop policy if exists "League owners manage reschedule requests" on public.interleague_reschedule_requests;
create policy "Org members can manage reschedule requests"
  on public.interleague_reschedule_requests for all
  using (
    exists (
      select 1 from public.games g
      join public.leagues l on l.id = g.league_id
      where g.id = interleague_reschedule_requests.game_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.games g
      join public.leagues l on l.id = g.league_id
      where g.id = interleague_reschedule_requests.game_id
        and public.is_org_member(l.owner_id)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Season-scoped tables (season_id references leagues; same shape as league_id)
-- ────────────────────────────────────────────────────────────────────────────

-- umpires
drop policy if exists "Season owners can read umpires"   on public.umpires;
drop policy if exists "Season owners can insert umpires" on public.umpires;
drop policy if exists "Season owners can update umpires" on public.umpires;
drop policy if exists "Season owners can delete umpires" on public.umpires;
create policy "Org members can manage umpires"
  on public.umpires for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = umpires.season_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = umpires.season_id
        and public.is_org_member(l.owner_id)
    )
  );

-- umpire_role_rates
drop policy if exists "Season owners can read role rates"   on public.umpire_role_rates;
drop policy if exists "Season owners can insert role rates" on public.umpire_role_rates;
drop policy if exists "Season owners can update role rates" on public.umpire_role_rates;
drop policy if exists "Season owners can delete role rates" on public.umpire_role_rates;
create policy "Org members can manage umpire role rates"
  on public.umpire_role_rates for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = umpire_role_rates.season_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = umpire_role_rates.season_id
        and public.is_org_member(l.owner_id)
    )
  );

-- snack_shack_settings
drop policy if exists "Season owners can read snack shack settings"   on public.snack_shack_settings;
drop policy if exists "Season owners can insert snack shack settings" on public.snack_shack_settings;
drop policy if exists "Season owners can update snack shack settings" on public.snack_shack_settings;
drop policy if exists "Season owners can delete snack shack settings" on public.snack_shack_settings;
create policy "Org members can manage snack shack settings"
  on public.snack_shack_settings for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = snack_shack_settings.season_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = snack_shack_settings.season_id
        and public.is_org_member(l.owner_id)
    )
  );

-- snack_shack_blocks (gates via snack_shack_settings -> leagues)
drop policy if exists "Season owners can read snack shack blocks"   on public.snack_shack_blocks;
drop policy if exists "Season owners can insert snack shack blocks" on public.snack_shack_blocks;
drop policy if exists "Season owners can update snack shack blocks" on public.snack_shack_blocks;
drop policy if exists "Season owners can delete snack shack blocks" on public.snack_shack_blocks;
create policy "Org members can manage snack shack blocks"
  on public.snack_shack_blocks for all
  using (
    exists (
      select 1 from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where s.id = snack_shack_blocks.snack_shack_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.snack_shack_settings s
      join public.leagues l on l.id = s.season_id
      where s.id = snack_shack_blocks.snack_shack_id
        and public.is_org_member(l.owner_id)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Division-scoped tables (gate via divisions -> leagues through division_id)
-- ────────────────────────────────────────────────────────────────────────────

-- division_venues
drop policy if exists "League owners can manage division venues" on public.division_venues;
create policy "Org members can manage division venues"
  on public.division_venues for all
  using (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = division_venues.division_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = division_venues.division_id
        and public.is_org_member(l.owner_id)
    )
  );

-- (Migration 0011's team_practice_slots table no longer exists in the
-- live schema; it was superseded by practice_time_slots + practice_slots
-- in the migration 0040 rebuild. No policy rewrite needed.)

-- practice_time_slots
drop policy if exists "League owners manage practice time slots" on public.practice_time_slots;
create policy "Org members can manage practice time slots"
  on public.practice_time_slots for all
  using (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = practice_time_slots.division_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = practice_time_slots.division_id
        and public.is_org_member(l.owner_id)
    )
  );

-- division_interleague_games
drop policy if exists "Division owners can select division_interleague_games" on public.division_interleague_games;
drop policy if exists "Division owners can insert division_interleague_games" on public.division_interleague_games;
drop policy if exists "Division owners can update division_interleague_games" on public.division_interleague_games;
drop policy if exists "Division owners can delete division_interleague_games" on public.division_interleague_games;
create policy "Org members can manage division_interleague_games"
  on public.division_interleague_games for all
  using (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = division_interleague_games.division_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
      where d.id = division_interleague_games.division_id
        and public.is_org_member(l.owner_id)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Team-scoped tables (gate via teams -> leagues through team_id)
-- ────────────────────────────────────────────────────────────────────────────

-- practice_slots (rebuilt table from 0040)
drop policy if exists "League owners manage practice slots" on public.practice_slots;
create policy "Org members can manage practice_slots"
  on public.practice_slots for all
  using (
    exists (
      select 1 from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = practice_slots.team_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = practice_slots.team_id
        and public.is_org_member(l.owner_id)
    )
  );

-- team_availability_blocks
drop policy if exists "League owners manage team availability blocks" on public.team_availability_blocks;
create policy "Org members can manage team_availability_blocks"
  on public.team_availability_blocks for all
  using (
    exists (
      select 1 from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = team_availability_blocks.team_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      join public.leagues l on l.id = t.league_id
      where t.id = team_availability_blocks.team_id
        and public.is_org_member(l.owner_id)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Game-scoped tables (gate via games -> leagues through game_id)
-- ────────────────────────────────────────────────────────────────────────────

-- game_umpires
drop policy if exists "Season owners can read game umpires"   on public.game_umpires;
drop policy if exists "Season owners can insert game umpires" on public.game_umpires;
drop policy if exists "Season owners can update game umpires" on public.game_umpires;
drop policy if exists "Season owners can delete game umpires" on public.game_umpires;
create policy "Org members can manage game_umpires"
  on public.game_umpires for all
  using (
    exists (
      select 1 from public.games g
      join public.leagues l on l.id = g.league_id
      where g.id = game_umpires.game_id
        and public.is_org_member(l.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.games g
      join public.leagues l on l.id = g.league_id
      where g.id = game_umpires.game_id
        and public.is_org_member(l.owner_id)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Interleague invitations (use sender_user_id as the org_id equivalent)
-- ────────────────────────────────────────────────────────────────────────────

-- interleague_invites — sender_user_id is the creating user; treat their org
-- as the gating org so any admin in that org can manage these invites.
drop policy if exists "Senders can select their own invites" on public.interleague_invites;
drop policy if exists "Senders can insert their own invites" on public.interleague_invites;
drop policy if exists "Senders can update their own invites" on public.interleague_invites;
drop policy if exists "Senders can delete their own invites" on public.interleague_invites;
create policy "Org members can manage interleague invites"
  on public.interleague_invites for all
  using (public.is_org_member(sender_user_id))
  with check (
    public.is_org_member(sender_user_id)
    and interleague_org_id in (
      select id from public.interleague_orgs
       where public.is_org_member(owner_id)
    )
    and season_id in (
      select id from public.leagues
       where public.is_org_member(owner_id)
    )
  );

-- interleague_invite_responses — SELECT only; writes happen via SECURITY
-- DEFINER RPC (accept_interleague_invite). Open the SELECT to any org
-- member of the inviting org rather than just the original sender.
drop policy if exists "Senders can select responses to their invites" on public.interleague_invite_responses;
create policy "Org members can read interleague invite responses"
  on public.interleague_invite_responses for select
  using (
    invite_id in (
      select id from public.interleague_invites
       where public.is_org_member(sender_user_id)
    )
  );
