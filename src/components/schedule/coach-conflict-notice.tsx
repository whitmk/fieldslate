"use client";

import { Users } from "lucide-react";
import type { CoachConflict } from "@/lib/schedule/detect-coach-conflicts";
import { fmtGameDate } from "@/lib/utils/game-time";

// Read-only display of shared-coach conflicts as their OWN category, kept
// visually distinct from venue/field conflicts (which are red with an
// AlertTriangle): amber with a Users icon, and its own remedy — "move one game
// to a different TIME", not a different field. This is display-only by design
// (Chunk 3, Option 1): no move/resolve controls, no conflict_overrides writes.
//
// A coach conflict is amber, not red, because the detector deliberately
// over-reports (a flat 1-hour transition pad flags even same-complex games an
// hour apart) — these are for the admin to review and dismiss, not hard errors.

export function CoachConflictNotice({
  conflicts,
  max = 5,
  className = "mt-4",
}: {
  conflicts: CoachConflict[];
  max?: number;
  className?: string;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 ${className}`}>
      <div className="flex items-start gap-2.5">
        <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-800">
            Coach double-booked — {conflicts.length}{" "}
            {conflicts.length === 1 ? "conflict" : "conflicts"}
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            A shared coach has two games at overlapping times. Move one game to a
            different time to resolve.
          </p>
          <ul className="mt-1.5 space-y-1">
            {conflicts.slice(0, max).map((c, i) => (
              <li key={i} className="text-xs text-amber-700">
                <span className="font-medium">{c.teamNames[0]}</span>
                {" & "}
                <span className="font-medium">{c.teamNames[1]}</span> on{" "}
                {fmtGameDate(c.date)}:{" "}
                {c.games
                  .map(
                    (g) =>
                      `${g.homeTeam} vs ${g.awayTeam}${
                        g.divisionName ? ` (${g.divisionName})` : ""
                      } at ${g.timeLabel}`,
                  )
                  .join(" · ")}
              </li>
            ))}
            {conflicts.length > max && (
              <li className="text-xs text-amber-600">
                and {conflicts.length - max} more…
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
