export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingBag } from "lucide-react";
import { SnackShackPageClient } from "@/components/snack-shack/snack-shack-page-client";
import { getCurrentOrgId } from "@/lib/orgs/context";
import { getCurrentSeasonId } from "@/lib/seasons/context";
import { getOrgPlan } from "@/lib/plan/get-org-plan";
import { isElite } from "@/lib/plan/limits";
import { FeatureLockedCard } from "@/components/plan/upgrade-cta";
import { isSetupIncomplete } from "@/lib/setup/derive-step";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";
import { fetchAllRows, type PagedResult } from "@/lib/supabase/fetch-all";
import { SHIFT_NOTE_SELECT_FIELDS, type ShiftNoteFields, type CashPerson } from "@/lib/snack-shack/shift-notes";

type TeamRow = { id: string; name: string; league_id: string };

export default async function SnackShackPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentOrgId = await getCurrentOrgId(supabase, user!.id);

  // Snack Shack is an Elite-only feature — guard the route server-side.
  const plan = await getOrgPlan(currentOrgId);
  if (!isElite(plan)) {
    return <FeatureLockedCard feature="Snack Shack" tier="Elite" />;
  }

  // Season-scoped (Chunk B2): only the topbar's selected season. The
  // `seasons` array keeps its shape (now 0 or 1 elements) so the client's
  // local season dropdown — which only renders for 2+ seasons — naturally
  // disappears and its seasons[0] default IS the selected season.
  const seasonId = await getCurrentSeasonId(supabase, currentOrgId);

  const { data: seasonsRaw } = seasonId
    ? await supabase
        .from("leagues")
        .select("id, name, season")
        .eq("id", seasonId)
    : { data: [] };

  const seasons = (seasonsRaw ?? []) as {
    id: string;
    name: string;
    season: string;
  }[];

  if (seasons.length === 0) {
    // Empty-state /setup link (Chunk 4): own-org owners mid-setup only.
    // Zero seasons means setup can't be past step 2, but the shared helper
    // stays the single source of truth for the gate.
    const showSetupLink =
      currentOrgId === user!.id &&
      (await isSetupIncomplete(supabase, currentOrgId, seasonId));
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Snack Shack</h1>
          <p className="mt-1 text-sm text-gray-500">
            Shifts made from the game schedule, with a team on each one.
          </p>
        </div>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center py-16 text-center">
              <ShoppingBag className="mb-3 h-10 w-10 text-gray-200" />
              <p className="font-medium text-gray-900">No active season</p>
              <p className="mt-1 text-sm text-gray-400">
                Create a season first, then come back to set up the Snack Shack.
              </p>
              {showSetupLink && <FinishSetupLink className="mt-3" />}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Load snack_shack_settings for the selected season
  const { data: settingsRaw } = await supabase
    .from("snack_shack_settings")
    .select("*")
    .eq("season_id", seasonId!);

  const allSettings = (settingsRaw ?? []) as {
    id: string;
    season_id: string;
    start_date: string;
    end_date: string;
    days_of_week: unknown;
    time_blocks_by_day: unknown;
    home_venue_ids: unknown;
    scheduling_preference: string;
    updated_at: string;
    open_before_min: number;
    close_after_min: number;
    max_shift_min: number;
    people_per_shift: number;
    shifts_generated_at: string | null;
  }[];

  // Load teams for the selected season
  const { data: teamsRaw } = await supabase
    .from("teams")
    .select("id, name, league_id")
    .eq("league_id", seasonId!)
    .order("name", { ascending: true });
  const allTeams = (teamsRaw ?? []) as TeamRow[];

  // Load blocks for all settings IDs
  const settingIds = allSettings.map((s) => s.id);
  // The blocks select CARRIES the internal note + cash fields (0104) so the
  // row can render them. The note is never printed or emailed; the cash
  // person prints on the full-schedule print only (via cashPrintLine) and
  // never on a team print or in an email — the game-notes harness pins it.
  let allBlocks: (ShiftNoteFields & {
    id: string;
    snack_shack_id: string;
    date: string;
    start_time: string;
    end_time: string;
    assigned_team_id: string | null;
    is_recurring: boolean;
    people_needed: number | null;
    team: { name: string } | null;
  })[] = [];
  let allCashPeople: (CashPerson & { snack_shack_id: string })[] = [];

  // COMPLETE OR NOTHING (2026-11-07): the full-schedule print and its
  // "N shifts" header are built from this list, so a short or failed read
  // must never reach the page. fetchAllRows returns every row or throws; the
  // cash people (printed on the full schedule) are checked too. On a failure
  // the page shows an error instead of a schedule that could print short.
  let readError: string | null = null;
  if (settingIds.length > 0) {
    try {
      const [blocks, cashRes] = await Promise.all([
        fetchAllRows<(typeof allBlocks)[number]>("snack shack shifts", ({ from, to, exactCount }) =>
          supabase
            .from("snack_shack_blocks")
            .select(`id, snack_shack_id, date, start_time, end_time, assigned_team_id, is_recurring, people_needed, team:teams(name), ${SHIFT_NOTE_SELECT_FIELDS}`, exactCount ? { count: "exact" } : undefined)
            .in("snack_shack_id", settingIds)
            .order("date", { ascending: true })
            .order("start_time", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PagedResult<(typeof allBlocks)[number]>>,
        ),
        supabase
          .from("snack_shack_cash_people")
          .select("id, snack_shack_id, name")
          .in("snack_shack_id", settingIds)
          .order("name", { ascending: true }),
      ]);
      if (cashRes.error) throw new Error(`Could not read the cash people: ${cashRes.error.message}`);
      allBlocks = blocks;
      allCashPeople = (cashRes.data as unknown as typeof allCashPeople) ?? [];
    } catch (err) {
      readError = err instanceof Error ? err.message : "Could not read the snack shack shifts.";
    }
  }

  if (readError) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Snack Shack</h1>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Couldn&apos;t load the snack shack shifts.</p>
          <p className="mt-1">{readError}</p>
          <p className="mt-2 text-red-600">
            Nothing is shown rather than a partial list, so a printed schedule
            can&apos;t be missing shifts without saying so. Reload to try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Snack Shack</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage team coverage assignments for the snack shack.
        </p>
      </div>

      <SnackShackPageClient
        seasons={seasons}
        allSettings={allSettings}
        allTeams={allTeams}
        allBlocks={allBlocks}
        allCashPeople={allCashPeople}
        currentOrgId={currentOrgId}
      />
    </div>
  );
}
