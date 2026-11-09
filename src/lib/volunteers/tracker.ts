// The volunteer tracker (/dashboard/volunteers/tracker, 0123) — every
// decision the screen shows, pure, so sim:volunteer-tracker drives the same
// rules the page renders. The COUNTS (worked / upcoming / no-shows / held per
// family) come only from the database (`volunteer_tracker`); this file turns
// them into buckets, team rows, tiles, labels, outcomes and the CSV.
//
// Approved plan: docs/plans/volunteer-tracker-0123.md (2026-11-09), against
// docs/mockups/volunteer-signup/AdminTracker. Board conflicts resolved there:
// buckets are exclusive (met is never also on track); Short N = goal −
// (worked + upcoming); a team's progress is "of <its family count>"; merge
// lives here only; official-only families can't be nudged.
import * as W from "./words";

export type TrackerMember =
  | { kind: "volunteer"; id: string; first_initial: string; last_name: string; email: string; manual: boolean }
  | { kind: "official"; id: string; name: string; manual: boolean; matched_volunteer_id: string | null; by_email: boolean };

export type TrackerFamily = {
  key: string;
  members: TrackerMember[];
  team_ids: string[];
  worked: number;
  upcoming: number;
  no_shows: number;
  held: number;
};

export type OfficialGame = {
  game_umpire_id: string;
  start: string;
  status: string;
  home_team_id: string | null;
  away_team_id: string | null;
  external_team_name: string | null;
  no_show: boolean;
};

export type TrackerOfficial = {
  umpire_id: string;
  name: string;
  counts_for_team_id: string | null;
  matched_volunteer_id: string | null;
  games: OfficialGame[];
};

export type TrackerData = {
  season_id: string;
  today: string;
  link_enabled: boolean;
  goal: { shifts_per_family: number | null; officials_count: boolean };
  roles: { id: string; name: string; kind: string; counts_toward_goal: boolean }[];
  team_counts: { team_id: string; families: number }[];
  families: TrackerFamily[];
  officials: TrackerOfficial[];
  nudged: { volunteer_id: string; on: string }[];
};

export type TrackerTeam = { id: string; name: string };

// ── Reading the reply (fail closed) ──────────────────────────────────────────
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;
const isDate = (x: unknown): x is string => isStr(x) && /^\d{4}-\d{2}-\d{2}$/.test(x);

function member(x: unknown): TrackerMember | null {
  if (!isObj(x) || !isStr(x.id)) return null;
  if (x.kind === "volunteer") {
    if (!isStr(x.first_initial) || !isStr(x.last_name) || !isStr(x.email)) return null;
    return { kind: "volunteer", id: x.id, first_initial: x.first_initial, last_name: x.last_name, email: x.email, manual: x.manual === true };
  }
  if (x.kind === "official") {
    if (!isStr(x.name)) return null;
    return {
      kind: "official",
      id: x.id,
      name: x.name,
      manual: x.manual === true,
      matched_volunteer_id: isStr(x.matched_volunteer_id) ? x.matched_volunteer_id : null,
      by_email: x.by_email === true,
    };
  }
  return null;
}

/** The tracker reply, or null when anything about it is off — the screen then
 *  shows one error card, never partial numbers. */
export function parseTracker(raw: unknown): TrackerData | null {
  if (!isObj(raw) || !isStr(raw.season_id) || !isDate(raw.today) || typeof raw.link_enabled !== "boolean") return null;
  const g = raw.goal;
  if (!isObj(g) || typeof g.officials_count !== "boolean") return null;
  if (!(g.shifts_per_family === null || (isInt(g.shifts_per_family) && g.shifts_per_family >= 1 && g.shifts_per_family <= 20))) return null;
  const arrays = [raw.roles, raw.team_counts, raw.families, raw.officials, raw.nudged];
  if (!arrays.every(Array.isArray)) return null;
  const roles: TrackerData["roles"] = [];
  for (const r of raw.roles as unknown[]) {
    if (!isObj(r) || !isStr(r.id) || !isStr(r.name) || !isStr(r.kind) || typeof r.counts_toward_goal !== "boolean") return null;
    roles.push({ id: r.id, name: r.name, kind: r.kind, counts_toward_goal: r.counts_toward_goal });
  }
  const team_counts: TrackerData["team_counts"] = [];
  for (const t of raw.team_counts as unknown[]) {
    if (!isObj(t) || !isStr(t.team_id) || !isInt(t.families)) return null;
    team_counts.push({ team_id: t.team_id, families: t.families });
  }
  const families: TrackerFamily[] = [];
  for (const f of raw.families as unknown[]) {
    if (!isObj(f) || !isStr(f.key) || !Array.isArray(f.members) || !Array.isArray(f.team_ids)) return null;
    if (![f.worked, f.upcoming, f.no_shows, f.held].every(isInt)) return null;
    const members = (f.members as unknown[]).map(member);
    if (members.length === 0 || members.some((m) => m === null)) return null;
    if (!(f.team_ids as unknown[]).every(isStr)) return null;
    families.push({
      key: f.key,
      members: members as TrackerMember[],
      team_ids: f.team_ids as string[],
      worked: f.worked as number,
      upcoming: f.upcoming as number,
      no_shows: f.no_shows as number,
      held: f.held as number,
    });
  }
  const officials: TrackerOfficial[] = [];
  for (const o of raw.officials as unknown[]) {
    if (!isObj(o) || !isStr(o.umpire_id) || !isStr(o.name) || !Array.isArray(o.games)) return null;
    const games: OfficialGame[] = [];
    for (const x of o.games as unknown[]) {
      if (!isObj(x) || !isStr(x.game_umpire_id) || !isStr(x.start) || !isStr(x.status) || typeof x.no_show !== "boolean") return null;
      games.push({
        game_umpire_id: x.game_umpire_id,
        start: x.start,
        status: x.status,
        home_team_id: isStr(x.home_team_id) ? x.home_team_id : null,
        away_team_id: isStr(x.away_team_id) ? x.away_team_id : null,
        external_team_name: isStr(x.external_team_name) ? x.external_team_name : null,
        no_show: x.no_show,
      });
    }
    officials.push({
      umpire_id: o.umpire_id,
      name: o.name,
      counts_for_team_id: isStr(o.counts_for_team_id) ? o.counts_for_team_id : null,
      matched_volunteer_id: isStr(o.matched_volunteer_id) ? o.matched_volunteer_id : null,
      games,
    });
  }
  const nudged: TrackerData["nudged"] = [];
  for (const n of raw.nudged as unknown[]) {
    if (!isObj(n) || !isStr(n.volunteer_id) || !isDate(n.on)) return null;
    nudged.push({ volunteer_id: n.volunteer_id, on: n.on });
  }
  return {
    season_id: raw.season_id,
    today: raw.today,
    link_enabled: raw.link_enabled,
    goal: { shifts_per_family: g.shifts_per_family as number | null, officials_count: g.officials_count },
    roles,
    team_counts,
    families,
    officials,
    nudged,
  };
}

// ── Status ───────────────────────────────────────────────────────────────────
export type Bucket = "met" | "on_track" | "short";
export type FamilyStatus = { bucket: Bucket; short: number };

/** Exclusive buckets (decided 2026-11-09): met when the shifts WORKED reach
 *  the goal; on track when worked + upcoming do; otherwise short by the rest.
 *  Null when no goal is set. */
export function familyStatus(goal: number | null, f: Pick<TrackerFamily, "worked" | "upcoming">): FamilyStatus | null {
  if (goal === null) return null;
  if (f.worked >= goal) return { bucket: "met", short: 0 };
  if (f.worked + f.upcoming >= goal) return { bucket: "on_track", short: 0 };
  return { bucket: "short", short: goal - (f.worked + f.upcoming) };
}

export function statusLabel(s: FamilyStatus | null): string {
  if (!s) return W.STATUS_NONE;
  if (s.bucket === "met") return W.STATUS_MET;
  if (s.bucket === "on_track") return W.STATUS_ON_TRACK;
  return W.STATUS_SHORT(s.short);
}

// ── Names ────────────────────────────────────────────────────────────────────
export function memberLabel(m: TrackerMember): string {
  return m.kind === "volunteer" ? `${m.first_initial.toUpperCase()}. ${m.last_name}` : W.FAMILY_OFFICIAL(m.name);
}

/** The family's name: the last name of its first volunteer (the database
 *  orders volunteers by their first sign-up, officials last); an
 *  official-only family is the official. */
export function familyName(f: Pick<TrackerFamily, "members">): string {
  const v = f.members.find((m) => m.kind === "volunteer");
  if (v && v.kind === "volunteer") return v.last_name;
  return memberLabel(f.members[0]);
}

export function teamsLabel(f: Pick<TrackerFamily, "team_ids">, teamName: ReadonlyMap<string, string>): string {
  return f.team_ids
    .map((id) => teamName.get(id))
    .filter((n): n is string => typeof n === "string")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(", ");
}

/** A family can be nudged only when it has a volunteer (officials never
 *  signed up for volunteer emails). */
export function nudgeable(f: Pick<TrackerFamily, "members">): boolean {
  return f.members.some((m) => m.kind === "volunteer");
}

export function nudgeVolunteerIds(families: readonly Pick<TrackerFamily, "members">[]): string[] {
  const ids = new Set<string>();
  for (const f of families) for (const m of f.members) if (m.kind === "volunteer") ids.add(m.id);
  return [...ids].sort();
}

/** "Nudged Nov 9" — the latest nudge to any of the family's volunteers. */
export function nudgedLine(f: Pick<TrackerFamily, "members">, nudged: readonly { volunteer_id: string; on: string }[]): string | null {
  const ids = new Set(f.members.filter((m) => m.kind === "volunteer").map((m) => m.id));
  const dates = nudged.filter((n) => ids.has(n.volunteer_id)).map((n) => n.on).sort();
  return dates.length === 0 ? null : W.FAMILY_NUDGED(shortDate(dates[dates.length - 1]));
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 9" from "2026-11-09" — no Date parsing. */
export function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${MON[+m[2] - 1]} ${+m[3]}` : d;
}

// ── Sorting and filters ──────────────────────────────────────────────────────
export type FamilyFilter = "all" | "met" | "short";

export function familyRows(data: Pick<TrackerData, "families" | "goal">, filter: FamilyFilter): TrackerFamily[] {
  const goal = data.goal.shifts_per_family;
  return data.families
    .filter((f) => {
      if (filter === "all") return true;
      const s = familyStatus(goal, f);
      if (!s) return false;
      return filter === "met" ? s.bucket === "met" : s.bucket === "short";
    })
    .slice()
    .sort((a, b) => {
      const na = familyName(a).toLowerCase();
      const nb = familyName(b).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}

// ── Tiles and the by-team table ──────────────────────────────────────────────
export type Tiles = { met: number; onTrack: number; short: number; notSignedUp: number | null };

export type TeamRow = {
  teamId: string;
  name: string;
  /** The team's family count, or null when none is set. */
  families: number | null;
  signedUp: number;
  met: number;
  onTrack: number;
  short: number;
  /** Families not signed up (only with a count). */
  notSignedUp: number | null;
};

export function teamRows(data: Pick<TrackerData, "families" | "team_counts" | "goal">, teams: readonly TrackerTeam[]): TeamRow[] {
  const goal = data.goal.shifts_per_family;
  const count = new Map(data.team_counts.map((t) => [t.team_id, t.families]));
  return teams
    .map((t) => {
      const fams = data.families.filter((f) => f.team_ids.includes(t.id));
      let met = 0;
      let onTrack = 0;
      let short = 0;
      for (const f of fams) {
        const s = familyStatus(goal, f);
        if (!s) continue;
        if (s.bucket === "met") met++;
        else if (s.bucket === "on_track") onTrack++;
        else short++;
      }
      const families = count.get(t.id) ?? null;
      return {
        teamId: t.id,
        name: t.name,
        families,
        signedUp: fams.length,
        met,
        onTrack,
        short,
        notSignedUp: families === null ? null : Math.max(0, families - fams.length),
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.teamId < b.teamId ? -1 : 1));
}

export function progressLine(row: TeamRow, goalSet: boolean): string {
  if (!goalSet) return W.PROGRESS_NO_GOAL(row.signedUp);
  return row.families === null
    ? W.PROGRESS_OF_SIGNED(row.met, row.onTrack, row.signedUp)
    : W.PROGRESS_OF_COUNT(row.met, row.onTrack, row.families);
}

/** Each family once (a family on two teams is one family here). */
export function tiles(data: Pick<TrackerData, "families" | "team_counts" | "goal">, teams: readonly TrackerTeam[]): Tiles {
  const goal = data.goal.shifts_per_family;
  let met = 0;
  let onTrack = 0;
  let short = 0;
  for (const f of data.families) {
    const s = familyStatus(goal, f);
    if (!s) continue;
    if (s.bucket === "met") met++;
    else if (s.bucket === "on_track") onTrack++;
    else short++;
  }
  const rows = teamRows(data, teams).filter((r) => r.notSignedUp !== null);
  return { met, onTrack, short, notSignedUp: rows.length === 0 ? null : rows.reduce((n, r) => n + (r.notSignedUp ?? 0), 0) };
}

export function whatCounts(data: Pick<TrackerData, "roles" | "goal">, officialsTitle: string): string[] {
  const names = data.roles.filter((r) => r.counts_toward_goal).map((r) => r.name);
  if (data.goal.officials_count) names.push(officialsTitle);
  return names;
}

/** A typed family count: blank → null (clear), 1–60 → the number, else
 *  "invalid". */
export function parseFamilyCount(text: string): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,2}$/.test(t)) return "invalid";
  const n = Number(t);
  return n >= 1 && n <= 60 ? n : "invalid";
}

export function parseGoal(text: string): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,2}$/.test(t)) return "invalid";
  const n = Number(t);
  return n >= 1 && n <= 20 ? n : "invalid";
}

// ── Officials panel ──────────────────────────────────────────────────────────
export type OfficialRow = {
  umpireId: string;
  name: string;
  countsForTeamId: string | null;
  matchedLine: string | null;
  past: { id: string; when: string; matchup: string; noShow: boolean; played: boolean }[];
  upcoming: number;
};

/** A game is past when its date is before today (league timezone) — the
 *  same day rule the database uses for "worked" and for allowing a no-show. */
export function officialRows(
  data: Pick<TrackerData, "officials" | "families" | "today">,
  teamName: ReadonlyMap<string, string>,
): OfficialRow[] {
  const volunteerLabel = new Map<string, string>();
  for (const f of data.families) for (const m of f.members) if (m.kind === "volunteer") volunteerLabel.set(m.id, memberLabel(m));
  return data.officials.map((o) => {
    const past = o.games.filter((g) => g.start.slice(0, 10) < data.today);
    const matched = o.matched_volunteer_id ? volunteerLabel.get(o.matched_volunteer_id) ?? null : null;
    return {
      umpireId: o.umpire_id,
      name: o.name,
      countsForTeamId: o.counts_for_team_id,
      matchedLine: matched ? W.OFFICIAL_MATCHED(matched) : null,
      past: past.map((g) => ({
        id: g.game_umpire_id,
        when: whenLabel(g.start),
        matchup: matchupLabel(g, teamName),
        noShow: g.no_show,
        played: g.status !== "cancelled",
      })),
      upcoming: o.games.filter((g) => g.start.slice(0, 10) >= data.today && g.status !== "cancelled").length,
    };
  });
}

function matchupLabel(g: OfficialGame, teamName: ReadonlyMap<string, string>): string {
  const home = g.home_team_id ? teamName.get(g.home_team_id) ?? "" : "";
  const away = g.away_team_id ? teamName.get(g.away_team_id) ?? "" : g.external_team_name ?? "";
  return [home, away].filter(Boolean).join(" vs ");
}

/** "Sat 11/14 · 9:00 AM" from a wall clock. */
export function whenLabel(wall: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return wall;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  const h = +m[4];
  return `${day} ${+m[2]}/${+m[3]} · ${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h < 12 ? "AM" : "PM"}`;
}

// ── Replies ──────────────────────────────────────────────────────────────────
export type Outcome = { ok: boolean; text: string };

const statusOf = (raw: unknown): string | null => (isObj(raw) && isStr(raw.status) ? raw.status : null);

export function nudgeOutcome(raw: unknown): Outcome {
  const s = statusOf(raw);
  if (s === "link_off") return { ok: false, text: W.NUDGE_LINK_OFF };
  if (s === "no_goal") return { ok: false, text: W.NUDGE_NO_GOAL };
  if (s !== "queued" || !isObj(raw) || !isInt(raw.queued) || !Array.isArray(raw.recent)) return { ok: false, text: W.NUDGE_FAILED };
  const recent = raw.recent.length;
  if (raw.queued === 0) return recent > 0 ? { ok: false, text: W.NUDGE_NONE_SENT } : { ok: false, text: W.NUDGE_FAILED };
  return { ok: true, text: W.NUDGE_SENT(raw.queued) + (recent > 0 ? W.NUDGE_RECENT(recent) : "") };
}

export function mergeOutcome(raw: unknown, commit: boolean): Outcome {
  const s = statusOf(raw);
  if (s === "same_family") return { ok: false, text: W.MERGE_SAME };
  if (s === "not_found") return { ok: false, text: W.MERGE_GONE };
  if (!commit) return s === "ready" ? { ok: true, text: "" } : { ok: false, text: W.MERGE_FAILED };
  return s === "merged" ? { ok: true, text: W.MERGED } : { ok: false, text: W.MERGE_FAILED };
}

export function separateOutcome(raw: unknown): Outcome {
  return statusOf(raw) === "separated" ? { ok: true, text: W.SEPARATED } : { ok: false, text: W.SEPARATE_FAILED };
}

export function savedOutcome(raw: unknown, failText: string): Outcome {
  const s = statusOf(raw);
  if (s === "saved") return { ok: true, text: "" };
  if (s === "not_past") return { ok: false, text: W.OFFICIAL_NOT_PAST };
  return { ok: false, text: failText };
}

// ── The admin CSV (an allowed export; formula cells made inert) ──────────────
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function trackerCsv(data: Pick<TrackerData, "families" | "goal">, teamName: ReadonlyMap<string, string>): string {
  const lines = [W.TRACKER_CSV_HEAD.join(",")];
  for (const f of familyRows(data, "all")) {
    const emails = f.members.filter((m) => m.kind === "volunteer").map((m) => (m.kind === "volunteer" ? m.email : ""));
    lines.push(
      [
        familyName(f),
        f.members.map(memberLabel).join("; "),
        emails.join("; "),
        teamsLabel(f, teamName).replace(/, /g, "; "),
        String(f.worked),
        String(f.upcoming),
        String(f.no_shows),
        statusLabel(familyStatus(data.goal.shifts_per_family, f)),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
