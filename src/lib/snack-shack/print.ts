// The snack shack's printed documents — pure builders, no React state, no data
// access. Lifted VERBATIM out of snack-shack-page-client.tsx so the harness
// (`npm run sim:snack-print`) can pin their output against goldens recorded
// from the tree before any print change.
//
// WHAT PRINTS (decided 2026-11-07):
//   - The FULL-SCHEDULE print (SnackShackPrintRegion) shows each shift's cash
//     person in its own "Cash / questions" column — blank when none — and
//     only through `cashPrintLine`.
//   - The PRINT-ALL TEAM SCHEDULES document (`teamSchedulesDocument`, below),
//     the Teams page button's print and both emails NEVER show a cash person.
//   - A shift NOTE is never printed anywhere.
// `npm run sim:game-notes` (O1-snack-*) enforces both halves.

/** "Sat, Oct 4, 2026" — the print's date. */
export function fmtPrintDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "9:30am" — the print's time. */
export function fmtPrintTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

/** The column header the full-schedule print gives the cash person. */
export const CASH_PRINT_HEADER = "Cash / questions";

/** What the cash column reads from a shift. */
export type CashPrintSource = { cash_person?: { name: string } | null };

/** The full-schedule print's cash cell: the cash person's name, or "" (a blank
 *  cell) when the shift has none. The ONLY way the cash person reaches a
 *  print — and only the full-schedule print. */
export function cashPrintLine(b: CashPrintSource): string {
  return b.cash_person?.name?.trim() ?? "";
}

/** One shift on a team's printed page: date and time only. */
export type TeamPrintBlock = { date: string; start_time: string; end_time: string };

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The whole "Print all team schedules" window: one page per team, Date and
 *  Time only. Never a cash person, never a note. */
export function teamSchedulesDocument(
  teams: { id: string; name: string; blocks: TeamPrintBlock[] }[],
  seasonLabel: string,
): string {
  const pages = teams
    .map((team) => {
      const rows = team.blocks
        .map(
          (b) =>
            `<tr><td>${esc(fmtPrintDate(b.date))}</td><td>${esc(fmtPrintTime(b.start_time))} – ${esc(fmtPrintTime(b.end_time))}</td></tr>`,
        )
        .join("");
      return `<div class="team-page">
  <div class="header">
    <div class="wordmark">Field<span>Slate</span></div>
    <div class="league">Snack Shack — ${esc(team.name)}</div>
    <div class="meta">${esc(seasonLabel)}</div>
  </div>
  <table><thead><tr><th>Date</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Snack Shack — All Team Schedules</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:0;color:#0c1f3f}
  .team-page{padding:.75in;page-break-before:always;break-before:page}
  .team-page:first-child{page-break-before:auto;break-before:auto}
  .header{border-bottom:2pt solid #000;padding-bottom:12pt;margin-bottom:16pt}
  .wordmark{font-size:20pt;font-weight:800;color:#0c1f3f;letter-spacing:-.3pt;line-height:1}
  .wordmark span{color:#16a34a}
  .league{font-size:13pt;font-weight:700;color:#000;margin-top:8pt}
  .meta{font-size:8.5pt;color:#666;margin-top:6pt}
  table{width:100%;border-collapse:collapse;font-size:9.5pt;color:#000;margin-top:12pt}
  th{border:1pt solid #999;padding:4pt 8pt;background:#ebebeb;font-weight:700;text-align:left}
  td{border:1pt solid #ccc;padding:3pt 8pt}
  tbody tr:nth-child(even) td{background:#f7f7f7}
  @page{margin:0;size:letter portrait}
</style>
</head>
<body>
${pages}
<script>
  window.onload=function(){
    window.print();
    window.onafterprint=function(){window.close()};
  };
</script>
</body>
</html>`;
}
