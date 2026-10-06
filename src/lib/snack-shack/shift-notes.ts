// Shift notes and the cash person — the INTERNAL fields on a snack shack
// shift (0104). Decided 2026-10-05, same rules as game notes: never printed,
// never emailed, never exported, never shown to teams. The game-notes
// harness scans every outbound snack shack path for these column names.
//
// The pure note helpers (hasNote, noteDraft, noteLineText, noteAttribution)
// are the game-notes ones — the fields have the same shape on purpose, so one
// editor (NoteEditorModal) and one set of render pieces serve both.

import type { GameNoteFields } from "@/lib/schedule/game-notes";

/** The columns a shift select must carry to render a note and the cash
 *  person. ONE string so the page select and the type cannot drift. The
 *  embeds use the FK names 0104 creates. */
export const SHIFT_NOTE_SELECT_FIELDS =
  "notes, notes_updated_at, notes_editor:profiles!snack_shack_blocks_notes_updated_by_fkey(full_name), " +
  "cash_person_id, cash_person:snack_shack_cash_people(name)";

export type ShiftNoteFields = GameNoteFields & {
  cash_person_id?: string | null;
  cash_person?: { name: string } | null;
};

export type CashPerson = { id: string; name: string };

export const CASH_NAME_MAX_CHARS = 80;

/** What an add/rename would write: trimmed, 1–80 characters. */
export function cashNameDraft(raw: string): { ok: true; value: string } | { ok: false; reason: "empty" | "too_long" } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) return { ok: false, reason: "empty" };
  if (value.length > CASH_NAME_MAX_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, value };
}

/** The removal confirm copy: how many shifts lose their cash person. */
export function cashRemovalDetail(name: string, shiftCount: number): string {
  if (shiftCount === 0) return `No shifts use ${name}.`;
  return `${shiftCount} shift${shiftCount === 1 ? "" : "s"} use${shiftCount === 1 ? "s" : ""} ${name}; ${shiftCount === 1 ? "it" : "they"} will have no cash person.`;
}

/** The activity-log entry for a shift note change: the EVENT, never the text. */
export function shiftNoteLogEntry(p: {
  dateLabel: string;
  timeLabel: string;
  before: string | null;
  after: string | null;
}): { eventType: "snack_shift_note_updated" | "snack_shift_note_removed"; message: string } | null {
  const before = (p.before ?? "").trim();
  const after = (p.after ?? "").trim();
  if (before === after) return null;
  if (after === "") {
    return { eventType: "snack_shift_note_removed", message: `Note removed from the snack shack shift on ${p.dateLabel}, ${p.timeLabel}` };
  }
  return {
    eventType: "snack_shift_note_updated",
    message: `${before === "" ? "Note added to" : "Note updated on"} the snack shack shift on ${p.dateLabel}, ${p.timeLabel}`,
  };
}
