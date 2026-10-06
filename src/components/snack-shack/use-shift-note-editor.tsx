"use client";

// The shift-note editor: opens the shared NoteEditorModal for a snack shack
// shift and owns the write + the activity log. Attribution is set by the 0104
// trigger; the fresh row (with the editor's name) comes back from the same
// statement. The log records the EVENT, never the text.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { NoteEditorModal } from "@/components/schedule/note-editor-modal";
import { noteAttribution } from "@/lib/schedule/game-notes";
import { SHIFT_NOTE_SELECT_FIELDS, shiftNoteLogEntry, type ShiftNoteFields } from "@/lib/snack-shack/shift-notes";

export type NoteEditorShift = ShiftNoteFields & {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
};

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(t: string) {
  const [h, m] = t.substring(0, 5).split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function useShiftNoteEditor({ leagueId }: { leagueId: string }): {
  open: (shift: NoteEditorShift) => void;
  modal: ReactNode;
} {
  const router = useRouter();
  const [target, setTarget] = useState<NoteEditorShift | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(shift: NoteEditorShift) {
    setTarget(shift);
    setError(null);
  }

  async function write(value: string | null) {
    if (!target) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("snack_shack_blocks")
      .update({ notes: value } as never)
      .eq("id", target.id)
      .select(SHIFT_NOTE_SELECT_FIELDS)
      .single();
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    const timeLabel = `${fmtTime(target.start_time)} – ${fmtTime(target.end_time)}`;
    const entry = shiftNoteLogEntry({ dateLabel: fmtDate(target.date), timeLabel, before: target.notes ?? null, after: value });
    if (entry) await logActivity(leagueId, null, entry.eventType, entry.message);
    setBusy(false);
    setTarget(null);
    router.refresh();
  }

  const modal = target ? (
    <NoteEditorModal
      key={target.id}
      title="Shift note"
      subtitle={`${fmtDate(target.date)} · ${fmtTime(target.start_time)} – ${fmtTime(target.end_time)}`}
      initial={target.notes ?? null}
      attribution={noteAttribution(target)}
      placeholder="Bring the float from the office…"
      busy={busy}
      error={error}
      onWrite={(v) => void write(v)}
      onClose={() => !busy && setTarget(null)}
    />
  ) : null;

  return { open, modal };
}
