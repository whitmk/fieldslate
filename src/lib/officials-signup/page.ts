// The official's page (/o/<token>), as pure rules: read the database's reply
// (official_signup_page, 0124) into a view, word every claim and drop result.
// No I/O, no clock — the reply carries the league's "now".
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { SITE_URL } from "@/lib/site";
import * as W from "./words";

export const LINK_TOKEN = /^[0-9a-f]{64}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function officialLinkUrl(token: string): string {
  return `${SITE_URL}/o/${token}`;
}

export type GameInfo = {
  game_id: string;
  start: string; // "YYYY-MM-DDTHH:MI", league wall clock
  minutes: number;
  division: string | null;
  home: string | null;
  away: string | null;
  field: string | null;
  role: string;
};
export type MineGame = GameInfo & { game_umpire_id: string; self_claimed: boolean; can_drop: boolean };
export type OpenSpot = GameInfo & { role_id: string; problem: string | null };

export type SignupPage = {
  officialName: string;
  youth: boolean;
  leagueName: string;
  seasonName: string;
  contactEmail: string | null;
  mine: MineGame[];
  open: OpenSpot[];
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function game(o: Record<string, unknown>): GameInfo | null {
  const id = str(o.game_id);
  const start = str(o.start);
  const role = str(o.role);
  if (!id || !start || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start) || !role) return null;
  return {
    game_id: id,
    start,
    minutes: typeof o.minutes === "number" ? o.minutes : 90,
    division: str(o.division),
    home: str(o.home),
    away: str(o.away),
    field: str(o.field),
    role,
  };
}

/** The route's reply → a view, or why there's none. A malformed reply is an
 *  error, never an empty page (which would read as "nothing open"). */
export function readSignupReply(raw: unknown): { kind: "ok"; page: SignupPage } | { kind: "unknown" } | { kind: "error" } {
  if (!raw || typeof raw !== "object") return { kind: "error" };
  const r = raw as Record<string, unknown>;
  if (r.status === "unknown") return { kind: "unknown" };
  if (r.status !== "ok") return { kind: "error" };
  const official = (r.official ?? {}) as Record<string, unknown>;
  if (!Array.isArray(r.mine) || !Array.isArray(r.open) || !str(official.name)) return { kind: "error" };
  const mine: MineGame[] = [];
  for (const m of r.mine as Record<string, unknown>[]) {
    const g = game(m ?? {});
    const gu = str(m?.game_umpire_id);
    if (!g || !gu) return { kind: "error" };
    mine.push({ ...g, game_umpire_id: gu, self_claimed: m.self_claimed === true, can_drop: m.can_drop === true });
  }
  const open: OpenSpot[] = [];
  for (const o of r.open as Record<string, unknown>[]) {
    const g = game(o ?? {});
    const roleId = str(o?.role_id);
    if (!g || !roleId) return { kind: "error" };
    open.push({ ...g, role_id: roleId, problem: str(o.problem) });
  }
  return {
    kind: "ok",
    page: {
      officialName: str(official.name)!,
      youth: official.youth === true,
      leagueName: str(r.league_name) ?? "Your league",
      seasonName: str(r.season_name) ?? "",
      contactEmail: str(r.contact_email),
      mine,
      open,
    },
  };
}

/** "Sat, Oct 10 · 9:00 AM" */
export function gameWhen(g: Pick<GameInfo, "start">): string {
  return `${fmtGameDate(g.start)} · ${fmtGameTime(g.start)}`;
}

/** "Majors · Expos vs Pirates · Monroe — Field 2" (pieces that exist). */
export function gameWhat(g: GameInfo): string {
  const matchup = g.home && g.away ? `${g.home} vs ${g.away}` : g.home ?? g.away ?? "";
  return [g.division, matchup, g.field].filter((x) => x && x.length > 0).join(" · ");
}

/** The spots the official can take, and the ones they can't (with why). */
export function splitOpen(open: readonly OpenSpot[]): { canTake: OpenSpot[]; cannot: { spot: OpenSpot; line: string }[] } {
  const canTake: OpenSpot[] = [];
  const cannot: { spot: OpenSpot; line: string }[] = [];
  for (const s of open) {
    if (s.problem === null) canTake.push(s);
    else cannot.push({ spot: s, line: W.PROBLEM_LINES[s.problem] ?? W.NOT_OPEN });
  }
  return { canTake, cannot };
}

/** A game on the official's list: Drop, or why not. */
export function mineAction(g: MineGame, contact: string | null): { kind: "drop" } | { kind: "closed"; line: string } {
  if (g.can_drop) return { kind: "drop" };
  return { kind: "closed", line: g.self_claimed ? W.changeClosed(contact) : W.assignedByLeague(contact) };
}

export type Outcome = { ok: boolean; line: string };

/** The claim route's reply, worded. Only "claimed" is a success. */
export function claimOutcome(raw: unknown): Outcome {
  const status = raw && typeof raw === "object" ? (raw as Record<string, unknown>).status : null;
  switch (status) {
    case "claimed":
      return { ok: true, line: W.CLAIMED };
    case "just_taken":
    case "slot_taken":
      return { ok: false, line: W.JUST_TAKEN };
    case "started":
      return { ok: false, line: W.STARTED };
    case "too_many":
      return { ok: false, line: W.TOO_MANY };
    case "unknown":
      return { ok: false, line: W.PAGE_UNKNOWN };
    case "not_open":
    case "unpublished":
    case "no_slot":
    case "no_game":
      return { ok: false, line: W.NOT_OPEN };
    default:
      if (typeof status === "string" && W.PROBLEM_LINES[status]) return { ok: false, line: W.PROBLEM_LINES[status] };
      return { ok: false, line: W.SOMETHING_WRONG };
  }
}

/** The drop route's reply, worded. Only "dropped" is a success. */
export function dropOutcome(raw: unknown, contactFallback: string | null): Outcome {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const contact = str(r.contact_email) ?? contactFallback;
  switch (r.status) {
    case "dropped":
      return { ok: true, line: W.DROPPED };
    case "change_closed":
      return { ok: false, line: W.changeClosed(contact) };
    case "not_self_claimed":
      return { ok: false, line: W.assignedByLeague(contact) };
    case "not_found":
      return { ok: false, line: W.NOT_ON_LIST };
    case "unknown":
      return { ok: false, line: W.PAGE_UNKNOWN };
    default:
      return { ok: false, line: W.SOMETHING_WRONG };
  }
}

/** The help request's reply → the lines the dialog shows. A reply that isn't
 *  {queued, skipped[]} is a failure ("nobody was emailed" is never assumed). */
export function helpResultLines(raw: unknown): { ok: boolean; lines: string[] } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.queued !== "number" || !Array.isArray(r.skipped)) return { ok: false, lines: [W.HELP_FAILED] };
  const lines = [W.helpSentLine(r.queued)];
  for (const s of r.skipped as Record<string, unknown>[]) {
    lines.push(W.helpSkippedLine(str(s?.name) ?? "An official", str(s?.reason) ?? ""));
  }
  return { ok: true, lines };
}
