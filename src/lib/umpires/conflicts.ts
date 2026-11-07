import { createClient } from "@/lib/supabase/client";
import { localDateKey } from "./eligibility";

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

/**
 * Raw game_umpires row with the game embed the conflict check needs — the
 * same shape whether fetched per-umpire (findUmpireConflict) or embedded on
 * a roster feed (`booking_rows:game_umpires(game:games(...))`).
 */
export type UmpireBookingRow = {
  game:
    | {
        id: string;
        scheduled_at: string;
        home_team:
          | { name: string; division: { settings: unknown } | null }
          | null;
        away_team: { name: string } | null;
      }
    | null;
};

/** Map raw booking rows to GameTimeInfo, resolving each game's duration from
 *  its division settings. Single mapping shared by the save-time check and
 *  the pre-click picker state so the two can't drift. */
export function bookingsFromRows(rows: UmpireBookingRow[]): GameTimeInfo[] {
  const out: GameTimeInfo[] = [];
  for (const r of rows) {
    const g = r.game;
    if (!g) continue;
    const settings = (g.home_team?.division?.settings ?? {}) as {
      game_duration?: number;
    };
    const duration =
      typeof settings.game_duration === "number"
        ? settings.game_duration
        : DEFAULT_GAME_DURATION_MINS;
    out.push({
      id: g.id,
      scheduled_at: g.scheduled_at,
      duration_minutes: duration,
      home_team_name: g.home_team?.name ?? "TBD",
      away_team_name: g.away_team?.name ?? "TBD",
    });
  }
  return out;
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
 * The first existing game that conflicts with the candidate slot for this
 * umpire (`conflict: null` when there is none), or `{ ok: false }` when the
 * bookings could not be read.
 *
 * Excludes the candidate game itself so re-assigning an umpire from one role
 * to another on the same game doesn't trigger a false positive.
 *
 * `client` is for the simulation harnesses ONLY; production callers omit it.
 */
export async function findUmpireConflict(
  umpireId: string,
  candidate: GameTimeInfo,
  client?: ReturnType<typeof createClient>,
): Promise<ConflictCheck> {
  const supabase = client ?? createClient();

  const { data, error } = await supabase
    .from("game_umpires")
    .select(
      `game:games(
        id,
        scheduled_at,
        home_team:teams!home_team_id(name, division:divisions(settings)),
        away_team:teams!away_team_id(name)
      )`,
    )
    .eq("umpire_id", umpireId)
    .neq("game_id", candidate.id);
  if (error) return { ok: false };

  const rows = (data as unknown as UmpireBookingRow[] | null) ?? [];
  return { ok: true, conflict: findConflictInBookings(candidate, bookingsFromRows(rows)) };
}

export type BlackoutInfo = { date: string; note: string | null };

/** Same rule as ConflictCheck: an unreadable blackout list is "couldn't
 *  check", never "no blackout". */
export type BlackoutCheck =
  | { ok: true; blackout: BlackoutInfo | null }
  | { ok: false };

/**
 * The official's blackout entry covering the game's (local) date
 * (`blackout: null` when there is none), or `{ ok: false }` when it could not
 * be read. official_blackouts.date is a plain date — compared against the
 * game's local calendar day, the same day the schedule UI shows.
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
    .eq("date", localDateKey(new Date(scheduledAt)))
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
  const d = new Date(scheduled_at);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}
