"use client";

// The admin email-problems banner (0128): the Volunteers "Who signed up" page
// and the Officials page. Every sentence comes from
// src/lib/outbound-email/problems.ts, built on the server and rendered here
// verbatim. Admin-only: never rendered on a public page (sim:outbox-quota F1).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  PROBLEMS_ACK_FAILED,
  PROBLEMS_ACK_LABEL,
  PROBLEMS_HELP,
  PROBLEMS_UNREADABLE,
  ackArgs,
  type ProblemsFeature,
  type ProblemsRpc,
  type ProblemsView,
} from "@/lib/outbound-email/problems";

export function EmailProblemsBanner({
  feature,
  rpc,
  seasonId,
  view,
}: {
  feature: ProblemsFeature;
  /** The feature's own functions (it names them; this component doesn't). */
  rpc: ProblemsRpc;
  seasonId: string;
  /** null = the read failed; the banner says it couldn't check. */
  view: ProblemsView | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (view === null) {
    return (
      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {PROBLEMS_UNREADABLE}
      </div>
    );
  }

  const canAck = view.ackIds.length > 0 || view.hasTriggerFailures;

  async function acknowledge() {
    if (!view) return;
    setBusy(true);
    setError(null);
    const { error: rpcErr } = await createClient().rpc(
      rpc.ack as never,
      ackArgs(feature, seasonId, view) as never,
    );
    setBusy(false);
    if (rpcErr) {
      setError(PROBLEMS_ACK_FAILED);
      return;
    }
    router.refresh();
  }

  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{view.summary}</p>
          <p className="mt-0.5 text-xs text-amber-800">{PROBLEMS_HELP}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {view.items.length > 0 && (
            <button type="button" onClick={() => setOpen(!open)} className="font-semibold underline">
              {open ? "Hide" : "See which"}
            </button>
          )}
          {canAck && (
            <button
              type="button"
              disabled={busy}
              onClick={acknowledge}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-60"
            >
              {PROBLEMS_ACK_LABEL}
            </button>
          )}
        </div>
      </div>
      {open && view.items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {view.items.map((it) => (
            <li key={it.id} className="break-words">
              {it.line} — <span className="font-medium">{it.why}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}
