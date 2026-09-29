// Generic per-division games CSV (Season page → Export PDF / CSV → Games →
// CSV). Kept out of the modal so it can be exercised directly.
//
// WHICH games appear, and who is home, come from the shared
// normalizeExportGames — the same function the Sports Connect CSV uses, so
// the two files always contain the same games. This file owns only the
// generic format, which is unchanged: six columns, every value quoted,
// MM/DD/YYYY, 12-hour hh:mm AM/PM, CRLF between lines, no trailing newline.
// (The BOM is added at download time by the modal.)
//
// "Location/Field Name" is our venue's bare name, or the partner's field on
// an interleague away game; blank when unknown.

import { normalizeExportGames, type ExportGame } from "./export-games";
import {
  fetchSportsConnectGames,
  type SportsConnectFetchClient,
} from "./sports-connect-export";

export const GENERIC_GAMES_COLUMNS = [
  "Home Team",
  "Away Team",
  "Date",
  "Start Time",
  "Location/Field Name",
  "Division Name",
];

export type GenericGamesResult =
  | { ok: true; csv: string; rowCount: number }
  | { ok: false; error: string };

function csvEscape(val: string): string {
  return `"${val.replace(/"/g, '""')}"`;
}

function fmtCsvDate(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

function fmtCsvTime(iso: string): string {
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const h12 = hour % 12 || 12;
  return `${h12.toString().padStart(2, "0")}:${minStr} ${hour >= 12 ? "PM" : "AM"}`;
}

export function buildGenericGamesCsv(
  games: ExportGame[],
  divisionName: string,
): { csv: string; rowCount: number } {
  const header = GENERIC_GAMES_COLUMNS.map(csvEscape).join(",");
  const rows = normalizeExportGames(games).map((r) =>
    [
      r.homeName,
      r.awayName,
      fmtCsvDate(r.scheduledAt),
      fmtCsvTime(r.scheduledAt),
      r.venueName || r.partnerFieldName,
      divisionName,
    ]
      .map(csvEscape)
      .join(","),
  );
  return { csv: [header, ...rows].join("\r\n"), rowCount: rows.length };
}

/** Read + build. On ANY read error this returns `ok: false` and NO csv — the
 *  caller shows the error and must not download a file. "No games" and "we
 *  could not read the games" look identical in a header-only file. */
export async function exportGenericGamesCsv(
  supabase: SportsConnectFetchClient,
  divisionId: string,
  divisionName: string,
): Promise<GenericGamesResult> {
  const fetched = await fetchSportsConnectGames(supabase, divisionId);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  return { ok: true, ...buildGenericGamesCsv(fetched.games, divisionName) };
}
