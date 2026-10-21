// What the planner's Print produces (step 5c; mockup screen 4). Uses the
// shared `.fieldslate-print-region` mechanism (globals.css @media print) —
// hidden on screen; in print everything else on the page is removed and this
// lays out in normal flow. It is the APP's own component: the marketing
// calculator's print region is not reused and not changed. No shared print
// CSS was changed; a Safari print check is owed (CLAUDE.md, "Print path").
//
// Differences from the calculator's print, by decision: the league and plan
// name head it, the Divisions table has a Lit fields column, the lit-fields
// line follows the answer, daylight notes appear only with a league city
// (computePlan with no city emits none), and there is no "free calculator"
// line.
//
// KEEPING A HEADING WITH ITS TABLE: the calculator print's rules, as inline
// styles scoped to this region — never on the shared `.fieldslate-print-*`
// classes (WebKit has clipped a break-avoid on a very tall block).

import type { CSSProperties, ReactNode } from "react";
import { DAY_LONG, fieldTypeLabel } from "@/lib/practice-planner/constants";
import { fmtInt, fmtTime, formatDayList, toMinutes } from "@/lib/practice-planner/format";
import { countedPerWeek, divisionIsActive } from "@/lib/practice-planner/plan";
import { busiestLabel, seasonRangeLabel, type Plan } from "@/lib/practice-planner/report";
import type { SpreadMode } from "@/lib/practice-planner/types";
import type { PlanInput } from "@/lib/practice-plans/load";
import {
  PRINT_COL,
  PRINT_LIT_YES,
  PRINT_SECTION_DIVISIONS,
  PRINT_SECTION_FIELDS,
  PRINT_SECTION_NIGHTS,
  PRINT_SECTION_NOTES,
  printMetaLine,
  printOtherModeHeading,
  printTitle,
  printTotalsLine,
} from "@/lib/practice-plans/words";

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

export function PlanPrintRegion({ leagueName, planName, input, plan, mode, cityLabel, litLine, printedOn }: {
  leagueName: string | null;
  planName: string;
  input: PlanInput;
  plan: Plan;
  mode: SpreadMode;
  /** "Santa Rosa, CA", or null with no league city. */
  cityLabel: string | null;
  /** "On lit fields: Majors." or null. */
  litLine: string | null;
  /** Set when Print is clicked (event time, never a render-path clock). */
  printedOn: string | null;
}) {
  const result = mode === "spread" ? plan.spread : plan.sameNights;
  const other = mode === "spread" ? plan.sameNights : plan.spread;
  const days = DAY_LONG.map((_, k) => k).filter((k) => plan.inUse.some((z) => result.byType[z][k].count > 0));
  const divisions = input.divisions.filter(divisionIsActive);
  const warnings = plan.warnings[mode];

  return (
    <div className="fieldslate-print-region hidden" data-plan-print>
      <div className="fieldslate-print-header">
        <div className="fieldslate-print-wordmark">
          Field<span>Slate</span>
        </div>
        <p className="fieldslate-print-league">{printTitle(leagueName, planName)}</p>
        <p className="fieldslate-print-meta">
          {printMetaLine({ dates: seasonRangeLabel(input), cityLabel, mode, minutesBetween: input.minutesBetween, printedOn })}
        </p>
      </div>

      {plan.inUse.length > 0 && (
        <>
          <Section title={PRINT_SECTION_FIELDS} keepTogether>
            <table className="fieldslate-print-table">
              <thead>
                <tr>
                  <th>{PRINT_COL.fieldType}</th>
                  <th>{PRINT_COL.fields}</th>
                  <th>{PRINT_COL.busiest}</th>
                  <th>{printOtherModeHeading(mode)}</th>
                </tr>
              </thead>
              <tbody>
                {plan.inUse.map((z) => (
                  <tr key={z} style={ROW_KEEP}>
                    <td>{fieldTypeLabel(z)}</td>
                    <td>{result.need[z].fields}</td>
                    <td style={NOWRAP}>{busiestLabel(result.need[z])}</td>
                    <td>{other.need[z].fields}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {litLine && <p className="fieldslate-print-meta" data-print-lit>{litLine}</p>}
          </Section>

          <Section title={PRINT_SECTION_NIGHTS} keepTogether>
            <table className="fieldslate-print-table">
              <thead>
                <tr>
                  <th>{PRINT_COL.night}</th>
                  {plan.inUse.map((z) => (
                    <th key={z}>{fieldTypeLabel(z)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((k) => (
                  <tr key={k} style={ROW_KEEP}>
                    <td>{DAY_LONG[k]}</td>
                    {plan.inUse.map((z) => {
                      const r = result.byType[z][k];
                      return (
                        <td key={z}>
                          {r.count && r.first !== null && r.last !== null ? (
                            <>
                              {r.count} field{r.count > 1 ? "s" : ""}, <span style={NOWRAP}>{fmtTime(r.first)} to {fmtTime(r.last)}</span>
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
        <Section title={PRINT_SECTION_NOTES} keepTogether>
          <ul style={{ fontSize: "9.5pt", margin: "3pt 0 0 14pt", listStyle: "disc" }}>
            {warnings.map((w) => (
              <li key={w} style={ROW_KEEP}>
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={PRINT_SECTION_DIVISIONS} keepTogether={divisions.length <= KEEP_TOGETHER_MAX_ROWS}>
        <table className="fieldslate-print-table">
          <thead>
            <tr>
              <th>{PRINT_COL.division}</th>
              <th>{PRINT_COL.teams}</th>
              <th>{PRINT_COL.perWeek}</th>
              <th>{PRINT_COL.length}</th>
              <th>{PRINT_COL.days}</th>
              <th>{PRINT_COL.window}</th>
              <th>{PRINT_COL.field}</th>
              <th>{PRINT_COL.perField}</th>
              <th>{PRINT_COL.lit}</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((d) => (
              <tr key={d.id ?? d.name} style={ROW_KEEP}>
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
                <td>{d.lit ? PRINT_LIT_YES : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {plan.totals && (
        <p className="fieldslate-print-meta" style={BLOCK_KEEP}>
          {printTotalsLine({
            teamPracticesPerWeek: fmtInt(plan.totals.teamPracticesPerWeek),
            fieldHoursPerWeek: fmtInt(plan.totals.fieldHoursPerWeek),
            weeks: fmtInt(plan.totals.weeks),
            fieldHoursSeason: fmtInt(plan.totals.fieldHoursSeason),
          })}
        </p>
      )}
    </div>
  );
}
