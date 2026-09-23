// Interleague games a regenerate REFUSED TO DELETE, and the one place their
// wording lives.
//
// WHY THIS EXISTS. Regenerating a division deletes its games and rebuilds them.
// Accepted interleague games were already preserved; a game in
// `pending_interleague` was NOT, so a regenerate silently deleted a live
// negotiation — the `interleague_reschedule_requests` row cascaded with it and
// the partner's respond link died with no email to either side, showing them
// only "This link is no longer active … reach out to the league admin", who by
// then had no record of it either.
//
// PRESERVE AND REPORT, NOT REFUSE. A schedule lock refuses the whole
// regenerate, which is right because an admin can lift a lock in one click. A
// negotiation cannot be cleared in one click — nothing forces it to converge —
// so refusing would leave the division unregenerable until the partner replies.
// The game is kept, the rest regenerates, and the admin is TOLD, by name. A
// silent skip is only marginally better than a silent delete.
//
// This module is pure and carries no directive so the sim can drive it.

/** One game a regenerate kept, with enough to name it on screen. */
export interface PreservedGame {
  id: string;
  /** Stored wall-clock ISO, e.g. "2026-10-04T13:00:00+00". */
  scheduledAt: string;
  /** The partner league/team as we know it: the countered team name when the
   *  partner supplied one, else the partner org's name, else a literal. */
  opponentLabel: string;
  reason: PreservedReason;
}

export type PreservedReason =
  /** pending_interleague with partner involvement: a counter, a proposed time,
   *  or a reschedule request row. A live negotiation. */
  | "live_negotiation"
  /** An ACCEPTED game with a change outstanding. 0079's rule is that accepted
   *  interleague games are never silently deleted; the old predicate deleted
   *  these because their status is not 'scheduled'. */
  | "accepted_reschedule_pending";

function fmtDate(iso: string): string {
  // Wall-clock substrings only — never parse the instant (house convention).
  const [y, m, d] = iso.substring(0, 10).split("-").map(Number);
  const hh = Number(iso.substring(11, 13));
  const mm = iso.substring(14, 16);
  if (!y || !m || !d) return iso.substring(0, 16);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} ${mon} ${d}, ${h12}:${mm} ${ampm}`;
}

/**
 * The sentence every surface renders VERBATIM. Never hand-write one at a call
 * site — same rule as shortfallSummary and the schedule-lock wording helpers.
 * Returns null when nothing was preserved, so a caller can skip the row.
 *
 * It says WHAT was kept and WHY, because the admin is about to wonder why the
 * regenerated schedule still contains a game they did not expect.
 */
export function preservedSummary(preserved: PreservedGame[]): string | null {
  if (!preserved.length) return null;

  const live = preserved.filter((p) => p.reason === "live_negotiation");
  const accepted = preserved.filter((p) => p.reason === "accepted_reschedule_pending");
  const label = (p: PreservedGame) => `${fmtDate(p.scheduledAt)} vs ${p.opponentLabel}`;

  const parts: string[] = [];
  if (live.length) {
    parts.push(
      `${live.length === 1 ? "1 game is" : `${live.length} games are`} mid-negotiation with the other league (${live
        .map(label)
        .join("; ")})`,
    );
  }
  if (accepted.length) {
    parts.push(
      `${accepted.length === 1 ? "1 accepted game has" : `${accepted.length} accepted games have`} a time change outstanding (${accepted
        .map(label)
        .join("; ")})`,
    );
  }

  const n = preserved.length;
  return (
    `Kept ${n === 1 ? "1 interleague game" : `${n} interleague games`} out of this regenerate: ` +
    `${parts.join(", and ")}. Deleting ${n === 1 ? "it" : "them"} would break the other league's link ` +
    `without telling them. Resolve or decline ${n === 1 ? "it" : "them"} on the Interleague page first.`
  );
}
