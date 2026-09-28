// Game notes — an INTERNAL free-text note on a game (games.notes, unused
// since 0001 until 2026-09-28). Decided, do not re-litigate:
//   * INTERNAL: never printed, never exported, never shown to parents or to a
//     partner league on any token page. `npm run sim:game-notes` proves the
//     omission three ways — a source scan of both print regions, both CSV
//     builders and the email builders; a live-prosrc scan of every public
//     function (scripts/sim/game-notes-triggers-sim.sql); and the Schedule
//     page's and panel's selects asserted to CARRY `notes` while the print
//     files never reference it. That third one matters most: the column
//     arrives in the page's query for the row line, so the print region is
//     the surface most likely to leak it later.
//   * editable while the division is LOCKED (0095 allowlists it).
//   * a property of the game, edited where the game is seen — never inside
//     the reschedule flow.
//
// Attribution ("Last edited by …") is set by a database trigger on every note
// change (0095), never by the write. A note-only edit does not clear "Sent to
// parents" (0096); a mixed edit still does.
//
// Every surface renders through GameNoteIcon / GameNoteLine / GameNoteDot
// (src/components/schedule/game-note.tsx) and saves through saveGameNote.
// The decisions below are pure so the harness drives exactly what they call.

export const NOTE_MAX_CHARS = 500;

/** What every surface needs to know about a game's note. */
export type GameNoteFields = {
  notes?: string | null;
  notes_updated_at?: string | null;
  /** `notes_editor:profiles!games_notes_updated_by_fkey(full_name)` */
  notes_editor?: { full_name: string | null } | null;
};

/** The columns a surface's select must carry to render a note. ONE string so
 *  the eight selects cannot drift. */
export const NOTE_SELECT_FIELDS =
  "notes, notes_updated_at, notes_editor:profiles!games_notes_updated_by_fkey(full_name)";

/** A note that is present: trimmed, non-empty. Whitespace-only is "no note". */
export function hasNote(g: GameNoteFields): boolean {
  return typeof g.notes === "string" && g.notes.trim().length > 0;
}

/** The text the row line shows: one line, truncated by CSS; the full text is
 *  the element's title. Collapses internal newlines so a multi-line note
 *  does not break the row. */
export function noteLineText(g: GameNoteFields): string {
  return (g.notes ?? "").replace(/\s*\n+\s*/g, " · ").trim();
}

/** "Last edited by Whit, Sep 28" — or null when nothing is known. A missing
 *  editor name (deleted profile, or a write made outside the app) still
 *  yields the date. */
export function noteAttribution(g: GameNoteFields, now = new Date()): string | null {
  if (!g.notes_updated_at) return null;
  const at = new Date(g.notes_updated_at);
  if (Number.isNaN(at.getTime())) return null;
  const sameYear = at.getFullYear() === now.getFullYear();
  const date = at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const who = g.notes_editor?.full_name?.trim();
  return who ? `Last edited by ${who}, ${date}` : `Last edited ${date}`;
}

export type NoteDraftState =
  | { ok: true; value: string | null; remaining: number }
  | { ok: false; remaining: number; reason: "too_long" };

/**
 * What a Save would write. Trims; an empty draft saves NULL (the same as
 * Remove note). Over the limit is refused here AND by the 500-char CHECK in
 * the database — the UI count is a courtesy, the CHECK is the guard.
 */
export function noteDraft(raw: string): NoteDraftState {
  const value = raw.trim();
  const remaining = NOTE_MAX_CHARS - value.length;
  if (value.length > NOTE_MAX_CHARS) return { ok: false, remaining, reason: "too_long" };
  return { ok: true, value: value.length === 0 ? null : value, remaining };
}

/** The activity-log entry for a note change: the EVENT, never the text — the
 *  log records that something changed; the note itself lives on the game. */
export function noteLogEntry(p: {
  matchup: string;
  dateLabel: string;
  before: string | null;
  after: string | null;
}): { eventType: "game_note_updated" | "game_note_removed"; message: string } | null {
  const before = (p.before ?? "").trim();
  const after = (p.after ?? "").trim();
  if (before === after) return null;
  if (after === "") {
    return { eventType: "game_note_removed", message: `Note removed from ${p.matchup} on ${p.dateLabel}` };
  }
  return {
    eventType: "game_note_updated",
    message: `${before === "" ? "Note added to" : "Note updated on"} ${p.matchup} on ${p.dateLabel}`,
  };
}

/** The privacy line inside the editor. One string, so every surface says it
 *  the same way. */
export const NOTE_PRIVACY_LINE =
  "Internal only. Notes are never printed, never exported, and never shown to parents or to the other league.";
