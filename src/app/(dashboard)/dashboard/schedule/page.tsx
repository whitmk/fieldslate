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
import { SchedulePrintButton } from "@/components/schedule/schedule-print-button";
import { SchedulePrintRegion } from "@/components/schedule/schedule-print-region";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isProPlus } from "@/lib/plan/limits";
import { isSetupIncomplete } from "@/lib/setup/derive-step";

function parseMode(raw: string | undefined): ViewMode {
  return raw === "calendar" ? "calendar" : "list";
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
  const { data: divisionData } = seasonId
    ? await supabase
        .from("divisions")
        .select("id, name, league_id")
        .eq("league_id", seasonId)
        .order("name")
    : { data: [] as { id: string; name: string; league_id: string }[] };
  const divisions = (divisionData ?? []) as {
    id: string;
    name: string;
    league_id: string;
  }[];

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
        .select("venue_id, venue:venues(name)")
        .eq("league_id", seasonId)
        .not("venue_id", "is", null)
    : { data: [] as { venue_id: string; venue: { name: string } | null }[] };
  const venues = (() => {
    const rows = (venueData ?? []) as unknown as {
      venue_id: string;
      venue: { name: string } | null;
    }[];
    const byId = new Map<string, string>();
    for (const r of rows) {
      if (r.venue_id && r.venue?.name && !byId.has(r.venue_id)) {
        byId.set(r.venue_id, r.venue.name);
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
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

  // ── Games ────────────────────────────────────────────────────────────────────
  let games: ScheduleGame[] = [];

  let teamIdScope: string[] | null = null;
  if (effectiveTeamId) {
    teamIdScope = [effectiveTeamId];
  } else if (selectedDivisionId) {
    teamIdScope = teams
      .filter((t) => t.division_id === selectedDivisionId)
      .map((t) => t.id);
  }

  if (seasonId) {
    let gamesQuery = supabase
      .from("games")
      .select(`
        id, scheduled_at, status, league_id, home_team_id, away_team_id,
        interleague_org_id, is_away, external_team_name, proposed_venue_name,
        home_team:teams!home_team_id(name, division_id, division:divisions(name, umpires_per_game)),
        away_team:teams!away_team_id(name),
        interleague_org:interleague_orgs(name),
        venue:venues(name),
        game_umpires:game_umpires(id, role, umpire:umpires(id, name))
      `)
      // Season scope is non-optional — it also carries the org scope, since
      // the season id was validated against the current org's active seasons.
      .eq("league_id", seasonId)
      .order("scheduled_at", { ascending: true })
      .limit(mode === "calendar" ? 1000 : 200);

    if (teamIdScope !== null) {
      if (teamIdScope.length === 0) {
        gamesQuery = gamesQuery.in("home_team_id", [
          "00000000-0000-0000-0000-000000000000",
        ]);
      } else if (effectiveTeamId) {
        gamesQuery = gamesQuery.or(
          `home_team_id.eq.${effectiveTeamId},away_team_id.eq.${effectiveTeamId}`,
        );
      } else {
        gamesQuery = gamesQuery.in("home_team_id", teamIdScope);
      }
    }

    // Venue filter composes as AND with the division/team scope above.
    // Interleague away games (venue_id null) fall out under a specific venue
    // by design — they're only reachable under "All venues".
    if (selectedVenueId) {
      gamesQuery = gamesQuery.eq("venue_id", selectedVenueId);
    }

    if (gridRange) {
      gamesQuery = gamesQuery
        .gte("scheduled_at", `${gridRange.gridStart}T00:00:00`)
        .lt("scheduled_at", `${gridRange.dayAfterGridEnd}T00:00:00`);
    }
    if (hidePast) {
      gamesQuery = gamesQuery.gte("scheduled_at", todayIso);
    }

    const { data: rawGames } = await gamesQuery;
    games = (rawGames as unknown as ScheduleGame[] | null) ?? [];
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
        <HidePastToggle hidePast={hidePast} />
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
          {mode === "calendar" ? (
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
          printed calendar grid isn't useful. */}
      <SchedulePrintRegion games={games} seasonName={season?.name ?? null} />
    </div>
  );
}
