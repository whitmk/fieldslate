// Interleague Case A — a SIGNED-IN FieldSlate league accepting an invite onto
// its own schedule. Every decision the signed-in invite page makes lives here,
// pure and sim-driven (npm run sim:invite-page, parts S/B/P); the page and the
// form only call these. The anonymous page is untouched by this module.
//
// The identifier is the LINK, not the email address: whoever holds the token
// and is signed in is the right person by definition. Matching the invite's
// recipient email to an account is NOT the mechanism.

import { formatLockError, isDivisionLockError, lockedReason } from "@/lib/schedule/division-lock";

/** A pending host game as get_interleague_invite_by_token emits it. */
export type HostGame = {
  id: string;
  scheduled_at: string;
  /** From the HOST's perspective. `true` ⇒ the host travels ⇒ WE host. */
  is_away: boolean;
  external_team_name: string | null;
  proposed_scheduled_at: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string };
  division: { id: string; name: string };
  venue: { name: string; location: { name: string } | null } | null;
};

export type OurDivision = { id: string; name: string; locked: boolean };
export type OurTeam = { id: string; name: string; division_id: string | null };
export type OurVenue = { id: string; name: string; location: { name: string | null } | null };
export type OurSeason = { id: string; name: string; season: string | null };

export type GameAction = "accept" | "counter" | "decline";
export type GameChoice = {
  action: GameAction;
  team_id: string | null;
  venue_id: string | null;
  /** datetime-local value when countering. */
  proposed_iso: string;
};

/** host division id → our division id (null = not chosen yet). */
export type DivisionMap = Record<string, string | null>;

// ── Page mode ────────────────────────────────────────────────────────────────

export type PageMode = "anonymous" | "signed_in";

/**
 * Anonymous unless a user is signed in AND the escape hatch (`?anon=1`) is
 * not set. The escape hatch exists because someone may open the link while
 * signed into a different org; it must never require signing out.
 */
export function pageMode(
  userId: string | null | undefined,
  anonParam: string | string[] | undefined,
): PageMode {
  if (!userId) return "anonymous";
  const v = Array.isArray(anonParam) ? anonParam[0] : anonParam;
  if (v === "1") return "anonymous";
  return "signed_in";
}

/** The escape-hatch href for a token. */
export function anonymousHref(token: string): string {
  return `/invite/${encodeURIComponent(token)}?anon=1`;
}

// ── Identity ─────────────────────────────────────────────────────────────────

export function identityLabel(
  fullName: string | null | undefined,
  email: string | null | undefined,
  orgName: string,
): string {
  const who = fullName?.trim() || email?.trim() || "you";
  return `Signed in as ${who} · ${orgName}`;
}

/**
 * The host LEAGUE name for the partner card, from the (0097) read payload:
 * org_name → the admin's name → email → a literal. Mirrors the wrapper RPC's
 * own coalesce so the page names the same card the RPC will create.
 */
export function hostLeagueName(sender: {
  org_name?: string | null;
  full_name?: string | null;
  email?: string | null;
} | null): string {
  return (
    sender?.org_name?.trim() ||
    sender?.full_name?.trim() ||
    sender?.email?.trim() ||
    "the host league"
  );
}

// ── Readiness (the empty states are the common case, not the edge) ───────────

export type Readiness = "no_season" | "no_divisions" | "no_teams" | "ready";

export function readiness(input: {
  seasonCount: number;
  divisions: OurDivision[];
  teams: OurTeam[];
}): Readiness {
  if (input.seasonCount === 0) return "no_season";
  if (input.divisions.length === 0) return "no_divisions";
  if (input.teams.length === 0) return "no_teams";
  return "ready";
}

// ── Division mapping ─────────────────────────────────────────────────────────

/** True when WE host this game (the host marked it away). Our field is then
 *  required and our row gets a real venue_id. */
export function weHost(game: HostGame): boolean {
  return game.is_away;
}

/** Distinct host divisions, first-seen order. */
export function hostDivisions(games: HostGame[]): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const g of games) {
    if (seen.has(g.division.id)) continue;
    seen.add(g.division.id);
    out.push({ id: g.division.id, name: g.division.name });
  }
  return out;
}

/**
 * Case-insensitive, trimmed exact name match — a DEFAULT, never an
 * inference: the data supports "Majors ↔ Majors" and fails on "AA ↔ Minors",
 * so the admin can always override in the picker. Null when nothing matches.
 */
export function defaultDivisionMatch(
  hostDivisionName: string,
  ours: OurDivision[],
): string | null {
  const key = hostDivisionName.trim().toLowerCase();
  if (!key) return null;
  const hit = ours.find((d) => d.name.trim().toLowerCase() === key);
  return hit ? hit.id : null;
}

export function defaultDivisionMap(games: HostGame[], ours: OurDivision[]): DivisionMap {
  const map: DivisionMap = {};
  for (const d of hostDivisions(games)) map[d.id] = defaultDivisionMatch(d.name, ours);
  return map;
}

/** The team dropdown for a game: only teams in the division mapped for the
 *  game's host division. Unmapped ⇒ no options (the mapping blocker shows). */
export function teamsForHostGame(
  game: HostGame,
  divisionMap: DivisionMap,
  teams: OurTeam[],
): OurTeam[] {
  const ours = divisionMap[game.division.id] ?? null;
  if (!ours) return [];
  return teams.filter((t) => t.division_id === ours);
}

// ── Blockers: why Accept is disabled, per game ───────────────────────────────

export type BlockerKind = "division" | "team" | "venue" | "time" | "locked";
export type Blocker = { gameId: string; kind: BlockerKind; message: string };

export function gameBlockers(
  game: HostGame,
  choice: GameChoice | undefined,
  divisionMap: DivisionMap,
  divisions: OurDivision[],
  teams: OurTeam[],
): Blocker[] {
  const c = choice ?? { action: "accept", team_id: null, venue_id: null, proposed_iso: "" };
  if (c.action === "decline") return [];
  const out: Blocker[] = [];
  const ourDivId = divisionMap[game.division.id] ?? null;
  const ourDiv = ourDivId ? divisions.find((d) => d.id === ourDivId) ?? null : null;
  if (!ourDiv) {
    out.push({
      gameId: game.id,
      kind: "division",
      message: `Pick which of your divisions plays ${game.division.name}.`,
    });
  } else {
    const options = teamsForHostGame(game, divisionMap, teams);
    if (!c.team_id || !options.some((t) => t.id === c.team_id)) {
      out.push({ gameId: game.id, kind: "team", message: "Pick your team." });
    }
    // A locked division refuses the INSERT at the trigger; say so here rather
    // than fail on save. Counters and declines write nothing on our side.
    if (c.action === "accept" && ourDiv.locked) {
      out.push({ gameId: game.id, kind: "locked", message: lockedReason(ourDiv.name, "add") });
    }
  }
  if (weHost(game) && !c.venue_id) {
    out.push({ gameId: game.id, kind: "venue", message: "Pick the field you'll host at." });
  }
  if (c.action === "counter" && !c.proposed_iso) {
    out.push({ gameId: game.id, kind: "time", message: "Pick the time you're proposing." });
  }
  return out;
}

/** Games that still have at least one blocker. */
export function unmappedCount(
  games: HostGame[],
  choices: Record<string, GameChoice>,
  divisionMap: DivisionMap,
  divisions: OurDivision[],
  teams: OurTeam[],
): number {
  let n = 0;
  for (const g of games) {
    if (gameBlockers(g, choices[g.id], divisionMap, divisions, teams).length > 0) n++;
  }
  return n;
}

/** Accept is DISABLED until every non-declined game is fully mapped, and
 *  at least one game is not declined (declining everything is the separate
 *  "Decline this invite" action, exactly as on the anonymous page). */
export function acceptEnabled(
  games: HostGame[],
  choices: Record<string, GameChoice>,
  divisionMap: DivisionMap,
  divisions: OurDivision[],
  teams: OurTeam[],
  submitting: boolean,
): boolean {
  if (submitting || games.length === 0) return false;
  if (!games.some((g) => (choices[g.id]?.action ?? "accept") !== "decline")) return false;
  return unmappedCount(games, choices, divisionMap, divisions, teams) === 0;
}

/** "3 games still need a team, field or time" — the count beside Accept. */
export function remainingLabel(n: number): string {
  if (n === 0) return "";
  return `${n} game${n === 1 ? "" : "s"} still need${n === 1 ? "s" : ""} a team, field or time`;
}

// ── The request payload ──────────────────────────────────────────────────────

/** One element of p_games for accept_interleague_invite_as_member. There is
 *  deliberately NO away_team_id anywhere in this shape: the other league's
 *  team is text (external_team_name), never a foreign row. */
export type MemberGameInput = {
  game_id: string;
  action: GameAction;
  team_id?: string;
  venue_id?: string;
  proposed_scheduled_at?: string;
};

/** Strip the time half off and convert to the format <input type="datetime-local"> expects. */
export function isoToLocalDatetime(iso: string): string {
  return iso.substring(0, 16);
}

/** Convert a datetime-local value back to a wall-clock-UTC ISO string (the
 *  codebase's +00:00-as-literal-marker convention). */
export function localDatetimeToIso(local: string): string {
  if (!local) return "";
  return `${local}:00+00:00`;
}

export function buildMemberPayload(
  games: HostGame[],
  choices: Record<string, GameChoice>,
): MemberGameInput[] {
  const out: MemberGameInput[] = [];
  for (const g of games) {
    const c = choices[g.id];
    if (!c) continue;
    if (c.action === "decline") {
      out.push({ game_id: g.id, action: "decline" });
      continue;
    }
    const item: MemberGameInput = { game_id: g.id, action: c.action };
    if (c.team_id) item.team_id = c.team_id;
    if (weHost(g) && c.venue_id) item.venue_id = c.venue_id;
    if (c.action === "counter" && c.proposed_iso) {
      item.proposed_scheduled_at = localDatetimeToIso(c.proposed_iso);
    }
    out.push(item);
  }
  return out;
}

export function summarizeChoices(
  games: HostGame[],
  choices: Record<string, GameChoice>,
): { accepted: number; countered: number; declined: number } {
  let accepted = 0;
  let countered = 0;
  let declined = 0;
  for (const g of games) {
    const a = choices[g.id]?.action ?? "accept";
    if (a === "accept") accepted++;
    else if (a === "counter") countered++;
    else declined++;
  }
  return { accepted, countered, declined };
}

// ── Error translation (the wrapper's tags → sentences) ───────────────────────

const RPC_MESSAGES: Record<string, { status: number; message: string }> = {
  not_authenticated: { status: 401, message: "Sign in to accept onto your schedule." },
  invite_not_found: { status: 404, message: "This invite link is no longer valid." },
  invite_not_pending: { status: 409, message: "This invite has already been responded to." },
  own_invite: {
    status: 403,
    message:
      "You're signed into the league that sent this invite. Switch to the league that received it, or respond without signing in.",
  },
  league_not_found: { status: 404, message: "That season wasn't found in your league." },
  league_archived: { status: 409, message: "That season is archived. Pick an active season." },
  not_org_member: { status: 403, message: "You're not a member of that league." },
  game_not_in_invite: { status: 409, message: "One of these games is no longer part of the invite. Reload and try again." },
  team_not_found: { status: 400, message: "One of the teams you picked isn't in that season. Reload and try again." },
  venue_required: { status: 400, message: "Pick the field you'll host at for every game you host." },
  venue_not_found: { status: 400, message: "One of the fields you picked isn't in your league. Reload and try again." },
  host_games_changed: {
    status: 409,
    message:
      "The host changed these games while you were responding. Nothing was saved — reload to see the current games.",
  },
  host_contact_unknown: { status: 500, message: "We couldn't identify the host league's contact. Nothing was saved." },
};

/** Map a wrapper-RPC error message to an HTTP status and a sentence. A lock
 *  refusal from the 0082 trigger is translated with the shared helper; an
 *  unknown message is passed through so it is never swallowed. */
export function memberErrorResponse(message: string | null | undefined): {
  status: number;
  message: string;
} {
  const msg = (message ?? "").trim();
  if (isDivisionLockError(msg)) {
    return { status: 409, message: `${formatLockError(msg)} Nothing was saved.` };
  }
  for (const tag of Object.keys(RPC_MESSAGES)) {
    if (msg === tag || msg.includes(tag)) return RPC_MESSAGES[tag];
  }
  return { status: 500, message: msg || "Failed to submit response." };
}
