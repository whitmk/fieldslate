import { createClient } from "@/lib/supabase/server";
import {
  AlertTriangle,
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
  type VenueAvailability,
} from "@/lib/venues/availability";
import { buildSlots, type DivisionSettings } from "@/lib/schedule/slots";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  FieldUtilizationCard,
  type DivisionUtilization,
  type FieldSupply,
  type OutsideHoursGame,
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

  // Practices intentionally aren't joined for the capacity math — see the
  // "Field utilization" block below for the (load-bearing) reason they stay out
  // of both numerator and denominator. We still fetch practice_slots so the
  // table can show the per-division practice count.
  const [
    divisionsRes,
    teamsRes,
    practiceSlotsRes,
    venuesRes,
    divisionVenuesRes,
    blackoutRes,
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
    // League scheduling blackouts — buildSlots subtracts these from the
    // placeable-slot supply, so passing them keeps the report's slot count
    // identical to the pool the generator actually placed onto.
    supabase.from("blackout_dates").select("date").eq("league_id", leagueId),
  ]);

  // Games: a COMPLETE read, fail-loud. Field utilization, the venues×divisions
  // matrix, and schedule completion ALL derive from this one array, so a
  // silently-truncated read (PostgREST caps at 1000 rows) would under-count
  // every one of them and read as plausible arithmetic — the exact failure the
  // "Complete reads" note exists to prevent. On error we surface a visible
  // message and render no numbers rather than a confident wrong one. `.order`
  // ends on the unique `id` tiebreak, required for correct range paging.
  let games: GameRow[] = [];
  let gamesError: string | null = null;
  try {
    games = await fetchAllRows<GameRow>(
      "the season's games",
      ({ from, to, exactCount }) =>
        supabase
          .from("games")
          .select(
            "id, status, scheduled_at, venue_id, home_team_id, away_team_id",
            exactCount ? { count: "exact" } : undefined,
          )
          .eq("league_id", leagueId)
          .order("scheduled_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
    );
  } catch (e) {
    gamesError =
      e instanceof Error ? e.message : "Could not load the season's games.";
  }

  const league = (leagueRow ?? null) as LeagueRow | null;
  const divisions = (divisionsRes.data ?? []) as DivisionRow[];
  const teams = (teamsRes.data ?? []) as TeamRow[];
  const practices = (practiceSlotsRes.data ?? []) as unknown as PracticeRow[];
  const venues = (venuesRes.data ?? []) as VenueRow[];
  const divisionVenues =
    (divisionVenuesRes.data ?? []) as unknown as DivisionVenueRow[];
  const blackoutDates = new Set(
    ((blackoutRes.data ?? []) as { date: string }[]).map((b) => b.date),
  );

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

  // ── Field utilization (placeable-slot model) ──────────────────────────────
  // Utilization is GAMES vs PLACEABLE SLOTS, computed per (division, field) with
  // buildSlots — the SAME function the generator places games onto — so the
  // report and the scheduler can never disagree about how many games fit. The
  // old model divided game-HOURS by a venue's open wall-clock hours × all season
  // weeks; that counted non-playing weekdays, non-playing weeks, and hours no
  // game could ever start in (an 8-hour Saturday window fits three 2-hour games,
  // not four), so packed Saturday-only fields read as ~40% used.
  //
  // WHY DIVISION-CENTRIC. "How many slots" is not one number for a field shared
  // by divisions with different game lengths — a 165-min-spaced division fits
  // more starts in the same window than a 180-min one — so each division owns
  // its own slot count for a field. Supply is summed over the fields a division
  // ACTUALLY has games on, NOT every eligible field: adding eligible-but-unused
  // fields to the denominator would re-inflate it and hide over-capacity exactly
  // as the old hours model did. Eligible-unused fields already show as empty
  // columns in the games×divisions matrix below.
  //
  // SHARED-FIELD SUPPLY IS AN UPPER BOUND. buildSlots for (division, field)
  // counts every start that division could take on that field, ignoring games
  // OTHER divisions already placed there. On a field only this division uses,
  // that is exact; on a shared field it OVERSTATES supply (so the % is a floor).
  // Those rows are flagged `approx` and rendered as bounds, never as facts.
  //
  // PRACTICES ARE IN NEITHER NUMERATOR NOR DENOMINATOR — deliberately. The
  // generator does not reserve field time for practices (buildSlots takes no
  // practice input; the placement walk books only games), so netting practice
  // time out of game supply here would make the report STRICTER than the
  // scheduler — calling a field "full" while the generator happily places
  // another game on it. Report and generator disagreeing about what fits is
  // worse than the asymmetry, so practices stay an informational count only.
  // REVISIT TRIGGER: if the generator is ever changed to reserve field time
  // against practices, close this asymmetry in the SAME change — net practices
  // into supply here and reserve them in buildSlots together, never one alone.

  const seasonStart = league?.start_date ?? null;
  const seasonEnd = league?.end_date ?? null;
  const hasSeasonDates = !!seasonStart && !!seasonEnd;

  // demand[divisionId][venueId] = counting games that division plays at a venue.
  const demandByDivVenue = new Map<string, Map<string, number>>();
  // venueId → divisions with counting games there. size > 1 ⇒ shared field.
  const divisionsByVenue = new Map<string, Set<string>>();
  // divisionId → the distinct dates it actually plays on. Supply is scoped to
  // THESE dates, not every season playing-day: a division that plays 10 of the
  // season's 14 Saturdays has no field capacity on the other 4 (its teams are
  // at their weekly limit), so counting those Saturdays as supply would dilute
  // the denominator and re-hide over-capacity — the exact failure of the old
  // hours model, one rung down.
  const playDatesByDivision = new Map<string, Set<string>>();
  // Outside-hours: games with a venue, not cancelled (unchanged behavior).
  const outsideHoursAll: OutsideHoursGame[] = [];

  for (const g of games) {
    if (g.status === "cancelled") continue;
    if (!g.venue_id) continue;

    const venue = venueById.get(g.venue_id);
    const av = venueAvailabilityById.get(g.venue_id) ?? {};
    const divisionId = teamDivisionById.get(g.home_team_id);
    const div = divisionId ? divisionById.get(divisionId) : undefined;
    const durationMin = Number(
      (div?.settings as DivisionSettings | undefined)?.game_duration ?? 0,
    );

    // Demand + contention: real scheduled games on one of our fields only.
    if (divisionId && countsAsScheduledGame(g.status)) {
      let perVenue = demandByDivVenue.get(divisionId);
      if (!perVenue) {
        perVenue = new Map();
        demandByDivVenue.set(divisionId, perVenue);
      }
      perVenue.set(g.venue_id, (perVenue.get(g.venue_id) ?? 0) + 1);
      let divs = divisionsByVenue.get(g.venue_id);
      if (!divs) {
        divs = new Set();
        divisionsByVenue.set(g.venue_id, divs);
      }
      divs.add(divisionId);
      let dates = playDatesByDivision.get(divisionId);
      if (!dates) {
        dates = new Set();
        playDatesByDivision.set(divisionId, dates);
      }
      dates.add(g.scheduled_at.substring(0, 10));
    }

    // Out-of-hours detection. Substring-extracted wall time, matching the
    // app's convention (the user-typed clock value, not the TZ-shifted instant).
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
        const win = av[day];
        outsideHoursAll.push({
          id: g.id,
          scheduledAtIso: g.scheduled_at,
          dateLabel: fmtDateLabel(g.scheduled_at),
          timeLabel: fmt12(wallTime),
          dayKey: day,
          venueName: venue?.name ?? "Unknown venue",
          venueHoursLabel: win
            ? `${DAY_LABELS[day]}: ${fmt12(win.start)} – ${fmt12(win.end)}`
            : `${DAY_LABELS[day]}: Closed`,
          homeTeam,
          awayTeam,
          divisionName: div?.name ?? "",
        });
      }
    }
  }

  // Practices per division — informational only (see the asymmetry note above).
  const practicesByDivision = new Map<string, number>();
  for (const p of practices) {
    const divisionId = teamDivisionById.get(p.team_id);
    if (!divisionId) continue;
    practicesByDivision.set(
      divisionId,
      (practicesByDivision.get(divisionId) ?? 0) + 1,
    );
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

  const teamCountByDivision = new Map<string, number>();
  for (const t of teams) {
    if (!t.division_id) continue;
    teamCountByDivision.set(
      t.division_id,
      (teamCountByDivision.get(t.division_id) ?? 0) + 1,
    );
  }

  const divisionUtil: DivisionUtilization[] = divisions
    .map((d) => {
      const settings = d.settings as unknown as DivisionSettings;
      const perVenue = demandByDivVenue.get(d.id) ?? new Map<string, number>();
      const playDates = playDatesByDivision.get(d.id) ?? new Set<string>();

      const fields: FieldSupply[] = [];
      for (const [venueId, gamesHere] of perVenue) {
        const venue = venueById.get(venueId);
        if (!venue) continue;

        // Shared field ⇒ this division's slot count ignores the other
        // division's games on the same field, so supply is an upper bound.
        const approx = (divisionsByVenue.get(venueId)?.size ?? 0) > 1;

        // Supply unknown when the venue has no configured hours OR the season
        // has no dates — either way we can't count placeable slots, so we show
        // the games and mark the field, never a fabricated %. buildSlots is the
        // generator's own grid; we keep only slots on dates this division
        // actually plays (see playDatesByDivision) so empty weeks can't inflate
        // the denominator.
        const slots =
          venue.availability_configured && hasSeasonDates
            ? buildSlots(
                seasonStart as string,
                seasonEnd as string,
                settings,
                [venueId],
                venueAvailabilityById,
                blackoutDates,
              ).filter((s) => playDates.has(s.date)).length
            : null;

        fields.push({
          venueId,
          name: venue.name,
          games: gamesHere,
          slots,
          pct: slots && slots > 0 ? Math.round((gamesHere / slots) * 100) : null,
          overBy: slots !== null ? Math.max(0, gamesHere - slots) : 0,
          approx,
          unconfigured: !venue.availability_configured,
        });
      }
      fields.sort((a, b) =>
        b.games - a.games !== 0 ? b.games - a.games : a.name.localeCompare(b.name),
      );

      // Division totals over the KNOWN-supply fields only; games on
      // unknown-supply fields are surfaced separately so they never distort %.
      let games = 0;
      let slots = 0;
      let approx = false;
      let unknownGames = 0;
      for (const f of fields) {
        if (f.slots === null) {
          unknownGames += f.games;
          continue;
        }
        games += f.games;
        slots += f.slots;
        if (f.approx) approx = true;
      }

      return {
        divisionId: d.id,
        name: d.name,
        teams: teamCountByDivision.get(d.id) ?? 0,
        practices: practicesByDivision.get(d.id) ?? 0,
        games,
        slots,
        pct: slots > 0 ? Math.round((games / slots) * 100) : null,
        overBy: Math.max(0, games - slots),
        approx,
        unknownGames,
        noSeasonDates: !hasSeasonDates,
        fields,
      };
    })
    // A division with no games at all carries no utilization signal — drop it
    // rather than render a 0-of-0 row.
    .filter((d) => d.fields.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

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

      {gamesError ? (
        // Every panel below derives from the games array. A truncated or failed
        // read would make each show a confident wrong number, so we render none
        // of them and say plainly that the data couldn't be loaded.
        <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50/70 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-900">
              Reports couldn&rsquo;t load this season&rsquo;s games.
            </p>
            <p className="mt-0.5 text-xs text-red-700">
              Completion, field utilization, and the field × division matrix are
              all hidden rather than shown with missing games. Reload to try
              again.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ScheduleCompletionCard
            pct={completionPct}
            played={playedGames}
            total={totalGames}
          />

          {divisionRows.length > 0 && (
            <CollapsiblePanel
              title="Progress by division"
              icon={
                <ListChecks className="h-4 w-4 flex-shrink-0 text-gray-400" />
              }
              defaultOpen={false}
            >
              <DivisionProgressTable rows={divisionRows} />
            </CollapsiblePanel>
          )}

          <CollapsiblePanel
            title="Field utilization"
            subtitle="games scheduled vs. placeable field slots"
            icon={<Gauge className="h-4 w-4 flex-shrink-0 text-gray-400" />}
            defaultOpen={false}
          >
            <FieldUtilizationCard
              divisions={divisionUtil}
              outsideHoursGames={outsideHoursGames}
              outsideHoursTruncated={outsideHoursTruncated}
              embedded
            />
          </CollapsiblePanel>

          {divisions.length > 0 && (
            <CollapsiblePanel
              title="Games by field & division"
              subtitle="actual scheduled games"
              icon={
                <LayoutGrid className="h-4 w-4 flex-shrink-0 text-gray-400" />
              }
              defaultOpen
            >
              <VenueDivisionMatrix columns={matrixColumns} rows={matrixRows} />
            </CollapsiblePanel>
          )}
        </>
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
