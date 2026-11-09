// The public volunteer sign-up page (/v/<token>) — every decision it shows,
// pure, so sim:volunteer-signup-page drives the same rules the page renders.
// The database decides every claim (volunteer_claim, 0121); this file only
// reads volunteer_signup_page's reply and words what comes back.
//
// Approved plan (2026-11-08) against docs/mockups/volunteer-signup/Main:
// role and division chips; spots grouped by date with "Sign up" or "Taken"
// and "1 of 2 spots open"; Division → Team → first initial, last name,
// email, 18+; the confirmation screen. Differences (decided): the overlap
// warning is GENERIC and names no spot; a season picker when two seasons
// are open. Snack shack shifts (0122) are spots too: any family may take one
// (decided 2026-11-09); a shift assigned to a team says "For <team> families".
// They belong to no division, so a division chip never hides them.
import { shiftDetail } from "./shifts";
import * as W from "./words";

export type PageSpot = {
  /** "game" for a game role's spot, "shift" for a snack shack shift (0122). */
  kind: "game" | "shift";
  /** The shift's block id; null for a game spot. */
  block_id: string | null;
  /** The team a shift is assigned to; null for a game spot or an open shift. */
  assigned_team_name: string | null;
  game_id: string;
  role_id: string;
  for_team_id: string | null;
  for_team_name: string | null;
  division_id: string;
  division_name: string;
  home_team_name: string;
  away_team_name: string | null;
  interleague: boolean;
  is_away: boolean;
  field: string | null;
  park: string | null;
  start: string;
  game_start: string;
  end: string;
  state: "open" | "may_move" | "rained_out" | "closed" | "none";
  spots: number;
  taken: number;
};
export type PageRole = { id: string; name: string; kind: "per_game" | "per_team" | "snack_shack" };
export type PageDivision = { id: string; name: string; teams: { id: string; name: string }[] };
export type PageData = {
  leagueName: string;
  now: string;
  seasons: { id: string; name: string }[];
  seasonId: string | null;
  divisions: PageDivision[];
  roles: PageRole[];
  spots: PageSpot[];
};

export type PageReply =
  | { kind: "ok"; data: PageData }
  | { kind: "unknown" }
  | { kind: "plan" }
  | { kind: "error" };

/** volunteer_signup_page's reply → what the page shows. Anything malformed is
 *  "error" (the page says it couldn't load), never an empty list of spots. */
export function readPageReply(raw: unknown): PageReply {
  if (!raw || typeof raw !== "object") return { kind: "error" };
  const r = raw as Record<string, unknown>;
  if (r.status === "unknown") return { kind: "unknown" };
  if (r.status === "plan") return { kind: "plan" };
  if (r.status !== "ok") return { kind: "error" };
  if (typeof r.now !== "string" || !Array.isArray(r.seasons) || !Array.isArray(r.divisions) || !Array.isArray(r.roles) || !Array.isArray(r.spots)) {
    return { kind: "error" };
  }
  return {
    kind: "ok",
    data: {
      leagueName: typeof r.league_name === "string" && r.league_name.trim() ? r.league_name : "Your league",
      now: r.now,
      seasons: r.seasons as PageData["seasons"],
      seasonId: typeof r.season_id === "string" ? r.season_id : null,
      divisions: r.divisions as PageDivision[],
      roles: r.roles as PageRole[],
      spots: [
        ...((Array.isArray(r.spots) ? r.spots : []) as Omit<PageSpot, "kind" | "block_id" | "assigned_team_name">[]).map(
          (s): PageSpot => ({ ...s, kind: "game", block_id: null, assigned_team_name: null }),
        ),
        // A database before 0122 sends no shifts; that reads as none.
        ...(Array.isArray(r.shifts) ? (r.shifts as PageShift[]) : []).map(shiftSpot),
      ],
    },
  };
}

/** volunteer_signup_page's `shifts` (0122). */
export type PageShift = {
  block_id: string;
  role_id: string;
  start: string;
  end: string;
  assigned_team_name: string | null;
  spots: number;
  taken: number;
};

/** A shift as a spot on the page: open (it is listed only while ahead). */
export function shiftSpot(s: PageShift): PageSpot {
  return {
    kind: "shift",
    block_id: s.block_id,
    assigned_team_name: s.assigned_team_name ?? null,
    game_id: "",
    role_id: s.role_id,
    for_team_id: null,
    for_team_name: null,
    division_id: "",
    division_name: "",
    home_team_name: "",
    away_team_name: null,
    interleague: false,
    is_away: false,
    field: null,
    park: null,
    start: s.start,
    game_start: s.start,
    end: s.end,
    state: "open",
    spots: s.spots,
    taken: s.taken,
  };
}

export function spotKey(s: Pick<PageSpot, "kind" | "block_id" | "game_id" | "role_id" | "for_team_id">): string {
  return s.kind === "shift" ? `shift|${s.block_id}` : `${s.game_id}|${s.role_id}|${s.for_team_id ?? ""}`;
}

/** "GameChanger · Expos" for a per-team spot, else the role's name. */
export function spotTitle(s: PageSpot, roles: readonly PageRole[]): string {
  const name = roles.find((r) => r.id === s.role_id)?.name ?? "";
  return s.for_team_name ? `${name} · ${s.for_team_name}` : name;
}

/** "9:00 AM · Expos vs Pirates · Field 1 (Main Park)". */
export function spotDetail(s: PageSpot): string {
  if (s.kind === "shift") return shiftDetail(s.start, s.end, s.assigned_team_name);
  const game = s.away_team_name ? `${s.home_team_name} vs ${s.away_team_name}` : s.home_team_name;
  const place = s.field ? (s.park ? `${s.field} (${s.park})` : s.field) : s.is_away ? "Away" : "";
  return [fmtTime(s.start), game, place].filter(Boolean).join(" · ");
}

export function fmtTime(wall: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return "";
  const h = +m[1];
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Saturday, March 6" from a wall clock date. */
export function fmtDay(wall: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(wall);
  if (!m) return wall;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()];
  const mon = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][+m[2] - 1];
  return `${day}, ${mon} ${+m[3]}`;
}

export type SpotAction = { kind: "sign_up"; openLine: string } | { kind: "taken" } | { kind: "rained_out" } | { kind: "closed" };

/** What a spot's card offers. Full → "Taken" (never a name). Rained out and
 *  closed games take no new sign-ups. */
export function spotAction(s: PageSpot): SpotAction {
  if (s.state === "rained_out") return { kind: "rained_out" };
  if (s.state !== "open" && s.state !== "may_move") return { kind: "closed" };
  const open = Math.max(s.spots - s.taken, 0);
  if (open === 0) return { kind: "taken" };
  return { kind: "sign_up", openLine: s.spots === 1 ? W.PUB_ONE_SPOT_OPEN : W.PUB_SPOTS_OPEN(open, s.spots) };
}

export function spotTag(s: PageSpot): string | null {
  if (s.state === "may_move") return W.PUB_TAG_MAY_MOVE;
  if (s.state === "rained_out") return W.PUB_TAG_RAINED_OUT;
  return null;
}

export type Chips = { roleId: string | null; divisionId: string | null };

/** The spots the chips allow, grouped by date in time order. */
export function groupSpots(spots: readonly PageSpot[], chips: Chips): { date: string; spots: PageSpot[] }[] {
  const out = new Map<string, PageSpot[]>();
  for (const s of spots) {
    if (chips.roleId && s.role_id !== chips.roleId) continue;
    if (chips.divisionId && s.kind !== "shift" && s.division_id !== chips.divisionId) continue;
    const d = s.start.slice(0, 10);
    if (!out.has(d)) out.set(d, []);
    out.get(d)!.push(s);
  }
  return [...out.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, list]) => ({ date, spots: [...list].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)) }));
}

export type FormInput = { divisionId: string; teamId: string; firstInitial: string; lastName: string; email: string; adult: boolean };

const EMAIL = /^[^@\s<>"(),;:\\]+@[^@\s<>"(),;:\\]+\.[^@\s<>"(),;:\\]+$/;

/** The form's own check — the database checks it all again. Null = send. */
export function formProblem(f: FormInput): string | null {
  if (!f.divisionId) return W.PUB_NEED_DIVISION;
  if (!f.teamId) return W.PUB_NEED_TEAM;
  if (!/^[A-Za-z]$/.test(f.firstInitial.trim())) return W.PUB_NEED_INITIAL;
  const last = f.lastName.trim();
  if (last.length < 1 || last.length > 60 || /[<>]/.test(last)) return W.PUB_NEED_LAST;
  const email = f.email.trim();
  if (email.length > 254 || !EMAIL.test(email)) return W.PUB_NEED_EMAIL;
  if (!f.adult) return W.PUB_NEED_ADULT;
  return null;
}

/** The claim route's answer → what the page does next. */
export type ClaimOutcome =
  | { kind: "done"; position: number }
  | { kind: "overlap" }
  | { kind: "refused"; line: string; reload: boolean };

export function claimOutcome(raw: unknown): ClaimOutcome {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (r.status) {
    case "claimed":
      return typeof r.position === "number" ? { kind: "done", position: r.position } : { kind: "refused", line: W.PUB_FAILED, reload: false };
    case "overlap_confirm_needed":
      return { kind: "overlap" };
    case "just_taken":
      return { kind: "refused", line: W.PUB_JUST_TAKEN, reload: true };
    case "already_signed_up":
      return { kind: "refused", line: W.PUB_ALREADY, reload: false };
    case "wrong_team":
      return { kind: "refused", line: W.PUB_WRONG_TEAM, reload: true };
    case "invalid_input":
      return { kind: "refused", line: W.PUB_INVALID, reload: false };
    case "rate_limited":
      return { kind: "refused", line: W.PUB_RATE_LIMITED, reload: false };
    case "captcha":
      return { kind: "refused", line: W.PUB_CAPTCHA, reload: false };
    case "rained_out":
    case "closed":
    case "past":
    case "unpublished":
    case "signups_closed":
    case "no_slot":
      return { kind: "refused", line: W.PUB_SPOT_GONE, reload: true };
    case "unknown":
    case "plan":
      return { kind: "refused", line: W.PUB_LINK_OFF, reload: true };
    default:
      return { kind: "refused", line: W.PUB_FAILED, reload: false };
  }
}
