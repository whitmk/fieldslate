// Team calendar feed (.ics) — drives the REAL buildTeamCalendarIcs, which
// calls the REAL shared normalizeExportGames.
//
// RUN UNDER THREE HOST TIMEZONES (npm run sim:team-calendar does UTC,
// America/Los_Angeles and Pacific/Kiritimati). It deliberately does NOT pin
// TZ: host-independence is the headline assertion. Every expected value is a
// LITERAL, so a result that shifts with the host zone fails instead of
// quietly agreeing with itself.
//
//   P  pending interleague games are never in the feed
//   C  cancelled games stay, titled "CANCELLED: …", STATUS:CANCELLED
//   T  start/end are the stored wall-clock time, labelled, never converted;
//      end = start + game duration; unusable duration → start only
//   Z  the org's timezone labels every event; unsupported zone → refused
//   U  UID is stable when a game moves
//   I  interleague titles and locations (shared rules)
//   X  escaping, CRLF, 75-octet folding, multi-byte safety
//   L  LEAK: fixtures carry a planted game note, coach name/email, contact
//      email, official and score; none may appear, and every property name
//      in the output must be on the allowlist
//   M  last-change stamps
//   G  one whole event, literally
//
// A section that THROWS is recorded as [CRASH-…] and the run goes on, so
// collected failures are always printed. Anti-vacuity counters at the end: a
// zero counter fails the run.
//
// MUTATION LOG (2026-09-29) — `npm run sim:team-calendar:mutants`, each
// applied to the real source, each required to die FIRST at its own tag:
//   TC1  start time converted through Date (host-local)        → [T1]
//        (SURVIVES under TZ=UTC by construction — local equals UTC there.
//         Only the non-UTC runs kill it; that is why this sim runs in three
//         zones. Do not reduce it to one.)
//   TC2  UID built from the start time                          → [U1]
//        (first died at [C0]: the sim looked events up BY UID, so every
//         lookup missed. Lookups now go by opponent name.)
//   TC3  cancelled title not prefixed                           → [C1]
//   TC4  cancelled games not kept                               → [C0]
//        (first died at a general event-count check in P; the count moved to
//         [C5], after the assertion that owns this rule.)
//   TC5  game note written into DESCRIPTION                     → [L1]
//   TC6  comma escaping removed                                 → [X1]
//   TC7  line folding removed                                   → [X3]
//   TC8  end time includes 15 extra minutes (a buffer)          → [T2]
//   TC9  unusable duration becomes 0 instead of "start only"    → [T5]
//   TC10 event timezone hardcoded to Pacific                    → [Z2]
//   TC11 unsupported timezone falls back instead of refusing    → [Z4]
//   TC12 shared selection lets pending games through            → [P1]
//   TC13 builder throws (crash reporting)                       → [CRASH-P]
//   TC14 location prints the bare field, dropping the park      → [I4]

import {
  buildTeamCalendarIcs,
  gameUid,
  type TeamCalendarGame,
  type TeamCalendarInput,
} from "../../src/lib/calendar/team-calendar-ics";
import { ORG_TIMEZONES } from "../../src/lib/calendar/timezones";

const failures: string[] = [];
function assert(cond: boolean, tag: string, label: string) {
  if (cond) console.log(`  ok: [${tag}] ${label}`);
  else {
    failures.push(`[${tag}] ${label}`);
    console.error(`  FAIL: [${tag}] ${label}`);
  }
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[CRASH-${name}] section threw: ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] section threw: ${msg}`);
  }
}
const counters: Record<string, number> = {};
const count = (name: string, n = 1) => { counters[name] = (counters[name] ?? 0) + n; };

// ── Fixtures (test names only). Every game carries PLANTED fields the feed
//    must never emit — as if the reader had leaked them. ─────────────────────
const PLANTED = {
  notes: "PLANTED-NOTE lights out on field 2",
  coach_name: "PLANTED-COACH Pat Example",
  coach_email: "planted-coach@example.test",
  contact_email: "planted-contact@example.test",
  umpire_name: "PLANTED-UMPIRE Sam Example",
  home_score: 987654,
};
const PLANTED_STRINGS = [
  "PLANTED", "planted-coach@example.test", "planted-contact@example.test", "987654", "lights out",
];

function g(p: Partial<TeamCalendarGame> & { id: string; scheduled_at: string }): TeamCalendarGame {
  return {
    status: "scheduled",
    is_away: false,
    external_team_name: null,
    proposed_venue_name: null,
    home_team: { name: "QA Tigers" },
    away_team: { name: "QA Bears" },
    venue: { name: "QA-Memorial", location: null },
    updated_at: "2026-09-20T17:45:30.123456+00:00",
    ...(PLANTED as object),
    ...p,
  } as TeamCalendarGame;
}
const at = (d: string, t: string) => `${d}T${t}:00+00:00`;

const GAMES: TeamCalendarGame[] = [
  g({ id: "n1", scheduled_at: at("2026-10-24", "09:00") }),
  g({ id: "n2", scheduled_at: at("2026-10-24", "13:30"), away_team: { name: "QA Owls" },
      venue: { name: "Field 2", location: { name: "QA Park" } } }),
  g({ id: "ih", scheduled_at: at("2026-10-31", "10:00"), away_team: null, external_team_name: "Riverside Reds" }),
  g({ id: "ia1", scheduled_at: at("2026-11-07", "15:30"), away_team: null, is_away: true,
      external_team_name: "Riverside Blues", venue: null, proposed_venue_name: "Riverside Field 1" }),
  g({ id: "ia2", scheduled_at: at("2026-11-08", "10:00"), away_team: null, is_away: true,
      external_team_name: "Riverside Greens", venue: null }),
  g({ id: "p1", scheduled_at: at("2026-11-14", "09:00"), status: "pending_interleague", away_team: null }),
  g({ id: "p2", scheduled_at: at("2026-11-14", "11:00"), status: "pending_interleague", away_team: null,
      external_team_name: "Riverside Golds", proposed_venue_name: "Riverside Field 9" }),
  g({ id: "x", scheduled_at: at("2026-11-15", "09:00"), status: "cancelled", away_team: { name: "QA Hawks" } }),
  g({ id: "rp", scheduled_at: at("2026-11-21", "09:00"), status: "reschedule_pending", away_team: null,
      external_team_name: "Riverside Silvers" }),
  g({ id: "late", scheduled_at: at("2026-12-31", "23:00"), away_team: { name: "QA Night" } }),
];

function input(over: Partial<TeamCalendarInput> = {}): TeamCalendarInput {
  return {
    team: { name: "QA Tigers" },
    division: { name: "QA-Minors", game_duration: 105 },
    season: { name: "QA Fall 2026" },
    org: { timezone: "America/Los_Angeles" },
    games: GAMES,
    ...over,
  };
}

// ── Reading the output ───────────────────────────────────────────────────────
type Event = { lines: string[]; get: (name: string) => string | undefined; line: (name: string) => string | undefined };
function parse(ics: string): { head: string[]; events: Event[]; unfolded: string } {
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  const all = unfolded.split("\r\n").filter((l) => l.length > 0);
  const events: Event[] = [];
  const head: string[] = [];
  let cur: string[] | null = null;
  for (const l of all) {
    if (l === "BEGIN:VEVENT") cur = [];
    else if (l === "END:VEVENT" && cur) {
      const lines = cur;
      const line = (name: string) => lines.find((x) => x.startsWith(name + ":") || x.startsWith(name + ";"));
      events.push({ lines, line, get: (name) => { const x = line(name); return x === undefined ? undefined : x.substring(x.indexOf(":") + 1); } });
      cur = null;
    } else if (cur) cur.push(l);
    else head.push(l);
  }
  return { head, events, unfolded };
}
function build(over: Partial<TeamCalendarInput> = {}) {
  const r = buildTeamCalendarIcs(input(over));
  if (!r.ok) throw new Error("builder refused: " + r.error);
  return { ...r, ...parse(r.ics) };
}
// Events are found by the OPPONENT's name (unique per fixture), never by UID,
// start time or title prefix — so a mutant that breaks one of those fails the
// assertion written for it instead of making every lookup miss.
const OPPONENT: Record<string, string> = {
  n1: "QA Bears", n2: "QA Owls", ih: "Riverside Reds", ia1: "Riverside Blues", ia2: "Riverside Greens",
  p1: "TBD", p2: "Riverside Golds", x: "QA Hawks", rp: "Riverside Silvers", late: "QA Night",
};
const byUid = (events: Event[], id: string) =>
  events.find((e) => (e.get("SUMMARY") ?? "").includes(OPPONENT[id]));

function main() {
  section("P", () => {
    const { events, unfolded } = build();
    assert(!byUid(events, "p1"), "P1", "pending with no response is NOT in the feed");
    assert(!byUid(events, "p2"), "P2", "pending with a counter-proposal is NOT in the feed");
    assert(!unfolded.includes("Riverside Golds") && !unfolded.includes("Riverside Field 9"), "P3",
      "the countering partner's team and field appear nowhere");
    if (!byUid(events, "p1") && !byUid(events, "p2")) count("pending_excluded", 2);
  });

  section("C", () => {
    const { events } = build();
    const x = byUid(events, "x");
    assert(!!x, "C0", "a cancelled game STAYS in the feed");
    assert(x?.get("SUMMARY") === "CANCELLED: QA Tigers vs QA Hawks", "C1",
      `cancelled title is "CANCELLED: <matchup>" (got: ${x?.get("SUMMARY")})`);
    assert(x?.get("STATUS") === "CANCELLED", "C2", `cancelled carries STATUS:CANCELLED (got: ${x?.get("STATUS")})`);
    const others = events.filter((e) => e !== x);
    assert(others.length === 7 && others.every((e) => e.get("STATUS") === "CONFIRMED" && !e.get("SUMMARY")!.startsWith("CANCELLED")),
      "C3", "every other game is CONFIRMED and unprefixed (incl. reschedule_pending)");
    assert(!events.some((e) => /RAINED/i.test(e.get("SUMMARY") ?? "")), "C4", 'no title says "RAINED OUT"');
    assert(events.length === 8, "C5", `8 events from 10 games: 2 pending dropped, 1 cancelled kept (got ${events.length})`);
    if (x) count("cancelled_event");
  });

  section("T", () => {
    const { events } = build();
    const n1 = byUid(events, "n1");
    assert(n1?.line("DTSTART") === "DTSTART;TZID=America/Los_Angeles:20261024T090000", "T1",
      `start is the stored wall-clock 9:00, labelled (got: ${n1?.line("DTSTART")})`);
    assert(n1?.line("DTEND") === "DTEND;TZID=America/Los_Angeles:20261024T104500", "T2",
      `end = start + 105 minutes (got: ${n1?.line("DTEND")})`);
    const late = byUid(events, "late");
    assert(late?.line("DTEND") === "DTEND;TZID=America/Los_Angeles:20270101T004500", "T3",
      `an end past midnight rolls the date, month and year (got: ${late?.line("DTEND")})`);
    assert(events.every((e) => !/Z$/.test(e.line("DTSTART") ?? "") && !/Z$/.test(e.line("DTEND") ?? "Z-absent-ok")),
      "T4", "no start or end is written as a UTC instant");
    const asString = build({ division: { name: "QA-Minors", game_duration: "105" } });
    assert(byUid(asString.events, "n1")?.line("DTEND") === "DTEND;TZID=America/Los_Angeles:20261024T104500",
      "T6", 'a duration stored as the string "105" is usable');
    for (const bad of [0, -5, undefined, null, "abc", "", Number.NaN, true]) {
      const r = build({ division: { name: "QA-Minors", game_duration: bad } });
      const e = byUid(r.events, "n1");
      assert(!!e && e.line("DTSTART") === "DTSTART;TZID=America/Los_Angeles:20261024T090000" && e.line("DTEND") === undefined,
        "T5", `duration ${String(bad)} → start only, no invented end (got DTEND: ${e?.line("DTEND")})`);
      count("start_only_event");
    }
    if (late) count("midnight_rollover");
  });

  section("Z", () => {
    const la = build();
    assert(la.head.includes("TZID:America/Los_Angeles") && la.head.includes("TZNAME:PDT") && la.head.includes("TZOFFSETTO:-0700"),
      "Z1", "Pacific feed describes its zone, with daylight time");
    const ny = build({ org: { timezone: "America/New_York" } });
    assert(ny.events.length === 8 && ny.events.every((e) => e.line("DTSTART")!.startsWith("DTSTART;TZID=America/New_York:") &&
      e.line("DTEND")!.startsWith("DTEND;TZID=America/New_York:")), "Z2",
      `an Eastern org's events are labelled Eastern (got: ${ny.events[0]?.line("DTSTART")})`);
    assert(byUid(ny.events, "n1")?.line("DTSTART") === "DTSTART;TZID=America/New_York:20261024T090000", "Z3",
      "…and the wall-clock time is the same 9:00 — relabelled, not shifted");
    const bad = buildTeamCalendarIcs(input({ org: { timezone: "Europe/London" } }));
    const empty = buildTeamCalendarIcs(input({ org: { timezone: "" } }));
    assert(!bad.ok && !("ics" in bad) && !empty.ok, "Z4", "an unsupported or blank timezone is REFUSED, not defaulted");
    const phx = build({ org: { timezone: "America/Phoenix" } });
    assert(!phx.head.includes("BEGIN:DAYLIGHT") && phx.head.includes("TZOFFSETTO:-0700"), "Z5",
      "Arizona has no daylight block");
    for (const z of ORG_TIMEZONES) {
      const r = build({ org: { timezone: z.id } });
      assert(r.head.includes(`TZID:${z.id}`) && r.head.includes(`X-WR-TIMEZONE:${z.id}`) && r.events.length === 8,
        "Z6", `${z.id} builds and names itself`);
      count("zone_built");
    }
    if (!bad.ok) count("zone_refused");
  });

  section("U", () => {
    const before = build();
    const moved = build({
      games: GAMES.map((x) => (x.id === "n1"
        ? { ...x, scheduled_at: at("2026-10-25", "16:15"), updated_at: "2026-10-24T20:00:00+00:00" }
        : x)),
    });
    const a = byUid(before.events, "n1");
    const b = byUid(moved.events, "n1");
    assert(!!a && !!b && a.get("UID") === b.get("UID") &&
      b.line("DTSTART") === "DTSTART;TZID=America/Los_Angeles:20261025T161500" && moved.events.length === before.events.length,
      "U1", `a moved game keeps its UID and carries the new time (got: ${b?.get("UID")} / ${b?.line("DTSTART")})`);
    assert(a?.get("UID") === "game-n1@thefieldslate.com" && gameUid("n1") === "game-n1@thefieldslate.com", "U2",
      `UID is the game id (got: ${a?.get("UID")})`);
    const uids = before.events.map((e) => e.get("UID"));
    assert(new Set(uids).size === uids.length, "U3", "UIDs are unique");
    if (a && b) count("moved_game");
  });

  section("I", () => {
    const { events } = build();
    assert(byUid(events, "ih")?.get("SUMMARY") === "QA Tigers vs Riverside Reds", "I1",
      `interleague home names the partner (got: ${byUid(events, "ih")?.get("SUMMARY")})`);
    const ia1 = byUid(events, "ia1");
    assert(ia1?.get("SUMMARY") === "Riverside Blues vs QA Tigers", "I2",
      `interleague away: the partner hosts (got: ${ia1?.get("SUMMARY")})`);
    assert(ia1?.get("LOCATION") === "Riverside Field 1", "I3",
      `interleague away: the partner's field (got: ${ia1?.get("LOCATION")})`);
    assert(byUid(events, "n2")?.get("LOCATION") === "QA Park — Field 2", "I4",
      `a field in a park reads "Park — Field" (got: ${byUid(events, "n2")?.get("LOCATION")})`);
    assert(byUid(events, "n1")?.get("LOCATION") === "QA-Memorial", "I5", "a field with no park reads as its name");
    const ia2 = byUid(events, "ia2");
    assert(!!ia2 && ia2.line("LOCATION") === undefined, "I6", "unknown field → no LOCATION line at all");
    if (ia1) count("away_event");
    if (ia2 && !ia2.line("LOCATION")) count("locationless_event");
  });

  section("X", () => {
    const longName = "QA Río Grande Čhargers — the very long team name that keeps going, and going; on";
    const r = buildTeamCalendarIcs(input({
      team: { name: "QA, Tigers; A\\B" },
      games: [g({ id: "e1", scheduled_at: at("2026-10-24", "09:00"),
        home_team: { name: "Reds, The" }, away_team: { name: longName },
        venue: { name: "Line\nBreak Field", location: null } })],
    }));
    if (!r.ok) throw new Error("builder refused: " + r.error);
    const { events, head } = parse(r.ics);
    assert(events[0]?.get("SUMMARY") === `Reds\\, The vs ${longName.replace(/,/g, "\\,").replace(/;/g, "\;")}`, "X1",
      `commas and semicolons are escaped (got: ${events[0]?.get("SUMMARY")})`);
    assert(head.includes("X-WR-CALNAME:QA\\, Tigers\; A\\\\B — QA Fall 2026"), "X2",
      "backslash, comma and semicolon escaped in the calendar name");
    const physical = r.ics.split("\r\n");
    const enc = new TextEncoder();
    const longest = Math.max(...physical.map((l) => enc.encode(l).length));
    const folded = physical.filter((l) => l.startsWith(" ")).length;
    assert(longest <= 75 && folded > 0, "X3",
      `no physical line exceeds 75 octets, and the long one was folded (longest ${longest}, ${folded} continuation line(s))`);
    assert(!r.ics.includes("\uFFFD") && events[0]?.get("SUMMARY")?.includes("Río Grande Čhargers — the") === true, "X4",
      "folding never splits a multi-byte character (round-trips intact)");
    assert(events[0]?.get("LOCATION") === "Line\\nBreak Field", "X5", "a newline in a name is escaped, never emitted raw");
    assert(r.ics.endsWith("END:VCALENDAR\r\n") && !r.ics.replace(/\r\n/g, "").includes("\n") && !r.ics.replace(/\r\n/g, "").includes("\r"),
      "X6", "CRLF line endings only");
    count("folded_lines", folded);
  });

  section("L", () => {
    const { unfolded, events, head } = build();
    const hits = PLANTED_STRINGS.filter((s) => unfolded.toLowerCase().includes(s.toLowerCase()));
    assert(hits.length === 0, "L1",
      `no planted note, coach, contact, official or score appears (found: ${hits.join(" | ") || "none"})`);
    const allowedEvent = new Set(["UID", "DTSTAMP", "LAST-MODIFIED", "DTSTART", "DTEND", "SUMMARY", "DESCRIPTION", "LOCATION", "STATUS"]);
    const names = new Set(events.flatMap((e) => e.lines.map((l) => l.split(/[:;]/)[0])));
    const extra = [...names].filter((n) => !allowedEvent.has(n));
    assert(extra.length === 0 && names.size >= 8, "L2",
      `every event property is on the allowlist (unexpected: ${extra.join(",") || "none"})`);
    assert(events.every((e) => e.get("DESCRIPTION") === "QA-Minors · QA Fall 2026"), "L3",
      "the description is division · season and nothing else");
    assert(!/@(?!thefieldslate\.com)/.test(unfolded), "L4", "the only @ in the feed is the UID domain");
    assert(head.every((l) => !/ORGANIZER|ATTENDEE|CONTACT|COMMENT/.test(l)) && !/ORGANIZER|ATTENDEE|CONTACT|COMMENT/.test(unfolded),
      "L5", "no organizer, attendee, contact or comment property exists");
    count("planted_fields_checked", PLANTED_STRINGS.length);
    count("events_scanned", events.length);
  });

  section("M", () => {
    const { events } = build();
    const n1 = byUid(events, "n1");
    assert(n1?.get("DTSTAMP") === "20260920T174530Z" && n1?.get("LAST-MODIFIED") === "20260920T174530Z", "M1",
      `last-change stamps are the row's updated_at, in UTC (got: ${n1?.get("DTSTAMP")})`);
    const r = buildTeamCalendarIcs(input({ games: [g({ id: "bad", scheduled_at: at("2026-10-24", "09:00"), updated_at: "not a time" })] }));
    assert(!r.ok, "M2", "an unreadable last-change time is refused, not replaced by the host clock");
    const a = buildTeamCalendarIcs(input());
    const b = buildTeamCalendarIcs(input());
    assert(a.ok && b.ok && a.ics === b.ics, "M3", "two builds of the same data are byte-identical (no clock, no randomness)");
    const empty = buildTeamCalendarIcs(input({ games: [] }));
    assert(empty.ok && empty.eventCount === 0 && empty.ics.includes("BEGIN:VTIMEZONE") && !empty.ics.includes("BEGIN:VEVENT"),
      "M4", "a team with no games builds a valid, empty calendar");
    count("stamp_checked");
  });

  section("G", () => {
    const r = buildTeamCalendarIcs(input({ games: [GAMES[1]] }));
    if (!r.ok) throw new Error("builder refused: " + r.error);
    const block = r.ics.substring(r.ics.indexOf("BEGIN:VEVENT"));
    const expected = [
      "BEGIN:VEVENT",
      "UID:game-n2@thefieldslate.com",
      "DTSTAMP:20260920T174530Z",
      "LAST-MODIFIED:20260920T174530Z",
      "DTSTART;TZID=America/Los_Angeles:20261024T133000",
      "DTEND;TZID=America/Los_Angeles:20261024T151500",
      "SUMMARY:QA Tigers vs QA Owls",
      "DESCRIPTION:QA-Minors · QA Fall 2026",
      "LOCATION:QA Park — Field 2",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    assert(block === expected, "G1", "one whole event matches, byte for byte");
    assert(r.ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FieldSlate//Team Calendar//EN\r\n"), "G2",
      "calendar header");
    if (process.env.SHOW_SAMPLES) console.log("\n--- sample feed ---\n" + buildSample());
  });

  console.log("\n── counters");
  for (const c of [
    "pending_excluded", "cancelled_event", "start_only_event", "midnight_rollover", "zone_built", "zone_refused",
    "moved_game", "away_event", "locationless_event", "folded_lines", "planted_fields_checked", "events_scanned",
    "stamp_checked",
  ]) {
    const n = counters[c] ?? 0;
    assert(n > 0, `V-${c}`, `counter ${c} = ${n}`);
  }
}

function buildSample(): string {
  const r = buildTeamCalendarIcs(input({ games: GAMES.filter((x) => ["n2", "ia1", "x", "p1"].includes(x.id)) }));
  return r.ok ? r.ics : r.error;
}

try {
  main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  failures.push(`[CRASH-main] ${msg}`);
  console.error(`  FAIL: [CRASH-main] ${msg}`);
}
console.log(`\nhost TZ: ${process.env.TZ ?? "(unset)"}`);
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  - ${f.split("\n")[0]}`);
  process.exit(1);
}
console.log("All checks passed.");
