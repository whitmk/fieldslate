// Mutation pass for snack-shifts-sim.ts — see mutant-runner.ts for the rules
// (applied to the REAL source, restored byte-for-byte, killed only if the
// FIRST failing assertion is the one written for it). Runs under UTC only;
// the three-zone run is the sim's own job.
//
// RESULT (2026-10-05): 20/20 killed, each FIRST at its own assertion. The
// first run had five at the wrong assertion — all harness ordering faults;
// see the MUTATION LOG in snack-shifts-sim.ts for what moved and why.
import { runMutants, type Mutant } from "./mutant-runner";

const LIB = "src/lib/snack-shack/derive-shifts.ts";

const MUTANTS: Mutant[] = [
  {
    id: "SM1", what: "status filter dropped — a rained-out game opens the shack", file: LIB,
    find: "    if (!countsAsScheduledGame(g.status)) continue;\n",
    replace: "",
    expect: "C1",
  },
  {
    id: "SM2", what: "venue filter dropped — games at other parks count", file: LIB,
    find: "    if (!g.venue_id || !home.has(g.venue_id)) continue;\n",
    replace: "    if (!g.venue_id) continue;\n",
    expect: "C2",
  },
  {
    id: "SM3", what: "assumed duration not reported", file: LIB,
    find: "    if (g.durationDefaulted) assumed.push(g.id);\n",
    replace: "",
    expect: "U1",
  },
  {
    id: "SM4", what: "open offset ignored", file: LIB,
    find: "    const rawStart = c.start - rule.openBeforeMin;",
    replace: "    const rawStart = c.start;",
    expect: "W1",
  },
  {
    id: "SM5", what: "window closes after the last START, not the last end", file: LIB,
    find: "      cur.maxEnd = Math.max(cur.maxEnd, s.endMin);",
    replace: "      cur.maxEnd = Math.max(cur.maxEnd, s.startMin);",
    expect: "W2",
  },
  {
    id: "SM6", what: "gap threshold exclusive — a 60-minute break no longer splits", file: LIB,
    find: "      if (gap >= GAP_SPLIT_MIN && closeAt < openAt) {",
    replace: "      if (gap > GAP_SPLIT_MIN && closeAt < openAt) {",
    expect: "G1",
  },
  {
    id: "SM7", what: "gap threshold one lower — a 59-minute break splits", file: LIB,
    find: "      if (gap >= GAP_SPLIT_MIN && closeAt < openAt) {",
    replace: "      if (gap >= GAP_SPLIT_MIN - 1 && closeAt < openAt) {",
    expect: "G2",
  },
  {
    id: "SM8", what: "overlap merge removed — touching windows split anyway", file: LIB,
    find: "      if (gap >= GAP_SPLIT_MIN && closeAt < openAt) {",
    replace: "      if (gap >= GAP_SPLIT_MIN && closeAt <= openAt) {",
    expect: "G3",
  },
  {
    id: "SM9", what: "days filter removed — a closed weekday produces shifts", file: LIB,
    find: "    if (!daysOpen.has(day)) {",
    replace: "    if (!daysOpen.has(day) && daysOpen.size === 0) {",
    expect: "D1",
  },
  {
    id: "SM10", what: "floor instead of ceil — one shift too few", file: LIB,
    find: "  const n = Math.max(1, Math.ceil(totalMin / maxShiftMin));",
    replace: "  const n = Math.max(1, Math.floor(totalMin / maxShiftMin));",
    expect: "S1",
  },
  {
    id: "SM11", what: "default absorb is 'first'", file: LIB,
    find: 'export const DEFAULT_ABSORB: AbsorbChoice = "last";',
    replace: 'export const DEFAULT_ABSORB: AbsorbChoice = "first";',
    expect: "L1",
  },
  {
    id: "SM12", what: "split gives the odd minutes to the LATER shifts", file: LIB,
    find: "    for (let i = 0; i < k; i++) lengths[i] += base + (i < extra ? 1 : 0);",
    replace: "    for (let i = 0; i < k; i++) lengths[i] += base + (i >= k - extra ? 1 : 0);",
    expect: "L3",
  },
  {
    id: "SM13", what: "offer at exactly 60 (the mockup's <=)", file: LIB,
    find: "  const offered = n >= 2 && leftoverMin < ABSORB_OFFER_UNDER_MIN;",
    replace: "  const offered = n >= 2 && leftoverMin <= ABSORB_OFFER_UNDER_MIN;",
    expect: "L4",
  },
  {
    id: "SM14", what: "stored choice applied by date alone (window start ignored)", file: LIB,
    find: "  return `${date}|${windowStart}`;",
    replace: "  return `${date}|${windowStart.length > 0 ? \"\" : windowStart}`;",
    expect: "L7",
  },
  {
    id: "SM15", what: "a choice whose window is no longer short is not reported stale", file: LIB,
    find: "      if (div.offered && stored) usedChoiceKeys.add(key);",
    replace: "      if (stored) usedChoiceKeys.add(key);",
    expect: "L8",
  },
  {
    id: "SM16", what: "preservation matches on date+start only (end ignored)", file: LIB,
    find: "  return `${date}|${normalizeTime(start)}|${normalizeTime(end)}`;",
    replace: "  return `${date}|${normalizeTime(start)}|${normalizeTime(end).length > 0 ? \"\" : end}`;",
    expect: "P1",
  },
  {
    id: "SM17", what: "manual rows are reconciled too (would be deleted on regenerate)", file: LIB,
    find: "    if (!r.is_recurring) continue;\n    const k = slotKey(r.date, r.start_time, r.end_time);",
    replace: "    const k = slotKey(r.date, r.start_time, r.end_time);",
    expect: "P3",
  },
  {
    id: "SM18", what: "equity counter not seeded with the kept rows", file: LIB,
    find: "  for (const k of kept) if (k.assigned_team_id && k.assigned_team_id in count) count[k.assigned_team_id]++;",
    replace: "",
    expect: "P5",
  },
  {
    id: "SM19", what: "staleness compares shift COUNTS per date, not times", file: LIB,
    find: "    l.push(`${normalizeTime(start)}-${normalizeTime(end)}`);",
    replace: "    l.push(`x`);",
    expect: "T3",
  },
  {
    id: "SM20", what: "staleness ignores a date that has stored rows but no derived shifts", file: LIB,
    find: "  const dates = new Set([...a.keys(), ...b.keys()]);",
    replace: "  const dates = new Set([...a.keys()]);",
    expect: "T1",
  },
];

runMutants({ sim: "scripts/sim/snack-shifts-sim.ts", timezones: ["UTC"], mutants: MUTANTS });
