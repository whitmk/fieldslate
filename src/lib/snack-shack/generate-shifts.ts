// The I/O wrapper for derived snack shack shifts: loads everything the pure
// library needs, hands back a plan (the preview), and commits a plan through
// the atomic RPC. No rule lives here — see derive-shifts.ts and
// regenerate-plan.ts; anything decided in this file is a decision the harness
// cannot see.
//
// EVERY READ FAILS LOUD. The old generator discarded its read errors and
// generated against empty maps; this one throws, and the page shows the
// error instead of a confident, wrong preview. The games read goes through
// fetchAllRows (complete-or-throw) because a row lost to PostgREST's silent
// 1000-row cap is a game the shack would not open for.

import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { DEFAULT_ORG_TIMEZONE } from "@/lib/calendar/timezones";
import type { DayKey } from "@/lib/venues/availability";
import { planSettingsFromDivision } from "@/lib/playoffs/bracket-plan";
import {
  assignmentGamesFromPlayoffRows,
  assignmentGamesFromRows,
  assignmentIndexFromGames,
  deriveShifts,
  resolveGameDurations,
  type AssignmentIndex,
  type DerivationResult,
  type PickTeam,
  type SchedulingPreference,
  type ShiftRule,
  type StoredAbsorbChoice,
  type StoredShiftRow,
} from "./derive-shifts";
import {
  buildRegeneratePlan,
  todayInTimezone,
  type RegeneratePlan,
  type RpcShift,
} from "./regenerate-plan";

/** The settings columns the wrapper reads (0027 + 0103). */
export type SnackShackSettingsInput = {
  id: string;
  season_id: string;
  days_of_week: unknown;
  home_venue_ids: unknown;
  scheduling_preference: string;
  open_before_min: number;
  close_after_min: number;
  max_shift_min: number;
  shifts_generated_at: string | null;
};

export function ruleFromSettings(s: SnackShackSettingsInput): ShiftRule {
  const days = Array.isArray(s.days_of_week) ? (s.days_of_week as unknown[]).filter((d): d is DayKey => typeof d === "string") : [];
  const venues = Array.isArray(s.home_venue_ids) ? (s.home_venue_ids as unknown[]).filter((v): v is string => typeof v === "string") : [];
  return {
    openBeforeMin: Number(s.open_before_min),
    closeAfterMin: Number(s.close_after_min),
    maxShiftMin: Number(s.max_shift_min),
    daysOpen: days,
    homeVenueIds: venues,
  };
}

export type ShiftInputs = {
  rule: ShiftRule;
  derivation: DerivationResult;
  stored: StoredShiftRow[];
  teams: PickTeam[];
  /** Every game a team plays this season, regular AND playoff, by team and
   *  date — what the assignment's hard rule and preferences read. */
  index: AssignmentIndex;
  preference: SchedulingPreference;
  choices: StoredAbsorbChoice[];
  timezone: string;
  today: string;
};

type GameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string | null;
  venue: { name: string } | null;
  home_team: { division: { game_duration: unknown } | null } | null;
};

const GAME_COLS =
  "id, scheduled_at, status, venue_id, home_team_id, away_team_id, venue:venues(name), " +
  "home_team:teams!home_team_id(division:divisions(game_duration:settings->game_duration))";

type PlayoffGameRow = {
  id: string;
  scheduled_date: string | null;
  start_time: string | null;
  status: string;
  venue_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  division: { game_duration: unknown } | null;
};

/** Playoff games are a parallel table (they never open the shack — the
 *  derivation reads `games` only) but a team playing one is busy, so the
 *  assignment index reads them. Only rows with a date are on the calendar. */
const PLAYOFF_COLS =
  "id, scheduled_date, start_time, status, venue_id, home_team_id, away_team_id, " +
  "division:divisions(game_duration:settings->game_duration)";

/** Loads everything and derives. Throws on any read error. */
export async function loadShiftInputs(settings: SnackShackSettingsInput, orgId: string): Promise<ShiftInputs> {
  const supabase = createClient();
  const rule = ruleFromSettings(settings);

  const [teamsRes, choicesRes, tzRes] = await Promise.all([
    supabase.from("teams").select("id, name").eq("league_id", settings.season_id).order("name"),
    supabase.from("snack_shack_absorb_choices").select("date, window_start, choice").eq("snack_shack_id", settings.id),
    supabase.from("profiles").select("timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (teamsRes.error) throw new Error(`Could not load teams: ${teamsRes.error.message}`);
  if (choicesRes.error) throw new Error(`Could not load leftover choices: ${choicesRes.error.message}`);
  if (tzRes.error) throw new Error(`Could not load the org timezone: ${tzRes.error.message}`);

  const games = await fetchAllRows<GameRow>(
    "this season's games",
    ({ from, to, exactCount }) =>
      supabase
        .from("games")
        .select(GAME_COLS, exactCount ? { count: "exact" } : undefined)
        .eq("league_id", settings.season_id)
        .order("scheduled_at")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: GameRow[] | null; error: { message: string } | null; count?: number | null }>,
  );
  const playoffRows = await fetchAllRows<PlayoffGameRow>(
    "this season's playoff games",
    ({ from, to, exactCount }) =>
      supabase
        .from("playoff_games")
        .select(PLAYOFF_COLS, exactCount ? { count: "exact" } : undefined)
        .eq("league_id", settings.season_id)
        .not("scheduled_date", "is", null)
        .order("scheduled_date")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: PlayoffGameRow[] | null; error: { message: string } | null; count?: number | null }>,
  );
  const stored = await fetchAllRows<StoredShiftRow>(
    "snack shack shifts",
    ({ from, to, exactCount }) =>
      supabase
        .from("snack_shack_blocks")
        .select("id, date, start_time, end_time, assigned_team_id, is_recurring, notes, cash_person_id", exactCount ? { count: "exact" } : undefined)
        .eq("snack_shack_id", settings.id)
        .order("date")
        .order("start_time")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: StoredShiftRow[] | null; error: { message: string } | null; count?: number | null }>,
  );

  const timezone = (tzRes.data as { timezone: string | null } | null)?.timezone ?? DEFAULT_ORG_TIMEZONE;
  const today = todayInTimezone(timezone);
  const choices = ((choicesRes.data ?? []) as { date: string; window_start: string; choice: string }[])
    .filter((c) => c.choice === "first" || c.choice === "last" || c.choice === "split")
    .map((c) => ({ date: c.date, windowStart: c.window_start.substring(0, 5), choice: c.choice as StoredAbsorbChoice["choice"] }));

  const derivationGames = resolveGameDurations(
    games.map((g) => ({
      id: g.id,
      scheduled_at: g.scheduled_at,
      status: g.status,
      venue_id: g.venue_id,
      venue_name: g.venue?.name ?? null,
      game_duration: g.home_team?.division?.game_duration,
    })),
  );
  const derivation = deriveShifts(derivationGames, rule, choices);
  const durationById = new Map(derivationGames.map((g) => [g.id, g.durationMin]));
  const index = assignmentIndexFromGames(
    [
      ...assignmentGamesFromRows(
        games.map((g) => ({
          home_team_id: g.home_team_id,
          away_team_id: g.away_team_id,
          venue_id: g.venue_id,
          scheduled_at: g.scheduled_at,
          status: g.status,
          durationMin: durationById.get(g.id) ?? 90,
        })),
      ),
      ...assignmentGamesFromPlayoffRows(
        playoffRows.map((p) => ({
          home_team_id: p.home_team_id,
          away_team_id: p.away_team_id,
          venue_id: p.venue_id,
          scheduled_date: p.scheduled_date,
          start_time: p.start_time,
          status: p.status,
          durationMin: planSettingsFromDivision({ game_duration: p.division?.game_duration }).durationMin,
        })),
      ),
    ],
    rule.homeVenueIds,
  );
  const preference: SchedulingPreference = settings.scheduling_preference === "prefer_game_days" ? "prefer_game_days" : "prefer_off_days";

  return {
    rule,
    derivation,
    stored,
    teams: (teamsRes.data ?? []) as PickTeam[],
    index,
    preference,
    choices,
    timezone,
    today,
  };
}

export function planFromInputs(inputs: ShiftInputs): RegeneratePlan {
  return buildRegeneratePlan({
    derivation: inputs.derivation,
    stored: inputs.stored,
    teams: inputs.teams,
    preference: inputs.preference,
    index: inputs.index,
    today: inputs.today,
  });
}

export type RegenerateResult = {
  kept: number;
  created: number;
  removed: number;
  removed_assignments: { date: string; start: string; end: string; team_id: string }[];
  created_shifts: { date: string; start: string; end: string; team_id: string | null }[];
  /** 0104 */
  carried: number;
  lost: { date: string; start: string; end: string; notes: string | null; cash_person_id: string | null }[];
};

/** Writes the plan through the atomic RPC. Throws on refusal. */
export async function commitRegenerate(settingsId: string, desired: RpcShift[]): Promise<RegenerateResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    // @ts-expect-error — RPC isn't in generated types (0103); the Functions map is
    // kept empty on purpose (a real entry re-types every other rpc() call).
    "regenerate_snack_shack_shifts",
    { p_snack_shack_id: settingsId, p_shifts: desired },
  );
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Partial<RegenerateResult>;
  return {
    kept: Number(r.kept ?? 0),
    created: Number(r.created ?? 0),
    removed: Number(r.removed ?? 0),
    removed_assignments: r.removed_assignments ?? [],
    created_shifts: r.created_shifts ?? [],
    carried: Number(r.carried ?? 0),
    lost: r.lost ?? [],
  };
}

/** The activity-log line for a regenerate. */
export function regenerateLogMessage(r: RegenerateResult, frozenPast: number): string {
  const parts = [`${r.created} added`, `${r.removed} removed`, `${r.kept} kept`];
  if (frozenPast > 0) parts.push(`${frozenPast} past shift${frozenPast === 1 ? "" : "s"} left as they were`);
  if (r.carried > 0) parts.push(`${r.carried} note${r.carried === 1 ? "" : "s"}/cash carried to a changed shift`);
  if (r.lost.length > 0) parts.push(`${r.lost.length} note${r.lost.length === 1 ? "" : "s"}/cash on removed shifts dropped`);
  return `Snack shack shifts regenerated from the game schedule — ${parts.join(", ")}.`;
}
