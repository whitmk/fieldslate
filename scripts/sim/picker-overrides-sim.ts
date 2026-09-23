// Slot-picker override toggles — drives the REAL builder and the REAL
// interleague picker assembly.
//
// THE TWO OVERRIDES. "Include days the division doesn't normally play" lifts
// the playing-day gate only (on such a day the VENUE's hours govern — the
// settled makeup-day semantic, reused rather than reinvented). "Allow a second
// game the same day" lifts the per-day team cap only. Everything else — venue
// hours, occupancy, the arriving team's buffer, blackout dates, the team's own
// games, team_game_constraints — still applies under both.
//
// ── THE LOAD-BEARING PROOF: the seeded differential ───────────────────────────
//
// With both toggles OFF the output must be byte-identical to the pre-change
// tree, on BOTH surfaces. The rainout modal is acceptance-tested and in real
// use, so "close enough" is not a result. The goldens in
// fixtures/picker-overrides-golden.json were RECORDED FROM THE PRE-CHANGE TREE
// (recorder: PICKER_OVERRIDES_RECORD=1, see the header there) before the
// builder was touched. If the differential fails, the change leaked into the
// default path — fix the leak, do NOT re-record.
//
// Each fixture hashes BOTH surfaces' full observable output: the rainout
// surface (slots + diagnostics + the weekday roll-up it renders) and the
// interleague surface (buildResolvePicker's slots, diagnostics, lines,
// headline and seasonOver).
//
// ── Mutants, each dying at its OWN assertion ─────────────────────────────────
//   M1  Playing-day gate lifted even when the toggle is off  → [DIFF-*]
//   M2  Per-day cap lifted even when the toggle is off       → [DIFF-*]
//   M3  Override slot pushed WITHOUT its exception flag      → [FLAG-*]
//   M4  A no-longer-blocking reason still listed             → [SHRINK-*]
// Applied to the real source, run, reverted; results in MUTATION LOG below.
//
// MUTATION LOG (2026-09-23) — all four applied to the REAL source, run, then
// reverted and the suite re-verified green:
//   M1  `includeNonPlayingDays` forced true in the builder. Dies at
//       [DIFF-rainout] and [DIFF-interleague] (first drift at seed 1) — the
//       default path starts offering off-day slots the golden does not have.
//       It also trips the FLAG-* assertions, which is expected: with the gate
//       lifted unconditionally, "both toggles off" output now carries flags.
//       The differential is the assertion it was written for and it fires.
//   M2  `allowSecondGameSameDay` forced true. Same two differential
//       assertions, same reason (team_cap dates start producing slots).
//   M3  The slot push drops `exceptions` (always undefined). The DIFFERENTIAL
//       STAYS GREEN — verified, no DIFF failure in that run — and it dies at
//       [FLAG-only-override] / [FLAG-off-day] / [FLAG-second-game] plus the
//       flag counters. That is the point of those assertions: nothing else in
//       the suite can see a silently unmarked override slot.
//   M4  `emptyDayLines` keeps emitting the "doesn't play on …" line when the
//       days were evaluated. Dies at [SHRINK-not-playing] ALONE; the
//       differential stays green because with the toggle off that line is
//       still correct.
//
// A FIFTH DEFECT THE SUITE CAUGHT DURING THE BUILD, worth keeping in mind:
// the off-day flag was first computed PER DAY (a makeup day is pre-existing,
// so unflagged). But with the override on, a makeup day WIDENS to every open
// field and the whole of their hours, and those extra (field, time) pairs are
// genuinely new — they were rendering as normal offers.
// [FLAG-only-override] failed, and the flag became per SLOT: pre-existing iff
// the field is makeup-flagged AND the span fits the makeup union.
//
// TZ=UTC is mandatory: every fixture date is a literal wall-clock string.

import {
  buildSlotsAndDiagnostics,
  summarizeByWeekday,
  type BuildAvailableSlotsParams,
  type DayDiagnostics,
  type OccupiedSpan,
  type SlotOverrides,
} from "../../src/lib/schedule/reschedule-slots";
import {
  buildResolvePicker,
  type PickerGameRow,
  type PickerReads,
} from "../../src/lib/schedule/interleague-resolve-picker";
import type { VenueAvailability } from "../../src/lib/venues/availability";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.TZ !== "UTC") {
  console.error("Run with TZ=UTC (npm run sim:picker-overrides). Aborting.");
  process.exit(1);
}

const RECORD = process.env.PICKER_OVERRIDES_RECORD === "1";
const GOLDEN_PATH = join(__dirname, "fixtures", "picker-overrides-golden.json");

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const counters = {
  offOffSlots: 0,       // both toggles off, slots produced
  offDayOnSlots: 0,     // toggle 1 on, slots produced
  secondGameOnSlots: 0, // toggle 2 on, slots produced
  bothOnSlots: 0,       // both on, slots produced
  offDayFlagged: 0,     // a slot carried "off_day"
  secondGameFlagged: 0, // a slot carried "second_game"
  bothFlagged: 0,       // one slot carried BOTH
  makeupUnflagged: 0,   // a makeup-day slot stayed unflagged
  reasonsShrank: 0,     // the empty-day list got shorter when a toggle went on
};

// ── Seeded fixtures ─────────────────────────────────────────────────────────
// xorshift32: same sequence on every host and every run. An unpinned random
// would compare noise against the golden and fail for the wrong reason.
function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

const DAY_KEYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

function pad2(n: number) { return String(n).padStart(2, "0"); }
function hhmm(mins: number) { return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`; }
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

type Fixture = {
  seed: number;
  params: BuildAvailableSlotsParams;
  reads: PickerReads;
  ctx: { gameId: string; homeTeamId: string; homeTeamName: string; today: string };
};

function makeFixture(seed: number): Fixture {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

  const startDate = "2026-08-15";
  const endDate = addDays(startDate, 28 + Math.floor(r() * 40));
  const today = startDate;

  // 1-3 playing days, so most weekdays are off days for toggle 1 to surface.
  const playingDays: string[] = [];
  for (const d of DAY_KEYS) if (r() < 0.25) playingDays.push(d);
  if (!playingDays.length) playingDays.push("Sa");

  const duration = pick([60, 75, 90, 105, 120]);
  const buffer = pick([0, 15, 30, 60]);
  const maxPerTeamDay = pick([1, 1, 2]);

  // Division windows: sometimes deliberately tight, so day_window_too_short and
  // window_too_short both occur across the corpus.
  const dayWindows: Record<string, { start: string; end: string }> = {};
  for (const d of playingDays) {
    const open = 8 * 60 + Math.floor(r() * 6) * 60;
    const len = pick([duration, duration + 60, duration + 180, 30]);
    dayWindows[d] = { start: hhmm(open), end: hhmm(open + len) };
  }

  const venueCount = 1 + Math.floor(r() * 3);
  const venueIds: string[] = [];
  const venueNames: Record<string, string> = {};
  const venueAvailability: Record<string, VenueAvailability> = {};
  for (let i = 0; i < venueCount; i++) {
    const id = `v${i}`;
    venueIds.push(id);
    venueNames[id] = `Field ${i}`;
    const av: VenueAvailability = {};
    for (const d of DAY_KEYS) {
      if (r() < 0.25) continue; // closed that day
      const open = 7 * 60 + Math.floor(r() * 8) * 60;
      const len = pick([60, 120, 240, 480]);
      av[d] = {
        start: hhmm(open),
        end: hhmm(Math.min(23 * 60 + 45, open + len)),
        // Makeup flags exist in a minority of fixtures: makeup days must keep
        // behaving exactly as they do today, flag-free.
        makeup: r() < 0.15,
      };
    }
    venueAvailability[id] = av;
  }

  const venueBookings = new Map<string, OccupiedSpan[]>();
  const homeTeamSpans = new Map<string, OccupiedSpan[]>();
  const homeTeamDayCounts = new Map<string, number>();
  const blackoutDates = new Set<string>();
  const venueGameRows: PickerGameRow[] = [];
  const teamGameRows: PickerGameRow[] = [];

  for (let d = addDays(startDate, 0); d <= endDate; d = addDays(d, 1)) {
    if (r() < 0.05) blackoutDates.add(d);
    for (const id of venueIds) {
      if (r() < 0.35) {
        const startMin = 8 * 60 + Math.floor(r() * 10) * 60;
        venueBookings.set(`${id}:${d}`, [{ startMin, durationMin: pick([60, 90, 120]) }]);
        venueGameRows.push({
          scheduled_at: `${d}T${hhmm(startMin)}:00+00`,
          home_team: { division: { game_duration: 90 } },
        });
      }
    }
    if (r() < 0.3) {
      const startMin = 9 * 60 + Math.floor(r() * 8) * 60;
      homeTeamSpans.set(d, [{ startMin, durationMin: duration }]);
      homeTeamDayCounts.set(d, 1 + (r() < 0.2 ? 1 : 0));
      teamGameRows.push({
        scheduled_at: `${d}T${hhmm(startMin)}:00+00`,
        home_team: { division: { game_duration: duration } },
      });
    }
  }

  const params: BuildAvailableSlotsParams = {
    startDate, endDate, playingDays, dayWindows,
    earliestStart: "09:00", latestStart: "17:00",
    gameDuration: duration, bufferMinutes: buffer, maxPerTeamDay,
    venueIds, venueNames, venueAvailability,
    blackoutDates, venueBookings,
    homeTeamSpans, awayTeamSpans: new Map(),
    homeTeamDayCounts, awayTeamDayCounts: new Map(),
    homeTeamId: "home", awayTeamId: "away",
    constraintRules: new Map(),
    today,
  };

  // The interleague surface reads ONE field (the game's own venue) and goes
  // through the real assembly, which applies stripMakeup itself.
  const reads: PickerReads = {
    division: {
      data: {
        name: "AA",
        start_date: startDate,
        end_date: endDate,
        settings: {
          playing_days: playingDays,
          day_windows: dayWindows,
          game_duration: duration,
          buffer_minutes: buffer,
          max_games_per_team_per_day: maxPerTeamDay,
        },
      },
      error: null,
    },
    venue: {
      data: {
        id: venueIds[0]!,
        name: venueNames[venueIds[0]!]!,
        availability: venueAvailability[venueIds[0]!],
        availability_configured: true,
        location: null,
      },
      error: null,
    },
    blackouts: { data: [...blackoutDates].map((date) => ({ date })), error: null },
    venueGames: { data: venueGameRows, error: null },
    teamGames: { data: teamGameRows, error: null },
    constraints: { data: [], error: null },
  };

  return {
    seed, params, reads,
    ctx: { gameId: "g1", homeTeamId: "home", homeTeamName: "Mets", today },
  };
}

// ── Observable output of each surface, hashed ───────────────────────────────
function diagList(d: DayDiagnostics) {
  return [...d.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function rainoutOutput(f: Fixture, overrides?: unknown) {
  const p = overrides ? { ...f.params, overrides } : f.params;
  const { slots, diagnostics } = buildSlotsAndDiagnostics(p as BuildAvailableSlotsParams);
  return {
    slots,
    diagnostics: diagList(diagnostics),
    summaries: summarizeByWeekday(diagnostics, slots),
  };
}

function interleagueOutput(f: Fixture, overrides?: unknown) {
  const ctx = overrides ? { ...f.ctx, overrides } : f.ctx;
  const b = buildResolvePicker(f.reads, ctx as never);
  if (!b.ok) return { ok: false, reason: b.reason };
  return {
    ok: true,
    slots: b.slots,
    diagnostics: diagList(b.diagnostics),
    lines: b.lines,
    emptyHeadline: b.emptyHeadline,
    seasonOver: b.seasonOver,
  };
}

function hash(x: unknown): string {
  return createHash("sha256").update(JSON.stringify(x)).digest("hex").substring(0, 16);
}

const FIXTURE_COUNT = 2000;
const fixtures = Array.from({ length: FIXTURE_COUNT }, (_, i) => makeFixture(i + 1));

// ── The differential ────────────────────────────────────────────────────────
{
  console.log(`Differential: ${FIXTURE_COUNT} seeded fixtures, both toggles OFF`);
  const rain = fixtures.map((f) => hash(rainoutOutput(f)));
  const inter = fixtures.map((f) => hash(interleagueOutput(f)));

  if (RECORD) {
    writeFileSync(
      GOLDEN_PATH,
      JSON.stringify(
        {
          _comment:
            "RECORDED FROM THE PRE-CHANGE TREE. Hashes of both picker surfaces' " +
            "full output over seeded fixtures with no overrides. A failing " +
            "differential means the override path leaked into the default path. " +
            "Re-record ONLY when the default path is deliberately changed for a " +
            "reason unrelated to the overrides, and say so in the commit.",
          fixtureCount: FIXTURE_COUNT,
          rainout: rain,
          interleague: inter,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`  recorded ${FIXTURE_COUNT} golden hashes to ${GOLDEN_PATH}`);
  } else {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
      fixtureCount: number; rainout: string[]; interleague: string[];
    };
    assert(golden.fixtureCount === FIXTURE_COUNT, "[DIFF-count] golden covers every fixture");
    const rainBad = rain.findIndex((h, i) => h !== golden.rainout[i]);
    const interBad = inter.findIndex((h, i) => h !== golden.interleague[i]);
    assert(rainBad === -1, `[DIFF-rainout] byte-identical to the pre-change tree${rainBad === -1 ? "" : ` (first drift: seed ${fixtures[rainBad]!.seed})`}`);
    assert(interBad === -1, `[DIFF-interleague] byte-identical to the pre-change tree${interBad === -1 ? "" : ` (first drift: seed ${fixtures[interBad]!.seed})`}`);
  }
}

// ── Behavior under each toggle combination ──────────────────────────────────
//
// Run every fixture through all four combinations and assert the properties
// that the differential (which only ever sees "both off") cannot see.
{
  console.log("Behavior: all four toggle combinations over every fixture");
  const COMBOS: { label: string; o: SlotOverrides }[] = [
    { label: "off/off", o: {} },
    { label: "offday",  o: { includeNonPlayingDays: true } },
    { label: "second",  o: { allowSecondGameSameDay: true } },
    { label: "both",    o: { includeNonPlayingDays: true, allowSecondGameSameDay: true } },
  ];

  let growthSeen = 0;          // a toggle strictly added slots
  let normalSlotsHaveNoKey = true;
  let flaggedOnlyOnOverride = true;
  let offDayOnPlayingDay = 0;  // must stay 0: never flag a day the division plays
  let capRespectedWhenOff = 0; // must stay 0
  let offDayWhenOff = 0;       // must stay 0
  let teamCapListedWhenLifted = 0; // must stay 0
  let notPlayingListedWhenLifted = 0; // must stay 0

  for (const f of fixtures) {
    const plays = new Set(f.params.playingDays);
    const dayOf = (date: string) =>
      (["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const)[new Date(date + "T00:00:00Z").getUTCDay()]!;

    const byCombo = new Map<string, ReturnType<typeof rainoutOutput>>();
    for (const c of COMBOS) byCombo.set(c.label, rainoutOutput(f, Object.keys(c.o).length ? c.o : undefined));

    const off = byCombo.get("off/off")!;
    if (off.slots.length) counters.offOffSlots++;
    if (byCombo.get("offday")!.slots.length) counters.offDayOnSlots++;
    if (byCombo.get("second")!.slots.length) counters.secondGameOnSlots++;
    if (byCombo.get("both")!.slots.length) counters.bothOnSlots++;

    // With the toggles OFF nothing may carry a flag, and no off-day may appear.
    for (const s of off.slots) {
      if ("exceptions" in s) normalSlotsHaveNoKey = false;
      if (!plays.has(dayOf(s.date))) {
        // A makeup-flagged day is legitimately offered with the toggle off —
        // and must stay UNFLAGGED (decision: it is not an override slot).
        if ((s as { exceptions?: unknown }).exceptions) offDayWhenOff++;
        else counters.makeupUnflagged++;
      }
    }

    for (const c of COMBOS) {
      const out = byCombo.get(c.label)!;
      if (out.slots.length > off.slots.length) growthSeen++;

      for (const s of out.slots) {
        const ex = s.exceptions ?? [];
        if (ex.includes("off_day")) {
          counters.offDayFlagged++;
          if (plays.has(dayOf(s.date))) offDayOnPlayingDay++;
          if (!c.o.includeNonPlayingDays) flaggedOnlyOnOverride = false;
        }
        if (ex.includes("second_game")) {
          counters.secondGameFlagged++;
          if (!c.o.allowSecondGameSameDay) flaggedOnlyOnOverride = false;
        }
        if (ex.length === 2) counters.bothFlagged++;
        // A slot on a day the division does NOT play, surfaced while the
        // override is on, is either a makeup day (unflagged, pre-existing) or
        // an override day (flagged). It can never be silently normal AND new.
        if (c.o.includeNonPlayingDays && !plays.has(dayOf(s.date)) && ex.length === 0) {
          const wasOffered = off.slots.some((o) => o.isoString === s.isoString && o.venueId === s.venueId);
          if (!wasOffered) flaggedOnlyOnOverride = false;
        }
      }

      // Lifted gates must not still be reported as reasons.
      for (const [, d] of out.diagnostics) {
        if (c.o.allowSecondGameSameDay && d.kind === "team_cap") teamCapListedWhenLifted++;
      }
    }

    // The reason list must SHRINK (never grow) as gates are lifted.
    const offReasons = off.diagnostics.length;
    const bothReasons = byCombo.get("both")!.diagnostics.length;
    if (bothReasons < offReasons) counters.reasonsShrank++;
    if (bothReasons > offReasons) capRespectedWhenOff++; // reuse as "grew" detector

    // The interleague surface drops the "doesn't play on …" line when the days
    // were evaluated.
    const inter = interleagueOutput(f, { includeNonPlayingDays: true }) as { ok: boolean; lines?: { kind: string }[] };
    if (inter.ok && inter.lines?.some((l) => l.kind === "not_playing_day")) notPlayingListedWhenLifted++;
  }

  assert(normalSlotsHaveNoKey, "[FLAG-absent] with both toggles off, no slot carries an `exceptions` key at all");
  assert(offDayWhenOff === 0, "[FLAG-makeup] a makeup-day slot offered with the toggles off stays unflagged");
  assert(flaggedOnlyOnOverride, "[FLAG-only-override] a flag appears only under the toggle that surfaced the slot");
  assert(offDayOnPlayingDay === 0, "[FLAG-off-day] `off_day` never lands on a day the division plays");
  assert(counters.offDayFlagged > 0, "[FLAG-off-day] override days produce flagged slots");
  assert(counters.secondGameFlagged > 0, "[FLAG-second-game] cap-lifted dates produce flagged slots");
  assert(growthSeen > 0, "[GROW] a toggle strictly added slots on some fixture");
  assert(teamCapListedWhenLifted === 0, "[SHRINK-team-cap] `team_cap` is never reported once the cap is lifted");
  assert(notPlayingListedWhenLifted === 0, "[SHRINK-not-playing] the \"doesn't play on …\" line disappears once the days are included");
  assert(capRespectedWhenOff === 0, "[SHRINK-monotonic] lifting a gate never ADDS an empty-day reason");
}

// ── Everything else still applies under both overrides ──────────────────────
{
  console.log("Invariants: the other constraints survive both overrides");
  let checked = 0;
  let blackoutOffered = 0;
  let outsideVenueHours = 0;
  let overlappedTeamGame = 0;
  let overlappedBooking = 0;

  for (const f of fixtures) {
    const out = rainoutOutput(f, { includeNonPlayingDays: true, allowSecondGameSameDay: true });
    for (const s of out.slots) {
      checked++;
      if (f.params.blackoutDates.has(s.date)) blackoutOffered++;

      const startMin = toMinutes(s.isoString.substring(11, 16));
      const dur = f.params.gameDuration;
      const av = f.params.venueAvailability[s.venueId]!;
      const day = (["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const)[
        new Date(s.date + "T00:00:00Z").getUTCDay()
      ]!;
      const w = av[day];
      if (!w || startMin < toMinutes(w.start) || startMin + dur > toMinutes(w.end)) outsideVenueHours++;

      for (const t of f.params.homeTeamSpans.get(s.date) ?? []) {
        if (startMin < t.startMin + t.durationMin && t.startMin < startMin + dur) overlappedTeamGame++;
      }
      for (const b of f.params.venueBookings.get(`${s.venueId}:${s.date}`) ?? []) {
        const buf = f.params.bufferMinutes;
        if (startMin - buf < b.startMin + b.durationMin && b.startMin < startMin + dur + buf) overlappedBooking++;
      }
    }
  }

  assert(checked > 0, "[INV] the both-on run produced slots to check");
  assert(blackoutOffered === 0, "[INV-blackout] no slot on a blackout date");
  assert(outsideVenueHours === 0, "[INV-venue-hours] every slot fits inside its field's hours for that day");
  assert(overlappedTeamGame === 0, "[INV-team-overlap] no slot overlaps a game the team already plays");
  assert(overlappedBooking === 0, "[INV-buffer] no slot violates the buffer around an existing booking");
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

// ── Counters ───────────────────────────────────────────────────────────────
console.log("\nCoverage counters:");
for (const [name, n] of Object.entries(counters)) {
  console.log(`  ${name}: ${n}`);
  assert(n > 0, `[COUNTER] ${name} fired at least once`);
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll checks passed.");
