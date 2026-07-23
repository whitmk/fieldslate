-- Schedule lock + posted flag — STORAGE ONLY (chunk 1 of the schedule-lock
-- feature). Nothing reads these columns yet; the enforcement trigger and the
-- UI toggle land in later chunks. Shipping the columns inert first means the
-- production-only deploy pipeline never has a window where enforcement exists
-- without its bypass, or a toggle exists without enforcement behind it.
--
-- The rule these two columns encode (see CLAUDE.md):
--   locked  protects a division against your OWN destructive re-derivation.
--   posted  tracks staleness from ANY source.
-- They are deliberately independent: locking does not post, posting does not
-- lock, and a locked division's posted flag still clears when an allowed
-- change (rainout, reschedule, partner response) lands.
--
-- Columns, not jsonb settings. Three reasons, the third decisive:
--   1. divisions.settings has no CHECK — this is state, not config.
--   2. The enforcement trigger reads `locked` per mutated row; a boolean
--      column is a cheaper read than a jsonb extraction on a hot path.
--   3. The wizard save writes settings WHOLESALE — step-review.tsx builds
--      `settings: { ...settingsPayload, teams: [...] }` from form state rather
--      than merging the stored row, so a lock kept in settings would be
--      silently cleared by any wizard save. A flag that erases itself when
--      you edit the division is worse than no flag.
--
-- No new grants needed: divisions already carries table-level DML for
-- `authenticated`, and Postgres table grants cover columns added later. This
-- is NOT the "service_role gets no default grants on new tables" case from
-- CLAUDE.md — that hazard applies to newly CREATED tables, and divisions is
-- an existing table whose consumers are all client-side under RLS.

alter table public.divisions
  add column locked    boolean not null default false,
  add column locked_at timestamptz,
  add column locked_by uuid references auth.users(id) on delete set null,
  add column posted    boolean not null default false,
  add column posted_at timestamptz;

comment on column public.divisions.locked is
  'When true, this division''s games are protected from destructive '
  're-derivation (regenerate, finish, add, delete, team/division delete). '
  'Rainouts and reschedules remain allowed. Enforced by a trigger on games '
  '(later chunk) — client-side checks are for the error message, not the guard.';

comment on column public.divisions.locked_by is
  'Which admin locked it. Any org member may lock and unlock; this exists so '
  'the next admin knows who to ask. SET NULL on user delete — the lock '
  'survives losing its author.';

comment on column public.divisions.posted is
  'Admin-set: "I have sent this division''s schedule out." AUTO-CLEARS on any '
  'change to this division''s games (later chunk) — it is not a decorative '
  'checkbox. Nothing branches on it; it exists so the flag stops claiming the '
  'schedule parents received is still current.';

comment on column public.divisions.posted_at is
  'When posted was last set. Gives the flag a timestamp to be judged against.';
