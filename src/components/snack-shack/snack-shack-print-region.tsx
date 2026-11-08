"use client";

// The snack shack's FULL-SCHEDULE print region, lifted verbatim out of
// snack-shack-page-client.tsx so `npm run sim:snack-print` can render it and
// compare it with goldens. Hidden on screen; the page adds `.print-active`
// just before window.print(). See src/lib/snack-shack/print.ts for what this
// print may show: the cash person in its own column, through cashPrintLine
// only — never a note.

import { forwardRef } from "react";
import { CASH_PRINT_HEADER, cashPrintLine, fmtPrintDate, fmtPrintTime, type CashPrintSource } from "@/lib/snack-shack/print";

/** What the full print needs from a shift. */
export type FullPrintBlock = CashPrintSource & {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  team_name: string | null;
};

export const SnackShackPrintRegion = forwardRef<HTMLDivElement, { seasonLabel: string; blocks: FullPrintBlock[] }>(
  function SnackShackPrintRegion({ seasonLabel, blocks }, ref) {
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
              {blocks.map((b) => (
                <tr key={b.id}>
                  <td>{fmtPrintDate(b.date)}</td>
                  <td>
                    {fmtPrintTime(b.start_time)} – {fmtPrintTime(b.end_time)}
                  </td>
                  <td>{b.team_name ?? "—"}</td>
                  <td>{cashPrintLine(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  },
);
