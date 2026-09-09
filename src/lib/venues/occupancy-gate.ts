// Server-side VENUE-OCCUPANCY gate for the interleague reschedule endpoints.
//
// The sibling of reschedule-gate.ts, and the two answer different questions:
//
//   gateRescheduleVenue    — "is the field OPEN at that time?"  (venue hours)
//   gateRescheduleOccupancy — "is the field TAKEN at that time?" (other games)
//
// Both must pass. Before this file existed only the first one ran, so all three
// interleague reschedule endpoints could place a game directly on top of an
// existing one at a field that was, technically, open.
//
// ── The predicate is NOT written here ────────────────────────────────────────
//
// Overlap is decided by `candidateClearsSpan` from
// src/lib/schedule/reschedule-slots.ts — the exact function the reschedule
// picker uses, carrying the three properties that make it correct:
//   * the buffer belongs to the ARRIVING team (the game being placed), applied
//     symmetrically — never the existing game's, never max() of the two;
//   * spans are half-open, so a game starting exactly when another ends is legal;
//   * durations are per-game, resolved from each game's OWN division.
// This file only marshals RPC output into that function's arguments and turns a
// rejection into partner-readable English.
//
// CLAUDE.md warns against reusing `candidateClearsSpan` in a DETECTOR, because a
// detector has no placing side and would be smuggling in an unmade decision.
// That warning does not apply here: these endpoints are PLACING a game, exactly
// as the picker is. The game being rescheduled is the arriving team.
//
// ── Fail CLOSED ─────────────────────────────────────────────────────────────
//
// Any failure to read occupancy REJECTS the write. A partial or missing
// occupancy list is indistinguishable from an empty field, and "we could not
// check" must never be delivered to a user as "the field is free" — that is the
// same silent-truncation failure mode the fetchAllRows work was built around.
//
// NOTE, deliberately not changed here: `gateRescheduleVenue` fails OPEN on RPC
// error (`if (error || !data) return { ok: true }`). That is a pre-existing
// issue in a different gate and fixing it is a separate behavior change; it is
// flagged rather than fixed so this commit carries one behavior change.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  candidateClearsSpan,
  durationFromSettings,
  toMins,
  type OccupiedSpan,
} from "@/lib/schedule/reschedule-slots";

type DB = SupabaseClient<Database>;

/** Mirrors the picker's `Number(s.buffer_minutes ?? 15)`. Kept beside the
 *  duration fallback so both live in one place rather than at call sites. */
const DEFAULT_BUFFER_MINS = 15;

function bufferFromRaw(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUFFER_MINS;
}

/** One row of the RPC's `occupied` array. */
interface OccupiedRow {
  game_id: string;
  scheduled_at: string;
  game_duration: number | string | null;
  label: string | null;
}

/** The shared payload both RPCs return. */
interface OccupancyContext {
  game_id: string;
  venue_id: string | null;
  venue_name: string | null;
  scheduled_at: string;
  game_duration: number | string | null;
  buffer_minutes: number | string | null;
  occupied: OccupiedRow[];
}

export type OccupancyGateResult =
  | { ok: true }
  | {
      ok: false;
      status: 409 | 500;
      body: {
        error: string;
        venue?: string;
        conflicts?: { label: string; time: string }[];
      };
    };

/** "13:00" → "1:00 PM". Wall-clock substring only — never parses the instant
 *  (house convention; see game-days.ts's header). */
function fmtWallTime(iso: string): string {
  const hh = Number(iso.substring(11, 13));
  const mm = iso.substring(14, 16);
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm} ${period}`;
}

export interface OccupancyGateArgs {
  /** Authenticated path: the game being moved. */
  gameId?: string;
  /** Authenticated path: the time it is moving to (ISO). */
  scheduledAtIso?: string;
  /** Token path: supply this INSTEAD of gameId/scheduledAtIso. The RPC derives
   *  both from the request row, so an anonymous caller names no game. */
  token?: string;
}

/**
 * Reject the write when another game already holds this field at this time.
 *
 * Returns `{ ok: true }` when the game has no venue (nothing to contend for —
 * keyed on `venue_id`, never on `is_away`), when nothing overlaps, or when the
 * game's own division supplies no usable duration.
 */
export async function gateRescheduleOccupancy(
  supabase: DB,
  { gameId, scheduledAtIso, token }: OccupancyGateArgs,
): Promise<OccupancyGateResult> {
  const failClosed: OccupancyGateResult = {
    ok: false,
    status: 500,
    body: {
      error:
        "We couldn't check whether that field is already booked, so the change wasn't saved. Please try again.",
    },
  };

  const { data, error } = token
    ? await supabase.rpc(
        // @ts-expect-error — RPC isn't in generated types
        "get_reschedule_occupancy_by_token",
        { p_token: token },
      )
    : await supabase.rpc(
        // @ts-expect-error — RPC isn't in generated types
        "get_game_occupancy_context",
        { p_game_id: gameId, p_scheduled_at: scheduledAtIso },
      );

  // FAIL CLOSED. A read error, a raised token rejection, or a null payload all
  // land here — none of them is evidence that the field is free.
  if (error || !data) return failClosed;

  const ctx = data as OccupancyContext;

  // No field to contend for. Keyed on venue_id — see the RPC's header for why
  // this is not keyed on is_away.
  if (!ctx.venue_id) return { ok: true };

  const duration = durationFromSettings({ game_duration: ctx.game_duration });
  const buffer = bufferFromRaw(ctx.buffer_minutes);

  if (!Array.isArray(ctx.occupied)) return failClosed;

  const startMin = toMins(ctx.scheduled_at.substring(11, 16));
  const clashes: { label: string; time: string }[] = [];

  for (const row of ctx.occupied) {
    if (typeof row?.scheduled_at !== "string") return failClosed;
    const occupied: OccupiedSpan = {
      startMin: toMins(row.scheduled_at.substring(11, 16)),
      durationMin: durationFromSettings({ game_duration: row.game_duration }),
    };
    if (!candidateClearsSpan(startMin, duration, buffer, occupied)) {
      clashes.push({
        label: row.label ?? "Another game",
        time: fmtWallTime(row.scheduled_at),
      });
    }
  }

  if (clashes.length === 0) return { ok: true };

  const venue = ctx.venue_name ?? "that field";
  const first = clashes[0];
  const extra =
    clashes.length > 1 ? ` (and ${clashes.length - 1} more that day)` : "";

  return {
    ok: false,
    status: 409,
    body: {
      error:
        `${venue} is already booked at that time — ${first.label} is scheduled there at ${first.time}${extra}. ` +
        `Games at the same field need ${buffer} minutes between them. Pick a different time or field.`,
      venue,
      conflicts: clashes,
    },
  };
}
