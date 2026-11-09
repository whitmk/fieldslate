"use client";

// "Ask for help" (officials self-sign-up, 0124). Rendered only when the org
// has the feature. The coordinator ticks officials; each gets an email listing
// the open spots they can take, with a NEW private link (the old one stops
// working — the dialog says so). Officials without an email are listed but
// can't be ticked, with a pointer to add one. The result lines come from the
// database's reply, worded by helpResultLines — a reply it can't read says
// "Nobody was emailed", never a guess.

import { useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { helpResultLines } from "@/lib/officials-signup/page";
import * as W from "@/lib/officials-signup/words";

export type HelpOfficial = { id: string; name: string; email: string | null };

const EMAIL_SHAPE = /^[^@\s<>"(),;:\\]+@[^@\s<>"(),;:\\]+\.[^@\s<>"(),;:\\]+$/;

export function AskForHelpButton({
  seasonId,
  officials,
  enabled,
}: {
  seasonId: string;
  officials: HelpOfficial[];
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reachable = officials.filter((o) => o.email && EMAIL_SHAPE.test(o.email.trim()));
  const unreachable = officials.filter((o) => !reachable.includes(o));

  function openDialog() {
    setPicked(new Set(reachable.map((o) => o.id)));
    setResult(null);
    setError(null);
    setOpen(true);
  }

  async function send() {
    if (picked.size === 0) {
      setError(W.HELP_PICK_SOME);
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient().rpc(
      // @ts-expect-error — RPC isn't in the hand-maintained types (0124)
      "send_official_help_request",
      { p_season_id: seasonId, p_umpire_ids: Array.from(picked) },
    );
    setBusy(false);
    if (err) {
      setError(W.adminErrorLine(err.message, W.HELP_FAILED));
      return;
    }
    setResult(helpResultLines(data));
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={!enabled}
        title={enabled ? undefined : W.HELP_OFF}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:opacity-50"
      >
        <Mail className="h-4 w-4" />
        {W.HELP_BUTTON}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-[#0C1F3F]">{W.HELP_TITLE}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
              {result ? (
                <div className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "border border-green-200 bg-green-50 text-green-800" : "border border-red-100 bg-red-50 text-red-700"}`}>
                  {result.lines.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-600">{W.HELP_DETAIL}</p>
                  <ul className="flex flex-col gap-1">
                    {reachable.map((o) => (
                      <li key={o.id}>
                        <label className="flex min-h-[40px] items-center gap-3 rounded-lg px-2 text-sm text-gray-800 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={picked.has(o.id)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(o.id);
                              else next.delete(o.id);
                              setPicked(next);
                            }}
                            className="h-4 w-4"
                          />
                          {o.name}
                        </label>
                      </li>
                    ))}
                    {unreachable.map((o) => (
                      <li key={o.id} className="flex min-h-[40px] items-center gap-3 px-2 text-sm text-gray-400">
                        <input type="checkbox" disabled className="h-4 w-4" aria-label={`${o.name}: ${W.HELP_NO_EMAIL_HINT}`} />
                        <span>
                          {o.name} — {W.HELP_NO_EMAIL_HINT}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                </>
              )}
            </div>
            <div className="flex flex-shrink-0 justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600"
              >
                {result ? "Close" : "Cancel"}
              </button>
              {!result && (
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || reachable.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {W.HELP_SEND(picked.size)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
