import { createClient } from "@/lib/supabase/client";
import {
  autoAssignUmpires,
  type AutoAssignClient,
  type AutoAssignOptions,
  type SkipReason,
} from "./auto-assign";

/**
 * Season-wide auto-assign: runs the existing per-division engine
 * (autoAssignUmpires — unchanged) division-by-division in ascending
 * divisions.priority order, so higher-priority divisions get first claim on
 * scarce officials. The engine re-reads all existing game_umpires rows at the
 * start of every run, so each division automatically sees the assignments the
 * earlier divisions just made — no state is threaded between runs.
 *
 * This function only sequences and aggregates (options — the fallback-tier
 * opt-in — pass through to every division's engine run unchanged):
 * - Divisions with umpires_per_game = 0 are skipped (reported, not errored).
 * - A division that errors is recorded and the sequence CONTINUES — one bad
 *   division never silently swallows the rest of the season.
 * - Existing assignments are preserved by the engine (it only fills empty
 *   slots), so re-running is safe: a second identical run assigns nothing.
 */

export type SeasonDivisionResult = {
  divisionId: string;
  divisionName: string;
  priority: number;
  status: "assigned" | "no_slots_required" | "error";
  filled: number;
  fallbackFilled: number;
  skipped: number;
  skipReasons: SkipReason[];
  outsideAvailabilityNames: string[];
  overWeeklyLimitNames: string[];
  error?: string;
};

export type SeasonAutoAssignResult = {
  /** False only when the division list itself couldn't be read — per-division
   *  failures land in their division entry instead. */
  success: boolean;
  divisions: SeasonDivisionResult[];
  totalFilled: number;
  totalFallbackFilled: number;
  totalSkipped: number;
  error?: string;
};

export async function autoAssignSeason(
  seasonId: string,
  client?: AutoAssignClient,
  options: AutoAssignOptions = {},
): Promise<SeasonAutoAssignResult> {
  const supabase = client ?? createClient();

  const { data: divisionsRaw, error: divisionsErr } = await supabase
    .from("divisions")
    .select("id, name, priority, umpires_per_game")
    .eq("league_id", seasonId)
    .order("priority", { ascending: true });

  if (divisionsErr) {
    return {
      success: false,
      divisions: [],
      totalFilled: 0,
      totalFallbackFilled: 0,
      totalSkipped: 0,
      error: divisionsErr.message,
    };
  }

  // Same order the Division priority card displays: priority, then name as
  // the tiebreak so equal priorities run in a deterministic order.
  const divisions = (
    (divisionsRaw ?? []) as {
      id: string;
      name: string;
      priority: number;
      umpires_per_game: number;
    }[]
  ).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  const results: SeasonDivisionResult[] = [];

  for (const d of divisions) {
    const base = {
      divisionId: d.id,
      divisionName: d.name,
      priority: d.priority,
    };

    if (d.umpires_per_game === 0) {
      results.push({
        ...base,
        status: "no_slots_required",
        filled: 0,
        fallbackFilled: 0,
        skipped: 0,
        skipReasons: [],
        outsideAvailabilityNames: [],
        overWeeklyLimitNames: [],
      });
      continue;
    }

    try {
      const res = await autoAssignUmpires(d.id, seasonId, supabase, options);
      if (!res.success) {
        results.push({
          ...base,
          status: "error",
          filled: res.filled,
          fallbackFilled: res.fallbackFilled,
          skipped: res.skipped,
          skipReasons: res.skipReasons,
          outsideAvailabilityNames: res.outsideAvailabilityNames,
          overWeeklyLimitNames: res.overWeeklyLimitNames,
          error: res.error ?? "Auto-assign failed.",
        });
        continue;
      }
      results.push({
        ...base,
        status: "assigned",
        filled: res.filled,
        fallbackFilled: res.fallbackFilled,
        skipped: res.skipped,
        skipReasons: res.skipReasons,
        outsideAvailabilityNames: res.outsideAvailabilityNames,
        overWeeklyLimitNames: res.overWeeklyLimitNames,
      });
    } catch (e) {
      results.push({
        ...base,
        status: "error",
        filled: 0,
        fallbackFilled: 0,
        skipped: 0,
        skipReasons: [],
        outsideAvailabilityNames: [],
        overWeeklyLimitNames: [],
        error: e instanceof Error ? e.message : "Auto-assign failed.",
      });
    }
  }

  return {
    success: true,
    divisions: results,
    totalFilled: results.reduce((n, r) => n + r.filled, 0),
    totalFallbackFilled: results.reduce((n, r) => n + r.fallbackFilled, 0),
    totalSkipped: results.reduce((n, r) => n + r.skipped, 0),
  };
}
