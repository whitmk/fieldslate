"use client";

// Shared archive / unarchive confirmation modals.
//
// Used from three surfaces: the seasons list cards (••• menu), the season
// detail page's amber banner Unarchive button, and the season detail page's
// header ••• menu. All routes through here so the copy + behavior stay
// identical. On success the caller is responsible for refresh (typically
// `router.refresh()`); we just close the modal.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface BaseProps {
  seasonId: string;
  seasonName: string;
  onClose: () => void;
  /** Called after a successful mutation, before close. Default: router.refresh(). */
  onSuccess?: () => void;
}

type ArchiveProps = BaseProps;

interface UnarchiveProps extends BaseProps {
  /**
   * The season's current end_date (YYYY-MM-DD) or null. If past or null,
   * the modal surfaces an inline date picker so the admin can extend the
   * season before unarchiving — otherwise the on-read auto-archive will
   * snap it right back next visit.
   */
  endDate: string | null;
}

function localTodayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function thirtyDaysFromTodayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Esc-to-close shared hook. */
function useEsc(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// ── Archive ───────────────────────────────────────────────────────────────────

export function ArchiveSeasonModal({
  seasonId,
  seasonName,
  onClose,
  onSuccess,
}: ArchiveProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEsc(() => !busy && onClose());

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Keep `status` in sync with the new source of truth so the existing
    // pill-rendering code (which branches on status) stays correct.
    const { error: err } = await supabase
      .from("leagues")
      .update({
        archived_at: new Date().toISOString(),
        status: "archived",
      } as never)
      .eq("id", seasonId);
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    if (onSuccess) onSuccess();
    else router.refresh();
    setBusy(false);
    onClose();
  }

  return (
    <ModalShell
      title="Archive season"
      onClose={() => !busy && onClose()}
      icon={<Archive className="h-4 w-4 text-amber-500" />}
    >
      <p className="text-sm text-gray-700">
        Archive <span className="font-semibold text-[#0C1F3F]">{seasonName}</span>?
        You&rsquo;ll be able to unarchive it later. The season moves to the
        Archived tab and is hidden from the active workspace.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/85 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Archive season
        </button>
      </div>
    </ModalShell>
  );
}

// ── Unarchive ────────────────────────────────────────────────────────────────

export function UnarchiveSeasonModal({
  seasonId,
  seasonName,
  endDate,
  onClose,
  onSuccess,
}: UnarchiveProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the existing end_date is already past or missing, default the date
  // picker on (with +30 days). The admin can clear it back to "keep current"
  // by leaving the checkbox off.
  const today = localTodayStr();
  const endIsPast = !endDate || endDate < today;
  const [extendDate, setExtendDate] = useState<boolean>(endIsPast);
  const [newEndDate, setNewEndDate] = useState<string>(thirtyDaysFromTodayStr());

  useEsc(() => !busy && onClose());

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const patch: Record<string, unknown> = {
      archived_at: null,
      status: "active",
    };
    if (endIsPast && extendDate && newEndDate) {
      patch.end_date = newEndDate;
    }
    const { error: err } = await supabase
      .from("leagues")
      .update(patch as never)
      .eq("id", seasonId);
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    if (onSuccess) onSuccess();
    else router.refresh();
    setBusy(false);
    onClose();
  }

  return (
    <ModalShell
      title="Unarchive season"
      onClose={() => !busy && onClose()}
      icon={<Archive className="h-4 w-4 text-[#22C55E]" />}
    >
      <p className="text-sm text-gray-700">
        Unarchive <span className="font-semibold text-[#0C1F3F]">{seasonName}</span>?
        It&rsquo;ll return to the Active tab.
      </p>

      {endIsPast && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
          <label className="flex items-start gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={extendDate}
              onChange={(e) => setExtendDate(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-amber-300 text-amber-600 focus:ring-amber-500/40"
            />
            <span>
              Update end date to keep this season active
              <span className="block text-xs text-amber-800/80">
                {endDate
                  ? `Current end date is ${endDate}, which is in the past. Without an extension, the season will auto-archive on the next visit.`
                  : "This season has no end date set. Without one, it will keep auto-archiving on each visit if you set one in the past."}
              </span>
            </span>
          </label>
          {extendDate && (
            <input
              type="date"
              value={newEndDate}
              min={today}
              onChange={(e) => setNewEndDate(e.target.value)}
              className="ml-6 h-9 w-fit rounded-md border border-amber-200 bg-white px-2.5 text-sm text-amber-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            />
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || (endIsPast && extendDate && !newEndDate)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Unarchive
        </button>
      </div>
    </ModalShell>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

function ModalShell({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="font-semibold text-[#0C1F3F]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
