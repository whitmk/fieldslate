export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft, Users, CalendarDays, Layers, AlertTriangle, UserCheck } from "lucide-react";
import type { League } from "@/types/database";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { PLAN_LIMITS, isProPlus, isElite } from "@/lib/plan/limits";
import { getDivisionCount, getTeamCountForOrg } from "@/lib/plan/counts";
import {
  getOfficialTitle,
  getOfficialTitlePluralLower,
} from "@/lib/utils/official-title";
import { EditableLeagueHeader } from "@/components/dashboard/editable-league-header";
import { LeagueContent } from "@/components/dashboard/league-content";
import { BlackoutDatesPanel } from "@/components/blackout/blackout-dates-panel";
import { ActivityLogPanel } from "@/components/dashboard/activity-log-panel";
import { ArchivedSeasonBanner } from "@/components/seasons/archived-season-banner";
import { detectConflicts, venueGamesConflict } from "@/lib/schedule/detect-conflicts";
import { RainedOutStatCard, type RainedOutGame } from "@/components/dashboard/rained-out-stat-card";
import { ConflictStatCard, type ConflictGame } from "@/components/dashboard/conflict-stat-card";
import type { BlackoutAffectedGame } from "@/components/blackout/blackout-dates-panel";

export type DivisionStat = {
  divisionId: string;
  gameCount: number;
  expectedGames: number;
  conflictCount: number;
  allTeamsAtMinimum: boolean;
};

export default async function LeaguePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  const { data: rawLeague } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", params.id)
    .eq("owner_id", currentOrgId)
    .single();

  if (!rawLeague) notFound();
  const league = rawLeague as League;

  type TeamRow = { id: string; division_id: string | null };
  type GameRow = {
    id: string; scheduled_at: string; venue_id: string | null; home_team_id: string; away_team_id: string;
    status: string;
    venue: { name: string } | null;
    home_team: { name: string; division_id: string | null } | null;
    away_team: { name: string } | null;
  };
  type DivVenueRow = { division_id: string; venue_id: string };
  type BlackoutRow = { date: string; label: string | null };

  // Fetch divisions first so we can scope the two queries that key off
  // division_id directly. Previously those two queries had no narrowing at
  // all — for a multi-org admin RLS would return rows from BOTH orgs'
  // divisions. The downstream maps key by division_id from THIS league's
  // divisions, so the bug was inert today; this hardens it against any
  // future code that iterates the raw lists.
  const { data: allDivisionsRaw } = await supabase
    .from("divisions")
    .select("*")
    .eq("league_id", league.id)
    .order("created_at", { ascending: true });
  const allDivisions = (allDivisionsRaw ?? []) as import("@/types/database").Division[];
  const divisionIds = allDivisions.map((d) => d.id);

  const [
    { data: allTeamsRaw },
    { data: allGamesRaw },
    { data: allDivVenuesRaw },
    { data: blackoutDatesRaw },
    { data: allInterleagueGamesRaw },
  ] = await Promise.all([
    supabase.from("teams").select("id, division_id").eq("league_id", league.id),
    supabase
      .from("games")
      .select(`id, scheduled_at, venue_id, home_team_id, away_team_id, status,
               venue:venues(name),
               home_team:teams!home_team_id(name, division_id),
               away_team:teams!away_team_id(name)`)
      .eq("league_id", league.id),
    divisionIds.length
      ? supabase
          .from("division_venues")
          .select("division_id, venue_id")
          .in("division_id", divisionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from("blackout_dates").select("date, label").eq("league_id", league.id),
    divisionIds.length
      ? supabase
          .from("division_interleague_games")
          .select("division_id, game_count")
          .in("division_id", divisionIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const allTeams = (allTeamsRaw ?? []) as TeamRow[];
  const allGames = (allGamesRaw ?? []) as unknown as GameRow[];
  const allDivVenues = (allDivVenuesRaw ?? []) as unknown as DivVenueRow[];
  const blackoutDates = (blackoutDatesRaw ?? []) as BlackoutRow[];

  // Build division → venue-id set
  const divToVenues = new Map<string, Set<string>>();
  for (const dv of allDivVenues) {
    if (!divToVenues.has(dv.division_id)) divToVenues.set(dv.division_id, new Set());
    divToVenues.get(dv.division_id)!.add(dv.venue_id);
  }

  // Build division → total interleague games per team (sum across orgs)
  const interleagueGamesByDivision = new Map<string, number>();
  for (const ig of (allInterleagueGamesRaw ?? []) as { division_id: string; game_count: number }[]) {
    interleagueGamesByDivision.set(
      ig.division_id,
      (interleagueGamesByDivision.get(ig.division_id) ?? 0) + Number(ig.game_count ?? 0),
    );
  }

  // Blackout date → label map (active games only)
  const blackoutMap = new Map<string, string | null>();
  for (const b of blackoutDates) blackoutMap.set(b.date, b.label);

  // Per-game duration/buffer from the game's OWN home-team division. Both venue
  // conflict passes below (badge membership and the "Conflicts with" peer list)
  // read these, so a Majors game is 120 minutes long even when a Minors pass is
  // doing the comparing. `allDivisions` already carries every division's
  // settings, so no query had to widen for this.
  //
  // Fallbacks are the SHARED defaults, not 0: a 0-length span can never overlap
  // anything, so a division with unset settings would silently report zero
  // conflicts forever. (The panel badge and resolver still use `?? 0` on the
  // legacy scalar path — a separate known bug, reported not fixed here.)
  const DEFAULT_DURATION_MIN = 90;
  const durationByDivisionId = new Map<string, number>();
  const bufferByDivisionId = new Map<string, number>();
  for (const div of allDivisions) {
    const ds = (div.settings ?? {}) as { game_duration?: number; buffer_minutes?: number };
    const dur = Number(ds.game_duration);
    durationByDivisionId.set(div.id, Number.isFinite(dur) && dur > 0 ? dur : DEFAULT_DURATION_MIN);
    bufferByDivisionId.set(div.id, Number(ds.buffer_minutes) || 0);
  }
  function durationFor(g: GameRow): number {
    const divId = g.home_team?.division_id;
    return (divId ? durationByDivisionId.get(divId) : undefined) ?? DEFAULT_DURATION_MIN;
  }
  function bufferFor(g: GameRow): number {
    const divId = g.home_team?.division_id;
    return (divId ? bufferByDivisionId.get(divId) : undefined) ?? 0;
  }

  // Per-division stats
  const allConflictingGameIds = new Set<string>();

  const divisionStats: DivisionStat[] = allDivisions.map((div) => {
    const s = (div.settings ?? {}) as {
      games_per_team?: number;
      game_duration?: number;
      buffer_minutes?: number;
    };
    const intraGamesPerTeam = Number(div.intra_division_games_per_team ?? s.games_per_team ?? 0);
    const interleagueGamesPerTeam = interleagueGamesByDivision.get(div.id) ?? 0;
    const totalGamesPerTeam = intraGamesPerTeam + interleagueGamesPerTeam;
    const gameDuration = Number(s.game_duration ?? 0);
    const bufferMins = Number(s.buffer_minutes ?? 0);
    // Intra games involve 2 teams from this division (÷2); interleague involves 1 (×T)
    const expectedGames =
      Math.round((intraGamesPerTeam * div.team_count) / 2)
      + interleagueGamesPerTeam * div.team_count;

    const divTeamArr = allTeams.filter((t) => t.division_id === div.id).map((t) => t.id);
    const divTeamIds = new Set(divTeamArr);
    const divGames = allGames.filter((g) => divTeamIds.has(g.home_team_id));

    // Total games per team — counts each appearance once. away_team_id may be null
    // (interleague), in which case only the home side is incremented.
    const teamGameCount: Record<string, number> = {};
    divTeamArr.forEach((id) => { teamGameCount[id] = 0; });
    for (const g of divGames) {
      teamGameCount[g.home_team_id] = (teamGameCount[g.home_team_id] ?? 0) + 1;
      if (g.away_team_id && divTeamIds.has(g.away_team_id)) {
        teamGameCount[g.away_team_id] = (teamGameCount[g.away_team_id] ?? 0) + 1;
      }
    }
    const allTeamsAtMinimum =
      divTeamArr.length > 0 &&
      totalGamesPerTeam > 0 &&
      divTeamArr.every((id) => (teamGameCount[id] ?? 0) >= totalGamesPerTeam);

    const divVenueIds = divToVenues.get(div.id) ?? new Set<string>();
    const venueGames = allGames.filter((g) => g.venue_id !== null && divVenueIds.has(g.venue_id!));

    const conflicts = detectConflicts(
      venueGames.map((g) => ({
        id: g.id,
        scheduled_at: g.scheduled_at,
        venue_id: g.venue_id,
        venue_name: g.venue?.name ?? "Unknown venue",
        home_team_name: g.home_team?.name ?? "TBD",
        away_team_name: g.away_team?.name ?? "TBD",
        // Each game's OWN division numbers — this pass spans divisions, so the
        // pass's own scalars must not be applied to another division's games.
        durationMin: durationFor(g),
        bufferMin: bufferFor(g),
      })),
      gameDuration,
      bufferMins,
      // durationFor/bufferFor are TOTAL — every game above gets a finite,
      // positive duration. Assert that rather than let a broken invariant
      // silently revert this call to start-distance, which would restore all
      // the known false positives with no error at all.
      { strictPerGameDurations: true },
    );

    const conflictingAtVenues = new Set(conflicts.flatMap((c) => c.gameIds));
    const divConflictCount = divGames.filter((g) => conflictingAtVenues.has(g.id)).length;
    divGames.filter((g) => conflictingAtVenues.has(g.id)).forEach((g) => allConflictingGameIds.add(g.id));

    return {
      divisionId: div.id,
      gameCount: divGames.length,
      expectedGames,
      conflictCount: divConflictCount,
      allTeamsAtMinimum,
    };
  });

  // Blackout conflicts — active (non-cancelled) games that land on a blackout date
  const allBlackoutGameIds = new Set<string>();
  for (const g of allGames) {
    if (g.status !== "cancelled" && blackoutMap.has(g.scheduled_at.substring(0, 10))) {
      allBlackoutGameIds.add(g.id);
    }
  }

  // Pairwise peer detection — powers the "Conflicts with" list under each
  // Double-booked badge. It now shares `venueGamesConflict` with the badge
  // membership pass above, so the two can no longer disagree about the same
  // pair. It previously used `Math.abs(minsA - minsB) < Math.max(gapFor(a),
  // gapFor(b))` — a start-distance rule found NOWHERE else in the codebase, and
  // `max()` is precisely the wrong answer: it reproduced all 8 live SRALL false
  // positives. See detect-conflicts.ts's header.
  //
  // NOTE the input sets still differ: this loop skips cancelled games and the
  // membership pass does not, so the two can still diverge on a cancelled row.
  // That inconsistency is pre-existing and reported, not fixed here.
  const peersByGameId = new Map<string, GameRow[]>();
  const venueDayBuckets = new Map<string, GameRow[]>();
  for (const g of allGames) {
    if (g.status === "cancelled" || !g.venue_id) continue;
    const key = `${g.venue_id}:${g.scheduled_at.substring(0, 10)}`;
    if (!venueDayBuckets.has(key)) venueDayBuckets.set(key, []);
    venueDayBuckets.get(key)!.push(g);
  }
  for (const group of Array.from(venueDayBuckets.values())) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (
          venueGamesConflict(
            { scheduled_at: a.scheduled_at, durationMin: durationFor(a), bufferMin: bufferFor(a) },
            { scheduled_at: b.scheduled_at, durationMin: durationFor(b), bufferMin: bufferFor(b) },
          )
        ) {
          if (!peersByGameId.has(a.id)) peersByGameId.set(a.id, []);
          if (!peersByGameId.has(b.id)) peersByGameId.set(b.id, []);
          peersByGameId.get(a.id)!.push(b);
          peersByGameId.get(b.id)!.push(a);
        }
      }
    }
  }

  // Build unified conflict list for ConflictStatCard (schedule conflicts take priority if both)
  const conflictGames: ConflictGame[] = [];
  for (const g of allGames) {
    if (g.status === "cancelled") continue;
    const isSchedule = allConflictingGameIds.has(g.id);
    const isBlackout = allBlackoutGameIds.has(g.id);
    if (!isSchedule && !isBlackout) continue;
    const peers = isSchedule
      ? (peersByGameId.get(g.id) ?? [])
          .slice()
          .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
          .map((p) => ({
            id: p.id,
            scheduled_at: p.scheduled_at,
            home_team_name: p.home_team?.name ?? "TBD",
            away_team_name: p.away_team?.name ?? "TBD",
            division_id: p.home_team?.division_id ?? null,
          }))
      : [];
    conflictGames.push({
      id: g.id,
      scheduled_at: g.scheduled_at,
      home_team_id: g.home_team_id,
      away_team_id: g.away_team_id,
      home_team: g.home_team,
      away_team: g.away_team,
      venue: g.venue,
      conflictType: isSchedule ? "schedule" : "blackout",
      blackoutLabel: isBlackout && !isSchedule
        ? (blackoutMap.get(g.scheduled_at.substring(0, 10)) ?? null)
        : null,
      conflictsWith: peers,
    });
  }

  // Affected games for BlackoutDatesPanel warning (synced after router.refresh())
  const blackoutAffectedGames: BlackoutAffectedGame[] = allGames
    .filter((g) => g.status !== "cancelled" && blackoutMap.has(g.scheduled_at.substring(0, 10)))
    .map((g) => ({
      id: g.id,
      scheduled_at: g.scheduled_at,
      home_team: g.home_team ? { name: g.home_team.name } : null,
      away_team: g.away_team ? { name: g.away_team.name } : null,
    }));

  const divisionCount = allDivisions.length;
  const teamCount = allTeams.length;
  const gameCount = allGames.filter((g) => g.status !== "cancelled").length;
  const rainedOutGames = allGames.filter((g) => g.status === "cancelled") as unknown as RainedOutGame[];
  const rainedOutCount = rainedOutGames.length;
  const scheduleConflictCount = allConflictingGameIds.size;

  // ── Umpire shortfall: active games whose division needs N umpires but has fewer than N assigned
  let umpireShortfallCount = 0;
  {
    const divUmpiresPerGame = new Map<string, number>();
    for (const d of allDivisions) {
      const n = Number((d as unknown as { umpires_per_game?: number }).umpires_per_game ?? 0);
      if (n > 0) divUmpiresPerGame.set(d.id, n);
    }

    if (divUmpiresPerGame.size > 0) {
      const gamesNeedingUmpires = allGames.filter((g) => {
        if (g.status === "cancelled") return false;
        const divId = g.home_team?.division_id;
        return !!divId && divUmpiresPerGame.has(divId);
      });

      if (gamesNeedingUmpires.length > 0) {
        const gameIds = gamesNeedingUmpires.map((g) => g.id);
        const { data: assignmentsRaw } = await supabase
          .from("game_umpires")
          .select("game_id")
          .in("game_id", gameIds);
        const assignedCount = new Map<string, number>();
        for (const row of (assignmentsRaw ?? []) as { game_id: string }[]) {
          assignedCount.set(row.game_id, (assignedCount.get(row.game_id) ?? 0) + 1);
        }
        for (const g of gamesNeedingUmpires) {
          const need = divUmpiresPerGame.get(g.home_team!.division_id!) ?? 0;
          const have = assignedCount.get(g.id) ?? 0;
          if (have < need) umpireShortfallCount++;
        }
      }
    }
  }

  const divisionNames: Record<string, string> = {};
  for (const d of allDivisions) divisionNames[d.id] = d.name;

  const sportColor: Record<string, string> = {
    Baseball: "bg-blue-50 text-blue-700",
    Softball: "bg-amber-50 text-amber-700",
    Soccer: "bg-emerald-50 text-emerald-700",
  };

  const officialTitle = getOfficialTitle(league.sport);
  const officialPluralLower = getOfficialTitlePluralLower(league.sport);

  // Plan + org-wide division/team counts, threaded into DivisionSection via
  // LeagueContent. divisionCount/Limit gates the "Add division" buttons on
  // this page (mirroring AddDivisionButton on /dashboard/divisions);
  // teamCount/Limit goes through into the wizard's upfront cap check.
  // Named `orgTeamCount` to avoid colliding with `teamCount` above, which is
  // scoped to THIS league only.
  const [plan, orgDivisionCount, orgTeamCount] = await Promise.all([
    getOrgPlan(currentOrgId),
    getDivisionCount(supabase, currentOrgId),
    getTeamCountForOrg(supabase, currentOrgId),
  ]);
  const divisionLimit = PLAN_LIMITS[plan].divisions;
  const teamLimit = PLAN_LIMITS[plan].teamsPerOrg;

  return (
    <div className="flex flex-col gap-6">

      {/* Back */}
      <Link
        href="/dashboard/leagues"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F]"
      >
        <ArrowLeft className="h-4 w-4" />
        All seasons
      </Link>

      {/* Season header */}
      <EditableLeagueHeader
        leagueId={league.id}
        initialName={league.name}
        sport={league.sport}
        season={league.season}
        status={league.status}
        archivedAt={league.archived_at}
        endDate={league.end_date}
        sportClassName={sportColor[league.sport] ?? "bg-gray-100 text-gray-600"}
        canRestore={isElite(plan)}
      />

      {/* Archived-season banner (only when archived_at is set) */}
      {league.archived_at && (
        <ArchivedSeasonBanner
          seasonId={league.id}
          seasonName={league.name}
          endDate={league.end_date}
          canRestore={isElite(plan)}
        />
      )}

      {/* Schedule-conflict alert banner (double-booked fields only) */}
      {scheduleConflictCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-semibold text-red-700">
              Schedule conflict — {scheduleConflictCount} game{scheduleConflictCount !== 1 ? "s" : ""} double-booked
            </p>
            <p className="mt-0.5 text-xs text-red-600">
              Two or more games are assigned to the same field at overlapping times. Click the Conflicts card to review and fix.
            </p>
          </div>
        </div>
      )}

      {/* Official shortfall alert */}
      {umpireShortfallCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
          <UserCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {officialTitle} shortfall — {umpireShortfallCount} game{umpireShortfallCount !== 1 ? "s" : ""} still need {officialPluralLower} assigned
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              Use Auto-assign {officialPluralLower} on each division, or fill slots manually from the schedule.
            </p>
          </div>
        </div>
      )}

      {/* Stats row — 5 cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "Divisions", value: divisionCount, icon: Layers },
          { label: "Teams",     value: teamCount,     icon: Users },
          { label: "Games",     value: gameCount,     icon: CalendarDays },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500">{label}</p>
              <Icon className="h-4 w-4 text-gray-300" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#0C1F3F]">{value}</p>
          </div>
        ))}

        {/* Conflicts — clickable, includes schedule + blackout conflicts */}
        <ConflictStatCard
          initialConflictGames={conflictGames}
          leagueId={league.id}
          divisionNames={divisionNames}
        />

        {/* Rained Out — interactive client card. Basic logging + restore stay
            Free; the auto-reschedule action is Pro+ (canReschedule). */}
        <RainedOutStatCard
          count={rainedOutCount}
          initialGames={rainedOutGames}
          leagueId={league.id}
          divisionNames={divisionNames}
          canReschedule={isProPlus(plan)}
        />
      </div>

      <BlackoutDatesPanel
        leagueId={league.id}
        initialAffectedGames={blackoutAffectedGames}
      />

      {/* Activity Log is Pro+ — hidden for Free (skips its data fetch too,
          since the panel is the server component that runs the query). */}
      {isProPlus(plan) && <ActivityLogPanel leagueId={league.id} />}

      <LeagueContent
        leagueId={league.id}
        leagueName={league.name}
        leagueSport={league.sport}
        divisionStats={divisionStats}
        currentOrgId={currentOrgId}
        divisionCount={orgDivisionCount}
        divisionLimit={divisionLimit}
        teamCount={orgTeamCount}
        teamLimit={teamLimit}
        plan={plan}
      />

    </div>
  );
}
