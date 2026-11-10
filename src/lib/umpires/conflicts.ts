import { createClient } from "@/lib/supabase/client";
import { gameDateKey } from "./eligibility";
import { fmtGameTime } from "@/lib/utils/game-time";

export const DEFAULT_GAME_DURATION_MINS = 90;

export type GameTimeInfo = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  home_team_name: string;
  away_team_name: string;
};

export function gameEndMs(g: { scheduled_at: string; duration_minutes: number }) {
  return new Date(g.scheduled_at).getTime() + g.duration_minutes * 60_000;
}

export function gamesOverlap(
  a: { scheduled_at: string; duration_minutes: number },
  b: { scheduled_at: string; duration_minutes: number },
): boolean {
  const aStart = new Date(a.scheduled_at).getTime();
  const bStart = new Date(b.scheduled_at).getTime();
  return aStart < gameEndMs(b) && bStart < gameEndMs(a);
}

/** One busy game of an official, as `official_bookings` (0129) returns it. */
export type OfficialBookingRow = {
  game_umpire_id: string;
  umpire_id: string;
  game_id: string;
  scheduled_at: string;
  minutes: number;
  home: string | null;
  away: string | null;
};

/** The ONE read of officials' busy games (0129). THE RULE — busy unless the
 *  game is cancelled or postponed — lives in the database
 *  (`official_game_busy`); this code never tests a game's status, and no
 *  officials code reads `game_umpires → games` for bookings any more (the
 *  manual save, both picker rosters, record-where-played and auto-assign all
 *  call this). FAILS CLOSED: an error, or a reply that isn't the expected
 *  list, is `{ ok: false }` — never an empty list, which would read as
 *  "free everywhere".
 *
 *  `client` is for the simulation harnesses ONLY; production callers omit it. */
export async function fetchOfficialBookings(
  seasonId: string,
  umpireIds: string[],
  client?: ReturnType<typeof createClient>,
): Promise<{ ok: true; byUmpire: Map<string, GameTimeInfo[]>; rows: OfficialBookingRow[] } | { ok: false }> {
  const byUmpire = new Map<string, GameTimeInfo[]>();
  for (const id of umpireIds) byUmpire.set(id, []);
  if (umpireIds.length === 0) return { ok: true, byUmpire, rows: [] };
  const supabase = client ?? createClient();
  const { data, error } = await supabase.rpc(
    "official_bookings" as never,
    { p_season_id: seasonId, p_umpire_ids: umpireIds } as never,
  );
  if (error) return { ok: false };
  const rows = parseOfficialBookings(data);
  if (!rows) return { ok: false };
  for (const r of rows) byUmpire.get(r.umpire_id)?.push(bookingInfo(r));
  return { ok: true, byUmpire, rows };
}

/** The reply, or null when it isn't a list of well-formed rows. */
export function parseOfficialBookings(raw: unknown): OfficialBookingRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: OfficialBookingRow[] = [];
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : null) as Record<string, unknown> | null;
    if (
      !o ||
      typeof o.game_umpire_id !== "string" ||
      typeof o.umpire_id !== "string" ||
      typeof o.game_id !== "string" ||
      typeof o.scheduled_at !== "string" ||
      typeof o.minutes !== "number"
    ) {
      return null;
    }
    out.push({
      game_umpire_id: o.game_umpire_id,
      umpire_id: o.umpire_id,
      game_id: o.game_id,
      scheduled_at: o.scheduled_at,
      minutes: o.minutes,
      home: typeof o.home === "string" ? o.home : null,
      away: typeof o.away === "string" ? o.away : null,
    });
  }
  return out;
}

/** A booking as the overlap check and the sentences read it. */
export function bookingInfo(r: OfficialBookingRow): GameTimeInfo {
  return {
    id: r.game_id,
    scheduled_at: r.scheduled_at,
    duration_minutes: r.minutes,
    home_team_name: r.home ?? "TBD",
    away_team_name: r.away ?? "TBD",
  };
}

/** First booking overlapping the candidate slot, or null. Skips the candidate
 *  game itself so a same-game reassignment doesn't self-conflict. */
export function findConflictInBookings(
  candidate: GameTimeInfo,
  bookings: GameTimeInfo[],
): GameTimeInfo | null {
  for (const b of bookings) {
    if (b.id === candidate.id) continue;
    if (gamesOverlap(candidate, b)) return b;
  }
  return null;
}

/** A check whose read failed is "couldn't check" — NEVER "no conflict"
 *  (2026-11-06). A failed read used to come back as an empty booking list,
 *  so the save went through on a check that never ran. */
export type ConflictCheck =
  | { ok: true; conflict: GameTimeInfo | null }
  | { ok: false };

/**
 * The first busy game that conflicts with the candidate slot for this umpire
 * (`conflict: null` when there is none), or `{ ok: false }` when the
 * bookings could not be read — the save then refuses. Busy games come from
 * `official_bookings` (0129), so a rained-out or postponed game never blocks.
 * The candidate game itself is skipped, so re-assigning an umpire from one
 * role to another on the same game doesn't conflict.
 *
 * `client` is for the simulation harnesses ONLY; production callers omit it.
 */
export async function findUmpireConflict(
  umpireId: string,
  seasonId: string,
  candidate: GameTimeInfo,
  client?: ReturnType<typeof createClient>,
): Promise<ConflictCheck> {
  const read = await fetchOfficialBookings(seasonId, [umpireId], client);
  if (!read.ok) return { ok: false };
  return { ok: true, conflict: findConflictInBookings(candidate, read.byUmpire.get(umpireId) ?? []) };
}

export type BlackoutInfo = { date: string; note: string | null };

/** Same rule as ConflictCheck: an unreadable blackout list is "couldn't
 *  check", never "no blackout". */
export type BlackoutCheck =
  | { ok: true; blackout: BlackoutInfo | null }
  | { ok: false };

/**
 * The official's blackout entry covering the game's WALL-CLOCK date
 * (`blackout: null` when there is none), or `{ ok: false }` when it could not
 * be read. official_blackouts.date is a plain date — compared against the
 * date part of the stored time (eligibility.ts `gameDateKey`), the day the
 * schedule shows. Never the instant read in the browser's zone.
 *
 * `client` is for the simulation harnesses ONLY; production callers omit it.
 */
export async function findUmpireBlackout(
  umpireId: string,
  scheduledAt: string,
  client?: ReturnType<typeof createClient>,
): Promise<BlackoutCheck> {
  const supabase = client ?? createClient();
  const { data, error } = await supabase
    .from("official_blackouts")
    .select("date, note")
    .eq("umpire_id", umpireId)
    .eq("date", gameDateKey(scheduledAt))
    .maybeSingle();
  if (error) return { ok: false };
  return { ok: true, blackout: (data as BlackoutInfo | null) ?? null };
}

/**
 * The refusal shown at the slot before a manual assignment is saved, or null
 * when the save may go ahead. The ONE place these sentences are written.
 * Order: an unreadable check refuses first (nothing else can be trusted),
 * then a real conflict, then a blackout.
 */
export function assignmentPrecheckMessage(
  umpName: string,
  conflictCheck: ConflictCheck,
  blackoutCheck: BlackoutCheck,
): string | null {
  if (!conflictCheck.ok) {
    return `Couldn't check ${umpName}'s other games, so nothing was saved. Try again.`;
  }
  if (!blackoutCheck.ok) {
    return `Couldn't check ${umpName}'s blackout dates, so nothing was saved. Try again.`;
  }
  const conflict = conflictCheck.conflict;
  if (conflict) {
    return `${umpName} is already assigned to ${conflict.home_team_name} vs ${conflict.away_team_name} at ${formatConflictTime(conflict.scheduled_at)}.`;
  }
  const blackout = blackoutCheck.blackout;
  if (blackout) {
    const day = new Date(blackout.date + "T00:00:00").toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" },
    );
    return `${umpName} has a blackout date on ${day}${
      blackout.note ? ` (${blackout.note})` : ""
    }.`;
  }
  return null;
}

export function formatConflictTime(scheduled_at: string): string {
  // Wall-clock, from the string (2026-11-09): toLocale* in the browser read
  // a 9:00 AM game as 2:00 AM from a Pacific browser.
  const [, m, d] = gameDateKey(scheduled_at).split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}, ${fmtGameTime(scheduled_at)}`;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
