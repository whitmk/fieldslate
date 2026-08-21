// Makeup days — proof harness.
//
// Two halves, and the FIRST one is the one that matters:
//
//   1. GENERATION MUST BE BYTE-IDENTICAL. A `makeup` flag lives in
//      `venues.availability`, which the GAME GENERATOR reads for venue hours.
//      That is the whole hazard: unlike a division-level list, this flag sits
//      inside a jsonb the generator already parses. So the golden asserts the
//      real generator produces the IDENTICAL placement with and without
//      `makeup: true` on every venue day — not "no games on Friday", IDENTICAL,
//      because a changed slot pool shifts placement everywhere even when
//      nothing lands on the flagged day. Reports supply and scarcity ordering
//      are asserted identical for the same reason.
//
//   2. The picker offers makeup days, and the three empty-state cases are
//      really distinguished rather than merely written.
//
// TZ=UTC is mandatory (client-timezone date math), matching the other sims.

import {
  parseAvailability,
  isMakeupDay,
  venueDayFit,
  isVenueAvailable,
  type VenueAvailability,
} from "@/lib/venues/availability";
import {
  buildSlotsAndDiagnostics,
  buildAvailableSlots,
  type BuildAvailableSlotsParams,
  type OccupiedSpan,
} from "@/lib/schedule/reschedule-slots";
import { buildSlots, buildPlayingDates, type DivisionSettings } from "@/lib/schedule/slots";
import { generateSchedule } from "@/lib/schedule/generate-schedule";
import { scarcityOrderedIds } from "@/lib/schedule/scarcity-order";
import { FakeClient, type Db } from "./fake-supabase";

if (new Date("2026-08-15T00:00:00Z").getTimezoneOffset() !== 0) {
  console.error("This harness must run with TZ=UTC. Use `npm run sim:makeup-days`.");
  process.exit(1);
}

let checks = 0;
let fails = 0;
function assert(cond: boolean, msg: string) {
  checks++;
  if (!cond) { console.log("  FAIL:", msg); fails++; }
}

const counters = {
  makeupFlaggedVenueDays: 0,
  slotsOfferedOnMakeupDay: 0,
  generatorPlacementsAttemptedOnMakeupDate: 0,
  caseNoField: 0,
  caseWindowTooShort: 0,
  caseOccupied: 0,
  playingDayUnchangedComparisons: 0,
  goldenPlacementsCompared: 0,
  closedButFlaggedFieldsChecked: 0,
  shortButFlaggedFieldsChecked: 0,
};

async function main() {
  // ════════════════════════════════════════════════════════════════════════════
  // PART 1 — GENERATION GOLDEN
  // ════════════════════════════════════════════════════════════════════════════

  const LEAGUE_ID = "league-1";
  const DIVISION_ID = "div-1";
  const START_DATE = "2026-08-01";
  const END_DATE = "2026-10-10";
  const teamId = (i: number) => `team-${i}`;

  /** Every venue open every day. `withMakeup` flips the flag ON for EVERY day at
   *  EVERY venue — the maximally hostile input for the invisibility claim. */
  function buildDb(withMakeup: boolean): FakeClient {
    const db: Db = {
      leagues: [{ id: LEAGUE_ID, name: "S", start_date: START_DATE, end_date: END_DATE }],
      divisions: [], teams: [], venues: [], division_venues: [], games: [],
      team_game_constraints: [], blackout_dates: [], division_interleague_games: [],
      interleague_orgs: [], umpires: [], game_umpires: [], practice_slots: [],
    } as unknown as Db;

    db.divisions.push({
      id: DIVISION_ID, league_id: LEAGUE_ID, name: "Majors",
      start_date: START_DATE, end_date: END_DATE,
      intra_division_games_per_team: 8,
      settings: {
        games_per_team: 8, max_games_per_week: 1, max_games_per_team_per_day: 1,
        playing_days: ["Sa"], earliest_start: "09:00", latest_start: "17:00",
        game_duration: 90, buffer_minutes: 15, max_games_per_field_per_day: 6,
        bye_weeks: 0, auto_rotate: true,
        teams: Array.from({ length: 6 }, (_, i) => ({
          name: `Team ${i}`, has_coach_conflict: false,
          conflict_division: "", conflict_team: "",
        })),
      },
    });

    const days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    for (let vi = 0; vi < 3; vi++) {
      const availability: Record<string, Record<string, unknown>> = {};
      for (const d of days) {
        availability[d] = { start: "07:00", end: "22:00", practice: true };
        if (withMakeup) {
          availability[d].makeup = true;
          counters.makeupFlaggedVenueDays++;
        }
      }
      db.venues.push({ id: `venue-${vi}`, name: `Field ${vi}`, availability, availability_configured: true });
      db.division_venues.push({ division_id: DIVISION_ID, venue_id: `venue-${vi}`, allow_games: true });
    }
    for (let ti = 0; ti < 6; ti++) {
      db.teams.push({ id: teamId(ti), league_id: LEAGUE_ID, division_id: DIVISION_ID, name: `Team ${ti}` });
    }
    return new FakeClient(db);
  }

  /** A stable, order-independent fingerprint of what the generator actually
   *  placed. Sorted so a shuffle inside the engine cannot masquerade as identity
   *  — and so a real placement difference cannot hide behind ordering noise. */
  function placementFingerprint(client: FakeClient): string {
    const rows = (client.db.games as Record<string, unknown>[])
      .map((g) => `${g.scheduled_at}|${g.venue_id}|${g.home_team_id}|${g.away_team_id}|${g.status}`)
      .sort();
    return rows.join("\n");
  }

  // THE GENERATOR SHUFFLES WITH Math.random (generate-schedule.ts:165), so two
  // runs differ from each other no matter what the makeup flag does. A golden
  // that did not pin it would be comparing NOISE — it would fail forever while
  // proving nothing about this feature, which is the same "the assertion is not
  // testing what it claims" failure as a vacuous counter, just inverted.
  //
  // Both runs are therefore given the SAME deterministic sequence. That does not
  // weaken the comparison: it removes the one confounder, so any surviving
  // difference IS the flag. (Pinned per RUN, not per call, so the engine still
  // consumes randomness in its natural order.)
  const realRandom = Math.random;
  function seeded(seed: number): () => number {
    let x = seed >>> 0;
    return () => {
      // xorshift32 — small, dependency-free, identical on every engine.
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      return x / 0x100000000;
    };
  }

  const plainClient = buildDb(false);
  Math.random = seeded(0xC0FFEE);
  const plainRes = await generateSchedule(DIVISION_ID, plainClient.asClient());
  const makeupClient = buildDb(true);
  Math.random = seeded(0xC0FFEE);
  const makeupRes = await generateSchedule(DIVISION_ID, makeupClient.asClient());
  Math.random = realRandom;

  // Sanity: the pinning itself works. Two identical runs under the same seed
  // must agree — otherwise the golden below would be vacuous in the other
  // direction, passing because both sides are equally arbitrary.
  const pinCheckA = buildDb(false);
  Math.random = seeded(0xBEEF);
  await generateSchedule(DIVISION_ID, pinCheckA.asClient());
  const pinCheckB = buildDb(false);
  Math.random = seeded(0xBEEF);
  await generateSchedule(DIVISION_ID, pinCheckB.asClient());
  Math.random = realRandom;

  assert(plainRes.success, `baseline generation must succeed: ${plainRes.success ? "" : plainRes.error}`);
  assert(makeupRes.success, `makeup-flagged generation must succeed: ${makeupRes.success ? "" : makeupRes.error}`);
  assert(
    placementFingerprint(pinCheckA) === placementFingerprint(pinCheckB),
    "seed pinning works: two identical runs under one seed agree (without this " +
      "the golden below could pass for the wrong reason)",
  );

  const plainPrint = placementFingerprint(plainClient);
  const makeupPrint = placementFingerprint(makeupClient);
  counters.goldenPlacementsCompared = plainPrint.split("\n").filter(Boolean).length;

  assert(counters.goldenPlacementsCompared > 0, "golden compared a NON-EMPTY placement set");
  assert(
    plainPrint === makeupPrint,
    `GOLDEN: placement must be byte-identical with and without makeup flags ` +
      `(${plainPrint.split("\n").length} vs ${makeupPrint.split("\n").length} rows)`,
  );
  assert(
    plainRes.success && makeupRes.success &&
      plainRes.gamesCreated === makeupRes.gamesCreated,
    "golden: identical gamesCreated with and without makeup flags",
  );

  // No regular-season game may land on a non-playing day, flags or not.
  const placedDows = new Set(
    (makeupClient.db.games as Record<string, unknown>[]).map((g) =>
      new Date(String(g.scheduled_at).substring(0, 10) + "T00:00:00").getDay(),
    ),
  );
  counters.generatorPlacementsAttemptedOnMakeupDate =
    (makeupClient.db.games as unknown[]).length;
  assert(
    placedDows.size === 1 && placedDows.has(6),
    `generator placed only on Saturday; saw dows ${[...placedDows].join(",")}`,
  );

  // ── Slot pool, Reports supply, scarcity ordering ────────────────────────────
  const SETTINGS: DivisionSettings = {
    playing_days: ["Sa"], earliest_start: "09:00", latest_start: "17:00",
    game_duration: 90, buffer_minutes: 15, max_games_per_field_per_day: 6,
    bye_weeks: 0,
  } as DivisionSettings;

  function avail(withMakeup: boolean): VenueAvailability {
    const raw: Record<string, Record<string, unknown>> = {};
    for (const d of ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]) {
      raw[d] = { start: "07:00", end: "22:00", practice: true };
      if (withMakeup) raw[d].makeup = true;
    }
    return parseAvailability(raw);
  }

  const mapPlain = new Map([["v1", avail(false)]]);
  const mapMakeup = new Map([["v1", avail(true)]]);

  assert(
    JSON.stringify(buildPlayingDates(START_DATE, END_DATE, SETTINGS)) ===
      JSON.stringify(buildPlayingDates(START_DATE, END_DATE, SETTINGS)),
    "buildPlayingDates is deterministic",
  );
  // SECOND GOLDEN SHAPE — a field CLOSED on the division's playing day but
  // makeup-flagged on another. The first shape (every field open every day)
  // cannot detect a leak at the `isVenueAvailable` level, because the date list
  // still comes from buildPlayingDates and every date already had an open
  // field. This shape can: if a makeup flag ever made a CLOSED day read as
  // open, the Saturday pool would gain slots at a field that is shut.
  const closedOnPlayingDay = new Map([
    ["vShut", parseAvailability({ Fr: { start: "16:30", end: "21:00", makeup: true } })],
  ]);
  const shutPool = buildSlots(START_DATE, END_DATE, SETTINGS, ["vShut"], closedOnPlayingDay);
  assert(
    shutPool.length === 0,
    `a field shut on the playing day contributes NO slots however it is ` +
      `makeup-flagged (got ${shutPool.length})`,
  );
  counters.closedButFlaggedFieldsChecked++;

  // THIRD GOLDEN SHAPE — a field OPEN on the playing day but with a window too
  // short for the game, AND makeup-flagged that same day. This is the only
  // shape that catches a leak at the `isVenueAvailable` level: the day is in
  // the date list and the flag is present on it, so if the flag ever
  // short-circuited the window check, this field would start contributing a
  // full day of slots it cannot host. The two shapes above cannot see that —
  // one has every field open all day, the other has no window on the tested day
  // at all, so the mutant's branch never fires in either.
  const shortAndFlagged = new Map([
    ["vShort", parseAvailability({ Sa: { start: "09:00", end: "10:00", makeup: true } })],
  ]);
  const shortPool = buildSlots(START_DATE, END_DATE, SETTINGS, ["vShort"], shortAndFlagged);
  assert(
    shortPool.length === 0,
    `a field whose window is too short contributes NO slots even when the same ` +
      `day is makeup-flagged (got ${shortPool.length}) — the flag must never ` +
      `short-circuit the window check the generator relies on`,
  );
  counters.shortButFlaggedFieldsChecked++;

  const poolPlain = buildSlots(START_DATE, END_DATE, SETTINGS, ["v1"], mapPlain);
  const poolMakeup = buildSlots(START_DATE, END_DATE, SETTINGS, ["v1"], mapMakeup);
  assert(poolPlain.length > 0, "slot pool is non-empty (anti-vacuity for the pool golden)");
  assert(
    JSON.stringify(poolPlain) === JSON.stringify(poolMakeup),
    `GOLDEN: buildSlots pool identical (${poolPlain.length} vs ${poolMakeup.length}) — ` +
      `this is what Reports field utilization counts as supply`,
  );

  const scarcityInput = (m: Map<string, VenueAvailability>) => [{
    id: DIVISION_ID, name: "Majors", created_at: "2026-01-01",
    start_date: START_DATE, end_date: END_DATE,
    settings: SETTINGS, teamCount: 6, venueIds: ["v1"], venueAvailability: m,
  }];
  assert(
    JSON.stringify(scarcityOrderedIds(scarcityInput(mapPlain) as never)) ===
      JSON.stringify(scarcityOrderedIds(scarcityInput(mapMakeup) as never)),
    "GOLDEN: scarcity ordering identical with and without makeup flags",
  );

  // ════════════════════════════════════════════════════════════════════════════
  // PART 2 — THE PICKER
  // ════════════════════════════════════════════════════════════════════════════

  // Sat 2026-08-15 .. Fri 2026-08-21. Division plays Saturday only.
  const P_START = "2026-08-15";
  const P_END = "2026-08-21";
  const VEN = "vA";
  const VEN2 = "vB";


  function pickerParams(over: Partial<BuildAvailableSlotsParams> = {}): BuildAvailableSlotsParams {
    return {
      startDate: P_START, endDate: P_END,
      playingDays: ["Sa"],
      dayWindows: { Sa: { start: "10:00", end: "18:00" } },
      earliestStart: "10:00", latestStart: "18:00",
      gameDuration: 105, bufferMinutes: 30, maxPerTeamDay: 1,
      venueIds: [VEN],
      venueNames: { [VEN]: "Andrews", [VEN2]: "Perry" },
      venueAvailability: {
        [VEN]: parseAvailability({
          Sa: { start: "08:00", end: "20:00", practice: true },
          Fr: { start: "16:30", end: "21:00", practice: true, makeup: true },
        }),
      },
      blackoutDates: new Set<string>(),
      venueBookings: new Map<string, OccupiedSpan[]>(),
      homeTeamSpans: new Map(), awayTeamSpans: new Map(),
      homeTeamDayCounts: new Map(), awayTeamDayCounts: new Map(),
      homeTeamId: "h", awayTeamId: "a",
      constraintRules: new Map(),
      today: P_START,
      ...over,
    };
  }

  const base = buildSlotsAndDiagnostics(pickerParams());
  const friSlots = base.slots.filter((s) => s.date === "2026-08-21");
  const satSlots = base.slots.filter((s) => s.date === "2026-08-15");
  counters.slotsOfferedOnMakeupDay += friSlots.length;

  assert(friSlots.length > 0, "MAKEUP DAY OFFERS SLOTS — Friday now has candidates");
  assert(satSlots.length > 0, "the normal playing day still offers slots");

  // Venue hours govern on a makeup day: 16:30 open, 105-min game, last start 19:15.
  const friTimes = friSlots.map((s) => s.isoString.substring(11, 16)).sort();
  assert(friTimes[0] === "16:30", `makeup day anchors at the VENUE open time, got ${friTimes[0]}`);
  assert(
    friTimes[friTimes.length - 1] === "19:15",
    `makeup day last start = venue close minus span (19:15), got ${friTimes[friTimes.length - 1]}`,
  );
  assert(
    !friTimes.some((t) => t < "16:30"),
    "the division's 10:00 window is NOT consulted on a makeup day",
  );

  // A playing day is byte-identical to a run with no makeup flags anywhere.
  const noMakeup = buildAvailableSlots(pickerParams({
    venueAvailability: {
      [VEN]: parseAvailability({ Sa: { start: "08:00", end: "20:00", practice: true } }),
    },
  }));
  const satOnlyBase = base.slots.filter((s) => s.date === "2026-08-15").map((s) => s.isoString + s.venueId);
  const satOnlyNo = noMakeup.filter((s) => s.date === "2026-08-15").map((s) => s.isoString + s.venueId);
  counters.playingDayUnchangedComparisons = satOnlyBase.length;
  assert(satOnlyBase.length > 0, "playing-day comparison is non-empty (anti-vacuity)");
  assert(
    JSON.stringify(satOnlyBase) === JSON.stringify(satOnlyNo),
    "a PLAYING day is unchanged by the presence of makeup flags",
  );
  assert(
    !noMakeup.some((s) => s.date === "2026-08-21"),
    "with no makeup flag, Friday offers nothing (the pre-feature behavior)",
  );

  // A venue open on the makeup day but NOT flagged must not participate.
  const twoVenues = buildAvailableSlots(pickerParams({
    venueIds: [VEN, VEN2],
    venueAvailability: {
      [VEN]: parseAvailability({
        Sa: { start: "08:00", end: "20:00", practice: true },
        Fr: { start: "16:30", end: "21:00", practice: true, makeup: true },
      }),
      // Perry is OPEN Friday but NOT flagged — it was never offered for makeups.
      [VEN2]: parseAvailability({ Fr: { start: "16:30", end: "21:00", practice: true } }),
    },
  }));
  assert(
    twoVenues.filter((s) => s.date === "2026-08-21").every((s) => s.venueId === VEN),
    "an open-but-UNFLAGGED field does not participate on a makeup day",
  );

  // Blackout composes with the makeup day rather than cancelling it.
  const blacked = buildSlotsAndDiagnostics(pickerParams({
    blackoutDates: new Set(["2026-08-21"]),
  }));
  assert(
    !blacked.slots.some((s) => s.date === "2026-08-21"),
    "a blackout still wins on a makeup day (the two subtractions compose)",
  );
  assert(
    blacked.diagnostics.get("2026-08-21")?.kind === "blackout",
    "a blacked-out makeup day is reported as a blackout, not as a missing field",
  );

  // ── The three cases ─────────────────────────────────────────────────────────

  // (a) Sunday: not a playing day, no field open and flagged.
  const dSun = base.diagnostics.get("2026-08-16");
  assert(dSun?.kind === "no_field", `CASE (a): Sunday → no_field, got ${dSun?.kind}`);
  if (dSun?.kind === "no_field") counters.caseNoField++;

  // (b) Friday flagged, window 16:30-18:00 (90 min) but the game needs 105.
  const shortWin = buildSlotsAndDiagnostics(pickerParams({
    venueAvailability: {
      [VEN]: parseAvailability({
        Sa: { start: "08:00", end: "20:00", practice: true },
        Fr: { start: "16:30", end: "18:00", practice: true, makeup: true },
      }),
    },
  }));
  const dShort = shortWin.diagnostics.get("2026-08-21");
  assert(
    dShort?.kind === "window_too_short",
    `CASE (b): open+flagged but too short → window_too_short, got ${dShort?.kind}`,
  );
  if (dShort?.kind === "window_too_short") {
    counters.caseWindowTooShort++;
    assert(
      dShort.venues.length === 1 && dShort.venues[0].venueName === "Andrews" &&
        dShort.venues[0].start === "16:30" && dShort.venues[0].end === "18:00",
      "case (b) NAMES the field and its real hours, so the message can be specific",
    );
  }
  assert(
    dShort?.kind !== "no_field",
    "CASE (b) MUST NOT report as (a) — that would tell an admin to add hours to a field that has them",
  );

  // (c) Friday flagged and wide enough, but every candidate is booked.
  const occupiedBookings = new Map<string, OccupiedSpan[]>([
    ["vA:2026-08-21", [{ startMin: 16 * 60, durationMin: 5 * 60 }]],
  ]);
  const occ = buildSlotsAndDiagnostics(pickerParams({ venueBookings: occupiedBookings }));
  const dOcc = occ.diagnostics.get("2026-08-21");
  assert(dOcc?.kind === "occupied", `CASE (c): all booked → occupied, got ${dOcc?.kind}`);
  if (dOcc?.kind === "occupied") {
    counters.caseOccupied++;
    assert(
      dOcc.venueBookingRejections > 0,
      "case (c) counted the venue-booking rejections it actually saw",
    );
  }

  // A day that PRODUCED slots carries no diagnostic at all.
  assert(
    !base.diagnostics.has("2026-08-15"),
    "a day with slots has no diagnostic (only empty days are explained)",
  );
  assert(
    !base.diagnostics.has("2026-08-21"),
    "the makeup day produced slots, so it is not reported as empty",
  );

  // ── Shared-predicate checks (the no-drift requirement) ──────────────────────
  const wideAv = parseAvailability({ Fr: { start: "16:30", end: "21:00", makeup: true } });
  assert(venueDayFit(wideAv, "Fr", 105) === "fits", "venueDayFit: wide window fits");
  assert(venueDayFit(wideAv, "Sa", 105) === "closed", "venueDayFit: absent day is closed");
  assert(
    venueDayFit(parseAvailability({ Fr: { start: "16:30", end: "18:00" } }), "Fr", 105) === "too_short",
    "venueDayFit: open but short is too_short, NOT closed",
  );
  assert(
    isVenueAvailable(wideAv, "Fr", "19:15", 105) && !isVenueAvailable(wideAv, "Fr", "19:30", 105),
    "isVenueAvailable still enforces must-END-by, unchanged",
  );

  // ── Defaults ────────────────────────────────────────────────────────────────
  const noKey = parseAvailability({ Sa: { start: "09:00", end: "17:00" } });
  assert(noKey.Sa?.makeup === false, "ABSENT makeup parses FALSE (opposite of practice)");
  assert(noKey.Sa?.practice === true, "ABSENT practice still parses TRUE — the defaults are inverted");
  assert(!isMakeupDay(noKey, "Sa"), "isMakeupDay: absent means NO");
  assert(
    !isMakeupDay(parseAvailability({ Sa: { start: "09:00", end: "17:00", makeup: false } }), "Sa"),
    "isMakeupDay: explicit false means NO",
  );
  assert(
    isMakeupDay(parseAvailability({ Sa: { start: "09:00", end: "17:00", makeup: true } }), "Sa"),
    "isMakeupDay: explicit true means YES",
  );
  assert(
    !isMakeupDay(parseAvailability({}), "Sa"),
    "isMakeupDay: a CLOSED day is never a makeup day",
  );

  // ── Counters ────────────────────────────────────────────────────────────────
  console.log("  counters:", JSON.stringify(counters));
  let zero = 0;
  for (const [name, n] of Object.entries(counters)) {
    checks++;
    if (n === 0) {
      console.log(`  VACUOUS: counter '${name}' is ZERO — the assertions that depend on it proved nothing`);
      zero++; fails++;
    }
  }

  console.log(
    fails === 0
      ? `  ALL PASS — ${checks} assertions, ${Object.keys(counters).length} counters all non-zero`
      : `  ${fails} FAILED (${zero} vacuous) of ${checks}`,
  );
  process.exit(fails === 0 ? 0 : 1);

}

void main();
