"use client";

import { useState } from "react";
import { Printer, Mail, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  umpireId: string;
  umpireName: string;
  /** The official's stored email (umpires.email) — pre-fills the send form. */
  savedEmail?: string | null;
}

export function UmpireScheduleActions({ umpireId, umpireName, savedEmail }: Props) {
  const [emailOpen, setEmailOpen] = useState(false);

  return (
    <div className="flex flex-shrink-0 items-center gap-2 print:hidden">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
      >
        <Printer className="h-4 w-4" />
        Print
      </button>
      <button
        onClick={() => setEmailOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
      >
        <Mail className="h-4 w-4" />
        Email schedule
      </button>

      {emailOpen && (
        <EmailScheduleModal
          umpireId={umpireId}
          umpireName={umpireName}
          savedEmail={savedEmail}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  );
}

function EmailScheduleModal({
  umpireId,
  umpireName,
  savedEmail,
  onClose,
}: {
  umpireId: string;
  umpireName: string;
  savedEmail?: string | null;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(savedEmail ?? "");
  const prefilled = !!savedEmail && email === savedEmail;
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    { kind: "ok"; recipient: string } | { kind: "err"; message: string } | null
  >(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/umpires/${umpireId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setResult({
          kind: "err",
          message: data.error ?? `Request failed (${res.status}).`,
        });
        setSending(false);
        return;
      }
      setResult({ kind: "ok", recipient: email.trim() });
    } catch (err) {
      setResult({
        kind: "err",
        message: err instanceof Error ? err.message : "Network error.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
      onClick={() => !sending && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">Email schedule</h2>
          <button
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {result?.kind === "ok" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-[#22C55E]" />
            <p className="text-sm font-medium text-[#0C1F3F]">
              Schedule sent to {result.recipient}
            </p>
            {result.recipient !== savedEmail && (
              <p className="text-xs text-gray-500">
                This address wasn&apos;t saved to {umpireName}&apos;s record.
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:border-gray-300 hover:text-gray-700"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
            <p className="text-sm text-gray-500">
              Send {umpireName}&apos;s schedule by email.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                type="email"
                placeholder="ump@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
                className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
              {prefilled ? (
                <p className="text-xs text-gray-400">
                  Using saved email — edit to override.
                </p>
              ) : (
                <p className="text-xs text-gray-400">
                  One-time send — this address won&apos;t be saved.
                </p>
              )}
            </div>

            {result?.kind === "err" && (
              <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                <p className="text-sm text-red-700">{result.message}</p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending || !email.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send schedule"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
