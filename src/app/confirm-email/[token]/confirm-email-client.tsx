"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { confirmView, LOAD_FAILED, type ConfirmView } from "@/lib/contact-verify/rules";

// Reads the link on open (nothing changes) and confirms only on the button.
export function ConfirmEmailClient({ token }: { token: string }) {
  const [view, setView] = useState<ConfirmView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contact-verify/confirm/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? confirmView(await r.json()) : LOAD_FAILED))
      .catch(() => LOAD_FAILED)
      .then((v) => {
        if (!cancelled) setView(v);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function confirm() {
    setBusy(true);
    const v = await fetch(`/api/contact-verify/confirm/${encodeURIComponent(token)}`, { method: "POST", cache: "no-store" })
      .then(async (r) => (r.ok ? confirmView(await r.json()) : LOAD_FAILED))
      .catch(() => LOAD_FAILED);
    setBusy(false);
    setView(v);
  }

  return (
    <main className="flex min-h-dvh items-start justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">FieldSlate</p>
        {!view ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <h1 className={`mt-2 break-words text-xl font-bold ${view.kind === "done" ? "text-[#15803d]" : "text-[#0C1F3F]"}`}>
              {view.title}
            </h1>
            <p className="mt-2 break-words text-sm text-gray-700">{view.detail}</p>
            {view.kind === "ask" && (
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0C1F3F] px-5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {view.button}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
