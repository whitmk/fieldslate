import { Check, MapPin } from "lucide-react";

// Read-only venues × divisions game matrix (presentational only — all derivation
// happens in the server host, OverviewReports).
//
// Columns  = game-eligible venues for the season (division_venues.allow_games).
// Rows     = divisions.
// Cell     = count of actual scheduled games whose HOME team is in that division
//            and which are booked at that venue (house convention: a game belongs
//            to its home team's division; games has no division_id). Cancelled and
//            pending_interleague games are excluded upstream via the shared
//            countsAsScheduledGame filter.
//
// A cell is a checkmark + count when the division plays ≥1 game at the venue,
// and an empty "–" otherwise. An all-empty (or partly-empty) matrix is honest:
// it fills in per-division as each division's schedule is generated.

export type MatrixColumn = { id: string; name: string };
// counts is aligned index-for-index with the columns array.
export type MatrixRow = { id: string; name: string; counts: number[] };

export function VenueDivisionMatrix({
  columns,
  rows,
}: {
  columns: MatrixColumn[];
  rows: MatrixRow[];
}) {
  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <MapPin className="h-5 w-5 text-gray-300" />
        <p className="text-sm font-medium text-[#0b1c39]">
          No games scheduled yet
        </p>
        <p className="max-w-sm text-xs text-gray-400">
          Once you set up your divisions and generate their schedules, the
          fields they use will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-400">
              <th className="sticky left-0 z-10 bg-gray-50 px-6 py-3 text-left">
                Division
              </th>
              {columns.map((c) => (
                <th
                  key={c.id}
                  className="whitespace-nowrap px-4 py-3 text-center font-medium"
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50/40">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-white px-6 py-3.5 text-left font-medium text-[#0b1c39]"
                >
                  {row.name}
                </th>
                {row.counts.map((count, i) => (
                  <td
                    key={columns[i].id}
                    className="px-4 py-3.5 text-center tabular-nums"
                  >
                    {count > 0 ? (
                      <span className="inline-flex items-center gap-1 font-medium text-[#0b1c39]">
                        <Check className="h-3.5 w-3.5 text-[#3B6D11]" />
                        {count}
                      </span>
                    ) : (
                      <span className="text-gray-300">–</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-gray-100 px-6 py-3 text-xs text-gray-400">
        Games appear here as you generate each division&rsquo;s schedule.
      </p>
    </>
  );
}
