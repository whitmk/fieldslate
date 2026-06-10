import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddGameButton } from "@/components/schedule/add-game-modal";
import { DivisionFilter } from "@/components/schedule/division-filter";
import { TeamFilter } from "@/components/schedule/team-filter";
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
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isProPlus } from "@/lib/plan/limits";

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
  const mode = parseMode(searchParams.mode);
  const month = parseMonth(searchParams.month);
  // Default ON; the URL only carries `past=1` when the user has switched it OFF.
  const hidePast = searchParams.past !== "1";

  // League ids for THIS org. RLS would already let a multi-org admin see
  // rows from every org they belong to; this narrows the dropdowns and the
  // games list to just the selected org. name/archived_at ride along for the
  // Add Game modal's Season picker — the games list itself still spans all
  // seasons, archived included.
  const { data: orgLeagueData } = await supabase
    .from("leagues")
    .select("id, name, archived_at")
    .eq("owner_id", currentOrgId)
    .order("name");
  const orgLeagues = (orgLeagueData ?? []) as {
    id: string;
    name: string;
    archived_at: string | null;
  }[];
  const orgLeagueIds = orgLeagues.map((l) => l.id);
  // Active seasons only — new games shouldn't be written into archived seasons.
  const activeSeasons = orgLeagues
    .filter((l) => !l.archived_at)
    .map((l) => ({ id: l.id, name: l.name }));

  // league_id rides along for the Add Game modal (games.league_id is NOT
  // NULL and derives from the chosen division).
  const { data: divisionData } = orgLeagueIds.length
    ? await supabase
        .from("divisions")
        .select("id, name, league_id")
        .in("league_id", orgLeagueIds)
        .order("name")
    : { data: [] as { id: string; name: string; league_id: string }[] };
  const divisions = (divisionData ?? []) as {
    id: string;
    name: string;
    league_id: string;
  }[];

  const { data: teamData } = orgLeagueIds.length
    ? await supabase
        .from("teams")
        .select("id, name, division_id")
        .in("league_id", orgLeagueIds)
        .order("name")
    : { data: [] as { id: string; name: string; division_id: string | null }[] };
  const teams = (teamData ?? []) as {
    id: string;
    name: string;
    division_id: string | null;
  }[];

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

  let gamesQuery = supabase
    .from("games")
    .select(`
      id, scheduled_at, status, league_id, home_team_id, away_team_id,
      interleague_org_id, is_away, external_team_name, proposed_venue_name,
      home_team:teams!home_team_id(name, division_id, division:divisions(name, umpires_per_game, umpire_roles)),
      away_team:teams!away_team_id(name),
      interleague_org:interleague_orgs(name),
      venue:venues(name),
      game_umpires:game_umpires(id, role, umpire:umpires(id, name))
    `)
    // Org scope is non-optional — without it a multi-org admin viewing the
    // page with no team/division filter would see games merged from every
    // org they belong to.
    .in("league_id", orgLeagueIds.length ? orgLeagueIds : [
      "00000000-0000-0000-0000-000000000000",
    ])
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
          <p className="mt-1 text-sm text-gray-500">All games across your seasons.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle mode={mode} />
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
            <ScheduleList games={games} canReschedule={isProPlus(plan)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
