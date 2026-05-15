"use client";

import { useState } from "react";
import { X, Loader2, Mail, CheckCircle2 } from "lucide-react";

interface Props {
  title: string;
  onSend: (email: string) => Promise<void>;
  onClose: () => void;
}

export function SnackShackEmailModal({ title, onSend, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await onSend(email.trim());
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !sending && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-[#22C55E]" />
            <p className="font-medium text-gray-900">Schedule sent!</p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-[#0C1F3F] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/90"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-6">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="coach@example.com"
                autoFocus
                className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            {error && (
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending || !email.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Send
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
