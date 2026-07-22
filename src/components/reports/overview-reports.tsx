import { createClient } from "@/lib/supabase/server";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Gauge,
  LayoutGrid,
  ListChecks,
} from "lucide-react";
import { countsAsScheduledGame } from "@/lib/venues/game-days";
import { CollapsiblePanel } from "./collapsible-panel";
import {
  VenueDivisionMatrix,
  type MatrixColumn,
  type MatrixRow,
} from "./venue-division-matrix";
import {
  DAY_LABELS,
  dayKeyFromIsoDate,
  isVenueAvailable,
  parseAvailability,
  weeklyAvailableHours,
  type VenueAvailability,
} from "@/lib/venues/availability";
import {
  FieldUtilizationCard,
  type OutsideHoursGame,
  type UtilizationRow,
} from "./field-utilization-card";

// ── Props ─────────────────────────────────────────────────────────────────────
// `leagueId` is the resolved season id from `?season=...` on /dashboard.
// `null` means the picker is on "All seasons" — Reports is intentionally
// single-season (completion + capacity math only make sense in one season
// window).
interface Props {
  leagueId: string | null;
}

// Cap on the View-list payload sent to the client. Above this we trim and
// signal `truncated` to the modal footer; the engineering follow-up note
// also fires via console.warn at render time.
const OUTSIDE_HOURS_MAX = 100;

// ── Type shapes ───────────────────────────────────────────────────────────────

type LeagueRow = { start_date: string | null; end_date: string | null };
type DivisionRow = {
  id: string;
  name: string;
  settings: unknown;
};
type TeamRow = { id: string; name: string; division_id: string | null };
type GameRow = {
  id: string;
  status: string;
  scheduled_at: string;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string | null;
};
type PracticeRow = {
  id: string;
  team_id: string;
  field_id: string | null;
};
type VenueRow = {
  id: string;
  name: string;
  availability: unknown;
  availability_configured: boolean;
};
type DivisionVenueRow = {
  division_id: string;
  venue_id: string;
  allow_games: boolean;
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

  // Fetch the league first so we know its owner_id — needed to scope the
  // venues lookup to the same org. Without that scope a multi-org admin's
  // venue list could include venues from another org (RLS allows them);
  // the per-venue utilization math could then mis-attribute when names
  // collide across orgs.
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("start_date, end_date, owner_id")
    .eq("id", leagueId)
    .single();
  const leagueOwnerId =
    (leagueRow as { owner_id: string } | null)?.owner_id ?? null;

  // Practices intentionally aren't joined for the capacity math anymore — a
  // practice_slot row is a weekly *definition*, not a per-occurrence scheduled
  // event, so counting it against hours-used is the wrong model. We still
  // fetch practice_slots so the table can show the per-venue practice count.
  const [
    divisionsRes,
    teamsRes,
    gamesRes,
    practiceSlotsRes,
    venuesRes,
    divisionVenuesRes,
  ] = await Promise.all([
    supabase
      .from("divisions")
      .select("id, name, settings")
      .eq("league_id", leagueId)
      .order("name"),
    supabase
      .from("teams")
      .select("id, name, division_id")
      .eq("league_id", leagueId),
    supabase
      .from("games")
      .select("id, status, scheduled_at, venue_id, home_team_id, away_team_id")
      .eq("league_id", leagueId),
    supabase
      .from("practice_slots")
      .select("id, team_id, field_id, team:teams!inner(league_id)")
      .eq("team.league_id", leagueId),
    leagueOwnerId
      ? supabase
          .from("venues")
          .select("id, name, availability, availability_configured")
          .eq("owner_id", leagueOwnerId)
      : Promise.resolve({ data: [] as unknown[] }),
    // Game-eligible venue columns for the venues×divisions matrix. Same
    // divisions!inner league-scope filter shape the practice_slots read uses;
    // selecting rows (not head+count), so the PostgREST embedded-count caveat
    // doesn't apply.
    supabase
      .from("division_venues")
      .select("division_id, venue_id, allow_games, division:divisions!inner(league_id)")
      .eq("division.league_id", leagueId)
      .eq("allow_games", true),
  ]);

  const league = (leagueRow ?? null) as LeagueRow | null;
  const divisions = (divisionsRes.data ?? []) as DivisionRow[];
  const teams = (teamsRes.data ?? []) as TeamRow[];
  const games = (gamesRes.data ?? []) as GameRow[];
  const practices = (practiceSlotsRes.data ?? []) as unknown as PracticeRow[];
  const venues = (venuesRes.data ?? []) as VenueRow[];
  const divisionVenues =
    (divisionVenuesRes.data ?? []) as unknown as DivisionVenueRow[];

  const hasSeasonDates = !!league?.start_date && !!league?.end_date;
  const weeksInSeason = computeWeeksInSeason(
    league?.start_date ?? null,
    league?.end_date ?? null,
  );
  const weeksLabel = hasSeasonDates
    ? `${weeksInSeason} ${weeksInSeason === 1 ? "week" : "weeks"} in season`
    : "season dates not set";

  // ── Per-team / per-division lookups ───────────────────────────────────────
  const teamById = new Map<string, TeamRow>();
  for (const t of teams) teamById.set(t.id, t);

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

  // ── Schedule completion (whole season) ────────────────────────────────────
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

  // ── Field utilization (games-only) ────────────────────────────────────────
  // Per the games-only model: utilization measures GAME load against a venue's
  // weekly hours × season weeks. Practices show as a column but don't move the
  // %. A venue can be in the table even with 0 games (active via practices),
  // it just renders 0%.

  type VenueAgg = {
    venueId: string;
    games: number;
    practices: number;
    usedGameH: number;
  };
  const venueAgg = new Map<string, VenueAgg>();
  function ensureVenue(id: string): VenueAgg {
    let v = venueAgg.get(id);
    if (!v) {
      v = { venueId: id, games: 0, practices: 0, usedGameH: 0 };
      venueAgg.set(id, v);
    }
    return v;
  }

  // Outside-hours: games only (practices are weekly definitions, not events).
  const outsideHoursAll: OutsideHoursGame[] = [];

  for (const g of games) {
    if (g.status === "cancelled") continue;
    if (!g.venue_id) continue;

    const venue = venueById.get(g.venue_id);
    const av = venueAvailabilityById.get(g.venue_id) ?? {};
    const v = ensureVenue(g.venue_id);
    v.games += 1;

    const divisionId = teamDivisionById.get(g.home_team_id);
    const div = divisionId ? divisionById.get(divisionId) : undefined;
    const settings = (div?.settings ?? {}) as DivisionSettings;
    const durationMin = Number(settings.game_duration ?? 0);
    v.usedGameH += durationMin / 60;

    // Out-of-hours detection (games only). Uses substring-extracted wall
    // time, matching the convention elsewhere in the app (the user-typed
    // clock value, not the TZ-shifted instant).
    if (
      venue?.availability_configured &&
      Object.keys(av).length > 0 &&
      durationMin > 0
    ) {
      const day = dayKeyFromIsoDate(g.scheduled_at);
      const wallTime = g.scheduled_at.substring(11, 16);
      if (!isVenueAvailable(av, day, wallTime, durationMin)) {
        const homeTeam = teamById.get(g.home_team_id)?.name ?? "Home";
        const awayTeam = g.away_team_id
          ? teamById.get(g.away_team_id)?.name ?? "Away"
          : "TBD";
        const divName = div?.name ?? "";
        const win = av[day];
        const venueHoursLabel = win
          ? `${DAY_LABELS[day]}: ${fmt12(win.start)} – ${fmt12(win.end)}`
          : `${DAY_LABELS[day]}: Closed`;

        outsideHoursAll.push({
          id: g.id,
          scheduledAtIso: g.scheduled_at,
          dateLabel: fmtDateLabel(g.scheduled_at),
          timeLabel: fmt12(wallTime),
          dayKey: day,
          venueName: venue?.name ?? "Unknown venue",
          venueHoursLabel,
          homeTeam,
          awayTeam,
          divisionName: divName,
        });
      }
    }
  }

  // Practices: only counted for display in the per-venue table.
  for (const p of practices) {
    if (!p.field_id) continue;
    ensureVenue(p.field_id).practices += 1;
  }

  // Sort earliest-first so the View list is chronological.
  outsideHoursAll.sort((a, b) =>
    a.scheduledAtIso.localeCompare(b.scheduledAtIso),
  );

  const outsideHoursTruncated = outsideHoursAll.length > OUTSIDE_HOURS_MAX;
  const outsideHoursGames = outsideHoursTruncated
    ? outsideHoursAll.slice(0, OUTSIDE_HOURS_MAX)
    : outsideHoursAll;

  if (outsideHoursTruncated) {
    // Engineering note: pagination follow-up if this ever fires in practice.
    console.warn(
      `[OverviewReports] outside-hours list truncated: ${outsideHoursAll.length} > ${OUTSIDE_HOURS_MAX}`,
    );
  }

  // Build rows. An "active" venue is one with any games or practices. Display
  // rules:
  //  - unconfigured + has events → row shows "—" with a "Configure hours" link
  //  - configured with hours > 0 → utilization %, with over-capacity badge
  //  - configured but 0 hours → defensively excluded (UI doesn't permit)
  const utilizationRows: UtilizationRow[] = [];
  for (const v of venueAgg.values()) {
    const venue = venueById.get(v.venueId);
    if (!venue) continue;
    const av = venueAvailabilityById.get(v.venueId) ?? {};
    const availableH = weeklyAvailableHours(av) * weeksInSeason;
    const usedH = v.usedGameH;

    if (!venue.availability_configured) {
      utilizationRows.push({
        venueId: v.venueId,
        name: venue.name,
        games: v.games,
        practices: v.practices,
        pct: null,
        rawPct: null,
        overCapacity: false,
        unconfigured: true,
        availability: av,
      });
      continue;
    }

    if (availableH <= 0) continue;

    const rawPct = Math.round((usedH / availableH) * 100);
    utilizationRows.push({
      venueId: v.venueId,
      name: venue.name,
      games: v.games,
      practices: v.practices,
      pct: Math.min(100, rawPct),
      rawPct,
      overCapacity: usedH > availableH,
      unconfigured: false,
      availability: av,
    });
  }

  utilizationRows.sort((a, b) => {
    const aTotal = a.games + a.practices;
    const bTotal = b.games + b.practices;
    return bTotal - aTotal !== 0
      ? bTotal - aTotal
      : a.name.localeCompare(b.name);
  });

  // ── Venues × divisions game matrix ────────────────────────────────────────
  // Columns: game-eligible venues this season (division_venues.allow_games), so
  // an eligible-but-unused field shows as an empty column (a wanted signal) —
  // NOT all org venues, NOT only venues-with-games. Unioned defensively with any
  // venue that actually has a counted game, so a game can never be hidden by a
  // since-changed eligibility flag (on current data the two sets coincide).
  // Rows: divisions. Cell: count of real scheduled games (home team's division ×
  // venue), using the shared countsAsScheduledGame exclusion set.
  const matrixCounts = new Map<string, number>(); // `${divId}|${venueId}` → count
  const venueIdsWithGames = new Set<string>();
  for (const g of games) {
    if (!g.venue_id) continue;
    if (!countsAsScheduledGame(g.status)) continue;
    const divisionId = teamDivisionById.get(g.home_team_id);
    if (!divisionId) continue;
    venueIdsWithGames.add(g.venue_id);
    const key = `${divisionId}|${g.venue_id}`;
    matrixCounts.set(key, (matrixCounts.get(key) ?? 0) + 1);
  }

  const columnVenueIds = new Set<string>();
  for (const dv of divisionVenues) columnVenueIds.add(dv.venue_id);
  for (const vid of venueIdsWithGames) columnVenueIds.add(vid);

  const matrixColumns: MatrixColumn[] = [...columnVenueIds]
    .map((id) => ({ id, name: venueById.get(id)?.name ?? "Unknown field" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const matrixRows: MatrixRow[] = divisions
    .map((d) => ({
      id: d.id,
      name: d.name,
      counts: matrixColumns.map((c) => matrixCounts.get(`${d.id}|${c.id}`) ?? 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section
      id="reports"
      aria-labelledby="reports-heading"
      className="flex flex-col gap-5"
    >
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

      <ScheduleCompletionCard
        pct={completionPct}
        played={playedGames}
        total={totalGames}
      />

      {divisionRows.length > 0 && (
        <CollapsiblePanel
          title="Progress by division"
          icon={<ListChecks className="h-4 w-4 flex-shrink-0 text-gray-400" />}
          defaultOpen={false}
        >
          <DivisionProgressTable rows={divisionRows} />
        </CollapsiblePanel>
      )}

      <CollapsiblePanel
        title="Field utilization"
        subtitle={`% of game capacity in use · ${weeksLabel}`}
        icon={<Gauge className="h-4 w-4 flex-shrink-0 text-gray-400" />}
        defaultOpen={false}
      >
        <FieldUtilizationCard
          rows={utilizationRows}
          weeksLabel={weeksLabel}
          outsideHoursGames={outsideHoursGames}
          outsideHoursTruncated={outsideHoursTruncated}
          embedded
        />
      </CollapsiblePanel>

      {divisions.length > 0 && (
        <CollapsiblePanel
          title="Games by field & division"
          subtitle="actual scheduled games"
          icon={<LayoutGrid className="h-4 w-4 flex-shrink-0 text-gray-400" />}
          defaultOpen
        >
          <VenueDivisionMatrix columns={matrixColumns} rows={matrixRows} />
        </CollapsiblePanel>
      )}
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

// Renders bare (no outer card / title header) — always hosted inside a
// CollapsiblePanel, which supplies the card chrome and the "Progress by
// division" title.
function DivisionProgressTable({ rows }: { rows: DivisionProgressRow[] }) {
  return (
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
                <CompletionProgressBar pct={row.pct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompletionProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    pct >= 50 ? "#639922" : pct >= 30 ? "#EF9F27" : "#E24B4A";
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

// Format the date portion of a scheduled_at string as "Sat, Aug 22" using the
// substring date (no TZ conversion). Matches the rest of the app's
// wall-clock convention.
function fmtDateLabel(iso: string): string {
  const ymd = iso.substring(0, 10);
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
