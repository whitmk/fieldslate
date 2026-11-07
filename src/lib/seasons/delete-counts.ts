// The season delete confirm's "What gets deleted" counts (2026-11-06).
//
// A failed head count used to render as 0 ("0 divisions, 0 teams, 0 games"),
// which on a destructive confirm reads as "nothing to lose". Any reply with an
// error, or without a numeric count, now makes the WHOLE set unknown and the
// modal says so — never a mix of real numbers and silent zeros. Same rule as
// the division delete confirm ("Division deletion" in CLAUDE.md).

export type HeadReply = { count: number | null | undefined; error: unknown };

export type SeasonDeleteCountReplies = {
  divisions: HeadReply;
  teams: HeadReply;
  games: HeadReply;
  officials: HeadReply;
  interleague: HeadReply;
};

export type SeasonDeleteCounts =
  | {
      ok: true;
      divisions: number;
      teams: number;
      games: number;
      officials: number;
      interleague: number;
    }
  | { ok: false };

function readable(r: HeadReply): r is { count: number; error: null } {
  return !r.error && typeof r.count === "number";
}

export function seasonDeleteCountsFrom(r: SeasonDeleteCountReplies): SeasonDeleteCounts {
  const all = [r.divisions, r.teams, r.games, r.officials, r.interleague];
  if (!all.every(readable)) return { ok: false };
  return {
    ok: true,
    divisions: r.divisions.count as number,
    teams: r.teams.count as number,
    games: r.games.count as number,
    officials: r.officials.count as number,
    interleague: r.interleague.count as number,
  };
}

export const SEASON_COUNTS_FAILED =
  "Couldn't count what's in this season. Everything below still gets deleted — reload and try again if you want the numbers first.";

export const SEASON_INTERLEAGUE_UNKNOWN =
  "Couldn't check for accepted interleague games. Any this season has will be deleted too, and the partner leagues won't be notified.";
