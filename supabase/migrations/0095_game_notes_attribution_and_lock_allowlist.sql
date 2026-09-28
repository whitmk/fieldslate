-- 0095: game notes — attribution columns, the attribution trigger, and the
-- schedule lock's allowlist widened to let a note change through.
--
-- games.notes has existed since 0001 (text, nullable) and nothing has ever
-- read or written it (zero live rows carry one). Decided 2026-09-28:
--   * INTERNAL — never printed, never exported, never shown to parents or to a
--     partner league on any token page (proven by scripts/sim/game-notes-sim.ts
--     and the live-prosrc scan in scripts/sim/game-notes-triggers-sim.sql).
--   * editable while the division is LOCKED — this migration.
--   * a property of the game, edited where the game is seen.
--
-- 1. Two attribution columns, SET BY A TRIGGER, never by the write: a writer
--    cannot forget them and cannot lie about who edited (auth.uid()). Cleared
--    when the note is removed. notes_updated_by references public.profiles so
--    PostgREST can embed the editor's name in the same read; profiles' RLS
--    already lets org-mates read each other's full_name.
-- 2. A 500-character CHECK — the UI counts live, the database enforces.
-- 3. enforce_division_lock's allowlist gains notes + the two attribution
--    columns. The check is SUBTRACTION-based (0082), so adding a column means
--    the lock stops seeing changes to it — which is the point. Body otherwise
--    VERBATIM from 0082.
--
-- THE LOCK HARNESS IS RE-KEYED IN THE SAME CHANGE. scripts/sim/schedule-lock-sim.sql's
-- T5c proved the subtraction check with a `notes` update, which this
-- migration makes legal. T5c now updates `home_team_id` — see the harness for
-- why that column and not another (the trigger's own body commits to it
-- staying outside the allowlist). Mutant M4 (enumerated blocklist) is written
-- out explicitly in scripts/sim/game-notes-triggers-sim.sql and still dies at
-- T5c.

alter table public.games
  add column if not exists notes_updated_at timestamptz,
  add column if not exists notes_updated_by uuid references public.profiles(id) on delete set null;

alter table public.games
  add constraint games_notes_length check (notes is null or length(notes) <= 500);

-- ── Attribution: BEFORE UPDATE, only when the note actually changed ──────────
create or replace function public.set_games_notes_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.notes is distinct from old.notes then
    if new.notes is null then
      -- Removed: nothing to attribute, and a stale "Last edited by" on an
      -- empty note would be noise.
      new.notes_updated_at := null;
      new.notes_updated_by := null;
    else
      new.notes_updated_at := now();
      new.notes_updated_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

-- Fires between enforce_division_lock and set_games_updated_at (BEFORE ROW
-- triggers fire in NAME order). The order does not matter for the lock — both
-- attribution columns are allowlisted — but it is stated so nobody relies on
-- the lock never seeing them.
drop trigger if exists set_games_notes_attribution on public.games;
create trigger set_games_notes_attribution
  before update on public.games
  for each row execute function public.set_games_notes_attribution();

-- ── enforce_division_lock (was 0082) — allowlist widened, otherwise verbatim ─
create or replace function public.enforce_division_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Columns a locked division still permits changing: the rainout and
  -- reschedule surface, nothing more. Anything else -> blocked.
  v_allow text[] := array[
    'status',
    'scheduled_at',
    'venue_id',
    'proposed_scheduled_at',
    'proposed_venue_name',
    'external_team_name',
    'updated_at',
    -- 0095: game NOTES are internal admin text — never printed, exported or
    -- shown to parents or a partner league — and a locked schedule is exactly
    -- when someone writes "lights out on field 2". The two attribution columns
    -- are written by set_games_notes_attribution on every note change, so
    -- they move with `notes` and must be allowed with it.
    'notes',
    'notes_updated_at',
    'notes_updated_by'
  ];
  v_old_div uuid;
  v_new_div uuid;
  v_locked_name text;
begin
  if coalesce(current_setting('fieldslate.lock_bypass', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Check BOTH sides on UPDATE: if home_team_id moved between divisions, a
  -- lock on either end must apply. (That move is outside the allowlist and so
  -- is blocked regardless, but the division must be resolved to say WHICH
  -- division refused.)
  if tg_op <> 'INSERT' then
    select t.division_id into v_old_div from public.teams t where t.id = old.home_team_id;
  end if;
  if tg_op <> 'DELETE' then
    select t.division_id into v_new_div from public.teams t where t.id = new.home_team_id;
  end if;

  select d.name into v_locked_name
  from public.divisions d
  where d.id in (v_old_div, v_new_div)
    and d.locked
  limit 1;

  -- Not locked (or no division at all) -> nothing to enforce.
  if v_locked_name is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception
      'division_locked: % is locked — unlock it to add games.', v_locked_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    -- Carve-out: pending_interleague rows stay deletable. They are excluded
    -- from every export and from the Reports matrix by countsAsScheduledGame,
    -- so they were NEVER on the schedule parents received — deleting one
    -- cannot make a posted schedule stale. This is the same reasoning 0079
    -- uses to keep pending games deletable, and it is what lets an anonymous
    -- partner's decline work under a lock with no bypass.
    if old.status = 'pending_interleague' then
      return old;
    end if;
    raise exception
      'division_locked: % is locked — unlock it to delete games.', v_locked_name
      using errcode = 'P0001';
  end if;

  -- UPDATE: allowed only if every changed column is in the allowlist.
  if (to_jsonb(old) - v_allow) is distinct from (to_jsonb(new) - v_allow) then
    raise exception
      'division_locked: % is locked — only rainouts and reschedules are allowed.', v_locked_name
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- The 0082 trigger definition is unchanged; the function is replaced in place.
