"use client";

// Shared archive / unarchive / permanent-delete confirmation modals.
//
// Used from three surfaces: the seasons list cards (••• menu), the season
// detail page's amber banner Unarchive button, and the season detail page's
// header ••• menu. All routes through here so the copy + behavior stay
// identical. On success the caller is responsible for refresh (typically
// `router.refresh()`); we just close the modal.
//
// Permanent deletion goes through the delete_league_permanently RPC (0065),
// which enforces org membership and the archived-first rule server-side —
// this modal is only ever offered on archived seasons, but the RPC is the
// actual gate.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Loader2, Trash2, X } from "lucide-react";
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

// ── Permanent delete ─────────────────────────────────────────────────────────

type DeleteCounts = {
  divisions: number;
  teams: number;
  games: number;
  officials: number;
  interleague: number;
};

function friendlyDeleteError(msg: string): string {
  if (msg.includes("league_not_archived")) {
    return "Only archived seasons can be deleted — archive it first.";
  }
  if (msg.includes("not_authorized")) {
    return "You don't have permission to delete this season.";
  }
  if (msg.includes("league_not_found")) {
    return "Season not found — it may already be deleted.";
  }
  return msg;
}

export function DeleteSeasonModal({
  seasonId,
  seasonName,
  onClose,
  onSuccess,
}: BaseProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<DeleteCounts | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEsc(() => !busy && onClose());

  // What's inside the season — shown in the warning box. Plain single-table
  // head counts (the PostgREST count pitfall only bites with !inner joins).
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    async function load() {
      const [div, team, game, ump, il] = await Promise.all([
        supabase
          .from("divisions")
          .select("id", { count: "exact", head: true })
          .eq("league_id", seasonId),
        supabase
          .from("teams")
          .select("id", { count: "exact", head: true })
          .eq("league_id", seasonId),
        supabase
          .from("games")
          .select("id", { count: "exact", head: true })
          .eq("league_id", seasonId),
        supabase
          .from("umpires")
          .select("id", { count: "exact", head: true })
          .eq("season_id", seasonId),
        supabase
          .from("games")
          .select("id", { count: "exact", head: true })
          .eq("league_id", seasonId)
          .eq("status", "scheduled")
          .not("interleague_org_id", "is", null),
      ]);
      if (cancelled) return;
      setCounts({
        divisions: div.count ?? 0,
        teams: team.count ?? 0,
        games: game.count ?? 0,
        officials: ump.count ?? 0,
        interleague: il.count ?? 0,
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const nameMatches = confirmText.trim() === seasonName.trim();

  async function handleConfirm() {
    if (!nameMatches || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc(
      "delete_league_permanently" as never,
      { p_league_id: seasonId } as never,
    );
    if (err) {
      setError(friendlyDeleteError(err.message ?? "Delete failed."));
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
      title="Delete season permanently"
      onClose={() => !busy && onClose()}
      icon={<Trash2 className="h-4 w-4 text-red-500" />}
    >
      <p className="text-sm text-gray-700">
        <span className="font-semibold text-[#0C1F3F]">{seasonName}</span> and
        everything in it will be permanently deleted. Unlike archiving, this
        cannot be undone.
      </p>

      <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
          What gets deleted
        </p>
        {counts === null ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-red-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Counting season data…
          </div>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
            <li>
              {counts.divisions} division{counts.divisions !== 1 ? "s" : ""},{" "}
              {counts.teams} team{counts.teams !== 1 ? "s" : ""},{" "}
              {counts.games} game{counts.games !== 1 ? "s" : ""}
            </li>
            <li>
              {counts.officials} official{counts.officials !== 1 ? "s" : ""},
              their availability, blackouts, and assignments
            </li>
            <li>
              Practices, playoffs, snack shack schedules, pay settings, and
              activity history
            </li>
          </ul>
        )}
      </div>

      {counts !== null && counts.interleague > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            {counts.interleague} accepted interleague game
            {counts.interleague !== 1 ? "s" : ""} will also be deleted. The
            partner orgs won&apos;t be notified — reach out to them first if
            they&apos;re expecting these games.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">
          Type <span className="font-semibold text-[#0C1F3F]">{seasonName}</span>{" "}
          to confirm
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={seasonName}
          autoFocus
          className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-300 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/20"
        />
      </div>

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
          disabled={busy || !nameMatches || counts === null}
          className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4" />
              Delete season
            </>
          )}
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
