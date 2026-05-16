-- Phase 1 of the interleague rework: schema for pending tentative games,
-- counter-proposals, and per-org home/away split.

-- ── Per-org home/away split on division_interleague_games ────────────────────
-- Existing rows are backfilled to "all home" (current behavior where the
-- generator only creates games at our venues).

alter table public.division_interleague_games
  add column home_games_per_team integer not null default 0
    check (home_games_per_team >= 0);

update public.division_interleague_games
  set home_games_per_team = game_count
  where home_games_per_team = 0;

alter table public.division_interleague_games
  add constraint division_interleague_games_home_le_total_check
  check (home_games_per_team <= game_count);

-- ── New columns on games for pending interleague + counter-proposals ─────────

alter table public.games
  add column is_away                boolean      not null default false,
  add column external_team_name     text,
  add column proposed_scheduled_at  timestamptz,
  add column proposed_venue_name    text;

-- Extend status check to allow the new pending state.

alter table public.games drop constraint games_status_check;
alter table public.games
  add constraint games_status_check
  check (status in (
    'scheduled',
    'in_progress',
    'completed',
    'cancelled',
    'postponed',
    'pending_interleague'
  ));

-- Index for the invite RPC: list pending interleague games for an org/season.

create index if not exists games_pending_interleague_idx
  on public.games (interleague_org_id, league_id)
  where status = 'pending_interleague';
