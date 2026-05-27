import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Trophy, Users, CalendarDays, MapPin, Plus, ArrowRight } from "lucide-react";
import { UpcomingGamesList, type UpcomingGame } from "@/components/dashboard/upcoming-games-list";
import { CriticalAlertsCard, type CriticalAlertLeague } from "@/components/dashboard/critical-alerts-card";
import { SeasonSelector, type SeasonOption } from "@/components/dashboard/season-selector";
import { OverviewReports } from "@/components/reports/overview-reports";

type OwnedLeague = {
  id: string;
  name: string;
  season: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format a "YYYY-MM-DD" string from string parts directly so SSR (UTC) and the
// browser (user-local) produce identical text — toLocaleDateString varies by
// host timezone AND ICU version ("Sep" vs. "Sept"), which trips hydration.
function fmtRangeDate(d: string | null): string | null {
  if (!d) return null;
  const [year, month, day] = d.substring(0, 10).split("-").map(Number);
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`;
}

function resolveSelectedSeasonId(
  param: string | undefined,
  leagues: OwnedLeague[],
): string {
  if (param === "all") return "all";
  if (param && leagues.some((l) => l.id === param)) return param;
  // Default: most recently created active season; fall back to most recent
  // overall; fall back to "all" if the org has no seasons.
  const mostRecentActive = leagues.find((l) => l.status === "active");
  if (mostRecentActive) return mostRecentActive.id;
  if (leagues.length > 0) return leagues[0].id;
  return "all";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { season?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // All seasons the org owns, most-recent first — drives the dropdown and the
  // default-season resolution.
  const { data: leaguesRaw } = await supabase
    .from("leagues")
    .select("id, name, season, status, start_date, end_date, created_at")
    .eq("owner_id", user!.id)
    .order("created_at", { ascending: false });

  const ownedLeagues = (leaguesRaw ?? []) as OwnedLeague[];
  const selected = resolveSelectedSeasonId(searchParams.season, ownedLeagues);
  const selectedSeason =
    selected === "all" ? null : ownedLeagues.find((l) => l.id === selected) ?? null;
  const isAll = selected === "all";

  // Filter helper — when a specific season is picked we constrain each count
  // and listing query to that league_id; when "all" we revert to the original
  // RLS-scoped aggregate.
  const teamsQ = isAll
    ? supabase.from("teams").select("*", { count: "exact", head: true })
    : supabase.from("teams").select("*", { count: "exact", head: true }).eq("league_id", selected);

  const gamesCountQ = isAll
    ? supabase.from("games").select("*", { count: "exact", head: true }).eq("status", "scheduled")
    : supabase
        .from("games")
        .select("*", { count: "exact", head: true })
        .eq("status", "scheduled")
        .eq("league_id", selected);

  const upcomingQ = (() => {
    let q = supabase
      .from("games")
      .select(`
        id, scheduled_at, status, league_id, home_team_id, away_team_id,
        home_team:teams!home_team_id(name, division_id),
        away_team:teams!away_team_id(name),
        venue:venues(name)
      `)
      .eq("status", "scheduled")
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(5);
    if (!isAll) q = q.eq("league_id", selected);
    return q;
  })();

  const [
    { count: teamCount },
    { count: gameCount },
    { count: venueCount },
    { data: rawGames },
    { data: profileRow },
    { data: firstLeague },
  ] = await Promise.all([
    teamsQ,
    gamesCountQ,
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("owner_id", user!.id),
    upcomingQ,
    supabase.from("profiles").select("org_name").eq("id", user!.id).single(),
    supabase
      .from("leagues")
      .select("name")
      .eq("owner_id", user!.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const orgName =
    (profileRow as { org_name: string | null } | null)?.org_name?.trim() ||
    firstLeague?.name ||
    "";

  const upcomingGames = (rawGames ?? []) as unknown as UpcomingGame[];
  const isEmpty = ownedLeagues.length === 0;

  // Critical alerts: filter to the selected season when specific; otherwise
  // span all of the org's seasons exactly like before.
  const alertLeagues = isAll
    ? ownedLeagues.map((l) => ({ id: l.id, name: l.name, season: l.season }))
    : selectedSeason
    ? [{ id: selectedSeason.id, name: selectedSeason.name, season: selectedSeason.season }]
    : [];
  const criticalAlertLeagues = await buildCriticalAlertLeagues(supabase, alertLeagues);

  // Dropdown options + the value the <select> should render. Active seasons
  // float to the top within the most-recent-first ordering.
  const seasonOptions: SeasonOption[] = ownedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    season: l.season,
    status: l.status,
  }));

  return (
    <div className="flex flex-col gap-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Overview</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Welcome back{orgName ? `, ${orgName}` : ""}
          </p>
        </div>
        {!isEmpty && (
          <Link
            href="/dashboard/leagues/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            <Plus className="h-4 w-4" />
            New season
          </Link>
        )}
      </div>

      {/* Season selector */}
      {!isEmpty && (
        <SeasonSelector seasons={seasonOptions} selectedValue={selected} />
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isAll ? (
          <StatsCard
            title="Active Seasons"
            value={ownedLeagues.filter((l) => l.status === "active").length}
            icon={Trophy}
          />
        ) : selectedSeason ? (
          <SeasonStatsCard season={selectedSeason} />
        ) : (
          <StatsCard title="Active Seasons" value={0} icon={Trophy} />
        )}
        <StatsCard title="Teams" value={teamCount ?? 0} icon={Users} />
        <StatsCard title="Scheduled Games" value={gameCount ?? 0} icon={CalendarDays} />
        <StatsCard title="Venues" value={venueCount ?? 0} icon={MapPin} />
      </div>

      {/* Empty state */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0C1F3F]/6">
            <Trophy className="h-6 w-6 text-[#0C1F3F]/40" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-[#0C1F3F]">
            Create your first season
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
            Set up a season to start building your schedule. You can add divisions, teams, and venues once it&apos;s created.
          </p>
          <Link
            href="/dashboard/leagues/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            <Plus className="h-4 w-4" />
            Create a season
          </Link>
          <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:gap-6">
            {[
              { href: "/dashboard/venues", label: "Add a venue first" },
              { href: "/dashboard/teams", label: "Browse teams" },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F]"
              >
                {label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <CriticalAlertsCard leagues={criticalAlertLeagues} />

          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-[#0C1F3F]">Upcoming Games</h2>
            </div>
            <div className="px-6 py-4">
              <UpcomingGamesList initialGames={upcomingGames} />
            </div>
          </div>

          {/* Reports — reads the same `?season=` URL param the rest of the
              page reacts to. `selected === "all"` is passed through as null
              to render the "pick a season" explainer. */}
          <OverviewReports leagueId={isAll ? null : selected} />
        </>
      )}
    </div>
  );
}

function SeasonStatsCard({ season }: { season: OwnedLeague }) {
  const start = fmtRangeDate(season.start_date);
  const end = fmtRangeDate(season.end_date);
  const range = start && end ? `${start} – ${end}` : start || end || "Dates not set";
  const isActive = season.status === "active";
  return (
    <div className="flex items-start justify-between rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-500">Season</p>
        <p className="mt-2 truncate text-base font-bold text-[#0C1F3F]" title={season.name}>
          {season.name}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {season.season ? `${season.season} · ` : ""}
          {range}
        </p>
        <span
          className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
            isActive ? "bg-[#22C55E]/10 text-[#22C55E]" : "bg-gray-100 text-gray-500"
          }`}
        >
          {season.status}
        </span>
      </div>
      <Trophy className="h-5 w-5 flex-shrink-0 text-gray-300" />
    </div>
  );
}

type LeagueLite = { id: string; name: string; season: string | null };

async function buildCriticalAlertLeagues(
  supabase: ReturnType<typeof createClient>,
  leagues: LeagueLite[],
): Promise<CriticalAlertLeague[]> {
  if (leagues.length === 0) return [];
  const leagueIds = leagues.map((l) => l.id);

  const [{ data: rainoutsRaw }, { data: blackoutsRaw }, { data: activeGamesRaw }] =
    await Promise.all([
      supabase
        .from("games")
        .select("league_id")
        .in("league_id", leagueIds)
        .eq("status", "cancelled"),
      supabase
        .from("blackout_dates")
        .select("league_id, date")
        .in("league_id", leagueIds),
      supabase
        .from("games")
        .select("id, league_id, scheduled_at, venue_id, status")
        .in("league_id", leagueIds)
        .neq("status", "cancelled"),
    ]);

  const rainoutCounts = new Map<string, number>();
  for (const r of (rainoutsRaw ?? []) as { league_id: string }[]) {
    rainoutCounts.set(r.league_id, (rainoutCounts.get(r.league_id) ?? 0) + 1);
  }

  // Blackout date set per league: "league_id|YYYY-MM-DD"
  const blackoutKeys = new Set<string>();
  for (const b of (blackoutsRaw ?? []) as { league_id: string; date: string }[]) {
    blackoutKeys.add(`${b.league_id}|${b.date}`);
  }

  const blackoutCounts = new Map<string, number>();
  const conflictCounts = new Map<string, number>();
  // For conflicts, count games sharing (league, venue, scheduled_at) > 1.
  // This catches exact double-bookings — full gap-based detection lives on
  // the season detail page, where the user can act on each conflict.
  const venueSlotGroups = new Map<string, string[]>();
  for (const g of (activeGamesRaw ?? []) as {
    id: string;
    league_id: string;
    scheduled_at: string;
    venue_id: string | null;
    status: string;
  }[]) {
    if (blackoutKeys.has(`${g.league_id}|${g.scheduled_at.substring(0, 10)}`)) {
      blackoutCounts.set(g.league_id, (blackoutCounts.get(g.league_id) ?? 0) + 1);
    }
    if (g.venue_id) {
      const key = `${g.league_id}|${g.venue_id}|${g.scheduled_at}`;
      if (!venueSlotGroups.has(key)) venueSlotGroups.set(key, []);
      venueSlotGroups.get(key)!.push(g.league_id);
    }
  }
  for (const ids of venueSlotGroups.values()) {
    if (ids.length < 2) continue;
    const leagueId = ids[0];
    conflictCounts.set(leagueId, (conflictCounts.get(leagueId) ?? 0) + ids.length);
  }

  return leagues.map((l) => ({
    id: l.id,
    name: l.name,
    season: l.season,
    rainoutCount: rainoutCounts.get(l.id) ?? 0,
    conflictCount: conflictCounts.get(l.id) ?? 0,
    blackoutAffectedCount: blackoutCounts.get(l.id) ?? 0,
  }));
}
