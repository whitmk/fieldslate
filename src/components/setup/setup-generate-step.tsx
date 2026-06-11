"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Loader2,
  PartyPopper,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { generateSchedule } from "@/lib/schedule/generate-schedule";
import { getDivisionGameCounts } from "@/lib/schedule/division-game-counts";

// Setup step 4 — adaptive generate step. Like every other step, its state is
// data-derived: divisions with zero games are "unscheduled"; when none are
// left the step collapses to the done screen (which is also what a fully
// set-up owner sees visiting /setup directly). Generation is a strictly
// SEQUENTIAL client-side loop over generateSchedule(divisionId) — later
// divisions must see earlier divisions' games (the planner pre-loads venue
// bookings from the DB), so no parallelism. Setup never regenerates a
// division that already has games; that lives in the normal product.

type DivisionRow = {
  id: string;
  name: string;
  team_count: number;
};

// Per-division outcome of THIS session's generation runs. DB-derived game
// counts decide scheduled/unscheduled; these statuses only add progress and
// honest warning/error detail on top.
type RunStatus =
  | { state: "running" }
  | {
      state: "done";
      gamesCreated: number;
      unscheduledCount: number;
      conflictGameCount: number;
    }
  | { state: "failed"; error: string };

interface Props {
  currentOrgId: string;
  seasonId: string;
  /** Defensive: zero divisions in the season → shell returns to step 3. */
  onBackToDivisions: () => void;
  /** Every division has games → shell marks the rail's step 4 done. */
  onAllScheduled: () => void;
  /** Loop running — shell disables its navigation (the later-link). */
  onRunningChange: (running: boolean) => void;
}

export function SetupGenerateStep({
  currentOrgId,
  seasonId,
  onBackToDivisions,
  onAllScheduled,
  onRunningChange,
}: Props) {
  const router = useRouter();
  const [initialLoading, setInitialLoading] = useState(true);
  const [seasonName, setSeasonName] = useState<string | null>(null);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [venueCount, setVenueCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [gameCounts, setGameCounts] = useState<Map<string, number>>(new Map());
  const [runStatuses, setRunStatuses] = useState<Record<string, RunStatus>>({});
  const [running, setRunning] = useState(false);
  // Distinguishes "generated this visit" from a direct visit by a finished
  // owner — the done screen only makes came-back-clean claims about runs it
  // actually watched.
  const [sessionRan, setSessionRan] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [leagueRes, divisionsRes, venuesRes, teamsRes] = await Promise.all([
      supabase
        .from("leagues")
        .select("id, name")
        .eq("id", seasonId)
        .maybeSingle(),
      supabase
        .from("divisions")
        .select("id, name, team_count")
        .eq("league_id", seasonId)
        .order("created_at", { ascending: true }),
      supabase
        .from("venues")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", currentOrgId),
      supabase
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("league_id", seasonId),
    ]);
    const divs = (divisionsRes.data as DivisionRow[] | null) ?? [];
    setSeasonName(
      (leagueRes.data as { name: string } | null)?.name ?? null,
    );
    setDivisions(divs);
    setVenueCount(venuesRes.count ?? 0);
    setTeamCount(teamsRes.count ?? 0);
    setGameCounts(
      await getDivisionGameCounts(supabase, seasonId, divs.map((d) => d.id)),
    );
  }, [seasonId, currentOrgId]);

  useEffect(() => {
    load().then(() => setInitialLoading(false));
  }, [load]);

  // Honest numbers: re-derive counts from the DB rather than trusting the
  // session's result objects.
  const refreshGameCounts = useCallback(async () => {
    const supabase = createClient();
    setGameCounts(
      await getDivisionGameCounts(
        supabase,
        seasonId,
        divisions.map((d) => d.id),
      ),
    );
  }, [seasonId, divisions]);

  const unscheduled = divisions.filter(
    (d) => (gameCounts.get(d.id) ?? 0) === 0,
  );
  const allScheduled = divisions.length > 0 && unscheduled.length === 0;
  const totalGames = divisions.reduce(
    (sum, d) => sum + (gameCounts.get(d.id) ?? 0),
    0,
  );

  // Defensive: nothing to generate without divisions — bounce to step 3.
  useEffect(() => {
    if (!initialLoading && divisions.length === 0) onBackToDivisions();
  }, [initialLoading, divisions.length, onBackToDivisions]);

  // Rail bookkeeping — idempotent (the shell's setStep bails on same value).
  useEffect(() => {
    if (!initialLoading && allScheduled) onAllScheduled();
  }, [initialLoading, allScheduled, onAllScheduled]);

  function setStatus(divisionId: string, status: RunStatus) {
    setRunStatuses((prev) => ({ ...prev, [divisionId]: status }));
  }

  // One division through generateSchedule with per-call failure isolation —
  // a throw or {success:false} marks THIS row failed and never aborts the
  // caller's loop or discards earlier results (statuses accumulate per id).
  async function generateOne(division: DivisionRow) {
    setStatus(division.id, { state: "running" });
    try {
      const res = await generateSchedule(division.id);
      if (res.success) {
        setStatus(division.id, {
          state: "done",
          gamesCreated: res.gamesCreated,
          unscheduledCount: res.unscheduledCount,
          conflictGameCount: res.conflicts.reduce(
            (n, c) => n + c.games.length,
            0,
          ),
        });
      } else {
        setStatus(division.id, { state: "failed", error: res.error });
      }
    } catch (err) {
      setStatus(division.id, {
        state: "failed",
        error: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  async function runGeneration(targets: DivisionRow[]) {
    if (running || targets.length === 0) return;
    setRunning(true);
    onRunningChange(true);
    setSessionRan(true);
    try {
      // Strictly sequential — see the header comment.
      for (const division of targets) {
        await generateOne(division);
      }
    } finally {
      await refreshGameCounts();
      setRunning(false);
      onRunningChange(false);
    }
  }

  if (initialLoading || divisions.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  // ── Done screen — every division has games ────────────────────────────────
  if (allScheduled && !running) {
    const sessionWarnings = divisions.flatMap((d) => {
      const status = runStatuses[d.id];
      if (status?.state !== "done") return [];
      const lines: { divisionId: string; text: string }[] = [];
      if (status.unscheduledCount > 0) {
        lines.push({
          divisionId: d.id,
          text: `${status.unscheduledCount} game${status.unscheduledCount !== 1 ? "s" : ""} couldn't be scheduled in ${d.name}`,
        });
      }
      if (status.conflictGameCount > 0) {
        lines.push({
          divisionId: d.id,
          text: `${status.conflictGameCount} game${status.conflictGameCount !== 1 ? "s" : ""} in ${d.name} have field conflicts`,
        });
      }
      return lines;
    });
    const sessionClean =
      sessionRan &&
      sessionWarnings.length === 0 &&
      Object.values(runStatuses).every((s) => s.state === "done");

    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <PartyPopper className="h-7 w-7 text-[#22C55E]" />
        </span>
        <div>
          <h2 className="text-xl font-bold text-[#0C1F3F]">
            Your league is ready
          </h2>
          <p className="mt-1.5 text-sm text-gray-600">
            {totalGames} game{totalGames !== 1 ? "s" : ""} scheduled across{" "}
            {divisions.length} division{divisions.length !== 1 ? "s" : ""}
            {seasonName ? ` in ${seasonName}` : ""}.
          </p>
          {sessionClean && (
            <p className="mt-1 text-sm text-[#22C55E]">
              Every division came back clean — no conflicts, nothing left
              unscheduled.
            </p>
          )}
        </div>

        {sessionWarnings.length > 0 && (
          <div className="flex w-full max-w-md flex-col gap-2">
            {sessionWarnings.map((w, i) => (
              <p
                key={i}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800"
              >
                {w.text} —{" "}
                <Link
                  href={`/dashboard/schedule?division=${w.divisionId}`}
                  className="font-semibold underline underline-offset-2"
                >
                  review them on your schedule page
                </Link>
                .
              </p>
            ))}
          </div>
        )}

        <button
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
        >
          Go to my dashboard
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Generate state — some divisions unscheduled (or loop in flight) ───────
  return (
    <div className="flex flex-col gap-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Venues", value: String(venueCount) },
          { label: "Season", value: seasonName ?? "—" },
          { label: "Divisions", value: String(divisions.length) },
          { label: "Teams", value: String(teamCount) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-gray-100 bg-white px-4 py-3"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              {stat.label}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-[#0C1F3F]">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Division status list */}
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        {divisions.map((d) => {
          const count = gameCounts.get(d.id) ?? 0;
          const status = runStatuses[d.id];
          const isQueued = running && !status && count === 0;

          return (
            <div
              key={d.id}
              className="flex flex-col gap-1 border-b border-gray-50 px-4 py-3 last:border-0"
            >
              <div className="flex items-center gap-3">
                {status?.state === "running" ? (
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-[#22C55E]" />
                ) : status?.state === "failed" ? (
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
                ) : count > 0 ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-[#22C55E]" />
                ) : (
                  <span className="h-2 w-2 flex-shrink-0 rounded-full border border-gray-300 bg-gray-100" />
                )}
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                  {d.name}
                </p>
                {status?.state === "running" ? (
                  <p className="text-xs font-medium text-[#22C55E]">
                    Scheduling…
                  </p>
                ) : status?.state === "failed" ? (
                  <button
                    onClick={() =>
                      void runGeneration([d])
                    }
                    disabled={running}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                ) : count > 0 ? (
                  <p className="text-xs text-gray-500">
                    {count} game{count !== 1 ? "s" : ""}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">
                    {isQueued ? "Waiting…" : "Not scheduled yet"}
                  </p>
                )}
              </div>

              {/* Honest per-division detail under the row */}
              {status?.state === "failed" && (
                <p className="ml-7 text-xs text-red-600">{status.error}</p>
              )}
              {status?.state === "done" &&
                (status.unscheduledCount > 0 ||
                  status.conflictGameCount > 0) && (
                  <p className="ml-7 text-xs text-amber-700">
                    {[
                      status.unscheduledCount > 0
                        ? `${status.unscheduledCount} game${status.unscheduledCount !== 1 ? "s" : ""} couldn't be scheduled`
                        : null,
                      status.conflictGameCount > 0
                        ? `${status.conflictGameCount} game${status.conflictGameCount !== 1 ? "s" : ""} have field conflicts`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    —{" "}
                    <Link
                      href={`/dashboard/schedule?division=${d.id}`}
                      className="font-semibold underline underline-offset-2"
                    >
                      review on your schedule page
                    </Link>
                  </p>
                )}
            </div>
          );
        })}
      </div>

      {/* Generate CTA */}
      <div className="flex flex-col items-end gap-2 border-t border-gray-200 pt-5">
        <button
          onClick={() => void runGeneration(unscheduled)}
          disabled={running || unscheduled.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <CalendarDays className="h-4 w-4" />
              Generate schedules
            </>
          )}
        </button>
        <p className="text-xs text-gray-400">
          {running
            ? "Scheduling one division at a time so later divisions route around earlier games."
            : `${unscheduled.length} of ${divisions.length} division${divisions.length !== 1 ? "s" : ""} need${unscheduled.length === 1 ? "s" : ""} schedules. Already-scheduled divisions won't be touched.`}
        </p>
      </div>
    </div>
  );
}
