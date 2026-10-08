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

import { getRoundOrder } from "@/lib/playoffs/advancement";
import { singleElimFirstNumber } from "@/lib/playoffs/bracket-plan";
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

/** The label for an empty slot. Single elimination only: the slot's feeder is
 *  the previous round's game at position 2q (home) / 2q+1 (away), numbered
 *  positionally (bracket-plan.ts). A feeder that does not exist (a bye) or any
 *  other format → "TBD"; we never guess a source. */
export function openSlotLabel(
  game: PublicPlayoffGame,
  side: "home" | "away",
  bracket: PublicPlayoffGame[],
): string {
  if (game.format !== "single_elimination") return "TBD";
  const rounds = [...new Set(bracket.map((g) => g.round))].sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
  const k = rounds.indexOf(game.round);
  if (k <= 0) return "TBD";
  const size = Math.pow(2, rounds.length);
  const pos = game.game_number - singleElimFirstNumber(k, size);
  if (pos < 0) return "TBD";
  const feederNumber = singleElimFirstNumber(k - 1, size) + 2 * pos + (side === "home" ? 0 : 1);
  const feeder = bracket.find((g) => g.round === rounds[k - 1] && g.game_number === feederNumber);
  return feeder ? `Winner of Game ${feederNumber}` : "TBD";
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

  const brackets = new Map<string, PublicPlayoffGame[]>();
  for (const p of season.playoff_games) {
    if (!brackets.has(p.playoff_id)) brackets.set(p.playoff_id, []);
    brackets.get(p.playoff_id)!.push(p);
  }
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
      playoffLabel: `Playoffs · ${playoffRoundName(p.round)} · Game ${p.game_number}`,
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
