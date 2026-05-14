"use client";

import { useState, useEffect, useCallback } from "react";
import { Medal, Plus, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PlayoffWizard } from "@/components/playoffs/playoff-wizard";
import { BracketView } from "@/components/playoffs/bracket-view";
import {
  DEFAULT_PLAYOFF_DATA,
  type PlayoffWizardData,
  type PlayoffFormat,
  type PlayingDay,
  type DayWindowMap,
  type VenueAssignment,
  type SeededTeam,
} from "@/components/playoffs/playoff-wizard-types";

type League = { id: string; name: string; sport: string };

type PlayoffRow = {
  id: string;
  league_id: string;
  division_id: string;
  format: PlayoffFormat;
  status: string;
  start_date: string | null;
  end_date: string | null;
  seeding: SeededTeam[];
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
  venue_assignments: VenueAssignment[];
  cross_division_enabled: boolean;
  cross_division_opponent_id: string | null;
  division: { id: string; name: string } | null;
};

const FORMAT_LABELS: Record<PlayoffFormat, string> = {
  single_elimination: "Single elimination",
  double_elimination: "Double elimination",
  round_robin: "Round robin",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-[#22C55E]/10 text-[#22C55E]",
  completed: "bg-blue-50 text-blue-600",
  draft: "bg-gray-100 text-gray-500",
};

function rowToWizardData(row: PlayoffRow): PlayoffWizardData {
  return {
    division_id: row.division_id,
    division_name: row.division?.name ?? "",
    format: row.format,
    seeding: row.seeding ?? [],
    start_date: row.start_date ?? "",
    end_date: row.end_date ?? "",
    playing_days: row.playing_days ?? [],
    day_windows: row.day_windows ?? {},
    venue_assignments: row.venue_assignments ?? [],
    cross_division_enabled: row.cross_division_enabled ?? false,
    cross_division_opponent_id: row.cross_division_opponent_id ?? "",
    cross_division_opponent_name: "",
  };
}

export default function PlayoffsPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [playoffs, setPlayoffs] = useState<PlayoffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardLeague, setWizardLeague] = useState<League | null>(null);
  const [editData, setEditData] = useState<PlayoffWizardData | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: leagueData } = await supabase
      .from("leagues")
      .select("id, name, sport")
      .eq("owner_id", user.id)
      .order("name");

    const leagueList = (leagueData ?? []) as League[];
    setLeagues(leagueList);

    if (leagueList.length > 0) {
      const leagueIds = leagueList.map((l) => l.id);
      const { data: playoffData } = await supabase
        .from("playoffs")
        .select(
          `id, league_id, division_id, format, status, start_date, end_date,
           seeding, playing_days, day_windows, venue_assignments,
           cross_division_enabled, cross_division_opponent_id,
           division:divisions(id, name)`
        )
        .in("league_id", leagueIds);

      setPlayoffs((playoffData as unknown as PlayoffRow[]) ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNewWizard(league: League) {
    setWizardLeague(league);
    setEditData(undefined);
    setWizardOpen(true);
  }

  function openEditWizard(league: League, row: PlayoffRow) {
    setWizardLeague(league);
    setEditData(rowToWizardData(row));
    setWizardOpen(true);
  }

  function handleWizardComplete() {
    setWizardOpen(false);
    setWizardLeague(null);
    setEditData(undefined);
    load();
  }

  function handleWizardClose() {
    setWizardOpen(false);
    setWizardLeague(null);
    setEditData(undefined);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <svg
          className="h-5 w-5 animate-spin text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
    );
  }

  const hasAny = playoffs.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0C1F3F]">Playoffs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Set up playoff brackets for each division.
        </p>
      </div>

      {!hasAny ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-20 text-center">
          <Medal className="mb-4 h-10 w-10 text-gray-300" />
          <h3 className="font-semibold text-gray-900">No playoffs set up yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Create a playoff bracket for any of your divisions.
          </p>
          {leagues.length > 0 && (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {leagues.map((league) => (
                <button
                  key={league.id}
                  onClick={() => openNewWizard(league)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
                >
                  <Plus className="h-4 w-4" />
                  Set up playoffs — {league.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {leagues.map((league) => {
            const leaguePlayoffs = playoffs.filter(
              (p) => p.league_id === league.id
            );
            return (
              <section key={league.id}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#0C1F3F]">
                      {league.name}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {league.sport}
                    </span>
                    {leaguePlayoffs.length > 0 && (
                      <span className="text-xs text-gray-400">
                        {leaguePlayoffs.length} bracket
                        {leaguePlayoffs.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => openNewWizard(league)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add bracket
                  </button>
                </div>

                {leaguePlayoffs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-8 text-center">
                    <p className="text-sm text-gray-400">
                      No playoffs set up for this league.
                    </p>
                    <button
                      onClick={() => openNewWizard(league)}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#22C55E] hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Set up playoffs
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {leaguePlayoffs.map((playoff) => (
                      <div
                        key={playoff.id}
                        className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
                      >
                        {/* Playoff header row */}
                        <div className="flex items-center gap-3 border-b border-gray-50 px-4 py-3">
                          <Medal className="h-4 w-4 flex-shrink-0 text-gray-300" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900">
                              {playoff.division?.name ?? "—"}
                            </p>
                            <p className="text-xs text-gray-400">
                              {FORMAT_LABELS[playoff.format] ?? playoff.format}
                              {playoff.start_date
                                ? ` · starts ${playoff.start_date}`
                                : ""}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                              STATUS_STYLES[playoff.status] ?? STATUS_STYLES.draft
                            }`}
                          >
                            {playoff.status}
                          </span>
                          <button
                            onClick={() => openEditWizard(league, playoff)}
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            aria-label="Edit playoff"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Bracket — shown when generated */}
                        {playoff.status !== "draft" && (
                          <div className="p-4">
                            <BracketView
                              playoffId={playoff.id}
                              divisionName={playoff.division?.name ?? ""}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {wizardOpen && wizardLeague && (
        <PlayoffWizard
          leagueId={wizardLeague.id}
          leagueName={wizardLeague.name}
          initialData={editData ?? { ...DEFAULT_PLAYOFF_DATA }}
          isEditMode={!!editData}
          onClose={handleWizardClose}
          onComplete={handleWizardComplete}
        />
      )}
    </div>
  );
}
