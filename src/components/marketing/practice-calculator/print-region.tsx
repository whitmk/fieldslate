// What Print produces: the answer for the city, on paper. Uses the shared
// `.fieldslate-print-region` mechanism (globals.css @media print) — hidden on
// screen, and in print everything else on the page is removed and this lays
// out in normal flow. No print CSS was changed for it; a Safari print check
// is still owed before shipping (CLAUDE.md, "Print path").

import { DAY_LONG, fieldTypeLabel } from "@/lib/practice-planner/constants";
import { fmtDate, fmtInt, fmtTime, parseIsoDate, toMinutes } from "@/lib/practice-planner/format";
import { countedPerWeek, divisionIsActive, normalizeDays } from "@/lib/practice-planner/plan";
import { seasonError, type SeasonTotals } from "@/lib/practice-planner/report";
import type { FieldTypeId, ModeResult, PlannerInput, SpreadMode } from "@/lib/practice-planner/types";

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
  const dates = seasonError(input)
    ? null
    : `${fmtDate(parseIsoDate(input.seasonStart))} to ${fmtDate(parseIsoDate(input.seasonEnd))}, ${input.seasonStart.slice(0, 4)}`;
  const days = DAY_LONG.map((_, k) => k).filter((k) => inUse.some((z) => result.byType[z][k].count > 0));

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
          <div className="fieldslate-print-date-group">Fields to request</div>
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
                <tr key={z}>
                  <td>{fieldTypeLabel(z)}</td>
                  <td>{result.need[z].fields}</td>
                  <td>{result.need[z].peakDay !== null ? DAY_LONG[result.need[z].peakDay!] : "—"}</td>
                  <td>{other.need[z].fields}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="fieldslate-print-date-group">Night by night</div>
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
                <tr key={k}>
                  <td>{DAY_LONG[k]}</td>
                  {inUse.map((z) => {
                    const r = result.byType[z][k];
                    return (
                      <td key={z}>
                        {r.count && r.first !== null && r.last !== null
                          ? `${r.count} field${r.count > 1 ? "s" : ""}, ${fmtTime(r.first)} to ${fmtTime(r.last)}`
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {warnings.length > 0 && (
        <>
          <div className="fieldslate-print-date-group">Notes</div>
          <ul style={{ fontSize: "9.5pt", margin: "3pt 0 0 14pt", listStyle: "disc" }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}

      <div className="fieldslate-print-date-group">Divisions</div>
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
          {input.divisions.filter(divisionIsActive).map((d, i) => (
            <tr key={i}>
              <td>{d.name}</td>
              <td>{d.teams}</td>
              <td>{countedPerWeek(d)}</td>
              <td>{d.lengthMin} min</td>
              <td>{normalizeDays(d.days).map((k) => DAY_LONG[k].slice(0, 3)).join(", ")}</td>
              <td>
                {fmtTime(toMinutes(d.start))}–{fmtTime(toMinutes(d.end))}
              </td>
              <td>{fieldTypeLabel(d.fieldType)}</td>
              <td>{d.teamsPerField}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {totals && (
        <p className="fieldslate-print-meta">
          {fmtInt(totals.teamPracticesPerWeek)} team practices a week · {fmtInt(totals.fieldHoursPerWeek)} field hours a
          week · {fmtInt(totals.weeks)} weeks · {fmtInt(totals.fieldHoursSeason)} field hours this season
        </p>
      )}
      <p className="fieldslate-print-meta">Made with the free practice field calculator at thefieldslate.com/tools/practice-field-calculator</p>
    </div>
  );
}
