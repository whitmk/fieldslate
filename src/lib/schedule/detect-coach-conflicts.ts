// Cross-division shared-coach conflict DETECTOR (Chunk 3).
//
// Purely additive and read-only: it reads a FINISHED schedule (persisted
// games) plus the coach-link data in divisions.settings and reports any two
// games that a shared coach could not physically attend. It does NOT touch
// placement (planSchedule/finishSchedule), the generator's coach-block map, or
// any generation code — those prevent overlaps during scheduling; this catches
// the residue.
//
// Why a detector is needed even though the generator has a coach-block map:
// that protection is ORDER-DEPENDENT. The map seeds a division's blocked times
// from the LINKED team's already-persisted games (generate-schedule.ts:836-848),
// so a coach spanning two divisions is only protected if the divisions happen
// to generate in an order where the linked team's games already exist. Generate
// them the other way (or regenerate one division in isolation) and a clash slips
// through silently. This detector runs after generation and surfaces it.
//
// This file is intentionally standalone from generate-schedule.ts (which pulls
// in the browser Supabase client). The pure functions here are server- and
// browser-safe; the one async entry point takes an injected client.
//
// ─── How it differs from detectScheduleConflicts (the venue detector) ────────
//   • Venue detector groups by (venue_id, day) and flags games at the SAME
//     field that overlap. A coach clash is venue-INDEPENDENT — the coach can't
//     be at two overlapping games even on adjacent fields — so this groups by
//     COACH instead and ignores venue entirely.
//   • Overlap window: the venue detector uses the division's own
//     game_duration + buffer_minutes. A coach's window is DIFFERENT by design
//     (see COACH_TRANSITION_PAD_MINUTES).
//
// ─── Resolution note (deliberate divergence from the generator) ──────────────
// The generator resolves conflict_team by a LEAGUE-WIDE `.ilike(name).maybeSingle()`
// (generate-schedule.ts:826-832), which silently drops the link if two teams
// anywhere in the league share a name. The wizard actually stores the linked
// team's DIVISION id in conflict_division alongside the name (step-coaches.tsx),
// so here we resolve by (conflict_division + name) first — precise, collision-
// proof — and fall back to a league-wide name match only for legacy rows that
// lack conflict_division. A detector should be at least as accurate as the
// thing it audits.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

// Flat transition pad, in minutes, added AFTER a game's end for the coach
// check — NOT the division's turnover buffer_minutes. A coach needs
// transition/drive time between games; turnover buffers vary too much by age
// group to be the right number for a person moving between fields. Decided
// 2026-07-22. Known accepted behavior: two same-complex games an hour apart
// get flagged even when the coach could walk over trivially — intended; the
// detector surfaces it and the admin dismisses the obviously-fine ones. The
// detector is deliberately NOT distance-aware.
export const COACH_TRANSITION_PAD_MINUTES = 60;

// ─── Public types ────────────────────────────────────────────────────────────

// One generated game, annotated with the duration of ITS OWN division (games
// has no division_id — duration comes from the home team's division, the same
// scoping getDivisionGameCounts / the generator use).
export interface CoachConflictInputGame {
  id: string;
  scheduledAt: string; // "YYYY-MM-DDTHH:MM:SS" — naive local wall-clock
  homeTeamId: string;
  awayTeamId: string | null; // null for interleague matchups (no local away team)
  homeTeamName: string;
  awayTeamName: string;
  durationMinutes: number; // this game's own division game_duration
  divisionId?: string;
  divisionName?: string;
}

export interface CoachConflictGameRef {
  id: string;
  timeLabel: string; // "9:00 AM"
  homeTeam: string;
  awayTeam: string;
  divisionId?: string;
  divisionName?: string;
}

export interface CoachConflict {
  // The two same-coach teams whose games collide (order matches games[]).
  teamIds: [string, string];
  teamNames: [string, string];
  date: string; // "YYYY-MM-DD" of the earlier game
  games: [CoachConflictGameRef, CoachConflictGameRef];
}

// ─── Coach-group assembly (item 1 — the crux) ────────────────────────────────

export interface DivisionForCoachGroups {
  id: string;
  name: string;
  settings: unknown; // divisions.settings jsonb
}

export interface TeamForCoachGroups {
  id: string;
  name: string;
  division_id: string | null;
}

interface SettingsTeamEntry {
  name?: string;
  has_coach_conflict?: boolean;
  conflict_division?: string; // linked division id (see resolution note)
  conflict_team?: string; // linked team NAME within conflict_division
}

export interface CoachGroupDiagnostics {
  linkEntries: number; // settings.teams entries with has_coach_conflict + a conflict_team
  resolvedLinks: number; // links where BOTH ends resolved to real team ids
  unresolvedSelf: number; // the flagged team itself couldn't be resolved
  unresolvedLinked: number; // the linked team couldn't be resolved
  ambiguousLinked: number; // legacy (no conflict_division) name matched >1 team
  sameDivisionLinks: number; // both ends in the same division
  crossDivisionLinks: number; // ends in different divisions
}

export interface CoachGroups {
  // Each group is a set of team ids that share a coach (transitively unioned).
  groups: string[][];
  teamNames: Map<string, string>;
  diagnostics: CoachGroupDiagnostics;
}

function lc(s: string): string {
  return s.toLowerCase().trim();
}

// Resolve every division's coach links across a whole SEASON (a season is a
// league; divisions.league_id is the only scope) into transitively-unioned
// coach→teams groupings. Pure — the caller fetches the rows.
export function buildCoachGroups(
  divisions: DivisionForCoachGroups[],
  teams: TeamForCoachGroups[],
): CoachGroups {
  const teamNames = new Map<string, string>();
  // (divisionId + lowercased name) → teamId — precise, collision-proof lookup.
  const byDivName = new Map<string, string>();
  // lowercased name → teamIds — legacy fallback + ambiguity detection.
  const byName = new Map<string, string[]>();

  for (const t of teams) {
    teamNames.set(t.id, t.name);
    const key = lc(t.name);
    if (t.division_id) byDivName.set(`${t.division_id}|${key}`, t.id);
    const arr = byName.get(key);
    if (arr) arr.push(t.id);
    else byName.set(key, [t.id]);
  }

  // Union-find over resolved team-id pairs.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    // path-compress
    let c = x;
    while (parent.get(c) !== undefined && parent.get(c) !== c) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const diagnostics: CoachGroupDiagnostics = {
    linkEntries: 0,
    resolvedLinks: 0,
    unresolvedSelf: 0,
    unresolvedLinked: 0,
    ambiguousLinked: 0,
    sameDivisionLinks: 0,
    crossDivisionLinks: 0,
  };

  for (const div of divisions) {
    const settings = (div.settings ?? {}) as { teams?: unknown };
    if (!Array.isArray(settings.teams)) continue;

    for (const raw of settings.teams as SettingsTeamEntry[]) {
      if (!raw?.has_coach_conflict) continue;
      const linkedName = raw.conflict_team?.trim();
      const selfName = raw.name?.trim();
      if (!linkedName || !selfName) continue;
      diagnostics.linkEntries++;

      // Resolve the flagged team itself, scoped to its own division.
      const selfId = byDivName.get(`${div.id}|${lc(selfName)}`);
      if (!selfId) {
        diagnostics.unresolvedSelf++;
        continue;
      }

      // Resolve the linked team: precise (conflict_division + name) first,
      // league-wide name fallback for legacy rows without conflict_division.
      let linkedId: string | undefined;
      const linkedDiv = raw.conflict_division?.trim();
      if (linkedDiv) {
        linkedId = byDivName.get(`${linkedDiv}|${lc(linkedName)}`);
      } else {
        const candidates = byName.get(lc(linkedName)) ?? [];
        if (candidates.length === 1) {
          linkedId = candidates[0];
        } else if (candidates.length > 1) {
          diagnostics.ambiguousLinked++;
        }
      }
      if (!linkedId) {
        diagnostics.unresolvedLinked++;
        continue;
      }
      if (linkedId === selfId) continue; // self-link, nothing to union

      diagnostics.resolvedLinks++;
      // Same-division vs cross-division (diagnostic only — the detector treats
      // both identically; it doesn't care about the division boundary).
      const selfDiv = div.id;
      const linkedTeamDiv = teams.find((t) => t.id === linkedId)?.division_id ?? undefined;
      if (linkedTeamDiv && linkedTeamDiv === selfDiv) diagnostics.sameDivisionLinks++;
      else diagnostics.crossDivisionLinks++;

      union(selfId, linkedId);
    }
  }

  // Collect groups from the union-find forest. Only teams that were part of at
  // least one resolved link appear (a team with no coach link is no group).
  const byRoot = new Map<string, string[]>();
  for (const teamId of parent.keys()) {
    const root = find(teamId);
    const arr = byRoot.get(root);
    if (arr) arr.push(teamId);
    else byRoot.set(root, [teamId]);
  }
  const groups = [...byRoot.values()].filter((g) => g.length >= 2);

  return { groups, teamNames, diagnostics };
}

// ─── Overlap test (item 2) ───────────────────────────────────────────────────

// Absolute minute index for a naive "YYYY-MM-DDTHH:MM(:SS)" wall-clock string.
// Date.UTC is used purely as a deterministic, timezone-free day/minute counter
// (we only ever compare differences), so this is TZ-independent by construction.
function absMinutes(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const mo = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const h = Number(iso.slice(11, 13));
  const mi = Number(iso.slice(14, 16));
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

function fmtTime12(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  let h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

// A game's coach footprint is the half-open interval
//   [start, start + durationMinutes + COACH_TRANSITION_PAD_MINUTES).
// Two games conflict for a shared coach iff their footprints overlap. Half-open
// means footprints that merely TOUCH (one starts exactly when the other's
// footprint ends) do NOT conflict — i.e. a game whose start is >= the prior
// game's end + 60min is clear. Boundary, concretely: game A ends at 10:00; a
// same-coach game starting at 11:00 (a full 60-min gap) is clear; starting at
// 10:59 conflicts.
function footprintsOverlap(a: CoachConflictInputGame, b: CoachConflictInputGame): boolean {
  const startA = absMinutes(a.scheduledAt);
  const endA = startA + a.durationMinutes + COACH_TRANSITION_PAD_MINUTES;
  const startB = absMinutes(b.scheduledAt);
  const endB = startB + b.durationMinutes + COACH_TRANSITION_PAD_MINUTES;
  return startA < endB && startB < endA;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function toGameRef(g: CoachConflictInputGame): CoachConflictGameRef {
  return {
    id: g.id,
    timeLabel: fmtTime12(g.scheduledAt.substring(11, 16)),
    homeTeam: g.homeTeamName,
    awayTeam: g.awayTeamName,
    divisionId: g.divisionId,
    divisionName: g.divisionName,
  };
}

// ─── The detector (item 2, the mutation-tested heart) ────────────────────────

// Pure: given generated games and coach→teams groupings, return every pair of
// games a shared coach could not attend. Venue is ignored entirely. Each
// conflicting pair is reported once, regardless of how many coach groups it
// belongs to.
export function detectCoachConflicts(
  games: CoachConflictInputGame[],
  coachGroups: string[][],
): CoachConflict[] {
  const groupOf = new Map<string, number>();
  coachGroups.forEach((g, i) => g.forEach((t) => groupOf.set(t, i)));

  // Per group: each (game, the group-member team playing in it). A game with a
  // group team on BOTH sides (the two share a coach AND play each other) still
  // appears once per membership; the same-team / same-game guards below drop
  // the degenerate self-pairs.
  const perGroup = new Map<number, Array<{ g: CoachConflictInputGame; teamId: string }>>();
  const add = (grp: number, g: CoachConflictInputGame, teamId: string) => {
    const arr = perGroup.get(grp);
    if (arr) arr.push({ g, teamId });
    else perGroup.set(grp, [{ g, teamId }]);
  };
  for (const g of games) {
    const homeGrp = groupOf.get(g.homeTeamId);
    if (homeGrp !== undefined) add(homeGrp, g, g.homeTeamId);
    if (g.awayTeamId) {
      const awayGrp = groupOf.get(g.awayTeamId);
      if (awayGrp !== undefined) add(awayGrp, g, g.awayTeamId);
    }
  }

  const seen = new Set<string>();
  const out: CoachConflict[] = [];

  for (const entries of perGroup.values()) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (a.g.id === b.g.id) continue; // same game
        // A shared-coach conflict is between DIFFERENT teams' games. Two games
        // of the SAME team overlapping is a team double-book — a separate
        // concern the generator already guards, out of scope here.
        if (a.teamId === b.teamId) continue;
        if (!footprintsOverlap(a.g, b.g)) continue;
        const key = pairKey(a.g.id, b.g.id);
        if (seen.has(key)) continue;
        seen.add(key);

        // Order the pair by start time so `date` and games[0] are the earlier.
        const [first, second] =
          absMinutes(a.g.scheduledAt) <= absMinutes(b.g.scheduledAt)
            ? [a, b]
            : [b, a];
        out.push({
          teamIds: [first.teamId, second.teamId],
          teamNames: [
            entriesName(first.teamId, first.g),
            entriesName(second.teamId, second.g),
          ],
          date: first.g.scheduledAt.substring(0, 10),
          games: [toGameRef(first.g), toGameRef(second.g)],
        });
      }
    }
  }

  // Deterministic order: by date, then by earlier game's time, then game id.
  out.sort((x, y) => {
    if (x.date !== y.date) return x.date < y.date ? -1 : 1;
    const tx = x.games[0].timeLabel;
    const ty = y.games[0].timeLabel;
    if (tx !== ty) return tx < ty ? -1 : 1;
    return x.games[0].id < y.games[0].id ? -1 : x.games[0].id > y.games[0].id ? 1 : 0;
  });

  return out;
}

// The team's display name is the side of the game that team is playing.
function entriesName(teamId: string, g: CoachConflictInputGame): string {
  if (teamId === g.homeTeamId) return g.homeTeamName;
  if (teamId === g.awayTeamId) return g.awayTeamName;
  return g.homeTeamName;
}

// ─── Async orchestrator (season-wide) ────────────────────────────────────────

// Assemble coach groups + load the season's games + run the detector. The
// client is injected so this runs on the server page or the browser client
// (same seam the umpires engine uses). Fails LOUD on a read error — a silent
// empty result would read as "no coach conflicts", the opposite of the truth.
export async function detectSeasonCoachConflicts(
  client: Client,
  leagueId: string,
): Promise<CoachConflict[]> {
  const { data: divRows, error: divErr } = await client
    .from("divisions")
    .select("id, name, settings")
    .eq("league_id", leagueId);
  if (divErr) throw new Error(`coach-conflict: divisions read failed — ${divErr.message}`);

  const { data: teamRows, error: teamErr } = await client
    .from("teams")
    .select("id, name, division_id")
    .eq("league_id", leagueId);
  if (teamErr) throw new Error(`coach-conflict: teams read failed — ${teamErr.message}`);

  const divisions = (divRows ?? []) as DivisionForCoachGroups[];
  const teams = (teamRows ?? []) as TeamForCoachGroups[];

  const { groups } = buildCoachGroups(divisions, teams);
  if (groups.length === 0) return [];

  // Per-team division + per-division metadata for annotating games.
  const teamDivision = new Map<string, string | null>();
  for (const t of teams) teamDivision.set(t.id, t.division_id);
  const divName = new Map<string, string>();
  const divDuration = new Map<string, number>();
  for (const d of divisions) {
    divName.set(d.id, d.name);
    const s = (d.settings ?? {}) as { game_duration?: number };
    divDuration.set(d.id, Number(s.game_duration ?? 0));
  }

  // Only games involving a team that shares a coach can produce a conflict.
  const groupTeamIds = [...new Set(groups.flat())];
  const inList = `(${groupTeamIds.join(",")})`;

  type GameRow = {
    id: string;
    scheduled_at: string;
    status: string | null;
    home_team_id: string;
    away_team_id: string | null;
    home_team: { name: string } | null;
    away_team: { name: string } | null;
  };

  const { data: gameRows, error: gameErr } = await client
    .from("games")
    .select(
      "id, scheduled_at, status, home_team_id, away_team_id, home_team:teams!home_team_id(name), away_team:teams!away_team_id(name)",
    )
    .or(`home_team_id.in.${inList},away_team_id.in.${inList}`);
  if (gameErr) throw new Error(`coach-conflict: games read failed — ${gameErr.message}`);

  const games: CoachConflictInputGame[] = ((gameRows ?? []) as unknown as GameRow[])
    // Cancelled games don't tie up a coach (matches the venue surfaces, which
    // exclude cancelled rows before detecting).
    .filter((g) => g.status !== "cancelled" && !!g.scheduled_at)
    .map((g) => {
      // games has no division_id — the game's division is its HOME team's
      // (home_team_id is always ours, interleague included), and duration comes
      // from that division. Fall back to the away team's division only if the
      // home team somehow lacks one.
      const divId =
        teamDivision.get(g.home_team_id) ??
        (g.away_team_id ? teamDivision.get(g.away_team_id) : null) ??
        null;
      return {
        id: g.id,
        scheduledAt: g.scheduled_at,
        homeTeamId: g.home_team_id,
        awayTeamId: g.away_team_id,
        homeTeamName: g.home_team?.name ?? "TBD",
        awayTeamName: g.away_team?.name ?? "TBD",
        durationMinutes: divId ? (divDuration.get(divId) ?? 0) : 0,
        divisionId: divId ?? undefined,
        divisionName: divId ? divName.get(divId) : undefined,
      };
    });

  return detectCoachConflicts(games, groups);
}

// True when a coach conflict touches the given division (either colliding game
// belongs to it). Lets a per-division surface filter the season-wide result
// down to conflicts relevant to it — a cross-division conflict touches BOTH
// divisions, so it appears on both surfaces by design.
export function coachConflictTouchesDivision(
  conflict: CoachConflict,
  divisionId: string,
): boolean {
  return conflict.games.some((g) => g.divisionId === divisionId);
}
