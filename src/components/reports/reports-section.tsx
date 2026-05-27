import { createClient } from "@/lib/supabase/server";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  AlertTriangle,
  CloudRain,
  MapPin,
} from "lucide-react";

// ── Props ─────────────────────────────────────────────────────────────────────
// Counts the parent page already derived (conflicts + rainouts come from the
// same data the existing Conflict and Rained-out stat cards consume — we
// reuse those numbers so the Reports row never disagrees with the row at the
// top of the page).
interface Props {
  leagueId: string;
  /** Total non-cancelled games for this season (matches the existing "Games" stat). */
  gameCount: number;
  /** Combined schedule + blackout conflict count (matches the existing Conflicts card). */
  conflictCount: number;
  /** Cancelled games for this season — these are the rainouts. */
  rainedOutCount: number;
  /** Number of divisions in this season. */
  divisionCount: number;
}

type GameRow = { id: string; venue_id: string | null; status: string };
type PracticeRow = {
  id: string;
  field_id: string | null;
  team: { division_id: string | null } | null;
};
type VenueRow = { id: string; name: string };

export async function ReportsSection({
  leagueId,
  gameCount,
  conflictCount,
  rainedOutCount,
  divisionCount,
}: Props) {
  const supabase = createClient();

  // Fan-out the three Reports-specific reads in parallel with the rest of the
  // page; the parent has already issued its own block via Promise.all, so
  // these run sequentially after that — acceptable cost for keeping the
  // Reports data co-located with its renderer.
  const [
    { data: gamesRaw },
    { data: practicesRaw },
    { data: leagueRaw },
    { data: venuesRaw },
  ] = await Promise.all([
    supabase
      .from("games")
      .select("id, venue_id, status")
      .eq("league_id", leagueId),
    supabase
      .from("practice_slots")
      .select("id, field_id, team:teams!inner(league_id, division_id)")
      .eq("team.league_id", leagueId),
    supabase
      .from("leagues")
      .select("start_date, end_date")
      .eq("id", leagueId)
      .single(),
    supabase.from("venues").select("id, name"),
  ]);

  const games = (gamesRaw ?? []) as GameRow[];
  const practices = (practicesRaw ?? []) as unknown as PracticeRow[];
  const venues = (venuesRaw ?? []) as VenueRow[];
  const venueNameById = new Map(venues.map((v) => [v.id, v.name]));

  const practiceCount = practices.length;
  const weeksInSeason = computeWeeksInSeason(
    leagueRaw?.start_date ?? null,
    leagueRaw?.end_date ?? null,
  );

  // Per-venue rollup. Cancelled games don't actually occupy the field, so they
  // don't count toward utilization. Practice slots count once per assignment
  // (each row is a team-at-a-time-slot binding, not a per-occurrence row) —
  // this matches how `practice_count` is computed for the top-line card.
  const rollup = new Map<
    string,
    { venueId: string; games: number; practices: number }
  >();
  function bump(venueId: string, kind: "games" | "practices") {
    const row = rollup.get(venueId) ?? { venueId, games: 0, practices: 0 };
    row[kind] += 1;
    rollup.set(venueId, row);
  }
  for (const g of games) {
    if (g.status === "cancelled") continue;
    if (!g.venue_id) continue;
    bump(g.venue_id, "games");
  }
  for (const p of practices) {
    if (!p.field_id) continue;
    bump(p.field_id, "practices");
  }
  // Sort: most-used field first; tie-break alphabetically so the order is
  // stable when several venues share an event count.
  const utilizationRows = Array.from(rollup.values())
    .map((r) => ({
      ...r,
      name: venueNameById.get(r.venueId) ?? "Unknown venue",
      total: r.games + r.practices,
    }))
    .sort((a, b) =>
      b.total - a.total !== 0
        ? b.total - a.total
        : a.name.localeCompare(b.name),
    );

  return (
    <section
      id="reports"
      aria-labelledby="reports-heading"
      className="flex flex-col gap-6"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--fs-navy)]/[0.06]">
          <BarChart3 className="h-4 w-4 text-[var(--fs-navy)]/60" />
        </div>
        <div>
          <h2
            id="reports-heading"
            className="text-lg font-semibold text-[#0C1F3F]"
          >
            Reports
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Read-only snapshot of this season&apos;s activity.
          </p>
        </div>
      </div>

      {/* Top-line stats — display-only here; interactive Conflicts and
          Rained-out cards live in the stats row at the top of the page. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStatCard
          title="Total games scheduled"
          value={gameCount}
          icon={CalendarDays}
          subtitle={`across ${divisionCount} ${divisionCount === 1 ? "division" : "divisions"}`}
        />
        <ReportStatCard
          title="Total practices scheduled"
          value={practiceCount}
          icon={CalendarRange}
          subtitle={`across ${divisionCount} ${divisionCount === 1 ? "division" : "divisions"}`}
        />
        <ReportStatCard
          title="Open conflicts"
          value={conflictCount}
          icon={AlertTriangle}
          subtitle={
            conflictCount > 0
              ? "see Conflicts card above to resolve"
              : "no open conflicts"
          }
          accent={conflictCount > 0 ? "warning" : "neutral"}
        />
        <ReportStatCard
          title="Games rained out"
          value={rainedOutCount}
          icon={CloudRain}
          subtitle={
            rainedOutCount === 0
              ? "no rainouts this season"
              : `${rainedOutCount} this season`
          }
          accent={rainedOutCount > 0 ? "info" : "neutral"}
        />
      </div>

      {/* Field utilization */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h3 className="font-semibold text-[#0C1F3F]">Field utilization</h3>
          <p className="text-xs text-gray-400">
            {weeksInSeason} {weeksInSeason === 1 ? "week" : "weeks"} in season
          </p>
        </div>
        {utilizationRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <MapPin className="h-5 w-5 text-gray-300" />
            <p className="text-sm font-medium text-[#0C1F3F]">
              No field activity yet
            </p>
            <p className="text-xs text-gray-400">
              Once games and practices are scheduled, utilization rolls up
              here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                  <th className="px-6 py-3">Field</th>
                  <th className="px-6 py-3 text-right">Games</th>
                  <th className="px-6 py-3 text-right">Practices</th>
                  <th className="px-6 py-3 text-right">Total events</th>
                  <th className="px-6 py-3 text-right">Events / week</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {utilizationRows.map((row) => {
                  const perWeek = row.total / weeksInSeason;
                  return (
                    <tr key={row.venueId} className="hover:bg-gray-50/40">
                      <td className="px-6 py-3.5 font-medium text-[#0C1F3F]">
                        {row.name}
                      </td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
                        {row.games}
                      </td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
                        {row.practices}
                      </td>
                      <td className="px-6 py-3.5 text-right tabular-nums font-semibold text-[#0C1F3F]">
                        {row.total}
                      </td>
                      <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
                        {fmtPerWeek(perWeek)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-gray-100 px-6 py-3 text-[11px] text-gray-400">
          Events ÷ weeks in season. Includes only venues with at least one
          scheduled game or practice this season. Cancelled (rained-out) games
          are excluded.
        </p>
      </div>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Clamp to at least 1 so a 0-week season (or unset dates) doesn't trip a
// divide-by-zero in the per-week column. Reads YYYY-MM-DD strings as plain
// date components — same approach as the rest of the app, no timezone math.
function computeWeeksInSeason(
  startStr: string | null,
  endStr: string | null,
): number {
  if (!startStr || !endStr) return 1;
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  if (!start || !end) return 1;
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 1;
  const days = ms / (1000 * 60 * 60 * 24) + 1; // inclusive of end day
  return Math.max(1, Math.ceil(days / 7));
}

function parseDate(s: string): Date | null {
  const [y, m, d] = s.substring(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12);
}

function fmtPerWeek(n: number): string {
  if (n === 0) return "0";
  // 1 decimal place is plenty — 0.2, 1.7, 12.3 etc. Round-half-up.
  return (Math.round(n * 10) / 10).toFixed(1);
}

// ── Sub-component ─────────────────────────────────────────────────────────────

type ReportAccent = "neutral" | "warning" | "info";

interface ReportStatCardProps {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: ReportAccent;
}

function ReportStatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = "neutral",
}: ReportStatCardProps) {
  // Visual treatment matches the existing StatsCard but with optional accents
  // when a stat is itself a warning signal (open conflicts, rainouts > 0).
  const iconWrap =
    accent === "warning"
      ? "bg-red-50 text-red-500"
      : accent === "info"
      ? "bg-blue-50 text-blue-500"
      : "bg-[#0C1F3F]/[0.06] text-[#0C1F3F]/50";
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-[#0C1F3F] tabular-nums">
            {value}
          </p>
          <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
        </div>
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconWrap}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
