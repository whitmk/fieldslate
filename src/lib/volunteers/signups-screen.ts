// Admin: who signed up (/dashboard/volunteers/signups) — every decision the
// screen shows, pure, so sim:volunteer-signups drives the same rules the page
// renders. Slots come from ./slots.ts (never a copy); names and emails come
// only from volunteer_admin_signups (0121 part 5).
//
// Approved plan (2026-11-08) against docs/mockups/volunteer-signup/
// AdminSignups: Spots list with role / division / show filters; When, Spot,
// Volunteer, Team, Email, Filled by; Assign on an open spot, Change (cancel or
// reassign) on a filled one; the past-spots No-show ticks; the "sign-ups
// lost" banner from detached sign-ups; Export CSV (the one allowed export).
// Not here: "Possible same family / Merge" (cut), the Volunteers tab
// (branch D), reminders (built last in branch B).
import { slotTargets, spotStartWall, type SlotGame, type VolunteerRole } from "./slots";

export type SignupClaim = {
  claim_id: string;
  status: "active" | "canceled" | "detached";
  game_id: string | null;
  role_id: string | null;
  for_team_id: string | null;
  position: number;
  family_team_id: string | null;
  created_by: "volunteer" | "admin";
  no_show: boolean;
  last_reminded_at: string | null;
  detached_from: { start?: string; home_team_id?: string; away_team_id?: string | null } | null;
  detached_at: string | null;
  moved_from: { start?: string } | null;
  volunteer_id: string;
  first_initial: string;
  last_name: string;
  email: string;
};

export type ScreenGame = SlotGame & { fieldLabel: string | null };
export type ScreenTeam = { id: string; name: string; divisionId: string | null };
export type ScreenRoleRow = VolunteerRole & { name: string };

export type SpotRow = {
  key: string;
  gameId: string;
  roleId: string;
  forTeamId: string | null;
  position: number;
  spots: number;
  /** Spot start, wall clock "YYYY-MM-DDTHH:MM". */
  start: string;
  divisionId: string;
  title: string;
  detail: string;
  divisionLabel: string;
  matchup: string;
  field: string;
  note: string | null;
  claim: SignupClaim | null;
};

/** "Sat 3/6 · 8:30 AM" from a wall clock — no time zone, no Date parsing of
 *  an instant. */
export function fmtWhen(wall: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return wall;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  const h = +m[4];
  const t = `${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h < 12 ? "AM" : "PM"}`;
  return `${day} ${+m[2]}/${+m[3]} · ${t}`;
}

export function volunteerName(c: Pick<SignupClaim, "first_initial" | "last_name">): string {
  return `${c.first_initial}. ${c.last_name}`;
}

/** Every spot of the season, one row per position, with its claim (active
 *  only) — in time order, then role, team and position. */
export function buildSpotRows(input: {
  games: readonly ScreenGame[];
  roles: readonly ScreenRoleRow[];
  teams: readonly ScreenTeam[];
  divisionName: ReadonlyMap<string, string>;
  claims: readonly SignupClaim[];
}): SpotRow[] {
  const teamById = new Map(input.teams.map((t) => [t.id, t]));
  const teamDivision = new Map(input.teams.filter((t) => t.divisionId).map((t) => [t.id, t.divisionId as string]));
  const roleById = new Map(input.roles.map((r) => [r.id, r]));
  const held = new Map<string, SignupClaim>();
  for (const c of input.claims) {
    if (c.status !== "active" || !c.game_id || !c.role_id) continue;
    held.set(`${c.game_id}|${c.role_id}|${c.for_team_id ?? ""}|${c.position}`, c);
  }
  const rows: SpotRow[] = [];
  for (const g of input.games) {
    if (!g.scheduledAt) continue;
    const home = g.homeTeamId ? teamById.get(g.homeTeamId)?.name ?? "TBD" : "TBD";
    const away = g.awayTeamId ? teamById.get(g.awayTeamId)?.name ?? "TBD" : null;
    const matchup = away ? `${home} vs ${away}` : g.interleagueOrgId ? `${home} (interleague)` : home;
    for (const t of slotTargets(g, input.roles, teamDivision)) {
      const role = roleById.get(t.roleId)!;
      const start = spotStartWall(g.scheduledAt, role.leadMinutes ?? 0) ?? g.scheduledAt.slice(0, 16);
      const forName = t.forTeamId ? teamById.get(t.forTeamId)?.name ?? null : null;
      const title = forName ? `${role.name} · ${forName}` : role.name;
      const parts = [input.divisionName.get(t.divisionId) ?? "", matchup, g.fieldLabel ?? ""].filter(Boolean);
      const note =
        g.status === "cancelled"
          ? "Rained out. Sign-ups are kept for the makeup."
          : g.status === "reschedule_pending"
            ? g.interleagueOrgId
              ? "Partner league asked to move this game. We'll email the volunteer once the new time is set."
              : "This game may move. We'll email the volunteer once the new time is set."
            : null;
      for (let p = 1; p <= t.spots; p++) {
        rows.push({
          key: `${g.id}|${t.roleId}|${t.forTeamId ?? ""}|${p}`,
          gameId: g.id,
          roleId: t.roleId,
          forTeamId: t.forTeamId,
          position: p,
          spots: t.spots,
          start,
          divisionId: t.divisionId,
          divisionLabel: input.divisionName.get(t.divisionId) ?? "",
          matchup,
          field: g.fieldLabel ?? "",
          title,
          detail: t.spots > 1 ? `${parts.join(" · ")} · spot ${p} of ${t.spots}` : parts.join(" · "),
          note,
          claim: held.get(`${g.id}|${t.roleId}|${t.forTeamId ?? ""}|${p}`) ?? null,
        });
      }
    }
  }
  rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || a.title.localeCompare(b.title) || a.position - b.position);
  return rows;
}

export type ShowFilter = "all" | "open" | "filled";
export type Filters = { roleId: string | null; divisionId: string | null; show: ShowFilter };

export function applyFilters(rows: readonly SpotRow[], f: Filters): SpotRow[] {
  return rows.filter(
    (r) =>
      (!f.roleId || r.roleId === f.roleId) &&
      (!f.divisionId || r.divisionId === f.divisionId) &&
      (f.show === "all" || (f.show === "open" ? r.claim === null : r.claim !== null)),
  );
}

/** Upcoming = every spot dated TODAY or later (league wall clock) — a spot
 *  that already started today stays listed, tagged Started, until the day
 *  ends (decided 2026-11-08). The No-show list = filled spots on dates
 *  before today: the database refuses a no-show on today's spot, so the tick
 *  appears from the next day. */
export function splitByTime(rows: readonly SpotRow[], nowWall: string): { upcoming: SpotRow[]; past: SpotRow[] } {
  const today = nowWall.slice(0, 10);
  return {
    upcoming: rows.filter((r) => r.start.slice(0, 10) >= today),
    past: rows.filter((r) => r.claim !== null && r.start.slice(0, 10) < today).reverse(),
  };
}

export const STARTED_TAG = "Started";

/** "Started" for an upcoming row whose spot has begun, else null. */
export function startedTag(row: Pick<SpotRow, "start">, nowWall: string): string | null {
  return row.start < nowWall ? STARTED_TAG : null;
}

/** The "sign-ups lost" banner: detached sign-ups grouped by the division of
 *  the game's home team and the day they were lost. */
export type LostGroup = { divisionName: string; day: string; claims: SignupClaim[] };

export function lostGroups(
  claims: readonly SignupClaim[],
  teams: readonly ScreenTeam[],
  divisionName: ReadonlyMap<string, string>,
): LostGroup[] {
  const teamDiv = new Map(teams.map((t) => [t.id, t.divisionId]));
  const groups = new Map<string, LostGroup>();
  for (const c of claims) {
    if (c.status !== "detached") continue;
    const div = c.detached_from?.home_team_id ? teamDiv.get(c.detached_from.home_team_id) ?? null : null;
    const name = div ? divisionName.get(div) ?? "A division" : "A division";
    const day = (c.detached_at ?? "").slice(0, 10);
    const k = `${name}|${day}`;
    if (!groups.has(k)) groups.set(k, { divisionName: name, day, claims: [] });
    groups.get(k)!.claims.push(c);
  }
  return [...groups.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

export function lostTitle(g: LostGroup): string {
  const n = g.claims.length;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(g.day);
  const month = d ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+d[2] - 1] : "";
  const when = d ? ` on ${month} ${+d[3]}` : "";
  return `${n} sign-up${n === 1 ? "" : "s"} lost when ${g.divisionName} games were removed or regenerated${when}`;
}

export function lostDetail(n: number): string {
  return n === 1
    ? "That game no longer exists. The volunteer was emailed and invited to pick a new spot."
    : `Their games no longer exist. ${n === 2 ? "Both" : "All"} volunteers were emailed and invited to pick a new spot.`;
}

// ── Admin action replies ─────────────────────────────────────────────────────
export function assignStatusLine(status: string | null | undefined): string | null {
  switch (status) {
    case "assigned": return null;
    case "invalid_input": return "Check the name and email, and confirm the volunteer is 18 or older.";
    case "wrong_team": return "Pick a team from this season.";
    case "already_signed_up": return "That email already has this spot.";
    case "overlap_confirm_needed": return "This email already has a spot at an overlapping time.";
    case "just_taken": return "Someone just took this spot. Reload to see who.";
    case "rained_out": return "This game is rained out. Wait for its makeup.";
    case "past": return "This spot has already started.";
    case "unpublished": return "This division isn't published yet.";
    case "closed": return "This game is over.";
    case "no_slot": return "This spot no longer exists. Reload to see the current spots.";
    default: return "Couldn't save. Nothing changed — please try again.";
  }
}

// ── The admin CSV (the ONE allowed export of volunteer data) ─────────────────
const CSV_HEAD = ["Date", "Time", "Spot", "Division", "Game", "Field", "Spot number", "Volunteer", "Family team", "Email", "Filled by", "No-show"];

function csvCell(v: string): string {
  // Formula-looking cells are prefixed so a spreadsheet never runs them.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function signupsCsv(rows: readonly SpotRow[], teams: readonly ScreenTeam[], divisionName: ReadonlyMap<string, string>): string {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const lines = [CSV_HEAD.join(",")];
  for (const r of rows) {
    const [date, time] = [r.start.slice(0, 10), r.start.slice(11, 16)];
    const c = r.claim;
    const fam = c?.family_team_id ? teamById.get(c.family_team_id) : undefined;
    const famLabel = fam ? `${fam.divisionId ? divisionName.get(fam.divisionId) ?? "" : ""} ${fam.name}`.trim() : "";
    lines.push(
      [date, time, r.title, r.divisionLabel, r.matchup, r.field, `${r.position} of ${r.spots}`,
       c ? volunteerName(c) : "", famLabel, c?.email ?? "", c ? (c.created_by === "admin" ? "Admin" : "Volunteer") : "Open",
       c?.no_show ? "Yes" : ""].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n");
}
