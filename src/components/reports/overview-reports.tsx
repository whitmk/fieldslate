import { createClient } from "@/lib/supabase/server";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
} from "lucide-react";
import Link from "next/link";
import {
  dayKeyFromIsoDate,
  isVenueAvailable,
  parseAvailability,
  weeklyAvailableHours,
  type VenueAvailability,
} from "@/lib/venues/availability";

// ── Props ─────────────────────────────────────────────────────────────────────
// `leagueId` is the resolved season id from `?season=...` on /dashboard.
// `null` means the picker is on "All seasons" — Reports is intentionally
// single-season (completion + capacity math only make sense in one season
// window).
interface Props {
  leagueId: string | null;
}

// ── Type shapes ───────────────────────────────────────────────────────────────

type LeagueRow = { start_date: string | null; end_date: string | null };
type DivisionRow = {
  id: string;
  name: string;
  settings: unknown;
};
type TeamRow = { id: string; division_id: string | null };
type GameRow = {
  id: string;
  status: string;
  scheduled_at: string;
  venue_id: string | null;
  home_team_id: string;
};
type TimeSlotRow = {
  id: string;
  division_id: string;
  duration_minutes: number;
  days_of_week: string[];
  start_time: string;
};
type PracticeRow = {
  id: string;
  team_id: string;
  time_slot_id: string | null;
  field_id: string | null;
  type: string;
  practice_days: string[];
  date: string | null;
};
type VenueRow = {
  id: string;
  name: string;
  availability: unknown;
  availability_configured: boolean;
};

type DivisionSettings = {
  game_duration?: number;
};

// ── Component ─────────────────────────────────────────────────────────────────

export async function OverviewReports({ leagueId }: Props) {
  if (!leagueId) {
    return <AllSeasonsExplainer />;
  }

  const supabase = createClient();

  // Fan-out every query for this season in parallel. The page already ran its
  // own Promise.all before reaching this component, so this block fires once,
  // sequentially after that.
  const [
    leagueRes,
    divisionsRes,
    teamsRes,
    gamesRes,
    timeSlotsRes,
    practiceSlotsRes,
    venuesRes,
  ] = await Promise.all([
    supabase
      .from("leagues")
      .select("start_date, end_date")
      .eq("id", leagueId)
      .single(),
    supabase
      .from("divisions")
      .select("id, name, settings")
      .eq("league_id", leagueId)
      .order("name"),
    supabase
      .from("teams")
      .select("id, division_id")
      .eq("league_id", leagueId),
    supabase
      .from("games")
      .select("id, status, scheduled_at, venue_id, home_team_id")
      .eq("league_id", leagueId),
    supabase
      .from("practice_time_slots")
      .select(
        "id, division_id, duration_minutes, days_of_week, start_time, division:divisions!inner(league_id)",
      )
      .eq("division.league_id", leagueId),
    supabase
      .from("practice_slots")
      .select(
        "id, team_id, time_slot_id, field_id, type, practice_days, date, team:teams!inner(league_id)",
      )
      .eq("team.league_id", leagueId),
    // RLS scopes venues to the org owner; pull the full set so we can compute
    // capacity from each venue's own availability map.
    supabase
      .from("venues")
      .select("id, name, availability, availability_configured"),
  ]);

  const league = (leagueRes.data ?? null) as LeagueRow | null;
  const divisions = (divisionsRes.data ?? []) as DivisionRow[];
  const teams = (teamsRes.data ?? []) as TeamRow[];
  const games = (gamesRes.data ?? []) as GameRow[];
  const timeSlots = (timeSlotsRes.data ?? []) as unknown as TimeSlotRow[];
  const practices = (practiceSlotsRes.data ?? []) as unknown as PracticeRow[];
  const venues = (venuesRes.data ?? []) as VenueRow[];

  const weeksInSeason = computeWeeksInSeason(
    league?.start_date ?? null,
    league?.end_date ?? null,
  );

  // ── Per-team / per-division lookups ───────────────────────────────────────
  const teamDivisionById = new Map<string, string | null>();
  for (const t of teams) teamDivisionById.set(t.id, t.division_id);

  const divisionById = new Map<string, DivisionRow>();
  for (const d of divisions) divisionById.set(d.id, d);

  const venueById = new Map<string, VenueRow>();
  for (const v of venues) venueById.set(v.id, v);

  const venueAvailabilityById = new Map<string, VenueAvailability>();
  for (const v of venues) {
    venueAvailabilityById.set(v.id, parseAvailability(v.availability));
  }

  const timeSlotById = new Map<string, TimeSlotRow>();
  for (const ts of timeSlots) timeSlotById.set(ts.id, ts);

  // ── Schedule completion (whole season) ────────────────────────────────────
  // Played = a non-cancelled game whose scheduled time has already passed.
  // Cancelled games never get played, so they're excluded from both played
  // and total.
  const now = Date.now();
  let totalGames = 0;
  let playedGames = 0;
  const perDivision = new Map<
    string,
    { divisionId: string; played: number; total: number }
  >();
  for (const g of games) {
    if (g.status === "cancelled") continue;
    totalGames += 1;
    const isPlayed = Date.parse(g.scheduled_at) < now;
    if (isPlayed) playedGames += 1;

    const divisionId = teamDivisionById.get(g.home_team_id);
    if (!divisionId) continue;
    const row =
      perDivision.get(divisionId) ?? {
        divisionId,
        played: 0,
        total: 0,
      };
    row.total += 1;
    if (isPlayed) row.played += 1;
    perDivision.set(divisionId, row);
  }
  const completionPct =
    totalGames === 0 ? 0 : Math.round((playedGames / totalGames) * 100);

  const divisionRows = divisions
    .map((d) => {
      const agg = perDivision.get(d.id);
      const total = agg?.total ?? 0;
      const played = agg?.played ?? 0;
      const pct = total === 0 ? 0 : Math.round((played / total) * 100);
      return { id: d.id, name: d.name, played, total, pct };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── Field utilization ─────────────────────────────────────────────────────
  // Capacity now comes from each venue's own weekly availability, NOT from
  // summing across divisions. This fixes the prior over-count when multiple
  // divisions shared a venue's playing window.
  //
  //   available_hours = weeklyAvailableHours(venue.availability) × weeksInSeason
  //
  // Used hours per venue:
  //   - games:     home team's division.game_duration / 60 per non-cancelled game
  //   - practices: time_slot.duration / 60, expanded for recurring slots by
  //                |practice_days| × weeksInSeason; one-offs count as 1.

  type VenueAgg = {
    venueId: string;
    games: number;
    practices: number;
    usedGameH: number;
    usedPracticeH: number;
  };
  const venueAgg = new Map<string, VenueAgg>();
  function ensureVenue(id: string): VenueAgg {
    let v = venueAgg.get(id);
    if (!v) {
      v = {
        venueId: id,
        games: 0,
        practices: 0,
        usedGameH: 0,
        usedPracticeH: 0,
      };
      venueAgg.set(id, v);
    }
    return v;
  }

  let outOfHoursCount = 0;

  for (const g of games) {
    if (g.status === "cancelled") continue;
    if (!g.venue_id) continue;
    const v = ensureVenue(g.venue_id);
    v.games += 1;
    const divisionId = teamDivisionById.get(g.home_team_id);
    const div = divisionId ? divisionById.get(divisionId) : undefined;
    const settings = (div?.settings ?? {}) as DivisionSettings;
    const durationMin = Number(settings.game_duration ?? 0);
    v.usedGameH += durationMin / 60;

    // Out-of-hours guard for the warning row above the table.
    const av = venueAvailabilityById.get(g.venue_id);
    if (av && Object.keys(av).length > 0) {
      const day = dayKeyFromIsoDate(g.scheduled_at);
      const wallTime = g.scheduled_at.substring(11, 16);
      if (durationMin > 0 && !isVenueAvailable(av, day, wallTime, durationMin)) {
        outOfHoursCount += 1;
      }
    }
  }

  for (const p of practices) {
    if (!p.field_id) continue;
    const v = ensureVenue(p.field_id);
    v.practices += 1;
    const ts = p.time_slot_id ? timeSlotById.get(p.time_slot_id) : undefined;
    const durationMin = ts?.duration_minutes ?? 90;
    const durationH = durationMin / 60;
    if (p.type === "one_off") {
      v.usedPracticeH += durationH;
    } else {
      const days = p.practice_days?.length ?? 0;
      v.usedPracticeH += durationH * days * weeksInSeason;
    }

    // Out-of-hours guard for practices. A recurring slot is out-of-hours if
    // ANY of its days falls outside the venue's window at that wall time —
    // one slot can yield up to N day-level mismatches but we collapse to one
    // count per practice_slot row to keep the headline number readable.
    const av = venueAvailabilityById.get(p.field_id);
    if (av && Object.keys(av).length > 0 && ts) {
      const wallTime = ts.start_time.substring(0, 5);
      const days =
        p.type === "one_off"
          ? p.date
            ? [dayKeyFromIsoDate(p.date)]
            : []
          : (p.practice_days ?? []).map((d) => d as ReturnType<typeof dayKeyFromIsoDate>);
      const anyBad = days.some(
        (d) => !isVenueAvailable(av, d, wallTime, durationMin),
      );
      if (anyBad) outOfHoursCount += 1;
    }
  }

  // Build the final per-venue rows. Cases:
  //  - venue.availability_configured = false AND has events → show with "—" %
  //    and a "configure hours" link in the % column (still appears in the
  //    table so the admin sees the activity).
  //  - configured but zero available hours (defensive — UI shouldn't allow
  //    this) → exclude.
  //  - configured with hours → render utilization %, capped at 100% on
  //    display with an "over capacity" badge when used > available.
  type UtilizationRow = {
    venueId: string;
    name: string;
    games: number;
    practices: number;
    total: number;
    pct: number | null;            // null = unconfigured
    rawPct: number | null;          // pre-cap for tooltip
    overCapacity: boolean;
    unconfigured: boolean;
  };

  const utilizationRows: UtilizationRow[] = [];
  for (const v of venueAgg.values()) {
    const venue = venueById.get(v.venueId);
    if (!venue) continue;
    const av = venueAvailabilityById.get(v.venueId) ?? {};
    const availableH =
      weeklyAvailableHours(av) * weeksInSeason;
    const totalUsed = v.usedGameH + v.usedPracticeH;

    if (!venue.availability_configured) {
      utilizationRows.push({
        venueId: v.venueId,
        name: venue.name,
        games: v.games,
        practices: v.practices,
        total: v.games + v.practices,
        pct: null,
        rawPct: null,
        overCapacity: false,
        unconfigured: true,
      });
      continue;
    }

    if (availableH <= 0) continue;

    const rawPct = Math.round((totalUsed / availableH) * 100);
    const overCapacity = totalUsed > availableH;
    utilizationRows.push({
      venueId: v.venueId,
      name: venue.name,
      games: v.games,
      practices: v.practices,
      total: v.games + v.practices,
      pct: Math.min(100, rawPct),
      rawPct,
      overCapacity,
      unconfigured: false,
    });
  }

  utilizationRows.sort((a, b) =>
    b.total - a.total !== 0
      ? b.total - a.total
      : a.name.localeCompare(b.name),
  );

  return (
    <section
      id="reports"
      aria-labelledby="reports-heading"
      className="flex flex-col gap-5"
    >
      {/* Section header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0b1c39]/[0.06]">
          <BarChart3 className="h-4 w-4 text-[#0b1c39]/60" />
        </div>
        <div>
          <h2
            id="reports-heading"
            className="text-lg font-semibold text-[#0b1c39]"
          >
            Reports
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Season snapshot — completion and field load.
          </p>
        </div>
      </div>

      {/* A. Schedule completion card (left-aligned, narrow) */}
      <ScheduleCompletionCard
        pct={completionPct}
        played={playedGames}
        total={totalGames}
      />

      {/* B. Per-division progress */}
      {divisionRows.length > 0 && (
        <DivisionProgressTable rows={divisionRows} />
      )}

      {/* C. Field utilization */}
      <FieldUtilizationCard
        rows={utilizationRows}
        weeksInSeason={weeksInSeason}
        outOfHoursCount={outOfHoursCount}
      />
    </section>
  );
}

// ── "All seasons" mode ────────────────────────────────────────────────────────

function AllSeasonsExplainer() {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0b1c39]/[0.06]">
          <BarChart3 className="h-4 w-4 text-[#0b1c39]/60" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[#0b1c39]">Reports</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Season snapshot — completion and field load.
          </p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white px-6 py-10 text-center shadow-sm">
        <CalendarDays className="h-5 w-5 text-gray-300" />
        <p className="text-sm font-medium text-[#0b1c39]">
          Pick a season to view Reports
        </p>
        <p className="max-w-sm text-xs text-gray-400">
          Schedule completion and field utilization are scoped to a single
          season. Choose one in the picker above.
        </p>
      </div>
    </section>
  );
}

// ── A. Schedule completion ────────────────────────────────────────────────────

function ScheduleCompletionCard({
  pct,
  played,
  total,
}: {
  pct: number;
  played: number;
  total: number;
}) {
  const subtitle =
    total === 0
      ? "no games scheduled yet"
      : `${played} of ${total} ${total === 1 ? "game" : "games"} played`;
  return (
    <div className="w-full max-w-[280px] rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#EAF3DE]">
          <CheckCircle2 className="h-5 w-5 text-[#3B6D11]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">
            Schedule completion
          </p>
          <p className="mt-1 text-3xl font-bold text-[#0b1c39] tabular-nums">
            {pct}%
          </p>
          <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

// ── B. Per-division progress ──────────────────────────────────────────────────

interface DivisionProgressRow {
  id: string;
  name: string;
  played: number;
  total: number;
  pct: number;
}

function DivisionProgressTable({ rows }: { rows: DivisionProgressRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <h3 className="font-semibold text-[#0b1c39]">Progress by division</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
              <th className="px-6 py-3">Division</th>
              <th className="px-6 py-3 text-right">Played</th>
              <th className="px-6 py-3 text-right">Total</th>
              <th className="px-6 py-3 w-[40%]">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50/40">
                <td className="px-6 py-3.5 font-medium text-[#0b1c39]">
                  {row.name}
                </td>
                <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
                  {row.played}
                </td>
                <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
                  {row.total}
                </td>
                <td className="px-6 py-3.5">
                  <ProgressBarWithLabel pct={row.pct} kind="completion" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── C. Field utilization ──────────────────────────────────────────────────────

interface UtilizationRow {
  venueId: string;
  name: string;
  games: number;
  practices: number;
  total: number;
  pct: number | null;
  rawPct: number | null;
  overCapacity: boolean;
  unconfigured: boolean;
}

function FieldUtilizationCard({
  rows,
  weeksInSeason,
  outOfHoursCount,
}: {
  rows: UtilizationRow[];
  weeksInSeason: number;
  outOfHoursCount: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
        <h3 className="font-semibold text-[#0b1c39]">Field utilization</h3>
        <p className="text-xs text-gray-400">
          % of configured capacity in use ·{" "}
          {weeksInSeason} {weeksInSeason === 1 ? "week" : "weeks"} in season
        </p>
      </div>

      {/* Out-of-hours warning row — events scheduled outside their venue's
          configured availability. List view is a follow-up (logged to console
          for now). */}
      {outOfHoursCount > 0 && (
        <div className="flex items-start gap-2.5 border-b border-amber-100 bg-amber-50/70 px-6 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            {outOfHoursCount}{" "}
            {outOfHoursCount === 1 ? "event is" : "events are"} scheduled
            outside configured venue hours.{" "}
            <a
              href="#"
              className="text-amber-900 underline underline-offset-2"
              title="A list view is a follow-up; check the schedule for details."
            >
              View list
            </a>
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <MapPin className="h-5 w-5 text-gray-300" />
          <p className="text-sm font-medium text-[#0b1c39]">
            No field activity yet
          </p>
          <p className="text-xs text-gray-400">
            Once games and practices are scheduled, utilization rolls up here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                  <th className="px-6 py-3">Field</th>
                  <th className="px-6 py-3 text-right">Games</th>
                  <th className="px-6 py-3 text-right">Practices</th>
                  <th className="px-6 py-3 text-right">Total events</th>
                  <th className="px-6 py-3 w-[35%]">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row) => (
                  <tr key={row.venueId} className="hover:bg-gray-50/40">
                    <td className="px-6 py-3.5 font-medium text-[#0b1c39]">
                      <span className="inline-flex items-center gap-2">
                        {row.name}
                        {row.overCapacity && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600"
                            title={`Used hours exceed capacity (${row.rawPct}%).`}
                          >
                            Over capacity
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
                      {row.games}
                    </td>
                    <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
                      {row.practices}
                    </td>
                    <td className="px-6 py-3.5 text-right tabular-nums font-semibold text-[#0b1c39]">
                      {row.total}
                    </td>
                    <td className="px-6 py-3.5">
                      {row.unconfigured ? (
                        <ConfigureHoursCell />
                      ) : (
                        <ProgressBarWithLabel
                          pct={row.pct ?? 0}
                          kind="utilization"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <UtilizationLegend />
        </>
      )}
    </div>
  );
}

function ConfigureHoursCell() {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-gray-400">—</span>
      <Link
        href="/dashboard/venues"
        className="inline-flex items-center gap-1 text-xs text-[#22C55E] underline-offset-2 hover:underline"
      >
        <Clock className="h-3 w-3" />
        Configure hours
      </Link>
    </div>
  );
}

function UtilizationLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-gray-100 bg-gray-50/40 px-6 py-3 text-[11px] text-gray-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#EF9F27]" />
        Under 40% — underused
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#639922]" />
        40–85% — healthy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#E24B4A]" />
        Over 85% — at capacity
      </span>
    </div>
  );
}

// ── Shared: progress bar with right-aligned % label ───────────────────────────
// Two color schemes — "completion" (low = bad) vs "utilization" (mid = good).

function ProgressBarWithLabel({
  pct,
  kind,
}: {
  pct: number;
  kind: "completion" | "utilization";
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    kind === "completion"
      ? completionColor(pct)
      : utilizationColor(pct);
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-gray-100"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-[3px]"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className="min-w-[36px] text-right text-xs tabular-nums text-gray-500">
        {pct}%
      </span>
    </div>
  );
}

// "Completion" semantics: green good, red bad (low played = far behind).
function completionColor(pct: number): string {
  if (pct >= 50) return "#639922";
  if (pct >= 30) return "#EF9F27";
  return "#E24B4A";
}

// "Utilization" semantics: middle good, edges concerning.
function utilizationColor(pct: number): string {
  if (pct < 40) return "#EF9F27";
  if (pct <= 85) return "#639922";
  return "#E24B4A";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeWeeksInSeason(
  startStr: string | null,
  endStr: string | null,
): number {
  if (!startStr || !endStr) return 1;
  const [sy, sm, sd] = startStr.substring(0, 10).split("-").map(Number);
  const [ey, em, ed] = endStr.substring(0, 10).split("-").map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return 1;
  const start = new Date(sy, sm - 1, sd, 12);
  const end = new Date(ey, em - 1, ed, 12);
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 1;
  const days = ms / (1000 * 60 * 60 * 24) + 1; // inclusive
  return Math.max(1, Math.ceil(days / 7));
}
