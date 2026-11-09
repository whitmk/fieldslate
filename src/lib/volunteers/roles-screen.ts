// Admin: volunteer roles (/dashboard/volunteers) — every decision the screen
// shows, pure, so sim:volunteer-roles drives the same rules the page renders.
// Words live in ./words.ts; the slot rules in ./slots.ts (never a copy).
//
// Approved plan (2026-11-08) against docs/mockups/volunteer-signup/AdminRoles:
// the snack shack row arrives with branch C; "How many each" is 1–10 (the
// database rule) instead of the board's 1/2/3; a new "Starts before the game"
// (0–120); the slot kind can't change once anyone has signed up; saving or
// deleting first states how many sign-ups it cancels; the link strip shows
// status, Copy and Open — on/off, contact email and Reset stay in Settings.
import { MAX_LEAD_MIN, MAX_SPOTS, slotTargets, type RoleKind, type SlotGame, type VolunteerRole } from "./slots";

export type ScreenRole = VolunteerRole & { name: string };
export type ScreenDivision = { id: string; name: string };

/** "1 per home game" / "2 per our team, per game". */
export function slotsLabel(kind: RoleKind, spots: number): string {
  return kind === "per_game" ? `${spots} per home game` : `${spots} per our team, per game`;
}

/** "All" when the role covers every division of the season, else the names
 *  in the season's order; "None" when it covers none. */
export function divisionsLabel(role: Pick<VolunteerRole, "divisionIds">, divisions: readonly ScreenDivision[]): string {
  const picked = divisions.filter((d) => role.divisionIds.includes(d.id));
  if (picked.length === 0) return "None";
  if (picked.length === divisions.length) return "All";
  return picked.map((d) => d.name).join(", ");
}

/** Total spots and the games carrying them, for a role (or a draft) over the
 *  season's games — the slot rules in slots.ts, never a second copy. */
export function slotCount(
  role: Pick<VolunteerRole, "kind" | "spots" | "divisionIds">,
  games: readonly SlotGame[],
  teamDivision: ReadonlyMap<string, string>,
): { spots: number; games: number } {
  const r: VolunteerRole = { id: "draft", kind: role.kind, spots: role.spots, signupsOpen: true, divisionIds: role.divisionIds };
  let spots = 0;
  let withSlots = 0;
  for (const g of games) {
    const t = slotTargets(g, [r], teamDivision);
    if (t.length === 0) continue;
    withSlots++;
    for (const x of t) spots += x.spots;
  }
  return { spots, games: withSlots };
}

/** "This creates 96 spots across 48 games." */
export function createsLine(count: { spots: number; games: number }): string {
  const s = count.spots === 1 ? "spot" : "spots";
  const g = count.games === 1 ? "game" : "games";
  return `This creates ${count.spots} ${s} across ${count.games} ${g}.`;
}

/** "41 of 96", or null when the sign-ups couldn't be read. */
export function filledLabel(filled: number | null, total: number): string | null {
  return filled === null ? null : `${filled} of ${total}`;
}

/** Active sign-ups per role from volunteer_admin_signups' claims. */
export function activeByRole(claims: readonly { role_id: string | null; status: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of claims) {
    if (c.status !== "active" || !c.role_id) continue;
    m.set(c.role_id, (m.get(c.role_id) ?? 0) + 1);
  }
  return m;
}

export type RoleDraft = {
  id: string | null;
  name: string;
  kind: RoleKind;
  spots: number;
  leadMinutes: number;
  divisionIds: string[];
  signupsOpen: boolean;
  /** Carried through unchanged — the tracker (branch D) sets it. */
  countsTowardGoal: boolean;
};

/** What the form refuses before sending — the database checks all of it
 *  again. Null when the draft can be sent. */
export function draftProblem(d: RoleDraft): string | null {
  const name = d.name.trim();
  if (name.length === 0) return "Give the role a name.";
  if (name.length > 60) return "Keep the name to 60 characters.";
  if (!Number.isInteger(d.spots) || d.spots < 1 || d.spots > MAX_SPOTS) return "Choose 1 to 10 spots.";
  if (!Number.isInteger(d.leadMinutes) || d.leadMinutes < 0 || d.leadMinutes > MAX_LEAD_MIN) return "Choose 0 to 120 minutes.";
  if (d.divisionIds.length === 0) return "Pick at least one division.";
  return null;
}

/** The kind control is locked while a saved role has active sign-ups. */
export function kindLocked(roleId: string | null, active: ReadonlyMap<string, number> | null): boolean {
  if (!roleId) return false;
  if (active === null) return true; // unknown → assume people signed up; the database refuses anyway
  return (active.get(roleId) ?? 0) > 0;
}

/** A save/delete preview's reply → what the admin must confirm, or null
 *  when nothing is canceled (save straight away). A reply that isn't a
 *  readable preview is an error, never "nothing to cancel". */
export type PreviewOutcome =
  | { kind: "go" }
  | { kind: "confirm"; cancels: number; line: string }
  | { kind: "error" };

export function previewOutcome(reply: unknown): PreviewOutcome {
  if (!reply || typeof reply !== "object") return { kind: "error" };
  const r = reply as Record<string, unknown>;
  if (r.committed !== false) return { kind: "error" };
  const n = r.claims_to_cancel;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return { kind: "error" };
  if (n === 0) return { kind: "go" };
  return { kind: "confirm", cancels: n, line: cancelLine(n) };
}

export function cancelLine(n: number): string {
  return n === 1
    ? "This cancels 1 sign-up. That volunteer gets an email saying their spot was canceled."
    : `This cancels ${n} sign-ups. Each volunteer gets an email saying their spot was canceled.`;
}

export function deleteLine(name: string): string {
  return `Delete ${name}? Its open spots disappear from the sign-up page.`;
}

/** A commit's reply is success only when it says committed. */
export function commitOk(reply: unknown): boolean {
  return !!reply && typeof reply === "object" && (reply as Record<string, unknown>).committed === true;
}
