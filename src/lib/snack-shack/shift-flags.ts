// How a stored snack shack shift is FLAGGED on the page, and how the preview
// words a flagged new shift — the pure decisions (mockup v2, approved
// 2026-10-06). The components render these verbatim; nothing here reads
// the database.
//
// RED means "fix this", and only two things are red: the assigned team plays
// during the shift (within GAME_BUFFER_BEFORE_MIN of a game), or no team is
// assigned ("Needs a team"). Off-preference is plain gray text, never a
// chip. PAST SHIFTS ARE NEVER FLAGGED (date before today in the org's
// zone). Manual rows get the red checks only — they were never placed by
// the preference, so it is not judged on them. The top banner counts red
// items only.

import {
  gameBlocksShift,
  hhmmToMin,
  minToHHMM,
  normalizeTime,
  storedAssignmentFlag,
  teamBlockedForShift,
  teamGamesOn,
  type AssignmentFlag,
  type AssignmentIndex,
  type PickTeam,
  type SchedulingPreference,
  type ShiftSlot,
} from "./derive-shifts";

/** "9:30–11:30am" when both ends share a suffix, "11:30am–1:30pm" when not. */
export function fmtShiftRange(start: string, end: string): string {
  const part = (t: string) => {
    const [h, m] = normalizeTime(t).split(":").map(Number);
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return { text: `${h12}:${String(m).padStart(2, "0")}`, suffix: h < 12 ? "am" : "pm" };
  };
  const a = part(start);
  const b = part(end);
  return a.suffix === b.suffix ? `${a.text}–${b.text}${b.suffix}` : `${a.text}${a.suffix}–${b.text}${b.suffix}`;
}

export function fmtClock(hhmm: string): string {
  const [h, m] = normalizeTime(hhmm).split(":").map(Number);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

export type BlockFlagView = {
  /** The row is red: fix this. */
  red: boolean;
  /** Render "Needs a team" (red) in place of the team name. */
  needsTeam: boolean;
  /** A red chip's text, or null. */
  chip: string | null;
  /** Gray text for an off-preference pick, or null. */
  soft: string | null;
};

export type FlaggableBlock = {
  date: string;
  start_time: string;
  end_time: string;
  assigned_team_id: string | null;
  is_recurring: boolean;
};

export const NEEDS_TEAM = "Needs a team";
export const NO_TEAM_FREE_CHIP = "No team is free during this shift";
export const SOFT_NOT_AT_PARK = "Not at the park that day";
export const SOFT_PLAYS_THAT_DAY = "Plays that day";

export function playsDuringChip(index: AssignmentIndex, teamId: string, slot: ShiftSlot): string {
  const s = hhmmToMin(normalizeTime(slot.start));
  const e = hhmmToMin(normalizeTime(slot.end));
  const blocking = teamGamesOn(index, teamId, slot.date)
    .filter((g) => gameBlocksShift(g, s, e))
    .sort((a, b) => a.startMin - b.startMin);
  const first = blocking[0];
  return first ? `Plays ${fmtClock(minToHHMM(first.startMin))}, during this shift` : "Plays during this shift";
}

export function blockFlagView(p: {
  index: AssignmentIndex;
  preference: SchedulingPreference;
  teams: PickTeam[];
  /** "YYYY-MM-DD" in the org's timezone. */
  today: string;
  block: FlaggableBlock;
}): BlockFlagView | null {
  const { block } = p;
  if (block.date < p.today) return null;
  const slot: ShiftSlot = { date: block.date, start: normalizeTime(block.start_time), end: normalizeTime(block.end_time) };
  if (!block.is_recurring) {
    if (!block.assigned_team_id) return { red: true, needsTeam: true, chip: null, soft: null };
    if (teamBlockedForShift(p.index, block.assigned_team_id, slot)) {
      return { red: true, needsTeam: false, chip: playsDuringChip(p.index, block.assigned_team_id, slot), soft: null };
    }
    return null;
  }
  const flag: AssignmentFlag | null = storedAssignmentFlag(p.index, p.preference, block.assigned_team_id, slot);
  if (flag === null) return null;
  if (flag === "conflict") {
    return { red: true, needsTeam: false, chip: playsDuringChip(p.index, block.assigned_team_id as string, slot), soft: null };
  }
  if (flag === "unfilled") {
    const nobodyFree = p.teams.length > 0 && p.teams.every((t) => teamBlockedForShift(p.index, t.id, slot));
    return { red: true, needsTeam: true, chip: nobodyFree ? NO_TEAM_FREE_CHIP : null, soft: null };
  }
  return { red: false, needsTeam: false, chip: null, soft: p.preference === "prefer_game_days" ? SOFT_NOT_AT_PARK : SOFT_PLAYS_THAT_DAY };
}

export type RedSummary = { playsDuring: number; needsTeam: number; total: number };

export function redSummary(views: (BlockFlagView | null)[]): RedSummary {
  let playsDuring = 0;
  let needsTeam = 0;
  for (const v of views) {
    if (!v || !v.red) continue;
    if (v.needsTeam) needsTeam++;
    else playsDuring++;
  }
  return { playsDuring, needsTeam, total: playsDuring + needsTeam };
}

/** The banner, verbatim; null when nothing is red. */
export function redBannerLine(s: RedSummary): string | null {
  if (s.total === 0) return null;
  const parts: string[] = [];
  if (s.playsDuring > 0) parts.push(`${s.playsDuring} team${s.playsDuring === 1 ? " plays" : "s play"} during ${s.playsDuring === 1 ? "its" : "their"} shift`);
  if (s.needsTeam > 0) parts.push(`${s.needsTeam} shift${s.needsTeam === 1 ? " needs" : "s need"} a team`);
  return `${s.total} upcoming shift${s.total === 1 ? "" : "s"} need${s.total === 1 ? "s" : ""} fixing: ${parts.join(", ")}.`;
}

/** The preview's line for a flagged NEW shift (the plan's `flagged`). */
export function previewFlagLine(flag: AssignmentFlag, preference: SchedulingPreference): { red: boolean; text: string } {
  if (flag === "unfilled") return { red: true, text: "no team is free during this shift (within 30 minutes of a game)" };
  if (flag === "conflict") return { red: true, text: "plays during this shift" };
  return { red: false, text: preference === "prefer_game_days" ? "not at the park that day" : "plays that day" };
}
