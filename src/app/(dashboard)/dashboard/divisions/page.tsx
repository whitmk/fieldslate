import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Layers } from "lucide-react";
import { DivisionBallIcon } from "@/components/divisions/division-ball-icon";
import { AddDivisionButton } from "@/components/divisions/add-division-button";
import type { Division, League } from "@/types/database";

type LeagueRow = Pick<League, "id" | "name" | "sport"> & {
  start_date: string | null;
  end_date: string | null;
};

type DivisionWithLeague = Division & { league: LeagueRow };

const STATUS_STYLES: Record<Division["status"], string> = {
  active:   "bg-[#22C55E]/10 text-[#22C55E]",
  draft:    "bg-gray-100 text-gray-500",
  archived: "bg-gray-100 text-gray-400",
};

export default async function DivisionsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: rawLeagues } = await supabase
    .from("leagues")
    .select("id, name, sport, start_date, end_date")
    .eq("owner_id", user!.id)
    .order("name", { ascending: true });

  const leagues = (rawLeagues ?? []) as LeagueRow[];
  const leagueIds = leagues.map((l) => l.id);
  const leagueMap = new Map(leagues.map((l) => [l.id, l]));

  const { data: rawDivisions } = leagueIds.length
    ? await supabase
        .from("divisions")
        .select("*")
        .in("league_id", leagueIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  const divisions = (rawDivisions ?? []) as Division[];

  // Group by league, preserving league order
  const byLeague = new Map<string, DivisionWithLeague[]>();
  for (const league of leagues) byLeague.set(league.id, []);
  divisions.forEach((div) => {
    const league = leagueMap.get(div.league_id);
    if (!league) return;
    byLeague.get(div.league_id)?.push({ ...div, league });
  });

  const hasAny = divisions.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Divisions</h1>
          <p className="mt-1 text-sm text-gray-500">All divisions across your leagues.</p>
        </div>
        <AddDivisionButton
          leagues={leagues.map((l) => ({
            id: l.id,
            name: l.name,
            start_date: l.start_date,
            end_date: l.end_date,
          }))}
        />
      </div>

      {!hasAny ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="mb-4 h-10 w-10 text-gray-300" />
            <h3 className="font-semibold text-gray-900">No divisions yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Create a league and add divisions to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {leagues.map((league) => {
            const divs = byLeague.get(league.id) ?? [];
            if (divs.length === 0) return null;
            return (
              <section key={league.id}>
                <div className="mb-3 flex items-center gap-2">
                  <Link
                    href={`/dashboard/leagues/${league.id}`}
                    className="text-sm font-semibold text-[#0C1F3F] hover:underline"
                  >
                    {league.name}
                  </Link>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {league.sport}
                  </span>
                  <span className="text-xs text-gray-400">
                    {divs.length} division{divs.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                  {divs.map((div, idx) => (
                    <div
                      key={div.id}
                      className="flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0"
                    >
                      <DivisionBallIcon
                        sport={league.sport}
                        index={idx}
                        containerClassName="h-8 w-8 rounded-md"
                        iconClassName="h-3.5 w-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{div.name}</p>
                        <p className="text-xs text-gray-400">{div.team_count} teams</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[div.status]}`}
                      >
                        {div.status}
                      </span>
                      <Link
                        href={`/dashboard/leagues/${league.id}`}
                        className="text-xs text-gray-400 hover:text-[#0C1F3F]"
                      >
                        View →
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
