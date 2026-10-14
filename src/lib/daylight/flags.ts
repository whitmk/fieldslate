// Daylight flags — does a game on a field WITHOUT lights end after sunset, or
// close to it? (approved mockup: docs/mockups/daylight-flags.html, 2026-10-14)
//
// PURE: no React, no DOM, no clock, no `toLocale*`. Every surface that shows a
// flag, a dot or a sentence calls THIS module and renders its words VERBATIM —
// the chip, the explanation, the picker notice, the sunset label. Never
// hand-write a daylight sentence at a call site, and never compute a flag
// anywhere else (the picker's eight render sites are why: guard at the layer
// new surfaces inherit).
//
// ADMIN-ONLY. Nothing here may reach a print region, an export, an email, a
// calendar feed, the public league schedule or a partner token page —
// `npm run sim:daylight-leaks` fences every outbound file off this module.
//
// THE RULES (decided 2026-10-14):
// - End = start + the division's `game_duration` resolved by
//   `durationFromSettings` — the SAME rule the manual-move conflict notices
//   use (finite and positive, else 90). Never a sixteenth duration policy;
//   surfaces pass the RAW setting, never a resolved number.
// - Sunset is the shared NOAA approximation (src/lib/sun) for the league's
//   picked city, in that CITY's clock, ROUNDED to the minute once — so the
//   flag and the "Sunset 6:23 PM" a surface prints can never disagree.
//   Game times are wall-clock; they are compared with the city's clock. A
//   league whose timezone setting differs from its city's zone gets a
//   Settings warning (`timezoneMismatchLine`), never a converted time.
// - After sunset: end > sunset. Near sunset: sunset − 20 ≤ end ≤ sunset —
//   ending exactly at sunset is Near, ending exactly 20 minutes before is
//   Near, 21 minutes before is no flag. 20 is fixed for v1.
// - Never flagged: a field with lights, a game with no field, an away
//   interleague game (the partner's field), a game dated before today in the
//   league's timezone, and any status but scheduled / pending_interleague /
//   reschedule_pending — so a rained-out (`cancelled`) game is never flagged;
//   its makeup is checked when it is scheduled.
// - No city, an unknown stored city, or the toggle off → no flags at all.
// - Flags warn; they never block a save.

import { durationFromSettings } from "@/lib/schedule/reschedule-slots";
import { sunsetMinutes } from "@/lib/sun/sunset";
import { cityByIdOrNull, cityTimezone, type UsCity } from "@/lib/sun/us-cities";
import { findOrgTimezone } from "@/lib/calendar/timezones";

/** Minutes before sunset that count as "near". Fixed for v1. */
export const NEAR_SUNSET_MIN = 20;

/** Statuses that can be flagged. Everything else (cancelled = rained out,
 *  completed, …) never is. */
const FLAGGABLE_STATUSES = new Set(["scheduled", "pending_interleague", "reschedule_pending"]);

// ── League settings ─────────────────────────────────────────────────────────

/** The two org settings, as stored on the org owner's profiles row (0109). */
export type DaylightSettings = {
  sunsetCity: string | null;
  enabled: boolean;
};

/**
 * What a surface knows about daylight for this league:
 * - on:           flags are computed for `city`
 * - off:          the league switched flags off — nothing shows, no prompt
 * - no_city:      no city picked — no flags, a one-line prompt
 * - unknown_city: a stored key not in the list — no flags, "pick it again"
 * - error:        the settings could not be read — no flags, said out loud
 */
export type DaylightState =
  | { kind: "on"; city: UsCity }
  | { kind: "off" }
  | { kind: "no_city" }
  | { kind: "unknown_city"; key: string }
  | { kind: "error" };

export function daylightState(settings: DaylightSettings | null): DaylightState {
  if (!settings) return { kind: "error" };
  if (!settings.enabled) return { kind: "off" };
  const key = settings.sunsetCity;
  if (key === null || key === "") return { kind: "no_city" };
  const city = cityByIdOrNull(key);
  return city ? { kind: "on", city } : { kind: "unknown_city", key };
}

/** The one line a Schedule-page-style surface shows when flags can't run.
 *  Null when flags are on or deliberately off. */
export function daylightStatusLine(state: DaylightState): string | null {
  switch (state.kind) {
    case "no_city":
      return "Pick your league's city in Settings to see games that end after sunset.";
    case "unknown_city":
      return "Your league's city for sunset times isn't recognized. Pick it again in Settings.";
    case "error":
      return "Couldn't check daylight for these games.";
    default:
      return null;
  }
}

/**
 * Settings warning when the city's clock and the league's timezone differ.
 * Sunset is figured in the CITY's clock and game times are read against it,
 * so a mismatch most likely means the timezone setting is wrong (it defaults
 * to Pacific for every league).
 */
export function timezoneMismatchLine(city: UsCity, leagueTimezone: string): string | null {
  const cityTz = cityTimezone(city);
  if (!cityTz || cityTz === leagueTimezone) return null;
  const cityLabel = findOrgTimezone(cityTz)?.label ?? cityTz;
  const leagueLabel = findOrgTimezone(leagueTimezone)?.label ?? leagueTimezone;
  return `${city.name} is on ${zoneWords(cityLabel)}, but your league's timezone is set to ${zoneWords(leagueLabel)}. Sunset times are figured for ${city.name}, so check the timezone setting.`;
}

function zoneWords(label: string): string {
  // "Arizona (no daylight time)" → "Arizona time (no daylight time)"
  const paren = label.indexOf(" (");
  return paren === -1 ? `${label} time` : `${label.slice(0, paren)} time${label.slice(paren)}`;
}

// ── Sunset ──────────────────────────────────────────────────────────────────

/** Sunset on a "YYYY-MM-DD" date in the city's clock, whole minutes after
 *  midnight. The ONE rounding; every flag and label uses this number. */
export function sunsetMinuteOn(date: string, city: UsCity): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(sunsetMinutes(Date.UTC(y, m - 1, d), city));
}

/** "6:23 PM" — sunset alone, for a narrow day cell (title it with sunsetLabel). */
export function sunsetTime(date: string, city: UsCity): string {
  return fmtClock(sunsetMinuteOn(date, city));
}

/** "Sunset 6:23 PM" — a day header or slot-group label. */
export function sunsetLabel(date: string, city: UsCity): string {
  return `Sunset ${fmtClock(sunsetMinuteOn(date, city))}`;
}

// ── The flag ────────────────────────────────────────────────────────────────

/** Everything the rule needs about one game, from any table. */
export type DaylightGame = {
  /** Wall-clock date "YYYY-MM-DD". */
  date: string;
  /** Wall-clock start "HH:MM" or "HH:MM:SS". */
  startTime: string;
  /** The division's RAW `game_duration` setting — resolved here, never by the caller. */
  rawDuration: unknown;
  /** The field the game is on, or null when there is none. */
  venue: { has_lights: boolean } | null;
  /** An interleague game at the partner's field. */
  isAway: boolean;
  status: string;
};

export type DaylightFlag = {
  kind: "after" | "near";
  /** after: minutes past sunset; near: minutes before it (0 = at sunset). */
  minutes: number;
  date: string;
  sunsetMin: number;
  endMin: number;
  /** Latest start on a 5-minute grid that ends more than 20 minutes before
   *  sunset — a time that carries NO flag. Null if none exists that day. */
  startByMin: number | null;
};

/** A games-table row's date and start, read from the wall-clock string (house
 *  convention — never parse the instant). */
export function partsFromScheduledAt(scheduledAt: string): { date: string; startTime: string } {
  return { date: scheduledAt.substring(0, 10), startTime: scheduledAt.substring(11, 16) };
}

/**
 * The flag for one game, or null. `today` is "YYYY-MM-DD" in the league's
 * timezone (src/lib/utils/org-today.ts) — a game dated before it is never
 * flagged.
 */
export function daylightFlag(game: DaylightGame, state: DaylightState, today: string): DaylightFlag | null {
  if (state.kind !== "on") return null;
  if (!FLAGGABLE_STATUSES.has(game.status)) return null;
  if (game.isAway || game.venue === null) return null;
  if (game.venue.has_lights) return null;
  if (game.date < today) return null;
  const start = clockToMinutes(game.startTime);
  if (start === null || !/^\d{4}-\d{2}-\d{2}$/.test(game.date)) return null;
  const duration = durationFromSettings({ game_duration: game.rawDuration });
  const endMin = start + duration;
  const sunsetMin = sunsetMinuteOn(game.date, state.city);
  const latest = sunsetMin - NEAR_SUNSET_MIN - 1 - duration;
  const startByMin = latest >= 0 ? Math.floor(latest / 5) * 5 : null;
  const base = { date: game.date, sunsetMin, endMin, startByMin };
  if (endMin > sunsetMin) return { kind: "after", minutes: endMin - sunsetMin, ...base };
  if (endMin >= sunsetMin - NEAR_SUNSET_MIN) return { kind: "near", minutes: sunsetMin - endMin, ...base };
  return null;
}

/** Same rule for a PICKER SLOT: the slot's own date/time at a field, for the
 *  game being placed. Status and today don't apply — the admin is choosing
 *  this time now. */
export function slotDaylightFlag(
  slot: { date: string; startTime: string },
  rawDuration: unknown,
  venue: { has_lights: boolean } | null,
  state: DaylightState,
): DaylightFlag | null {
  return daylightFlag(
    { date: slot.date, startTime: slot.startTime, rawDuration, venue, isAway: false, status: "scheduled" },
    state,
    "0000-00-00",
  );
}

// ── Words (render VERBATIM) ─────────────────────────────────────────────────

/** Chip on a schedule row, phone card, popover or panel row:
 *  "52 min after sunset" / "6 min before sunset" / "Ends at sunset". */
export function daylightChipText(flag: DaylightFlag): string {
  if (flag.kind === "after") return `${flag.minutes} min after sunset`;
  if (flag.minutes === 0) return "Ends at sunset";
  return `${flag.minutes} min before sunset`;
}

/** Chip on a bracket card: "Ends 1 min after sunset" / "Ends 5 min before sunset". */
export function daylightBracketChipText(flag: DaylightFlag): string {
  if (flag.kind === "after") return `Ends ${flag.minutes} min after sunset`;
  if (flag.minutes === 0) return "Ends at sunset";
  return `Ends ${flag.minutes} min before sunset`;
}

/** Tooltip / title for a slot dot. */
export function daylightDotTitle(flag: DaylightFlag): string {
  return flag.kind === "after" ? "Ends after sunset" : "Ends near sunset";
}

/**
 * The game-details explanation: why, and what would fix it.
 * "Ends 52 minutes after sunset. Sunset that day is 6:23 PM, and Galvin Park
 *  — Field 2 has no lights. To finish in daylight, start by 4:00 PM."
 */
export function daylightExplanation(flag: DaylightFlag, fieldLabel: string): string {
  const lead =
    flag.kind === "after"
      ? `Ends ${minutesWord(flag.minutes)} after sunset.`
      : flag.minutes === 0
        ? "Ends at sunset."
        : `Ends ${minutesWord(flag.minutes)} before sunset.`;
  const why = `Sunset that day is ${fmtClock(flag.sunsetMin)}, and ${fieldLabel} has no lights.`;
  const fix =
    flag.startByMin === null
      ? `There's no start time that day that finishes ${NEAR_SUNSET_MIN} minutes before sunset.`
      : flag.kind === "after"
        ? `To finish in daylight, start by ${fmtClock(flag.startByMin)}.`
        : `To finish more than ${NEAR_SUNSET_MIN} minutes before sunset, start by ${fmtClock(flag.startByMin)}.`;
  return `${lead} ${why} ${fix}`;
}

/**
 * The picker notice once a flagged time is chosen:
 * "This time ends 18 minutes after sunset (6:12 PM on Oct 31). Galvin Park —
 *  Field 2 has no lights. You can still save it."
 */
export function daylightPickNotice(flag: DaylightFlag, fieldLabel: string): string {
  const when = `(${fmtClock(flag.sunsetMin)} on ${fmtMonthDay(flag.date)})`;
  const lead =
    flag.kind === "after"
      ? `This time ends ${minutesWord(flag.minutes)} after sunset ${when}.`
      : flag.minutes === 0
        ? `This time ends at sunset ${when}.`
        : `This time ends ${minutesWord(flag.minutes)} before sunset ${when}.`;
  return `${lead} ${fieldLabel} has no lights. You can still save it.`;
}

/** The Daylight filter's chip: "Daylight: 3 games". */
export function daylightFilterLabel(count: number): string {
  return `Daylight: ${count} ${count === 1 ? "game" : "games"}`;
}

// ── Formatting (no locale APIs: server and browser must agree) ─────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function minutesWord(n: number): string {
  return `${n} ${n === 1 ? "minute" : "minutes"}`;
}

/** 1103 → "6:23 PM". Minutes past midnight wrap. */
export function fmtClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

function fmtMonthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function clockToMinutes(t: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

// ── A games-table row (Schedule page, division panel, dashboard cards) ──────

/** The minimum a `games` row needs for its flag. */
export type DaylightGamesRow = {
  scheduled_at: string;
  status: string;
  is_away?: boolean | null;
  venue_id?: string | null;
  venue: { has_lights?: boolean | null } | null;
};

/**
 * A `games` row's flag, and whether it is on a lit field (the "Lights" tag —
 * shown only while flags are on). The venue counts as present only when the
 * row has a field id AND its embed; an away interleague game is never either.
 * `has_lights` missing from the embed reads as unlit (the column's default).
 */
export function gamesRowDaylight(
  row: DaylightGamesRow,
  rawDuration: unknown,
  state: DaylightState,
  today: string,
): { flag: DaylightFlag | null; lit: boolean } {
  const isAway = row.is_away === true;
  const venue = row.venue_id && row.venue ? { has_lights: row.venue.has_lights === true } : null;
  const { date, startTime } = partsFromScheduledAt(row.scheduled_at);
  const flag = daylightFlag({ date, startTime, rawDuration, venue, isAway, status: row.status }, state, today);
  const lit = state.kind === "on" && !isAway && venue?.has_lights === true;
  return { flag, lit };
}
