// Practice field calculator — distribute, pack, count.
//
// A PORT OF THE APPROVED MOCKUP'S SCRIPT (docs/mockups/practice-field-
// calculator.html: distribute / pack / compute), rule for rule. The known
// answers in `npm run sim:practice-planner` (the example league: 60-ft 6/14,
// 50/70 2/4, 90-ft 2/3) hold only while this matches it. A rule that looks
// wrong gets flagged to the founder, not changed here.
//
// 1. DISTRIBUTE each division's weekly practices (teams × min(perWeek, allowed
//    days)) across its allowed days; a team practices at most once a day, so
//    a day never holds more than `teams` of one division's practices.
//    - spread: divisions with the FEWEST allowed days go first. Each practice
//      goes to the allowed day with the lowest field-minutes so far for that
//      field type (field-minutes = length ÷ teams per field); on a tie, the
//      day where this division already has fewer practices; then calendar
//      order, Monday first.
//    - sameNights: every team takes the division's first N allowed days in
//      SAME_NIGHTS_PREFERENCE order (Tue, Thu, Mon, Wed, Fri, Sat, Sun).
// 2. PACK each day × field type: teams sharing a field form one block; blocks
//    sort by window length ascending, then window start, then practice length
//    descending. Each block takes the existing field where it can start
//    earliest (5-minute steps from the window start, `minutesBetween` clear on
//    both sides); none fits → a new field. A practice longer than its window
//    is skipped (and warned about), never placed.
// 3. FIELDS TO REQUEST per field type = the MOST fields on any one night —
//    never the sum over nights.

import { ALL_DAYS, FIELD_TYPE_IDS, PACK_STEP_MIN, SAME_NIGHTS_PREFERENCE } from "./constants";
import { toMinutes } from "./format";
import type {
  DayIndex,
  DivisionInput,
  FieldNeed,
  FieldTypeId,
  ModeResult,
  NightResult,
  PlacedBlock,
  PlannerInput,
  SpreadMode,
} from "./types";

const EPS = 1e-9;

/** Allowed days as unique day indexes, Monday first. */
export function normalizeDays(days: number[]): DayIndex[] {
  return ALL_DAYS.filter((k) => days.includes(k));
}

/** Practices a division actually gets each week (per team): capped at allowed days. */
export function countedPerWeek(d: DivisionInput): number {
  return Math.min(d.perWeek, normalizeDays(d.days).length);
}

/** A division counts toward the answer when it has teams and practice days. */
export function divisionIsActive(d: DivisionInput): boolean {
  return d.teams > 0 && normalizeDays(d.days).length > 0;
}

/** Field types some active division uses, in FIELD_TYPES order. */
export function fieldTypesInUse(input: PlannerInput): FieldTypeId[] {
  return FIELD_TYPE_IDS.filter((z) => input.divisions.some((d) => d.fieldType === z && divisionIsActive(d)));
}

/** One division's practices on one day. */
export type DayDemand = { division: number; practices: number };

/** demand[fieldType][day] */
export type Demand = Record<FieldTypeId, DayDemand[][]>;

function emptyByType<T>(make: () => T): Record<FieldTypeId, T> {
  return Object.fromEntries(FIELD_TYPE_IDS.map((z) => [z, make()])) as Record<FieldTypeId, T>;
}

export function distribute(input: PlannerInput, mode: SpreadMode): Demand {
  const demand = emptyByType(() => ALL_DAYS.map((): DayDemand[] => []));
  const load = emptyByType(() => ALL_DAYS.map(() => 0));
  const divs = input.divisions;
  const order = divs
    .map((_, i) => i)
    .sort((a, b) => normalizeDays(divs[a].days).length - normalizeDays(divs[b].days).length);

  for (const i of order) {
    const d = divs[i];
    const days = normalizeDays(d.days);
    if (!days.length || d.teams < 1 || d.perWeek < 1) continue;
    const per = ALL_DAYS.map(() => 0);

    if (mode === "sameNights") {
      const pick = [...days]
        .sort((a, b) => SAME_NIGHTS_PREFERENCE.indexOf(a) - SAME_NIGHTS_PREFERENCE.indexOf(b))
        .slice(0, Math.min(d.perWeek, days.length));
      for (const k of pick) per[k] = d.teams;
    } else {
      const fieldLoad = load[d.fieldType];
      const units = d.teams * Math.min(d.perWeek, days.length);
      for (let u = 0; u < units; u++) {
        let best: DayIndex | null = null;
        for (const k of days) {
          // Once a day per team.
          if (per[k] >= d.teams) continue;
          if (
            best === null ||
            fieldLoad[k] < fieldLoad[best] - EPS ||
            (Math.abs(fieldLoad[k] - fieldLoad[best]) < EPS && per[k] < per[best])
          ) {
            best = k;
          }
        }
        if (best === null) break;
        per[best]++;
        fieldLoad[best] += d.lengthMin / d.teamsPerField;
      }
    }
    per.forEach((n, k) => {
      if (n > 0) demand[d.fieldType][k].push({ division: i, practices: n });
    });
  }
  return demand;
}

type Block = { division: number; start: number; end: number; lengthMin: number; teams: number };

/** Packs one night of one field type. */
export function pack(input: PlannerInput, items: DayDemand[]): NightResult {
  const between = Number(input.minutesBetween) || 0;
  const fields: PlacedBlock[][] = [];
  const blocks: Block[] = [];
  for (const it of items) {
    const d = input.divisions[it.division];
    const groups = Math.ceil(it.practices / d.teamsPerField);
    for (let g = 0; g < groups; g++) {
      const teams = Math.min(d.teamsPerField, it.practices - g * d.teamsPerField);
      blocks.push({
        division: it.division,
        start: toMinutes(d.start),
        end: toMinutes(d.end),
        lengthMin: d.lengthMin,
        teams,
      });
    }
  }
  blocks.sort((a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start || b.lengthMin - a.lengthMin);

  let skipped = 0;
  for (const b of blocks) {
    if (b.lengthMin > b.end - b.start) {
      skipped++;
      continue;
    }
    let bestField = -1;
    let bestStart = Infinity;
    fields.forEach((f, fi) => {
      for (let t = b.start; t + b.lengthMin <= b.end; t += PACK_STEP_MIN) {
        if (f.every((x) => t >= x.start + x.lengthMin + between || t + b.lengthMin + between <= x.start)) {
          if (t < bestStart) {
            bestStart = t;
            bestField = fi;
          }
          break;
        }
      }
    });
    if (bestField < 0) {
      fields.push([]);
      bestField = fields.length - 1;
      bestStart = b.start;
    }
    fields[bestField].push({ division: b.division, start: bestStart, lengthMin: b.lengthMin, teams: b.teams });
  }

  let first: number | null = null;
  let last: number | null = null;
  for (const f of fields) {
    for (const x of f) {
      first = first === null ? x.start : Math.min(first, x.start);
      last = last === null ? x.start + x.lengthMin : Math.max(last, x.start + x.lengthMin);
    }
  }
  return { count: fields.length, fields, first, last, skipped };
}

/** Busiest night: the most fields on any one day (first such day wins). */
export function fieldNeed(nights: NightResult[]): FieldNeed {
  let fields = 0;
  let peakDay: DayIndex | null = null;
  nights.forEach((r, k) => {
    if (r.count > fields) {
      fields = r.count;
      peakDay = k as DayIndex;
    }
  });
  return { fields, peakDay };
}

export function computeMode(input: PlannerInput, mode: SpreadMode): ModeResult {
  const demand = distribute(input, mode);
  const byType = emptyByType((): NightResult[] => []);
  const need = emptyByType((): FieldNeed => ({ fields: 0, peakDay: null }));
  for (const z of FIELD_TYPE_IDS) {
    byType[z] = ALL_DAYS.map((k) => pack(input, demand[z][k]));
    need[z] = fieldNeed(byType[z]);
  }
  return { byType, need };
}
