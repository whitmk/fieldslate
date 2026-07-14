"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, X, Loader2, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getOfficialTitleLower } from "@/lib/utils/official-title";
import {
  coachTeamLabel,
  fetchCoachTeamOptions,
  type CoachTeamOption,
} from "@/lib/umpires/team-options";

export type UmpireRow = {
  id: string;
  name: string;
  designation: string;
  season_id: string;
  pay_rate: number | null;
  email: string | null;
  phone: string | null;
  max_games_per_week: number | null;
  notes: string | null;
  team_id: string | null;
  season: { name: string; sport?: string | null } | null;
  team: { name: string; division: { name: string } | null } | null;
  /** Embedded id-only rows — presence only, for the roster availability hint. */
  official_availability: { id: string }[] | null;
  official_blackouts: { id: string }[] | null;
};

export type SeasonPaySettings = {
  id: string;
  sport?: string | null;
  pay_tracking_enabled: boolean;
  pay_rate_mode: "per_umpire" | "per_role";
};

interface Props {
  umpires: UmpireRow[];
  showSeasonColumn: boolean;
  seasonPaySettings: SeasonPaySettings[];
}

function getPaySettings(seasonId: string, settings: SeasonPaySettings[]): SeasonPaySettings | null {
  return settings.find((s) => s.id === seasonId) ?? null;
}

// Roster-scan hint: who has real scheduling constraints entered without
// clicking into each official. Zero of both = the eligibility.ts default.
function availabilityHint(u: UmpireRow): string {
  const windows = u.official_availability?.length ?? 0;
  const dates = u.official_blackouts?.length ?? 0;
  if (windows === 0 && dates === 0) return "Available anytime";
  if (windows > 0 && dates > 0) return "Availability + blackout dates set";
  return windows > 0 ? "Availability set" : "Blackout dates set";
}

export function UmpireList({ umpires, showSeasonColumn, seasonPaySettings }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<UmpireRow | null>(null);
  const [deleting, setDeleting] = useState<UmpireRow | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const anyPayTracking = seasonPaySettings.some((s) => s.pay_tracking_enabled);

  async function handleDelete(umpire: UmpireRow) {
    setPending(umpire.id);
    const supabase = createClient();
    const { error } = await supabase.from("umpires").delete().eq("id", umpire.id);
    setPending(null);
    if (error) {
      alert(
        `Failed to delete ${getOfficialTitleLower(umpire.season?.sport)}: ${error.message}`,
      );
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  if (umpires.length === 0) {
    return null;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="pb-3 font-medium text-gray-500">Name</th>
              <th className="pb-3 font-medium text-gray-500">Designation</th>
              {showSeasonColumn && (
                <th className="pb-3 font-medium text-gray-500">Season</th>
              )}
              {anyPayTracking && (
                <th className="pb-3 font-medium text-gray-500">Pay rate</th>
              )}
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {umpires.map((u) => {
              const ps = getPaySettings(u.season_id, seasonPaySettings);
              const showPay = ps?.pay_tracking_enabled ?? false;
              return (
                <tr key={u.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-3">
                    <p className="font-medium text-gray-900">{u.name}</p>
                    {u.team?.name && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        Coaches {coachTeamLabel(u.team.name, u.team.division?.name)}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-400">
                      {availabilityHint(u)}
                    </p>
                  </td>
                  <td className="py-3">
                    <Badge variant={u.designation === "adult" ? "info" : "success"}>
                      {u.designation === "adult" ? "Adult" : "Youth"}
                    </Badge>
                  </td>
                  {showSeasonColumn && (
                    <td className="py-3 text-gray-600">{u.season?.name ?? "—"}</td>
                  )}
                  {anyPayTracking && (
                    <td className="py-3 text-gray-600">
                      {!showPay ? (
                        <span className="text-gray-300">—</span>
                      ) : ps?.pay_rate_mode === "per_role" ? (
                        <span className="text-xs text-gray-400 italic">Per role</span>
                      ) : u.pay_rate != null ? (
                        <span className="font-medium tabular-nums text-gray-800">
                          ${u.pay_rate.toFixed(2)}/game
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600">Not set</span>
                      )}
                    </td>
                  )}
                  <td className="py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        href={`/dashboard/umpires/${u.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                      >
                        <CalendarDays className="h-3 w-3" />
                        View schedule
                      </Link>
                      <button
                        onClick={() => setEditing(u)}
                        disabled={pending === u.id}
                        aria-label={`Edit ${u.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F] disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleting(u)}
                        disabled={pending === u.id}
                        aria-label={`Delete ${u.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      >
                        {pending === u.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Mobile card list — same rows and actions as the table */}
        <ul className="flex flex-col gap-3 md:hidden">
          {umpires.map((u) => {
            const ps = getPaySettings(u.season_id, seasonPaySettings);
            const showPay = ps?.pay_tracking_enabled ?? false;
            return (
              <li key={u.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#0C1F3F]">{u.name}</p>
                    {u.team?.name && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        Coaches {coachTeamLabel(u.team.name, u.team.division?.name)}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-400">
                      {availabilityHint(u)}
                    </p>
                    {showSeasonColumn && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {u.season?.name ?? "—"}
                      </p>
                    )}
                    {anyPayTracking && showPay && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {ps?.pay_rate_mode === "per_role" ? (
                          <span className="italic text-gray-400">Paid per role</span>
                        ) : u.pay_rate != null ? (
                          <span className="font-medium tabular-nums">
                            ${u.pay_rate.toFixed(2)}/game
                          </span>
                        ) : (
                          <span className="text-amber-600">Pay rate not set</span>
                        )}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={u.designation === "adult" ? "info" : "success"}
                    className="flex-shrink-0"
                  >
                    {u.designation === "adult" ? "Adult" : "Youth"}
                  </Badge>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/dashboard/umpires/${u.id}`}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                  >
                    <CalendarDays className="h-4 w-4" />
                    Schedule
                  </Link>
                  <button
                    onClick={() => setEditing(u)}
                    disabled={pending === u.id}
                    aria-label={`Edit ${u.name}`}
                    className="flex min-h-[44px] w-12 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:opacity-50"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleting(u)}
                    disabled={pending === u.id}
                    aria-label={`Delete ${u.name}`}
                    className="flex min-h-[44px] w-12 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                  >
                    {pending === u.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {editing && (
        <EditUmpireModal
          umpire={editing}
          paySettings={getPaySettings(editing.season_id, seasonPaySettings)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {deleting && (
        <DeleteUmpireDialog
          umpire={deleting}
          loading={pending === deleting.id}
          onCancel={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      )}
    </>
  );
}

// ── Edit modal ───────────────────────────────────────────────────────────────

function EditUmpireModal({
  umpire,
  paySettings,
  onClose,
  onSaved,
}: {
  umpire: UmpireRow;
  paySettings: SeasonPaySettings | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(umpire.name);
  const [designation, setDesignation] = useState<"youth" | "adult">(
    umpire.designation === "adult" ? "adult" : "youth",
  );
  const [payRate, setPayRate] = useState<string>(
    umpire.pay_rate != null ? String(umpire.pay_rate) : "",
  );
  const [email, setEmail] = useState(umpire.email ?? "");
  const [phone, setPhone] = useState(umpire.phone ?? "");
  const [maxGames, setMaxGames] = useState<string>(
    umpire.max_games_per_week != null ? String(umpire.max_games_per_week) : "",
  );
  const [notes, setNotes] = useState(umpire.notes ?? "");
  const [teamId, setTeamId] = useState(umpire.team_id ?? "");
  const [teams, setTeams] = useState<CoachTeamOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Coached-team options for this official's season (coach conflict link,
  // migration 0063).
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchCoachTeamOptions(supabase, umpire.season_id).then((options) => {
      if (!cancelled) setTeams(options);
    });
    return () => {
      cancelled = true;
    };
  }, [umpire.season_id]);

  const showPayRate =
    paySettings?.pay_tracking_enabled && paySettings?.pay_rate_mode === "per_umpire";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    const supabase = createClient();
    const updates: Record<string, unknown> = {
      name: name.trim(),
      designation,
      email: email.trim() || null,
      phone: phone.trim() || null,
      max_games_per_week:
        maxGames !== "" ? Math.max(1, parseInt(maxGames, 10) || 1) : null,
      notes: notes.trim() || null,
      team_id: teamId || null,
    };
    if (showPayRate) {
      updates.pay_rate = payRate !== "" ? parseFloat(payRate) || null : null;
    }
    const { error: updateError } = await supabase
      .from("umpires")
      .update(updates as never)
      .eq("id", umpire.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">
            Edit {getOfficialTitleLower(umpire.season?.sport)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5 overflow-y-auto px-6 py-6"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-gray-700">Designation</span>
            <div className="flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1">
              {(["youth", "adult"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDesignation(d)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-all ${
                    designation === d
                      ? "bg-white text-[#0C1F3F] shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          {showPayRate && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Pay rate <span className="font-normal text-gray-400">($ per game)</span>
              </label>
              <div className="flex items-center gap-1 rounded-lg border border-gray-200 px-3">
                <span className="text-sm text-gray-400">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payRate}
                  onChange={(e) => setPayRate(e.target.value)}
                  placeholder="0.00"
                  className="h-11 flex-1 bg-transparent text-sm text-gray-900 focus:outline-none"
                />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Email <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="email"
              placeholder="ump@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Phone <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="tel"
              placeholder="(555) 555-5555"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Max games per week{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="number"
              min={1}
              placeholder="No limit"
              value={maxGames}
              onChange={(e) => setMaxGames(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          {(teams.length > 0 || umpire.team_id) && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Coaches team{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              >
                <option value="">— None —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {coachTeamLabel(t.name, t.division?.name)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400">
                Auto-assign skips games involving this team; manual assignments
                show a warning.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Notes <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              rows={2}
              placeholder="Prefers weekend games…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600">
              {error}
            </p>
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
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm dialog ────────────────────────────────────────────────────

function DeleteUmpireDialog({
  umpire,
  loading,
  onCancel,
  onConfirm,
}: {
  umpire: UmpireRow;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !loading && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-red-500" />
          <h3 className="text-base font-bold text-[#0C1F3F]">
            Delete {getOfficialTitleLower(umpire.season?.sport)}?
          </h3>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          <span className="font-semibold">{umpire.name}</span> will be permanently removed
          from this season. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {loading ? "Deleting…" : `Delete ${getOfficialTitleLower(umpire.season?.sport)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
