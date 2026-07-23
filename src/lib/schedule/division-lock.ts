/**
 * Schedule lock + posted flag — the SHARED client helpers.
 *
 * THE RULE (see CLAUDE.md):
 *   `locked` protects a division against your OWN destructive re-derivation.
 *   `posted` tracks staleness from ANY source.
 *
 * Everything in this file is UI-side. It is NOT the guard. Enforcement lives in
 * the `enforce_division_lock` trigger on `games` (migration 0082) — RLS lets any
 * org member write games straight from the browser, so a check in React stops
 * the UI and nothing else. These helpers exist so a locked division is OBVIOUS
 * before the click and so every surface words the refusal the same way.
 *
 * Never write a parallel lock check — same shared-pure-function rule as the
 * umpires conflict helpers and team-constraints.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type DivisionLockState = {
  divisionId: string;
  locked: boolean;
  posted: boolean;
};

/** Actions a locked division refuses. Used for the inline reason text so the
 *  wording can't drift between surfaces. */
export type LockedAction =
  | "generate"
  | "finish"
  | "add"
  | "delete"
  | "move"
  | "deleteTeam";

const ACTION_REASON: Record<LockedAction, string> = {
  generate: "Unlock it to regenerate the schedule.",
  finish: "Unlock it to add the missing games.",
  add: "Unlock it to add a game.",
  delete: "Unlock it to delete a game.",
  move: "Unlock it to move this game.",
  deleteTeam: "Unlock it to delete a team.",
};

/** The one place the locked-surface sentence is written. */
export function lockedReason(divisionName: string, action: LockedAction): string {
  return `${divisionName} is locked. ${ACTION_REASON[action]}`;
}

/** Short badge/inline label — for option lists and table rows where a full
 *  sentence doesn't fit (Add game's division picker, the conflict resolver). */
export function lockedShortLabel(action: LockedAction): string {
  return action === "move" ? "locked — can't move" : "locked";
}

/**
 * Detect the 0082 trigger's refusal in an error message.
 *
 * The trigger raises `division_locked: <name> is locked — ...`. Client checks
 * can be stale (another admin locks the division between render and click), so
 * every write path that can hit a locked division should run its error through
 * this rather than surfacing raw SQL.
 */
export function isDivisionLockError(message: string | null | undefined): boolean {
  return !!message && message.includes("division_locked");
}

/** Strip the SQL prefix off the trigger's message for display. Falls back to
 *  the raw message if the shape ever changes — never swallow an error. */
export function formatLockError(message: string): string {
  const i = message.indexOf("division_locked:");
  return i === -1 ? message : message.slice(i + "division_locked:".length).trim();
}

/**
 * Lock/posted state for a set of divisions.
 *
 * Fails LOUD: a read error throws rather than returning "unlocked" defaults.
 * Treating an unreadable lock as unlocked would show enabled buttons on a
 * locked division — exactly the click-then-refuse experience the feature is
 * meant to remove.
 */
export async function fetchDivisionLocks(
  client: SupabaseClient,
  divisionIds: string[],
): Promise<Map<string, DivisionLockState>> {
  const out = new Map<string, DivisionLockState>();
  if (divisionIds.length === 0) return out;

  const { data, error } = await client
    .from("divisions")
    .select("id, locked, posted")
    .in("id", divisionIds);

  if (error) throw new Error(`Couldn't read schedule lock state: ${error.message}`);

  for (const row of (data ?? []) as { id: string; locked: boolean; posted: boolean }[]) {
    out.set(row.id, {
      divisionId: row.id,
      locked: !!row.locked,
      posted: !!row.posted,
    });
  }
  return out;
}

/** Every division in a season, for the surfaces that show many at once
 *  (season page cards, generate-all, Add game's division picker). */
export async function fetchSeasonDivisionLocks(
  client: SupabaseClient,
  leagueId: string,
): Promise<Map<string, DivisionLockState>> {
  const { data, error } = await client
    .from("divisions")
    .select("id, locked, posted")
    .eq("league_id", leagueId);

  if (error) throw new Error(`Couldn't read schedule lock state: ${error.message}`);

  const out = new Map<string, DivisionLockState>();
  for (const row of (data ?? []) as { id: string; locked: boolean; posted: boolean }[]) {
    out.set(row.id, { divisionId: row.id, locked: !!row.locked, posted: !!row.posted });
  }
  return out;
}

/**
 * Lock or unlock. Any org member may do either — the lock is a guardrail
 * between admins, not a permission boundary, so there is deliberately no
 * "only the locker may unlock" rule.
 */
export async function setDivisionLock(
  divisionId: string,
  locked: boolean,
  userId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("divisions")
    .update({
      locked,
      locked_at: locked ? new Date().toISOString() : null,
      locked_by: locked ? userId : null,
    } as never)
    .eq("id", divisionId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Set or clear the posted flag by hand.
 *
 * Clearing is normally AUTOMATIC — the `clear_division_posted` statement
 * triggers (0082) drop it on ANY change to the division's games. This setter
 * exists for the admin ticking the box after they send the schedule out, and
 * for un-ticking it if they tick it by mistake. Nothing reads `posted` and
 * nothing branches on it.
 */
export async function setDivisionPosted(
  divisionId: string,
  posted: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("divisions")
    .update({
      posted,
      posted_at: posted ? new Date().toISOString() : null,
    } as never)
    .eq("id", divisionId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
