"use client";

// The snack shack's FULL-SCHEDULE print region, lifted verbatim out of
// snack-shack-page-client.tsx so `npm run sim:snack-print` can render it and
// compare it with goldens. Hidden on screen; the page adds `.print-active`
// just before window.print(). See src/lib/snack-shack/print.ts for what this
// print may show: the cash person in its own column, through cashPrintLine
// only; the headcount in the Assigned Team cell ("Braves · 3 people", or
// "3 people" in place of the dash), through headcountPrintLine only, and only
// when it is above 1 (0119; moved out of the Time cell 2026-11-08) — never a
// note.

import { forwardRef } from "react";
import { CASH_PRINT_HEADER, cashPrintLine, fmtPrintDate, fmtPrintTime, type CashPrintSource } from "@/lib/snack-shack/print";
import { headcountPrintLine, type HeadcountSource } from "@/lib/snack-shack/headcount";

/** The Assigned Team cell: the team, then " · 3 people" when the headcount
 *  is above 1; with no team, the headcount alone in place of the dash. A count
 *  of 1 prints exactly as before 0119. */
export function teamWithPeople(teamName: string | null, people: string): string {
  if (teamName) return people ? `${teamName} · ${people}` : teamName;
  return people || "—";
}

/** What the full print needs from a shift. */
export type FullPrintBlock = CashPrintSource & HeadcountSource & {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  team_name: string | null;
};

export const SnackShackPrintRegion = forwardRef<HTMLDivElement, { seasonLabel: string; blocks: FullPrintBlock[]; peoplePerShift?: number }>(
  function SnackShackPrintRegion({ seasonLabel, blocks, peoplePerShift = 1 }, ref) {
    return (
      <div ref={ref} className="fieldslate-snack-print-ready" aria-hidden>
        <div className="fieldslate-print-header">
          <div className="fieldslate-print-wordmark">
            Field<span>Slate</span>
          </div>
          <div className="fieldslate-print-league">
            Snack Shack Schedule — {seasonLabel}
          </div>
          <div className="fieldslate-print-meta">
            Full season · {blocks.length} shift{blocks.length !== 1 ? "s" : ""}
          </div>
        </div>
        {blocks.length === 0 ? (
          <p style={{ fontSize: "10pt", color: "#666" }}>No shifts scheduled.</p>
        ) : (
          <table className="fieldslate-print-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Assigned Team</th>
                <th>{CASH_PRINT_HEADER}</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const people = headcountPrintLine(b, peoplePerShift);
                return (
                  <tr key={b.id}>
                    <td>{fmtPrintDate(b.date)}</td>
                    <td>
                      {fmtPrintTime(b.start_time)} – {fmtPrintTime(b.end_time)}
                    </td>
                    <td>{teamWithPeople(b.team_name, people)}</td>
                    <td>{cashPrintLine(b)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  },
);
