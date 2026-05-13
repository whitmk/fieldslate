"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarX, Plus, X, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type BlackoutRow = { id: string; date: string; label: string | null };

type AffectedGame = {
  id: string;
  scheduled_at: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
};

interface Props {
  leagueId: string;
}

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BlackoutDatesPanel({ leagueId }: Props) {
  const [blackouts, setBlackouts] = useState<BlackoutRow[]>([]);
  const [affectedGames, setAffectedGames] = useState<AffectedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const [{ data: blackoutData }, { data: gamesData }] = await Promise.all([
      supabase
        .from("blackout_dates")
        .select("id, date, label")
        .eq("league_id", leagueId)
        .order("date"),
      supabase
        .from("games")
        .select(
          "id, scheduled_at, home_team:teams!home_team_id(name), away_team:teams!away_team_id(name)",
        )
        .eq("league_id", leagueId),
    ]);

    const bouts = ((blackoutData ?? []) as unknown as BlackoutRow[]);
    const games = ((gamesData ?? []) as unknown as AffectedGame[]);

    setBlackouts(bouts);

    const blackoutSet = new Set(bouts.map((b) => b.date));
    setAffectedGames(
      games.filter((g) => blackoutSet.has(g.scheduled_at.substring(0, 10))),
    );

    setLoading(false);
  }, [leagueId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAdd() {
    if (!newDate) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const { error: insertErr } = await supabase
      .from("blackout_dates")
      .insert({
        league_id: leagueId,
        date: newDate,
        label: newLabel.trim() || null,
      } as never);

    if (insertErr) {
      setError(insertErr.message);
    } else {
      setNewDate("");
      setNewLabel("");
      setAdding(false);
      await fetchData();
    }
    setSaving(false);
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    const supabase = createClient();
    await supabase.from("blackout_dates").delete().eq("id", id);
    await fetchData();
    setRemovingId(null);
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">

      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <CalendarX className="h-4 w-4 text-gray-400" />
          <h2 className="font-semibold text-[#0C1F3F]">Blackout Dates</h2>
          {blackouts.length > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              {blackouts.length}
            </span>
          )}
        </div>
        <button
          onClick={() => { setAdding(true); setError(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Date
        </button>
      </div>

      {/* ── Add form ── */}
      {adding && (
        <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-4">
          <p className="mb-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            New Blackout Date
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Date *</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#0C1F3F] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Label (optional)</label>
              <input
                type="text"
                placeholder="e.g. Memorial Day"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="min-w-52 rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#0C1F3F] placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#22C55E]/40"
              />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <button
                onClick={handleAdd}
                disabled={!newDate || saving}
                className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setAdding(false); setNewDate(""); setNewLabel(""); setError(null); }}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-500">{error}</p>
          )}
        </div>
      )}

      {/* ── Conflict warning: existing games land on a blackout date ── */}
      {affectedGames.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-6 py-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-700">
                {affectedGames.length} existing game{affectedGames.length !== 1 ? "s" : ""} fall on a blackout date
              </p>
              <ul className="mt-1.5 space-y-1">
                {affectedGames.slice(0, 5).map((g) => (
                  <li key={g.id} className="text-xs text-amber-600">
                    <span className="font-medium">{fmtDate(g.scheduled_at.substring(0, 10))}</span>
                    {" — "}
                    {g.home_team?.name ?? "TBD"} vs {g.away_team?.name ?? "TBD"}
                  </li>
                ))}
                {affectedGames.length > 5 && (
                  <li className="text-xs text-amber-500">and {affectedGames.length - 5} more…</li>
                )}
              </ul>
              <p className="mt-2 text-xs text-amber-600">
                These games won&apos;t be removed automatically — regenerate the schedule or edit them individually to resolve.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="flex justify-center py-8">
          <svg className="h-5 w-5 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : blackouts.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
          <CalendarX className="h-6 w-6 text-gray-200" />
          <p className="mt-3 text-sm font-medium text-[#0C1F3F]">No blackout dates</p>
          <p className="mt-1 text-xs text-gray-400">
            Dates added here will be skipped when generating any division&apos;s schedule.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {blackouts.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-6 py-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-50">
                  <CalendarX className="h-4 w-4 text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#0C1F3F]">
                    {b.label ?? (
                      <span className="font-normal italic text-gray-400">No label</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">{fmtDate(b.date)}</p>
                </div>
              </div>
              <button
                onClick={() => handleRemove(b.id)}
                disabled={removingId === b.id}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400 disabled:opacity-40"
                aria-label="Remove blackout date"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
