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
import { AlertTriangle, Loader2, StickyNote, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { fmtGameDate } from "@/lib/utils/game-time";
import {
  NOTE_MAX_CHARS,
  NOTE_PRIVACY_LINE,
  NOTE_SELECT_FIELDS,
  noteAttribution,
  noteDraft,
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
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void logSource;

  function open(game: NoteEditorGame) {
    setTarget(game);
    setDraft(game.notes ?? "");
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

  const state = noteDraft(draft);
  const modal = target ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && setTarget(null)}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-violet-600" />
              <h2 className="font-semibold text-[#0C1F3F]">Game note</h2>
            </div>
            <p className="mt-0.5 truncate text-sm text-gray-500">
              {matchupOf(target)} · {fmtGameDate(target.scheduled_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTarget(null)}
            disabled={busy}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-6 py-5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={NOTE_MAX_CHARS}
            autoFocus
            placeholder="Lights out on field 2 after 7pm…"
            className="resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
          <div className="flex items-center justify-between text-[11px]">
            <span className={state.ok ? "text-gray-400" : "text-red-600"}>
              {NOTE_MAX_CHARS - state.remaining}/{NOTE_MAX_CHARS}
            </span>
            {noteAttribution(target) && (
              <span className="text-gray-400">{noteAttribution(target)}</span>
            )}
          </div>
          <p className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-700">
            {NOTE_PRIVACY_LINE}
          </p>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            {target.notes ? (
              <button
                type="button"
                onClick={() => void write(null)}
                disabled={busy}
                className="text-xs text-red-600 underline underline-offset-2 disabled:opacity-50"
              >
                Remove note
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTarget(null)}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => state.ok && void write(state.value)}
                disabled={busy || !state.ok}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { open, modal };
}
