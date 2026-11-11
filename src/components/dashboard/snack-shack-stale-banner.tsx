"use client";

// Overview: "Snack shack: games changed on N days, and those days' shifts no
// longer match." (0131, Part B / B2; mockup docs/mockups/snack-shack-stale-
// days.html). Elite only (the page renders it only for Elite; the snack shack
// is Elite-only).
//
// It reads the season's marks first — cheap — and runs the REAL shift
// calculation (loadShiftInputs + upcomingStaleness) only when there is a mark
// or a failed mark. It shows only days the calculation flags, and clears the
// marks the calculation doesn't (timed to its read). Any failure says
// "couldn't check" with a link, never silence. It reads NO sign-up data
// (sim:game-notes O1-snack-banner fence).

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadShiftInputs, type SnackShackSettingsInput } from "@/lib/snack-shack/generate-shifts";
import { upcomingStaleness } from "@/lib/snack-shack/regenerate-plan";
import {
  BANNER_COULDNT_CHECK,
  BANNER_MAX_DAYS,
  bannerDays,
  bannerHeadline,
  bannerMoreLine,
  dayNeedsRebuildLine,
  fmtDay,
  marksToClear,
  needsCheck,
} from "@/lib/snack-shack/stale-days";
import { clearStaleMarks, readStaleState } from "@/lib/snack-shack/stale-marks";

const SETTINGS_COLS =
  "id, season_id, days_of_week, home_venue_ids, scheduling_preference, open_before_min, close_after_min, max_shift_min, shifts_generated_at";

type State = { kind: "idle" } | { kind: "days"; days: string[] } | { kind: "error" };

export function SnackShackStaleBanner({ seasonId, orgId }: { seasonId: string; orgId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const st = await readStaleState(seasonId);
      if (!st.snackShackId || !needsCheck(st.dates, st.failedSince)) return { kind: "idle" } as State;
      const { data, error } = await createClient().from("snack_shack_settings").select(SETTINGS_COLS).eq("id", st.snackShackId).maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "snack shack settings not found");
      const inputs = await loadShiftInputs(data as unknown as SnackShackSettingsInput, orgId);
      const differing = upcomingStaleness(inputs.derivation, inputs.stored, inputs.today).differingDates;
      const clear = marksToClear(st.dates, differing);
      if (clear.length > 0) {
        clearStaleMarks(st.snackShackId, clear, inputs.readAt)
          .catch((e: unknown) => console.error("[snack shack] clear marks:", e instanceof Error ? e.message : e));
      }
      const days = bannerDays(st.dates, st.failedSince, differing);
      return (days.length > 0 ? { kind: "days", days } : { kind: "idle" }) as State;
    })()
      .then((s) => { if (!cancelled) setState(s); })
      .catch((e: unknown) => {
        console.error("[snack shack] stale check:", e instanceof Error ? e.message : e);
        if (!cancelled) setState({ kind: "error" });
      });
    return () => { cancelled = true; };
  }, [seasonId, orgId]);

  if (state.kind === "idle") return null;
  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
        {BANNER_COULDNT_CHECK}{" "}
        <Link href="/dashboard/snack-shack" className="font-medium text-[#0C1F3F] underline">Open the snack shack page</Link>
      </div>
    );
  }
  const shown = state.days.slice(0, BANNER_MAX_DAYS);
  const more = state.days.length - shown.length;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span className="font-medium">{bannerHeadline(state.days.length)}</span>
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {shown.map((d) => (
          <li key={d} className="flex flex-wrap items-center justify-between gap-2">
            <span>{dayNeedsRebuildLine(d)}</span>
            <Link
              href={`/dashboard/snack-shack?review=${d}`}
              className="inline-flex h-9 items-center rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700"
            >
              <span className="sm:hidden">Review</span>
              <span className="hidden sm:inline">Review {fmtDay(d)}</span>
            </Link>
          </li>
        ))}
        {more > 0 && (
          <li>
            <Link href="/dashboard/snack-shack" className="text-amber-900 underline">{bannerMoreLine(more)}</Link>
          </li>
        )}
      </ul>
    </div>
  );
}
