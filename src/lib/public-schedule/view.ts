// Public league schedule — every decision the page makes, PURE. The page,
// its print, and `npm run sim:public-schedule` all call these; the component
// holds no second copy of any rule.
//
// NO CLOCK. "Today" is the org's date as the database computed it (0105 emits
// it), so the default season, Upcoming and the month the calendar opens on
// never depend on the viewer's machine or the server's zone.
//
// WALL-CLOCK TIMES. `scheduled_at` is local time with a literal +00 — read by
// substring, never parsed as an instant (house rule, game-time.ts).

import type { GameRow } from "@/lib/playoffs/advancement";
import { emptySlotLabel, shownGameNumber, type SeedSlots } from "@/lib/playoffs/bracket-labels";
import { rrGameLabel } from "@/lib/playoffs/two-stage";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  gameStatusDisplay,
  playoffStatusDisplay,
  siteOf,
  type Site,
} from "./classify";
import type { PublicPlayoffGame, PublicSeason, PublicVenue } from "./types";

export type ScheduleRow = {
  key: string;
  kind: "game" | "playoff";
  /** YYYY-MM-DD */
  date: string;
  /** "HH:MM" */
  time: string;
  /** "HH:MM" (may roll past midnight — display only), or null when the
   *  division's duration is unusable: start time only, never a guess. */
  endTime: string | null;
  divisionId: string | null;
  divisionName: string;
  teamIds: string[];
  matchup: string;
  site: Site;
  fieldLabel: string;
  address: string | null;
  interleague: boolean;
  /** "Playoffs · Semifinal · Game 3", playoff rows only. */
  playoffLabel: string | null;
  struck: boolean;
  /** Replaces the site tag on a struck row ("Rained out"), or a note beside
   *  it ("Time may change"). */
  statusLabel: string | null;
  statusIsNote: boolean;
};

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** Weekday of a calendar date, independent of the host zone. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Saturday, October 10" */
export function longDayLabel(date: string): string {
  const [, m, d] = ymd(date);
  return `${WEEKDAYS_LONG[weekdayIndex(date)]}, ${MONTHS_LONG[m - 1]} ${d}`;
}

/** "Sat, Oct 10" */
export function shortDayLabel(date: string): string {
  const [, m, d] = ymd(date);
  return `${WEEKDAYS_LONG[weekdayIndex(date)].slice(0, 3)}, ${MONTHS_SHORT[m - 1]} ${d}`;
}

/** "October 2026" from "2026-10". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "9:00 AM" from "09:00". */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function usableDuration(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function plusMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function fieldOf(venue: PublicVenue, partnerField: string | null): { label: string; address: string | null } {
  if (venue) return { label: qualifiedVenueLabel(venue), address: venue.address?.trim() || null };
  return { label: partnerField?.trim() || "Field to be announced", address: null };
}

const ROUND_NAMES: Record<string, string> = {
  F: "Final",
  SF: "Semifinal",
  "WB-F": "Winners final",
  "LB-F": "Elimination final",
  GF: "Championship",
  "GF-R": "Championship, if needed",
};

export function playoffRoundName(round: string): string {
  if (round in ROUND_NAMES) return ROUND_NAMES[round];
  let m = round.match(/^WB-R(\d+)$/);
  if (m) return `Winners round ${m[1]}`;
  m = round.match(/^LB-R(\d+)$/);
  if (m) return `Elimination round ${m[1]}`;
  m = round.match(/^R(\d+)$/);
  if (m) return `Round ${m[1]}`;
  if (round.startsWith("RR")) return "Round robin";
  return round;
}

/** The label for an empty slot: "Winner of Game N" or "TBD". No rule of its
 *  own — it maps the public rows onto the shared one (emptySlotLabel →
 *  singleElimFeeder → singleElimTarget in advancement.ts), the same rule that
 *  moves a winner and labels the in-app and printed brackets. A feeder that
 *  does not exist (a bye) or any other format → "TBD"; we never guess. */
export function openSlotLabel(
  game: PublicPlayoffGame,
  side: "home" | "away",
  bracket: PublicPlayoffGame[],
): string {
  const asRow = (g: PublicPlayoffGame): GameRow & SeedSlots => ({
    id: g.id,
    round: g.round,
    game_number: g.game_number,
    home_team_id: g.home_team?.id ?? null,
    away_team_id: g.away_team?.id ?? null,
    winner_id: null,
    seed_home: g.seed_home ?? null,
    seed_away: g.seed_away ?? null,
  });
  return emptySlotLabel(asRow(game), side, bracket.map(asRow), game.format);
}

/** Every row the season can show: regular games + DATED playoff games, sorted
 *  by date, time, then id. */
export function buildRows(season: PublicSeason): ScheduleRow[] {
  const divisions = new Map(season.divisions.map((d) => [d.id, d]));
  const rows: ScheduleRow[] = [];

  for (const g of season.games) {
    // The reader already withholds these; this is the second lock on the door.
    if (g.status === "pending_interleague") continue;
    const div = g.division_id ? divisions.get(g.division_id) : undefined;
    const time = g.scheduled_at.substring(11, 16);
    const duration = usableDuration(div?.game_duration);
    const partnerAway = g.interleague && g.is_away === true;
    const ours = g.home_team?.name ?? "TBD";
    const opponent = g.external_team_name?.trim() || g.away_team?.name || "TBD";
    const field = fieldOf(g.venue, partnerAway ? g.proposed_venue_name : null);
    const status = gameStatusDisplay(g.status);
    rows.push({
      key: `g-${g.id}`,
      kind: "game",
      date: g.scheduled_at.substring(0, 10),
      time,
      endTime: duration !== null ? plusMinutes(time, duration) : null,
      divisionId: g.division_id,
      divisionName: div?.name ?? "",
      teamIds: [g.home_team_id, g.away_team_id].filter((x): x is string => !!x),
      // Away interleague: our team first, "at" the host — the way a parent
      // reads their own team's schedule.
      matchup: partnerAway ? `${ours} at ${opponent}` : `${ours} vs ${opponent}`,
      site: siteOf(g.venue, partnerAway),
      fieldLabel: field.label,
      address: field.address,
      interleague: g.interleague,
      playoffLabel: null,
      struck: status.struck,
      statusLabel: status.label,
      statusIsNote: status.note,
    });
  }

  // A division with a Stage 2 bracket is a two-stage setup ("Round robin,
  // then bracket"): its labels name the stage, and its round-robin games read
  // "RR Game N" so "Game N" always means the bracket (approved mockup, 12).
  const twoStageDivisions = new Set(
    season.playoff_games.filter((p) => p.stage === 2).map((p) => p.division_id),
  );
  const brackets = new Map<string, PublicPlayoffGame[]>();
  for (const p of season.playoff_games) {
    if (!brackets.has(p.playoff_id)) brackets.set(p.playoff_id, []);
    brackets.get(p.playoff_id)!.push(p);
  }
  // "Game N" is the SHOWN number within the game's own bracket (bracket-labels
  // `gameNumbering`) — the reader returns every game of the bracket, dated or
  // not, so the numbering is the same one the admin sees.
  const shown = (p: PublicPlayoffGame) => shownGameNumber(p, brackets.get(p.playoff_id) ?? [p]);
  const playoffLabelOf = (p: PublicPlayoffGame): string => {
    if (p.stage === 2) return `Playoffs · Bracket · ${playoffRoundName(p.round)} · Game ${shown(p)}`;
    if (twoStageDivisions.has(p.division_id)) return `Playoffs · Round robin · ${rrGameLabel(p.game_number)}`;
    return `Playoffs · ${playoffRoundName(p.round)} · Game ${shown(p)}`;
  };
  for (const p of season.playoff_games) {
    if (!p.scheduled_date || !p.start_time) continue;
    const bracket = brackets.get(p.playoff_id) ?? [];
    const div = divisions.get(p.division_id);
    const duration = usableDuration(div?.game_duration);
    const home = p.home_team?.name ?? openSlotLabel(p, "home", bracket);
    const away = p.away_team?.name ?? openSlotLabel(p, "away", bracket);
    const field = fieldOf(p.venue, null);
    const status = playoffStatusDisplay(p.status);
    rows.push({
      key: `p-${p.id}`,
      kind: "playoff",
      date: p.scheduled_date,
      time: p.start_time,
      endTime: duration !== null ? plusMinutes(p.start_time, duration) : null,
      divisionId: p.division_id,
      divisionName: div?.name ?? "",
      teamIds: [p.home_team?.id, p.away_team?.id].filter((x): x is string => !!x),
      matchup: `${home} vs ${away}`,
      site: siteOf(p.venue, false),
      fieldLabel: field.label,
      address: field.address,
      interleague: false,
      playoffLabel: playoffLabelOf(p),
      struck: status.struck,
      statusLabel: status.label,
      statusIsNote: status.note,
    });
  }

  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.key.localeCompare(b.key),
  );
}

export type RowFilter = {
  divisionId: string | null;
  teamId: string | null;
  range: "upcoming" | "all";
  today: string;
};

export function filterRows(rows: ScheduleRow[], f: RowFilter): ScheduleRow[] {
  return rows.filter(
    (r) =>
      (f.divisionId === null || r.divisionId === f.divisionId) &&
      (f.teamId === null || r.teamIds.includes(f.teamId)) &&
      (f.range === "all" || r.date >= f.today),
  );
}

export function groupByDate(rows: ScheduleRow[]): { date: string; rows: ScheduleRow[] }[] {
  const out: { date: string; rows: ScheduleRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else out.push({ date: r.date, rows: [r] });
  }
  return out;
}

/** The default season: the one containing today, else the next to start, else
 *  the latest to end. Null only when there are no seasons. */
export function defaultSeasonId(seasons: PublicSeason[], today: string): string | null {
  if (seasons.length === 0) return null;
  const containing = seasons.find(
    (s) => (s.start_date === null || s.start_date <= today) && (s.end_date === null || today <= s.end_date),
  );
  if (containing) return containing.id;
  const upcoming = seasons
    .filter((s) => s.start_date !== null && s.start_date > today)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  if (upcoming.length > 0) return upcoming[0].id;
  return [...seasons].sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""))[0].id;
}

/** What a printed page says it shows: "All divisions", "Majors only",
 *  "Expos only", "Majors · Expos only". A filtered print that does not say so
 *  reads as the whole season. */
export function filterSummary(divisionName: string | null, teamName: string | null): string {
  if (divisionName && teamName) return `${divisionName} · ${teamName} only`;
  if (teamName) return `${teamName} only`;
  if (divisionName) return `${divisionName} only`;
  return "All divisions";
}

/** A card's lines, in a FIXED order: field, the address when known, then
 *  "division · until time" (just the division when the end is unknown). */
export function cardLines(row: ScheduleRow): string[] {
  const lines = [row.fieldLabel];
  if (row.address) lines.push(row.address);
  const tail = [row.divisionName, row.endTime ? `until ${fmtTime(row.endTime)}` : ""].filter(Boolean).join(" · ");
  if (tail) lines.push(tail);
  return lines;
}

/** The month a calendar view opens on: today's month if it has rows, else the
 *  first month with an upcoming row, else the last month with any row. */
export function initialMonth(rows: ScheduleRow[], today: string): string {
  const months = [...new Set(rows.map((r) => r.date.substring(0, 7)))];
  const thisMonth = today.substring(0, 7);
  if (months.includes(thisMonth)) return thisMonth;
  const next = months.find((m) => m > thisMonth);
  return next ?? months[months.length - 1] ?? thisMonth;
}

/** Monday-first grid for a month: leading/trailing blanks are null. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${month}-01`;
  const lead = (weekdayIndex(first) + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** A Google Maps search for an address. */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
