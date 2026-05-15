import { createClient } from "@/lib/supabase/client";
import { DAY_TO_JS_INDEX } from "@/components/snack-shack/wizard-types";
import type { SnackShackWizardData, DayCode } from "@/components/snack-shack/wizard-types";

type Result = { success: boolean; blocksCreated: number; error?: string };

/**
 * Enumerate every calendar date between start and end (inclusive).
 * Dates are YYYY-MM-DD strings.
 */
function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Map JS Date.getDay() (0=Sun) back to DayCode */
const JS_INDEX_TO_DAY: Record<number, DayCode> = {
  0: "Su",
  1: "Mo",
  2: "Tu",
  3: "We",
  4: "Th",
  5: "Fr",
  6: "Sa",
};

export async function generateSnackShackSchedule(
  snackShackId: string,
  leagueId: string,
  data: SnackShackWizardData,
): Promise<Result> {
  const supabase = createClient();

  // 1. Load all teams in the season
  const { data: teamsRaw, error: teamsErr } = await supabase
    .from("teams")
    .select("id, name")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });

  if (teamsErr) return { success: false, blocksCreated: 0, error: teamsErr.message };

  const teams = (teamsRaw ?? []) as { id: string; name: string }[];
  if (teams.length === 0) {
    return { success: false, blocksCreated: 0, error: "No teams found in this season." };
  }

  // 2. Load blackout dates
  const { data: blackoutsRaw } = await supabase
    .from("blackout_dates")
    .select("date")
    .eq("league_id", leagueId);

  const blackoutSet = new Set(
    ((blackoutsRaw ?? []) as { date: string }[]).map((b) => b.date),
  );

  // 3. Load all games in the season for preference logic
  const { data: gamesRaw } = await supabase
    .from("games")
    .select("home_team_id, away_team_id, venue_id, scheduled_at")
    .eq("league_id", leagueId)
    .neq("status", "cancelled");

  type GameRow = {
    home_team_id: string;
    away_team_id: string;
    venue_id: string | null;
    scheduled_at: string;
  };
  const games = (gamesRaw ?? []) as GameRow[];

  // Build: date → Set of home_team_ids at a home_venue
  const homeGamesByDate = new Map<string, Set<string>>();
  // Build: date → Set of all team_ids playing (any game)
  const anyGameByDate = new Map<string, Set<string>>();

  const homeVenueSet = new Set(data.home_venue_ids);

  for (const g of games) {
    const date = g.scheduled_at.substring(0, 10);

    // home games at home venues
    if (g.venue_id && homeVenueSet.has(g.venue_id)) {
      if (!homeGamesByDate.has(date)) homeGamesByDate.set(date, new Set());
      homeGamesByDate.get(date)!.add(g.home_team_id);
    }

    // any game (home or away)
    if (!anyGameByDate.has(date)) anyGameByDate.set(date, new Set());
    anyGameByDate.get(date)!.add(g.home_team_id);
    anyGameByDate.get(date)!.add(g.away_team_id);
  }

  // 4. Walk through all dates and assign blocks
  const dates = enumerateDates(data.start_date, data.end_date);
  const enabledDaySet = new Set(data.days_of_week);

  // Assignment count per team (for round-robin equity)
  const assignmentCount: Record<string, number> = {};
  for (const t of teams) assignmentCount[t.id] = 0;

  type BlockInsert = {
    snack_shack_id: string;
    date: string;
    start_time: string;
    end_time: string;
    assigned_team_id: string;
    is_recurring: boolean;
  };

  const blocks: BlockInsert[] = [];

  for (const date of dates) {
    if (blackoutSet.has(date)) continue;

    const jsDay = new Date(date + "T12:00:00").getDay();
    const dayCode = JS_INDEX_TO_DAY[jsDay];
    if (!enabledDaySet.has(dayCode)) continue;

    const dayBlocks = data.time_blocks_by_day[dayCode] ?? [];
    if (dayBlocks.length === 0) continue;

    for (const block of dayBlocks) {
      // Find the minimum assignment count
      const minCount = Math.min(...teams.map((t) => assignmentCount[t.id]));
      let candidates = teams.filter((t) => assignmentCount[t.id] === minCount);

      // Apply scheduling preference
      if (data.scheduling_preference === "prefer_game_days") {
        const homeTeamsOnDate = homeGamesByDate.get(date) ?? new Set();
        const preferred = candidates.filter((t) => homeTeamsOnDate.has(t.id));
        if (preferred.length > 0) candidates = preferred;
      } else {
        const busyTeamsOnDate = anyGameByDate.get(date) ?? new Set();
        const preferred = candidates.filter((t) => !busyTeamsOnDate.has(t.id));
        if (preferred.length > 0) candidates = preferred;
      }

      // Deterministic: pick first alphabetically (already sorted by name)
      const picked = candidates[0];
      assignmentCount[picked.id]++;

      blocks.push({
        snack_shack_id: snackShackId,
        date,
        start_time: block.start,
        end_time: block.end,
        assigned_team_id: picked.id,
        is_recurring: true,
      });
    }
  }

  if (blocks.length === 0) {
    return { success: true, blocksCreated: 0 };
  }

  // Batch insert in chunks of 500 to stay under Supabase row limits
  const CHUNK = 500;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const chunk = blocks.slice(i, i + CHUNK);
    const { error: insertErr } = await supabase
      .from("snack_shack_blocks")
      .insert(chunk as never[]);
    if (insertErr) {
      return { success: false, blocksCreated: i, error: insertErr.message };
    }
  }

  return { success: true, blocksCreated: blocks.length };
}
