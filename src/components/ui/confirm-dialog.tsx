"use client";

// A small, shared "are you sure?" dialog for one-tap actions that change
// data. Modelled on the interleague page's local DeleteDialog. Cancel takes
// focus on open (so a stray Enter cannot confirm), Escape and a backdrop
// tap cancel, and both buttons are 44px tall for touch.

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

interface Props {
  title: string;
  /** Secondary line under the title, e.g. the full date and the field. */
  detail?: ReactNode;
  confirmLabel: string;
  /** "danger" = red confirm (deletes); "default" = navy confirm. */
  tone?: "danger" | "default";
  icon?: ReactNode;
  busy?: boolean;
  /** A failed action: the dialog stays open and says why. Confirm stays
   *  enabled so the admin can retry; Cancel closes. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  tone = "default",
  icon,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const danger = tone === "danger";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-6 text-center">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${danger ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-500"}`}
          >
            {icon ?? <AlertTriangle className="h-5 w-5" />}
          </div>
          <div>
            <h3 id="confirm-dialog-title" className="font-semibold text-[#0C1F3F]">
              {title}
            </h3>
            {detail && <p className="mt-1 text-sm text-gray-500">{detail}</p>}
          </div>
          {error && (
            <p role="alert" className="w-full rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-left text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex gap-2 px-6 py-5">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 flex-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${danger ? "bg-red-500 hover:bg-red-600" : "bg-[#0C1F3F] hover:bg-[#162d58]"}`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
