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

/** Why a slot couldn't be filled — every candidate was excluded for one of these. */
export type SkipReason = "conflict" | "blackout" | "unavailable" | "weekly_limit";

export type AutoAssignResult = {
  success: boolean;
  filled: number;
  skipped: number; // slots that couldn't be filled
  skipReasons: SkipReason[]; // distinct reasons encountered across skipped slots
  error?: string;
};

type GameRow = {
  id: string;
  scheduled_at: string;
  status: string;
  home_team: {
    division_id: string | null;
    division: {
      id: string;
      umpires_per_game: number;
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

type UmpireRow = { id: string; name: string; max_games_per_week: number | null };

function parseRoles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string");
}

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
 * Skips games whose division has umpires_per_game = 0. For each remaining
 * empty slot, picks the umpire with the fewest current assignments who:
 *   - is not already on this game and has no time overlap with another
 *     assignment anywhere in the season,
 *   - has no blackout date on the game's (local) date,
 *   - is inside one of their weekly availability windows (officials with no
 *     windows recorded count as always available),
 *   - is under their max_games_per_week for the game's Mon–Sun week.
 * Slots that can't be filled are counted as skipped (not an error), with the
 * distinct blocking reasons reported back for the UI.
 *
 * Inserts carry both the role text and the normalized official_roles id
 * (role_id, migration 0062) — missing season roles are created on the fly.
 */
export async function autoAssignUmpires(
  divisionId: string,
  seasonId: string,
): Promise<AutoAssignResult> {
  const supabase = createClient();
  const none = (error?: string): AutoAssignResult => ({
    success: !error,
    filled: 0,
    skipped: 0,
    skipReasons: [],
    error,
  });

  // 1. Load division so we know how many slots per game and the role labels.
  const { data: divisionRaw, error: divisionErr } = await supabase
    .from("divisions")
    .select("id, umpires_per_game, umpire_roles, settings")
    .eq("id", divisionId)
    .single();

  if (divisionErr || !divisionRaw) {
    return none(divisionErr?.message ?? "Division not found.");
  }
  const division = divisionRaw as unknown as {
    umpires_per_game: number;
    umpire_roles: unknown;
    settings: unknown;
  };

  if (division.umpires_per_game === 0) {
    return none();
  }

  const roles = parseRoles(division.umpire_roles);
  // Backfill role labels if the persisted array is shorter than the slot count.
  while (roles.length < division.umpires_per_game) {
    roles.push(`Umpire ${roles.length + 1}`);
  }
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
      `id, scheduled_at, status,
       home_team:teams!home_team_id(division_id, division:divisions(id, umpires_per_game, umpire_roles, settings)),
       away_team:teams!away_team_id(name)`,
    )
    .in("home_team_id", teamIds)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true });

  const divisionGames = ((gamesRaw as unknown as GameRow[] | null) ?? [])
    .filter((g) => g.home_team?.division_id === divisionId);

  if (divisionGames.length === 0) {
    return none();
  }

  // 4. Load every umpire in this season.
  const { data: umpiresRaw, error: umpiresErr } = await supabase
    .from("umpires")
    .select("id, name, max_games_per_week")
    .eq("season_id", seasonId)
    .order("name");
  if (umpiresErr) {
    return none(umpiresErr.message);
  }
  const umpires = (umpiresRaw ?? []) as UmpireRow[];

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
      if (occupiedRoles.has(role)) continue;

      // Find the least-loaded umpire who can take this slot, recording why
      // each candidate was excluded so an unfillable slot can say why.
      const sorted = [...umpires].sort(
        (a, b) => (loadByUmpire.get(a.id) ?? 0) - (loadByUmpire.get(b.id) ?? 0),
      );
      const slotReasons = new Set<SkipReason>();
      let chosen: UmpireRow | null = null;
      for (const candidate of sorted) {
        if (occupiedUmpires.has(candidate.id)) {
          slotReasons.add("conflict");
          continue;
        }
        if (blackoutsByUmpire.get(candidate.id)?.has(gameDateKey)) {
          slotReasons.add("blackout");
          continue;
        }
        if (
          !isWithinAvailability(
            availabilityByUmpire.get(candidate.id) ?? [],
            gameStart,
            divisionDuration,
          )
        ) {
          slotReasons.add("unavailable");
          continue;
        }
        const cap = candidate.max_games_per_week;
        if (
          cap != null &&
          cap > 0 &&
          (weeklyLoad.get(candidate.id)?.get(gameWeek) ?? 0) >= cap
        ) {
          slotReasons.add("weekly_limit");
          continue;
        }
        const bookings = umpireBookings.get(candidate.id) ?? [];
        if (bookings.some((b) => gamesOverlap(candidateInfo, b))) {
          slotReasons.add("conflict");
          continue;
        }
        chosen = candidate;
        break;
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
        skipped,
        skipReasons: Array.from(allSkipReasons),
        error: insertErr.message,
      };
    }
  }

  return {
    success: true,
    filled: inserts.length,
    skipped,
    skipReasons: Array.from(allSkipReasons),
  };
}
