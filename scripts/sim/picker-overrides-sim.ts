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
// MUTATION LOG (2026-09-23):
//   M1  `overrides?.includeNonPlayingDays` read as `true` in the day gate.
//       Dies at [DIFF-rainout] and [DIFF-interleague] — the default path starts
//       offering off-day slots that the golden does not contain.
//   M2  The cap gate's `allowSecondGame` read as `true`. Dies at the same two
//       differential assertions (team_cap dates start producing slots).
//   M3  The slot push drops `exceptions`. Dies at [FLAG-off-day] and
//       [FLAG-second-game]; the differential stays GREEN, which is the point —
//       only the flag assertions can catch it.
//   M4  `emptyDayLines` keeps emitting the "doesn't play on …" line when the
//       days were evaluated. Dies at [SHRINK-not-playing]; the differential
//       stays green because with the toggle off the line is still correct.
//
// TZ=UTC is mandatory: every fixture date is a literal wall-clock string.

import {
  buildSlotsAndDiagnostics,
  summarizeByWeekday,
  type BuildAvailableSlotsParams,
  type DayDiagnostics,
  type OccupiedSpan,
  type SlotOption,
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
type DK = (typeof DAY_KEYS)[number];

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
