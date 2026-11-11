// Officials' game-change emails (0130), as pure rules: read what the take
// attached to a game_changes / assignment_conflicts row, decide what each
// entry says, and build every sentence. The templates render these verbatim.
//
// RULES
//   * The take (official_change_entries) already dropped every entry with
//     nothing to say — a game that started, moved back, or isn't theirs any
//     more. This module only words what is left, from (was, now):
//       on → off            Rained out
//       off → on, same start Back on
//       off → on, new start  Makeup set
//       on → on              Moved (a new time, a new field, or both)
//       off → off            Rained out (it moved while rained out; still off)
//       removed              Taken off (the snapshot; the game is gone)
//   * Times are the stored wall clock ("YYYY-MM-DDTHH:MI"), formatted with
//     fmtGameDate / fmtGameTime — never re-read in a timezone (the officials
//     wall-clock rule).
//   * A youth official's email goes to a parent or guardian (umpires.email),
//     so it is worded to the parent and names the official.
//   * No link in the official's email: minting a sign-up link revokes the
//     current one (one per official), which would kill the link in last
//     week's help email.
//   * An entry the module can't read makes the whole row unreadable → the
//     template returns null and the drain fails the row (unknown_kind). Never
//     a half-written email.
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";

export type NoticeGame = {
  start: string; // "YYYY-MM-DDTHH:MI", league wall clock
  division: string | null;
  home: string | null;
  away: string | null;
  field: string | null;
  role: string;
};

export type MoveProblem = "time_conflict" | "blackout" | "outside_availability" | "over_weekly_limit";
const PROBLEMS: readonly MoveProblem[] = ["time_conflict", "blackout", "outside_availability", "over_weekly_limit"];

export type ChangeEntry =
  | {
      change: "changed";
      game: NoticeGame;
      cancelled: boolean;
      was: { start: string; field: string | null; cancelled: boolean };
      problem: MoveProblem | null;
    }
  | { change: "removed"; game: NoticeGame };

export type ConflictEntry = {
  officialName: string;
  game: NoticeGame;
  problem: MoveProblem;
  other: NoticeGame | null;
};

export type ChangeKind = "moved" | "rained_out" | "makeup_set" | "back_on" | "taken_off";

const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function noticeGame(v: unknown): NoticeGame | null {
  const o = obj(v);
  if (!o) return null;
  const start = str(o.start);
  const role = str(o.role);
  if (!start || !WALL.test(start) || !role) return null;
  return { start, role, division: str(o.division), home: str(o.home), away: str(o.away), field: str(o.field) };
}

function problemOf(v: unknown): MoveProblem | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === "string" && (PROBLEMS as readonly string[]).includes(v) ? (v as MoveProblem) : undefined;
}

/** The take's `changes` list, or null when any entry can't be read. */
export function parseChangeEntries(raw: unknown): ChangeEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChangeEntry[] = [];
  for (const r of raw) {
    const o = obj(r);
    const game = noticeGame(o);
    if (!o || !game) return null;
    if (o.change === "removed") {
      out.push({ change: "removed", game });
      continue;
    }
    if (o.change !== "changed") return null;
    const was = obj(o.was);
    const wasStart = str(was?.start);
    const problem = problemOf(o.problem);
    if (!was || !wasStart || !WALL.test(wasStart) || typeof was.cancelled !== "boolean"
        || typeof o.cancelled !== "boolean" || problem === undefined) {
      return null;
    }
    out.push({
      change: "changed",
      game,
      cancelled: o.cancelled,
      was: { start: wasStart, field: str(was.field), cancelled: was.cancelled },
      problem,
    });
  }
  return out;
}

/** The take's `conflicts` list, or null when any entry can't be read. */
export function parseConflictEntries(raw: unknown): ConflictEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ConflictEntry[] = [];
  for (const r of raw) {
    const o = obj(r);
    const game = noticeGame(o);
    const name = str(o?.official_name);
    const problem = problemOf(o?.problem);
    if (!o || !game || !name || !problem) return null;
    const other = o.other === null || o.other === undefined ? null : noticeGame(o.other);
    if (o.other !== null && o.other !== undefined && !other) return null;
    out.push({ officialName: name, game, problem, other });
  }
  return out;
}

/** What one entry is, from (was, now). */
export function changeKind(e: ChangeEntry): ChangeKind {
  if (e.change === "removed") return "taken_off";
  if (e.cancelled) return "rained_out";
  if (e.was.cancelled) return e.game.start.slice(0, 16) === e.was.start.slice(0, 16) ? "back_on" : "makeup_set";
  return "moved";
}

const LABEL: Record<ChangeKind, string> = {
  moved: "Moved",
  rained_out: "Rained out",
  makeup_set: "Makeup set",
  back_on: "Back on",
  taken_off: "Taken off",
};
const SUBJECT_LABEL: Record<ChangeKind, string> = {
  moved: "Game moved",
  rained_out: "Rained out",
  makeup_set: "Makeup set",
  back_on: "Back on",
  taken_off: "Taken off a game",
};

export function changeLabel(kind: ChangeKind): string {
  return LABEL[kind];
}

/** "Sat, Oct 17 · 1:00 PM" */
export function when(start: string): string {
  return `${fmtGameDate(start)} · ${fmtGameTime(start)}`;
}

/** "Expos vs Mets", or the one team there is. */
function matchup(g: NoticeGame): string | null {
  return g.home && g.away ? `${g.home} vs ${g.away}` : g.home ?? g.away;
}

/** "Moved — Majors · Expos vs Mets · Your role: Plate" (the role as the
 *  league typed it, labelled — decided 2026-11-11). */
export function entryHeading(e: ChangeEntry): string {
  const what = [e.game.division, matchup(e.game), `Your role: ${e.game.role}`].filter(Boolean).join(" · ");
  return `${changeLabel(changeKind(e))} — ${what}`;
}

/** "Sat, Oct 17 · 1:00 PM · Monroe Complex — Andrews" */
function whenWhere(start: string, field: string | null): string {
  return field ? `${when(start)} · ${field}` : when(start);
}

export type Voice = { youth: boolean; name: string; league: string };

/** The sentence about a problem the new time made. */
export function problemLine(problem: MoveProblem, v: Voice): string {
  const told = `${v.league} has been told.`;
  if (v.youth) {
    switch (problem) {
      case "time_conflict":
        return `It now overlaps another game ${v.name} is assigned to. ${told}`;
      case "blackout":
        return `It's now on a date ${v.name} can't work. ${told}`;
      case "outside_availability":
        return `It's now outside the hours ${v.name} can work. ${told}`;
      case "over_weekly_limit":
        return `It now puts ${v.name} over the games a week ${v.name} can work. ${told}`;
    }
  }
  switch (problem) {
    case "time_conflict":
      return `It now overlaps another game you're assigned to. ${told}`;
    case "blackout":
      return `It's now on a date you said you can't work. ${told}`;
    case "outside_availability":
      return `It's now outside the hours you said you can work. ${told}`;
    case "over_weekly_limit":
      return `It now puts you over the games a week you said you can work. ${told}`;
  }
}

/** One entry's lines, heading first. */
export function entryLines(e: ChangeEntry, v: Voice): string[] {
  const kind = changeKind(e);
  const lines = [entryHeading(e)];
  if (e.change === "removed") {
    lines.push(whenWhere(e.game.start, e.game.field));
    lines.push(
      v.youth
        ? `The schedule changed and ${v.name} is no longer assigned to this game. ${v.league} will let you know if ${v.name} is needed.`
        : `The schedule changed and you're no longer assigned to this game. ${v.league} will let you know if you're needed.`,
    );
    return lines;
  }
  switch (kind) {
    case "moved":
      lines.push(`Now: ${whenWhere(e.game.start, e.game.field)}`);
      lines.push(`Was: ${whenWhere(e.was.start, e.was.field)}`);
      break;
    case "rained_out":
      lines.push(whenWhere(e.game.start, e.game.field));
      lines.push(
        v.youth
          ? `${v.name} is still assigned. If a makeup date is set, we'll email you.`
          : "You're still assigned. If a makeup date is set, we'll email you.",
      );
      break;
    case "makeup_set":
      lines.push(`Now: ${whenWhere(e.game.start, e.game.field)}`);
      lines.push(`Was: rained out ${when(e.was.start)}`);
      break;
    case "back_on":
      lines.push(whenWhere(e.game.start, e.game.field));
      lines.push("The rainout was lifted; the game is at its original time.");
      break;
  }
  if (e.problem) lines.push(problemLine(e.problem, v));
  return lines;
}

/** The subject line. */
export function changesSubject(entries: readonly ChangeEntry[], v: Voice): string {
  if (entries.length === 1) {
    const e = entries[0];
    const what = [e.game.division, matchup(e.game)].filter(Boolean).join(", ");
    return `${SUBJECT_LABEL[changeKind(e)]}: ${fmtGameDate(e.game.start)}${what ? ` — ${what}` : ""}`;
  }
  return v.youth ? `${entries.length} of ${v.name}'s games changed` : `${entries.length} of your games changed`;
}

/** Greeting and opening line. */
export function changesOpening(entries: readonly ChangeEntry[], v: Voice): string[] {
  const one = entries.length === 1;
  if (v.youth) {
    return [
      `Hi, this is about ${v.name}'s game assignments.`,
      one ? `A game ${v.name} is assigned to has changed.` : `Some games ${v.name} is assigned to have changed.`,
    ];
  }
  return [`Hi ${v.name},`, one ? "A game you're assigned to has changed." : "Some games you're assigned to have changed."];
}

/** The closing line, or null when every entry is a game they were taken off,
 *  or every game still theirs is rained out (each rainout block already says
 *  they're still assigned — decided 2026-11-11). */
export function changesClosing(entries: readonly ChangeEntry[], v: Voice): string | null {
  const still = entries.filter((e) => e.change === "changed");
  if (still.length === 0) return null;
  if (still.every((e) => changeKind(e) === "rained_out")) return null;
  const one = still.length === 1;
  if (v.youth) {
    return one
      ? `${v.name} is still assigned to this game. If ${v.name} can't make it, reply to this email to let ${v.league} know.`
      : `${v.name} is still assigned to these games. If ${v.name} can't make a new time, reply to this email to let ${v.league} know.`;
  }
  return one
    ? `You're still assigned to this game. If you can't make it, reply to this email to let ${v.league} know.`
    : `You're still assigned to these games. If you can't make a new time, reply to this email to let ${v.league} know.`;
}

// ── The coordinator's email (assignment_conflicts) ──────────────────────────

const CONFLICT_WHY: Record<MoveProblem, string> = {
  time_conflict: "overlaps another game they're assigned to",
  blackout: "is on a date they said they can't work",
  outside_availability: "is outside the hours they said they can work",
  over_weekly_limit: "puts them over the games a week they said they can work",
};

export function conflictsSubject(n: number): string {
  return n === 1 ? "1 official assignment needs a look" : `${n} official assignments need a look`;
}

export const CONFLICTS_OPENING =
  "A schedule change put these officials on games they may not be able to work. Nobody was taken off a game — check each one and reassign if needed.";

/** "Sam R. — Majors · Expos vs Mets · Plate · Sat, Oct 17 · 1:00 PM: overlaps Minors · Royals vs Cubs · Sat, Oct 17 · 1:30 PM" */
export function conflictLine(c: ConflictEntry): string {
  const game = [c.game.division, matchup(c.game), c.game.role, when(c.game.start)].filter(Boolean).join(" · ");
  const other =
    c.problem === "time_conflict" && c.other
      ? ` (${[c.other.division, matchup(c.other), when(c.other.start)].filter(Boolean).join(" · ")})`
      : "";
  return `${c.officialName} — ${game}: ${CONFLICT_WHY[c.problem]}${other}`;
}

export const CONFLICTS_LINK_LABEL = "Open Officials";
