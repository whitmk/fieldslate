import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { DivisionFilter } from "@/components/schedule/division-filter";
import { TeamFilter } from "@/components/schedule/team-filter";
import { HidePastToggle } from "@/components/schedule/hide-past-toggle";
import { ViewToggle, type ScheduleView } from "@/components/schedule/view-toggle";
import {
  ScheduleList,
  type ScheduleGame,
  type SchedulePractice,
} from "@/components/schedule/schedule-list";

function parseView(raw: string | undefined): ScheduleView {
  if (raw === "practices" || raw === "combined") return raw;
  return "games";
}

function todayLocalDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: {
    division?: string;
    team?: string;
    view?: string;
    past?: string;
  };
}) {
  const supabase = createClient();
  const selectedDivisionId = searchParams.division ?? "";
  const selectedTeamId = searchParams.team ?? "";
  const view = parseView(searchParams.view);
  // Default ON; the URL only carries `past=1` when the user has switched it OFF.
  const hidePast = searchParams.past !== "1";

  // Divisions for the dropdown
  const { data: divisionData } = await supabase
    .from("divisions")
    .select("id, name")
    .order("name");
  const divisions = (divisionData ?? []) as { id: string; name: string }[];

  // All teams (with division_id so the team filter can scope by division)
  const { data: teamData } = await supabase
    .from("teams")
    .select("id, name, division_id")
    .order("name");
  const teams = (teamData ?? []) as {
    id: string;
    name: string;
    division_id: string | null;
  }[];

  // If a team is selected that doesn't belong to the selected division, ignore it.
  const effectiveTeamId = (() => {
    if (!selectedTeamId) return "";
    const team = teams.find((t) => t.id === selectedTeamId);
    if (!team) return "";
    if (selectedDivisionId && team.division_id !== selectedDivisionId) return "";
    return selectedTeamId;
  })();

  const today = todayLocalDateString();
  const todayIso = `${today}T00:00:00`;

  // ── Games ────────────────────────────────────────────────────────────────────
  let games: ScheduleGame[] = [];

  const needGames = view === "games" || view === "combined";
  if (needGames) {
    // Determine which team IDs the games query should be scoped to.
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
        home_team:teams!home_team_id(name, division_id, division:divisions(name)),
        away_team:teams!away_team_id(name),
        venue:venues(name)
      `)
      .order("scheduled_at", { ascending: true })
      .limit(200);

    if (teamIdScope !== null) {
      if (teamIdScope.length === 0) {
        gamesQuery = gamesQuery.in("home_team_id", [
          "00000000-0000-0000-0000-000000000000",
        ]);
      } else if (effectiveTeamId) {
        // Match games where the team is on either side of the matchup.
        gamesQuery = gamesQuery.or(
          `home_team_id.eq.${effectiveTeamId},away_team_id.eq.${effectiveTeamId}`,
        );
      } else {
        gamesQuery = gamesQuery.in("home_team_id", teamIdScope);
      }
    }

    if (hidePast) {
      gamesQuery = gamesQuery.gte("scheduled_at", todayIso);
    }

    const { data: rawGames } = await gamesQuery;
    games = (rawGames as unknown as ScheduleGame[] | null) ?? [];
  }

  // ── Practices ────────────────────────────────────────────────────────────────
  let practices: SchedulePractice[] = [];

  const needPractices = view === "practices" || view === "combined";
  if (needPractices) {
    let practicesQuery = supabase
      .from("practices")
      .select(`
        id, scheduled_date, start_time, status, league_id, division_id, team_id,
        team:teams(name),
        division:divisions(name),
        venue:venues(name)
      `)
      .neq("status", "unscheduled")
      .order("scheduled_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(200);

    if (selectedDivisionId) {
      practicesQuery = practicesQuery.eq("division_id", selectedDivisionId);
    }
    if (effectiveTeamId) {
      practicesQuery = practicesQuery.eq("team_id", effectiveTeamId);
    }
    if (hidePast) {
      practicesQuery = practicesQuery.gte("scheduled_date", today);
    }

    const { data: rawPractices } = await practicesQuery;
    practices =
      (rawPractices as unknown as SchedulePractice[] | null) ?? [];
  }

  const cardTitle =
    view === "games"
      ? "All Games"
      : view === "practices"
      ? "All Practices"
      : "All Games & Practices";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
          <p className="mt-1 text-sm text-gray-500">All games across your leagues.</p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add game
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewToggle view={view} />
        <HidePastToggle hidePast={hidePast} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{cardTitle}</CardTitle>
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
          <ScheduleList view={view} games={games} practices={practices} />
        </CardContent>
      </Card>
    </div>
  );
}
