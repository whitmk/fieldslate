// The volunteer tracker (/dashboard/volunteers/tracker, 0123) — the screen's
// rules and wiring, through the REAL src/lib/volunteers/tracker.ts. The
// counts themselves are the database's (proof: volunteer-tracker-sim.sql).
//
//   npm run sim:volunteer-tracker            (three host zones)
//   npm run sim:volunteer-tracker:mutants
//
// ASSERTIONS (a mutant must die FIRST at its own tag):
//   P1  parseTracker: the fixture parses; any malformed piece → null (goal
//       out of range, a member without an email, a negative count, a bad
//       date, a missing list)
//   B1  familyStatus: exclusive buckets — met when WORKED reaches the goal,
//       on track when worked + upcoming does, else short by the rest; the
//       boundaries; no goal → none
//   B2  statusLabel: "Goal met" / "On track" / "Short 1" / "—"
//   N1  names: the family is its first volunteer's last name; an
//       official-only family is "J. Smith (official)"; "M. Patel"; teams
//       sorted, unknown ids dropped
//   T1  teamRows: met / on track / short per team, a family on two teams
//       counts on both, "not signed up" = count − families (never below 0),
//       no count → null; sorted by name
//   T2  progressLine: "of 10" with a count, "of 3 signed up" without, "N
//       signed up" with no goal
//   T3  tiles: each family once; "not signed up" summed over teams with a
//       count, null when no team has one
//   F1  familyRows: All / Goal met / Short, sorted by family name
//   U1  nudge targets: official-only families can't be nudged; volunteer ids
//       distinct and officials never included; "Nudged Nov 9" = the latest
//   O1  officialRows: past = dated before today; upcoming counts played games
//       from today on; the matched volunteer named; an interleague opponent
//   R1  replies: nudge (sent / recent / none sent / link off / no goal /
//       unreadable), merge (ready / merged / same / gone), separate, saved
//   C1  CSV: header, one line per family, members and emails joined, an
//       inert formula cell, the status column
//   G1  typed goal and family counts: blank → null, in range → number, else
//       invalid
//   W1  wiring: the page fails closed on the tracker read; the component
//       trusts only the confirming replies; the CSV and words come from the
//       rules file
// ANTI-VACUITY: met, on-track, short, official-only and merged families must
// all occur.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  familyName,
  familyRows,
  familyStatus,
  memberLabel,
  mergeOutcome,
  nudgeable,
  nudgedLine,
  nudgeOutcome,
  nudgeVolunteerIds,
  officialRows,
  parseFamilyCount,
  parseGoal,
  parseTracker,
  progressLine,
  savedOutcome,
  separateOutcome,
  statusLabel,
  teamRows,
  teamsLabel,
  tiles,
  trackerCsv,
  type TrackerData,
} from "@/lib/volunteers/tracker";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let checks = 0;
const failures: string[] = [];
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
}
const eq = (a: unknown, b: unknown, tag: string, what: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), tag, what, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const counters = { met: 0, onTrack: 0, short: 0, officialOnly: 0, merged: 0 };

// ── Fixture (goal 2; today Nov 20) ───────────────────────────────────────────
const vol = (id: string, fi: string, last: string, email = `${id}@example.com`) =>
  ({ kind: "volunteer", id, first_initial: fi, last_name: last, email, manual: false }) as const;
const RAW = {
  season_id: "s1",
  today: "2026-11-20",
  link_enabled: true,
  goal: { shifts_per_family: 2, officials_count: true },
  roles: [
    { id: "rGC", name: "GameChanger", kind: "per_team", counts_toward_goal: true },
    { id: "rFP", name: "Field prep", kind: "per_game", counts_toward_goal: false },
    { id: "rSS", name: "Snack shack", kind: "snack_shack", counts_toward_goal: true },
  ],
  team_counts: [{ team_id: "tE", families: 10 }, { team_id: "tP", families: 1 }],
  families: [
    // Patel: two volunteers merged, on two teams; 0 worked + 1 upcoming → short 1.
    { key: "kP", members: [{ ...vol("vM", "m", "Patel"), manual: true }, { ...vol("vR", "R", "Patel"), manual: true }],
      team_ids: ["tP", "tO"], worked: 0, upcoming: 1, no_shows: 1, held: 0 },
    // Brooks: worked 2 → met.
    { key: "kB", members: [vol("vB", "T", "Brooks")], team_ids: ["tE"], worked: 2, upcoming: 0, no_shows: 0, held: 0 },
    // Adams: worked 1 + upcoming 1 → on track (exactly the goal).
    { key: "kA", members: [vol("vA", "J", "Adams", "=cmd@example.com")], team_ids: ["tE"], worked: 1, upcoming: 1, no_shows: 0, held: 1 },
    // An official on their own (counts for Expos).
    { key: "kU", members: [{ kind: "official", id: "u1", name: "Jo Smith", manual: false, matched_volunteer_id: null, by_email: false }],
      team_ids: ["tE"], worked: 3, upcoming: 0, no_shows: 0, held: 0 },
    // Canceled everything: listed, 0/0, short 2 (decided 2026-11-09).
    { key: "kC", members: [vol("vC", "a", "Cole")], team_ids: ["tE"], worked: 0, upcoming: 0, no_shows: 0, held: 0 },
  ],
  officials: [
    { umpire_id: "u1", name: "Jo Smith", counts_for_team_id: "tE", matched_volunteer_id: null,
      games: [
        { game_umpire_id: "gu1", start: "2026-11-14T09:00", status: "scheduled", home_team_id: "tE", away_team_id: "tP", external_team_name: null, no_show: false },
        { game_umpire_id: "gu2", start: "2026-11-19T18:00", status: "cancelled", home_team_id: "tE", away_team_id: null, external_team_name: "Westside Cubs", no_show: false },
        { game_umpire_id: "gu3", start: "2026-11-20T09:00", status: "scheduled", home_team_id: "tP", away_team_id: "tE", external_team_name: null, no_show: false },
        { game_umpire_id: "gu4", start: "2026-11-21T09:00", status: "cancelled", home_team_id: "tP", away_team_id: "tE", external_team_name: null, no_show: false },
      ] },
    { umpire_id: "u2", name: "Pat Lee", counts_for_team_id: null, matched_volunteer_id: "vB", games: [] },
  ],
  nudged: [{ volunteer_id: "vM", on: "2026-11-02" }, { volunteer_id: "vR", on: "2026-11-09" }],
};
const TEAMS = [{ id: "tP", name: "Majors Pirates" }, { id: "tE", name: "Majors Expos" }, { id: "tO", name: "AA Owls" }, { id: "tR", name: "AAA Rays" }];
const NAMES = new Map(TEAMS.map((t) => [t.id, t.name]));

// P1
const data = parseTracker(RAW) as TrackerData;
ok(data !== null && data.families.length === 5 && data.officials.length === 2, "P1", "the fixture parses");
const clone = () => JSON.parse(JSON.stringify(RAW));
const bad: [string, (x: ReturnType<typeof clone>) => void][] = [
  ["goal 21", (x) => (x.goal.shifts_per_family = 21)],
  ["goal 0", (x) => (x.goal.shifts_per_family = 0)],
  ["a member without an email", (x) => delete x.families[0].members[0].email],
  ["a negative count", (x) => (x.families[1].worked = -1)],
  ["a fractional count", (x) => (x.families[1].upcoming = 1.5)],
  ["a bad today", (x) => (x.today = "11/20/2026")],
  ["no families list", (x) => delete x.families],
  ["a family with no members", (x) => (x.families[1].members = [])],
  ["an unknown member kind", (x) => (x.families[1].members[0].kind = "coach")],
  ["a game without a start", (x) => delete x.officials[0].games[0].start],
  ["a team count that isn't a number", (x) => (x.team_counts[0].families = "10")],
  ["no link flag", (x) => delete x.link_enabled],
];
for (const [what, f] of bad) {
  const x = clone();
  f(x);
  ok(parseTracker(x) === null, "P1", `malformed → null: ${what}`);
}
ok(parseTracker(null) === null && parseTracker([]) === null, "P1", "not an object → null");

// B1
eq(familyStatus(2, { worked: 2, upcoming: 0 }), { bucket: "met", short: 0 }, "B1", "worked = goal → met");
eq(familyStatus(2, { worked: 3, upcoming: 5 }), { bucket: "met", short: 0 }, "B1", "met is never also on track");
eq(familyStatus(2, { worked: 1, upcoming: 1 }), { bucket: "on_track", short: 0 }, "B1", "worked + upcoming = goal → on track");
eq(familyStatus(2, { worked: 0, upcoming: 1 }), { bucket: "short", short: 1 }, "B1", "Patel: short 1");
eq(familyStatus(2, { worked: 0, upcoming: 0 }), { bucket: "short", short: 2 }, "B1", "nothing → short by the goal");
eq(familyStatus(3, { worked: 2, upcoming: 0 }), { bucket: "short", short: 1 }, "B1", "worked below the goal, nothing upcoming → short");
eq(familyStatus(null, { worked: 5, upcoming: 0 }), null, "B1", "no goal → no status");

// B2
eq([statusLabel({ bucket: "met", short: 0 }), statusLabel({ bucket: "on_track", short: 0 }), statusLabel({ bucket: "short", short: 1 }), statusLabel(null)],
  ["Goal met", "On track", "Short 1", "—"], "B2", "status words");

// N1
const fam = (k: string) => data.families.find((f) => f.key === k)!;
eq(familyName(fam("kP")), "Patel", "N1", "family = first volunteer's last name");
eq(familyName(fam("kU")), "Jo Smith (official)", "N1", "official-only family");
eq(memberLabel(fam("kP").members[0]), "M. Patel", "N1", "initial upper-cased");
eq(teamsLabel(fam("kP"), NAMES), "AA Owls, Majors Pirates", "N1", "teams sorted");
eq(teamsLabel({ team_ids: ["tE", "gone"] }, NAMES), "Majors Expos", "N1", "an unknown team id is dropped");

// T1
const rows = teamRows(data, TEAMS);
eq(rows.map((r) => r.name), ["AA Owls", "AAA Rays", "Majors Expos", "Majors Pirates"], "T1", "sorted by name");
const expos = rows.find((r) => r.teamId === "tE")!;
eq([expos.families, expos.signedUp, expos.met, expos.onTrack, expos.short, expos.notSignedUp], [10, 4, 2, 1, 1, 6], "T1",
  "Expos: Brooks + the official met, Adams on track, Cole short; 10 − 4 not signed up");
const pirates = rows.find((r) => r.teamId === "tP")!;
eq([pirates.families, pirates.signedUp, pirates.short, pirates.notSignedUp], [1, 1, 1, 0], "T1", "Pirates: a count of 1 never goes below 0");
const owls = rows.find((r) => r.teamId === "tO")!;
eq([owls.families, owls.signedUp, owls.short, owls.notSignedUp], [null, 1, 1, null], "T1", "Owls: no count, the Patels counted here too");
const rays = rows.find((r) => r.teamId === "tR")!;
eq([rays.signedUp, rays.notSignedUp], [0, null], "T1", "Rays: nobody, no count");
const over = teamRows({ ...data, team_counts: [{ team_id: "tE", families: 2 }] }, TEAMS).find((r) => r.teamId === "tE")!;
eq(over.notSignedUp, 0, "T1", "more families signed up than the count → 0, never negative");

// T2
eq(progressLine(expos, true), "2 met · 1 on track of 10", "T2", "with a count");
eq(progressLine(owls, true), "0 met · 0 on track of 1 signed up", "T2", "without a count");
eq(progressLine(expos, false), "4 signed up", "T2", "no goal");

// T3
eq(tiles(data, TEAMS), { met: 2, onTrack: 1, short: 2, notSignedUp: 6 }, "T3", "each family once; 6 + 0 not signed up");
eq(tiles({ ...data, team_counts: [] }, TEAMS).notSignedUp, null, "T3", "no counts → null");

// F1
eq(familyRows(data, "all").map((f) => f.key), ["kA", "kB", "kC", "kU", "kP"], "F1", "all, by family name");
eq(familyRows(data, "met").map((f) => f.key), ["kB", "kU"], "F1", "goal met only");
eq(familyRows(data, "short").map((f) => f.key), ["kC", "kP"], "F1", "short only (on track is neither)");
eq(familyRows({ ...data, goal: { shifts_per_family: null, officials_count: true } }, "short").length, 0, "F1", "no goal → no buckets to filter");

// U1
ok(!nudgeable(fam("kU")) && nudgeable(fam("kP")), "U1", "official-only families can't be nudged");
eq(nudgeVolunteerIds([fam("kP"), fam("kU"), fam("kP")]), ["vM", "vR"], "U1", "volunteer ids, distinct, no officials");
eq(nudgedLine(fam("kP"), data.nudged), "Nudged Nov 9", "U1", "the latest nudge to any member");
eq(nudgedLine(fam("kB"), data.nudged), null, "U1", "never nudged → nothing");

// O1
const offs = officialRows(data, NAMES);
const jo = offs.find((o) => o.umpireId === "u1")!;
eq(jo.past.map((g) => g.id), ["gu1", "gu2"], "O1", "past = dated before today (today's game is upcoming)");
eq(jo.upcoming, 1, "O1", "upcoming counts played games from today on (a rained-out one doesn't)");
eq(jo.past.map((g) => g.played), [true, false], "O1", "a rained-out past game is marked not played");
eq(jo.past[1].matchup, "Majors Expos vs Westside Cubs", "O1", "an interleague opponent by name");
eq(jo.past[0].when, "Sat 11/14 · 9:00 AM", "O1", "when");
eq(offs.find((o) => o.umpireId === "u2")!.matchedLine, "Same email as volunteer T. Brooks", "O1", "the matched volunteer named");

// R1
eq(nudgeOutcome({ status: "queued", queued: 2, recent: [], not_found: 0 }), { ok: true, text: "Nudges sent to 2 volunteers." }, "R1", "sent");
eq(nudgeOutcome({ status: "queued", queued: 1, recent: ["x"], not_found: 0 }),
  { ok: true, text: "Nudge sent to 1 volunteer. 1 volunteer was nudged in the last 3 days and left out." }, "R1", "sent + recent");
eq(nudgeOutcome({ status: "queued", queued: 0, recent: ["x", "y"], not_found: 0 }).ok, false, "R1", "none sent is not a success");
ok(nudgeOutcome({ status: "queued", queued: 0, recent: ["x"] }).text.startsWith("No nudges were sent"), "R1", "none sent says why");
ok(nudgeOutcome({ status: "link_off" }).text.startsWith("Turn the sign-up link on"), "R1", "link off");
ok(nudgeOutcome({ status: "no_goal" }).text.startsWith("Set a goal first"), "R1", "no goal");
eq(nudgeOutcome({ status: "queued", queued: "2", recent: [] }).ok, false, "R1", "unreadable count → failure");
eq(nudgeOutcome(null).ok, false, "R1", "no reply → failure");
eq(mergeOutcome({ status: "ready", members: 3 }, false).ok, true, "R1", "merge preview ready");
eq(mergeOutcome({ status: "merged" }, false).ok, false, "R1", "a committed reply to a preview is refused");
eq(mergeOutcome({ status: "merged" }, true), { ok: true, text: "Merged." }, "R1", "merged");
eq(mergeOutcome({ status: "same_family" }, true).ok, false, "R1", "same family");
eq(mergeOutcome({ status: "not_found" }, true).text, "One of those families isn't on the list anymore. Reload and try again.", "R1", "gone");
eq([separateOutcome({ status: "separated" }).ok, separateOutcome({ status: "not_merged" }).ok], [true, false], "R1", "separate");
eq([savedOutcome({ status: "saved" }, "x").ok, savedOutcome({ status: "not_past" }, "x").text, savedOutcome({}, "x").text],
  [true, "Only a game that's already been played can be marked.", "x"], "R1", "saved");

// C1
const csv = trackerCsv(data, NAMES).split("\r\n");
eq(csv[0], "Family,Members,Emails,Teams,Worked,Upcoming,No-shows,Status", "C1", "header");
eq(csv.length, 6, "C1", "one line per family");
eq(csv[1], "Adams,J. Adams,'=cmd@example.com,Majors Expos,1,1,0,On track", "C1", "a formula-looking email made inert");
eq(csv[5], "Patel,M. Patel; R. Patel,vM@example.com; vR@example.com,AA Owls; Majors Pirates,0,1,1,Short 1", "C1", "a merged family");
eq(csv[4], "Jo Smith (official),Jo Smith (official),,Majors Expos,3,0,0,Goal met", "C1", "an official: no email");

// G1
eq([parseGoal(""), parseGoal(" 3 "), parseGoal("20"), parseGoal("21"), parseGoal("0"), parseGoal("2.5"), parseGoal("x")],
  [null, 3, 20, "invalid", "invalid", "invalid", "invalid"], "G1", "goal");
eq([parseFamilyCount(""), parseFamilyCount("60"), parseFamilyCount("61"), parseFamilyCount("0"), parseFamilyCount("-1")],
  [null, 60, "invalid", "invalid", "invalid"], "G1", "family count");

// Counters
for (const f of data.families) {
  const s = familyStatus(2, f);
  if (s?.bucket === "met") counters.met++;
  if (s?.bucket === "on_track") counters.onTrack++;
  if (s?.bucket === "short") counters.short++;
  if (!nudgeable(f)) counters.officialOnly++;
  if (f.members.length > 1) counters.merged++;
}

// W1 — wiring (source greps — weak by nature).
const page = read("src/app/(dashboard)/dashboard/volunteers/tracker/page.tsx");
ok(/const data = parseTracker\(reply\.data\);\s*if \(reply\.error \|\| !data\) \{\s*throw/.test(page), "W1",
  "a failed or malformed tracker read throws (error card)");
const comp = read("src/components/volunteers/tracker-screen.tsx");
ok(comp.includes("nudgeOutcome(") && comp.includes("mergeOutcome(") && comp.includes("separateOutcome(") && comp.includes("savedOutcome("),
  "W1", "every write's reply goes through the rules file");
ok(comp.includes("trackerCsv(") && !/["']Family,Members/.test(comp), "W1", "the CSV comes from the rules file");
ok(comp.includes("p_commit: false") && comp.includes("p_commit: true"), "W1", "merge previews before it commits");

for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${failures.length} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`sim:volunteer-tracker — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);
