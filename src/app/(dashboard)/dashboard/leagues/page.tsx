import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Plus, Trophy } from "lucide-react";
import type { League } from "@/types/database";

const statusStyles: Record<string, string> = {
  active: "bg-[#22C55E]/10 text-[#22C55E]",
  inactive: "bg-yellow-50 text-yellow-700",
  archived: "bg-gray-100 text-gray-500",
};

export default async function LeaguesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("leagues")
    .select("*")
    .eq("owner_id", user!.id)
    .order("created_at", { ascending: false });
  const leagues = data as League[] | null;

  return (
    <div className="flex flex-col gap-6">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Leagues</h1>
          <p className="mt-0.5 text-sm text-gray-500">Manage your sports leagues and seasons.</p>
        </div>
        <Link
          href="/dashboard/leagues/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
        >
          <Plus className="h-4 w-4" />
          New league
        </Link>
      </div>

      {!leagues || leagues.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0C1F3F]/6">
            <Trophy className="h-6 w-6 text-[#0C1F3F]/40" />
          </div>
          <h3 className="mt-5 font-semibold text-[#0C1F3F]">No leagues yet</h3>
          <p className="mt-1.5 max-w-xs text-sm text-gray-400">
            Create your first league to start building your schedule.
          </p>
          <Link
            href="/dashboard/leagues/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            <Plus className="h-4 w-4" />
            Create a league
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <Link key={league.id} href={`/dashboard/leagues/${league.id}`}>
              <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-[#0C1F3F]">{league.name}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusStyles[league.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {league.status}
                  </span>
                </div>
                <p className="text-sm text-gray-400">
                  {league.sport} · {league.season}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
