import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_GAME_DURATION_MINS,
  gamesOverlap,
  type GameTimeInfo,
} from "./conflicts";
import {
  isWithinAvailability,
  localDateKey,
  weekKey,
  type AvailabilityWindow,
} from "./eligibility";
import { ensureSeasonRoleIds } from "./roles";
import { padRoleLabels } from "@/lib/utils/official-title";

/**
 * Why a slot couldn't be filled. Only the HARD constraints can empty a slot:
 * availability windows and weekly caps are soft (the fallback tier ignores
 * them), so a skip always means every candidate was double-booked, blacked
 * out, coaching a team in the game, or listed with a conflict of interest
 * (official_conflicts, 0073) on one of its teams.
 */
export type SkipReason =
  | "conflict"
  | "blackout"
  | "coach_conflict"
  | "conflict_of_interest";

/**
 * The Supabase client surface the engine runs against. Production callers
 * omit the parameter (browser client); the simulation harness
 * (scripts/sim/auto-assign-season-sim.ts) injects an in-memory fake so the
 * real selection logic can be exercised against generated fixtures.
 */
export type AutoAssignClient = ReturnType<typeof createClient>;

export type AutoAssignResult = {
  success: boolean;
  filled: number;
  fallbackFilled: number; // subset of filled that ignored availability/weekly caps
  skipped: number; // slots that couldn't be filled
  skipReasons: SkipReason[]; // distinct reasons encountered across skipped slots
  error?: string;
};

type GameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team: {
    division_id: string | null;
    division: {
      id: string;
      umpires_per_game: number;
      priority: number;
      umpire_roles: unknown;
      settings: unknown;
    } | null;
  } | null;
  away_team: { name: string } | null;
};

type AssignmentRow = {
  id: string;
  game_id: string;
  umpire_id: string;
  role: string;
};

type UmpireRow = {
  id: string;
  name: string;
  max_games_per_week: number | null;
  team_id: string | null;
  /** Conflict-of-interest links (0073) — hard block, same as the coach link. */
  conflicts: { team_id: string; relationship: string }[] | null;
};

function gameDuration(settings: unknown): number {
  if (settings && typeof settings === "object" && "game_duration" in settings) {
    const v = (settings as { game_duration?: unknown }).game_duration;
    if (typeof v === "number") return v;
  }
  return DEFAULT_GAME_DURATION_MINS;
}

/**
 * Fill empty umpire slots across all games in a division.
 *
 * Skips games whose division has umpires_per_game = 0. Role labels come from
 * the season's normalized official_roles list (sort_order, first
 * umpires_per_game), padded with sport-aware fallbacks — the same derivation
 * the slot UIs use.
 *
 * Best-effort, two-tier selection per empty slot (least-loaded first):
 *   Tier 1: not on this game, no time overlap, no blackout, not coaching a
 *           team in the game, inside an availability window (no windows =
 *           always available), and under max_games_per_week for the game's
 *           Mon–Sun week.
 *   Tier 2: if nobody fully qualifies, availability windows and weekly caps
 *           go soft — an empty slot is worse than an over-cap official the
 *           commissioner can swap later. Blackouts, coach conflicts,
 *           double-booking, and time overlap stay HARD: an official who
 *           marked a date unavailable or coaches a team in the game is
 *           never assigned.
 * Slots that still can't be filled are counted as skipped (not an error),
 * with the distinct blocking reasons reported back for the UI.
 *
 * Inserts carry both the role text and the normalized official_roles id
 * (role_id, migration 0062) — missing season roles are created on the fly.
 */
export async function autoAssignUmpires(
  divisionId: string,
  seasonId: string,
  client?: AutoAssignClient,
): Promise<AutoAssignResult> {
  const supabase = client ?? createClient();
  const none = (error?: string): AutoAssignResult => ({
    success: !error,
    filled: 0,
    fallbackFilled: 0,
    skipped: 0,
    skipReasons: [],
    error,
  });

  // 1. Load division (slot count + duration), league sport (padding labels),
  //    and the season's normalized role list.
  const [
    { data: divisionRaw, error: divisionErr },
    { data: leagueRaw },
    { data: seasonRolesRaw },
  ] = await Promise.all([
    supabase
      .from("divisions")
      .select("id, umpires_per_game, settings")
      .eq("id", divisionId)
      .single(),
    supabase.from("leagues").select("sport").eq("id", seasonId).single(),
    supabase
      .from("official_roles")
      .select("id, name")
      .eq("season_id", seasonId)
      .order("sort_order"),
  ]);

  if (divisionErr || !divisionRaw) {
    return none(divisionErr?.message ?? "Division not found.");
  }
  const division = divisionRaw as unknown as {
    umpires_per_game: number;
    settings: unknown;
  };

  if (division.umpires_per_game === 0) {
    return none();
  }

  const sport = (leagueRaw as { sport: string | null } | null)?.sport ?? null;
  const seasonRoleNames = ((seasonRolesRaw ?? []) as { id: string; name: string }[])
    .map((r) => r.name);
  const roles = padRoleLabels(
    seasonRoleNames.slice(0, division.umpires_per_game),
    division.umpires_per_game,
    sport,
  );
  const divisionDuration = gameDuration(division.settings);

  // 2. Load teams in this division so we can target games whose home_team belongs to it.
  const { data: teamData } = await supabase
    .from("teams")
    .select("id")
    .eq("division_id", divisionId);
  const teamIds = ((teamData ?? []) as { id: string }[]).map((t) => t.id);

  if (teamIds.length === 0) {
    return none();
  }

  // 3. Load every game in this division (active only).
  const { data: gamesRaw } = await supabase
    .from("games")
    .select(
      `id, scheduled_at, status, home_team_id, away_team_id,
       home_team:teams!home_team_id(division_id, division:divisions(id, umpires_per_game, priority, umpire_roles, settings)),
       away_team:teams!away_team_id(name)`,
    )
    .in("home_team_id", teamIds)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true });

  // Division priority (0063): lower number = assigned first, so
  // higher-priority divisions get first pick of officials. Within a
  // single-division run every game shares one priority — the sort matters
  // if this ever spans divisions; the stable sort keeps time order within
  // equal priority either way.
  const divisionGames = ((gamesRaw as unknown as GameRow[] | null) ?? [])
    .filter((g) => g.home_team?.division_id === divisionId)
    .sort(
      (a, b) =>
        (a.home_team?.division?.priority ?? 0) -
        (b.home_team?.division?.priority ?? 0),
    );

  if (divisionGames.length === 0) {
    return none();
  }

  // 4. Load every umpire in this season.
  const { data: umpiresRaw, error: umpiresErr } = await supabase
    .from("umpires")
    .select(
      "id, name, max_games_per_week, team_id, conflicts:official_conflicts(team_id, relationship)",
    )
    .eq("season_id", seasonId)
    .order("name");
  if (umpiresErr) {
    return none(umpiresErr.message);
  }
  const umpires = (umpiresRaw ?? []) as unknown as UmpireRow[];

  if (umpires.length === 0) {
    return none();
  }

  // 5. Load every existing game_umpires row for these umpires across the season,
  //    so we can detect overlap with games in other divisions too. Alongside,
  //    pull each umpire's availability windows and blackout dates (0062) and
  //    resolve the normalized role ids for this division's role labels.
  const umpireIds = umpires.map((u) => u.id);
  type ExistingRow = {
    id: string;
    game_id: string;
    umpire_id: string;
    role: string;
    game: {
      id: string;
      scheduled_at: string;
      status: string;
      home_team:
        | { division: { settings: unknown } | null }
        | null;
    } | null;
  };
  const [
    { data: existingRaw },
    { data: availabilityRaw },
    { data: blackoutsRaw },
    roleIdByName,
  ] = await Promise.all([
    supabase
      .from("game_umpires")
      .select(
        `id, game_id, umpire_id, role,
         game:games(
           id, scheduled_at, status,
           home_team:teams!home_team_id(division:divisions(settings))
         )`,
      )
      .in("umpire_id", umpireIds),
    supabase
      .from("official_availability")
      .select("umpire_id, day_of_week, start_time, end_time")
      .in("umpire_id", umpireIds),
    supabase
      .from("official_blackouts")
      .select("umpire_id, date")
      .in("umpire_id", umpireIds),
    ensureSeasonRoleIds(supabase, seasonId, roles),
  ]);

  const existing = ((existingRaw as unknown as ExistingRow[] | null) ?? []).filter(
    (r) => r.game && r.game.status !== "cancelled",
  );

  const availabilityByUmpire = new Map<string, AvailabilityWindow[]>();
  for (const a of (availabilityRaw ?? []) as ({ umpire_id: string } & AvailabilityWindow)[]) {
    if (!availabilityByUmpire.has(a.umpire_id)) availabilityByUmpire.set(a.umpire_id, []);
    availabilityByUmpire.get(a.umpire_id)!.push(a);
  }

  const blackoutsByUmpire = new Map<string, Set<string>>();
  for (const b of (blackoutsRaw ?? []) as { umpire_id: string; date: string }[]) {
    if (!blackoutsByUmpire.has(b.umpire_id)) blackoutsByUmpire.set(b.umpire_id, new Set());
    blackoutsByUmpire.get(b.umpire_id)!.add(b.date);
  }

  // Build: umpire_id → list of GameTimeInfo they're already booked on, plus a
  // per-week assignment count for the max_games_per_week cap.
  const umpireBookings = new Map<string, GameTimeInfo[]>();
  const weeklyLoad = new Map<string, Map<string, number>>();
  for (const u of umpires) {
    umpireBookings.set(u.id, []);
    weeklyLoad.set(u.id, new Map());
  }
  for (const e of existing) {
    if (!e.game) continue;
    const dur = gameDuration(e.game.home_team?.division?.settings);
    umpireBookings.get(e.umpire_id)!.push({
      id: e.game.id,
      scheduled_at: e.game.scheduled_at,
      duration_minutes: dur,
      home_team_name: "",
      away_team_name: "",
    });
    const wk = weekKey(new Date(e.game.scheduled_at));
    const weeks = weeklyLoad.get(e.umpire_id)!;
    weeks.set(wk, (weeks.get(wk) ?? 0) + 1);
  }

  // 6. Per-game slot occupancy across the division being assigned.
  type DivAssignment = AssignmentRow;
  const divisionGameIds = divisionGames.map((g) => g.id);
  const { data: divAssignsRaw } = await supabase
    .from("game_umpires")
    .select("id, game_id, umpire_id, role")
    .in("game_id", divisionGameIds);
  const divAssigns = (divAssignsRaw ?? []) as DivAssignment[];

  const filledRolesByGame = new Map<string, Set<string>>();
  const umpiresOnGame = new Map<string, Set<string>>();
  for (const g of divisionGames) {
    filledRolesByGame.set(g.id, new Set());
    umpiresOnGame.set(g.id, new Set());
  }
  for (const a of divAssigns) {
    filledRolesByGame.get(a.game_id)?.add(a.role);
    umpiresOnGame.get(a.game_id)?.add(a.umpire_id);
  }

  // 7. Running load count to keep distribution even.
  const loadByUmpire = new Map<string, number>();
  for (const u of umpires) loadByUmpire.set(u.id, 0);
  for (const e of existing) {
    loadByUmpire.set(e.umpire_id, (loadByUmpire.get(e.umpire_id) ?? 0) + 1);
  }

  // 8. Walk each empty slot, pick the least-loaded umpire that fits.
  const inserts: {
    game_id: string;
    umpire_id: string;
    role: string;
    role_id: string | null;
  }[] = [];
  let skipped = 0;
  let fallbackFilled = 0;
  const allSkipReasons = new Set<SkipReason>();

  for (const g of divisionGames) {
    const gameStart = new Date(g.scheduled_at);
    const gameDateKey = localDateKey(gameStart);
    const gameWeek = weekKey(gameStart);
    const candidateInfo: GameTimeInfo = {
      id: g.id,
      scheduled_at: g.scheduled_at,
      duration_minutes: divisionDuration,
      home_team_name: "",
      away_team_name: "",
    };
    const occupiedRoles = filledRolesByGame.get(g.id) ?? new Set();
    const occupiedUmpires = umpiresOnGame.get(g.id) ?? new Set();

    for (const role of roles) {
      // Legacy assignments may use role text outside the current season
      // list, so occupiedRoles alone can't see them — cap on total bodies
      // per game so those games don't get over-staffed.
      if (occupiedUmpires.size >= division.umpires_per_game) break;
      if (occupiedRoles.has(role)) continue;

      const sorted = [...umpires].sort(
        (a, b) => (loadByUmpire.get(a.id) ?? 0) - (loadByUmpire.get(b.id) ?? 0),
      );
      const slotReasons = new Set<SkipReason>();

      // Least-loaded umpire who passes the hard constraints (always) and the
      // soft ones (strict tier only). Only hard blockers are recorded — if
      // the slot ends up empty, they're the reasons why.
      const pick = (strict: boolean): UmpireRow | null => {
        for (const candidate of sorted) {
          if (occupiedUmpires.has(candidate.id)) {
            slotReasons.add("conflict");
            continue;
          }
          if (blackoutsByUmpire.get(candidate.id)?.has(gameDateKey)) {
            slotReasons.add("blackout");
            continue;
          }
          // Coach conflict (0063): an official never works a game involving
          // the team they coach — hard at both tiers, same as blackouts.
          if (
            candidate.team_id &&
            (candidate.team_id === g.home_team_id ||
              candidate.team_id === g.away_team_id)
          ) {
            slotReasons.add("coach_conflict");
            continue;
          }
          // Conflict of interest (0073): parent/sibling/family/other link to
          // a team in the game — hard at both tiers, same as the coach link.
          if (
            (candidate.conflicts ?? []).some(
              (c) =>
                c.team_id === g.home_team_id ||
                (g.away_team_id != null && c.team_id === g.away_team_id),
            )
          ) {
            slotReasons.add("conflict_of_interest");
            continue;
          }
          if (strict) {
            if (
              !isWithinAvailability(
                availabilityByUmpire.get(candidate.id) ?? [],
                gameStart,
                divisionDuration,
              )
            ) {
              continue;
            }
            const cap = candidate.max_games_per_week;
            if (
              cap != null &&
              cap > 0 &&
              (weeklyLoad.get(candidate.id)?.get(gameWeek) ?? 0) >= cap
            ) {
              continue;
            }
          }
          const bookings = umpireBookings.get(candidate.id) ?? [];
          if (bookings.some((b) => gamesOverlap(candidateInfo, b))) {
            slotReasons.add("conflict");
            continue;
          }
          return candidate;
        }
        return null;
      };

      let chosen = pick(true);
      if (!chosen) {
        chosen = pick(false);
        if (chosen) fallbackFilled++;
      }

      if (!chosen) {
        skipped++;
        for (const r of slotReasons) allSkipReasons.add(r);
        continue;
      }

      inserts.push({
        game_id: g.id,
        umpire_id: chosen.id,
        role,
        role_id: roleIdByName.get(role.trim()) ?? null,
      });
      occupiedRoles.add(role);
      occupiedUmpires.add(chosen.id);
      umpireBookings.get(chosen.id)!.push(candidateInfo);
      loadByUmpire.set(chosen.id, (loadByUmpire.get(chosen.id) ?? 0) + 1);
      const weeks = weeklyLoad.get(chosen.id)!;
      weeks.set(gameWeek, (weeks.get(gameWeek) ?? 0) + 1);
    }
  }

  // 9. Bulk insert.
  if (inserts.length > 0) {
    const { error: insertErr } = await supabase
      .from("game_umpires")
      .insert(inserts as never[]);
    if (insertErr) {
      return {
        success: false,
        filled: 0,
        fallbackFilled: 0,
        skipped,
        skipReasons: Array.from(allSkipReasons),
        error: insertErr.message,
      };
    }
  }

  return {
    success: true,
    filled: inserts.length,
    fallbackFilled,
    skipped,
    skipReasons: Array.from(allSkipReasons),
  };
}
