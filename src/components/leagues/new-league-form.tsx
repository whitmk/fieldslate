"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { UpgradeModal, type CapName } from "@/components/plan/upgrade-cta";
import type { Plan } from "@/lib/plan/limits";

const SPORTS = [
  "Baseball",
  "Softball",
  "Soccer",
  "Football",
  "Basketball",
  "Volleyball",
  "Lacrosse",
  "Hockey",
] as const;

function getSeasonLabel(startDate: string): string {
  const month = new Date(startDate + "T00:00:00").getMonth() + 1;
  const year = new Date(startDate + "T00:00:00").getFullYear();
  if (month >= 3 && month <= 5) return `Spring ${year}`;
  if (month >= 6 && month <= 8) return `Summer ${year}`;
  if (month >= 9 && month <= 11) return `Fall ${year}`;
  return `Winter ${year}`;
}

interface Props {
  currentOrgId: string;
  /** When provided, called with the new league id on success INSTEAD of the
   *  default redirect to the season detail page — embedders (the /setup
   *  wizard) own post-create navigation. Absent = behavior unchanged. */
  onCreated?: (leagueId: string) => void;
}

export function NewLeagueForm({ currentOrgId, onCreated }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sport, setSport] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [season, setSeason] = useState("");
  const [seasonEdited, setSeasonEdited] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [capHit, setCapHit] = useState<
    | { cap: CapName; limit: number; plan: Plan }
    | null
  >(null);

  // Auto-populate season label from start date unless admin has typed a custom value
  useEffect(() => {
    if (startDate && !seasonEdited) {
      setSeason(getSeasonLabel(startDate));
    }
  }, [startDate, seasonEdited]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (endDate && startDate && endDate < startDate) {
      setError("End date must be after start date.");
      return;
    }

    setLoading(true);

    const supabase = createClient();

    const seasonValue = season.trim() || (startDate ? getSeasonLabel(startDate) : "Season 1");

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "create_league" as never,
      {
        p_org_id: currentOrgId,
        p_name: name.trim(),
        p_sport: sport,
        p_season: seasonValue,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      } as never,
    );

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    const payload = rpcData as
      | { row: { id: string } }
      | { error: "cap_reached"; cap: CapName; limit: number; plan: Plan };

    if ("error" in payload && payload.error === "cap_reached") {
      setCapHit({ cap: payload.cap, limit: payload.limit, plan: payload.plan });
      setLoading(false);
      return;
    }

    const league = (payload as { row: { id: string } }).row;
    if (onCreated) {
      // Leave `loading` true — the embedder is about to swap this form out,
      // and re-enabling the button first would invite a double submit.
      onCreated(league.id);
      return;
    }
    router.push(`/dashboard/leagues/${league.id}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      {/* Back link */}
      <Link
        href="/dashboard/leagues"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to seasons
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#0C1F3F]">Create a season</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter the basics — you can add divisions and teams after.
        </p>
      </div>

      {/* Form card */}
      <div className="rounded-xl border border-gray-100 bg-white p-8 shadow-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">

          {/* Season name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium text-gray-700">
              Season name
            </label>
            <input
              id="name"
              type="text"
              placeholder="Riverside Youth Baseball"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          {/* Sport */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sport" className="text-sm font-medium text-gray-700">
              Sport
            </label>
            <select
              id="sport"
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              required
              className="h-11 w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            >
              <option value="" disabled>Select a sport…</option>
              {SPORTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="startDate" className="text-sm font-medium text-gray-700">
                Season start
              </label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="endDate" className="text-sm font-medium text-gray-700">
                Season end
              </label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
          </div>

          {/* Season label — editable, auto-populated from start date */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="season" className="text-sm font-medium text-gray-700">
              Season label
            </label>
            <input
              id="season"
              type="text"
              placeholder="e.g. Spring 2026, Fall Ball 2026"
              value={season}
              onChange={(e) => {
                setSeason(e.target.value);
                setSeasonEdited(true);
              }}
              required
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
            <p className="text-xs text-gray-400">
              Auto-filled from start date — type over it to use a custom name.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
            <Link
              href="/dashboard/leagues"
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : null}
              {loading ? "Creating…" : "Create season"}
            </button>
          </div>
        </form>
      </div>

      {capHit ? (
        <UpgradeModal
          cap={capHit.cap}
          limit={capHit.limit}
          currentPlan={capHit.plan}
          onClose={() => setCapHit(null)}
        />
      ) : null}
    </div>
  );
}
