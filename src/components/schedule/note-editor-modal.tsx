"use client";

// The ONE note editor modal, shared by game notes and snack shack shift notes
// (lifted verbatim from use-game-note-editor.tsx on 2026-10-05; that hook now
// renders this). A small modal: textarea, live character count, Save,
// Cancel, Remove note (hidden when there is no note), the privacy line, and
// the attribution. It knows nothing about what it is a note ON — the hook
// that opens it does the write and the activity log.

import { useState } from "react";
import { AlertTriangle, Loader2, StickyNote, X } from "lucide-react";
import {
  NOTE_MAX_CHARS,
  NOTE_PRIVACY_LINE,
  noteDraft,
} from "@/lib/schedule/game-notes";

interface Props {
  title: string;
  subtitle: string;
  /** The current note, or null/empty. */
  initial: string | null;
  /** "Last edited by …", or null. */
  attribution: string | null;
  placeholder?: string;
  busy: boolean;
  error: string | null;
  /** Save (value) or Remove (null). */
  onWrite: (value: string | null) => void;
  onClose: () => void;
}

export function NoteEditorModal({ title, subtitle, initial, attribution, placeholder, busy, error, onWrite, onClose }: Props) {
  const [draft, setDraft] = useState(initial ?? "");
  const state = noteDraft(draft);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-violet-600" />
              <h2 className="font-semibold text-[#0C1F3F]">{title}</h2>
            </div>
            <p className="mt-0.5 truncate text-sm text-gray-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            placeholder={placeholder ?? "Lights out on field 2 after 7pm…"}
            className="resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
          <div className="flex items-center justify-between text-[11px]">
            <span className={state.ok ? "text-gray-400" : "text-red-600"}>
              {NOTE_MAX_CHARS - state.remaining}/{NOTE_MAX_CHARS}
            </span>
            {attribution && <span className="text-gray-400">{attribution}</span>}
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
            {initial ? (
              <button
                type="button"
                onClick={() => onWrite(null)}
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
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => state.ok && onWrite(state.value)}
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
  );
}
