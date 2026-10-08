// Harness for "Record where it was played" — the pure rules in
// src/lib/schedule/record-played.ts and the shared "today" in
// src/lib/utils/org-today.ts. The database side (record_game_played, 0106) is
// proven separately by scripts/sim/record-game-played-sim.sql.
//
// Runs under THREE host timezones (UTC, America/Los_Angeles,
// Pacific/Kiritimati): nothing here may depend on the machine's clock or zone.
// "Now" is always injected; every expected value is a literal.
//
// WHAT IT PINS
// - T: today is computed in the ORG's zone, not UTC and not the host's —
//   05:30Z on Oct 10 is Oct 9 in Los Angeles and Oct 10 in New York; a game's
//   date is its wall-clock date part.
// - O: which games offer the action — rained out or scheduled, original date
//   today or earlier; a future game, a completed one and a pending one don't.
//   Interleague past games DO offer it (the click explains).
// - R: the open-time refusal — interleague gets the plain sentence; other
//   statuses refused; an unreadable game fails closed.
// - D: the played date — tomorrow refused, today and earlier allowed, before
//   the season start refused, no season start refused.
// - C: conflicts are the manual move's sentences plus the official notice; an
//   official already on another overlapping game is named; one ending exactly
//   at the start is not; a failed officials read says "couldn't check".
// - V: conflicts NEVER disable Save; a refused date, a missing field or a
//   missing time do.
// - E: every refusal key record_game_played raises (read from the migration
//   file) has a sentence, and each sentence says nothing was saved; an unknown
//   error is never shown as success.
// - A: the RPC arguments carry the bare wall-clock string and the reason.
//
// ANTI-VACUITY: counters for an offered past rained-out game, an offered past
// scheduled game, a withheld future game, an official conflict found, a
// conflicting save that stayed enabled. A zero fails the run.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:record-played:mutants, all three zones).
//   RP1  today computed in UTC, not the org's zone             → [T1]
//   RP2  past-only rule dropped from the entry-point check     → [O3]
//   RP3  a conflict disables Save                              → [V1]
//   RP4  interleague check dropped from the open-time refusal  → [R1]
//   RP5  future played date no longer refused                  → [D1]
//   RP6  season-start rule dropped                             → [D3]
//   RP7  official candidate time parsed in the host's zone     → [C1]
//        (only distinguishable under America/Los_Angeles and Kiritimati —
//        under UTC the bare string and +00:00 are the same instant, which is
//        why the sim runs in three zones)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INTERLEAGUE_REFUSAL,
  RECORD_PLAYED_REFUSAL_KEYS,
  officialConflicts,
  playedDateRefusal,
  recordPlayedArgs,
  recordPlayedConflicts,
  recordPlayedErrorMessage,
  recordPlayedInfoLine,
  recordPlayedOffered,
  recordPlayedRefusal,
  recordPlayedSaveEnabled,
  type AssignedOfficial,
} from "../../src/lib/schedule/record-played";
import { parseManualDateTime } from "../../src/lib/schedule/manual-move";
import { isOnOrBeforeToday, todayInTimezone, wallClockDate } from "../../src/lib/utils/org-today";
import { parseAvailability } from "../../src/lib/venues/availability";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    fails++;
    console.log(`  FAIL: [CRASH-${name}] ${(e as Error).message}`);
  }
}

const counters = {
  offeredPastRainout: 0,
  offeredPastScheduled: 0,
  withheldFuture: 0,
  officialConflictFound: 0,
  conflictingSaveEnabled: 0,
};

const ROOT = join(__dirname, "../..");
const TODAY = "2026-10-08";

// ── T ─────────────────────────────────────────────────────────────────────────
section("T", () => {
  const t = new Date("2026-10-10T05:30:00Z");
  ok(todayInTimezone("America/Los_Angeles", t) === "2026-10-09", "[T1]",
    `05:30Z Oct 10 must be Oct 9 in Los Angeles, got ${todayInTimezone("America/Los_Angeles", t)}`);
  ok(todayInTimezone("America/New_York", t) === "2026-10-10", "[T2]", "and Oct 10 in New York");
  ok(todayInTimezone("Pacific/Honolulu", new Date("2026-10-10T09:59:00Z")) === "2026-10-09", "[T3]", "Honolulu at 09:59Z");
  ok(wallClockDate("2026-10-08T23:30:00+00:00") === "2026-10-08", "[T4]", "the date part, never the instant");
  ok(isOnOrBeforeToday("2026-10-08T23:30:00+00:00", "2026-10-08"), "[T5]", "a game late today is today");
  ok(!isOnOrBeforeToday("2026-10-09T00:30:00+00:00", "2026-10-08"), "[T6]", "a game just after midnight is tomorrow");
});

// ── O ─────────────────────────────────────────────────────────────────────────
section("O", () => {
  const past = "2026-10-04T10:00:00+00:00";
  const future = "2026-10-11T10:00:00+00:00";
  const rained = { status: "cancelled", interleague_org_id: null, scheduled_at: past };
  const sched = { status: "scheduled", interleague_org_id: null, scheduled_at: past };
  ok(recordPlayedOffered(rained, TODAY), "[O1]", "a past rained-out game offers it");
  if (recordPlayedOffered(rained, TODAY)) counters.offeredPastRainout++;
  ok(recordPlayedOffered(sched, TODAY), "[O2]", "a past scheduled game offers it");
  if (recordPlayedOffered(sched, TODAY)) counters.offeredPastScheduled++;
  const fut = { ...rained, scheduled_at: future };
  ok(!recordPlayedOffered(fut, TODAY), "[O3]", "a future game must not offer it");
  if (!recordPlayedOffered(fut, TODAY)) counters.withheldFuture++;
  ok(recordPlayedOffered({ ...sched, scheduled_at: `${TODAY}T18:00:00+00:00` }, TODAY), "[O4]", "a game today offers it");
  ok(!recordPlayedOffered({ ...sched, status: "completed" }, TODAY), "[O5]", "completed does not");
  ok(!recordPlayedOffered({ ...sched, status: "pending_interleague", interleague_org_id: "io" }, TODAY), "[O6]", "pending does not");
  ok(recordPlayedOffered({ ...rained, interleague_org_id: "io" }, TODAY), "[O7]",
    "a past interleague rainout still offers it (the click explains)");
});

// ── R ─────────────────────────────────────────────────────────────────────────
section("R", () => {
  const base = { scheduled_at: "2026-10-04T10:00:00+00:00" };
  ok(recordPlayedRefusal({ ...base, status: "scheduled", interleague_org_id: "io" }) === INTERLEAGUE_REFUSAL, "[R1]",
    "interleague must get the plain sentence");
  ok(INTERLEAGUE_REFUSAL === "Interleague games can't be corrected here yet.", "[R2]", "the decided wording");
  ok(recordPlayedRefusal({ ...base, status: "cancelled", interleague_org_id: null }) === null, "[R3]", "rained out allowed");
  ok(recordPlayedRefusal({ ...base, status: "scheduled", interleague_org_id: null }) === null, "[R4]", "scheduled allowed");
  ok((recordPlayedRefusal({ ...base, status: "completed", interleague_org_id: null }) ?? "").includes("completed"), "[R5]", "completed refused");
  ok((recordPlayedRefusal({ ...base, status: "reschedule_pending", interleague_org_id: null }) ?? "") !== "", "[R6]", "reschedule_pending refused");
  ok((recordPlayedRefusal(null) ?? "").startsWith("Couldn't confirm"), "[R7]", "an unreadable game fails closed");
});

// ── D ─────────────────────────────────────────────────────────────────────────
section("D", () => {
  ok(playedDateRefusal("2026-10-09", TODAY, "2026-09-01") !== null, "[D1]", "tomorrow must be refused");
  ok(playedDateRefusal(TODAY, TODAY, "2026-09-01") === null, "[D2]", "today allowed");
  ok(playedDateRefusal("2026-08-31", TODAY, "2026-09-01") === "That's before the season started (Tue, Sep 1).", "[D3]",
    `before the season start must be refused, got ${playedDateRefusal("2026-08-31", TODAY, "2026-09-01")}`);
  ok(playedDateRefusal("2026-09-01", TODAY, "2026-09-01") === null, "[D4]", "the start date itself allowed");
  ok((playedDateRefusal("2026-10-01", TODAY, null) ?? "").includes("no start date"), "[D5]", "no season start refused");
  ok(recordPlayedInfoLine("cancelled").endsWith("and the rainout is cleared."), "[D6]", "rained-out info line");
  ok(!recordPlayedInfoLine("scheduled").includes("rainout"), "[D7]", "a scheduled game has no rainout to clear");
});

// ── C ─────────────────────────────────────────────────────────────────────────
const when = parseManualDateTime("2026-10-06", "17:30")!;
const field = {
  label: "Monroe Complex — Andrews",
  availabilityConfigured: true,
  availability: parseAvailability({ Mo: { start: "16:00", end: "21:00" }, Sa: { start: "08:00", end: "20:00" } }),
};
function booking(id: string, at: string, mins: number) {
  return { id, scheduled_at: at, duration_minutes: mins, home_team_name: "Rays", away_team_name: "Mets" };
}

section("C", () => {
  const officials: AssignedOfficial[] = [
    { name: "Pat Ump", bookings: [booking("g-other", "2026-10-06T17:00:00+00:00", 90)] },
    { name: "Lee Ump", bookings: [booking("g-early", "2026-10-06T16:00:00+00:00", 90)] },
    { name: "Sam Ump", bookings: [booking("g-self", "2026-10-06T17:30:00+00:00", 90)] },
  ];
  const oc = officialConflicts({ gameId: "g-self", when, durationMin: 90, officials });
  const texts = oc.map((c) => c.text);
  ok(texts.some((t) => t === "Pat Ump is already officiating Rays vs Mets at 5:00 PM that day."), "[C1]",
    `the overlapping official must be named, got ${JSON.stringify(texts)}`);
  if (oc.some((c) => c.kind === "official_busy")) counters.officialConflictFound++;
  ok(!texts.some((t) => t.startsWith("Lee Ump")), "[C2]", "a game ending exactly at the start does not conflict");
  ok(!texts.some((t) => t.startsWith("Sam Ump")), "[C3]",
    "this game itself is never a conflict");
  const failed = officialConflicts({ gameId: "g-self", when, durationMin: 90, officials: [{ name: "Pat Ump", bookings: null }] });
  ok(failed.length === 1 && failed[0].kind === "unchecked" && failed[0].text === "Couldn't check whether Pat Ump is free then.", "[C4]",
    "a failed officials read says couldn't check");

  const all = recordPlayedConflicts({
    when, durationMin: 90, bufferMin: 15, divisionName: "Minors", playingDays: ["Sa"], blackoutDates: new Set(),
    venue: field,
    venueGames: [{ startMin: 17 * 60 + 30, durationMin: 90, label: "8U: Rays vs Mets" }],
    teamGames: [],
    gameId: "g-self",
    officials,
  });
  const kinds = all.map((c) => c.kind);
  ok(kinds.includes("venue_booked") && kinds.includes("non_playing_day") && kinds.includes("official_busy"), "[C5]",
    `manual-move notices plus the official one, got ${JSON.stringify(kinds)}`);
  ok(all.some((c) => c.text === "Monroe Complex — Andrews is booked 5:30 PM–7:00 PM (8U: Rays vs Mets)."), "[C6]",
    "the manual move's sentence, verbatim");

  // V — conflicts never block.
  const enabled = recordPlayedSaveEnabled({ when, venueChosen: true, dateRefusal: null, saving: false, conflicts: all });
  ok(enabled, "[V1]", "a save with conflicts must stay enabled");
  if (enabled && all.length > 0) counters.conflictingSaveEnabled++;
  ok(!recordPlayedSaveEnabled({ when, venueChosen: true, dateRefusal: "x", saving: false, conflicts: [] }), "[V2]", "a refused date disables Save");
  ok(!recordPlayedSaveEnabled({ when, venueChosen: false, dateRefusal: null, saving: false, conflicts: [] }), "[V3]", "no field disables Save");
  ok(!recordPlayedSaveEnabled({ when: null, venueChosen: true, dateRefusal: null, saving: false, conflicts: [] }), "[V4]", "no time disables Save");
  ok(!recordPlayedSaveEnabled({ when, venueChosen: true, dateRefusal: null, saving: true, conflicts: null }), "[V5]", "saving disables Save");
});

// ── E ─────────────────────────────────────────────────────────────────────────
section("E", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/0106_record_game_played.sql"), "utf8");
  const raised = [...new Set([...sql.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))];
  ok(raised.length >= 10, "[E0]", `found ${raised.length} refusal keys in 0106`);
  const missing = raised.filter((k) => !RECORD_PLAYED_REFUSAL_KEYS.includes(k));
  ok(missing.length === 0, "[E1]", `refusal keys with no sentence: ${missing.join(", ")}`);
  for (const k of raised) {
    const msg = recordPlayedErrorMessage(`ERROR: ${k}`);
    if (k !== "interleague_not_supported") ok(msg.includes("Nothing was saved."), "[E2]", `${k} → ${msg}`);
  }
  ok(recordPlayedErrorMessage("interleague_not_supported") === INTERLEAGUE_REFUSAL, "[E3]", "interleague refusal sentence");
  ok(recordPlayedErrorMessage("network down").startsWith("Nothing was saved."), "[E4]", "an unknown error is never success");
});

// ── A ─────────────────────────────────────────────────────────────────────────
section("A", () => {
  const a = recordPlayedArgs({ gameId: "g1", when, venueId: "v1", reason: "Moved after the rain" });
  ok(a.p_scheduled_at === "2026-10-06T17:30:00" && a.p_game_id === "g1" && a.p_venue_id === "v1" && a.p_reason === "Moved after the rain",
    "[A1]", JSON.stringify(a));
});

for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
console.log(`TZ=${process.env.TZ ?? "(host)"}  ${checks - fails}/${checks} checks passed`);
console.log(`counters: ${JSON.stringify(counters)}`);
process.exit(fails ? 1 : 0);
