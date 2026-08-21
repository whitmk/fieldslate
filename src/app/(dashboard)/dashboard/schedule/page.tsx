import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddGameButton } from "@/components/schedule/add-game-modal";
import { DivisionFilter } from "@/components/schedule/division-filter";
import { TeamFilter } from "@/components/schedule/team-filter";
import { VenueFilter } from "@/components/schedule/venue-filter";
import { HidePastToggle } from "@/components/schedule/hide-past-toggle";
import {
  ViewModeToggle,
  type ViewMode,
} from "@/components/schedule/view-mode-toggle";
import {
  ScheduleList,
  type ScheduleGame,
} from "@/components/schedule/schedule-list";
import { ScheduleCalendar } from "@/components/schedule/schedule-calendar";
import { ScheduleWeekGrid } from "@/components/schedule/schedule-week-grid";
import { SchedulePrintButton } from "@/components/schedule/schedule-print-button";
import { SchedulePrintRegion } from "@/components/schedule/schedule-print-region";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { gameDurationsFromDivisionRows } from "@/lib/schedule/division-durations";
import {
  parseWeekParam,
  weekRange,
  type WeekVenueInput,
} from "@/lib/schedule/week-grid";
import { byQualifiedVenueLabel } from "@/lib/venues/venue-label";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isProPlus } from "@/lib/plan/limits";
import { isSetupIncomplete } from "@/lib/setup/derive-step";

function parseMode(raw: string | undefined): ViewMode {
  if (raw === "calendar") return "calendar";
  if (raw === "week") return "week";
  return "list";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayLocalDateString(): string {
  return localDateStr(new Date());
}

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function parseMonth(s: string | undefined): string {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return defaultMonth();
  return s;
}

function buildGridRange(month: string): {
  gridStart: string;
  gridEnd: string;
  dayAfterGridEnd: string;
} {
  const [yr, mo] = month.split("-").map(Number);
  const first = new Date(yr, mo - 1, 1);
  const startOffset = first.getDay(); // 0 = Sunday
  const gridStart = new Date(yr, mo - 1, 1 - startOffset);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);
  const dayAfterGridEnd = new Date(gridStart);
  dayAfterGridEnd.setDate(gridStart.getDate() + 42);
  return {
    gridStart: localDateStr(gridStart),
    gridEnd: localDateStr(gridEnd),
    dayAfterGridEnd: localDateStr(dayAfterGridEnd),
  };
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: {
    division?: string;
    team?: string;
    venue?: string;
    past?: string;
    mode?: string;
    month?: string;
    week?: string;
  };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);
  // Plan drives the Pro+ auto-reschedule action in the row/pill menus
  // (basic "Mark as rained out" stays Free). React-cached, shared w/ layout.
  const plan = await getOrgPlan(currentOrgId);
  const selectedDivisionId = searchParams.division ?? "";
  const selectedTeamId = searchParams.team ?? "";
  const selectedVenueId = searchParams.venue ?? "";
  const mode = parseMode(searchParams.mode);
  const month = parseMonth(searchParams.month);
  // NULL when absent or malformed, and deliberately never defaulted here: the
  // only correct "current week" depends on the VIEWER's timezone and this is a
  // server component, where the clock is UTC. ScheduleWeekGrid resolves a null
  // from the browser and rewrites the URL. See week-grid.ts.
  const weekStart = mode === "week" ? parseWeekParam(searchParams.week) : null;
  // Default ON; the URL only carries `past=1` when the user has switched it OFF.
  const hidePast = searchParams.past !== "1";

  // Season-scoped (Chunk B1): the games list, the filter dropdowns, and the
  // Add Game modal all follow the topbar's selected season. A null season
  // (no active seasons) renders the existing empty list state.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);

  const { data: seasonRow } = seasonId
    ? await supabase
        .from("leagues")
        .select("id, name, sport")
        .eq("id", seasonId)
        .maybeSingle()
    : { data: null };
  const season =
    (seasonRow as { id: string; name: string; sport: string | null } | null) ??
    null;
  const activeSeasons = season ? [{ id: season.id, name: season.name }] : [];

  // Row-cell slot labels must match what the assign path writes to
  // game_umpires.role: the season's official_roles names (by sort_order),
  // padded sport-aware via padRoleLabels — NOT divisions.umpire_roles. The two
  // diverging is what made assigned slots keep reading "Open". official_roles
  // is season-scoped and every game here shares this season's league_id.
  const { data: roleRows } = seasonId
    ? await supabase
        .from("official_roles")
        .select("name")
        .eq("season_id", seasonId)
        .order("sort_order")
    : { data: [] as { name: string }[] };
  const seasonRoleNames = ((roleRows ?? []) as { name: string }[]).map(
    (r) => r.name,
  );

  // league_id rides along for the Add Game modal (games.league_id is NOT
  // NULL and derives from the chosen division).
  //
  // `game_duration:settings->game_duration` is a PROJECTED jsonb key, not the
  // whole `settings` blob: settings also carries the division's full teams[]
  // array with coach metadata, and nothing on this page needs it. It rides this
  // request rather than taking one of its own, and it must NEVER become a
  // `division:divisions(settings)` embed on the games query below — that ships
  // the blob once per game row (+479,118 bytes on SRALL Fall 2026's 272-game
  // response, against 338 bytes here). See division-durations.ts.
  //
  // COUPLING, STATED: narrowing this select would take game durations with it.
  // That is acceptable because it cannot fail quietly — the division filter
  // dropdown and the durations both come from THIS read, so a failure or a
  // narrowing shows up as a missing filter AND missing end times, not as a
  // plausible-looking grid.
  const { data: divisionData } = seasonId
    ? await supabase
        .from("divisions")
        .select("id, name, league_id, game_duration:settings->game_duration")
        .eq("league_id", seasonId)
        .order("name")
    : { data: [] as unknown[] };
  const divisionRows = (divisionData ?? []) as unknown as {
    id: string;
    name: string;
    league_id: string;
    game_duration?: unknown;
  }[];
  // Narrowed back down for the two client components that take this list, so
  // their serialized props stay exactly what they were before.
  const divisions = divisionRows.map(({ id, name, league_id }) => ({
    id,
    name,
    league_id,
  }));
  // division id -> minutes, omitting any division without a usable duration.
  // UNDEFINED MEANS UNRESOLVED, NEVER ZERO — see division-durations.ts.
  const gameDurationByDivisionId = gameDurationsFromDivisionRows(divisionRows);

  const { data: teamData } = seasonId
    ? await supabase
        .from("teams")
        .select("id, name, division_id")
        .eq("league_id", seasonId)
        .order("name")
    : { data: [] as { id: string; name: string; division_id: string | null }[] };
  const teams = (teamData ?? []) as {
    id: string;
    name: string;
    division_id: string | null;
  }[];

  // Venue filter options. `venues` is org-scoped (no league_id), so an
  // owner-scoped fetch would list venues with no games this season (dead
  // options). Instead derive the option set from venues that actually appear
  // in THIS season's games — deduped, season-stable, and independent of the
  // active division/team/past filters (matching how divisions/teams options
  // don't shrink as other filters narrow). Interleague away games carry a
  // null venue_id and are excluded here by design.
  const { data: venueData } = seasonId
    ? await supabase
        .from("games")
        .select("venue_id, venue:venues(name, location:locations(name))")
        .eq("league_id", seasonId)
        .not("venue_id", "is", null)
    : { data: [] as { venue_id: string; venue: { name: string; location: { name: string } | null } | null }[] };
  const venues = (() => {
    const rows = (venueData ?? []) as unknown as {
      venue_id: string;
      venue: { name: string; location: { name: string } | null } | null;
    }[];
    const byId = new Map<string, { name: string; location: { name: string } | null }>();
    for (const r of rows) {
      if (r.venue_id && r.venue?.name && !byId.has(r.venue_id)) {
        byId.set(r.venue_id, { name: r.venue.name, location: r.venue.location ?? null });
      }
    }
    // Sort by the qualified label so a park's fields cluster in the dropdown
    // (order-only; the filter value is the venue id and is unaffected).
    return Array.from(byId, ([id, v]) => ({ id, name: v.name, location: v.location })).sort(
      byQualifiedVenueLabel,
    );
  })();

  const effectiveTeamId = (() => {
    if (!selectedTeamId) return "";
    const team = teams.find((t) => t.id === selectedTeamId);
    if (!team) return "";
    if (selectedDivisionId && team.division_id !== selectedDivisionId) return "";
    return selectedTeamId;
  })();

  const today = todayLocalDateString();
  const todayIso = `${today}T00:00:00`;
  const gridRange = mode === "calendar" ? buildGridRange(month) : null;
  // Week mode narrows the SAME shared query to seven days, exactly as calendar
  // mode narrows it to its 42-day grid. Null until `?week=` resolves, in which
  // case the query is simply not narrowed for that one render — the same
  // season-wide read list mode does every load — and the grid filters to the
  // week itself once it knows which one.
  const weekBounds = weekStart ? weekRange(weekStart) : null;

  // ── Games ────────────────────────────────────────────────────────────────────
  let games: ScheduleGame[] = [];
  let gamesError: string | null = null;

  let teamIdScope: string[] | null = null;
  if (effectiveTeamId) {
    teamIdScope = [effectiveTeamId];
  } else if (selectedDivisionId) {
    teamIdScope = teams
      .filter((t) => t.division_id === selectedDivisionId)
      .map((t) => t.id);
  }

  if (seasonId) {
    // COMPLETE-OR-THROW. This array feeds three things: the on-screen list, the
    // calendar, and SchedulePrintRegion — which prints its LENGTH as the game
    // count on a document leagues hand to boards and parents. A capped read here
    // does not merely hide rows, it puts a confidently wrong total in a header.
    // That is what a hardcoded `.limit(200)` did: a 260-game season printed
    // "200 games" and stopped two weeks early, mid-day, with no signal anywhere.
    //
    // Deliberately NO `.limit()`. Do not add one back — not 200, and not 1000
    // either, since 1000 is PostgREST's own silent cap and a real limit at that
    // value is indistinguishable from being truncated by the server.
    try {
      games = await fetchAllRows<ScheduleGame>(
        "the season schedule",
        ({ from, to, exactCount }) => {
          let q = supabase
            .from("games")
            .select(
              `
        id, scheduled_at, status, league_id, home_team_id, away_team_id,
        interleague_org_id, is_away, external_team_name, proposed_venue_name,
        venue_id,
        home_team:teams!home_team_id(name, division_id, division:divisions(name, umpires_per_game)),
        away_team:teams!away_team_id(name),
        interleague_org:interleague_orgs(name),
        venue:venues(name, location:locations(name)),
        game_umpires:game_umpires(id, role, umpire:umpires(id, name))
      `,
              exactCount ? { count: "exact" } : undefined,
            )
            // Season scope is non-optional — it also carries the org scope, since
            // the season id was validated against the current org's active seasons.
            .eq("league_id", seasonId)
            .order("scheduled_at", { ascending: true })
            // Unique tiebreak — LOAD-BEARING, for two independent reasons.
            // (1) Range paging over a non-unique sort key can drop or duplicate
            //     rows at page boundaries, because tied rows have no guaranteed
            //     relative order across two separate queries.
            // (2) Determinism in the output itself. Games routinely share an
            //     exact start time (SRALL Fall 2026 has three at 2026-10-03
            //     12:45), so without a tiebreak the order within a timestamp —
            //     and, when the old cap sliced through one, WHICH game survived
            //     into the PDF — varied between prints of identical data.
            .order("id", { ascending: true });

          if (teamIdScope !== null) {
            if (teamIdScope.length === 0) {
              q = q.in("home_team_id", [
                "00000000-0000-0000-0000-000000000000",
              ]);
            } else if (effectiveTeamId) {
              q = q.or(
                `home_team_id.eq.${effectiveTeamId},away_team_id.eq.${effectiveTeamId}`,
              );
            } else {
              q = q.in("home_team_id", teamIdScope);
            }
          }

          // Venue filter composes as AND with the division/team scope above.
          // Interleague away games (venue_id null) fall out under a specific
          // venue by design — they're only reachable under "All venues".
          if (selectedVenueId) {
            q = q.eq("venue_id", selectedVenueId);
          }

          if (gridRange) {
            q = q
              .gte("scheduled_at", `${gridRange.gridStart}T00:00:00`)
              .lt("scheduled_at", `${gridRange.dayAfterGridEnd}T00:00:00`);
          }
          if (weekBounds) {
            q = q
              .gte("scheduled_at", `${weekBounds.startDate}T00:00:00`)
              .lt("scheduled_at", `${weekBounds.dayAfterEnd}T00:00:00`);
          }
          // hidePast DOES NOT APPLY IN WEEK MODE. The grid always shows a whole
          // Monday-to-Sunday week; clipping the first three days of the current
          // week would leave a grid whose empty columns mean "already played",
          // which is indistinguishable from "nothing scheduled" — the exact
          // misread the practices footnote exists to prevent. The toggle is
          // hidden in week mode too, so nothing offers a control that no-ops.
          if (hidePast && mode !== "week") {
            q = q.gte("scheduled_at", todayIso);
          }

          return q.range(from, to) as unknown as PromiseLike<
            PagedResult<ScheduleGame>
          >;
        },
      );
    } catch (err) {
      // Surface it. The previous code discarded the error entirely, so a failed
      // read rendered as "No games found." — indistinguishable from an empty
      // season, and it printed as a blank schedule.
      gamesError =
        err instanceof Error ? err.message : "Could not load the season schedule.";
      games = [];
    }

    // ── Per-game duration (week-by-field view mode) ───────────────────────────
    // Attach each game's own division duration, resolved from the divisions
    // read above — no extra round trip. Absent (not 0, not a default) whenever
    // it cannot be resolved: unusable division setting, or a home team with no
    // division. Existing renderers never read this field, so adding it changes
    // nothing on screen. See ScheduleGame.durationMin before consuming it.
    games = games.map((g) => {
      const divisionId = g.home_team?.division_id;
      const minutes = divisionId
        ? gameDurationByDivisionId.get(divisionId)
        : undefined;
      return minutes === undefined ? g : { ...g, durationMin: minutes };
    });
  }

  // ── Week-by-field row set ────────────────────────────────────────────────────
  // Venues flagged `division_venues.allow_games` for a division in THIS season.
  // The grid unions this with any venue carrying a game in the displayed week
  // (done client-side off the game rows, so it cannot disagree with the cells).
  // An eligible field with no games still gets a row — a field sitting unused is
  // the capacity signal this view exists to give.
  //
  // NOT SHARED WITH the Reports venues x divisions matrix, deliberately: that
  // one is season-wide, division-keyed and filters through
  // `countsAsScheduledGame`; this one is week-scoped, field-keyed and counts
  // every status. See buildWeekRows and CLAUDE.md.
  //
  // Only fetched in week mode, so list and calendar loads are unchanged.
  //
  // fetchAllRows for the usual reason — a silently dropped row here removes a
  // field from a capacity view. It deviates from that helper's literal "end the
  // order chain with `id`" only because `division_venues` HAS no id column: its
  // primary key is (division_id, venue_id), so ordering on both is the required
  // total order. Live size is 12 rows for SRALL Fall 2026 and 65 across every
  // season ever, against PostgREST's 1000-row cap.
  let weekVenues: WeekVenueInput[] = [];
  let weekVenuesError: string | null = null;
  if (mode === "week" && seasonId) {
    type DivisionVenueRow = {
      venue_id: string;
      venue: { name: string; location: { name: string } | null } | null;
    };
    try {
      const rows = await fetchAllRows<DivisionVenueRow>(
        "the season's game-eligible fields",
        ({ from, to, exactCount }) =>
          supabase
            .from("division_venues")
            .select(
              "venue_id, division:divisions!inner(league_id), venue:venues(name, location:locations(name))",
              exactCount ? { count: "exact" } : undefined,
            )
            .eq("division.league_id", seasonId)
            .eq("allow_games", true)
            .order("venue_id", { ascending: true })
            .order("division_id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<
            PagedResult<DivisionVenueRow>
          >,
      );
      // A venue is eligible via ANY of its divisions; dedupe to one row each.
      const byId = new Map<string, WeekVenueInput>();
      for (const r of rows) {
        if (!r.venue_id || !r.venue?.name || byId.has(r.venue_id)) continue;
        byId.set(r.venue_id, {
          venueId: r.venue_id,
          name: r.venue.name,
          locationName: r.venue.location?.name ?? null,
        });
      }
      weekVenues = [...byId.values()];
    } catch (err) {
      // Surface it rather than rendering a grid missing its empty rows: the
      // union arm would still show every field that HAS a game, so a silent
      // failure looks like a complete grid with the unused fields gone — the
      // one signal this view adds over list mode.
      weekVenuesError =
        err instanceof Error
          ? err.message
          : "Could not load the season's game-eligible fields.";
    }
  }

  // A `?venue=` filter already narrows the games to one field, so leaving every
  // other eligible field on screen as an empty row would misread as "these
  // fields are free this week". The `?division=` filter deliberately does NOT
  // narrow rows — a division's games are only part of what occupies a field —
  // and the grid says so in a footnote instead.
  if (selectedVenueId) {
    weekVenues = weekVenues.filter((v) => v.venueId === selectedVenueId);
  }

  // Empty-state /setup link gate (Chunk 4): own-org owner mid-setup AND the
  // season GENUINELY has zero games. "No games found." also renders under
  // narrowing filters (division/team/hide-past/calendar range), and the list
  // component can't see filter state — so the gate goes by the unfiltered
  // season-wide count: zero there means every filtered view is empty too,
  // so the link can never appear while filters are merely hiding games.
  let showSetupLink = false;
  if (
    currentOrgId === user!.id &&
    (await isSetupIncomplete(supabase, currentOrgId, seasonId))
  ) {
    if (seasonId) {
      const { count: totalGames } = await supabase
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("league_id", seasonId);
      showSetupLink = (totalGames ?? 0) === 0;
    } else {
      // No active season — trivially zero games.
      showSetupLink = true;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
          <p className="mt-1 text-sm text-gray-500">
            {season ? `Games in ${season.name}.` : "No active season."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle mode={mode} />
          <SchedulePrintButton />
          <AddGameButton
            seasons={activeSeasons}
            divisions={divisions}
            teams={teams.filter(
              (t): t is { id: string; name: string; division_id: string } =>
                !!t.division_id,
            )}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* Week mode shows a whole week by definition, so the control would
            do nothing — see the query above. */}
        {mode !== "week" && <HidePastToggle hidePast={hidePast} />}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>All Games</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {divisions.length > 0 && (
                <DivisionFilter
                  divisions={divisions}
                  selectedId={selectedDivisionId}
                />
              )}
              {teams.length > 0 && (
                <TeamFilter
                  teams={teams}
                  selectedId={effectiveTeamId}
                  selectedDivisionId={selectedDivisionId}
                />
              )}
              {venues.length > 0 && (
                <VenueFilter venues={venues} selectedId={selectedVenueId} />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {gamesError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">Couldn&apos;t load the schedule.</p>
              <p className="mt-1">{gamesError}</p>
              <p className="mt-2 text-red-600">
                Nothing is shown rather than a partial list, so a printed
                schedule can&apos;t be missing games without saying so. Reload to
                try again.
              </p>
            </div>
          ) : mode === "week" ? (
            weekVenuesError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-medium">Couldn&apos;t load the fields.</p>
                <p className="mt-1">{weekVenuesError}</p>
                <p className="mt-2 text-red-600">
                  The grid is hidden rather than shown without its unused
                  fields, which would read as a complete week. Reload to try
                  again.
                </p>
              </div>
            ) : (
              <ScheduleWeekGrid
                games={games}
                weekStart={weekStart}
                eligibleVenues={weekVenues}
                divisionFilterName={
                  selectedDivisionId
                    ? (divisions.find((d) => d.id === selectedDivisionId)?.name ??
                      null)
                    : null
                }
                /* EVERY division in the season, deliberately not narrowed by
                   the ?division= filter or by what appears this week: the
                   colour assignment must be identical on every week and under
                   every filter, or a division's stripe would change as the
                   admin pages around. */
                seasonDivisionIds={divisions.map((d) => d.id)}
              />
            )
          ) : mode === "calendar" ? (
            <ScheduleCalendar
              games={games}
              month={month}
              today={today}
              canReschedule={isProPlus(plan)}
            />
          ) : (
            <ScheduleList
              games={games}
              canReschedule={isProPlus(plan)}
              seasonRoleNames={seasonRoleNames}
              sport={season?.sport ?? null}
              showSetupLink={showSetupLink}
            />
          )}
        </CardContent>
      </Card>

      {/* Print-only region — hidden on screen, revealed by the global
          @media print rules. Renders in both list and calendar modes since a
          printed calendar grid isn't useful.

          Suppressed on a read error: the region prints its own row count as a
          header, so rendering it from a failed (therefore empty or partial)
          fetch would produce a confident, wrong document. Better to print
          nothing than to print "0 games" for a full season. */}
      {!gamesError && (
        <SchedulePrintRegion games={games} seasonName={season?.name ?? null} />
      )}
    </div>
  );
}
