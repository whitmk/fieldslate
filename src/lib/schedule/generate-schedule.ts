"use client";

import { createClient } from "@/lib/supabase/client";
import {
  isVenueAvailable,
  parseAvailability,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";

// ─── Public result types ───────────────────────────────────────────────────────

export type ScheduleResult =
  | {
      success: true;
      gamesCreated: number;
      unscheduledCount: number;
      conflicts: ScheduleConflict[];
    }
  | { success: false; error: string };

export interface ScheduleConflict {
  venueId: string;
  venueName: string;
  date: string; // "YYYY-MM-DD"
  games: Array<{
    id: string;
    timeLabel: string; // "9:00 AM"
    homeTeam: string;
    awayTeam: string;
    divisionName?: string; // present when cross-division conflict detection is run
  }>;
}

// ─── Settings shape stored in divisions.settings (jsonb) ──────────────────────

interface DivisionSettings {
  games_per_team: number;
  max_games_per_week: number;
  max_games_per_team_per_day: number;
  playing_days: string[];      // e.g. ["Sa","Su"]
  day_windows?: Record<string, { start: string; end: string }>; // per-day windows (new)
  earliest_start?: string;     // "HH:MM" — legacy fallback
  latest_start?: string;       // "HH:MM" — legacy fallback
  game_duration: number;       // minutes
  buffer_minutes: number;      // minutes
  max_games_per_field_per_day: number;
  bye_weeks: number;
  auto_rotate: boolean;
  teams: Array<{
    name: string;
    has_coach_conflict: boolean;
    conflict_division: string;
    conflict_team: string;
  }>;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface Slot {
  isoString: string;  // YYYY-MM-DDTHH:MM:SS  — stored in DB
  venueId: string;
  date: string;       // YYYY-MM-DD
  weekKey: string;    // YYYY-WNN
}

interface Matchup {
  homeId: string;
  // null when this is an interleague matchup against an external opponent
  awayId: string | null;
  // set only for interleague matchups
  interleagueOrgId: string | null;
  // true when this is an interleague matchup at the other org's venue
  // (homeId still references our team that's playing — they're the "away" team)
  isAway: boolean;
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

const DAY_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};

const JS_TO_DAY: Record<number, string> = {
  0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa",
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToTimeStr(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/** Local-time date string "YYYY-MM-DD" from a Date object — avoids toISOString() UTC shift. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO week key so we can track games-per-week. */
function weekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  // Thursday-anchored ISO week
  const thu = new Date(d);
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const wk = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
  return `${thu.getFullYear()}-W${pad2(wk)}`;
}

function fmtTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Round-robin matchup generation ───────────────────────────────────────────

/**
 * Circle method — returns N-1 rounds (N even) or N rounds (N odd).
 * Each round is a list of [id, id] pairings.
 */
function roundRobinRounds(ids: string[]): [string, string][][] {
  const arr = ids.length % 2 === 0 ? [...ids] : [...ids, "__bye__"];
  const n = arr.length;
  const rounds: [string, string][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__bye__" && b !== "__bye__") round.push([a, b]);
    }
    rounds.push(round);
    // Rotate arr[1..n-1] one position clockwise; arr[0] stays fixed
    arr.splice(1, 0, arr.pop()!);
  }

  return rounds;
}

/**
 * Produce at least `gamesPerTeam` games per team by cycling through round-robin
 * rounds. With an odd number of teams, the bye-rotation means one team per round
 * sits out; to let every team reach the minimum, some teams may play one extra
 * game (gamesPerTeam + 1). That is expected and correct — the termination
 * condition is "every team ≥ gamesPerTeam", not "every team = gamesPerTeam".
 */
function buildMatchups(
  teamIds: string[],
  gamesPerTeam: number,
  autoRotate: boolean,
): Matchup[] {
  if (teamIds.length < 2) return [];

  const rounds = roundRobinRounds(teamIds);
  const isOddTeams = teamIds.length % 2 === 1;
  // Allow teams to go one over the target when odd — needed so the bye-team
  // can act as a partner for whichever team would otherwise be stuck below min.
  const maxPerTeam = gamesPerTeam + (isOddTeams ? 1 : 0);

  const homeCount: Record<string, number> = {};
  const gameCount: Record<string, number> = {};
  teamIds.forEach((id) => { homeCount[id] = 0; gameCount[id] = 0; });

  const matchups: Matchup[] = [];
  let pass = 0;
  const maxPasses = rounds.length * (gamesPerTeam + 2);

  while (pass < maxPasses) {
    const round = rounds[pass % rounds.length];
    const pairs: [string, string][] =
      pass % 2 === 0 ? round : round.map(([a, b]) => [b, a]);

    for (const [a, b] of pairs) {
      if ((gameCount[a] ?? 0) >= maxPerTeam) continue;
      if ((gameCount[b] ?? 0) >= maxPerTeam) continue;

      let homeId = a, awayId = b;
      if (autoRotate && (homeCount[a] ?? 0) > (homeCount[b] ?? 0)) {
        homeId = b; awayId = a;
      }

      matchups.push({ homeId, awayId, interleagueOrgId: null, isAway: false });
      homeCount[homeId] = (homeCount[homeId] ?? 0) + 1;
      gameCount[a] = (gameCount[a] ?? 0) + 1;
      gameCount[b] = (gameCount[b] ?? 0) + 1;
    }

    pass++;
    // Done when every team has reached the minimum — some may be at min+1.
    if (teamIds.every((id) => (gameCount[id] ?? 0) >= gamesPerTeam)) break;
  }

  return matchups;
}

/**
 * Expand `division_interleague_games` rows into one matchup per team per
 * configured game. Interleague matchups have no away_team_id — the opponent
 * is the external org represented by interleagueOrgId.
 *
 * Each org config specifies `home_games_per_team` (we host) and the rest
 * (game_count - home_games_per_team) are away games (other org hosts).
 */
function buildInterleagueMatchups(
  teamIds: string[],
  interleagueConfig: Array<{
    interleague_org_id: string;
    game_count: number;
    home_games_per_team: number;
  }>,
  alreadyHaveByTeamOrg?: Map<string, { home: number; away: number }>,
): Matchup[] {
  const out: Matchup[] = [];
  for (const cfg of interleagueConfig) {
    const total = Number(cfg.game_count);
    if (!Number.isFinite(total) || total <= 0) continue;
    const homeTarget = Math.max(0, Math.min(total, Number(cfg.home_games_per_team) || 0));
    const awayTarget = total - homeTarget;
    for (const teamId of teamIds) {
      const have = alreadyHaveByTeamOrg?.get(`${teamId}|${cfg.interleague_org_id}`)
        ?? { home: 0, away: 0 };
      const needHome = Math.max(0, homeTarget - have.home);
      const needAway = Math.max(0, awayTarget - have.away);
      for (let i = 0; i < needHome; i++) {
        out.push({
          homeId: teamId,
          awayId: null,
          interleagueOrgId: cfg.interleague_org_id,
          isAway: false,
        });
      }
      for (let i = 0; i < needAway; i++) {
        out.push({
          homeId: teamId,
          awayId: null,
          interleagueOrgId: cfg.interleague_org_id,
          isAway: true,
        });
      }
    }
  }
  return out;
}

// ─── Slot pool generation ──────────────────────────────────────────────────────

/**
 * Returns all (venue × datetime) pairs in chronological order.
 * Slots are spaced by game_duration + buffer_minutes, capped at
 * max_games_per_field_per_day per venue per day. Filters each candidate
 * slot through the per-venue availability map so we never propose a time
 * the venue isn't open.
 */
function buildSlots(
  startDate: string,
  endDate: string,
  s: DivisionSettings,
  venueIds: string[],
  venueAvailability: Map<string, VenueAvailability>,
  blackoutDates: Set<string> = new Set(),
): Slot[] {
  if (!venueIds.length) return [];

  const allowedDays = new Set(s.playing_days.map((d) => DAY_TO_JS[d]));

  // Coerce JSONB values to Number before arithmetic (prevents "90"+"15"="9015").
  const gameDuration = Number(s.game_duration);
  const bufferMins = Number(s.buffer_minutes);
  const interval = Math.max(1, gameDuration + bufferMins);

  // Collect all valid game dates (playing days, not blacked out)
  const allDates: string[] = [];
  const cur = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (cur <= end) {
    const iso = localDateStr(cur);
    if (allowedDays.has(cur.getDay()) && !blackoutDates.has(iso)) allDates.push(iso);
    cur.setDate(cur.getDate() + 1);
  }

  // Remove bye weeks — strip the last N distinct game-weeks
  let validDates = allDates;
  if (s.bye_weeks > 0 && allDates.length > 0) {
    const uniqueWeeks = [...new Set(allDates.map(weekKey))];
    if (s.bye_weeks < uniqueWeeks.length) {
      const byeKeys = new Set(uniqueWeeks.slice(-s.bye_weeks));
      validDates = allDates.filter((d) => !byeKeys.has(weekKey(d)));
    }
  }

  const slots: Slot[] = [];

  for (const date of validDates) {
    const wk = weekKey(date);
    const dayKey = JS_TO_DAY[new Date(date + "T00:00:00").getDay()] as DayKey;

    // Per-day window — fall back to legacy earliest_start/latest_start for old divisions
    const dayWin = s.day_windows?.[dayKey];
    const earliest = timeToMinutes(dayWin?.start ?? s.earliest_start ?? "09:00");
    const latest   = timeToMinutes(dayWin?.end   ?? s.latest_start  ?? "17:00");

    // Derive the slot cap from this day's window when per-day windows are present;
    // otherwise use the stored max_games_per_field_per_day (backward compat).
    const maxPerField = dayWin
      ? Math.max(1, Math.floor((latest - earliest) / interval) + 1)
      : Number(s.max_games_per_field_per_day);

    let timeMin = earliest;
    let slotsThisDay = 0;

    while (timeMin <= latest && slotsThisDay < maxPerField) {
      const wallTime = minutesToTimeStr(timeMin);
      const isoString = `${date}T${wallTime}:00`;
      for (const venueId of venueIds) {
        // Venue-availability gate: drop slots the venue isn't open for. The
        // division-window check above still applies — the engine respects the
        // tighter of the two.
        const av = venueAvailability.get(venueId);
        if (!av) continue;
        if (!isVenueAvailable(av, dayKey, wallTime, gameDuration)) continue;
        slots.push({ isoString, venueId, date, weekKey: wk });
      }
      timeMin += interval;
      slotsThisDay++;
    }
  }

  // Chronological order; within same time spread across venues
  slots.sort(
    (a, b) =>
      a.isoString.localeCompare(b.isoString) ||
      a.venueId.localeCompare(b.venueId),
  );

  return slots;
}

// ─── Conflict detection (exported for UI use) ──────────────────────────────────

/**
 * Given a flat list of scheduled games, returns any venue double-bookings.
 * Call this after fetching games from the DB to drive a warning banner.
 */
export interface ConflictInputGame {
  id: string;
  scheduled_at: string;
  venue_id: string | null;
  venue_name: string;
  home_team_name: string;
  away_team_name: string;
  division_name?: string;
}

export function detectScheduleConflicts(
  games: ConflictInputGame[],
  gameDuration: number,
  bufferMinutes: number,
): ScheduleConflict[] {
  const minGap = Number(gameDuration) + Number(bufferMinutes);
  const byVenueDay = new Map<string, ConflictInputGame[]>();

  for (const g of games) {
    if (!g.venue_id) continue;
    const key = `${g.venue_id}:${g.scheduled_at.substring(0, 10)}`;
    if (!byVenueDay.has(key)) byVenueDay.set(key, []);
    byVenueDay.get(key)!.push(g);
  }

  const conflicts: ScheduleConflict[] = [];

  for (const group of byVenueDay.values()) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) =>
      a.scheduled_at.localeCompare(b.scheduled_at),
    );

    const conflictingGames = new Set<ConflictInputGame>();

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const minsA = timeToMinutes(sorted[i].scheduled_at.substring(11, 16));
        const minsB = timeToMinutes(sorted[j].scheduled_at.substring(11, 16));
        if (Math.abs(minsA - minsB) < minGap) {
          conflictingGames.add(sorted[i]);
          conflictingGames.add(sorted[j]);
        }
      }
    }

    if (conflictingGames.size > 0) {
      const arr = [...conflictingGames].sort((a, b) =>
        a.scheduled_at.localeCompare(b.scheduled_at),
      );
      conflicts.push({
        venueId: arr[0].venue_id!,
        venueName: arr[0].venue_name,
        date: arr[0].scheduled_at.substring(0, 10),
        games: arr.map((g) => ({
          id: g.id,
          timeLabel: fmtTime12(g.scheduled_at.substring(11, 16)),
          homeTeam: g.home_team_name,
          awayTeam: g.away_team_name,
          divisionName: g.division_name,
        })),
      });
    }
  }

  return conflicts;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function generateSchedule(divisionId: string): Promise<ScheduleResult> {
  const supabase = createClient();

  // ── 1. Load division ─────────────────────────────────────────────────────────

  const { data: div, error: divErr } = await supabase
    .from("divisions")
    .select("id, league_id, name, start_date, end_date, settings, intra_division_games_per_team")
    .eq("id", divisionId)
    .single();

  if (divErr || !div) {
    return { success: false, error: divErr?.message ?? "Division not found." };
  }
  if (!div.start_date || !div.end_date) {
    return { success: false, error: "Division must have a start and end date." };
  }

  const settings = div.settings as unknown as DivisionSettings;
  // Prefer the dedicated column; fall back to the settings JSON for old divisions.
  // Number() coercion guards against JSONB returning a string or undefined.
  const intraDivisionGamesPerTeam = Number(
    (div as unknown as { intra_division_games_per_team: number | null }).intra_division_games_per_team
    ?? settings.games_per_team
    ?? 0,
  );

  if (intraDivisionGamesPerTeam <= 0) {
    return { success: false, error: "Games per team must be at least 1. Check the Format step in division settings." };
  }

  if (!settings.playing_days?.length) {
    return { success: false, error: "No playing days configured for this division." };
  }

  // ── 2. Load teams ────────────────────────────────────────────────────────────

  const { data: teamsData, error: teamsErr } = await supabase
    .from("teams")
    .select("id, name")
    .eq("division_id", divisionId)
    .order("name");

  if (teamsErr) return { success: false, error: teamsErr.message };

  const teams = (teamsData ?? []) as { id: string; name: string }[];

  if (teams.length < 2) {
    return { success: false, error: `Found ${teams.length} team(s) — at least 2 are required.` };
  }

  // ── 3. Load venues ───────────────────────────────────────────────────────────
  // Filter to availability-configured venues only; unconfigured venues are
  // invisible to the engine until the admin sets hours.

  const { data: dvRows, error: dvErr } = await supabase
    .from("division_venues")
    .select(
      "venue_id, venue:venues!inner(id, availability, availability_configured)",
    )
    .eq("division_id", divisionId)
    .eq("allow_games", true)
    .eq("venue.availability_configured", true);

  if (dvErr) return { success: false, error: dvErr.message };

  type DvVenueRow = {
    venue_id: string;
    venue: { id: string; availability: unknown; availability_configured: boolean } | null;
  };
  const dvVenueRows = (dvRows ?? []) as unknown as DvVenueRow[];
  const venueIds = dvVenueRows.map((r) => r.venue_id);
  const venueAvailability = new Map<string, VenueAvailability>();
  for (const r of dvVenueRows) {
    venueAvailability.set(r.venue_id, parseAvailability(r.venue?.availability));
  }

  if (!venueIds.length) {
    return {
      success: false,
      error:
        "No venues with availability set are assigned to this division for games. Configure venue hours first.",
    };
  }

  // ── 4. Load league blackout dates ────────────────────────────────────────────

  const { data: blackoutRaw } = await supabase
    .from("blackout_dates")
    .select("date")
    .eq("league_id", div.league_id);

  const blackoutDates = new Set(
    ((blackoutRaw ?? []) as { date: string }[]).map((b) => b.date),
  );

  // ── 5. Resolve coach-conflict blocked times ──────────────────────────────────
  // blocked[teamId] = Set of isoString datetimes when that team cannot play
  const blocked = new Map<string, Set<string>>();
  teams.forEach((t) => blocked.set(t.id, new Set()));

  const nameToId: Record<string, string> = {};
  teams.forEach((t) => { nameToId[t.name.toLowerCase().trim()] = t.id; });

  if (Array.isArray(settings.teams)) {
    for (const entry of settings.teams) {
      if (!entry.has_coach_conflict || !entry.conflict_team?.trim()) continue;

      const thisId = nameToId[entry.name.toLowerCase().trim()];
      if (!thisId) continue;

      // First check if the linked team is within this same division
      const sameDiv = nameToId[entry.conflict_team.toLowerCase().trim()];
      if (sameDiv) {
        // Same-division coach conflict: handled automatically since both teams
        // always play different opponents within the same division.
        continue;
      }

      // Cross-division: look up the linked team in the same league by name
      const { data: linked } = await supabase
        .from("teams")
        .select("id")
        .eq("league_id", div.league_id)
        .ilike("name", entry.conflict_team.trim())
        .neq("division_id", divisionId)
        .maybeSingle();

      if (!linked) continue;

      // Fetch that team's already-scheduled games
      const { data: linkedGames } = await supabase
        .from("games")
        .select("scheduled_at")
        .or(`home_team_id.eq.${linked.id},away_team_id.eq.${linked.id}`);

      if (linkedGames?.length) {
        const set = blocked.get(thisId)!;
        for (const g of linkedGames as { scheduled_at: string }[]) {
          // Normalise to YYYY-MM-DDTHH:MM:SS so it matches our slot isoStrings
          set.add(g.scheduled_at.substring(0, 19));
        }
      }
    }
  }

  // ── 6. Generate matchups ─────────────────────────────────────────────────────

  const teamIds = teams.map((t) => t.id);
  const intraMatchups = shuffle(
    buildMatchups(teamIds, intraDivisionGamesPerTeam, settings.auto_rotate),
  );

  // Pull interleague game counts per org for this division (if any)
  const { data: igRowsRaw } = await supabase
    .from("division_interleague_games")
    .select("interleague_org_id, game_count, home_games_per_team")
    .eq("division_id", divisionId);
  const interleagueConfig = (igRowsRaw ?? []) as unknown as Array<{
    interleague_org_id: string;
    game_count: number;
    home_games_per_team: number;
  }>;

  // Pull field_count for each org — caps how many away games we can place
  // against an org on the same date.
  const orgIds = interleagueConfig.map((c) => c.interleague_org_id);
  const orgFieldCount = new Map<string, number>();
  if (orgIds.length > 0) {
    const { data: orgRowsRaw } = await supabase
      .from("interleague_orgs")
      .select("id, field_count")
      .in("id", orgIds);
    for (const o of (orgRowsRaw ?? []) as Array<{ id: string; field_count: number | null }>) {
      orgFieldCount.set(o.id, Math.max(1, Number(o.field_count ?? 1)));
    }
  }

  // Count accepted interleague games per (team, org) so we don't re-create
  // ones that survived the upcoming delete (status='scheduled' interleague).
  const acceptedByTeamOrg = new Map<string, { home: number; away: number }>();
  {
    const { data: acceptedRaw } = await supabase
      .from("games")
      .select("home_team_id, interleague_org_id, is_away")
      .in("home_team_id", teamIds)
      .eq("status", "scheduled")
      .not("interleague_org_id", "is", null);
    for (const g of (acceptedRaw ?? []) as Array<{
      home_team_id: string;
      interleague_org_id: string | null;
      is_away: boolean | null;
    }>) {
      if (!g.interleague_org_id) continue;
      const key = `${g.home_team_id}|${g.interleague_org_id}`;
      const cur = acceptedByTeamOrg.get(key) ?? { home: 0, away: 0 };
      if (g.is_away) cur.away += 1;
      else cur.home += 1;
      acceptedByTeamOrg.set(key, cur);
    }
  }

  const interleagueMatchups = shuffle(
    buildInterleagueMatchups(teamIds, interleagueConfig, acceptedByTeamOrg),
  );

  // Intra and home-interleague need real venues so go first; away-interleague
  // can fit any remaining (date, time) the team is free.
  const homeInterleague = interleagueMatchups.filter((m) => !m.isAway);
  const awayInterleague = interleagueMatchups.filter((m) => m.isAway);
  const matchups = [...intraMatchups, ...homeInterleague, ...awayInterleague];

  if (!matchups.length) {
    return { success: false, error: "Could not generate matchups. Check team count and games-per-team settings." };
  }

  // ── 7. Build slot pool ───────────────────────────────────────────────────────

  const slots = buildSlots(
    div.start_date,
    div.end_date,
    settings,
    venueIds,
    venueAvailability,
    blackoutDates,
  );

  if (!slots.length) {
    return {
      success: false,
      error:
        "No valid game slots found. Check that the division's playing days and times overlap with each venue's configured hours.",
    };
  }

  // ── 8. Assign matchups to slots (greedy) ─────────────────────────────────────

  // Delete this division's old games BEFORE querying existing venue bookings so
  // they don't falsely block slots in the new schedule. Preserve accepted
  // interleague games (status='scheduled' AND interleague_org_id IS NOT NULL)
  // so the recipient's confirmed bookings aren't wiped.
  const { error: delErr } = await supabase
    .from("games")
    .delete()
    .eq("league_id", div.league_id)
    .in("home_team_id", teamIds)
    .or("status.neq.scheduled,interleague_org_id.is.null");

  if (delErr) {
    console.warn("[generateSchedule] failed to clear old games:", delErr.message);
  }

  // Pre-load venue bookings from ALL games already in the DB at these venues.
  // This makes the conflict check venue-aware across every division — not just
  // games generated in the current run.
  const { data: existingGames } = await supabase
    .from("games")
    .select("venue_id, scheduled_at")
    .in("venue_id", venueIds);

  // Also pre-load the preserved accepted interleague games for our teams so we
  // don't double-book those teams at the same datetime in this run.
  const { data: preservedForTeams } = await supabase
    .from("games")
    .select("home_team_id, scheduled_at")
    .in("home_team_id", teamIds);

  // Pre-seed the per-org per-date away count: any existing away game against
  // one of this division's orgs (across the league — even other divisions)
  // counts against that org's field_count for the day. We only need this map
  // when there are orgs to scope by.
  const awayByOrgDate = new Map<string, number>();
  if (orgIds.length > 0) {
    const { data: existingAwayRaw } = await supabase
      .from("games")
      .select("interleague_org_id, scheduled_at")
      .eq("league_id", div.league_id)
      .eq("is_away", true)
      .in("interleague_org_id", orgIds);
    for (const g of (existingAwayRaw ?? []) as Array<{
      interleague_org_id: string | null;
      scheduled_at: string;
    }>) {
      if (!g.interleague_org_id) continue;
      const date = g.scheduled_at.substring(0, 10);
      const key = `${g.interleague_org_id}|${date}`;
      awayByOrgDate.set(key, (awayByOrgDate.get(key) ?? 0) + 1);
    }
  }

  // "venueId:YYYY-MM-DD" → start times (minutes from midnight) already booked
  const venueBookings = new Map<string, number[]>();

  for (const g of (existingGames ?? []) as { venue_id: string; scheduled_at: string }[]) {
    const date = g.scheduled_at.substring(0, 10);
    const vKey = `${g.venue_id}:${date}`;
    const mins = timeToMinutes(g.scheduled_at.substring(11, 16));
    if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
    venueBookings.get(vKey)!.push(mins);
  }

  const minVenueGap = Number(settings.game_duration ?? 0) + Number(settings.buffer_minutes ?? 0);
  const maxPerTeamDay = Math.max(1, Number(settings.max_games_per_team_per_day ?? 1));

  const teamTimes = new Map<string, Set<string>>();  // teamId → booked isoStrings
  const teamWeek = new Map<string, number>();        // "teamId|weekKey" → count
  const teamDay = new Map<string, number>();         // "teamId|YYYY-MM-DD" → count

  teamIds.forEach((id) => teamTimes.set(id, new Set()));

  // Seed team caps with any preserved accepted interleague games so we don't
  // double-book the same team at the same time / push past per-day or per-week caps.
  for (const g of (preservedForTeams ?? []) as Array<{
    home_team_id: string;
    scheduled_at: string;
  }>) {
    const iso = g.scheduled_at.substring(0, 19);
    const date = g.scheduled_at.substring(0, 10);
    teamTimes.get(g.home_team_id)?.add(iso);
    const hdk = `${g.home_team_id}|${date}`;
    teamDay.set(hdk, (teamDay.get(hdk) ?? 0) + 1);
    const hwk = `${g.home_team_id}|${weekKey(date)}`;
    teamWeek.set(hwk, (teamWeek.get(hwk) ?? 0) + 1);
  }

  type GameInsert = {
    league_id: string;
    home_team_id: string;
    away_team_id: string | null;
    interleague_org_id: string | null;
    venue_id: string | null;
    scheduled_at: string;
    status: "scheduled" | "pending_interleague";
    is_away: boolean;
  };

  const scheduled: GameInsert[] = [];
  const unscheduled: Matchup[] = [];

  // Deduped (date, time) view for away matchups: they don't claim a venue,
  // so iterating venues for the same time is wasted work.
  const dateTimeOnlySlots: Slot[] = [];
  {
    const seenIso = new Set<string>();
    for (const s of slots) {
      if (!seenIso.has(s.isoString)) {
        seenIso.add(s.isoString);
        dateTimeOnlySlots.push(s);
      }
    }
  }

  for (const { homeId, awayId, interleagueOrgId, isAway } of matchups) {
    const status: "scheduled" | "pending_interleague" =
      interleagueOrgId ? "pending_interleague" : "scheduled";
    let assigned = false;

    // Away interleague games skip venue checks — they're at the other org's venue.
    const pool = isAway ? dateTimeOnlySlots : slots;

    for (const slot of pool) {
      // ── Venue overlap check (home/intra only) ────────────────────────────────
      const vKey = `${slot.venueId}:${slot.date}`;
      const slotMins = timeToMinutes(slot.isoString.substring(11, 16));
      if (!isAway) {
        const bookedMins = venueBookings.get(vKey) ?? [];
        if (bookedMins.some((t) => Math.abs(t - slotMins) < minVenueGap)) continue;
      } else if (interleagueOrgId) {
        // Away cap: the host org has a limited number of fields, so we can't
        // schedule more than `field_count` away games against them per day.
        const cap = orgFieldCount.get(interleagueOrgId) ?? 1;
        const used = awayByOrgDate.get(`${interleagueOrgId}|${slot.date}`) ?? 0;
        if (used >= cap) continue;
      }

      // Either team already has a game at this datetime (away may be null for interleague)
      if (teamTimes.get(homeId)!.has(slot.isoString)) continue;
      if (awayId && teamTimes.get(awayId)!.has(slot.isoString)) continue;

      // max_games_per_team_per_day cap
      const hdk = `${homeId}|${slot.date}`;
      const adk = awayId ? `${awayId}|${slot.date}` : null;
      if ((teamDay.get(hdk) ?? 0) >= maxPerTeamDay) continue;
      if (adk && (teamDay.get(adk) ?? 0) >= maxPerTeamDay) continue;

      // max_games_per_week cap
      const hwk = `${homeId}|${slot.weekKey}`;
      const awk = awayId ? `${awayId}|${slot.weekKey}` : null;
      if ((teamWeek.get(hwk) ?? 0) >= Number(settings.max_games_per_week)) continue;
      if (awk && (teamWeek.get(awk) ?? 0) >= Number(settings.max_games_per_week)) continue;

      // Coach-conflict: blocked datetimes from cross-division partner
      if (blocked.get(homeId)!.has(slot.isoString)) continue;
      if (awayId && blocked.get(awayId)!.has(slot.isoString)) continue;

      // ✓ All constraints satisfied — claim this slot
      if (!isAway) {
        if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
        venueBookings.get(vKey)!.push(slotMins);
      } else if (interleagueOrgId) {
        const key = `${interleagueOrgId}|${slot.date}`;
        awayByOrgDate.set(key, (awayByOrgDate.get(key) ?? 0) + 1);
      }
      teamTimes.get(homeId)!.add(slot.isoString);
      if (awayId) teamTimes.get(awayId)!.add(slot.isoString);
      teamDay.set(hdk, (teamDay.get(hdk) ?? 0) + 1);
      if (adk) teamDay.set(adk, (teamDay.get(adk) ?? 0) + 1);
      teamWeek.set(hwk, (teamWeek.get(hwk) ?? 0) + 1);
      if (awk) teamWeek.set(awk, (teamWeek.get(awk) ?? 0) + 1);

      scheduled.push({
        league_id: div.league_id,
        home_team_id: homeId,
        away_team_id: awayId,
        interleague_org_id: interleagueOrgId,
        venue_id: isAway ? null : slot.venueId,
        scheduled_at: slot.isoString,
        status,
        is_away: isAway,
      });

      assigned = true;
      break;
    }

    if (!assigned) unscheduled.push({ homeId, awayId, interleagueOrgId, isAway });
  }

  if (!scheduled.length) {
    return {
      success: false,
      error:
        "Could not fit any games into the available slots. " +
        "Try extending the season dates, adding venues, or reducing games per team.",
    };
  }

  // ── 9. Bulk-insert the new schedule ──────────────────────────────────────────

  const BATCH = 500;
  for (let i = 0; i < scheduled.length; i += BATCH) {
    const { error: insertErr } = await supabase
      .from("games")
      .insert(scheduled.slice(i, i + BATCH) as never[]);

    if (insertErr) return { success: false, error: insertErr.message };
  }

  // ── 10. Detect cross-division venue conflicts ─────────────────────────────────

  type CrossDivRaw = {
    id: string;
    scheduled_at: string;
    venue_id: string | null;
    home_team: { name: string; division: { name: string } | null } | null;
    away_team: { name: string } | null;
    venue: { name: string } | null;
  };

  const { data: crossDivRaw } = await supabase
    .from("games")
    .select(
      "id, scheduled_at, venue_id," +
      "home_team:teams!home_team_id(name, division:divisions(name))," +
      "away_team:teams!away_team_id(name)," +
      "venue:venues(name)"
    )
    .in("venue_id", venueIds);

  const crossDivGames: ConflictInputGame[] = ((crossDivRaw ?? []) as unknown as CrossDivRaw[]).map((g) => ({
    id: g.id,
    scheduled_at: g.scheduled_at,
    venue_id: g.venue_id,
    venue_name: g.venue?.name ?? "Unknown venue",
    home_team_name: g.home_team?.name ?? "TBD",
    away_team_name: g.away_team?.name ?? "TBD",
    division_name: g.home_team?.division?.name ?? undefined,
  }));

  const conflicts = detectScheduleConflicts(
    crossDivGames,
    Number(settings.game_duration),
    Number(settings.buffer_minutes),
  );

  return {
    success: true,
    gamesCreated: scheduled.length,
    unscheduledCount: unscheduled.length,
    conflicts,
  };
}

// ─── Finish scheduling (fills in missing games without deleting existing ones) ──

export async function finishSchedule(divisionId: string): Promise<ScheduleResult> {
  const supabase = createClient();

  // ── 1. Load division ─────────────────────────────────────────────────────────

  type FinishDivRow = { id: string; league_id: string; name: string; start_date: string; end_date: string; settings: unknown; intra_division_games_per_team: number | null };
  const { data: divRaw, error: divErr } = await supabase
    .from("divisions")
    .select("id, league_id, name, start_date, end_date, settings, intra_division_games_per_team")
    .eq("id", divisionId)
    .single();

  const div = divRaw as unknown as FinishDivRow | null;
  if (divErr || !div) return { success: false, error: divErr?.message ?? "Division not found." };
  if (!div.start_date || !div.end_date) return { success: false, error: "Division must have a start and end date." };

  const settings = div.settings as unknown as DivisionSettings;
  if (!settings.playing_days?.length) return { success: false, error: "No playing days configured for this division." };
  const intraDivisionGamesPerTeamFinish = Number(div.intra_division_games_per_team ?? settings.games_per_team ?? 0);
  if (intraDivisionGamesPerTeamFinish <= 0) {
    return { success: false, error: "Games per team must be at least 1. Check the Format step in division settings." };
  }

  // ── 2. Load teams ────────────────────────────────────────────────────────────

  const { data: teamsData, error: teamsErr } = await supabase
    .from("teams")
    .select("id, name")
    .eq("division_id", divisionId)
    .order("name");

  if (teamsErr) return { success: false, error: teamsErr.message };
  const teams = (teamsData ?? []) as { id: string; name: string }[];
  if (teams.length < 2) return { success: false, error: `Found ${teams.length} team(s) — at least 2 are required.` };

  // ── 3. Load venues ───────────────────────────────────────────────────────────
  // Same configured-only filter as generateSchedule.

  const { data: dvRows, error: dvErr } = await supabase
    .from("division_venues")
    .select(
      "venue_id, venue:venues!inner(id, availability, availability_configured)",
    )
    .eq("division_id", divisionId)
    .eq("allow_games", true)
    .eq("venue.availability_configured", true);

  if (dvErr) return { success: false, error: dvErr.message };
  type DvVenueRowFinish = {
    venue_id: string;
    venue: { id: string; availability: unknown; availability_configured: boolean } | null;
  };
  const dvVenueRowsFinish = (dvRows ?? []) as unknown as DvVenueRowFinish[];
  const venueIds = dvVenueRowsFinish.map((r) => r.venue_id);
  const venueAvailability = new Map<string, VenueAvailability>();
  for (const r of dvVenueRowsFinish) {
    venueAvailability.set(r.venue_id, parseAvailability(r.venue?.availability));
  }
  if (!venueIds.length) {
    return {
      success: false,
      error:
        "No venues with availability set are assigned to this division for games. Configure venue hours first.",
    };
  }

  // ── 4. Load league blackout dates ────────────────────────────────────────────

  const { data: blackoutRawFinish } = await supabase
    .from("blackout_dates")
    .select("date")
    .eq("league_id", div.league_id);

  const blackoutDates = new Set(
    ((blackoutRawFinish ?? []) as { date: string }[]).map((b) => b.date),
  );

  // ── 5. Coach-conflict blocked times (same as generateSchedule) ───────────────

  const blocked = new Map<string, Set<string>>();
  teams.forEach((t) => blocked.set(t.id, new Set()));

  const nameToId: Record<string, string> = {};
  teams.forEach((t) => { nameToId[t.name.toLowerCase().trim()] = t.id; });

  if (Array.isArray(settings.teams)) {
    for (const entry of settings.teams) {
      if (!entry.has_coach_conflict || !entry.conflict_team?.trim()) continue;
      const thisId = nameToId[entry.name.toLowerCase().trim()];
      if (!thisId) continue;
      const sameDiv = nameToId[entry.conflict_team.toLowerCase().trim()];
      if (sameDiv) continue;
      const { data: linkedRaw2 } = await supabase
        .from("teams").select("id")
        .eq("league_id", div.league_id)
        .ilike("name", entry.conflict_team.trim())
        .neq("division_id", divisionId)
        .maybeSingle();
      const linked2 = linkedRaw2 as unknown as { id: string } | null;
      if (!linked2) continue;
      const { data: linkedGames } = await supabase
        .from("games").select("scheduled_at")
        .or(`home_team_id.eq.${linked2.id},away_team_id.eq.${linked2.id}`);
      if (linkedGames?.length) {
        const set = blocked.get(thisId)!;
        for (const g of linkedGames as { scheduled_at: string }[]) set.add(g.scheduled_at.substring(0, 19));
      }
    }
  }

  // ── 6. Load existing division games + count per team ─────────────────────────

  const teamIds = teams.map((t) => t.id);

  const { data: existingRaw } = await supabase
    .from("games")
    .select("id, home_team_id, away_team_id, interleague_org_id, is_away, venue_id, scheduled_at")
    .in("home_team_id", teamIds);

  type ExistingGame = {
    id: string;
    home_team_id: string;
    away_team_id: string | null;
    interleague_org_id: string | null;
    is_away: boolean | null;
    venue_id: string | null;
    scheduled_at: string;
  };
  const existingGames = (existingRaw ?? []) as unknown as ExistingGame[];

  // Intra-division per-team count: only games where both teams are in this division
  const teamIdSet = new Set(teamIds);
  const existingIntraCount: Record<string, number> = {};
  for (const t of teams) existingIntraCount[t.id] = 0;
  for (const g of existingGames) {
    if (g.away_team_id && teamIdSet.has(g.away_team_id)) {
      existingIntraCount[g.home_team_id] = (existingIntraCount[g.home_team_id] ?? 0) + 1;
      existingIntraCount[g.away_team_id] = (existingIntraCount[g.away_team_id] ?? 0) + 1;
    }
  }

  // Interleague per-team-per-org count split by home/away.
  const existingInterleagueCount = new Map<string, { home: number; away: number }>();
  for (const g of existingGames) {
    if (!g.interleague_org_id) continue;
    const key = `${g.home_team_id}|${g.interleague_org_id}`;
    const cur = existingInterleagueCount.get(key) ?? { home: 0, away: 0 };
    if (g.is_away) cur.away += 1;
    else cur.home += 1;
    existingInterleagueCount.set(key, cur);
  }

  // Load interleague config for this division
  const { data: igRowsRaw } = await supabase
    .from("division_interleague_games")
    .select("interleague_org_id, game_count, home_games_per_team")
    .eq("division_id", divisionId);
  const interleagueConfig = (igRowsRaw ?? []) as unknown as Array<{
    interleague_org_id: string;
    game_count: number;
    home_games_per_team: number;
  }>;

  // Field count per org caps how many away games we can place against them
  // on the same date.
  const orgIdsFinish = interleagueConfig.map((c) => c.interleague_org_id);
  const orgFieldCountFinish = new Map<string, number>();
  if (orgIdsFinish.length > 0) {
    const { data: orgRowsRaw } = await supabase
      .from("interleague_orgs")
      .select("id, field_count")
      .in("id", orgIdsFinish);
    for (const o of (orgRowsRaw ?? []) as Array<{ id: string; field_count: number | null }>) {
      orgFieldCountFinish.set(o.id, Math.max(1, Number(o.field_count ?? 1)));
    }
  }

  // ── 7. Compute per-team deficit and build only the needed matchups ────────────

  const gamesPerTeam = intraDivisionGamesPerTeamFinish;
  const isOdd = teamIds.length % 2 === 1;
  // Odd-team divisions tolerate one extra game per team due to bye rotation
  const maxPerTeamFinish = gamesPerTeam + (isOdd ? 1 : 0);

  // Track actual intra counts as we add new matchups on top of existingIntraCount
  const actualCount = { ...existingIntraCount };

  const intraDeficitExists = teamIds.some((id) => (actualCount[id] ?? 0) < gamesPerTeam);
  const interleagueDeficitExists = interleagueConfig.some((cfg) => {
    const total = Number(cfg.game_count);
    if (!Number.isFinite(total) || total <= 0) return false;
    const homeTarget = Math.max(0, Math.min(total, Number(cfg.home_games_per_team) || 0));
    const awayTarget = total - homeTarget;
    return teamIds.some((id) => {
      const have = existingInterleagueCount.get(`${id}|${cfg.interleague_org_id}`) ?? { home: 0, away: 0 };
      return have.home < homeTarget || have.away < awayTarget;
    });
  });

  // If nothing is missing, return early
  if (!intraDeficitExists && !interleagueDeficitExists) {
    return { success: true, gamesCreated: 0, unscheduledCount: 0, conflicts: [] };
  }

  // Build intra-division matchups by cycling round-robin rounds:
  // — At least one side must be below the minimum
  // — Neither side can exceed maxPerTeamFinish (min+1 for odd, min for even)
  // This lets an at-minimum team act as partner for a stuck below-minimum team
  // in odd-team divisions, which is expected and correct behavior.
  const rounds = roundRobinRounds(teamIds);
  const homeCountFinish: Record<string, number> = {};
  teamIds.forEach((id) => { homeCountFinish[id] = 0; });

  const matchups: Matchup[] = [];
  if (intraDeficitExists) {
    let pass = 0;
    const maxPasses = rounds.length * (gamesPerTeam + 2);

    outer:
    while (pass < maxPasses) {
      const round = rounds[pass % rounds.length];
      const pairs: [string, string][] =
        pass % 2 === 0 ? round : round.map(([a, b]) => [b, a] as [string, string]);

      for (const [a, b] of pairs) {
        const aBelowMin = (actualCount[a] ?? 0) < gamesPerTeam;
        const bBelowMin = (actualCount[b] ?? 0) < gamesPerTeam;
        if (!aBelowMin && !bBelowMin) continue;

        if ((actualCount[a] ?? 0) >= maxPerTeamFinish) continue;
        if ((actualCount[b] ?? 0) >= maxPerTeamFinish) continue;

        let homeId = a, awayId = b;
        if (settings.auto_rotate && (homeCountFinish[a] ?? 0) > (homeCountFinish[b] ?? 0)) {
          homeId = b; awayId = a;
        }

        matchups.push({ homeId, awayId, interleagueOrgId: null, isAway: false });
        homeCountFinish[homeId] = (homeCountFinish[homeId] ?? 0) + 1;
        actualCount[a] = (actualCount[a] ?? 0) + 1;
        actualCount[b] = (actualCount[b] ?? 0) + 1;

        if (teamIds.every((id) => (actualCount[id] ?? 0) >= gamesPerTeam)) break outer;
      }

      pass++;
    }
  }

  // Build interleague deficit matchups — split home/away per config.
  matchups.push(...buildInterleagueMatchups(teamIds, interleagueConfig, existingInterleagueCount));

  if (!matchups.length) {
    return {
      success: false,
      error: "Could not generate additional matchups. All teams may already be at or above the minimum game count.",
    };
  }

  // ── 8. Build slot pool ───────────────────────────────────────────────────────

  const slots = buildSlots(
    div.start_date,
    div.end_date,
    settings,
    venueIds,
    venueAvailability,
    blackoutDates,
  );
  if (!slots.length) {
    return {
      success: false,
      error:
        "No valid game slots found. Check that the division's playing days and times overlap with each venue's configured hours.",
    };
  }

  // ── 9. Pre-load ALL venue bookings (existing + cross-division) — no delete ───

  const { data: allVenueGamesRaw } = await supabase
    .from("games")
    .select("venue_id, scheduled_at, home_team_id, away_team_id")
    .in("venue_id", venueIds);

  type VenueGame = { venue_id: string; scheduled_at: string; home_team_id: string; away_team_id: string | null };
  const allVenueGames = (allVenueGamesRaw ?? []) as unknown as VenueGame[];

  const venueBookings = new Map<string, number[]>();
  for (const g of allVenueGames) {
    const vKey = `${g.venue_id}:${g.scheduled_at.substring(0, 10)}`;
    const mins = timeToMinutes(g.scheduled_at.substring(11, 16));
    if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
    venueBookings.get(vKey)!.push(mins);
  }

  // Pre-seed team time, daily, and weekly caps from existing games
  const teamTimes = new Map<string, Set<string>>();
  const teamWeek = new Map<string, number>();
  const teamDay = new Map<string, number>();
  teamIds.forEach((id) => teamTimes.set(id, new Set()));

  for (const g of existingGames) {
    const iso = g.scheduled_at.substring(0, 19);
    const date = g.scheduled_at.substring(0, 10);
    teamTimes.get(g.home_team_id)?.add(iso);
    if (g.away_team_id) teamTimes.get(g.away_team_id)?.add(iso);

    const hdk = `${g.home_team_id}|${date}`;
    teamDay.set(hdk, (teamDay.get(hdk) ?? 0) + 1);
    if (g.away_team_id) {
      const adk = `${g.away_team_id}|${date}`;
      teamDay.set(adk, (teamDay.get(adk) ?? 0) + 1);
    }

    const wk = weekKey(date);
    const hwk = `${g.home_team_id}|${wk}`;
    teamWeek.set(hwk, (teamWeek.get(hwk) ?? 0) + 1);
    if (g.away_team_id) {
      const awk = `${g.away_team_id}|${wk}`;
      teamWeek.set(awk, (teamWeek.get(awk) ?? 0) + 1);
    }
  }

  const minVenueGap = Number(settings.game_duration ?? 0) + Number(settings.buffer_minutes ?? 0);
  const maxPerTeamDay = Math.max(1, Number(settings.max_games_per_team_per_day ?? 1));

  // Pre-seed per-org per-date away count for the field_count cap.
  const awayByOrgDateFinish = new Map<string, number>();
  if (orgIdsFinish.length > 0) {
    const { data: existingAwayRaw } = await supabase
      .from("games")
      .select("interleague_org_id, scheduled_at")
      .eq("league_id", div.league_id)
      .eq("is_away", true)
      .in("interleague_org_id", orgIdsFinish);
    for (const g of (existingAwayRaw ?? []) as Array<{
      interleague_org_id: string | null;
      scheduled_at: string;
    }>) {
      if (!g.interleague_org_id) continue;
      const date = g.scheduled_at.substring(0, 10);
      const key = `${g.interleague_org_id}|${date}`;
      awayByOrgDateFinish.set(key, (awayByOrgDateFinish.get(key) ?? 0) + 1);
    }
  }

  // ── 10. Assign deficit matchups to slots (greedy, same logic as generateSchedule)

  type GameInsert = {
    league_id: string;
    home_team_id: string;
    away_team_id: string | null;
    interleague_org_id: string | null;
    venue_id: string | null;
    scheduled_at: string;
    status: "scheduled" | "pending_interleague";
    is_away: boolean;
  };

  const scheduled: GameInsert[] = [];
  const unscheduled: Matchup[] = [];

  // Deduped (date, time) pool for away matchups — they don't claim a venue.
  const dateTimeOnlySlotsFinish: Slot[] = [];
  {
    const seenIso = new Set<string>();
    for (const s of slots) {
      if (!seenIso.has(s.isoString)) {
        seenIso.add(s.isoString);
        dateTimeOnlySlotsFinish.push(s);
      }
    }
  }

  for (const { homeId, awayId, interleagueOrgId, isAway } of matchups) {
    const status: "scheduled" | "pending_interleague" =
      interleagueOrgId ? "pending_interleague" : "scheduled";
    let assigned = false;

    const pool = isAway ? dateTimeOnlySlotsFinish : slots;

    for (const slot of pool) {
      const vKey = `${slot.venueId}:${slot.date}`;
      const slotMins = timeToMinutes(slot.isoString.substring(11, 16));
      if (!isAway) {
        const bookedMins = venueBookings.get(vKey) ?? [];
        if (bookedMins.some((t) => Math.abs(t - slotMins) < minVenueGap)) continue;
      } else if (interleagueOrgId) {
        const cap = orgFieldCountFinish.get(interleagueOrgId) ?? 1;
        const used = awayByOrgDateFinish.get(`${interleagueOrgId}|${slot.date}`) ?? 0;
        if (used >= cap) continue;
      }
      if (teamTimes.get(homeId)!.has(slot.isoString)) continue;
      if (awayId && teamTimes.get(awayId)!.has(slot.isoString)) continue;

      // max_games_per_team_per_day cap
      const hdk = `${homeId}|${slot.date}`;
      const adk = awayId ? `${awayId}|${slot.date}` : null;
      if ((teamDay.get(hdk) ?? 0) >= maxPerTeamDay) continue;
      if (adk && (teamDay.get(adk) ?? 0) >= maxPerTeamDay) continue;

      const hwk = `${homeId}|${slot.weekKey}`;
      const awk = awayId ? `${awayId}|${slot.weekKey}` : null;
      if ((teamWeek.get(hwk) ?? 0) >= Number(settings.max_games_per_week)) continue;
      if (awk && (teamWeek.get(awk) ?? 0) >= Number(settings.max_games_per_week)) continue;
      if (blocked.get(homeId)!.has(slot.isoString)) continue;
      if (awayId && blocked.get(awayId)!.has(slot.isoString)) continue;

      if (!isAway) {
        if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
        venueBookings.get(vKey)!.push(slotMins);
      } else if (interleagueOrgId) {
        const key = `${interleagueOrgId}|${slot.date}`;
        awayByOrgDateFinish.set(key, (awayByOrgDateFinish.get(key) ?? 0) + 1);
      }
      teamTimes.get(homeId)!.add(slot.isoString);
      if (awayId) teamTimes.get(awayId)!.add(slot.isoString);
      teamDay.set(hdk, (teamDay.get(hdk) ?? 0) + 1);
      if (adk) teamDay.set(adk, (teamDay.get(adk) ?? 0) + 1);
      teamWeek.set(hwk, (teamWeek.get(hwk) ?? 0) + 1);
      if (awk) teamWeek.set(awk, (teamWeek.get(awk) ?? 0) + 1);

      scheduled.push({
        league_id: div.league_id,
        home_team_id: homeId,
        away_team_id: awayId,
        interleague_org_id: interleagueOrgId,
        venue_id: isAway ? null : slot.venueId,
        scheduled_at: slot.isoString,
        status,
        is_away: isAway,
      });
      assigned = true;
      break;
    }

    if (!assigned) unscheduled.push({ homeId, awayId, interleagueOrgId, isAway });
  }

  if (!scheduled.length) {
    return {
      success: false,
      error: "Could not fit the remaining games into available slots. Try extending the season dates, adding venues, or reducing games per team.",
    };
  }

  // ── 11. Bulk-insert only the new games ───────────────────────────────────────

  const BATCH = 500;
  for (let i = 0; i < scheduled.length; i += BATCH) {
    const { error: insertErr } = await supabase
      .from("games")
      .insert(scheduled.slice(i, i + BATCH) as never[]);
    if (insertErr) return { success: false, error: insertErr.message };
  }

  // ── 12. Re-detect cross-division venue conflicts ─────────────────────────────

  type CrossDivRaw = {
    id: string; scheduled_at: string; venue_id: string | null;
    home_team: { name: string; division: { name: string } | null } | null;
    away_team: { name: string } | null;
    venue: { name: string } | null;
  };

  const { data: crossDivRaw } = await supabase
    .from("games")
    .select("id, scheduled_at, venue_id, home_team:teams!home_team_id(name, division:divisions(name)), away_team:teams!away_team_id(name), venue:venues(name)")
    .in("venue_id", venueIds);

  const crossDivGames: ConflictInputGame[] = ((crossDivRaw ?? []) as unknown as CrossDivRaw[]).map((g) => ({
    id: g.id,
    scheduled_at: g.scheduled_at,
    venue_id: g.venue_id,
    venue_name: g.venue?.name ?? "Unknown venue",
    home_team_name: g.home_team?.name ?? "TBD",
    away_team_name: g.away_team?.name ?? "TBD",
    division_name: g.home_team?.division?.name ?? undefined,
  }));

  const conflicts = detectScheduleConflicts(crossDivGames, Number(settings.game_duration), Number(settings.buffer_minutes));

  return {
    success: true,
    gamesCreated: scheduled.length,
    unscheduledCount: unscheduled.length,
    conflicts,
  };
}
