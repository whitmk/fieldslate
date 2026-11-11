// Harness for the officials' game-change emails (0130), app side: the words
// (src/lib/umpires/change-notice.ts), the two templates, the drain's row
// parser, the officials banner's new lines and the notice-state line. Drives
// the REAL modules; every expected sentence is written out by hand here.
// Run under three host zones (UTC, Los Angeles, Kiritimati): times are the
// stored wall clock, so the answer must not move with the host.
//
// ASSERTIONS
//   K1  the kind from (was, now): on→off Rained out; off→on same start Back
//       on; off→on new start Makeup set; on→on Moved; off→off Rained out;
//       removed Taken off
//   W1  every entry's lines, adult wording, exact
//   W2  youth wording (the parent's email) names the official, exact
//   W3  the four problem lines (adult and youth), exact
//   W4  opening and closing lines; no closing when every entry is a removal,
//       or when every game still theirs is rained out
//   S1  subject for one game per kind; for several; youth several
//   P1  the parsers: a malformed entry, a bad start, an unknown problem key or
//       a bad "other" makes the WHOLE list unreadable (null), never a partial
//   R1  the game_changes template renders the blocks verbatim; html escapes
//       names
//   R2  a game_changes row with no changes, unreadable changes, or no name
//       renders NOTHING (the drain fails it unknown_kind)
//   R3  the coordinator's template: subject, opening, one line per entry
//       (the clash's other game named), the www Officials link, the short
//       footer; nothing when empty
//   R4  every official's email still ends "Reply to this email to reach your
//       league" (replies go to the confirmed officials contact)
//   Q1  SOURCE: the reply-to is the confirmed officials contact and only that
//       — the take reads s.contact_email from official_signup_settings (0126
//       writes it only after the link is confirmed) and never a profile
//       email; a row with no contact fails no_contact_email; the drain fails
//       a row without a usable reply-to; the triggers queue nothing without a
//       confirmed contact (proof GC5 / MG6)
//   T1  every kind the officials outbox can hold (0130's CHECK, read from the
//       migration) has a template — OFFICIAL_EMAIL_KINDS equals it and each
//       renders from a minimal row
//   D1  the drain's parser reads `changes` / `conflicts` for their kinds only
//   B1  the officials banner: "No email on file", the two kind labels, and the
//       officials' trigger-failure sentence; a reply without the count is
//       unreadable
//   N1  the notice-state reply and the Officials page line for each state
//   N2  the youth-email check line: youth + an email + entered before the
//       parent's-email label (0124)
//   F1  SOURCE: no notes in the officials change words or templates; the
//       0130 trigger bodies name no volunteer_ object
// ANTI-VACUITY: each kind worded; a youth email; a problem line; a removal.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:official-change-notice:mutants, three zones).
// Run 1 (2026-11-11): 12/12 at their own line, three zones; CN2 (a time read
// in the host's zone) passes under UTC and dies at W1 in the other two.
// Run 2 (2026-11-11, + N2 / CN13, the youth-email check): 13/13.
// Run 3 (2026-11-11, Whit's wording review: role label, taken-off body, youth
// opening, no closing on rainout-only, coordinator footer; + Q1 reply-to):
// 16/17 — CN4 SURVIVED. The new rainout rule made it equivalent (deleting
// the empty-list line changes nothing: [].every(...) is true). Re-aimed at
// the removal filter itself.
// Run 4: 17/17 at their own line.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  changeKind,
  changesClosing,
  changesOpening,
  changesSubject,
  conflictLine,
  entryLines,
  parseChangeEntries,
  parseConflictEntries,
  problemLine,
  type ChangeEntry,
} from "@/lib/umpires/change-notice";
import { renderOfficialEmail, OFFICIAL_EMAIL_KINDS, type OfficialOutboxRow } from "@/lib/officials-signup/email-templates";
import { parseOfficialRows } from "@/lib/officials-signup/drain-runner";
import { OFFICIAL_PROBLEMS } from "@/lib/officials-signup/email-problems";
import { kindLabel, parseProblems, problemsView, whyLine } from "@/lib/outbound-email/problems";
import { noticeOffLine, parseNoticeState, youthEmailCheck, NOTICE_UNREADABLE, YOUTH_EMAIL_CHECK } from "@/lib/umpires/notice-state";

const ROOT = join(__dirname, "../..");
let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function eq<T>(got: T, want: T, name: string) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(g === w, name, `got ${g}\n          want ${w}`);
}
const counters = { kinds: 0, youth: 0, problem: 0, removal: 0 };
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const LEAGUE = "Santa Rosa Test LL";
const ADULT = { youth: false, name: "Sam", league: LEAGUE };
const YOUTH = { youth: true, name: "Cal", league: LEAGUE };

// Entries as the take sends them.
const RAW = {
  moved: {
    change: "changed", game_id: "g1", game_umpire_id: "gu1", start: "2026-10-17T15:30", minutes: 120, division: "Majors",
    home: "Expos", away: "Mets", field: "Monroe Complex — Andrews", role: "Plate", cancelled: false,
    was: { start: "2026-10-17T13:00", field: "Monroe Complex — Polley", cancelled: false }, problem: null,
  },
  rained: {
    change: "changed", game_id: "g2", game_umpire_id: "gu2", start: "2026-10-17T09:00", minutes: 90, division: "Minors",
    home: "Royals", away: "Cubs", field: "Monroe Complex — Polley", role: "Base", cancelled: true,
    was: { start: "2026-10-17T09:00", field: "Monroe Complex — Polley", cancelled: false }, problem: null,
  },
  makeup: {
    change: "changed", game_id: "g3", game_umpire_id: "gu3", start: "2026-10-24T13:00", minutes: 120, division: "Majors",
    home: "Expos", away: "Mets", field: "Monroe Complex — Andrews", role: "Plate", cancelled: false,
    was: { start: "2026-10-10T13:00", field: "Monroe Complex — Andrews", cancelled: true }, problem: "time_conflict",
  },
  backOn: {
    change: "changed", game_id: "g4", game_umpire_id: "gu4", start: "2026-10-18T10:00", minutes: 90, division: "Minors",
    home: "Royals", away: "Cubs", field: null, role: "Plate", cancelled: false,
    was: { start: "2026-10-18T10:00", field: null, cancelled: true }, problem: null,
  },
  stillOff: {
    change: "changed", game_id: "g5", game_umpire_id: "gu5", start: "2026-10-19T10:00", minutes: 90, division: "Minors",
    home: "Royals", away: "Cubs", field: "Monroe Complex — Polley", role: "Plate", cancelled: true,
    was: { start: "2026-10-18T10:00", field: "Monroe Complex — Polley", cancelled: true }, problem: null,
  },
  removed: {
    change: "removed", game_umpire_id: "gu6", start: "2026-10-25T13:00", minutes: 120, division: "Majors",
    home: "Expos", away: "Mets", field: "Monroe Complex — Andrews", role: "Plate",
  },
};

function entries(...raws: unknown[]): ChangeEntry[] {
  const p = parseChangeEntries(raws);
  if (!p) throw new Error("fixture didn't parse");
  return p;
}

function row(over: Partial<OfficialOutboxRow>): OfficialOutboxRow {
  return {
    id: 7, kind: "game_changes", payload: {}, attempts: 1, to: "sam@example.com", leagueName: LEAGUE,
    replyTo: "umps@example.com", seasonName: "Fall", officialName: "Sam", youth: false, linkToken: null,
    game: null, spots: [], claims: [], changes: null, conflicts: null, ...over,
  };
}

function main() {
  // ── K ───────────────────────────────────────────────────────────────────
  {
    const [m, r, mk, b, so, rm] = entries(RAW.moved, RAW.rained, RAW.makeup, RAW.backOn, RAW.stillOff, RAW.removed);
    eq([changeKind(m), changeKind(r), changeKind(mk), changeKind(b), changeKind(so), changeKind(rm)],
      ["moved", "rained_out", "makeup_set", "back_on", "rained_out", "taken_off"], "[K1] kind from (was, now)");
  }

  // ── W ───────────────────────────────────────────────────────────────────
  {
    const [m, r, mk, b, rm] = entries(RAW.moved, RAW.rained, RAW.makeup, RAW.backOn, RAW.removed);
    eq(entryLines(m, ADULT), [
      "Moved — Majors · Expos vs Mets · Your role: Plate",
      "Now: Sat, Oct 17 · 3:30 PM · Monroe Complex — Andrews",
      "Was: Sat, Oct 17 · 1:00 PM · Monroe Complex — Polley",
    ], "[W1] moved");
    eq(entryLines(r, ADULT), [
      "Rained out — Minors · Royals vs Cubs · Your role: Base",
      "Sat, Oct 17 · 9:00 AM · Monroe Complex — Polley",
      "You're still assigned. If a makeup date is set, we'll email you.",
    ], "[W1] rained out");
    eq(entryLines(mk, ADULT), [
      "Makeup set — Majors · Expos vs Mets · Your role: Plate",
      "Now: Sat, Oct 24 · 1:00 PM · Monroe Complex — Andrews",
      "Was: rained out Sat, Oct 10 · 1:00 PM",
      "It now overlaps another game you're assigned to. Santa Rosa Test LL has been told.",
    ], "[W1] makeup set (with its problem)");
    eq(entryLines(b, ADULT), [
      "Back on — Minors · Royals vs Cubs · Your role: Plate",
      "Sun, Oct 18 · 10:00 AM",
      "The rainout was lifted; the game is at its original time.",
    ], "[W1] back on (no field)");
    eq(entryLines(rm, ADULT), [
      "Taken off — Majors · Expos vs Mets · Your role: Plate",
      "Sun, Oct 25 · 1:00 PM · Monroe Complex — Andrews",
      "The schedule changed and you're no longer assigned to this game. Santa Rosa Test LL will let you know if you're needed.",
    ], "[W1] taken off");
    counters.kinds += 5;
    counters.removal++;
    counters.problem++;

    eq(entryLines(r, YOUTH)[2], "Cal is still assigned. If a makeup date is set, we'll email you.", "[W2] youth rained out");
    eq(entryLines(rm, YOUTH)[2],
      "The schedule changed and Cal is no longer assigned to this game. Santa Rosa Test LL will let you know if Cal is needed.",
      "[W2] youth taken off");
    eq(entryLines(mk, YOUTH)[3], "It now overlaps another game Cal is assigned to. Santa Rosa Test LL has been told.", "[W2] youth problem");
    counters.youth++;

    eq([problemLine("time_conflict", ADULT), problemLine("blackout", ADULT), problemLine("outside_availability", ADULT),
        problemLine("over_weekly_limit", ADULT)], [
      "It now overlaps another game you're assigned to. Santa Rosa Test LL has been told.",
      "It's now on a date you said you can't work. Santa Rosa Test LL has been told.",
      "It's now outside the hours you said you can work. Santa Rosa Test LL has been told.",
      "It now puts you over the games a week you said you can work. Santa Rosa Test LL has been told.",
    ], "[W3] problem lines, adult");
    eq([problemLine("time_conflict", YOUTH), problemLine("blackout", YOUTH), problemLine("outside_availability", YOUTH),
        problemLine("over_weekly_limit", YOUTH)], [
      "It now overlaps another game Cal is assigned to. Santa Rosa Test LL has been told.",
      "It's now on a date Cal can't work. Santa Rosa Test LL has been told.",
      "It's now outside the hours Cal can work. Santa Rosa Test LL has been told.",
      "It now puts Cal over the games a week Cal can work. Santa Rosa Test LL has been told.",
    ], "[W3] problem lines, youth");

    eq(changesOpening([m], ADULT), ["Hi Sam,", "A game you're assigned to has changed."], "[W4] opening, one");
    eq(changesOpening([m, r], ADULT), ["Hi Sam,", "Some games you're assigned to have changed."], "[W4] opening, several");
    eq(changesOpening([m], YOUTH), ["Hi, this is about Cal's game assignments.", "A game Cal is assigned to has changed."],
      "[W4] opening, youth");
    eq(changesClosing([m], ADULT),
      "You're still assigned to this game. If you can't make it, reply to this email to let Santa Rosa Test LL know.",
      "[W4] closing, one");
    eq(changesClosing([m, r], ADULT),
      "You're still assigned to these games. If you can't make a new time, reply to this email to let Santa Rosa Test LL know.",
      "[W4] closing, several");
    eq(changesClosing([m, r], YOUTH),
      "Cal is still assigned to these games. If Cal can't make a new time, reply to this email to let Santa Rosa Test LL know.",
      "[W4] closing, youth");
    eq(changesClosing([rm], ADULT), null, "[W4] no closing when every entry is a removal");
    eq(changesClosing([r], ADULT), null, "[W4] no closing when every game still theirs is rained out");
    eq(changesClosing([r, rm], ADULT), null, "[W4] rained out + taken off → no closing");
    eq(changesClosing([r, m], ADULT),
      "You're still assigned to these games. If you can't make a new time, reply to this email to let Santa Rosa Test LL know.",
      "[W4] a rainout with a move keeps the closing");
    eq(changesClosing([m, rm], ADULT),
      "You're still assigned to this game. If you can't make it, reply to this email to let Santa Rosa Test LL know.",
      "[W4] closing counts only the games still theirs");
  }

  // ── S ───────────────────────────────────────────────────────────────────
  {
    const [m, r, mk, b, rm] = entries(RAW.moved, RAW.rained, RAW.makeup, RAW.backOn, RAW.removed);
    eq([changesSubject([m], ADULT), changesSubject([r], ADULT), changesSubject([mk], ADULT), changesSubject([b], ADULT),
        changesSubject([rm], ADULT)], [
      "Game moved: Sat, Oct 17 — Majors, Expos vs Mets",
      "Rained out: Sat, Oct 17 — Minors, Royals vs Cubs",
      "Makeup set: Sat, Oct 24 — Majors, Expos vs Mets",
      "Back on: Sun, Oct 18 — Minors, Royals vs Cubs",
      "Taken off a game: Sun, Oct 25 — Majors, Expos vs Mets",
    ], "[S1] one game");
    eq(changesSubject([m, r, mk], ADULT), "3 of your games changed", "[S1] several");
    eq(changesSubject([m, r], YOUTH), "2 of Cal's games changed", "[S1] youth several");
  }

  // ── P ───────────────────────────────────────────────────────────────────
  {
    ok(parseChangeEntries([RAW.moved, { ...RAW.rained, start: "Oct 17" }]) === null, "[P1] a bad start makes the list unreadable");
    ok(parseChangeEntries([RAW.moved, { ...RAW.makeup, problem: "teleported" }]) === null, "[P1] an unknown problem key");
    ok(parseChangeEntries([{ ...RAW.moved, was: { start: "2026-10-17T13:00", field: null } }]) === null, "[P1] was without cancelled");
    ok(parseChangeEntries([{ ...RAW.moved, change: "edited" }]) === null, "[P1] an unknown change");
    ok(parseChangeEntries("nope") === null, "[P1] not a list");
    eq(parseChangeEntries([])?.length, 0, "[P1] an empty list is read (the template refuses it)");
    const c = { start: "2026-10-17T13:00", division: "Majors", home: "Expos", away: "Mets", field: null, role: "Plate",
                official_name: "Sam R.", problem: "time_conflict",
                other: { start: "2026-10-17T13:30", division: "Minors", home: "Royals", away: "Cubs", field: null, role: "Base" } };
    eq(parseConflictEntries([c])?.length, 1, "[P1] a conflict entry reads");
    ok(parseConflictEntries([{ ...c, other: { start: "x" } }]) === null, "[P1] a bad other game");
    ok(parseConflictEntries([{ ...c, problem: null }]) === null, "[P1] a conflict without a problem");
    ok(parseConflictEntries([{ ...c, official_name: "" }]) === null, "[P1] a conflict without a name");
  }

  // ── R ───────────────────────────────────────────────────────────────────
  {
    const changes = entries(RAW.moved, RAW.removed);
    const e = renderOfficialEmail(row({ changes }));
    ok(e !== null, "[R1] renders");
    if (e) {
      eq(e.subject, "2 of your games changed", "[R1] subject");
      eq(e.text.split("\n"), [
        LEAGUE, "",
        "Hi Sam,", "Some games you're assigned to have changed.", "",
        "Moved — Majors · Expos vs Mets · Your role: Plate",
        "Now: Sat, Oct 17 · 3:30 PM · Monroe Complex — Andrews",
        "Was: Sat, Oct 17 · 1:00 PM · Monroe Complex — Polley", "",
        "Taken off — Majors · Expos vs Mets · Your role: Plate",
        "Sun, Oct 25 · 1:00 PM · Monroe Complex — Andrews",
        "The schedule changed and you're no longer assigned to this game. Santa Rosa Test LL will let you know if you're needed.", "",
        "You're still assigned to this game. If you can't make it, reply to this email to let Santa Rosa Test LL know.", "",
        "Sent by FieldSlate for Santa Rosa Test LL. Reply to this email to reach your league.",
      ], "[R1] text, verbatim");
      ok(!/https?:\/\//.test(e.text), "[R1] no link in the official's email");
    }
    const evil = renderOfficialEmail(row({ officialName: "<b>Sam</b>", changes: entries({ ...RAW.moved, home: "Ex<pos>" }) }));
    ok(!!evil && !evil.html.includes("<b>Sam</b>") && evil.html.includes("Ex&lt;pos&gt;"), "[R1] html escapes names");

    ok(renderOfficialEmail(row({ changes: [] })) === null, "[R2] no changes → nothing");
    ok(renderOfficialEmail(row({ changes: null })) === null, "[R2] unreadable changes → nothing");
    ok(renderOfficialEmail(row({ officialName: null, changes })) === null, "[R2] no name → nothing");

    const conflicts = parseConflictEntries([
      { start: "2026-10-17T13:00", division: "Majors", home: "Expos", away: "Mets", field: null, role: "Plate",
        official_name: "Sam R.", problem: "time_conflict",
        other: { start: "2026-10-17T13:30", division: "Minors", home: "Royals", away: "Cubs", field: null, role: "Base" } },
      { start: "2026-10-18T10:00", division: "Minors", home: "Royals", away: "Cubs", field: null, role: "Base",
        official_name: "Jo P.", problem: "blackout", other: null },
    ]);
    const k = renderOfficialEmail(row({ kind: "assignment_conflicts", officialName: null, to: "umps@example.com", conflicts }));
    ok(k !== null, "[R3] renders");
    if (k) {
      eq(k.subject, "2 official assignments need a look", "[R3] subject");
      eq(k.text.split("\n"), [
        LEAGUE, "",
        "A schedule change put these officials on games they may not be able to work. Nobody was taken off a game — check each one and reassign if needed.",
        "",
        "- Sam R. — Majors · Expos vs Mets · Plate · Sat, Oct 17 · 1:00 PM: overlaps another game they're assigned to (Minors · Royals vs Cubs · Sat, Oct 17 · 1:30 PM)",
        "- Jo P. — Minors · Royals vs Cubs · Base · Sun, Oct 18 · 10:00 AM: is on a date they said they can't work",
        "",
        "Open Officials: https://www.thefieldslate.com/dashboard/umpires",
        "",
        "Sent by FieldSlate for Santa Rosa Test LL.",
      ], "[R3] text, verbatim (the coordinator's footer: no \"reply to reach your league\")");
      ok(k.html.includes(">Sent by FieldSlate for Santa Rosa Test LL.</p>"), "[R3] html footer too");
    }
    eq(conflictLine(conflicts![1]), "Jo P. — Minors · Royals vs Cubs · Base · Sun, Oct 18 · 10:00 AM: is on a date they said they can't work",
      "[R3] a line without another game");
    ok(renderOfficialEmail(row({ kind: "assignment_conflicts", conflicts: [] })) === null, "[R3] no conflicts → nothing");

    const own = renderOfficialEmail(row({ changes: entries(RAW.rained) }));
    ok(!!own && own.text.endsWith("Sent by FieldSlate for Santa Rosa Test LL. Reply to this email to reach your league."),
      "[R4] the official's email keeps the reply line");
    ok(!!own && !own.text.includes("reply to this email to let"), "[R4] a rainout-only email has no closing");
  }

  // ── Q ───────────────────────────────────────────────────────────────────
  {
    const mig = read("supabase/migrations/0130_official_game_change_notices.sql");
    const take = mig.slice(mig.indexOf("create or replace function public.official_outbox_take("), mig.indexOf("-- 7. The officials email banner"));
    ok(/'reply_to', s\.contact_email,/.test(take) && /left join public\.official_signup_settings s on s\.owner_id = t\.owner_id/.test(take),
      "[Q1] the take's reply-to is official_signup_settings.contact_email");
    ok(!/profiles?\.email|p\.email|auth\.users/.test(take), "[Q1] the take never reads an account email");
    ok(/error = 'no_contact_email'/.test(take) && /s\.contact_email is not null/.test(take), "[Q1] no confirmed contact → the row fails, never sends");
    const notice = mig.slice(mig.indexOf("create or replace function public.official_notice_on("), mig.indexOf("-- A field as the emails show it"));
    ok(/s\.contact_email is not null/.test(notice), "[Q1] the trigger gate requires a confirmed contact");
    const drain = read("src/lib/outbound-email/outbox-drain.ts");
    ok(/const replyTo = safeReplyTo\(row\.replyTo\);\s*if \(!replyTo\) \{\s*await finish\(row, false, null, "bad_reply_to", false\);/.test(drain),
      "[Q1] the drain fails a row without a usable reply-to");
  }

  // ── T ───────────────────────────────────────────────────────────────────
  {
    const migs = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    let kinds: string[] = [];
    for (const f of migs) {
      const sql = read(`supabase/migrations/${f}`);
      const i = sql.lastIndexOf("official_outbox_kind_check check (kind in (");
      const j = i >= 0 ? -1 : sql.indexOf("kind            text not null check (kind in (");
      const at = i >= 0 ? i : j;
      if (at < 0 || (j >= 0 && !f.startsWith("0124"))) continue;
      const tail = sql.slice(at, sql.indexOf("))", at));
      kinds = [...tail.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    }
    ok(kinds.length >= 7, "[T1] the officials outbox kinds were read from the latest migration", kinds.join(","));
    eq([...OFFICIAL_EMAIL_KINDS].sort(), [...kinds].sort(), "[T1] every kind the outbox can hold has a template");
    const minimal: Record<string, Partial<OfficialOutboxRow>> = {
      help_request: { linkToken: "a".repeat(64) },
      claim_confirmed: { game: { game_id: "g", start: "2026-10-17T13:00", minutes: 90, division: null, home: null, away: null, field: null, role: "Plate" } },
      drop_confirmed: { game: { game_id: "g", start: "2026-10-17T13:00", minutes: 90, division: null, home: null, away: null, field: null, role: "Plate" } },
      drop_notice: { game: { game_id: "g", start: "2026-10-17T13:00", minutes: 90, division: null, home: null, away: null, field: null, role: "Plate" } },
      claims_digest: { claims: [{ game_id: "g", start: "2026-10-17T13:00", minutes: 90, division: null, home: null, away: null, field: null, role: "Plate", official_name: "Sam" }] },
      game_changes: { changes: entries(RAW.moved) },
      assignment_conflicts: { conflicts: parseConflictEntries([{ start: "2026-10-17T13:00", role: "Plate", official_name: "Sam", problem: "blackout" }]) },
    };
    for (const kind of kinds) {
      ok(renderOfficialEmail(row({ kind, ...(minimal[kind] ?? {}) })) !== null, `[T1] ${kind} renders from a minimal row`);
    }
  }

  // ── D ───────────────────────────────────────────────────────────────────
  {
    const { rows } = parseOfficialRows([
      { id: 1, kind: "game_changes", payload: {}, attempts: 1, to: "a@b.co", league_name: LEAGUE, reply_to: "c@d.co",
        official_name: "Sam", youth: false, changes: [RAW.moved], conflicts: null },
      { id: 2, kind: "assignment_conflicts", payload: {}, attempts: 1, to: "c@d.co", league_name: LEAGUE, reply_to: "c@d.co",
        official_name: null, youth: false, changes: null,
        conflicts: [{ start: "2026-10-17T13:00", role: "Plate", official_name: "Sam", problem: "blackout" }] },
      { id: 3, kind: "claim_confirmed", payload: {}, attempts: 1, changes: [RAW.moved] },
    ]);
    eq(rows.map((r) => [r.id, r.changes?.length ?? null, r.conflicts?.length ?? null]),
      [[1, 1, null], [2, null, 1], [3, null, null]], "[D1] changes / conflicts read for their kinds only");
  }

  // ── B ───────────────────────────────────────────────────────────────────
  {
    eq(whyLine("no_email"), "No email on file", "[B1] no_email");
    eq([kindLabel("game_changes"), kindLabel("assignment_conflicts")], ["Game change notice", "Assignment check"], "[B1] kind labels");
    const p = parseProblems({
      timezone: "America/Los_Angeles",
      failed: [{ id: 9, kind: "game_changes", error: "no_email", official_name: "Sam R.", to_contact: false, game: null }],
      waiting: { count: 0, reason: null, until: null },
      trigger_failures: 2,
    }, "officials", OFFICIAL_PROBLEMS.describe);
    const v = p ? problemsView(p, "officials") : null;
    eq(v?.summary, "1 email didn't go out. 2 schedule changes couldn't be checked for officials' emails.", "[B1] officials summary");
    eq(v?.items, [{ id: 9, line: "Sam R. — Game change notice", why: "No email on file" }], "[B1] the no-email row");
    eq(parseProblems({ failed: [], waiting: { count: 0 } }, "officials", OFFICIAL_PROBLEMS.describe), null,
      "[B1] an officials reply without the trigger-failure count is unreadable");
  }

  // ── N ───────────────────────────────────────────────────────────────────
  {
    const st = (o: Record<string, boolean>) =>
      parseNoticeState({ elite: true, feature: true, contact_confirmed: true, notify: true, on: true, ...o });
    eq(noticeOffLine(st({})), null, "[N1] on → nothing");
    eq(noticeOffLine(st({ on: false, contact_confirmed: false })),
      "Officials aren't emailed when games change. Confirm an officials contact email in Settings to turn this on.", "[N1] no contact");
    eq(noticeOffLine(st({ on: false, notify: false })),
      "Officials aren't emailed when games change. Turn it on in Settings, under Officials sign-up.", "[N1] switched off");
    eq(noticeOffLine(st({ on: false, elite: false })), null, "[N1] not Elite → nothing (the page is Elite)");
    eq(noticeOffLine(st({ on: false, feature: false })), null, "[N1] feature off → nothing");
    eq(noticeOffLine(null), NOTICE_UNREADABLE, "[N1] unreadable");
    eq(parseNoticeState({ elite: true, feature: true, notify: true, on: true }), null, "[N1] a reply missing a key is unreadable");

    eq(youthEmailCheck({ designation: "youth", email: "kid@example.com", created_at: "2026-11-08T17:00:00+00:00" }), YOUTH_EMAIL_CHECK,
      "[N2] a youth official with an email entered before the parent's-email label");
    eq(youthEmailCheck({ designation: "youth", email: "kid@example.com", created_at: "2026-11-09T23:59:00+00:00" }), YOUTH_EMAIL_CHECK,
      "[N2] entered the day the label shipped (to be safe)");
    eq(youthEmailCheck({ designation: "youth", email: "parent@example.com", created_at: "2026-11-10T00:00:00+00:00" }), null,
      "[N2] entered after → nothing");
    eq(youthEmailCheck({ designation: "adult", email: "a@example.com", created_at: "2026-10-01T00:00:00+00:00" }), null, "[N2] adult → nothing");
    eq(youthEmailCheck({ designation: "youth", email: "  ", created_at: "2026-10-01T00:00:00+00:00" }), null, "[N2] no email → nothing");
  }

  // ── F ───────────────────────────────────────────────────────────────────
  {
    const words = read("src/lib/umpires/change-notice.ts") + read("src/lib/officials-signup/email-templates.ts");
    ok(!/\bnotes\b/.test(words.replace(/\/\/.*$/gm, "")), "[F1] no notes in the officials change words or templates");
    const mig = read("supabase/migrations/0130_official_game_change_notices.sql");
    for (const fn of ["official_on_game_change", "official_on_game_delete", "official_change_entries", "official_conflict_entries"]) {
      const at = mig.indexOf(`create or replace function public.${fn}(`);
      const open = mig.indexOf("$$", at);
      const body = mig.slice(open, mig.indexOf("$$", open + 2));
      ok(at >= 0 && body.length > 50 && !/volunteer_/.test(body), `[F1] ${fn} names no volunteer_ object`);
    }
  }

  for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
  console.log(`${checks - fails}/${checks} checks passed (TZ=${process.env.TZ ?? "host"})`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(fails ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.log(`  FAIL: [CRASH] ${(e as Error).stack ?? e}`);
  process.exit(1);
}
