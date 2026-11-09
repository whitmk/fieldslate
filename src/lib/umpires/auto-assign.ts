import { createClient } from "@/lib/supabase/client";
import { DEFAULT_GAME_DURATION_MINS } from "./conflicts";
import { type AvailabilityWindow } from "./eligibility";
import { blockReason, type Booking } from "./claim-rules";
import { ensureSeasonRoleIds } from "./roles";
import { padRoleLabels } from "@/lib/utils/official-title";
import { isBeforeToday, todayInTimezone } from "@/lib/utils/org-today";

/**
 * Why a slot couldn't be filled. Double-booked, blacked out, coaching a
 * team in the game, or a listed conflict of interest (official_conflicts,
 * 0073) are hard constraints; availability windows and weekly caps block a
 * slot just as absolutely — an assignment outside an official's stated
 * availability is a commitment they never made, and the engine NEVER makes
 * one (there is no opt-out; removed 2026-07-21). Slots blocked only by
 * "outside_availability" / "over_weekly_limit" stay open and are reported
 * with the officials' names so the admin can ask them first, then assign
 * manually from the game.
 */
export type SkipReason =
  | "conflict"
  | "blackout"
  | "coach_conflict"
  | "conflict_of_interest"
  | "outside_availability"
  | "over_weekly_limit"
  /** 0124: the official has a division list without this division. */
  | "division_not_allowed";

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
  skipped: number; // slots that couldn't be filled
  skipReasons: SkipReason[]; // distinct reasons encountered across skipped slots
  /** Distinct officials who, on at least one skipped slot, were blocked ONLY
   *  by their availability windows — the "ask them first" list. */
  outsideAvailabilityNames: string[];
  /** Same, blocked only by their weekly cap. */
  overWeeklyLimitNames: string[];
  /** Games in the division dated BEFORE today (league timezone) — never
   *  staffed by auto-assign. Their existing assignments still count. */
  pastGamesSkipped: number;
  /** Picks the database refused at write time because the slot or the
   *  official had been taken meanwhile (an official's own claim, another
   *  run) — insert_official_assignments re-checks every row under lock. */
  takenMeanwhile: number;
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
 * Best-effort selection per empty slot (least-loaded first): not on this
 * game, no time overlap, no blackout, not coaching a team in the game, no
 * conflict of interest, inside an availability window (no windows = always
 * available), and under max_games_per_week for the game's Mon–Sun week.
 * A slot nobody qualifies for stays OPEN — there is no relaxation tier and
 * no opt-out (removed 2026-07-21): an assignment outside stated
 * availability or over a weekly cap is a commitment the official never
 * made, so the admin asks them first and assigns manually (the picker's
 * "outside listed availability" state).
 * Slots that can't be filled are counted as skipped (not an error), with
 * the distinct blocking reasons — and the names of officials excluded only
 * by availability/caps — reported back for the UI.
 *
 * Inserts carry both the role text and the normalized official_roles id
 * (role_id, migration 0062) — missing season roles are created on the fly.
 */
export async function autoAssignUmpires(
  divisionId: string,
  seasonId: string,
  client?: AutoAssignClient,
  /** "Now" — for the simulation harnesses ONLY, so fixtures can sit at a
   *  fixed date. Production callers omit it. */
  now: Date = new Date(),
): Promise<AutoAssignResult> {
  const supabase = client ?? createClient();
  let pastGamesSkipped = 0;
  // EVERY READ THAT DECIDES WHO MAY TAKE A SLOT FAILS CLOSED (2026-11-06).
  // Before, a failed bookings read meant "everyone is free" (double-booking),
  // a failed availability read meant "no windows = available anytime"
  // (assigning outside stated availability), a failed blackouts read meant
  // "no blackouts", and a failed read of this division's assignments made
  // every slot look open. Each now refuses the whole run with nothing written.
  const unreadable = (what: string) =>
    none(`Couldn't read ${what}, so no officials were assigned. Try again.`);
  const none = (error?: string): AutoAssignResult => ({
    success: !error,
    filled: 0,
    skipped: 0,
    skipReasons: [],
    outsideAvailabilityNames: [],
    overWeeklyLimitNames: [],
    pastGamesSkipped,
    takenMeanwhile: 0,
    error,
  });

  // 1. Load division (slot count + duration), league sport (padding labels),
  //    and the season's normalized role list.
  const [
    { data: divisionRaw, error: divisionErr },
    { data: leagueRaw, error: leagueErr },
    { data: seasonRolesRaw, error: seasonRolesErr },
  ] = await Promise.all([
    supabase
      .from("divisions")
      .select("id, umpires_per_game, settings")
      .eq("id", divisionId)
      .single(),
    supabase.from("leagues").select("sport, owner_id").eq("id", seasonId).single(),
    supabase
      .from("official_roles")
      .select("id, name")
      .eq("season_id", seasonId)
      // Sort order, then name — the same slot order the database uses for
      // officials' own claims (official_division_slots, 0124).
      .order("sort_order")
      .order("name"),
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
  if (leagueErr) return unreadable("this season");
  // A failed role read would otherwise pad to "Umpire 1"… and write those
  // labels as the slots' role text.
  if (seasonRolesErr) return unreadable("this season's official roles");

  const league = leagueRaw as { sport: string | null; owner_id: string } | null;
  const sport = league?.sport ?? null;

  // PAST GAMES ARE NEVER STAFFED (2026-10-08). A game dated before today in
  // the LEAGUE's timezone has been played (or rained out and since recorded
  // elsewhere — "Record where it was played" turns a past rainout back into a
  // scheduled game, which would otherwise make it fair game here). "Today" is
  // the shared rule in src/lib/utils/org-today.ts: the wall-clock date part
  // of scheduled_at against today in profiles.timezone. FAILS CLOSED: if the
  // timezone can't be read, nothing is assigned — guessing a day could staff
  // a played game.
  const { data: profileRaw, error: profileErr } = league?.owner_id
    ? await supabase.from("profiles").select("timezone").eq("id", league.owner_id).single()
    : { data: null, error: null };
  const timezone = (profileRaw as { timezone: string } | null)?.timezone;
  let today: string;
  try {
    if (profileErr || !timezone) throw new Error("no timezone");
    today = todayInTimezone(timezone, now);
  } catch {
    return none("Couldn't read your league's timezone, so no officials were assigned.");
  }
  const seasonRoleNames = ((seasonRolesRaw ?? []) as { id: string; name: string }[])
    .map((r) => r.name);
  const roles = padRoleLabels(
    seasonRoleNames.slice(0, division.umpires_per_game),
    division.umpires_per_game,
    sport,
  );
  const divisionDuration = gameDuration(division.settings);

  // 2. Load teams in this division so we can target games whose home_team belongs to it.
  const { data: teamData, error: teamsErr } = await supabase
    .from("teams")
    .select("id")
    .eq("division_id", divisionId);
  if (teamsErr) return unreadable("this division's teams");
  const teamIds = ((teamData ?? []) as { id: string }[]).map((t) => t.id);

  if (teamIds.length === 0) {
    return none();
  }

  // 3. Load every game in this division (active only).
  const { data: gamesRaw, error: gamesErr } = await supabase
    .from("games")
    .select(
      `id, scheduled_at, status, home_team_id, away_team_id,
       home_team:teams!home_team_id(division_id, division:divisions(id, umpires_per_game, priority, umpire_roles, settings)),
       away_team:teams!away_team_id(name)`,
    )
    .in("home_team_id", teamIds)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true });
  if (gamesErr) return unreadable("this division's games");

  // Division priority (0063): lower number = assigned first, so
  // higher-priority divisions get first pick of officials. Within a
  // single-division run every game shares one priority — the sort matters
  // if this ever spans divisions; the stable sort keeps time order within
  // equal priority either way.
  const inDivision = ((gamesRaw as unknown as GameRow[] | null) ?? [])
    .filter((g) => g.home_team?.division_id === divisionId);
  // Only the SLOT WALK skips past games. Bookings and weekly load (step 5)
  // are built from every existing assignment, so a past game earlier this
  // week still counts toward an official's cap.
  const divisionGames = inDivision
    .filter((g) => {
      if (isBeforeToday(g.scheduled_at, today)) {
        pastGamesSkipped++;
        return false;
      }
      return true;
    })
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
    { data: existingRaw, error: existingErr },
    { data: availabilityRaw, error: availabilityErr },
    { data: blackoutsRaw, error: blackoutsErr },
    { data: officialDivisionsRaw, error: officialDivisionsErr },
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
    supabase
      .from("official_divisions")
      .select("umpire_id, division_id")
      .in("umpire_id", umpireIds),
    ensureSeasonRoleIds(supabase, seasonId, roles),
  ]);

  if (existingErr) return unreadable("the officials' other games");
  if (availabilityErr) return unreadable("the officials' availability");
  if (blackoutsErr) return unreadable("the officials' blackout dates");
  // 0124: an unread division list would read as "every division".
  if (officialDivisionsErr) return unreadable("the officials' divisions");
  const divisionsByUmpire = new Map<string, Set<string>>();
  for (const r of (officialDivisionsRaw ?? []) as { umpire_id: string; division_id: string }[]) {
    if (!divisionsByUmpire.has(r.umpire_id)) divisionsByUmpire.set(r.umpire_id, new Set());
    divisionsByUmpire.get(r.umpire_id)!.add(r.division_id);
  }

  const existing = ((existingRaw as unknown as ExistingRow[] | null) ?? []).filter(
    (r) => r.game && r.game.status !== "cancelled",
  );

  // Each slot label resolved to its season role — the CANONICAL name is the
  // slot's text from here on (2026-11-07), so an assignment never carries a
  // case variant that matches no role. Unresolved (the role read or insert
  // failed) → the label as-is, role_id null, as before.
  const slotRoles = roles.map((label) => {
    const hit = roleIdByName.get(label.trim());
    return { text: hit?.name ?? label, id: hit?.id ?? null };
  });

  const availabilityByUmpire = new Map<string, AvailabilityWindow[]>();
  for (const a of (availabilityRaw ?? []) as ({ umpire_id: string } & AvailabilityWindow)[]) {
    if (!availabilityByUmpire.has(a.umpire_id)) availabilityByUmpire.set(a.umpire_id, []);
    availabilityByUmpire.get(a.umpire_id)!.push(a);
  }

  const blackoutsByUmpire = new Map<string, string[]>();
  for (const b of (blackoutsRaw ?? []) as { umpire_id: string; date: string }[]) {
    if (!blackoutsByUmpire.has(b.umpire_id)) blackoutsByUmpire.set(b.umpire_id, []);
    blackoutsByUmpire.get(b.umpire_id)!.push(b.date);
  }

  // Build: umpire_id → the games they're already booked on (wall-clock start
  // + minutes). blockReason reads both the overlap and the Mon–Sun weekly
  // count from this one list (claim-rules.ts), as the database does.
  const umpireBookings = new Map<string, Booking[]>();
  for (const u of umpires) umpireBookings.set(u.id, []);
  for (const e of existing) {
    if (!e.game) continue;
    umpireBookings.get(e.umpire_id)!.push({
      start: e.game.scheduled_at,
      minutes: gameDuration(e.game.home_team?.division?.settings),
    });
  }

  // 6. Per-game slot occupancy across the division being assigned.
  type DivAssignment = AssignmentRow;
  const divisionGameIds = divisionGames.map((g) => g.id);
  const { data: divAssignsRaw, error: divAssignsErr } = await supabase
    .from("game_umpires")
    .select("id, game_id, umpire_id, role")
    .in("game_id", divisionGameIds);
  if (divAssignsErr) return unreadable("this division's current assignments");
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
  const outsideAvailabilityNames = new Set<string>();
  const overWeeklyLimitNames = new Set<string>();

  for (const g of divisionGames) {
    const occupiedRoles = filledRolesByGame.get(g.id) ?? new Set();
    const occupiedUmpires = umpiresOnGame.get(g.id) ?? new Set();

    for (const slot of slotRoles) {
      const role = slot.text;
      // Legacy assignments may use role text outside the current season
      // list, so occupiedRoles alone can't see them — cap on total bodies
      // per game so those games don't get over-staffed.
      if (occupiedUmpires.size >= division.umpires_per_game) break;
      if (occupiedRoles.has(role)) continue;

      const sorted = [...umpires].sort(
        (a, b) => (loadByUmpire.get(a.id) ?? 0) - (loadByUmpire.get(b.id) ?? 0),
      );
      const slotReasons = new Set<SkipReason>();
      const slotOutsideNames = new Set<string>();
      const slotOverCapNames = new Set<string>();

      // Least-loaded umpire who passes every constraint. Blockers are
      // recorded as they're hit — if the slot ends up empty, they're the
      // reasons why. Hard checks run before the availability/cap ones so an
      // official recorded as soft-blocked (the "ask them first" list)
      // genuinely had nothing else in the way.
      const pick = (): UmpireRow | null => {
        for (const candidate of sorted) {
          const allowed = divisionsByUmpire.get(candidate.id);
          const reason = blockReason({
            onGame: occupiedUmpires.has(candidate.id),
            divisionAllowed: !allowed || allowed.has(divisionId),
            blackouts: blackoutsByUmpire.get(candidate.id) ?? [],
            // Coach conflict (0063) and conflict of interest (0073) — hard.
            coaches:
              candidate.team_id != null &&
              (candidate.team_id === g.home_team_id || candidate.team_id === g.away_team_id),
            conflictOfInterest: (candidate.conflicts ?? []).some(
              (c) =>
                c.team_id === g.home_team_id ||
                (g.away_team_id != null && c.team_id === g.away_team_id),
            ),
            start: g.scheduled_at,
            minutes: divisionDuration,
            bookings: umpireBookings.get(candidate.id) ?? [],
            windows: availabilityByUmpire.get(candidate.id) ?? [],
            cap: candidate.max_games_per_week,
          });
          if (reason === null) return candidate;
          // Blockers are recorded as they're hit — if the slot ends up
          // empty, they're the reasons why. Hard checks come before the
          // availability/cap ones, so an official recorded as soft-blocked
          // (the "ask them first" list) genuinely had nothing else in the way.
          if (reason === "already_on_game" || reason === "time_conflict") slotReasons.add("conflict");
          else slotReasons.add(reason);
          if (reason === "outside_availability") slotOutsideNames.add(candidate.name);
          if (reason === "over_weekly_limit") slotOverCapNames.add(candidate.name);
        }
        return null;
      };

      const chosen = pick();

      if (!chosen) {
        skipped++;
        for (const r of slotReasons) allSkipReasons.add(r);
        for (const n of slotOutsideNames) outsideAvailabilityNames.add(n);
        for (const n of slotOverCapNames) overWeeklyLimitNames.add(n);
        continue;
      }

      inserts.push({
        game_id: g.id,
        umpire_id: chosen.id,
        role,
        role_id: slot.id,
      });
      occupiedRoles.add(role);
      occupiedUmpires.add(chosen.id);
      umpireBookings.get(chosen.id)!.push({ start: g.scheduled_at, minutes: divisionDuration });
      loadByUmpire.set(chosen.id, (loadByUmpire.get(chosen.id) ?? 0) + 1);
    }
  }

  // 9. Write through insert_official_assignments (0124): the database takes
  //    the same per-official, per-game locks as an official's own claim and
  //    re-checks every row, so a slot claimed (or an official booked) since
  //    this run's reads is skipped, never double-written. Fails loud: an
  //    error or an unreadable reply means nothing is reported as filled.
  let takenMeanwhile = 0;
  let filled = 0;
  if (inserts.length > 0) {
    const { data: wrote, error: writeErr } = await supabase.rpc(
      "insert_official_assignments" as never,
      { p_season_id: seasonId, p_rows: inserts } as never,
    );
    const reply = wrote as { inserted?: unknown; skipped?: unknown } | null;
    if (writeErr || typeof reply?.inserted !== "number" || !Array.isArray(reply?.skipped)) {
      return {
        success: false,
        filled: 0,
        skipped,
        skipReasons: Array.from(allSkipReasons),
        outsideAvailabilityNames: Array.from(outsideAvailabilityNames),
        overWeeklyLimitNames: Array.from(overWeeklyLimitNames),
        pastGamesSkipped,
        takenMeanwhile: 0,
        error: writeErr?.message ?? "The assignments couldn't be confirmed. Refresh to see what was saved.",
      };
    }
    filled = reply.inserted;
    takenMeanwhile = reply.skipped.length;
  }

  return {
    success: true,
    filled,
    skipped: skipped + takenMeanwhile,
    skipReasons: Array.from(allSkipReasons),
    outsideAvailabilityNames: Array.from(outsideAvailabilityNames),
    overWeeklyLimitNames: Array.from(overWeeklyLimitNames),
    pastGamesSkipped,
    takenMeanwhile,
  };
}
