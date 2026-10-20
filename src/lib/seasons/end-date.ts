// The season-page end-date editor's rules and words (pure). Rendered verbatim
// by EndDateModal in editable-league-header.tsx.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-25" → "Oct 25, 2026". String arithmetic only — no Date, no locale. */
export function fmtSeasonDate(d: string): string {
  const [y, m, day] = d.substring(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

/** Shown in the editor, always. */
export const END_DATE_NOTE =
  "The end date decides when this season archives — once it has passed and every game, playoffs included, has been played — and when parents’ calendar feeds and the public schedule stop showing it: 7 days after the end date or the season’s last game, whichever is later.";

export const LAST_GAME_UNKNOWN = "Couldn’t check the season’s last game date.";

export type EndDateCheck = { error: string | null; warning: string | null };

/**
 * error   — blocks Save: no date, or before the season starts.
 * warning — never blocks: the date is before the season's last dated game
 *           (regular season or playoff).
 */
export function endDateEditCheck(
  startDate: string | null,
  newEnd: string,
  lastGameDate: string | null,
): EndDateCheck {
  if (!DATE_RE.test(newEnd)) return { error: "Enter an end date.", warning: null };
  if (startDate && DATE_RE.test(startDate) && newEnd < startDate) {
    return { error: `The end date can’t be before the season starts (${fmtSeasonDate(startDate)}).`, warning: null };
  }
  if (lastGameDate && newEnd < lastGameDate) {
    return {
      error: null,
      warning: `The last game on the schedule is ${fmtSeasonDate(lastGameDate)}, after this end date. The season stays active until that game has been played, and parents’ calendar feeds and the public schedule keep showing it until 7 days after that game.`,
    };
  }
  return { error: null, warning: null };
}
