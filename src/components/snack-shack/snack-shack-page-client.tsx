"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, Settings2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SnackShackWizard } from "./snack-shack-wizard";
import { SnackShackSchedule, AddOneOffBlockButton, type BlockRow, type TeamOption } from "./snack-shack-schedule";
import type { SnackShackWizardData, DayCode, TimeBlock } from "./wizard-types";

type Season = { id: string; name: string; season: string };

type Settings = {
  id: string;
  season_id: string;
  start_date: string;
  end_date: string;
  days_of_week: unknown;
  time_blocks_by_day: unknown;
  home_venue_ids: unknown;
  scheduling_preference: string;
  updated_at: string;
};

type BlockRaw = {
  id: string;
  snack_shack_id: string;
  date: string;
  start_time: string;
  end_time: string;
  assigned_team_id: string | null;
  is_recurring: boolean;
  team: { name: string } | null;
};

type TeamRow = { id: string; name: string; league_id: string };

interface Props {
  seasons: Season[];
  allSettings: Settings[];
  allTeams: TeamRow[];
  allBlocks: BlockRaw[];
}

function settingsToWizardData(s: Settings): SnackShackWizardData {
  return {
    season_id: s.season_id,
    start_date: s.start_date,
    end_date: s.end_date,
    days_of_week: (s.days_of_week as DayCode[]) ?? [],
    time_blocks_by_day: (s.time_blocks_by_day as Partial<Record<DayCode, TimeBlock[]>>) ?? {},
    home_venue_ids: (s.home_venue_ids as string[]) ?? [],
    scheduling_preference:
      s.scheduling_preference === "prefer_off_days" ? "prefer_off_days" : "prefer_game_days",
  };
}

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SnackShackPageClient({
  seasons,
  allSettings,
  allTeams,
  allBlocks,
}: Props) {
  const router = useRouter();
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasons[0]?.id ?? "");
  const [wizardOpen, setWizardOpen] = useState(false);

  const season = seasons.find((s) => s.id === selectedSeasonId);
  const settings = allSettings.find((s) => s.season_id === selectedSeasonId) ?? null;
  const teams: TeamOption[] = allTeams
    .filter((t) => t.league_id === selectedSeasonId)
    .map((t) => ({ id: t.id, name: t.name }));

  const blocks: BlockRow[] = allBlocks
    .filter((b) => b.snack_shack_id === settings?.id)
    .map((b) => ({
      id: b.id,
      date: b.date,
      start_time: b.start_time,
      end_time: b.end_time,
      assigned_team_id: b.assigned_team_id,
      is_recurring: b.is_recurring,
      team_name: b.team?.name ?? null,
    }));

  return (
    <>
      {/* Season selector */}
      {seasons.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600">Season</label>
          <select
            value={selectedSeasonId}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.season}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* No setup state */}
      {!settings ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#0C1F3F]/6">
                <ShoppingBag className="h-8 w-8 text-[#0C1F3F]/30" />
              </div>
              <p className="text-lg font-semibold text-gray-900">
                No Snack Shack set up yet
              </p>
              <p className="mt-1 max-w-xs text-sm text-gray-500">
                Run the setup wizard to configure dates, time blocks, home venues, and
                auto-assign teams.
              </p>
              <button
                onClick={() => setWizardOpen(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
              >
                <Plus className="h-4 w-4" />
                Set up Snack Shack
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Settings summary card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Snack Shack Settings</CardTitle>
                <button
                  onClick={() => setWizardOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Edit settings
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Open
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {fmtDate(settings.start_date)} → {fmtDate(settings.end_date)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Days
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {((settings.days_of_week as string[]) ?? []).join(", ") || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Preference
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {settings.scheduling_preference === "prefer_off_days"
                      ? "Prefer off days"
                      : "Prefer game days"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Blocks
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {blocks.length} total
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Schedule */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Schedule</CardTitle>
                <AddOneOffBlockButton
                  snackShackId={settings.id}
                  teams={teams}
                />
              </div>
            </CardHeader>
            <CardContent>
              <SnackShackSchedule
                snackShackId={settings.id}
                blocks={blocks}
                teams={teams}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Wizard */}
      {wizardOpen && season && (
        <SnackShackWizard
          seasonId={selectedSeasonId}
          seasonName={`${season.name} · ${season.season}`}
          leagueId={selectedSeasonId}
          existingData={settings ? settingsToWizardData(settings) : undefined}
          existingId={settings?.id}
          onClose={() => setWizardOpen(false)}
          onComplete={() => {
            setWizardOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
