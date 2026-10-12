// What Print produces: the answer for the city, on paper. Uses the shared
// `.fieldslate-print-region` mechanism (globals.css @media print) — hidden on
// screen, and in print everything else on the page is removed and this lays
// out in normal flow. No shared print CSS was changed for it (CLAUDE.md,
// "Print path"); a Safari print check is owed after any change here.
//
// KEEPING A HEADING WITH ITS TABLE: each heading carries break-after: avoid,
// and each heading + table sits in a wrapper with break-inside: avoid. Both
// are INLINE styles scoped to this region — never added to the shared
// `.fieldslate-print-*` classes, which the schedule print uses, and where
// WebKit has CLIPPED a break-avoid on a very tall block instead of paginating
// it. That is also why the Divisions wrapper avoids breaks only while its
// table is short enough to fit on a page (KEEP_TOGETHER_MAX_ROWS); a longer
// one may break between rows, and its heading still won't sit alone.

import { DAY_LONG, fieldTypeLabel } from "@/lib/practice-planner/constants";
import { fmtInt, fmtTime, formatDayList, toMinutes } from "@/lib/practice-planner/format";
import { countedPerWeek, divisionIsActive } from "@/lib/practice-planner/plan";
import { busiestLabel, seasonRangeLabel, type SeasonTotals } from "@/lib/practice-planner/report";
import type { FieldTypeId, ModeResult, PlannerInput, SpreadMode } from "@/lib/practice-planner/types";
import type { CSSProperties, ReactNode } from "react";

/** About a third of a letter page at the print table's 9.5pt — always fits. */
const KEEP_TOGETHER_MAX_ROWS = 20;

const HEADING_KEEP: CSSProperties = { breakAfter: "avoid", pageBreakAfter: "avoid" };
const BLOCK_KEEP: CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" };
const ROW_KEEP: CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" };
const NOWRAP: CSSProperties = { whiteSpace: "nowrap" };

function Section({ title, keepTogether, children }: { title: string; keepTogether: boolean; children: ReactNode }) {
  return (
    <div style={keepTogether ? BLOCK_KEEP : undefined}>
      <div className="fieldslate-print-date-group" style={HEADING_KEEP}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function PrintRegion({
  input,
  result,
  other,
  mode,
  inUse,
  warnings,
  totals,
  cityLabel,
}: {
  input: PlannerInput;
  result: ModeResult;
  other: ModeResult;
  mode: SpreadMode;
  inUse: FieldTypeId[];
  warnings: string[];
  totals: SeasonTotals | null;
  cityLabel: string;
}) {
  const dates = seasonRangeLabel(input);
  const days = DAY_LONG.map((_, k) => k).filter((k) => inUse.some((z) => result.byType[z][k].count > 0));
  const divisions = input.divisions.filter(divisionIsActive);

  return (
    <div className="fieldslate-print-region hidden">
      <div className="fieldslate-print-header">
        <div className="fieldslate-print-wordmark">
          Field<span>Slate</span>
        </div>
        <p className="fieldslate-print-league">Practice field request</p>
        <p className="fieldslate-print-meta">
          {dates ? `${dates} · ` : ""}Near {cityLabel} ·{" "}
          {mode === "spread" ? "Practices spread across the week" : "Everyone wants the same nights"}
          {input.minutesBetween ? ` · ${input.minutesBetween} minutes between practices` : ""}
        </p>
      </div>

      {inUse.length > 0 && (
        <>
          <Section title="Fields to request" keepTogether>
            <table className="fieldslate-print-table">
              <thead>
                <tr>
                  <th>Field type</th>
                  <th>Fields</th>
                  <th>Busiest night</th>
                  <th>{mode === "spread" ? "If everyone wants the same nights" : "If spread across the week"}</th>
                </tr>
              </thead>
              <tbody>
                {inUse.map((z) => (
                  <tr key={z} style={ROW_KEEP}>
                    <td>{fieldTypeLabel(z)}</td>
                    <td>{result.need[z].fields}</td>
                    <td style={NOWRAP}>{busiestLabel(result.need[z])}</td>
                    <td>{other.need[z].fields}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Night by night" keepTogether>
            <table className="fieldslate-print-table">
              <thead>
                <tr>
                  <th>Night</th>
                  {inUse.map((z) => (
                    <th key={z}>{fieldTypeLabel(z)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((k) => (
                  <tr key={k} style={ROW_KEEP}>
                    <td>{DAY_LONG[k]}</td>
                    {inUse.map((z) => {
                      const r = result.byType[z][k];
                      return (
                        <td key={z}>
                          {r.count && r.first !== null && r.last !== null ? (
                            <>
                              {r.count} field{r.count > 1 ? "s" : ""},{" "}
                              <span style={NOWRAP}>
                                {fmtTime(r.first)} to {fmtTime(r.last)}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}

      {warnings.length > 0 && (
        <Section title="Notes" keepTogether>
          <ul style={{ fontSize: "9.5pt", margin: "3pt 0 0 14pt", listStyle: "disc" }}>
            {warnings.map((w) => (
              <li key={w} style={ROW_KEEP}>
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Divisions" keepTogether={divisions.length <= KEEP_TOGETHER_MAX_ROWS}>
        <table className="fieldslate-print-table">
          <thead>
            <tr>
              <th>Division</th>
              <th>Teams</th>
              <th>Practices a week</th>
              <th>Length</th>
              <th>Days</th>
              <th>Window</th>
              <th>Field</th>
              <th>Teams per field</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((d, i) => (
              <tr key={i} style={ROW_KEEP}>
                <td>{d.name}</td>
                <td>{d.teams}</td>
                <td>{countedPerWeek(d)}</td>
                <td style={NOWRAP}>{d.lengthMin} min</td>
                <td style={NOWRAP}>{formatDayList(d.days)}</td>
                <td style={NOWRAP}>
                  {fmtTime(toMinutes(d.start))}–{fmtTime(toMinutes(d.end))}
                </td>
                <td>{fieldTypeLabel(d.fieldType)}</td>
                <td>{d.teamsPerField}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div style={BLOCK_KEEP}>
        {totals && (
          <p className="fieldslate-print-meta">
            {fmtInt(totals.teamPracticesPerWeek)} team practices a week · {fmtInt(totals.fieldHoursPerWeek)} field hours
            a week · {fmtInt(totals.weeks)} weeks · {fmtInt(totals.fieldHoursSeason)} field hours this season
          </p>
        )}
        <p className="fieldslate-print-meta">
          Made with the free practice field calculator at thefieldslate.com/tools/practice-field-calculator
        </p>
      </div>
    </div>
  );
}
