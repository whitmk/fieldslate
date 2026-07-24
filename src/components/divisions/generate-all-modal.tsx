"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X, CalendarDays, Loader2, CheckCircle2, AlertTriangle, PartyPopper, Lock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { generateSchedule } from "@/lib/schedule/generate-schedule";
import { fetchDivisionLocks } from "@/lib/schedule/division-lock";
import {
  detectSeasonCoachConflicts,
  type CoachConflict,
} from "@/lib/schedule/detect-coach-conflicts";
import { CoachConflictNotice } from "@/components/schedule/coach-conflict-notice";
import { getDivisionGameCounts } from "@/lib/schedule/division-game-counts";
import { parseAvailability, type VenueAvailability } from "@/lib/venues/availability";
import {
  scarcityKey,
  orderByScarcity,
  type DivisionScarcityInput,
} from "@/lib/schedule/scarcity-order";
import type { Division } from "@/types/database";

// Season-page "generate all divisions" batch control. This is the "all"
// counterpart to the per-division generate button that already lives in each
// DivisionSchedulePanel — same mold as the rainout/export quick actions, where
// a season-level card opens a modal that resolves scope internally.
//
// Divisions are run in SCARCITY ORDER (most boxed-in first) so a tight
// division claims its scarce slots before a roomy one can take them. The
// order is computed up front from stored data via src/lib/schedule/
// scarcity-order.ts — no generator run is needed to decide it.
//
// The batch loop here is a FRESH, self-contained copy of the three behaviors
// the setup wizard's loop has (sequential; per-division try/catch isolation;
// skip already-scheduled via a live re-count). It deliberately does NOT share
// a kernel with setup-generate-step.tsx — the small duplication is intended so
// the two surfaces can evolve independently.

interface Props {
  leagueId: string;
  divisions: Division[];
  onClose: () => void;
  /** Fires after the batch finishes (any outcome) so the host can refresh. */
  onGenerated: () => void;
}

// Ordered division with the metadata the list + summary need.
type PlannedDivision = {
  id: string;
  name: string;
  supply: number;
  demand: number;
  slack: number;
  // Games already in the DB at plan time — >0 means it'll be skipped.
  existingGames: number;
  // Schedule lock (0080/0082). A locked division is skipped and NAMED in the
  // summary — generate-all is a season-level action and must never refuse the
  // whole run because one division is locked, nor silently regenerate a
  // locked one.
  locked: boolean;
};

type RunStatus =
  | { state: "running" }
  | {
      state: "done";
      gamesCreated: number;
      unscheduledCount: number;
      constraintBlockedCount: number;
      preferMissCount: number;
      // Rendered VERBATIM — never hand-write a shortfall sentence here.
      shortfallSummary: string | null;
      conflictGameCount: number;
    }
  | { state: "failed"; error: string }
  // Live re-count found games since planning — left untouched, not regenerated.
  | { state: "skipped" }
  // Division is locked. Distinct from "skipped" on purpose: "already
  // scheduled" and "you locked this" are different facts and the admin needs
  // to know which one applied.
  | { state: "skipped_locked" };

export function GenerateAllModal({
  leagueId,
  divisions,
  onClose,
  onGenerated,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlannedDivision[]>([]);
  const [statuses, setStatuses] = useState<Record<string, RunStatus>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  // Season-wide shared-coach conflicts, detected once after the whole batch
  // finishes (a coach can span divisions, so this can only be judged with every
  // division generated). Distinct from the per-division venue conflicts above.
  const [coachConflicts, setCoachConflicts] = useState<CoachConflict[]>([]);

  // ── Plan: score every division up front, order by scarcity ────────────────
  const buildPlan = useCallback(async () => {
    setLoading(true);
    setPlanError(null);
    try {
      const supabase = createClient();
      const divIds = divisions.map((d) => d.id);
      if (divIds.length === 0) {
        setPlan([]);
        setLoading(false);
        return;
      }

      const [teamsRes, dvRes, igRes, blackoutRes, counts] = await Promise.all([
        supabase
          .from("teams")
          .select("id, division_id")
          .eq("league_id", leagueId),
        supabase
          .from("division_venues")
          .select("division_id, venue_id, allow_games")
          .in("division_id", divIds)
          .eq("allow_games", true),
        supabase
          .from("division_interleague_games")
          .select("division_id, game_count, home_games_per_team")
          .in("division_id", divIds),
        supabase
          .from("blackout_dates")
          .select("date")
          .eq("league_id", leagueId),
        getDivisionGameCounts(supabase, leagueId, divIds),
      ]);

      if (teamsRes.error) throw new Error(teamsRes.error.message);
      if (dvRes.error) throw new Error(dvRes.error.message);

      // teams per division
      const teamCount = new Map<string, number>();
      for (const t of (teamsRes.data ?? []) as {
        id: string;
        division_id: string | null;
      }[]) {
        if (!t.division_id) continue;
        teamCount.set(t.division_id, (teamCount.get(t.division_id) ?? 0) + 1);
      }

      // game-allowed venue ids per division
      const venueIdsByDiv = new Map<string, string[]>();
      const allVenueIds = new Set<string>();
      for (const r of (dvRes.data ?? []) as {
        division_id: string;
        venue_id: string;
      }[]) {
        if (!venueIdsByDiv.has(r.division_id)) venueIdsByDiv.set(r.division_id, []);
        venueIdsByDiv.get(r.division_id)!.push(r.venue_id);
        allVenueIds.add(r.venue_id);
      }

      // availability-configured venues only (buildSlots ignores the rest, so
      // the supply count must too — matches generateSchedule's venue filter).
      const venueAvailability = new Map<string, VenueAvailability>();
      if (allVenueIds.size > 0) {
        const { data: venueRows, error: venueErr } = await supabase
          .from("venues")
          .select("id, availability, availability_configured")
          .in("id", [...allVenueIds])
          .eq("availability_configured", true);
        if (venueErr) throw new Error(venueErr.message);
        for (const v of (venueRows ?? []) as {
          id: string;
          availability: unknown;
          availability_configured: boolean;
        }[]) {
          venueAvailability.set(v.id, parseAvailability(v.availability));
        }
      }

      // interleague HOME games per division (they consume a local venue slot)
      const homeInterleagueByDiv = new Map<string, number>();
      for (const r of (igRes.data ?? []) as {
        division_id: string;
        game_count: number | null;
        home_games_per_team: number | null;
      }[]) {
        const total = Number(r.game_count ?? 0);
        const homePerTeam = Math.max(
          0,
          Math.min(total, Number(r.home_games_per_team ?? 0)),
        );
        const teams = teamCount.get(r.division_id) ?? 0;
        homeInterleagueByDiv.set(
          r.division_id,
          (homeInterleagueByDiv.get(r.division_id) ?? 0) + homePerTeam * teams,
        );
      }

      const blackoutDates = new Set(
        ((blackoutRes.data ?? []) as { date: string }[]).map((b) => b.date),
      );

      const inputs: DivisionScarcityInput[] = divisions.map((div) => {
        const settings = (div.settings ?? {}) as Record<string, unknown>;
        const gamesPerTeam = Number(
          (div.intra_division_games_per_team ??
            (settings.games_per_team as number | undefined) ??
            0) as number,
        );
        // Venues this division can use, restricted to the configured set.
        const venueIds = (venueIdsByDiv.get(div.id) ?? []).filter((id) =>
          venueAvailability.has(id),
        );
        return {
          divisionId: div.id,
          createdAt: div.created_at,
          startDate: div.start_date ?? "",
          endDate: div.end_date ?? "",
          settings: div.settings as unknown as DivisionScarcityInput["settings"],
          venueIds,
          venueAvailability,
          blackoutDates,
          teamCount: teamCount.get(div.id) ?? 0,
          gamesPerTeam,
          homeInterleagueGames: homeInterleagueByDiv.get(div.id) ?? 0,
        };
      });

      const nameById = new Map(divisions.map((d) => [d.id, d.name]));
      // Lock state for the plan table. Throws on a read error, which the
      // catch below turns into planError — a lock we can't read must not
      // render as unlocked and get regenerated.
      const locks = await fetchDivisionLocks(
        createClient(),
        divisions.map((d) => d.id),
      );
      const ordered = orderByScarcity(inputs.map(scarcityKey));
      setPlan(
        ordered.map((k) => ({
          id: k.divisionId,
          name: nameById.get(k.divisionId) ?? "Division",
          supply: k.supply,
          demand: k.demand,
          slack: k.slack,
          existingGames: counts.get(k.divisionId) ?? 0,
          locked: !!locks.get(k.divisionId)?.locked,
        })),
      );
    } catch (err) {
      setPlanError(
        err instanceof Error ? err.message : "Couldn't prepare the schedule plan.",
      );
    } finally {
      setLoading(false);
    }
  }, [divisions, leagueId]);

  useEffect(() => {
    void buildPlan();
  }, [buildPlan]);

  // Divisions that will actually be generated: zero games at plan time AND
  // not locked. Locked ones are reported below rather than attempted.
  const targets = plan.filter((p) => p.existingGames === 0 && !p.locked);
  const lockedSkipped = plan.filter((p) => p.locked);

  // ── Fresh sequential loop — the three reproduced behaviors ────────────────
  async function generateOne(divId: string) {
    setStatuses((prev) => ({ ...prev, [divId]: { state: "running" } }));
    try {
      // Behavior 3: skip already-scheduled via a LIVE re-count, so a division
      // another tab scheduled since planning is left untouched rather than
      // wiped by generateSchedule's delete+recreate.
      const live = await getDivisionGameCounts(createClient(), leagueId, [divId]);
      if ((live.get(divId) ?? 0) > 0) {
        setStatuses((prev) => ({ ...prev, [divId]: { state: "skipped" } }));
        return;
      }
      // Live re-read of the lock too, same race as the game count: another
      // admin may have locked this division since the plan was built.
      const liveLocks = await fetchDivisionLocks(createClient(), [divId]);
      if (liveLocks.get(divId)?.locked) {
        setStatuses((prev) => ({ ...prev, [divId]: { state: "skipped_locked" } }));
        return;
      }
      const res = await generateSchedule(divId);
      if (res.success) {
        setStatuses((prev) => ({
          ...prev,
          [divId]: {
            state: "done",
            gamesCreated: res.gamesCreated,
            unscheduledCount: res.unscheduledCount,
            constraintBlockedCount: res.constraintBlockedCount,
            preferMissCount: res.preferMissCount,
            shortfallSummary: res.shortfallSummary,
            conflictGameCount: res.conflicts.reduce(
              (n, c) => n + c.games.length,
              0,
            ),
          },
        }));
      } else {
        setStatuses((prev) => ({
          ...prev,
          [divId]: { state: "failed", error: res.error },
        }));
      }
    } catch (err) {
      // Behavior 2: per-division isolation — a throw marks only this row and
      // never aborts the loop.
      setStatuses((prev) => ({
        ...prev,
        [divId]: {
          state: "failed",
          error: err instanceof Error ? err.message : "Unexpected error.",
        },
      }));
    }
  }

  async function runAll() {
    if (running || targets.length === 0) return;
    setRunning(true);
    try {
      // Behavior 1: strictly sequential so each division's run pre-loads the
      // persisted games of divisions generated before it (shared-venue
      // bookings). No parallelism.
      for (const p of targets) {
        await generateOne(p.id);
      }
      // One season-wide shared-coach sweep now that every division is placed.
      // Read-only and additive — a failure must not mask a successful batch, so
      // it fails soft to an empty list.
      try {
        setCoachConflicts(await detectSeasonCoachConflicts(createClient(), leagueId));
      } catch (err) {
        console.error("coach-conflict detection failed", err);
        setCoachConflicts([]);
      }
    } finally {
      setRunning(false);
      setFinished(true);
      onGenerated();
    }
  }

  // ── Completion summary — every shortfall named, no silent drops ───────────
  function summaryLine(p: PlannedDivision): {
    tone: "ok" | "warn" | "note";
    text: string;
  } {
    const s = statuses[p.id];
    if (!s || s.state === "running") return { tone: "note", text: `${p.name}: …` };
    if (s.state === "skipped") {
      return { tone: "note", text: `${p.name}: already scheduled — left untouched.` };
    }
    if (s.state === "skipped_locked") {
      return { tone: "note", text: `${p.name}: locked — skipped, not regenerated.` };
    }
    if (s.state === "failed") {
      return { tone: "warn", text: `${p.name}: couldn't generate — ${s.error}` };
    }
    // done
    if (s.unscheduledCount > 0) {
      const attempted = s.gamesCreated + s.unscheduledCount;
      // The generator names the cause; this surface only reports the count.
      // No lever advice and no hard-coded interpretation — the old
      // "no available slots in allowed windows" guess was wrong twice.
      const head = `${p.name}: ${s.unscheduledCount} of ${attempted} games couldn't be placed.`;
      return {
        tone: "warn",
        text: s.shortfallSummary ? `${head} ${s.shortfallSummary}` : head,
      };
    }
    if (s.preferMissCount > 0) {
      return {
        tone: "note",
        text: `${p.name}: ${s.gamesCreated} games scheduled · ${s.preferMissCount} placed outside team preferences.`,
      };
    }
    return {
      tone: "ok",
      text: `${p.name}: ${s.gamesCreated} game${s.gamesCreated !== 1 ? "s" : ""} scheduled.`,
    };
  }

  const allClean =
    finished &&
    targets.length > 0 &&
    coachConflicts.length === 0 &&
    targets.every((p) => {
      const s = statuses[p.id];
      return s?.state === "done" && s.unscheduledCount === 0;
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-[#0C1F3F]">Generate all divisions</h3>
            <p className="mt-0.5 text-xs text-gray-400">
              Most-constrained divisions are scheduled first so they claim their
              scarce slots before roomier ones.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : planError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {planError}
            </p>
          ) : plan.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No divisions to generate. Add a division first.
            </p>
          ) : (
            <>
              {lockedSkipped.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-800">
                    <span className="font-semibold">
                      {lockedSkipped.length} locked division
                      {lockedSkipped.length === 1 ? "" : "s"} will be skipped:
                    </span>{" "}
                    {lockedSkipped.map((p) => p.name).join(", ")}. The rest still
                    generate — unlock a division to include it.
                  </p>
                </div>
              )}

              {/* Ordered division list (run order = display order) */}
              <ol className="flex flex-col gap-1.5">
                {plan.map((p, i) => {
                  const s = statuses[p.id];
                  const willSkip = p.existingGames > 0;
                  return (
                    <li
                      key={p.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                        p.locked ? "border-amber-200 bg-amber-50/60" : "border-gray-100"
                      }`}
                    >
                      <span className="w-5 flex-shrink-0 text-center text-xs font-semibold text-gray-300">
                        {i + 1}
                      </span>
                      <span className="flex-shrink-0">
                        {s?.state === "running" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[#22C55E]" />
                        ) : s?.state === "failed" ? (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        ) : s?.state === "done" || s?.state === "skipped" ? (
                          <CheckCircle2 className="h-4 w-4 text-[#22C55E]" />
                        ) : p.locked || s?.state === "skipped_locked" ? (
                          <Lock className="h-4 w-4 text-amber-600" />
                        ) : (
                          <span className="block h-2 w-2 rounded-full border border-gray-300 bg-gray-100" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                        {p.name}
                      </span>
                      <span className={`flex-shrink-0 text-xs ${p.locked ? "text-amber-700" : "text-gray-400"}`}>
                        {s?.state === "running"
                          ? "Scheduling…"
                          : p.locked
                          ? "Locked — will skip"
                          : willSkip && !s
                          ? "Already scheduled"
                          : `${p.supply} slots · needs ${p.demand}`}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {/* Completion summary — every division accounted for */}
              {finished && (
                <div className="mt-5 border-t border-gray-100 pt-4">
                  {allClean && (
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#22C55E]">
                      <PartyPopper className="h-4 w-4" />
                      Every division scheduled cleanly.
                    </p>
                  )}
                  <ul className="flex flex-col gap-1.5">
                    {plan.map((p) => {
                      const line = summaryLine(p);
                      const cls =
                        line.tone === "warn"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : line.tone === "ok"
                          ? "border-gray-100 bg-gray-50 text-gray-600"
                          : "border-gray-100 bg-gray-50 text-gray-500";
                      return (
                        <li
                          key={p.id}
                          className={`rounded-lg border px-3 py-2 text-xs ${cls}`}
                        >
                          {line.text}
                        </li>
                      );
                    })}
                  </ul>
                  {/* Season-wide shared-coach conflicts — own distinct category */}
                  <CoachConflictNotice conflicts={coachConflicts} className="mt-3" />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !planError && plan.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
            <p className="text-xs text-gray-400">
              {finished
                ? "Done."
                : targets.length === 0
                ? "All divisions already have schedules."
                : `${targets.length} of ${plan.length} division${
                    plan.length !== 1 ? "s" : ""
                  } will be generated in this order.`}
            </p>
            {finished ? (
              <button
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/90"
              >
                Close
              </button>
            ) : (
              <button
                onClick={() => void runAll()}
                disabled={running || targets.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <CalendarDays className="h-4 w-4" />
                    Generate {targets.length > 0 ? targets.length : ""} division
                    {targets.length !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
