-- 0096: a note-only edit does not clear "Sent to parents".
--
-- clear_division_posted (0082) cleared a division's `posted` flag on ANY
-- update to one of its games, whatever changed. Game notes (0095) are
-- internal — never printed, exported or shown to parents — so editing one
-- must not mark a schedule stale. The UPDATE branch is now column-aware: a
-- row counts only if something other than notes / notes_updated_at /
-- notes_updated_by / updated_at differs. A mixed edit (note + a real change)
-- still clears. INSERT and DELETE branches are untouched; body otherwise
-- VERBATIM from 0082.
--
-- Proven by scripts/sim/game-notes-triggers-sim.sql: note-only edit keeps
-- posted, mixed edit clears it, every other edit still clears it; mutants
-- remove the ignore set (a note clears) and invert it (nothing clears).

create or replace function public.clear_division_posted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip while a container-destroying delete is running: the division is on
  -- its way out, so clearing its flag first is pure waste.
  if coalesce(current_setting('fieldslate.lock_bypass', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    update public.divisions d
       set posted = false, posted_at = null
     where d.posted
       and d.id in (select t.division_id from newrows n
                      join public.teams t on t.id = n.home_team_id);
  elsif tg_op = 'DELETE' then
    update public.divisions d
       set posted = false, posted_at = null
     where d.posted
       and d.id in (select t.division_id from oldrows o
                      join public.teams t on t.id = o.home_team_id);
  else
    -- 0096: COLUMN-AWARE. A row counts as changed only if something OTHER
    -- than the note columns (and updated_at, which set_games_updated_at
    -- bumps on every write) differs between OLD and NEW. Game notes are
    -- internal — not on the schedule parents received — so a note-only edit
    -- must not clear "Sent to parents". A MIXED edit (a note plus a real
    -- change) still clears, because the real change did. Set-based over the
    -- transition tables, joined on id: one comparison per row, no per-row
    -- plpgsql, so the 2026-07-23 cost numbers do not move.
    update public.divisions d
       set posted = false, posted_at = null
     where d.posted
       and d.id in (
         select t.division_id
           from newrows n
           join oldrows o on o.id = n.id
           join public.teams t on t.id = n.home_team_id
          where (to_jsonb(n) - 'notes' - 'notes_updated_at' - 'notes_updated_by' - 'updated_at')
                is distinct from
                (to_jsonb(o) - 'notes' - 'notes_updated_at' - 'notes_updated_by' - 'updated_at')
         union
         select t.division_id
           from oldrows o
           join newrows n on n.id = o.id
           join public.teams t on t.id = o.home_team_id
          where (to_jsonb(n) - 'notes' - 'notes_updated_at' - 'notes_updated_by' - 'updated_at')
                is distinct from
                (to_jsonb(o) - 'notes' - 'notes_updated_at' - 'notes_updated_by' - 'updated_at')
       );
  end if;

  return null;
end;
$$;

-- The three 0082 statement triggers are unchanged; the function is replaced
-- in place.
