import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AutoPrintOnLoad } from "@/components/umpires/auto-print-on-load";
import { ManualPrintButton } from "@/components/umpires/manual-print-button";

type UmpireRow = {
  id: string;
  name: string;
  designation: string;
  season_id: string;
  season: { name: string; season: string | null } | null;
};

type AssignmentRow = {
  umpire_id: string;
  role: string;
  game: {
    id: string;
    scheduled_at: string;
    home_team: {
      name: string;
      division: { name: string } | null;
    } | null;
    away_team: { name: string } | null;
    venue: { name: string } | null;
  } | null;
};

function fmtDate(scheduled_at: string): string {
  return new Date(scheduled_at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(scheduled_at: string): string {
  return new Date(scheduled_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function PrintAllUmpireSchedulesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Limit to the current user's seasons (RLS would catch it anyway, but this
  // also constrains the order and avoids touching unrelated rows).
  const { data: seasonRows } = await supabase
    .from("leagues")
    .select("id")
    .eq("owner_id", user!.id);
  const seasonIds = ((seasonRows ?? []) as { id: string }[]).map((r) => r.id);

  const [{ data: umpiresRaw }, { data: assignsRaw }] = await Promise.all([
    seasonIds.length > 0
      ? supabase
          .from("umpires")
          .select("id, name, designation, season_id, season:leagues(name, season)")
          .in("season_id", seasonIds)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from("game_umpires")
      .select(
        `umpire_id, role,
         game:games(
           id, scheduled_at,
           home_team:teams!home_team_id(name, division:divisions(name)),
           away_team:teams!away_team_id(name),
           venue:venues(name)
         )`,
      ),
  ]);

  const umpires = (umpiresRaw as unknown as UmpireRow[] | null) ?? [];
  const assignments = ((assignsRaw as unknown as AssignmentRow[] | null) ?? [])
    .filter((r) => r.game);

  const byUmpire = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    if (!byUmpire.has(a.umpire_id)) byUmpire.set(a.umpire_id, []);
    byUmpire.get(a.umpire_id)!.push(a);
  }
  for (const list of byUmpire.values()) {
    list.sort(
      (a, b) =>
        new Date(a.game!.scheduled_at).getTime() -
        new Date(b.game!.scheduled_at).getTime(),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AutoPrintOnLoad />

      {/* Screen-only header — gone on print */}
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <Link
            href="/dashboard/umpires"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to umpires
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-[#0C1F3F]">
            Print all schedules
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            One page per umpire. The print dialog should open automatically — if it
            doesn&apos;t, click the button below.
          </p>
        </div>
        <ManualPrintButton />
      </div>

      {umpires.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500 print:hidden">
          No umpires on the roster yet.
        </div>
      ) : (
        <div className="flex flex-col gap-12 print:gap-0">
          {umpires.map((u, idx) => {
            const rows = byUmpire.get(u.id) ?? [];
            const designationLabel =
              u.designation === "adult" ? "Adult umpire" : "Youth umpire";
            const seasonName = u.season?.name ?? "";
            const seasonLabel = u.season?.season ?? "";
            return (
              <section
                key={u.id}
                className={`flex flex-col gap-4 ${
                  idx < umpires.length - 1 ? "print:break-after-page" : ""
                }`}
              >
                <div className="border-b border-gray-200 pb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 print:text-black">
                    Umpire schedule
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-[#0C1F3F] print:text-black">
                    {u.name}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500 print:text-black">
                    {designationLabel}
                    {seasonName ? ` · ${seasonName}` : ""}
                    {seasonLabel ? ` · ${seasonLabel}` : ""}
                  </p>
                </div>

                {rows.length === 0 ? (
                  <p className="text-sm text-gray-500">No games assigned.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500 print:text-black">
                        <th className="px-2 py-2 font-semibold">Date</th>
                        <th className="px-2 py-2 font-semibold">Time</th>
                        <th className="px-2 py-2 font-semibold">Role</th>
                        <th className="px-2 py-2 font-semibold">Matchup</th>
                        <th className="px-2 py-2 font-semibold">Division</th>
                        <th className="px-2 py-2 font-semibold">Venue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((r, i) => {
                        const g = r.game!;
                        return (
                          <tr
                            key={`${g.id}-${i}`}
                            className="text-gray-700 print:text-black"
                          >
                            <td className="px-2 py-2 tabular-nums">
                              {fmtDate(g.scheduled_at)}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {fmtTime(g.scheduled_at)}
                            </td>
                            <td className="px-2 py-2 font-semibold text-[#0C1F3F] print:text-black">
                              {r.role}
                            </td>
                            <td className="px-2 py-2">
                              {g.home_team?.name ?? "TBD"} vs{" "}
                              {g.away_team?.name ?? "TBD"}
                            </td>
                            <td className="px-2 py-2">
                              {g.home_team?.division?.name ?? "—"}
                            </td>
                            <td className="px-2 py-2">
                              {g.venue?.name ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
