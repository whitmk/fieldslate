"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  AlertTriangle,
  Mail,
  Send,
  Inbox,
  ExternalLink,
  CalendarClock,
  Check,
  CheckCircle2,
  RotateCw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { InterleagueOrg, InterleagueInvite } from "@/types/database";
import { RescheduleRequestModal } from "@/components/interleague/reschedule-request-modal";

// ── Types ─────────────────────────────────────────────────────────────────────

type Season = {
  id: string;
  name: string;
  season: string | null;
};

type DivisionGameRow = {
  divisionName: string;
  gameCount: number;
};

type SentInviteRow = InterleagueInvite & {
  org: { name: string } | null;
};

type CounterProposedGame = {
  id: string;
  scheduled_at: string;
  proposed_scheduled_at: string;
  proposed_venue_name: string | null;
  external_team_name: string | null;
  is_away: boolean;
  home_team: { name: string; division: { name: string } | null } | null;
  venue: { name: string } | null;
  interleague_org: { name: string } | null;
  league: { name: string; season: string | null } | null;
};

type PendingRescheduleRequest = {
  id: string;
  proposed_scheduled_at: string;
  proposed_venue_name: string | null;
  note: string | null;
  created_at: string;
  game: {
    id: string;
    scheduled_at: string;
    is_away: boolean;
    external_team_name: string | null;
    proposed_venue_name: string | null;
    home_team: { name: string; division: { name: string } | null } | null;
    venue: { name: string } | null;
    interleague_org: { name: string } | null;
    league: { name: string; season: string | null } | null;
  } | null;
};

// ── Org Modal ─────────────────────────────────────────────────────────────────

interface OrgModalProps {
  initial?: InterleagueOrg | null;
  currentOrgId: string;
  onSave: () => void;
  onClose: () => void;
}

function OrgModal({ initial, currentOrgId, onSave, onClose }: OrgModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [adminEmail, setAdminEmail] = useState(initial?.admin_email ?? "");
  const [contactName, setContactName] = useState(initial?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contact_phone ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [fieldCount, setFieldCount] = useState<number>(initial?.field_count ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !adminEmail.trim()) return;
    setSaving(true);
    setError(null);

    const supabase = createClient();

    const payload = {
      name: name.trim(),
      admin_email: adminEmail.trim(),
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      notes: notes.trim() || null,
      field_count: Math.max(1, Math.floor(Number(fieldCount) || 1)),
    };

    const { error: dbError } = isEdit
      ? await supabase
          .from("interleague_orgs")
          .update(payload)
          .eq("id", initial.id)
      : await supabase
          .from("interleague_orgs")
          .insert([{ ...payload, owner_id: currentOrgId }]);

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    onSave();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-[#0C1F3F]">
            {isEdit ? "Edit org" : "Add interleague org"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Org name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riverside Youth Baseball"
              autoFocus
              required
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Admin email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@otherleague.org"
              required
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Contact name
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Optional"
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Contact phone
              </label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Optional"
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Number of fields
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={fieldCount}
              onChange={(e) =>
                setFieldCount(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
              className="h-10 w-28 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
            <p className="text-[11px] text-gray-400">
              Caps how many away games we can schedule against this org on the
              same day. Defaults to 1.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this org…"
              rows={3}
              className="resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !adminEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add org"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirmation dialog ─────────────────────────────────────────────────

interface DeleteDialogProps {
  orgName: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

function DeleteDialog({ orgName, onConfirm, onCancel, deleting }: DeleteDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-[#0C1F3F]">Delete org?</h3>
            <p className="mt-1 text-sm text-gray-500">
              <span className="font-medium text-[#0C1F3F]">{orgName}</span> will be
              permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-2 px-6 py-5">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Send invite modal ─────────────────────────────────────────────────────────

interface SendInviteModalProps {
  org: InterleagueOrg;
  season: Season;
  onSent: () => void;
  onClose: () => void;
}

function seasonLabel(s: Season): string {
  return s.season ? `${s.name} · ${s.season}` : s.name;
}

function SendInviteModal({ org, season, onSent, onClose }: SendInviteModalProps) {
  const [recipientEmail, setRecipientEmail] = useState(org.admin_email);
  const [personalNote, setPersonalNote] = useState("");
  const [previewLoading, setPreviewLoading] = useState(true);
  const [preview, setPreview] = useState<DivisionGameRow[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPreview() {
      setPreviewLoading(true);
      const supabase = createClient();

      const { data: divsRaw } = await supabase
        .from("divisions")
        .select("id, name")
        .eq("league_id", season.id);
      const divisions = (divsRaw ?? []) as { id: string; name: string }[];
      const divisionIds = divisions.map((d) => d.id);

      if (divisionIds.length === 0) {
        setPreview([]);
        setPreviewLoading(false);
        return;
      }

      // Count actual pending_interleague rows per division — the recipient sees
      // these specific game rows, so the modal preview must match what'll
      // actually be sent (one row per game), not the per-team config value.
      const { data: gamesRaw } = await supabase
        .from("games")
        .select("home_team:teams!home_team_id(division_id)")
        .eq("interleague_org_id", org.id)
        .eq("league_id", season.id)
        .eq("status", "pending_interleague");

      const byId = new Map(divisions.map((d) => [d.id, d.name]));
      const counts = new Map<string, number>();
      for (const g of (gamesRaw ?? []) as { home_team: { division_id: string | null } | null }[]) {
        const divId = g.home_team?.division_id;
        if (!divId) continue;
        counts.set(divId, (counts.get(divId) ?? 0) + 1);
      }
      const rows = Array.from(counts.entries())
        .map(([divisionId, gameCount]) => ({
          divisionName: byId.get(divisionId) ?? "Division",
          gameCount,
        }))
        .filter((g) => g.gameCount > 0)
        .sort((a, b) => a.divisionName.localeCompare(b.divisionName));

      setPreview(rows);
      setPreviewLoading(false);
    }
    loadPreview();
  }, [org.id, season.id]);

  const totalGames = preview.reduce((sum, p) => sum + p.gameCount, 0);
  const hasPendingGames = !previewLoading && totalGames > 0;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientEmail.trim()) return;
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/interleague/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interleague_org_id: org.id,
          season_id: season.id,
          recipient_email: recipientEmail.trim(),
          personal_note: personalNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send invite.");
        setSending(false);
        return;
      }
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite.");
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#0C1F3F]">Send invite</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              to <span className="font-medium text-[#0C1F3F]">{org.name}</span> · {seasonLabel(season)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSend} className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Recipient email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              required
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
            <p className="text-[11px] text-gray-400">
              Pre-filled from this org&apos;s admin email — edit if you want to send to a different address.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Personal note <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              placeholder="A short note that will appear in the email…"
              rows={3}
              className="resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Proposed games
            </p>
            {previewLoading ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading preview…
              </div>
            ) : preview.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">
                0 pending games — generate (or regenerate) the season schedule
                so interleague games are created before sending this invite.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 text-sm">
                {preview.map((row) => (
                  <li
                    key={row.divisionName}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-[#0C1F3F]">{row.divisionName}</span>
                    <span className="font-semibold text-[#0C1F3F]">
                      {row.gameCount} {row.gameCount === 1 ? "game" : "games"}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <span>Total</span>
                  <span>
                    {totalGames} {totalGames === 1 ? "game" : "games"}
                  </span>
                </li>
              </ul>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || !recipientEmail.trim() || !hasPendingGames}
              title={
                !hasPendingGames && !previewLoading
                  ? "Generate the season schedule first to create pending interleague games."
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {sending ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Resolve / edit modal for counter-proposed games ───────────────────────────

interface ResolveEditModalProps {
  game: CounterProposedGame;
  busy: boolean;
  onSave: (payload: { scheduled_at: string; venue_name?: string }) => void;
  onClose: () => void;
}

function ResolveEditModal({ game, busy, onSave, onClose }: ResolveEditModalProps) {
  // Seed from proposal if there is one, else original.
  const [datetime, setDatetime] = useState<string>(
    isoToDatetimeLocal(game.proposed_scheduled_at ?? game.scheduled_at),
  );
  const [venueName, setVenueName] = useState<string>(
    game.proposed_venue_name ?? game.venue?.name ?? "",
  );

  const isAway = game.is_away;
  const canSave =
    !!datetime &&
    !busy &&
    (!isAway || venueName.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#0C1F3F]">Edit and confirm</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {game.home_team?.name ?? "—"}{" "}
              <span className="mx-1 font-bold uppercase tracking-wider text-gray-400">
                {isAway ? "AT" : "vs"}
              </span>
              {game.interleague_org?.name ?? "Other org"}
              {game.external_team_name ? ` (${game.external_team_name})` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            onSave({
              scheduled_at: datetimeLocalToWallClockIso(datetime),
              venue_name: isAway ? venueName.trim() : undefined,
            });
          }}
          className="flex flex-col gap-4 px-6 py-5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Date &amp; time <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              required
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
            <p className="text-[11px] text-gray-400">
              Use the time as it will appear on the schedule (no timezone conversion).
            </p>
          </div>

          {isAway && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Venue (host org) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                required
                placeholder="e.g. Riverside Field A"
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Saving…" : "Confirm game"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Sent invite status badge ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700",
    accepted: "bg-[#22C55E]/10 text-[#22C55E]",
    declined: "bg-red-50 text-red-600",
  };
  const cls = styles[status] ?? "bg-gray-100 text-gray-500";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
}

// Wall-clock UTC formatting (matches lib/utils/game-time.ts): read literal
// HH:MM substring instead of letting `new Date()` apply the viewer's TZ offset.
function fmtDateTime(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-").map(Number);
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  const dateStr = new Date(year, month - 1, day, 12).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${dateStr}, ${h12}:${String(min).padStart(2, "0")} ${period}`;
}

function isoToDatetimeLocal(iso: string): string {
  return iso.substring(0, 16);
}

function datetimeLocalToWallClockIso(local: string): string {
  if (!local) return "";
  return `${local}:00+00:00`;
}

function fmtSentDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface InterleaguePageClientProps {
  currentOrgId: string;
}

export function InterleaguePageClient({ currentOrgId }: InterleaguePageClientProps) {
  const searchParams = useSearchParams();
  const seasonFromUrl = searchParams.get("season");
  const [orgs, setOrgs] = useState<InterleagueOrg[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(
    seasonFromUrl,
  );
  const [invites, setInvites] = useState<SentInviteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<InterleagueOrg | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<InterleagueOrg | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [inviteTarget, setInviteTarget] = useState<InterleagueOrg | null>(null);
  const [counterGames, setCounterGames] = useState<CounterProposedGame[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<CounterProposedGame | null>(null);
  const [declineTarget, setDeclineTarget] = useState<CounterProposedGame | null>(null);
  const [reschedRequests, setReschedRequests] = useState<PendingRescheduleRequest[]>([]);
  const [reschedBusyId, setReschedBusyId] = useState<string | null>(null);
  const [reschedError, setReschedError] = useState<string | null>(null);
  const [reschedCounterTarget, setReschedCounterTarget] =
    useState<PendingRescheduleRequest | null>(null);

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
    id: number;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((kind: "success" | "error", message: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ kind, message, id: Date.now() });
    toastTimerRef.current = window.setTimeout(
      () => {
        setToast(null);
        toastTimerRef.current = null;
      },
      kind === "error" ? 8000 : 4000,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const selectedSeason = useMemo(
    () => seasons.find((s) => s.id === selectedSeasonId) ?? null,
    [seasons, selectedSeasonId],
  );

  // Sent invites are scoped to the season picker. The dropdown only carries
  // real season ids today, so we always filter; if an "All seasons" option is
  // ever added back, treat a falsy selection as "show everything".
  const visibleInvites = useMemo(
    () =>
      selectedSeasonId
        ? invites.filter((inv) => inv.season_id === selectedSeasonId)
        : invites,
    [invites, selectedSeasonId],
  );

  const loadAll = useCallback(async () => {
    const supabase = createClient();

    // Fetch active seasons first so we can scope the invites query by
    // season_id. Without this scope a multi-org admin would see invites
    // sent from EVERY org they belong to (RLS permits both). interleague
    // invites have no first-class "sending org" column — sender_user_id
    // is a user-id reference, season_id is the cleanest org anchor since
    // every season belongs to exactly one org via leagues.owner_id.
    //
    // Active (non-archived) seasons only — interleague invites/replies are
    // operational. Historical interleague games on archived seasons stay
    // visible through the season detail page.
    const { data: seasonRowsRaw } = await supabase
      .from("leagues")
      .select("id, name, season")
      .eq("owner_id", currentOrgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    const seasonRows = (seasonRowsRaw as Season[]) ?? [];
    const orgLeagueIds = seasonRows.map((s) => s.id);

    const [orgsRes, invitesRes, counterRes, reschedRes] = await Promise.all([
      // interleague_orgs has owner_id directly; this is just the standard
      // owner-scoped filter every other "directory" surface uses.
      supabase
        .from("interleague_orgs")
        .select("*")
        .eq("owner_id", currentOrgId)
        .order("name"),
      // Sent invites only (recipients are external; there is no in-app
      // "received invites" surface). Scope via season_id rather than
      // sender_user_id — season_id has a hard FK to leagues, so we anchor
      // to the org that owns the season being invited TO. This still
      // includes invites sent by admins (not just the owner) because
      // their invite's season still belongs to currentOrgId's leagues.
      orgLeagueIds.length
        ? supabase
            .from("interleague_invites")
            .select("*, org:interleague_orgs(name)")
            .in("season_id", orgLeagueIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as unknown[] }),
      // Counter-proposed games: pending_interleague with a recipient response
      // (external_team_name) and either a proposed time or proposed venue.
      supabase
        .from("games")
        .select(
          `id, scheduled_at, proposed_scheduled_at, proposed_venue_name,
           external_team_name, is_away,
           home_team:teams!home_team_id(name, division:divisions(name)),
           venue:venues(name),
           interleague_org:interleague_orgs(name),
           league:leagues!inner(name, season, owner_id)`
        )
        .eq("status", "pending_interleague")
        .eq("league.owner_id", currentOrgId)
        .not("external_team_name", "is", null)
        .order("scheduled_at", { ascending: true }),
      // Inbound reschedule requests: pending, externally initiated
      // (requested_by_user_id IS NULL), on games we own via league.
      supabase
        .from("interleague_reschedule_requests")
        .select(
          `id, proposed_scheduled_at, proposed_venue_name, note, created_at,
           game:games!inner(
             id, scheduled_at, is_away, external_team_name, proposed_venue_name,
             home_team:teams!home_team_id(name, division:divisions(name)),
             venue:venues(name),
             interleague_org:interleague_orgs(name),
             league:leagues!inner(name, season, owner_id)
           )`
        )
        .eq("status", "pending")
        .is("requested_by_user_id", null)
        .eq("game.league.owner_id", currentOrgId)
        .order("created_at", { ascending: false }),
    ]);

    setOrgs((orgsRes.data as InterleagueOrg[]) ?? []);
    setSeasons(seasonRows);
    // Honor a `?season=<id>` deep link (e.g. from the Season detail Quick
    // Actions card) when the id matches a season the user owns; otherwise
    // keep any prior selection or fall back to the most recent season.
    setSelectedSeasonId((prev) => {
      if (prev && seasonRows.some((s) => s.id === prev)) return prev;
      return seasonRows[0]?.id ?? null;
    });
    setInvites((invitesRes.data as SentInviteRow[]) ?? []);
    // Filter to games where the recipient actually counter-proposed something
    const counter = ((counterRes.data as unknown as CounterProposedGame[]) ?? [])
      .filter((g) => g.proposed_scheduled_at || g.proposed_venue_name);
    setCounterGames(counter);
    setReschedRequests((reschedRes.data as unknown as PendingRescheduleRequest[]) ?? []);
  }, [currentOrgId]);

  useEffect(() => {
    loadAll().then(() => setLoading(false));
  }, [loadAll]);

  function openAdd() {
    setEditOrg(null);
    setModalOpen(true);
  }

  function openEdit(org: InterleagueOrg) {
    setEditOrg(org);
    setModalOpen(true);
  }

  function handleSaved() {
    setModalOpen(false);
    setEditOrg(null);
    loadAll();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("interleague_orgs").delete().eq("id", deleteTarget.id);
    await loadAll();
    setDeleteTarget(null);
    setDeleting(false);
  }

  function openSendInvite(org: InterleagueOrg) {
    setInviteTarget(org);
  }

  function handleInviteSent() {
    setInviteTarget(null);
    loadAll();
  }

  async function respondReschedule(
    requestId: string,
    payload:
      | { action: "accept" | "decline" }
      | {
          action: "counter";
          scheduled_at: string;
          venue_name?: string;
          note?: string;
        },
  ) {
    setReschedBusyId(requestId);
    setReschedError(null);
    try {
      const res = await fetch(
        `/api/interleague/reschedule/${encodeURIComponent(requestId)}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setReschedError(data.error ?? "Failed to respond.");
        setReschedBusyId(null);
        return false;
      }
      await loadAll();
      setReschedBusyId(null);
      return true;
    } catch (err) {
      setReschedError(err instanceof Error ? err.message : "Network error.");
      setReschedBusyId(null);
      return false;
    }
  }

  async function resolveGame(
    gameId: string,
    payload:
      | { action: "accept_proposal" | "keep_original" | "decline" }
      | { action: "edit"; scheduled_at: string; venue_name?: string },
  ) {
    setResolvingId(gameId);
    setResolveError(null);
    try {
      const res = await fetch(
        `/api/interleague/games/${encodeURIComponent(gameId)}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setResolveError(data.error ?? "Failed to resolve.");
        setResolvingId(null);
        return false;
      }
      await loadAll();
      setResolvingId(null);
      return true;
    } catch (err) {
      setResolveError(
        err instanceof Error ? err.message : "Network error. Please try again.",
      );
      setResolvingId(null);
      return false;
    }
  }

  async function handleResendInvite(invite: SentInviteRow) {
    setResendingId(invite.id);
    try {
      const res = await fetch(
        `/api/interleague/invites/${encodeURIComponent(invite.id)}/resend`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        notify("error", data.error ?? "Failed to resend invite.");
        return;
      }
      notify(
        "success",
        `Invite resent to ${invite.recipient_email}.`,
      );
    } catch (err) {
      notify(
        "error",
        err instanceof Error ? err.message : "Network error. Please try again.",
      );
    } finally {
      setResendingId(null);
    }
  }

  const canSendInvite = !!selectedSeason;

  return (
    <>
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0C1F3F]">Interleague</h1>
            <p className="mt-1 text-sm text-gray-500">
              External orgs you schedule interleague games against.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {seasons.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Season
                </label>
                <select
                  value={selectedSeasonId ?? ""}
                  onChange={(e) => setSelectedSeasonId(e.target.value)}
                  className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                >
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {seasonLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!loading && orgs.length > 0 && (
              <button
                onClick={openAdd}
                className="inline-flex h-9 items-center gap-2 self-end rounded-lg bg-[#0C1F3F] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
              >
                <Plus className="h-4 w-4" />
                Add org
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
            <Building2 className="mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-[#0C1F3F]">No interleague orgs yet</p>
            <p className="mt-1 text-sm text-gray-400">
              Add an org to schedule games against other leagues.
            </p>
            <button
              onClick={openAdd}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
            >
              <Plus className="h-4 w-4" />
              Add org
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3">Org name</th>
                  <th className="px-5 py-3">Admin email</th>
                  <th className="px-5 py-3">Contact</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orgs.map((org) => (
                  <tr key={org.id} className="group hover:bg-gray-50/60">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-[#0C1F3F]">{org.name}</p>
                      {org.notes && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">
                          {org.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{org.admin_email}</td>
                    <td className="px-5 py-3.5">
                      {org.contact_name || org.contact_phone ? (
                        <div className="flex flex-col gap-0.5">
                          {org.contact_name && (
                            <span className="text-gray-700">{org.contact_name}</span>
                          )}
                          {org.contact_phone && (
                            <span className="text-xs text-gray-400">{org.contact_phone}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openSendInvite(org)}
                          disabled={!canSendInvite}
                          title={canSendInvite ? "Send invite" : "Create a season first"}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#22C55E]/40 bg-[#22C55E]/10 px-2.5 py-1.5 text-xs font-semibold text-[#16a34a] transition-colors hover:bg-[#22C55E]/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Send invite
                        </button>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => openEdit(org)}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F]"
                            aria-label="Edit org"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(org)}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            aria-label="Delete org"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Reschedule requests ────────────────────────────────────────────── */}
        {!loading && reschedRequests.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-orange-50">
                <CalendarClock className="h-3.5 w-3.5 text-orange-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#0C1F3F]">
                  Reschedule requests ({reschedRequests.length})
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  Requests from the other side to move confirmed interleague games.
                </p>
              </div>
            </div>
            {reschedError && (
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {reschedError}
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-orange-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-orange-100 bg-orange-50 text-left text-xs font-medium uppercase tracking-wide text-orange-700">
                    <th className="px-5 py-3">Game</th>
                    <th className="px-5 py-3">Proposed change</th>
                    <th className="px-5 py-3">Current</th>
                    <th className="px-5 py-3 text-right">Respond</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-orange-50">
                  {reschedRequests.map((r) => {
                    if (!r.game) return null;
                    const orgName = r.game.interleague_org?.name ?? "Other org";
                    const team = r.game.external_team_name ?? "their team";
                    const matchup = r.game.is_away
                      ? `${r.game.home_team?.name ?? "TBD"} AT ${orgName} (${team})`
                      : `${r.game.home_team?.name ?? "TBD"} vs ${team}`;
                    const busy = reschedBusyId === r.id;
                    return (
                      <tr key={r.id} className="hover:bg-orange-50/40">
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-[#0C1F3F]">{matchup}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {r.game.home_team?.division?.name ?? "—"}
                            {r.game.league?.name ? ` · ${r.game.league.name}` : ""}
                          </p>
                          {r.note && (
                            <p className="mt-1.5 rounded border-l-2 border-orange-300 bg-orange-50/60 px-2 py-1 text-xs text-[#0C1F3F]">
                              {r.note}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-700">
                          <div className="font-medium">
                            {fmtDateTime(r.proposed_scheduled_at)}
                          </div>
                          {r.proposed_venue_name && (
                            <div className="text-xs text-gray-500">
                              {r.proposed_venue_name}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-500">
                          {fmtDateTime(r.game.scheduled_at)}
                          {r.game.venue?.name && (
                            <div className="text-xs">{r.game.venue.name}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              disabled={busy}
                              onClick={() =>
                                respondReschedule(r.id, { action: "accept" })
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-[#22C55E]/40 bg-[#22C55E]/10 px-2.5 py-1.5 text-xs font-semibold text-[#16a34a] transition-colors hover:bg-[#22C55E]/20 disabled:opacity-50"
                            >
                              {busy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              Accept
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setReschedError(null);
                                setReschedCounterTarget(r);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
                            >
                              Counter
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                respondReschedule(r.id, { action: "decline" })
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
                            >
                              <X className="h-3 w-3" />
                              Decline
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Counter-proposals ───────────────────────────────────────────────── */}
        {!loading && counterGames.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-amber-50">
                <CalendarClock className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#0C1F3F]">
                  Counter-proposed games ({counterGames.length})
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  Recipients proposed different times or venues. Review and
                  resolve each one before regenerating the schedule.
                </p>
              </div>
            </div>
            {resolveError && (
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {resolveError}
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-amber-100 bg-amber-50 text-left text-xs font-medium uppercase tracking-wide text-amber-700">
                    <th className="px-5 py-3">Game</th>
                    <th className="px-5 py-3">Proposed by recipient</th>
                    <th className="px-5 py-3">Original</th>
                    <th className="px-5 py-3 text-right">Resolve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-50">
                  {counterGames.map((g) => {
                    const orgName = g.interleague_org?.name ?? "Other org";
                    const team = g.external_team_name ?? "(no team)";
                    const matchup = g.is_away
                      ? `${g.home_team?.name ?? "TBD"} AT ${orgName} (${team})`
                      : `${g.home_team?.name ?? "TBD"} vs ${team}`;
                    const busy = resolvingId === g.id;
                    const canAcceptProposal = !!g.proposed_scheduled_at;
                    return (
                      <tr key={g.id} className="hover:bg-amber-50/40">
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-[#0C1F3F]">{matchup}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {g.home_team?.division?.name ?? "—"}
                            {g.league?.name ? ` · ${g.league.name}` : ""}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 text-gray-700">
                          {g.proposed_scheduled_at && (
                            <div>
                              <span className="font-medium text-amber-700">Time:</span>{" "}
                              {fmtDateTime(g.proposed_scheduled_at)}
                            </div>
                          )}
                          {g.proposed_venue_name && (
                            <div>
                              <span className="font-medium text-amber-700">Venue:</span>{" "}
                              {g.proposed_venue_name}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-500">
                          {fmtDateTime(g.scheduled_at)}
                          {g.venue?.name && <div className="text-xs">{g.venue.name}</div>}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              disabled={busy || !canAcceptProposal}
                              onClick={() =>
                                resolveGame(g.id, { action: "accept_proposal" })
                              }
                              title={
                                canAcceptProposal
                                  ? "Apply their proposed time"
                                  : "No time proposal on this game"
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-[#22C55E]/40 bg-[#22C55E]/10 px-2.5 py-1.5 text-xs font-semibold text-[#16a34a] transition-colors hover:bg-[#22C55E]/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Accept proposal
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                resolveGame(g.id, { action: "keep_original" })
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-[#0C1F3F] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Keep original
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setResolveError(null);
                                setEditTarget(g);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-[#0C1F3F] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setResolveError(null);
                                setDeclineTarget(g);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                              Decline
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sent invites ───────────────────────────────────────────────────── */}
        {!loading && (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0C1F3F]">Sent invites</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Track invites you&apos;ve sent to interleague orgs.
              </p>
            </div>

            {visibleInvites.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-center">
                <Inbox className="mb-3 h-7 w-7 text-gray-300" />
                <p className="text-sm font-medium text-[#0C1F3F]">
                  {selectedSeason
                    ? `No invites sent for ${seasonLabel(selectedSeason)} yet`
                    : "No invites sent yet"}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Click <span className="font-medium">Send invite</span> on any org row above.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                      <th className="px-5 py-3">Org</th>
                      <th className="px-5 py-3">Recipient</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Sent</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {visibleInvites.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50/60">
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-[#0C1F3F]">
                            {inv.org?.name ?? "—"}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 text-gray-600">
                          {inv.recipient_email}
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="px-5 py-3.5 text-gray-500">
                          {fmtSentDate(inv.created_at)}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex justify-end gap-1.5">
                            {inv.status === "pending" && (
                              <button
                                onClick={() => handleResendInvite(inv)}
                                disabled={resendingId === inv.id}
                                title="Resend the original invite email"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-[#0C1F3F] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {resendingId === inv.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCw className="h-3.5 w-3.5" />
                                )}
                                {resendingId === inv.id ? "Resending…" : "Resend"}
                              </button>
                            )}
                            <button
                              disabled
                              title="Details coming in next chunk"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              View details
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {modalOpen && (
        <OrgModal
          initial={editOrg}
          currentOrgId={currentOrgId}
          onSave={handleSaved}
          onClose={() => { setModalOpen(false); setEditOrg(null); }}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          orgName={deleteTarget.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      {inviteTarget && selectedSeason && (
        <SendInviteModal
          org={inviteTarget}
          season={selectedSeason}
          onSent={handleInviteSent}
          onClose={() => setInviteTarget(null)}
        />
      )}

      {editTarget && (
        <ResolveEditModal
          game={editTarget}
          busy={resolvingId === editTarget.id}
          onSave={async ({ scheduled_at, venue_name }) => {
            const ok = await resolveGame(editTarget.id, {
              action: "edit",
              scheduled_at,
              venue_name,
            });
            if (ok) setEditTarget(null);
          }}
          onClose={() => setEditTarget(null)}
        />
      )}

      {reschedCounterTarget && reschedCounterTarget.game && (
        <RescheduleRequestModal
          title="Counter-propose reschedule"
          submitLabel="Send counter-proposal"
          game={{
            scheduled_at: reschedCounterTarget.game.scheduled_at,
            is_away: reschedCounterTarget.game.is_away,
            external_team_name: reschedCounterTarget.game.external_team_name,
            proposed_venue_name: reschedCounterTarget.game.proposed_venue_name,
            home_team: reschedCounterTarget.game.home_team
              ? { name: reschedCounterTarget.game.home_team.name }
              : null,
            venue: reschedCounterTarget.game.venue,
            interleague_org: reschedCounterTarget.game.interleague_org,
          }}
          initial={{
            scheduled_at: reschedCounterTarget.proposed_scheduled_at,
            venue_name: reschedCounterTarget.proposed_venue_name ?? "",
          }}
          busy={reschedBusyId === reschedCounterTarget.id}
          error={reschedError}
          onSubmit={async ({ scheduled_at, venue_name, note }) => {
            const ok = await respondReschedule(reschedCounterTarget.id, {
              action: "counter",
              scheduled_at,
              venue_name,
              note,
            });
            if (ok) setReschedCounterTarget(null);
          }}
          onClose={() => setReschedCounterTarget(null)}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-full max-w-sm">
          <div
            role="alert"
            className={`pointer-events-auto flex w-full items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
              toast.kind === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-[#22C55E]/30 bg-[#22C55E]/5 text-[#16a34a]"
            }`}
          >
            {toast.kind === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="-mr-1 -mt-1 rounded-md p-1 text-current/60 hover:bg-black/5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {declineTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && resolvingId !== declineTarget.id) {
              setDeclineTarget(null);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-semibold text-[#0C1F3F]">Decline this game?</h3>
                <p className="mt-1 text-sm text-gray-500">
                  It will be removed from the schedule and the recipient will be
                  notified.
                </p>
              </div>
            </div>
            <div className="flex gap-2 px-6 py-5">
              <button
                onClick={() => setDeclineTarget(null)}
                disabled={resolvingId === declineTarget.id}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ok = await resolveGame(declineTarget.id, {
                    action: "decline",
                  });
                  if (ok) setDeclineTarget(null);
                }}
                disabled={resolvingId === declineTarget.id}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {resolvingId === declineTarget.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {resolvingId === declineTarget.id ? "Declining…" : "Decline"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
