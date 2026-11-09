// Admin: who signed up (/dashboard/volunteers/signups) — the screen's rules
// and wiring, through the REAL src/lib/volunteers/signups-screen.ts.
//
//   npm run sim:volunteer-signups            (three host zones)
//   npm run sim:volunteer-signups:mutants
//
// ASSERTIONS (a mutant must die FIRST at its own tag):
//   S1  fmtWhen: "Sat 3/6 · 8:30 AM", noon and midnight, no zone shift
//   S2  buildSpotRows: one row per position; an ACTIVE claim sits in its own
//       position (a canceled one never shows); per-team titles; the role's
//       lead moves the start; rained-out and move-pending notes; time order
//   S3  filters: role, division, open only, filled only
//   S4  splitByTime: upcoming = every spot dated today or later — one that
//       started today stays, tagged "Started"; past = filled spots on dates
//       before today (the no-show tick appears from the next day)
//   S5  lost banner: detached sign-ups grouped by division and day, words
//   S6  CSV: header, one line per spot, "Open" for an open one, quoting, a
//       formula-looking cell made inert
//   S7  assignStatusLine: every status worded; unknown → generic
//   R1  nextUp: the earliest day with filled spots still ahead, its
//       sign-ups and volunteers (distinct); "sent" only when ALL were reminded
//   R2  nextUpLines: the banner's words, one volunteer or several
//   R3  remindable: filled and not started
//   R4  remindOutcome: a count → sent (and what was left out); none queued
//       or an unreadable reply → failure, never "sent"
//   R5  remindedLine reads the league-timezone date, never the raw timestamp
//   W1  wiring: the page fails closed on the sign-up read; the component
//       trusts only an "assigned" / "canceled" / "saved" reply
// ANTI-VACUITY: filled, open, noted, past and lost rows must all occur.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyFilters,
  assignStatusLine,
  buildSpotRows,
  fmtWhen,
  lostDetail,
  lostGroups,
  lostTitle,
  nextUp,
  nextUpLines,
  remindable,
  remindedLine,
  remindOutcome,
  signupsCsv,
  splitByTime,
  startedTag,
  type ScreenGame,
  type ScreenRoleRow,
  type ScreenTeam,
  type SignupClaim,
} from "@/lib/volunteers/signups-screen";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let checks = 0;
const failures: string[] = [];
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
}
const counters = { filled: 0, open: 0, noted: 0, past: 0, lost: 0 };

// S1
ok(fmtWhen("2027-03-06T08:30") === "Sat 3/6 · 8:30 AM", "S1", "morning", fmtWhen("2027-03-06T08:30"));
ok(fmtWhen("2027-03-06T12:00:00") === "Sat 3/6 · 12:00 PM", "S1", "noon", fmtWhen("2027-03-06T12:00:00"));
ok(fmtWhen("2027-03-07T00:15") === "Sun 3/7 · 12:15 AM", "S1", "midnight", fmtWhen("2027-03-07T00:15"));

// Fixture
const DIV = new Map([["dM", "Majors"], ["dA", "AAA"]]);
const TEAMS: ScreenTeam[] = [
  { id: "tE", name: "Expos", divisionId: "dM" }, { id: "tP", name: "Pirates", divisionId: "dM" },
  { id: "tR", name: "Rays", divisionId: "dA" }, { id: "tG", name: "Giants", divisionId: "dM" },
];
const game = (id: string, at: string, home: string, away: string | null, extra: Partial<ScreenGame> = {}): ScreenGame => ({
  id, scheduledAt: at, status: "scheduled", homeTeamId: home, awayTeamId: away, interleagueOrgId: null, isAway: false,
  fieldLabel: "Field 1", ...extra,
});
const GAMES: ScreenGame[] = [
  game("g1", "2027-03-06T09:00:00", "tE", "tP"),
  game("g2", "2027-03-06T12:00:00", "tG", null, { interleagueOrgId: "p1", status: "reschedule_pending", fieldLabel: null }),
  game("g3", "2027-03-13T09:00:00", "tE", "tP", { status: "cancelled" }),
  game("g0", "2027-02-27T09:00:00", "tE", "tP"),
];
const ROLES: ScreenRoleRow[] = [
  { id: "rGC", name: "GameChanger", kind: "per_team", spots: 1, signupsOpen: true, divisionIds: ["dM"], leadMinutes: 0 },
  { id: "rFP", name: "Field prep", kind: "per_game", spots: 2, signupsOpen: true, divisionIds: ["dM"], leadMinutes: 30 },
];
const claim = (id: string, game: string | null, role: string, forTeam: string | null, pos: number, extra: Partial<SignupClaim> = {}): SignupClaim => ({
  claim_id: id, status: "active", game_id: game, role_id: role, for_team_id: forTeam, position: pos, family_team_id: "tE",
  created_by: "volunteer", no_show: false, last_reminded_at: null, detached_from: null, detached_at: null, moved_from: null,
  volunteer_id: "v-" + id, first_initial: "A", last_name: "Garcia", email: "agarcia@example.com", ...extra,
});
const CLAIMS: SignupClaim[] = [
  claim("c1", "g1", "rGC", "tE", 1),
  claim("c2", "g1", "rFP", null, 2, { created_by: "admin", last_name: "Patel" }),
  claim("c3", "g1", "rFP", null, 1, { status: "canceled", last_name: "Gone" }),
  claim("c4", "g0", "rGC", "tP", 1, { last_name: "Nguyen" }),
  claim("c5", null, "rGC", "tE", 1, { status: "detached", detached_from: { start: "2027-03-20T09:00", home_team_id: "tE" }, detached_at: "2027-03-02T18:00:00Z" }),
  claim("c6", null, "rFP", null, 1, { status: "detached", detached_from: { start: "2027-03-20T09:00", home_team_id: "tE" }, detached_at: "2027-03-02T18:05:00Z" }),
];
const rows = buildSpotRows({ games: GAMES, roles: ROLES, teams: TEAMS, divisionName: DIV, claims: CLAIMS });

// S2
const g1 = rows.filter((r) => r.gameId === "g1");
// g1: GameChanger · Expos, GameChanger · Pirates, Field prep ×2 = 4 rows
ok(g1.length === 4, "S2", "g1 rows", String(g1.length));
const fp = g1.filter((r) => r.roleId === "rFP");
ok(fp.length === 2 && fp[0].claim === null && fp[1].claim?.claim_id === "c2", "S2", "the active claim sits in position 2; the canceled one never shows",
  JSON.stringify(fp.map((r) => [r.position, r.claim?.claim_id ?? null])));
ok(fp[0].start === "2027-03-06T08:30", "S2", "field prep starts 30 minutes early", fp[0].start);
ok(fp[1].detail.endsWith("spot 2 of 2"), "S2", "spot number in the detail", fp[1].detail);
const gcE = g1.find((r) => r.roleId === "rGC" && r.forTeamId === "tE");
ok(gcE?.title === "GameChanger · Expos" && gcE.claim?.claim_id === "c1", "S2", "per-team title and claim", JSON.stringify(gcE?.title));
const g2 = rows.filter((r) => r.gameId === "g2");
// g2 is an interleague game WE host: Field prep ×2 plus GameChanger for our team only (Giants).
ok(g2.length === 3 && g2.filter((r) => r.roleId === "rGC").length === 1 && g2.every((r) => r.note?.startsWith("Partner league asked to move") === true),
  "S2", "interleague move note; per-team for our team only", JSON.stringify(g2.map((r) => r.title)));
const g3 = rows.find((r) => r.gameId === "g3");
ok(g3?.note?.startsWith("Rained out.") === true, "S2", "rained-out note");
ok(rows.every((r, i) => i === 0 || rows[i - 1].start <= r.start), "S2", "time order");
counters.filled = rows.filter((r) => r.claim).length;
counters.open = rows.filter((r) => !r.claim).length;
counters.noted = rows.filter((r) => r.note).length;

// S3
const byRole = applyFilters(rows, { roleId: "rFP", divisionId: null, show: "all" });
ok(byRole.length > 0 && byRole.every((r) => r.roleId === "rFP"), "S3", "role filter");
ok(applyFilters(rows, { roleId: null, divisionId: "dA", show: "all" }).length === 0, "S3", "division filter (no AAA spots)");
const openOnly = applyFilters(rows, { roleId: null, divisionId: null, show: "open" });
const filledOnly = applyFilters(rows, { roleId: null, divisionId: null, show: "filled" });
ok(openOnly.every((r) => !r.claim) && filledOnly.every((r) => r.claim) && openOnly.length + filledOnly.length === rows.length, "S3", "open / filled");

// S4
const { upcoming, past } = splitByTime(rows, "2027-03-06T10:00");
ok(upcoming.every((r) => r.start.slice(0, 10) >= "2027-03-06") && upcoming.some((r) => r.gameId === "g2"), "S4", "upcoming = today or later");
const g1Up = upcoming.filter((r) => r.gameId === "g1");
ok(g1Up.length === 4 && g1Up.every((r) => startedTag(r, "2027-03-06T10:00") === "Started"), "S4", "today's started spots stay listed, tagged Started",
  JSON.stringify(g1Up.map((r) => [r.title, startedTag(r, "2027-03-06T10:00")])));
ok(upcoming.filter((r) => r.gameId === "g2").every((r) => startedTag(r, "2027-03-06T10:00") === null), "S4", "a later spot today isn't Started");
ok(past.length === 1 && past[0].claim?.claim_id === "c4", "S4", "past = filled, before today", JSON.stringify(past.map((r) => r.claim?.claim_id)));
ok(!past.some((r) => r.gameId === "g1"), "S4", "no no-show tick on today's spots");
counters.past = past.length;

// S5
const lost = lostGroups(CLAIMS, TEAMS, DIV);
ok(lost.length === 1 && lost[0].claims.length === 2 && lost[0].divisionName === "Majors", "S5", "grouped", JSON.stringify(lost.map((g) => [g.divisionName, g.day, g.claims.length])));
ok(lostTitle(lost[0]) === "2 sign-ups lost when Majors games were removed or regenerated on Mar 2", "S5", "title", lostTitle(lost[0]));
ok(lostDetail(2).includes("Both volunteers") && lostDetail(1).startsWith("That game"), "S5", "detail");
counters.lost = lost.length;

// S6
const csv = signupsCsv(rows, TEAMS, DIV).split("\r\n");
ok(csv[0] === "Date,Time,Spot,Division,Game,Field,Spot number,Volunteer,Family team,Email,Filled by,No-show", "S6", "header", csv[0]);
ok(csv.length === rows.length + 1, "S6", "one line per spot");
ok(csv.some((l) => l.startsWith("2027-03-06,08:30,Field prep,Majors,Expos vs Pirates,Field 1,1 of 2,,,,Open,")), "S6", "an open spot",
  csv.find((l) => l.includes("Field prep")) ?? "");
const evil = signupsCsv(rows.slice(0, 1).map((r) => ({ ...r, title: "=HYPERLINK(1)", matchup: 'A, "B"' })), TEAMS, DIV).split("\r\n")[1];
ok(evil.includes(",'=HYPERLINK(1),") && evil.includes('"A, ""B"""'), "S6", "formula made inert; quotes escaped", evil);

// S7
for (const s of ["invalid_input", "wrong_team", "already_signed_up", "overlap_confirm_needed", "just_taken", "rained_out", "past", "unpublished", "closed", "no_slot"]) {
  const line = assignStatusLine(s);
  ok(!!line && !line.startsWith("Couldn't save"), "S7", `worded: ${s}`, String(line));
}
ok(assignStatusLine("assigned") === null, "S7", "assigned → no line");
ok(assignStatusLine("weird")?.startsWith("Couldn't save") === true, "S7", "unknown → generic");

// R1–R5
{
  const now = "2027-03-05T10:00";
  const n1 = nextUp(rows, now);
  // Mar 6 filled: c1 (A. Garcia, volunteer v-c1), c2 (M. Patel, v-c2) → 2 volunteers
  ok(n1?.day === "2027-03-06" && n1.volunteers === 2 && n1.claimIds.length === 2 && n1.sentOn === null, "R1", "next day, not sent", JSON.stringify(n1));
  const reminded = rows.map((r) => (r.claim && r.start.startsWith("2027-03-06") ? { ...r, claim: { ...r.claim, last_reminded_on: r.claim.claim_id === "c1" ? "2027-03-04" : null } } : r));
  ok(nextUp(reminded, now)?.sentOn === null, "R1", "one of two reminded → not sent");
  const allR = rows.map((r) => (r.claim && r.start.startsWith("2027-03-06") ? { ...r, claim: { ...r.claim, last_reminded_on: r.claim.claim_id === "c1" ? "2027-03-04" : "2027-03-03" } } : r));
  ok(nextUp(allR, now)?.sentOn === "2027-03-03", "R1", "all reminded → the earliest date", JSON.stringify(nextUp(allR, now)));
  ok(nextUp(rows, "2027-03-30T00:00") === null, "R1", "nothing ahead → no banner");
  const l = nextUpLines(n1!);
  ok(l.title === "Next up: Sat, Mar 6 · 2 volunteers signed up" && l.button === "Remind all 2 for Mar 6" && l.status.startsWith("Reminder not sent yet."),
    "R2", "banner words", JSON.stringify(l));
  ok(nextUpLines({ ...n1!, volunteers: 1 }).button === "Remind 1 volunteer for Mar 6", "R2", "one volunteer");
  ok(nextUpLines({ ...n1!, sentOn: "2027-03-04" }).status.startsWith("Reminder sent Mar 4."), "R2", "sent status");
  const filledAhead = rows.find((r) => r.claim && r.start >= now)!;
  ok(remindable(filledAhead, now) && !remindable(filledAhead, "2027-03-06T09:30") && !remindable(rows.find((r) => !r.claim)!, now), "R3",
    "filled and not started only");
  const all2 = remindOutcome({ queued: 2, reminded: 3, skipped: 0 }, "all");
  ok(all2.ok && all2.line === "Reminders sent to 2 volunteers.", "R4", "remind all → names the count", all2.line);
  ok(remindOutcome({ queued: 1, reminded: 1, skipped: 0 }, "all").line === "Reminder sent to 1 volunteer.", "R4", "remind all, one volunteer → singular");
  const one = remindOutcome({ queued: 1, reminded: 1, skipped: 0 }, "one");
  ok(one.ok && one.line === "Reminder sent.", "R4", "single remind → Reminder sent.", one.line);
  ok(remindOutcome({ queued: 1, reminded: 1, skipped: 1 }, "all").line.includes("1 spot was left out"), "R4", "skipped named");
  ok(!remindOutcome({ queued: 0, reminded: 0, skipped: 2 }, "all").ok, "R4", "none queued → failure");
  ok(remindOutcome({ queued: 0, reminded: 0, skipped: 0 }, "one").line === "Couldn't send the reminder. Nothing was sent — try again.", "R4", "failure wording unchanged");
  ok(!remindOutcome(null, "one").ok && !remindOutcome({ queued: "2" }, "all").ok, "R4", "unreadable → failure");
  ok(remindedLine({ last_reminded_on: "2027-03-04" }) === "Reminded Mar 4" && remindedLine({ last_reminded_on: null }) === null, "R5", "league date");
  const comp = read("src/components/volunteers/signups-screen.tsx");
  ok(comp.includes('sendReminder(seasonId, claimIds, "one")') && comp.includes('sendReminder(seasonId, next.claimIds, "all")'),
    "R5", "the row's Remind says one, the banner's Remind all says all");
  ok(comp.includes('rpc("volunteer_admin_remind", { p_season_id: seasonId, p_claim_ids: claimIds })') && comp.includes("if (out.ok) router.refresh();"),
    "R5", "the screen sends through volunteer_admin_remind and trusts only a readable count");
}

// W1
const page = read("src/app/(dashboard)/dashboard/volunteers/signups/page.tsx");
ok(/if \(signups\.error \|\| !reply \|\| !Array\.isArray\(reply\.claims\) \|\| typeof reply\.today !== "string"\) \{\s*throw/.test(page),
  "W1", "a failed or malformed sign-up read throws (error card)");
const comp = read("src/components/volunteers/signups-screen.tsx");
ok(comp.includes('if (status === "assigned") {') && comp.includes('?.status !== "canceled"') && comp.includes('?.status !== "saved"'),
  "W1", "only a confirming reply counts as done");

for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${failures.length} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`sim:volunteer-signups — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);
