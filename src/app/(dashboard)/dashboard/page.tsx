import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Trophy, Users, CalendarDays, MapPin, Plus, ArrowRight } from "lucide-react";
import { UpcomingGamesList, type UpcomingGame } from "@/components/dashboard/upcoming-games-list";
import { CriticalAlertsCard, type CriticalAlertLeague } from "@/components/dashboard/critical-alerts-card";
import { SeasonSelector, type SeasonOption } from "@/components/dashboard/season-selector";
import { autoArchivePastSeasons } from "@/lib/seasons/auto-archive";
import { nonArchivedLeagues } from "@/lib/seasons/queries";
import { deriveSeasonStatus } from "@/lib/seasons/derived-status";
import { resolveSelectedSeasonId } from "@/lib/seasons/resolve-selected";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isProPlus, isElite } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";
import { WelcomeBanner } from "@/components/dashboard/welcome-banner";
import { CompleteSetupCta } from "@/components/dashboard/complete-setup-cta";
import { isSetupIncomplete } from "@/lib/setup/derive-step";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";

type OwnedLeague = {
  id: string;
  name: string;
  season: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { season?: string; showArchived?: string; welcome?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);
  // Plan drives the Pro+ auto-reschedule action in the upcoming-games menu
  // (basic "Log Rainout" stays Free). React-cached, shared with the layout.
  const plan = await getOrgPlan(currentOrgId);

  // Auto-archive any past-end-date seasons *before* the SELECT below so the
  // picker dropdown doesn't surface stale "active" seasons. Mirrors the same
  // call on /dashboard/leagues — write-on-read, single cheap UPDATE.
  await autoArchivePastSeasons(supabase, currentOrgId);

  // All seasons the org owns, most-recent first — drives the dropdown and the
  // default-season resolution.
  const { data: leaguesRaw } = await supabase
    .from("leagues")
    .select(
      "id, name, season, status, start_date, end_date, archived_at, created_at",
    )
    .eq("owner_id", currentOrgId)
    .order("created_at", { ascending: false });

  const ownedLeagues = (leaguesRaw ?? []) as OwnedLeague[];
  // Browsing archived seasons is Elite-only — force off for Free/Pro even if
  // ?showArchived=1 is in the URL (the toggle is also hidden for them).
  const showArchived = isElite(plan) && searchParams.showArchived === "1";
  // Default to the topbar's global season when no ?season= override is in
  // the URL (Chunk C). The local selector stays — it's the only place the
  // "All seasons" rollup lives — and writes the URL param only, never the
  // global cookie.
  const globalSeasonId = await getCurrentSeasonId(supabase, currentOrgId);
  const selected = resolveSelectedSeasonId(
    searchParams.season,
    ownedLeagues,
    globalSeasonId,
  );
  const selectedSeason =
    selected === "all" ? null : ownedLeagues.find((l) => l.id === selected) ?? null;
  const isAll = selected === "all";
  // League ids for the "All seasons" rollup — deliberately "not archived"
  // (draft/upcoming seasons count), keyed on archived_at. Also narrows the
  // isAll branches to THIS org so a multi-org admin doesn't see counts/games
  // merged across their orgs (RLS alone would permit rows from every org
  // they belong to).
  const nonArchivedLeagueIds = nonArchivedLeagues(ownedLeagues).map((l) => l.id);
  // Every rollup season may be archived (the exact state after a season
  // wraps) — skip the count/list queries instead of issuing `in.()` filters.
  const rollupIsEmpty = isAll && nonArchivedLeagueIds.length === 0;

  // Filter helper — when a specific season is picked we constrain to that
  // league_id; the "all" branch constrains to the org's non-archived leagues
  // so cross-org rows can't sneak in via RLS.
  const teamsQ = isAll
    ? supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .in("league_id", nonArchivedLeagueIds)
    : supabase.from("teams").select("*", { count: "exact", head: true }).eq("league_id", selected);

  const gamesCountQ = isAll
    ? supabase
        .from("games")
        .select("*", { count: "exact", head: true })
        .eq("status", "scheduled")
        .in("league_id", nonArchivedLeagueIds)
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
    if (isAll) {
      q = q.in("league_id", nonArchivedLeagueIds);
    } else {
      q = q.eq("league_id", selected);
    }
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
    rollupIsEmpty ? { count: 0 } : teamsQ,
    rollupIsEmpty ? { count: 0 } : gamesCountQ,
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("owner_id", currentOrgId),
    rollupIsEmpty ? { data: [] } : upcomingQ,
    // Org name lives on the OWNER's profile (since org_id = owner's user id),
    // so when an admin views someone else's org they still see that org's name.
    supabase.from("profiles").select("org_name, pending_plan").eq("id", currentOrgId).single(),
    supabase
      .from("leagues")
      .select("name")
      .eq("owner_id", currentOrgId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const typedProfile = profileRow as
    | { org_name: string | null; pending_plan: string | null }
    | null;
  const orgName = typedProfile?.org_name?.trim() || firstLeague?.name || "";
  const pendingPlan = typedProfile?.pending_plan;
  // After a successful checkout the success_url carries ?welcome=true. The
  // webhook (which flips the tier + clears pending_plan) may not have landed
  // yet, so plan can still read 'free' for a beat — name the tier from
  // pending_plan when it's set so the banner never shows the wrong plan.
  const welcomePlan =
    pendingPlan === "pro" || pendingPlan === "elite" ? pendingPlan : plan;

  const upcomingGames = (rawGames ?? []) as unknown as UpcomingGame[];
  const isEmpty = ownedLeagues.length === 0;

  // Empty-state /setup link (Chunk 4): only for owners acting in their OWN
  // org with setup still incomplete — invited admins and finished owners
  // never see it. Derived lazily: the check only runs when the empty state
  // will actually render.
  const showSetupLink =
    isEmpty &&
    currentOrgId === user!.id &&
    (await isSetupIncomplete(supabase, currentOrgId, globalSeasonId));

  // Critical alerts are actionable-now items: they only ever draw from
  // non-archived seasons — the rollup skips archived ones, and an explicitly
  // selected archived season gets the silent all-clear card.
  const alertLeagues = isAll
    ? nonArchivedLeagues(ownedLeagues).map((l) => ({ id: l.id, name: l.name, season: l.season }))
    : selectedSeason && !selectedSeason.archived_at
    ? [{ id: selectedSeason.id, name: selectedSeason.name, season: selectedSeason.season }]
    : [];
  const criticalAlertLeagues = await buildCriticalAlertLeagues(supabase, alertLeagues);

  // Dropdown options + the value the <select> should render. The picker
  // hides archived rows by default; archived_at is the source of truth.
  const seasonOptions: SeasonOption[] = ownedLeagues.map((l) => ({
    id: l.id,
    name: l.name,
    season: l.season,
    status: l.status,
    archivedAt: l.archived_at,
  }));

  return (
    <div className="flex flex-col gap-6">

      {searchParams.welcome === "true" && (
        <WelcomeBanner planLabel={planLabel(welcomePlan)} />
      )}
      {searchParams.welcome !== "true" &&
        plan === "free" &&
        (pendingPlan === "pro" || pendingPlan === "elite") && (
          <CompleteSetupCta
            plan={pendingPlan}
            planLabel={planLabel(pendingPlan)}
            orgId={currentOrgId}
          />
        )}

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
        <SeasonSelector
          seasons={seasonOptions}
          selectedValue={selected}
          showArchived={showArchived}
          canShowArchived={isElite(plan)}
        />
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isAll ? (
          <StatsCard
            title="Active Seasons"
            value={nonArchivedLeagueIds.length}
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
          {showSetupLink && <FinishSetupLink className="mt-3" />}
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
              <UpcomingGamesList initialGames={upcomingGames} canReschedule={isProPlus(plan)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SeasonStatsCard({ season }: { season: OwnedLeague }) {
  const start = fmtRangeDate(season.start_date);
  const end = fmtRangeDate(season.end_date);
  const range = start && end ? `${start} – ${end}` : start || end || "Dates not set";
  const status = deriveSeasonStatus(season);
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
          className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.pillClass}`}
        >
          {status.label}
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
