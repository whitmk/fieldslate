// All-games calendar (.ics) for the public league schedule — pure. The same
// rows the page shows (buildRows), as calendar events.
//
// TITLES ARE HOST-FIRST: "<Host> vs <Visitor>" — the CSV exports' order, not
// the team feed's own-team-first. An away interleague game's host is the
// partner. Calendar apps ignore colors, so Home/Away is spelled out in the
// DESCRIPTION.
//
// WHICH GAMES: exactly the page's rows — the reader (0105) withholds unlocked
// divisions, pending interleague games and draft brackets; buildRows adds
// dated playoff games and drops undated ones. A rained-out game stays in the
// feed, marked CANCELLED, so it does not silently vanish from a phone.
//
// TIMES ARE WALL-CLOCK, labelled with the org's timezone and never converted
// (see team-calendar-ics.ts). DTSTAMP is the moment the feed was generated —
// the reader carries no per-game change time — passed in so this stays pure.
//
// NOTHING ELSE is emitted: no admin note, score, official or contact detail;
// the rows never carry one.

import {
  escapeText,
  foldLine,
  timezoneBlock,
  utcStamp,
  usableDuration,
  wallClockPlusMinutes,
  wallClockStamp,
} from "@/lib/calendar/team-calendar-ics";
import { findOrgTimezone } from "@/lib/calendar/timezones";
import { SITE_TAG } from "./classify";
import type { PublicScheduleOk, PublicPlayoffGame } from "./types";
import { buildRows } from "./view";

export const LEAGUE_UID_DOMAIN = "thefieldslate.com";

export type LeagueIcsResult =
  | { ok: true; ics: string; eventCount: number }
  | { ok: false; error: string };

/** "<Host> vs <Visitor>" for a row's underlying game. */
function hostFirstTitle(
  season: PublicScheduleOk["seasons"][number],
  key: string,
  fallback: string,
): string {
  if (key.startsWith("g-")) {
    const g = season.games.find((x) => `g-${x.id}` === key);
    if (g) {
      const ours = g.home_team?.name ?? "TBD";
      const partner = g.external_team_name?.trim() || g.away_team?.name || "TBD";
      return g.interleague && g.is_away === true ? `${partner} vs ${ours}` : `${ours} vs ${partner}`;
    }
  }
  return fallback;
}

export function leagueCalendarName(data: PublicScheduleOk): string {
  const org = data.org.name?.trim();
  return org ? `${org} — all games` : "League games";
}

export function buildLeagueCalendarIcs(data: PublicScheduleOk, generatedAt: string): LeagueIcsResult {
  const zone = findOrgTimezone(data.org.timezone);
  if (!zone) {
    return { ok: false, error: `Can't build the calendar: "${String(data.org.timezone)}" is not a supported timezone.` };
  }
  const stamp = utcStamp(generatedAt);
  if (!stamp) return { ok: false, error: "Can't build the calendar: the generation time is unreadable." };

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FieldSlate//League Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(leagueCalendarName(data))}`,
    `X-WR-TIMEZONE:${zone.id}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...timezoneBlock(zone),
  ];

  let events = 0;
  for (const season of data.seasons) {
    const durations = new Map(season.divisions.map((d) => [d.id, usableDuration(d.game_duration)]));
    const playoffById = new Map<string, PublicPlayoffGame>(season.playoff_games.map((p) => [`p-${p.id}`, p]));
    for (const r of buildRows(season)) {
      const startIso = `${r.date}T${r.time}:00+00:00`;
      const duration = r.divisionId ? durations.get(r.divisionId) ?? null : null;
      const playoff = playoffById.get(r.key);
      const title = playoff ? r.matchup : hostFirstTitle(season, r.key, r.matchup);
      const uid = playoff ? `playoff-${playoff.id}@${LEAGUE_UID_DOMAIN}` : `game-${r.key.slice(2)}@${LEAGUE_UID_DOMAIN}`;
      const place = r.fieldLabel + (r.address ? `, ${r.address}` : "");
      const description = [
        r.struck ? r.statusLabel : SITE_TAG[r.site],
        r.playoffLabel,
        r.divisionName,
        season.name,
      ]
        .filter(Boolean)
        .join(" · ");

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${zone.id}:${wallClockStamp(startIso)}`,
      );
      if (duration !== null) lines.push(`DTEND;TZID=${zone.id}:${wallClockPlusMinutes(startIso, duration)}`);
      lines.push(
        `SUMMARY:${escapeText(r.struck ? `CANCELLED: ${title}` : title)}`,
        `DESCRIPTION:${escapeText(description)}`,
        `LOCATION:${escapeText(place)}`,
        `STATUS:${r.struck ? "CANCELLED" : "CONFIRMED"}`,
        "END:VEVENT",
      );
      events++;
    }
  }

  lines.push("END:VCALENDAR");
  return { ok: true, ics: lines.map(foldLine).join("\r\n") + "\r\n", eventCount: events };
}
