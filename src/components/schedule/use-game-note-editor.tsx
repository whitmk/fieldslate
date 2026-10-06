"use client";

// The ONE game-note editor, shared by every surface that shows a game
// (Schedule list/calendar, division panel, the three dashboard cards). A
// small modal: textarea, live character count, Save, Cancel, Remove note
// (hidden when there is no note), the privacy line, and the attribution.
//
// The save is a note-only `games.update({ notes })`: attribution is set by
// the 0095 trigger, the lock allowlists it (0095), and it does not clear
// "Sent to parents" (0096). The fresh row (with the editor's name) comes back
// from the same statement. The activity log records the EVENT, never the text.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NoteEditorModal } from "./note-editor-modal";
import { logActivity } from "@/lib/activity-log";
import { fmtGameDate } from "@/lib/utils/game-time";
import {
  NOTE_SELECT_FIELDS,
  noteAttribution,
  noteLogEntry,
  type GameNoteFields,
} from "@/lib/schedule/game-notes";

export type NoteEditorGame = GameNoteFields & {
  id: string;
  league_id: string;
  scheduled_at: string;
  home_team: { name: string; division_id: string | null } | null;
  away_team: { name: string } | null;
  external_team_name?: string | null;
  interleague_org?: { name: string } | null;
  is_away?: boolean | null;
};

function matchupOf(g: NoteEditorGame): string {
  const home = g.home_team?.name ?? "TBD";
  const opp =
    g.away_team?.name ??
    g.external_team_name ??
    g.interleague_org?.name ??
    "TBD";
  return g.is_away ? `${home} at ${opp}` : `${home} vs ${opp}`;
}

export function useGameNoteEditor({
  logSource,
  onSaved,
}: {
  /** Names the surface in nothing visible — kept for parity with the
   *  reschedule hook and future log wording. */
  logSource: string;
  /** After a successful save/remove: the game id and its fresh note fields,
   *  so a surface holding client state can update without a refetch. */
  onSaved?: (gameId: string, fresh: GameNoteFields) => void;
}): { open: (game: NoteEditorGame) => void; modal: ReactNode } {
  const router = useRouter();
  const [target, setTarget] = useState<NoteEditorGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void logSource;

  function open(game: NoteEditorGame) {
    setTarget(game);
    setError(null);
  }

  async function write(value: string | null) {
    if (!target) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("games")
      .update({ notes: value } as never)
      .eq("id", target.id)
      .select(NOTE_SELECT_FIELDS)
      .single();
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    const fresh = data as unknown as GameNoteFields;
    const entry = noteLogEntry({
      matchup: matchupOf(target),
      dateLabel: fmtGameDate(target.scheduled_at),
      before: target.notes ?? null,
      after: value,
    });
    if (entry) {
      await logActivity(target.league_id, target.home_team?.division_id ?? null, entry.eventType, entry.message);
    }
    setBusy(false);
    setTarget(null);
    onSaved?.(target.id, fresh);
    router.refresh();
  }

  const modal = target ? (
    <NoteEditorModal
      key={target.id}
      title="Game note"
      subtitle={`${matchupOf(target)} · ${fmtGameDate(target.scheduled_at)}`}
      initial={target.notes ?? null}
      attribution={noteAttribution(target)}
      busy={busy}
      error={error}
      onWrite={(v) => void write(v)}
      onClose={() => !busy && setTarget(null)}
    />
  ) : null;

  return { open, modal };
}
