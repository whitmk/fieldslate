"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, X, Loader2, AlertTriangle, CheckCircle2, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

const MAX_NAME_LENGTH = 80;

type Toast = { kind: "error" | "success"; message: string; id: number };

interface Props {
  userId: string;
  initialOrgName: string | null;
  /** Shown as a placeholder when no org name is set yet — usually the user's
   *  earliest league name, so the UX hints at the source of the current
   *  greeting. */
  fallbackName: string | null;
}

export function OrgNameCard({ userId, initialOrgName, fallbackName }: Props) {
  const [orgName, setOrgName] = useState(initialOrgName ?? "");
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

  const display = orgName.trim() || fallbackName || "Not set";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Organization name
            </p>
            <p className="mt-1 flex items-center gap-2 text-base font-semibold text-[#0C1F3F]">
              <Building2 className="h-4 w-4 flex-shrink-0 text-gray-400" />
              <span className="truncate">{display}</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Shown in the Overview greeting and anywhere your org identity (not a
              specific season) appears.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        </div>

        {toast && (
          <div className="mt-4">
            <ToastBanner
              kind={toast.kind}
              message={toast.message}
              onDismiss={() => setToast(null)}
            />
          </div>
        )}

        {editing && (
          <EditOrgNameModal
            userId={userId}
            currentName={orgName}
            onClose={() => setEditing(false)}
            onSaved={(next) => {
              setOrgName(next);
              setEditing(false);
              notify("success", "Organization name updated");
            }}
            onError={(message) => notify("error", message)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function EditOrgNameModal({
  userId,
  currentName,
  onClose,
  onSaved,
  onError,
}: {
  userId: string;
  currentName: string;
  onClose: () => void;
  onSaved: (next: string) => void;
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
      setValidationError("Organization name is required.");
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
      .from("profiles")
      .update({ org_name: trimmed } as never)
      .eq("id", userId);

    setSaving(false);
    if (error) {
      onError(error.message || "Failed to update organization name.");
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
          <h2 className="font-semibold text-[#0C1F3F]">Edit organization name</h2>
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
            <label htmlFor="org-name" className="text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              id="org-name"
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setValidationError(null);
              }}
              maxLength={MAX_NAME_LENGTH}
              placeholder="e.g. SRALL"
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
