// The regenerate PLAN — what a regenerate would write, computed before
// anything is written. The page shows it as the preview; Confirm sends
// `plan.desired` to `regenerate_snack_shack_shifts`; Cancel sends nothing.
//
// RULES (2026-10-05 additions, see CLAUDE.md "Snack shack — derived shifts"):
//   - PAST DATES ARE FROZEN. "Today" is today in the ORG's timezone
//     (`todayInTimezone`, profiles.timezone), never the browser's or the
//     server's date. Every stored derived row dated BEFORE today is passed
//     through to the RPC exactly as stored (same date/start/end), so the RPC
//     keeps it — assignment and all — and a derived shift for a past date is
//     never added. The RPC itself has no notion of "today"; the freeze is the
//     caller's, and the harness pins it (part F).
//   - The STALENESS notice looks at upcoming dates only; a past day that no
//     longer matches the schedule is not something a regenerate would change.
//   - The equity pick for NEW shifts is seeded with every derived row that
//     survives (frozen past + kept upcoming), so teams that already hold
//     shifts this season are not picked again first.
//   - "Changed" in the preview means a removed row and an added slot on the
//     same date with the SAME START (the window end moved); anything else is
//     a plain removal or addition. Every assignment that would change is
//     listed: team → team, team → unassigned, or → a team on a new shift.
//   - 0104: a note or cash person on a CHANGED row is carried by the RPC onto
//     the replacement (`carried`); one on a REMOVED row is gone after Confirm
//     (`lost`). Both are listed so nothing disappears silently.
//   - 2026-10-06: a NEW shift the picker left unassigned (every team plays
//     during it) or filled outside the preference rides `flagged`, so the
//     preview can say so before Confirm. A null assigned_team_id in `desired`
//     is a real outcome now, not only a hand-cleared row.

import {
  ABSORB_OFFER_UNDER_MIN,
  assignNewShifts,
  flattenShifts,
  normalizeTime,
  reconcileWithStored,
  stalenessDiff,
  type AssignedSlot,
  type DerivationResult,
  type PickTeam,
  type AssignmentIndex,
  type AssignmentFlag,
  type SchedulingPreference,
  type ShiftSlot,
  type StalenessDiff,
  type StoredShiftRow,
} from "./derive-shifts";

/** Today's date, "YYYY-MM-DD", in an IANA zone. Throws on an unknown zone —
 *  a wrong "today" would freeze or unfreeze the wrong day silently. */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  if (!y || !m || !d) throw new Error(`todayInTimezone: could not format a date in ${timeZone}`);
  return `${y}-${m}-${d}`;
}

/** One element of the RPC payload. */
export type RpcShift = { date: string; start: string; end: string; assigned_team_id: string | null };

export type AssignmentChange =
  | { kind: "removed"; date: string; start: string; end: string; fromTeamId: string }
  | { kind: "changed"; date: string; start: string; fromEnd: string; toEnd: string; fromTeamId: string | null; toTeamId: string | null }
  | { kind: "added"; date: string; start: string; end: string; toTeamId: string | null };

export type DayChange = {
  date: string;
  added: AssignedSlot[];
  removed: StoredShiftRow[];
  changed: { from: StoredShiftRow; to: AssignedSlot }[];
};

/** 0104: a note and/or cash person on a row the regenerate removes. */
export type CarriedItem = {
  date: string;
  start: string;
  fromEnd: string;
  toEnd: string;
  notes: string | null;
  cashPersonId: string | null;
};
export type LostItem = { date: string; start: string; end: string; notes: string | null; cashPersonId: string | null };

/** A NEW shift the picker could not fill, or filled outside the preference. */
export type FlaggedShift = { date: string; start: string; end: string; teamId: string | null; flag: AssignmentFlag };

export type RegeneratePlan = {
  /** The FULL payload for regenerate_snack_shack_shifts. */
  desired: RpcShift[];
  /** New shifts the picker flagged (unfilled / preference not met), in
   *  date order — the preview shows them; kept and frozen rows are not
   *  re-judged here (the page does that with storedAssignmentFlag). */
  flagged: FlaggedShift[];
  /** 0104: notes/cash the RPC will copy onto the same-start replacement. */
  carried: CarriedItem[];
  /** 0104: notes/cash on removed rows with no same-start replacement — gone
   *  after Confirm; the preview says so. */
  lost: LostItem[];
  /** Stored derived rows before today, passed through unchanged. */
  frozenPast: number;
  /** Upcoming derived rows whose date/start/end is unchanged. */
  kept: number;
  dayChanges: DayChange[];
  assignmentChanges: AssignmentChange[];
  hasChanges: boolean;
};

export type PlanInput = {
  derivation: DerivationResult;
  /** Every block of this snack shack, both kinds; manual rows are ignored. */
  stored: StoredShiftRow[];
  teams: PickTeam[];
  preference: SchedulingPreference;
  index: AssignmentIndex;
  /** "YYYY-MM-DD" in the org's timezone. */
  today: string;
};

export function buildRegeneratePlan(input: PlanInput): RegeneratePlan {
  const { today } = input;
  const storedDerived = input.stored.filter((r) => r.is_recurring);
  const pastRows = storedDerived.filter((r) => r.date < today);
  const upcomingStored = storedDerived.filter((r) => r.date >= today);
  const derivedUpcoming = flattenShifts(input.derivation).filter((s) => s.date >= today);

  const rec = reconcileWithStored(derivedUpcoming, upcomingStored);
  const assigned = assignNewShifts(rec.create, input.teams, [...pastRows, ...rec.keep], input.preference, input.index);

  const asRpc = (r: StoredShiftRow): RpcShift => ({
    date: r.date,
    start: normalizeTime(r.start_time),
    end: normalizeTime(r.end_time),
    assigned_team_id: r.assigned_team_id,
  });
  const desired: RpcShift[] = [
    ...pastRows.map(asRpc),
    ...rec.keep.map(asRpc),
    ...assigned.map((a) => ({ date: a.date, start: a.start, end: a.end, assigned_team_id: a.assignedTeamId })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  // Per-date diff, with same-start pairs reported as "changed".
  const dates = new Set<string>([...rec.remove.map((r) => r.date), ...assigned.map((a) => a.date)]);
  const dayChanges: DayChange[] = [];
  const assignmentChanges: AssignmentChange[] = [];
  for (const date of [...dates].sort()) {
    const removed = rec.remove.filter((r) => r.date === date);
    const added = assigned.filter((a) => a.date === date);
    const changed: DayChange["changed"] = [];
    const usedAdded = new Set<number>();
    const plainRemoved: StoredShiftRow[] = [];
    for (const r of removed) {
      const idx = added.findIndex((a, i) => !usedAdded.has(i) && a.start === normalizeTime(r.start_time));
      if (idx >= 0) {
        usedAdded.add(idx);
        changed.push({ from: r, to: added[idx] });
      } else {
        plainRemoved.push(r);
      }
    }
    const plainAdded = added.filter((_, i) => !usedAdded.has(i));
    dayChanges.push({ date, added: plainAdded, removed: plainRemoved, changed });

    for (const c of changed) {
      assignmentChanges.push({
        kind: "changed",
        date,
        start: c.to.start,
        fromEnd: normalizeTime(c.from.end_time),
        toEnd: c.to.end,
        fromTeamId: c.from.assigned_team_id,
        toTeamId: c.to.assignedTeamId,
      });
    }
    for (const r of plainRemoved) {
      if (r.assigned_team_id) {
        assignmentChanges.push({ kind: "removed", date, start: normalizeTime(r.start_time), end: normalizeTime(r.end_time), fromTeamId: r.assigned_team_id });
      }
    }
    for (const a of plainAdded) {
      assignmentChanges.push({ kind: "added", date, start: a.start, end: a.end, toTeamId: a.assignedTeamId });
    }
  }

  // 0104: what the RPC carries (same date + start) and what it cannot.
  const hasInternal = (r: StoredShiftRow) => !!(r.notes && r.notes.trim()) || !!r.cash_person_id;
  const carried: CarriedItem[] = [];
  const lost: LostItem[] = [];
  for (const d of dayChanges) {
    for (const c of d.changed) {
      if (hasInternal(c.from)) {
        carried.push({ date: d.date, start: c.to.start, fromEnd: normalizeTime(c.from.end_time), toEnd: c.to.end, notes: c.from.notes ?? null, cashPersonId: c.from.cash_person_id ?? null });
      }
    }
    for (const r of d.removed) {
      if (hasInternal(r)) {
        lost.push({ date: d.date, start: normalizeTime(r.start_time), end: normalizeTime(r.end_time), notes: r.notes ?? null, cashPersonId: r.cash_person_id ?? null });
      }
    }
  }

  const flagged: FlaggedShift[] = assigned
    .filter((a) => a.flag !== null)
    .map((a) => ({ date: a.date, start: a.start, end: a.end, teamId: a.assignedTeamId, flag: a.flag as AssignmentFlag }));

  return {
    desired,
    flagged,
    carried,
    lost,
    frozenPast: pastRows.length,
    kept: rec.keep.length,
    dayChanges,
    assignmentChanges,
    hasChanges: dayChanges.length > 0,
  };
}

/** Staleness over UPCOMING dates only (today in the org's zone and later). */
export function upcomingStaleness(derivation: DerivationResult, stored: StoredShiftRow[], today: string): StalenessDiff {
  return stalenessDiff(
    flattenShifts(derivation).filter((s) => s.date >= today),
    stored.filter((r) => r.date >= today),
  );
}

/** The notice for a season whose shifts predate automatic shifts
 *  (shifts_generated_at is null and derived rows exist). Verbatim. */
export const LEGACY_SHIFTS_NOTICE =
  "These shifts were set up before automatic shifts. Regenerating will rebuild upcoming shifts from the game schedule.";

export function legacyShiftsNotice(shiftsGeneratedAt: string | null, stored: StoredShiftRow[]): string | null {
  if (shiftsGeneratedAt !== null) return null;
  return stored.some((r) => r.is_recurring) ? LEGACY_SHIFTS_NOTICE : null;
}

/** The max-shift help text, verbatim on the settings step. */
export function maxShiftHelpText(maxShiftMin: number): string {
  const h = Math.floor(maxShiftMin / 60);
  const m = maxShiftMin % 60;
  const len = h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
  return `No one is asked to work more than ${len} at a stretch. When a day doesn't divide evenly and the leftover is under ${ABSORB_OFFER_UNDER_MIN} minutes, it is added to one of the shifts instead of becoming a tiny shift of its own — so a shift can run up to ${ABSORB_OFFER_UNDER_MIN - 1} minutes longer than this. That is the rule working, not a mistake.`;
}

/** Plain-English lines for the preview, one per assignment change. */
export function assignmentChangeLines(changes: AssignmentChange[], teamName: (id: string | null) => string): string[] {
  const t = (id: string | null) => (id ? teamName(id) : "unassigned");
  return changes.map((c) => {
    if (c.kind === "removed") return `${c.date} ${c.start}–${c.end}: ${t(c.fromTeamId)} → removed`;
    if (c.kind === "changed") {
      const who = c.fromTeamId === c.toTeamId ? t(c.fromTeamId) : `${t(c.fromTeamId)} → ${t(c.toTeamId)}`;
      return `${c.date} ${c.start}: ends ${c.fromEnd} → ${c.toEnd}, ${who}`;
    }
    return `${c.date} ${c.start}–${c.end}: new → ${t(c.toTeamId)}`;
  });
}

export type { ShiftSlot };
