// Interleague counter-proposal picker — proof harness.
//
// Run: `npm run sim:interleague-picker` (TZ=UTC mandatory, like every slot sim).
//
// Drives the REAL src/lib/schedule/interleague-resolve-picker.ts (read assembly,
// fail-closed decisions, empty-day wording) on top of the REAL
// buildSlotsAndDiagnostics, and cross-checks every offered time against the REAL
// server occupancy gate (gateRescheduleOccupancy) fed the same rows through a
// fake RPC. Nothing under test is reimplemented here.
//
// Three-part standard (CLAUDE.md "Harness standard"): real code end to end;
// mutants each killed BY THE ASSERTION WRITTEN FOR IT (log at the bottom); and
// anti-vacuity counters — a zero counter FAILS the run.
//
// Fixtures mirror the live shape the feature was built for (2026-09-14): SRALL
// Fall 2026 division AA — plays Sa (09:00–17:00) and We (17:00–17:00, a ZERO-
// length window), 90-minute games, 60-minute buffer — at field "jennings", open
// Mo–Fr 17:00–21:00, Sa 08:00–19:00, Su 09:00–17:00.

import {
  NOT_ATTEMPTED,
  assemblePickerInputs,
  buildResolvePicker,
  emptyDayLines,
  headlineBlame,
  resolveEditMode,
  stripMakeup,
  type EmptyDayLine,
  type PickerContext,
  type PickerGameRow,
  type PickerReads,
} from "@/lib/schedule/interleague-resolve-picker";
import { summarizeByWeekday, type SlotOption } from "@/lib/schedule/reschedule-slots";
import { gateRescheduleOccupancy } from "@/lib/venues/occupancy-gate";
import { parseAvailability } from "@/lib/venues/availability";

if (new Date("2026-08-15T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error("This harness must run with TZ=UTC. Use `npm run sim:interleague-picker`.");
  process.exit(1);
}

let assertions = 0;
let failures = 0;
function assert(cond: boolean, label: string) {
  assertions++;
  if (cond) return;
  failures++;
  console.log(`  FAIL: ${label}`);
}

const counters = {
  slotsOffered: 0,
  occupancyBlockedTimes: 0,       // grid times a booking removed
  bufferOnlyBlockedTimes: 0,      // removed by the buffer, clear without it
  gateAgreedOffered: 0,           // offered times the real gate accepted
  gateRejectedHidden: 0,          // hidden times the real gate also refused
  line_not_playing_day: 0,
  line_field_closed: 0,
  line_field_too_short: 0,
  line_day_window_too_short: 0,
  zeroLengthWindowLive: 0,        // the AA 17:00–17:00 Wednesday, specifically
  line_occupied_booked: 0,
  line_occupied_team: 0,
  line_blackout: 0,
  line_team_cap: 0,
  awayBranch: 0,
  noVenueBranch: 0,
  failClosedReads: 0,
  makeupFlagStripped: 0,
  seasonOver: 0,
  multiReasonWeekday: 0,
  headlineField: 0,
  headlineTeam: 0,
  headlineNeutralMixed: 0,
  headlineNeutralOther: 0,
  occupiedBlameSplit: 0,
};

// ── Fixture builder ───────────────────────────────────────────────────────────

const VENUE_ID = "venue-jennings";
const HOME = "team-mariners";
const GAME = "game-counter";

const JENNINGS_HOURS = {
  Mo: { start: "17:00", end: "21:00" },
  Tu: { start: "17:00", end: "21:00" },
  We: { start: "17:00", end: "21:00" },
  Th: { start: "17:00", end: "21:00" },
  Fr: { start: "17:00", end: "21:00" },
  Sa: { start: "08:00", end: "19:00" },
  Su: { start: "09:00", end: "17:00" },
};

const AA_SETTINGS = {
  playing_days: ["Sa", "We"],
  day_windows: {
    Sa: { start: "09:00", end: "17:00" },
    Su: { start: "09:00", end: "17:00" },
    We: { start: "17:00", end: "17:00" },
  },
  game_duration: 90,
  buffer_minutes: 60,
};

type Over = {
  start?: string;
  end?: string;
  settings?: Record<string, unknown>;
  hours?: unknown;
  configured?: boolean;
  location?: { name: string } | null;
  venueGames?: PickerGameRow[];
  teamGames?: PickerGameRow[];
  blackouts?: string[];
  reads?: Partial<PickerReads>;
};

function game(at: string, duration: unknown = 90): PickerGameRow {
  return { scheduled_at: at, home_team: { division: { game_duration: duration } } };
}

function reads(o: Over = {}): PickerReads {
  return {
    division: {
      data: {
        name: "AA",
        start_date: o.start ?? "2026-08-31",
        end_date: o.end ?? "2026-10-31",
        settings: o.settings ?? AA_SETTINGS,
      },
      error: null,
    },
    venue: {
      data: {
        id: VENUE_ID,
        name: "jennings",
        availability: o.hours ?? JENNINGS_HOURS,
        availability_configured: o.configured ?? true,
        location: o.location ?? null,
      },
      error: null,
    },
    blackouts: { data: (o.blackouts ?? []).map((date) => ({ date })), error: null },
    venueGames: { data: o.venueGames ?? [], error: null },
    teamGames: { data: o.teamGames ?? [], error: null },
    constraints: { data: [], error: null },
    ...o.reads,
  };
}

const CTX: PickerContext = {
  gameId: GAME,
  homeTeamId: HOME,
  homeTeamName: "Mariners",
  today: "2026-09-14",
};

function build(o: Over = {}) {
  const b = buildResolvePicker(reads(o), CTX);
  if (!b.ok) throw new Error(`fixture unexpectedly refused: ${b.reason}`);
  counters.slotsOffered += b.slots.length;
  for (const l of b.lines) counters[`line_${l.kind}`]++;
  return b;
}

const timesOn = (slots: SlotOption[], date: string) =>
  slots.filter((s) => s.date === date).map((s) => s.isoString.substring(11, 16));

const lineOf = (lines: EmptyDayLine[], kind: EmptyDayLine["kind"]) =>
  lines.find((l) => l.kind === kind);

/** The REAL server gate, fed the same occupancy the picker saw, via a fake RPC
 *  shaped exactly like get_game_occupancy_context's payload. */
async function gateAccepts(
  iso: string,
  occupied: PickerGameRow[],
  settings: Record<string, unknown>,
): Promise<boolean> {
  const date = iso.substring(0, 10);
  const ctx = {
    game_id: GAME,
    venue_id: VENUE_ID,
    venue_name: "jennings",
    scheduled_at: iso.substring(0, 19),
    game_duration: settings.game_duration ?? null,
    buffer_minutes: settings.buffer_minutes ?? null,
    occupied: occupied
      .filter((g) => g.scheduled_at.substring(0, 10) === date)
      .map((g, i) => ({
        game_id: `occ-${i}`,
        scheduled_at: g.scheduled_at.replace(" ", "T").substring(0, 19),
        game_duration: g.home_team?.division?.game_duration ?? null,
        label: `Occupant ${i}`,
      })),
  };
  const fake = { rpc: async () => ({ data: ctx, error: null }) };
  const r = await gateRescheduleOccupancy(fake as never, { gameId: GAME, scheduledAtIso: `${iso}+00:00` });
  return r.ok;
}

const ALL_GRID = (() => {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

async function main() {
  // ══ CLEAR — the live AA shape with nothing booked ════════════════════════════
  console.log("CLEAR  live AA / jennings, nothing booked");
  {
    const b = build();
    const sat = timesOn(b.slots, "2026-09-19");
    assert(sat[0] === "09:00", `[CLEAR] Saturday opens at the division window, 09:00 (got ${sat[0]})`);
    assert(sat[sat.length - 1] === "15:30", `[CLEAR] last Saturday start ends by 17:00 → 15:30 (got ${sat[sat.length - 1]})`);
    assert(sat.length === 27, `[CLEAR] full Saturday grid is 27 starts (got ${sat.length})`);
    assert(!b.slots.some((s) => s.date < "2026-09-14"), "[CLEAR] nothing before today");
    assert(b.slots.every((s) => s.venueId === VENUE_ID), "[CLEAR] only the game's own field is offered");
    assert(!b.slots.some((s) => s.date === "2026-09-16"), "[CLEAR] Wednesday (zero-length window) offers nothing");

    // THE LIVE BUG, now honest: the 17:00–17:00 Wednesday is a window problem,
    // not "already booked".
    const wed = lineOf(b.lines, "day_window_too_short");
    assert(
      wed?.dayLabel === "Wednesdays" &&
        wed.text === "AA's game window that day is 5pm–5pm, which isn't long enough for a 90-minute game.",
      `[EMPTY] AA Wednesday line names the 5pm–5pm window (got ${JSON.stringify(wed)})`,
    );
    assert(!b.lines.some((l) => l.kind === "occupied_booked"), "[EMPTY] nothing is called 'already booked' when nothing is booked");
    if (wed) counters.zeroLengthWindowLive++;

    const np = lineOf(b.lines, "not_playing_day");
    assert(
      np?.text === "AA doesn't play on Mondays, Tuesdays, Thursdays, Fridays or Sundays." && np.dayLabel === null,
      `[EMPTY] non-playing days merge into one sentence (got ${np?.text})`,
    );
  }

  // ══ CONFLICT — a booking blocks by real span + the ARRIVING team's buffer ════
  console.log("CONFLICT  a 120-minute game at 12:00 on Saturday 9/19");
  {
    const occ = [game("2026-09-19 12:00:00+00", 120)];
    const b = build({ venueGames: occ });
    const sat = timesOn(b.slots, "2026-09-19");
    // Placing 90 + buffer 60 against [12:00, 14:00): blocked when
    // t − 60 < 14:00 and 12:00 < t + 150  →  9:45 … 14:45.
    assert(
      JSON.stringify(sat) === JSON.stringify(["09:00", "09:15", "09:30", "15:00", "15:15", "15:30"]),
      `[CONFLICT] exact offer set around the booking (got ${sat.join(",")})`,
    );
    assert(!sat.includes("12:00"), "[CONFLICT] the booked start itself is refused");
    assert(!sat.includes("09:45"), "[BUFFER] 9:45 refused — it ends 11:15, inside the 60-minute buffer before 12:00");
    assert(!sat.includes("14:45"), "[BUFFER] 14:45 refused — only 45 minutes after the 14:00 end");
    assert(sat.includes("15:00"), "[BUFFER] 15:00 offered — exactly end + buffer");

    const clearSat = timesOn(build().slots, "2026-09-19");
    counters.occupancyBlockedTimes += clearSat.length - sat.length;
    const noBuf = timesOn(build({ venueGames: occ, settings: { ...AA_SETTINGS, buffer_minutes: 0 } }).slots, "2026-09-19");
    counters.bufferOnlyBlockedTimes += noBuf.filter((t) => !sat.includes(t)).length;
    // Other Saturdays are untouched by a 9/19 booking.
    assert(timesOn(b.slots, "2026-09-26").length === 27, "[CONFLICT] a booking on 9/19 does not touch 9/26");

    // ── Picker ⊆ gate, and the gate refuses what the picker hid ──
    for (const t of sat) {
      const ok = await gateAccepts(`2026-09-19T${t}:00`, occ, AA_SETTINGS);
      assert(ok, `[AGREE] the real occupancy gate accepts offered ${t}`);
      if (ok) counters.gateAgreedOffered++;
    }
    for (const t of ["09:45", "12:00", "14:45"]) {
      const ok = await gateAccepts(`2026-09-19T${t}:00`, occ, AA_SETTINGS);
      assert(!ok, `[AGREE] the real occupancy gate also refuses hidden ${t}`);
      if (!ok) counters.gateRejectedHidden++;
    }
  }

  // ══ AGREE — exact agreement with the gate over the whole in-window grid ══════
  console.log("AGREE  picker vs the real gate, every in-window grid time");
  {
    // Set buffer (every live division): the picker offers EXACTLY the in-window
    // times the gate accepts. The division window is the picker's extra
    // strictness (the gate doesn't check it), so compare inside it only.
    const occ = [game("2026-09-19 12:00:00+00", 120), game("2026-09-19 16:30:00+00", 60)];
    const sat = timesOn(build({ venueGames: occ }).slots, "2026-09-19");
    let mismatches = 0;
    for (const t of ALL_GRID) {
      if (t < "09:00" || t > "15:30") continue;
      if ((await gateAccepts(`2026-09-19T${t}:00`, occ, AA_SETTINGS)) !== sat.includes(t)) mismatches++;
    }
    assert(mismatches === 0, `[AGREE] set buffer: picker offers exactly the in-window times the gate accepts (${mismatches} mismatches)`);

    // Unset buffer. The picker reads the setting (undefined) → bufferFromRaw → 15.
    // The gate receives the RPC's JSON null → bufferFromRaw(null) → Number(null)
    // is 0 → a 0 buffer. KNOWN, flagged, not fixed here (the gate is out of
    // scope): the picker is STRICTER, so it can only hide times the gate would
    // allow — never offer one it refuses. Unreachable live: every division sets
    // buffer_minutes.
    const unset = { ...AA_SETTINGS, buffer_minutes: undefined };
    const occ1 = [game("2026-09-19 12:00:00+00", 120)];
    const satU = timesOn(build({ venueGames: occ1, settings: unset }).slots, "2026-09-19");
    let offeredButRefused = 0;
    for (const t of satU) if (!(await gateAccepts(`2026-09-19T${t}:00`, occ1, unset))) offeredButRefused++;
    assert(offeredButRefused === 0, "[AGREE] unset buffer: nothing offered that the gate refuses");
    assert(!satU.includes("10:30") && satU.includes("10:15") && satU.includes("14:15"), `[AGREE] unset buffer resolves to 15 in the picker (got ${satU.join(",")})`);
    assert(await gateAccepts("2026-09-19T10:30:00", occ1, unset), "[KNOWN] the gate resolves a null buffer to 0 (flagged in CLAUDE.md, not fixed)");

    // game_duration non-numeric → durationFromSettings' 90, never NaN-empty.
    const bj = build({ settings: { ...AA_SETTINGS, game_duration: "ninety" } });
    assert(timesOn(bj.slots, "2026-09-19").length === 27, "[AGREE] non-numeric duration falls back to 90 — slots still offered, never NaN-empty");
  }

  // ══ EMPTY-DAY REASONS — each fired on its own fixture ════════════════════════
  console.log("EMPTY  every empty-day reason, with exact wording");
  {
    // One Saturday (9/19) keeps each weekday roll-up to a single, deliberate reason.
    const one = { start: "2026-09-19", end: "2026-09-19", settings: { ...AA_SETTINGS, playing_days: ["Sa"] } };

    const closed = build({ ...one, hours: { ...JENNINGS_HOURS, Sa: undefined } });
    const lc = lineOf(closed.lines, "field_closed");
    assert(lc?.text === "jennings is closed that day." && lc.dayLabel === "Saturdays" && lc.venuesLink, `[EMPTY] field closed (got ${JSON.stringify(lc)})`);

    const short = build({ ...one, hours: { ...JENNINGS_HOURS, Sa: { start: "09:00", end: "10:00" } } });
    const ls = lineOf(short.lines, "field_too_short");
    assert(
      ls?.text === "jennings is open 9am–10am, which isn't long enough for this game." && ls.venuesLink,
      `[EMPTY] field too short names its real hours (got ${JSON.stringify(ls)})`,
    );

    const mismatch = build({
      ...one,
      settings: { ...AA_SETTINGS, playing_days: ["Sa"], day_windows: { Sa: { start: "06:00", end: "08:00" } } },
    });
    const lm = lineOf(mismatch.lines, "day_window_too_short");
    assert(
      lm?.text === "AA's game window that day (6am–8am) doesn't overlap jennings's hours enough for a 90-minute game." && !lm.venuesLink,
      `[EMPTY] a window that misses the field's hours says so (got ${JSON.stringify(lm)})`,
    );

    const booked = build({ ...one, venueGames: [game("2026-09-19 08:00:00+00", 660)] });
    const lb = lineOf(booked.lines, "occupied_booked");
    assert(lb?.text === "jennings is already booked at every time that fits (1 date)." && lb.tone === "info" && !lb.venuesLink, `[EMPTY] occupied by bookings (got ${JSON.stringify(lb)})`);

    const team = build({
      ...one,
      settings: { ...AA_SETTINGS, playing_days: ["Sa"], max_games_per_team_per_day: 2 },
      teamGames: [game("2026-09-19 08:00:00+00", 660)],
    });
    const lt = lineOf(team.lines, "occupied_team");
    assert(
      lt?.text === "Mariners already has a game or a scheduling block at every time jennings is free (1 date).",
      `[EMPTY] occupied by our team (got ${JSON.stringify(lt)})`,
    );

    const black = build({ ...one, blackouts: ["2026-09-19"] });
    assert(lineOf(black.lines, "blackout")?.text === "blacked out (1 date).", "[EMPTY] blackout");

    const cap = build({ ...one, teamGames: [game("2026-09-19 08:00:00+00", 60)] });
    assert(lineOf(cap.lines, "team_cap")?.text === "Mariners already has a game that day (1 date).", "[EMPTY] team per-day cap");

    // Distinctness across the four configuration/occupancy reasons.
    const texts = [lc, ls, lm, lb].map((l) => l?.text ?? "");
    assert(new Set(texts).size === 4 && texts.every(Boolean), "[EMPTY] closed / too short / window / booked are four DISTINCT sentences");
    assert(
      [lc, ls, lm].every((l) => !l?.text.includes("already booked")),
      "[EMPTY] no configuration reason claims the field is booked",
    );

    // Qualified label when the field belongs to a location (chooser rule).
    const loc = build({ ...one, location: { name: "Monroe Complex" } });
    assert(loc.fieldName === "Monroe Complex — jennings", `[LABEL] qualified field label (got ${loc.fieldName})`);
  }

  // ══ ROLL-UP — the shared weekday summary still hides weekdays with slots ═════
  console.log("ROLLUP  summarizeByWeekday");
  {
    // Two Saturdays: 9/19 booked solid, 9/26 clear → Saturday has slots, no line.
    const b = build({
      start: "2026-09-19", end: "2026-09-26",
      settings: { ...AA_SETTINGS, playing_days: ["Sa"] },
      venueGames: [game("2026-09-19 08:00:00+00", 660)],
    });
    assert(b.diagnostics.get("2026-09-19")?.kind === "occupied", "[ROLLUP] 9/19 itself is diagnosed occupied");
    assert(!b.lines.some((l) => l.dayLabel === "Saturdays"), "[ROLLUP] a weekday with ANY slot gets no empty line");
    const direct = summarizeByWeekday(b.diagnostics, b.slots);
    assert(!direct.some((s) => s.day === "Sa"), "[ROLLUP] summarizeByWeekday agrees");
    // emptyDayLines over no summaries says nothing.
    assert(emptyDayLines([], { fieldName: "f", divisionName: "d", teamName: "t", playingDays: [] }).length === 0, "[ROLLUP] no summaries → no lines");
  }

  // ══ MAKEUP — flags are stripped; a counter-proposal is not a rainout ═════════
  console.log("MAKEUP  makeup-flagged Friday offers nothing");
  {
    const flagged = { ...JENNINGS_HOURS, Fr: { start: "17:00", end: "21:00", makeup: true } };
    assert(parseAvailability(flagged).Fr?.makeup === true, "[MAKEUP] fixture really carries the flag");
    assert(stripMakeup(parseAvailability(flagged)).Fr?.makeup === false, "[MAKEUP] stripMakeup clears it");
    assert(stripMakeup(parseAvailability(flagged)).Fr?.start === "17:00", "[MAKEUP] stripMakeup keeps the hours");
    const b = build({ hours: flagged });
    const fridays = b.slots.filter((s) => new Date(`${s.date}T00:00:00`).getDay() === 5);
    assert(fridays.length === 0, `[MAKEUP] no Friday is offered (got ${fridays.length})`);
    assert(lineOf(b.lines, "not_playing_day")?.text.includes("Fridays") === true, "[MAKEUP] Friday reads as a non-playing day");
    if (fridays.length === 0) counters.makeupFlagStripped++;
  }

  // ══ MODE — the away branch, keyed on venue_id ════════════════════════════════
  console.log("MODE  away games are free-typed; keyed on venue_id");
  {
    const away = resolveEditMode({ venue_id: null, is_away: true });
    assert(away === "away_free_typed", `[MODE] away game (no field) → free-typed (got ${away})`);
    if (away === "away_free_typed") counters.awayBranch++;
    const noVenue = resolveEditMode({ venue_id: null, is_away: false });
    assert(noVenue === "no_venue_free_typed", `[MODE] home game with no field → free-typed, no picker (got ${noVenue})`);
    if (noVenue === "no_venue_free_typed") counters.noVenueBranch++;
    assert(resolveEditMode({ venue_id: VENUE_ID, is_away: false }) === "picker", "[MODE] home game with our field → picker");
    assert(
      resolveEditMode({ venue_id: VENUE_ID, is_away: true }) === "picker",
      "[MODE] a field on the row means a picker even if is_away diverges — keyed on venue_id, like the gate",
    );
  }

  // ══ FAIL CLOSED — every read ═════════════════════════════════════════════════
  console.log("READS  every read fails closed, including errors that arrive WITH data");
  {
    const err = { message: "boom" };
    const cases: [string, Partial<PickerReads>][] = [
      ["division", { division: { data: null, error: err } }],
      ["venue", { venue: { data: null, error: err } }],
      ["blackouts", { blackouts: { data: [], error: err } }],
      // Partial rows + an error: the truncation shape. Must NOT be used.
      ["venueGames", { venueGames: { data: [game("2026-09-19 12:00:00+00", 120)], error: err } }],
      ["teamGames", { teamGames: { data: [], error: err } }],
      ["constraints", { constraints: { data: [], error: err } }],
      ["venueGames not attempted", { venueGames: NOT_ATTEMPTED }],
      ["division row missing", { division: { data: null, error: null } }],
    ];
    for (const [name, r] of cases) {
      const a = assemblePickerInputs(reads({ reads: r }), CTX);
      const bp = buildResolvePicker(reads({ reads: r }), CTX);
      const closed = !a.ok && a.reason === "read_failed" && !bp.ok;
      assert(closed, `[FAIL] ${name}: refused as read_failed, no slots (got ${a.ok ? "ok" : a.reason})`);
      if (closed) counters.failClosedReads++;
    }
    const unconfigured = assemblePickerInputs(reads({ configured: false }), CTX);
    assert(!unconfigured.ok && unconfigured.reason === "venue_unconfigured", "[FAIL] unconfigured field → venue_unconfigured, not an empty list");
    const noDates = assemblePickerInputs(reads({ start: "" }), CTX);
    assert(!noDates.ok && noDates.reason === "division_dates_missing", "[FAIL] division without dates → division_dates_missing");
    const msg = assemblePickerInputs(reads({ reads: { teamGames: { data: null, error: err } } }), CTX);
    assert(!msg.ok && msg.reason === "read_failed" && msg.message === "Couldn't load Mariners's other games, so no times are shown. Try again.", "[FAIL] the refusal names what could not be read");
  }

  // ══ SEASON OVER ══════════════════════════════════════════════════════════════
  {
    const b = build({ start: "2026-08-31", end: "2026-09-05" });
    assert(b.seasonOver && b.slots.length === 0 && b.lines.length === 0, "[OVER] a season ended before today is reported as over, not as 'no times'");
    if (b.seasonOver) counters.seasonOver++;
    assert(!build().seasonOver, "[OVER] a live season is not over");
  }

  // ══ ROLL-UP — every reason per weekday, each with its own count ═══════════
  console.log("MULTI  Mets vs Greys, live data: one weekday, several reasons");
  {
    // Live rows (2026-09-15): the Mets' other AA games in the window, the
    // league's blackouts, today = Sep 15. The game being proposed is excluded
    // from its own team read, as loadPickerReads does.
    const mets = [
      "2026-09-02 17:00:00+00", "2026-09-09 17:00:00+00", "2026-09-16 17:00:00+00", "2026-09-19 11:30:00+00",
      "2026-09-23 17:00:00+00", "2026-09-26 09:00:00+00", "2026-09-30 17:00:00+00", "2026-10-03 09:00:00+00",
      "2026-10-10 09:00:00+00", "2026-10-14 17:00:00+00", "2026-10-17 09:00:00+00", "2026-10-24 09:00:00+00",
      "2026-10-28 17:00:00+00",
    ].map((at) => game(at));
    const settings = { ...AA_SETTINGS, max_games_per_team_per_day: 1 };
    const b = buildResolvePicker(
      reads({ settings, teamGames: mets, blackouts: ["2026-09-07", "2026-09-12", "2026-10-31"] }),
      { ...CTX, homeTeamName: "Mets" },
    );
    if (!b.ok) throw new Error("fixture refused");
    const texts = b.lines.map((l) => `${l.dayLabel ?? "-"} — ${l.text}`);
    const expected = [
      "Wednesdays — Mets already has a game that day (5 dates).",
      "Wednesdays — AA's game window that day is 5pm–5pm, which isn't long enough for a 90-minute game (2 dates).",
      "Saturdays — Mets already has a game that day (6 dates).",
      "Saturdays — blacked out (1 date).",
      "- — AA doesn't play on Mondays, Tuesdays, Thursdays, Fridays or Sundays.",
    ];
    assert(
      JSON.stringify(texts) === JSON.stringify(expected),
      `[MR1] every reason per weekday with its OWN count (got ${JSON.stringify(texts)})`,
    );
    assert(
      !texts.some((t) => t.includes("(7 dates)")),
      "[MR2] no reason is credited with the whole weekday's 7 dates",
    );
    const wedCounts = summarizeByWeekday(b.diagnostics, b.slots).filter((x) => x.day === "We");
    assert(
      wedCounts.length === 2 && wedCounts.every((x) => x.reasonsOnDay === 2) &&
        wedCounts.reduce((a, x) => a + x.dateCount, 0) === 7,
      "[MR3] Wednesday's reasons add up to its 7 evaluated dates, and each knows it shares the day",
    );
    if (wedCounts.length > 1) counters.multiReasonWeekday++;
    assert(b.slots.length === 0 && b.emptyHeadline === "No open times this season.", `[H1] team-side + division/season-side → neutral header (got ${b.emptyHeadline})`);
    if (headlineBlame(b.lines) === "neutral") counters.headlineNeutralMixed++;
    assert(!b.emptyHeadline.includes("jennings"), "[H1b] the field is NOT blamed when team-side reasons are present");
  }

  console.log("HEADLINE  field-only / team-only / other-only");
  {
    const one = { start: "2026-09-19", end: "2026-09-26", settings: { ...AA_SETTINGS, playing_days: ["Sa"] } };

    const closed = build({ ...one, hours: { ...JENNINGS_HOURS, Sa: undefined } });
    assert(closed.emptyHeadline === "No open times at jennings this season.", `[H2] field closed only → names the field (got ${closed.emptyHeadline})`);
    if (headlineBlame(closed.lines) === "field") counters.headlineField++;

    const booked = build({ ...one, venueGames: [game("2026-09-19 08:00:00+00", 660), game("2026-09-26 08:00:00+00", 660)] });
    assert(booked.emptyHeadline === "No open times at jennings this season.", `[H3] booked only → names the field (got ${booked.emptyHeadline})`);

    const capped = build({ ...one, teamGames: [game("2026-09-19 18:00:00+00", 60), game("2026-09-26 18:00:00+00", 60)] });
    assert(capped.emptyHeadline === "No open times for Mariners this season.", `[H4] team cap only → names the team, not the field (got ${capped.emptyHeadline})`);
    if (headlineBlame(capped.lines) === "team") counters.headlineTeam++;

    const black = build({ ...one, blackouts: ["2026-09-19", "2026-09-26"] });
    assert(black.emptyHeadline === "No open times this season.", `[H5] blackout only → neutral (got ${black.emptyHeadline})`);
    if (headlineBlame(black.lines) === "neutral") counters.headlineNeutralOther++;

    const fieldAndTeam = build({
      ...one,
      venueGames: [game("2026-09-19 08:00:00+00", 660)],
      teamGames: [game("2026-09-26 18:00:00+00", 60)],
    });
    assert(fieldAndTeam.emptyHeadline === "No open times this season.", `[H6] field-side + team-side on different dates → neutral (got ${fieldAndTeam.emptyHeadline})`);
    const multiSat = fieldAndTeam.lines.filter((l) => l.dayLabel === "Saturdays").map((l) => l.text);
    assert(
      JSON.stringify(multiSat) === JSON.stringify([
        "jennings is already booked at every time that fits (1 date).",
        "Mariners already has a game that day (1 date).",
      ]),
      `[MR4] a tie keeps the earliest date's reason first (got ${JSON.stringify(multiSat)})`,
    );
  }

  console.log("ROLLUP-UNIT  occupied splits by who is blamed");
  {
    const diags = new Map<string, import("@/lib/schedule/reschedule-slots").DayDiagnostic>([
      ["2026-09-19", { kind: "occupied", venueBookingRejections: 5, teamRejections: 1 }],
      ["2026-09-26", { kind: "occupied", venueBookingRejections: 0, teamRejections: 9 }],
      ["2026-10-03", { kind: "occupied", venueBookingRejections: 4, teamRejections: 0 }],
    ]);
    const sum = summarizeByWeekday(diags, []);
    assert(
      sum.length === 2 && sum[0].dateCount === 2 && sum[0].diagnostic === diags.get("2026-09-19") && sum[1].dateCount === 1,
      `[MR5] booked (2) and team-blamed (1) occupied Saturdays are two reasons (got ${JSON.stringify(sum.map((x) => [x.dateCount, x.reasonsOnDay]))})`,
    );
    if (sum.length === 2) counters.occupiedBlameSplit++;
    const single = summarizeByWeekday(new Map([["2026-09-19", { kind: "blackout" as const }], ["2026-09-26", { kind: "blackout" as const }]]), []);
    assert(single.length === 1 && single[0].dateCount === 2 && single[0].reasonsOnDay === 1, "[MR6] a single-reason weekday is one entry with the full count");
  }

  // ── Counters ────────────────────────────────────────────────────────────────
  console.log("counters:", JSON.stringify(counters));
  for (const [name, n] of Object.entries(counters)) {
    assertions++;
    if (n === 0) {
      failures++;
      console.log(`  VACUOUS: ${name} = 0 — the assertions depending on it proved nothing`);
    }
  }
  console.log(`${failures === 0 ? "PASS" : "FAIL"} — ${assertions} assertions, ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION LOG — 2026-09-14. 10 mutants, all killed BY THE ASSERTION WRITTEN FOR
// IT. Criterion (CLAUDE.md): a mutant is killed only when a BASELINE assertion
// fails, and the failing set must include the assertion that targets it. Every
// assertion is evaluated on every run (failures are counted, never thrown), so
// no mutant can die early and leave its target unevaluated. Each was applied to
// the named file, run, reverted; files byte-compared against the saved copies
// and the suite re-verified green.
//
//  M1  Remove the occupancy filter (reschedule-slots.ts: `clear` always true)
//      → KILLED at [CONFLICT] "exact offer set around the booking" (the full
//        27-start Saturday came back) + [CONFLICT] "the booked start itself is
//        refused", and [AGREE] "the real occupancy gate accepts offered 09:45…"
//        — the gate refuses what the mutant offers.
//
//  M2  Remove the buffer (picker assembly: bufferMinutes: 0)
//      → KILLED at [BUFFER] "9:45 refused — … inside the 60-minute buffer" +
//        [BUFFER] "14:45 refused", and [AGREE] "set buffer: picker offers
//        exactly the in-window times the gate accepts (9 mismatches)".
//
//  M2b Buffer fallback diverges from the gate's (`Number(s.buffer_minutes) || 0`)
//      → KILLED at [AGREE] "unset buffer resolves to 15 in the picker" — and
//        nothing else. The set-buffer fixtures cannot see a fallback change.
//
//  M3  ★ Collapse the empty-day reasons into one ("No open times." for every
//      playing-day reason)
//      → KILLED at [EMPTY] "field closed", "field too short names its real
//        hours", "a window that misses the field's hours says so", "occupied by
//        bookings", "AA Wednesday line names the 5pm–5pm window", and [EMPTY]
//        "closed / too short / window / booked are four DISTINCT sentences",
//        with three reason counters at zero.
//
//  M4  Don't strip makeup flags
//      → KILLED at [MAKEUP] "no Friday is offered (got 77)" + "Friday reads as
//        a non-playing day"; makeupFlagStripped = 0.
//
//  M5  venueGames error fails OPEN (drop the `.error ||` — partial rows used)
//      → KILLED at [FAIL] "venueGames: refused as read_failed" — and nothing
//        else. That fixture carries an error WITH a row, the truncation shape;
//        an error with null data would have been caught by `!data` regardless.
//
//  M6  Mode keyed on is_away instead of venue_id
//      → KILLED at [MODE] "home game with no field → free-typed, no picker" +
//        [MODE] "keyed on venue_id, like the gate"; noVenueBranch = 0.
//
//  M7  Builder: case (d) collapsed back into (c) (`if (anyFits)` occupied)
//      → KILLED at [EMPTY] "AA Wednesday line names the 5pm–5pm window" +
//        [EMPTY] "nothing is called 'already booked' when nothing is booked";
//        zeroLengthWindowLive = 0. (Also M13 in sim:reschedule-slots.)
//
//  M8  The rainout modal's duration form (`Number(s.game_duration ?? 90)`)
//      → KILLED at [AGREE] "non-numeric duration falls back to 90 — slots still
//        offered, never NaN-empty" — and nothing else.
//
//  M9  The rainout modal's swallowed blackout error (drop `.error ||`)
//      → KILLED at [FAIL] "blackouts: refused as read_failed" — and nothing else.
//
// Not covered here, stated rather than implied: the Supabase queries themselves
// (resolve-edit-modal.tsx's loadPickerReads). The fake-supabase client does not
// model the projected-key embed or `.or()` on games; the embed was validated
// against live PostgREST (42501, not PGRST100/PGRST200) and the component only
// shapes each query's {data, error} into the reads this sim drives.
//
// Addendum 2026-09-15 — honest weekday roll-up + reason-derived header.
// +19 assertions ([MR1–MR6], [H1–H6]) and 6 counters; baseline 103 PASS.
// Criterion unchanged: killed only at the assertion written for it.
//
//  RU1 ★ Restore the single-reason roll-up (most common reason, credited with
//      every empty date of the weekday)
//      → KILLED at [MR1] (the live Mets lines revert to "(7 dates)"), [MR2],
//        [MR3], plus multiReasonWeekday/headlineNeutralMixed/occupiedBlameSplit = 0.
//        [H1]/[H6] also fail: the hidden reasons were what made those neutral.
//  RU2 Header always blames the field           → [H1][H1b][H4][H5][H6]
//  RU3 Multi-reason lines lose their per-reason counts → [MR1] only
//  RU4 reasonKey ignores who an occupied day is blamed on → [MR5] + occupiedBlameSplit=0
//  RU5 Team-side reasons counted as field-side  → [H4][H6] + headlineTeam=0
//  RU6 Ties ordered latest-first instead of earliest date → [MR4] only
//
// Rainout modal unchanged except where previously wrong — differential (not
// committed; scratchpad): the pre-change summarizeByWeekday (git HEAD) vs this
// one over the builder's diagnostics for 20,000 seeded 2-week fixtures (123,534
// empty weekdays) and 6,000 8-week fixtures (36,746; up to 4 reasons on one
// weekday). Every weekday with ONE reason: identical representative and count
// (112,998 + 27,842). Every weekday with SEVERAL: the old single row was wrong;
// the new per-reason counts sum exactly to the old total and the old reason's
// own count is smaller than what the old row claimed (10,536 + 8,904). 0
// mismatches. DiagnosticRow's text depends only on (diagnostic, dateCount,
// reasonsOnDay), and reasonsOnDay = 1 renders the pre-change text.
