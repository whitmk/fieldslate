import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Trophy, Users, CalendarDays, MapPin, Plus, ArrowRight } from "lucide-react";
import { UpcomingGamesList, type UpcomingGame } from "@/components/dashboard/upcoming-games-list";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [
    { count: leagueCount },
    { count: teamCount },
    { count: gameCount },
    { count: venueCount },
    { data: rawGames },
    { data: firstLeague },
  ] = await Promise.all([
    supabase.from("leagues").select("*", { count: "exact", head: true }).eq("owner_id", user!.id),
    supabase.from("teams").select("*", { count: "exact", head: true }),
    supabase.from("games").select("*", { count: "exact", head: true }).eq("status", "scheduled"),
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("owner_id", user!.id),
    supabase
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
      .limit(5),
    supabase
      .from("leagues")
      .select("name")
      .eq("owner_id", user!.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .single(),
  ]);

  const upcomingGames = (rawGames ?? []) as unknown as UpcomingGame[];
  const isEmpty = !leagueCount || leagueCount === 0;

  return (
    <div className="flex flex-col gap-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Overview</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Welcome back{firstLeague?.name ? `, ${firstLeague.name}` : ""}
          </p>
        </div>
        {!isEmpty && (
          <Link
            href="/dashboard/leagues/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            <Plus className="h-4 w-4" />
            New league
          </Link>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard title="Active Leagues" value={leagueCount ?? 0} icon={Trophy} />
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
            Create your first league
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
            Set up a league to start building your schedule. You can add divisions, teams, and venues once it&apos;s created.
          </p>
          <Link
            href="/dashboard/leagues/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            <Plus className="h-4 w-4" />
            Create a league
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
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="font-semibold text-[#0C1F3F]">Upcoming Games</h2>
          </div>
          <div className="px-6 py-4">
            <UpcomingGamesList initialGames={upcomingGames} />
          </div>
        </div>
      )}
    </div>
  );
}
