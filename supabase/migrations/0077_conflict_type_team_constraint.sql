-- Allow 'team_constraint' as a conflict_overrides.conflict_type (0064).
--
-- Manual game writes that land inside a team_game_constraints (0076)
-- severity-'block' window join the existing warn-with-override flow — the
-- override audit row records conflict_type 'team_constraint'. Severity
-- 'prefer' matches surface as non-blocking notices and are deliberately
-- NOT recorded here.
--
-- Nothing else changes: same immutable-audit RLS (select + insert only),
-- same grants.

alter table public.conflict_overrides
  drop constraint conflict_overrides_conflict_type_check;

alter table public.conflict_overrides
  add constraint conflict_overrides_conflict_type_check check (
    conflict_type in (
      'venue_double_book',
      'venue_hours',
      'team_double_book',
      'team_constraint'
    )
  );
