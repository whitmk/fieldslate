// Team calendar feed (.ics) builder — pure. Turns the rows the token reader
// returns into the text a phone calendar subscribes to.
//
// WHICH games appear, and who is home, come from the shared
// normalizeExportGames (keepCancelled ON) — never a filter of its own. A
// pending interleague game is never in the feed; a cancelled game stays in
// it, marked, so it does not silently vanish from a parent's phone.
//
// TIMES ARE WALL-CLOCK, NEVER CONVERTED. `scheduled_at` stores the local time
// with a literal +00 ("2026-10-24T09:00:00+00:00" means 9:00 AM at the field —
// see game-time.ts). The date and time are read from the TEXT and labelled
// with the org's timezone (DTSTART;TZID=…). Nothing here parses the instant or
// reads the host clock, so the output is identical on a UTC server and a
// Pacific laptop. The one real instant is `updated_at`, emitted in UTC.
//
// WHAT IS EMITTED, exhaustively: team names, division name, season name,
// venue/park/field names, start, end, cancelled status, and the game's id and
// last-change time. NOTHING ELSE — no game notes, no coach or contact
// details, no officials, no scores. Every value is read from a NAMED field;
// never spread or stringify an input object into the output.
//
// END TIME = start + the division's game duration. A missing or unusable
// duration means the event carries a START ONLY — never a guessed length and
// never `?? 0` (house rule: undefined means unresolved).

import { normalizeExportGames, type ExportGame } from "@/lib/schedule/export-games";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import { findOrgTimezone, type OrgTimezone } from "./timezones";

export type TeamCalendarGame = ExportGame & {
  /** A real instant — when the game row last changed. */
  updated_at: string;
};

export type TeamCalendarInput = {
  team: { name: string };
  division: { name: string; game_duration: unknown };
  season: { name: string };
  org: { timezone: string };
  games: TeamCalendarGame[];
};

export type TeamCalendarResult =
  | { ok: true; ics: string; eventCount: number }
  | { ok: false; error: string };

export const CALENDAR_UID_DOMAIN = "thefieldslate.com";

/** Stable for the life of the game row: a moved game keeps its id, so the
 *  event on the phone moves instead of duplicating. */
export function gameUid(gameId: string): string {
  return `game-${gameId}@${CALENDAR_UID_DOMAIN}`;
}

/** RFC 5545 TEXT escaping. */
function escapeText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line at 75 OCTETS, never inside a multi-byte character. */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-10-24T09:00…" → "20261024T090000", from the text. */
function wallClockStamp(iso: string): string {
  return `${iso.substring(0, 4)}${iso.substring(5, 7)}${iso.substring(8, 10)}T${iso.substring(11, 13)}${iso.substring(14, 16)}00`;
}

/** Wall-clock start + minutes, rolling the calendar date when it crosses
 *  midnight. Date.UTC is used as a plain calendar — no zone is involved. */
function wallClockPlusMinutes(iso: string, minutes: number): string {
  const t = Date.UTC(
    Number(iso.substring(0, 4)),
    Number(iso.substring(5, 7)) - 1,
    Number(iso.substring(8, 10)),
    Number(iso.substring(11, 13)),
    Number(iso.substring(14, 16)) + minutes,
  );
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}00`;
}

/** A real instant → UTC stamp ("20260929T214500Z"). Null when unparseable. */
function utcStamp(instant: string): string | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

function usableDuration(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function timezoneBlock(z: OrgTimezone): string[] {
  const lines = ["BEGIN:VTIMEZONE", `TZID:${z.id}`];
  if (z.daylight) {
    lines.push(
      "BEGIN:DAYLIGHT",
      `TZOFFSETFROM:${z.standard.offset}`,
      `TZOFFSETTO:${z.daylight.offset}`,
      `TZNAME:${z.daylight.abbr}`,
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${z.daylight.offset}`,
      `TZOFFSETTO:${z.standard.offset}`,
      `TZNAME:${z.standard.abbr}`,
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "END:STANDARD",
    );
  } else {
    lines.push(
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${z.standard.offset}`,
      `TZOFFSETTO:${z.standard.offset}`,
      `TZNAME:${z.standard.abbr}`,
      "DTSTART:19700101T000000",
      "END:STANDARD",
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

export function buildTeamCalendarIcs(input: TeamCalendarInput): TeamCalendarResult {
  // Fail LOUD on a timezone we cannot describe: a feed labelled with the wrong
  // zone puts every game at the wrong hour on every phone.
  const zone = findOrgTimezone(input.org.timezone);
  if (!zone) {
    return {
      ok: false,
      error: `Can't build the calendar: "${String(input.org.timezone)}" is not a supported timezone.`,
    };
  }

  const duration = usableDuration(input.division.game_duration);
  const updatedAtById = new Map(input.games.map((g) => [g.id, g.updated_at]));
  const rows = normalizeExportGames(input.games, { keepCancelled: true });

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FieldSlate//Team Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`${input.team.name} — ${input.season.name}`)}`,
    `X-WR-TIMEZONE:${zone.id}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...timezoneBlock(zone),
  ];

  for (const r of rows) {
    const changed = utcStamp(updatedAtById.get(r.id) ?? "");
    if (!changed) {
      return {
        ok: false,
        error: `Can't build the calendar: game ${r.id} has no readable last-change time.`,
      };
    }
    const matchup = `${r.homeName} vs ${r.awayName}`;
    const place = r.venueName
      ? qualifiedVenueLabel({ name: r.venueName, location: r.locationName ? { name: r.locationName } : null })
      : r.partnerFieldName;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${gameUid(r.id)}`,
      `DTSTAMP:${changed}`,
      `LAST-MODIFIED:${changed}`,
      `DTSTART;TZID=${zone.id}:${wallClockStamp(r.scheduledAt)}`,
    );
    if (duration !== null) {
      lines.push(`DTEND;TZID=${zone.id}:${wallClockPlusMinutes(r.scheduledAt, duration)}`);
    }
    lines.push(
      `SUMMARY:${escapeText(r.cancelled ? `CANCELLED: ${matchup}` : matchup)}`,
      `DESCRIPTION:${escapeText(`${input.division.name} · ${input.season.name}`)}`,
    );
    if (place) lines.push(`LOCATION:${escapeText(place)}`);
    lines.push(`STATUS:${r.cancelled ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return { ok: true, ics: lines.map(foldLine).join("\r\n") + "\r\n", eventCount: rows.length };
}
