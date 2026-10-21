"use client";

// The Playoffs card's "Public page" strip (mockup screen 1): Copy public link,
// Open ↗, and the "Show scores publicly" switch — or, when the bracket can't be
// shared, the one line saying why (public-bracket/share.ts `shareState`). The
// switch saves at once through set_playoff_public_scores (0116); a two-stage
// pair is one switch (the function sets both stages). Every word is
// share.ts's SHARE_WORDS, rendered verbatim.

import { useEffect, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SHARE_WORDS, scoresSaveOutcome, type ShareState } from "@/lib/public-bracket/share";

export function PublicPageStrip({
  share,
  playoffId,
  showScores,
  switchShown,
  onScoresSaved,
}: {
  share: ShareState;
  /** Either stage's id; the function resolves a pair to both. */
  playoffId: string;
  showScores: boolean;
  /** False for a draft or a double-elimination bracket (nothing to show). */
  switchShown: boolean;
  onScoresSaved: (show: boolean) => void;
}) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<"saved" | "failed" | null>(null);

  useEffect(() => {
    if (copied !== "ok" && saveNote !== "saved") return;
    const t = window.setTimeout(() => {
      setCopied((c) => (c === "ok" ? null : c));
      setSaveNote((s) => (s === "saved" ? null : s));
    }, 2000);
    return () => window.clearTimeout(t);
  }, [copied, saveNote]);

  async function copy() {
    if (!share.canCopy) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  }

  async function toggleScores() {
    const next = !showScores;
    setSaving(true);
    setSaveNote(null);
    const { data, error } = await createClient().rpc(
      // @ts-expect-error — database.ts keeps an empty Functions map on purpose.
      "set_playoff_public_scores",
      { p_playoff_id: playoffId, p_show: next },
    );
    setSaving(false);
    const out = scoresSaveOutcome(data, error, next);
    if (!out.ok) {
      setSaveNote("failed");
      return;
    }
    onScoresSaved(out.show);
    setSaveNote("saved");
  }

  const btn =
    "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-800 disabled:opacity-50";

  return (
    <div data-public-page-strip className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-100 bg-gray-50 px-4 py-2.5 text-xs">
      <span className="font-semibold text-[#0C1F3F]">{SHARE_WORDS.label}</span>
      <button type="button" className={btn} disabled={!share.canCopy} onClick={() => void copy()}>
        <Link2 className="h-3.5 w-3.5" />
        {SHARE_WORDS.copy}
      </button>
      {share.canCopy && (
        <a href={share.url} target="_blank" rel="noopener" className={btn}>
          {SHARE_WORDS.open}
        </a>
      )}
      {switchShown && (
        <button
          type="button"
          role="switch"
          aria-checked={showScores}
          disabled={saving}
          onClick={() => void toggleScores()}
          className="inline-flex min-h-9 items-center gap-2 text-gray-800 disabled:opacity-60"
        >
          <span className={`relative h-[18px] w-8 flex-none rounded-full transition-colors ${showScores ? "bg-[#22C55E]" : "bg-gray-300"}`}>
            <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${showScores ? "left-4" : "left-0.5"}`} />
          </span>
          {SHARE_WORDS.scores}
        </button>
      )}
      {copied === "ok" && (
        <span className="inline-flex items-center gap-1 rounded-md bg-[#0C1F3F] px-2 py-1 font-semibold text-white">
          <Check className="h-3 w-3" />
          {SHARE_WORDS.copied}
        </span>
      )}
      {saveNote === "saved" && <span className="font-medium text-[#16a34a]">{SHARE_WORDS.saved}</span>}
      {saveNote === "failed" && <span role="alert" className="font-medium text-red-700">{SHARE_WORDS.saveFailed}</span>}
      {copied === "failed" && share.canCopy && (
        <span className="basis-full break-all text-gray-600">
          {SHARE_WORDS.copyFailed} {share.url}
        </span>
      )}
      {!share.canCopy && (
        <span className="basis-full text-gray-600">
          {share.why}
          {share.fix && (
            <>
              {" "}
              <a href={share.fix.href} className="font-semibold text-[#16a34a] hover:underline">
                {share.fix.label}
              </a>
            </>
          )}
        </span>
      )}
      {share.canCopy && switchShown && !showScores && <span className="basis-full text-gray-600">{SHARE_WORDS.scoresOff}</span>}
    </div>
  );
}
