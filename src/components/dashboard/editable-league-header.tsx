"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, X, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const MAX_NAME_LENGTH = 80;

type Toast = { kind: "error" | "success"; message: string; id: number };

interface Props {
  leagueId: string;
  initialName: string;
  sport: string;
  season: string | null;
  status: string;
  sportClassName: string;
}

export function EditableLeagueHeader({
  leagueId,
  initialName,
  sport,
  season,
  status,
  sportClassName,
}: Props) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  function notify(kind: Toast["kind"], message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, message, id: Date.now() });
    toastTimerRef.current = window.setTimeout(
      () => {
        setToast(null);
        toastTimerRef.current = null;
      },
      kind === "error" ? 8000 : 4000,
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#0C1F3F]">{name}</h1>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sportClassName}`}
            >
              {sport}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit season name"
              title="Edit season name"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-sm text-gray-500">{season}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
            status === "active"
              ? "bg-[#22C55E]/10 text-[#22C55E]"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {status}
        </span>
      </div>

      {toast && (
        <ToastBanner
          kind={toast.kind}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}

      {editing && (
        <EditNameModal
          leagueId={leagueId}
          currentName={name}
          onClose={() => setEditing(false)}
          onSaved={(nextName) => {
            setName(nextName);
            setEditing(false);
            notify("success", "Season name updated");
          }}
          onError={(message) => notify("error", message)}
        />
      )}
    </>
  );
}

function EditNameModal({
  leagueId,
  currentName,
  onClose,
  onSaved,
  onError,
}: {
  leagueId: string;
  currentName: string;
  onClose: () => void;
  onSaved: (nextName: string) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_NAME_LENGTH;
  const isEmpty = trimmed.length === 0;
  const unchanged = trimmed === currentName.trim();
  const canSave = !isEmpty && !tooLong && !unchanged && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEmpty) {
      setValidationError("Name is required.");
      return;
    }
    if (tooLong) {
      setValidationError(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
      return;
    }
    if (unchanged) {
      onClose();
      return;
    }

    setSaving(true);
    setValidationError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("leagues")
      .update({ name: trimmed } as never)
      .eq("id", leagueId);

    setSaving(false);
    if (error) {
      onError(error.message || "Failed to update season name.");
      return;
    }
    onSaved(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">Edit season name</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="league-name" className="text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              id="league-name"
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setValidationError(null);
              }}
              maxLength={MAX_NAME_LENGTH}
              autoFocus
              required
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
            <p className="text-right text-xs text-gray-400">
              {trimmed.length} / {MAX_NAME_LENGTH}
            </p>
          </div>

          {validationError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <p className="text-sm text-red-700">{validationError}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToastBanner({
  kind,
  message,
  onDismiss,
}: {
  kind: "error" | "success";
  message: string;
  onDismiss: () => void;
}) {
  const isError = kind === "error";
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-[#22C55E]/30 bg-[#22C55E]/5 text-[#16a34a]"
      }`}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
      )}
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 rounded-md p-1 text-current/60 hover:bg-black/5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
