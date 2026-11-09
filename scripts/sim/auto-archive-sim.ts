// Harness for the auto-archive rule (2026-10-19, fix/auto-archive). Drives the
// REAL decision (src/lib/seasons/archive-decision.ts) and the REAL write-on-read
// helper (src/lib/seasons/auto-archive.ts) against a small in-memory fake
// Supabase client, at a FIXED "now". Also the end-date editor's rules
// (src/lib/seasons/end-date.ts).
//
// THE CLOCK. NOW = 2026-10-26T03:00:00Z — 8pm on SUNDAY OCT 25 in Los Angeles
// (the league's timezone), already Oct 26 in UTC. The old helper read the
// server's date (UTC on Vercel), so a season ending Oct 25 archived during the
// evening of its own last day.
//
// THE RULE (all must hold): end date < today in the league's timezone; no game
// of any kind dated today or later; no playoff game without a result or without
// a date. Anything unreadable → no archive. Regular-season status and scores are
// never consulted.
//
// ASSERTIONS (each mutant must die FIRST at its own tag — see the mutants file)
//   D1   end date passed, nothing left → archive
//   E1   end date == today → not archived (the last day is a season day)
//   G1   a regular-season game after today (status cancelled, even) blocks
//   G2   a game dated TODAY blocks
//   G3   past regular-season games with no score and status "scheduled" don't
//        block (status/scores are never read)
//   P1   a dated playoff game after the end date blocks
//   P2   an UNDATED playoff game blocks
//   P3   a dated past playoff game with no result blocks
//   R1   every playoff game dated, in the past, with a result → archive
//   U1   unreadable today / games / playoffs → no archive
//   TZ1  through the real helper: the evening of the end date in Pacific → not
//        archived; the next Pacific day → archived
//   I1   through the real helper: a ready season is archived, a season with
//        playoffs left is not, a running season isn't touched
//   I2   timezone read fails, or names an unknown zone → nothing written
//   I3   games read fails, or playoff read fails → that season isn't archived
//   ED1  end-date editor: before start blocked, before last game warns, never
//        blocks; the note says both what it controls
//   VD1  a season otherwise ready but holding volunteer data → not archived,
//        reason volunteer_data
//   VD2  volunteer data unreadable → not archived, reason unreadable
//   VD3  checked LAST: a held season with a game ahead reads as the game, so
//        the hold banner only ever names a season that is otherwise done
//   VH1  through the real helper: a ready season with sign-ups stays open and
//        is listed as held; ONE holds call, naming only past-end seasons
//   VH2  the holds call fails, or answers something that isn't a list of ids
//        → nothing archived
//   VH3  seasonHeldForVolunteers (the season page's banner): true only for a
//        season held for volunteers — not one with playoffs left, not one
//        without sign-ups — and it writes NOTHING
//   B1   the banner / confirm words: the button says "Archive and delete
//        sign-ups" only when the season has sign-ups
//   B2   the confirm reads the holds reply fail-safe: an error or a malformed
//        reply is "unknown" (the warning shows), never "none"
//   B3   the confirm's button waits while the check runs and renders the label
// ANTI-VACUITY: archived, blocked by a game, blocked by playoffs, blocked by a
// read failure, held for volunteers — each must happen at least once through
// the real helper.

import {
  decideAutoArchive,
  type PlayoffGameForArchive,
} from "@/lib/seasons/archive-decision";
import { autoArchivePastSeasons, seasonHeldForVolunteers } from "@/lib/seasons/auto-archive";
import {
  ARCHIVE_SIGNUPS_UNKNOWN_LINE,
  ARCHIVE_WITH_SIGNUPS_LINE,
  archiveButtonLabel,
  archiveSignupsLine,
  archiveSignupsState,
  holdBannerLine,
} from "@/lib/seasons/volunteer-hold";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { END_DATE_NOTE, endDateEditCheck } from "@/lib/seasons/end-date";
import { todayInTimezone } from "@/lib/utils/org-today";

const NOW = new Date("2026-10-26T03:00:00Z");
const LA = "America/Los_Angeles";

let failures = 0;
let passes = 0;
function check(tag: string, ok: boolean, detail: string) {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL: [${tag}] ${detail}`);
  }
}
async function section(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    failures++;
    console.log(`FAIL: [CRASH-${name}] ${(e as Error).stack ?? e}`);
  }
}

const counters = { archived: 0, blockedByGame: 0, blockedByPlayoff: 0, blockedByReadFailure: 0, heldForVolunteers: 0 };

const done = (date: string): PlayoffGameForArchive => ({ scheduledDate: date, status: "completed", winnerId: "t1", homeScore: 5, awayScore: 3 });
const open = (date: string | null): PlayoffGameForArchive => ({ scheduledDate: date, status: "scheduled", winnerId: null, homeScore: null, awayScore: null });

// ── A tiny fake Supabase client: exactly the calls auto-archive.ts makes ─────
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
function fakeClient(db: Db, faults: Set<string>) {
  const updates: { table: string; id: unknown; patch: Row }[] = [];
  const reads: string[] = [];
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" = "select";
    let patch: Row = {};
    let wantCount = false;
    let rng: [number, number] | null = null;
    let single = false;
    const q = {
      select(_cols: string, opts?: { count?: string }) {
        if (op === "select") wantCount = opts?.count === "exact";
        return q;
      },
      update(p: Row) { op = "update"; patch = p; return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return q; },
      not(c: string) { filters.push((r) => (r[c] ?? null) !== null); return q; },
      order() { return q; },
      range(f: number, t: number) { rng = [f, t]; return q; },
      maybeSingle() { single = true; return q; },
      then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
        try {
          if (op === "select") reads.push(table);
          if (op === "select" && faults.has(table)) return res({ data: null, error: { message: `fault ${table}` }, count: null });
          const rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (op === "update") {
            for (const r of rows) { Object.assign(r, patch); updates.push({ table, id: r.id, patch }); }
            return res({ data: null, error: null });
          }
          if (single) return res({ data: rows[0] ?? null, error: null });
          const page = rng ? rows.slice(rng[0], rng[1] + 1) : rows;
          return res({ data: page, error: null, count: wantCount ? rows.length : null });
        } catch (e) {
          if (rej) rej(e);
        }
      },
    };
    return q;
  }
  const rpcs: { name: string; args: unknown }[] = [];
  function rpc(name: string, args: Record<string, unknown>) {
    rpcs.push({ name, args });
    if (faults.has("rpc")) return Promise.resolve({ data: null, error: { message: "fault rpc" } });
    if (name !== "volunteer_archive_holds") return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    if (db.__holdsReply) return Promise.resolve({ data: db.__holdsReply, error: null });
    const ids = (args.p_season_ids as string[]) ?? [];
    const held = (db.volunteer_claims ?? []).map((c) => c.season_id as string).filter((s) => ids.includes(s));
    return Promise.resolve({ data: [...new Set(held)].sort(), error: null });
  }
  return { client: { from, rpc } as never, updates, reads, rpcs };
}

const ORG = "org-1";
function baseDb(tz: string | null = LA): Db {
  return {
    profiles: [{ id: ORG, timezone: tz }],
    leagues: [
      // ready: ended Oct 20, games and playoffs all done
      { id: "ready", owner_id: ORG, end_date: "2026-10-20", archived_at: null, status: "active" },
      // playoffs: ended Oct 20, a playoff game on Nov 1 with no result
      { id: "playoffs", owner_id: ORG, end_date: "2026-10-20", archived_at: null, status: "active" },
      // running: ends Dec 1
      { id: "running", owner_id: ORG, end_date: "2026-12-01", archived_at: null, status: "active" },
      // lastday: ends Oct 25 — today in Pacific at NOW
      { id: "lastday", owner_id: ORG, end_date: "2026-10-25", archived_at: null, status: "active" },
    ],
    games: [
      { id: "g1", league_id: "ready", scheduled_at: "2026-10-17T10:00:00+00:00", status: "scheduled" },
      { id: "g2", league_id: "playoffs", scheduled_at: "2026-10-17T10:00:00+00:00", status: "scheduled" },
      { id: "g3", league_id: "running", scheduled_at: "2026-11-07T10:00:00+00:00", status: "scheduled" },
      { id: "g4", league_id: "lastday", scheduled_at: "2026-10-24T10:00:00+00:00", status: "scheduled" },
    ],
    playoff_games: [
      { id: "p1", league_id: "ready", scheduled_date: "2026-10-18", status: "completed", winner_id: "t1", home_score: 4, away_score: 2 },
      { id: "p2", league_id: "playoffs", scheduled_date: "2026-11-01", status: "scheduled", winner_id: null, home_score: null, away_score: null },
    ],
  };
}
const archivedIds = (db: Db) => (db.leagues ?? []).filter((l) => l.archived_at !== null).map((l) => l.id).sort();

async function main() {
  await section("D", () => {
    const today = "2026-10-25";
    const d = (p: Partial<Parameters<typeof decideAutoArchive>[0]>) =>
      decideAutoArchive({ endDate: "2026-10-20", today, gameTimes: [], playoffGames: [], volunteerData: false, ...p });

    check("D1", d({ gameTimes: ["2026-10-17T10:00:00+00:00"] }).archive === true, JSON.stringify(d({})));
    check("E1", d({ endDate: today }).archive === false && d({ endDate: today }).reason === "end_date_not_passed",
      `end date today: ${JSON.stringify(d({ endDate: today }))}`);
    check("E1", d({ endDate: "2026-10-24" }).archive === true, "the day after the end date archives");

    const g1 = d({ gameTimes: ["2026-10-17T10:00:00+00:00", "2026-11-07T10:00:00+00:00"] });
    check("G1", !g1.archive && g1.reason === "game_today_or_later", `future regular-season game: ${JSON.stringify(g1)}`);
    const g2 = d({ gameTimes: ["2026-10-25T18:00:00+00:00"] });
    check("G2", !g2.archive && g2.reason === "game_today_or_later", `game today: ${JSON.stringify(g2)}`);
    const g3 = d({ gameTimes: ["2026-10-10T10:00:00+00:00", "2026-10-17T10:00:00+00:00"] });
    check("G3", g3.archive, `past unscored games must not block: ${JSON.stringify(g3)}`);

    const p1 = d({ playoffGames: [done("2026-10-18"), open("2026-11-01")] });
    check("P1", !p1.archive, `playoffs after the end date: ${JSON.stringify(p1)}`);
    const p2 = d({ playoffGames: [done("2026-10-18"), open(null)] });
    check("P2", !p2.archive && p2.reason === "playoff_unfinished", `undated playoff game: ${JSON.stringify(p2)}`);
    const p3 = d({ playoffGames: [done("2026-10-18"), open("2026-10-22")] });
    check("P3", !p3.archive && p3.reason === "playoff_unfinished", `past playoff game with no result: ${JSON.stringify(p3)}`);
    const r1 = d({ playoffGames: [done("2026-10-18"), done("2026-10-22"), { ...open("2026-10-23"), winnerId: "t2" }] });
    check("R1", r1.archive, `results all in: ${JSON.stringify(r1)}`);
    // 0114: a game its series never needed is never played — neither ahead
    // (dated after today) nor unfinished (no result, or no date).
    const n1 = d({ playoffGames: [done("2026-10-18"), { ...open("2026-11-01"), status: "not_needed" }, { ...open(null), status: "not_needed" }] });
    check("N1", n1.archive, `not-needed playoff games must not block: ${JSON.stringify(n1)}`);

    for (const [what, p] of [
      ["today", { today: null }], ["games", { gameTimes: null }], ["playoffs", { playoffGames: null }],
    ] as const) {
      const u = d(p as never);
      check("U1", !u.archive && u.reason === "unreadable", `unreadable ${what}: ${JSON.stringify(u)}`);
    }
    check("D1", d({ endDate: null }).archive === false, "no end date never archives");
  });

  await section("TZ", async () => {
    check("TZ1", todayInTimezone(LA, NOW) === "2026-10-25", `fixture: today in LA is ${todayInTimezone(LA, NOW)}`);
    check("TZ1", NOW.toISOString().slice(0, 10) === "2026-10-26", "fixture: UTC is already the next day");
    const db = baseDb();
    const { client } = fakeClient(db, new Set());
    await autoArchivePastSeasons(client, ORG, NOW);
    check("TZ1", !archivedIds(db).includes("lastday"), "a season on the evening of its end date (Pacific) was archived");
    const next = baseDb();
    const f2 = fakeClient(next, new Set());
    await autoArchivePastSeasons(f2.client, ORG, new Date("2026-10-26T08:00:00Z")); // 1am Oct 26 in LA
    check("TZ1", archivedIds(next).includes("lastday"), "the next Pacific day the finished season should archive");
  });

  await section("I", async () => {
    const db = baseDb();
    const f = fakeClient(db, new Set());
    await autoArchivePastSeasons(f.client, ORG, NOW);
    const got = archivedIds(db);
    check("I1", JSON.stringify(got) === JSON.stringify(["ready"]), `archived ${JSON.stringify(got)}, expected ["ready"]`);
    if (got.includes("ready")) counters.archived++;
    if (!got.includes("playoffs")) counters.blockedByPlayoff++;
    const ready = db.leagues.find((l) => l.id === "ready");
    check("I1", ready?.status === "archived" && ready?.archived_at === NOW.toISOString(), `ready row: ${JSON.stringify(ready)}`);

    const gdb = baseDb();
    gdb.games.push({ id: "g9", league_id: "ready", scheduled_at: "2026-10-31T10:00:00+00:00", status: "cancelled" });
    const fg = fakeClient(gdb, new Set());
    await autoArchivePastSeasons(fg.client, ORG, NOW);
    check("I1", !archivedIds(gdb).includes("ready"), "a later game (even cancelled) must keep the season active");
    if (!archivedIds(gdb).includes("ready")) counters.blockedByGame++;
  });

  await section("I2", async () => {
    for (const [what, db, faults] of [
      ["profile read fails", baseDb(), new Set(["profiles"])],
      ["unknown timezone", baseDb("Mars/Olympus"), new Set<string>()],
      ["no timezone", baseDb(null), new Set<string>()],
    ] as const) {
      const f = fakeClient(db, faults as Set<string>);
      await autoArchivePastSeasons(f.client, ORG, NOW);
      check("I2", f.updates.length === 0, `${what}: wrote ${JSON.stringify(f.updates)}`);
      if (f.updates.length === 0) counters.blockedByReadFailure++;
    }
  });

  await section("I3", async () => {
    for (const table of ["games", "playoff_games"]) {
      const db = baseDb();
      const f = fakeClient(db, new Set([table]));
      await autoArchivePastSeasons(f.client, ORG, NOW);
      check("I3", !archivedIds(db).includes("ready"), `${table} read fails: the ready season was archived anyway`);
      if (!archivedIds(db).includes("ready")) counters.blockedByReadFailure++;
    }
  });

  await section("VD", () => {
    const today = "2026-10-25";
    const d = (p: Partial<Parameters<typeof decideAutoArchive>[0]>) =>
      decideAutoArchive({ endDate: "2026-10-20", today, gameTimes: [], playoffGames: [], volunteerData: false, ...p });
    const v1 = d({ volunteerData: true });
    check("VD1", !v1.archive && v1.reason === "volunteer_data", `held season: ${JSON.stringify(v1)}`);
    check("VD1", d({ volunteerData: false }).archive, "no volunteer data archives as before");
    const v2 = d({ volunteerData: null });
    check("VD2", !v2.archive && v2.reason === "unreadable", `unreadable volunteer data: ${JSON.stringify(v2)}`);
    const v3 = d({ volunteerData: true, gameTimes: ["2026-11-07T10:00:00+00:00"] });
    check("VD3", v3.reason === "game_today_or_later", `a game ahead comes first: ${JSON.stringify(v3)}`);
    const v4 = d({ volunteerData: true, playoffGames: [open("2026-10-22")] });
    check("VD3", v4.reason === "playoff_unfinished", `unfinished playoffs come first: ${JSON.stringify(v4)}`);
  });

  await section("VH", async () => {
    const db = baseDb();
    db.volunteer_claims = [{ id: "c1", season_id: "ready", status: "canceled" }];
    const f = fakeClient(db, new Set());
    const res = await autoArchivePastSeasons(f.client, ORG, NOW);
    check("VH1", !archivedIds(db).includes("ready"), "a ready season with a (canceled) sign-up was archived");
    check("VH1", JSON.stringify(res.heldForVolunteers) === JSON.stringify(["ready"]) && res.archived.length === 0,
      `result ${JSON.stringify(res)}`);
    if (res.heldForVolunteers.includes("ready")) counters.heldForVolunteers++;
    const holdCalls = f.rpcs.filter((r) => r.name === "volunteer_archive_holds");
    const asked = (holdCalls[0]?.args as { p_season_ids?: string[] } | undefined)?.p_season_ids ?? [];
    check("VH1", holdCalls.length === 1 && JSON.stringify([...asked].sort()) === JSON.stringify(["playoffs", "ready"]),
      `holds calls ${JSON.stringify(f.rpcs)} (running and last-day seasons must not be asked about)`);

    const clean = baseDb();
    const fc = fakeClient(clean, new Set());
    const rc = await autoArchivePastSeasons(fc.client, ORG, NOW);
    check("VH1", JSON.stringify(rc.archived) === JSON.stringify(["ready"]) && rc.heldForVolunteers.length === 0,
      `no sign-ups: ${JSON.stringify(rc)}`);

    for (const [what, mk] of [
      ["the call fails", () => fakeClient(baseDb(), new Set(["rpc"]))],
      ["the reply isn't a list of ids", () => { const b = baseDb(); b.__holdsReply = [{ id: "x" }] as never; return fakeClient(b, new Set()); }],
      ["the reply is a string", () => { const b = baseDb(); b.__holdsReply = "nope" as never; return fakeClient(b, new Set()); }],
    ] as const) {
      const fx = mk();
      const r = await autoArchivePastSeasons(fx.client, ORG, NOW);
      check("VH2", fx.updates.length === 0 && r.archived.length === 0, `${what}: wrote ${JSON.stringify(fx.updates)}`);
      if (fx.updates.length === 0) counters.blockedByReadFailure++;
    }
  });

  await section("VH3", async () => {
    const db = baseDb();
    db.volunteer_claims = [{ id: "c1", season_id: "ready", status: "active" }, { id: "c2", season_id: "playoffs", status: "active" }];
    const f = fakeClient(db, new Set());
    const ready = await seasonHeldForVolunteers(f.client, ORG, "ready", NOW);
    const playoffs = await seasonHeldForVolunteers(f.client, ORG, "playoffs", NOW);
    check("VH3", ready === true && playoffs === false, `ready ${ready}, playoffs ${playoffs}`);
    check("VH3", f.updates.length === 0, `the season page's check wrote ${JSON.stringify(f.updates)}`);
    const clean = fakeClient(baseDb(), new Set());
    check("VH3", (await seasonHeldForVolunteers(clean.client, ORG, "ready", NOW)) === false && clean.updates.length === 0,
      "a ready season without sign-ups is not held (and the page writes nothing)");
    const broken = fakeClient(db, new Set(["rpc"]));
    check("VH3", (await seasonHeldForVolunteers(broken.client, ORG, "ready", NOW)) === false, "an unreadable hold shows no banner");
  });

  await section("B", () => {
    check("B1", archiveButtonLabel("has") === "Archive and delete sign-ups", archiveButtonLabel("has"));
    for (const s of ["none", "unknown", "checking"] as const) check("B1", archiveButtonLabel(s) === "Archive season", `${s}: ${archiveButtonLabel(s)}`);
    check("B1", archiveSignupsLine("has") === ARCHIVE_WITH_SIGNUPS_LINE && archiveSignupsLine("unknown") === ARCHIVE_SIGNUPS_UNKNOWN_LINE
      && archiveSignupsLine("none") === null && archiveSignupsLine("checking") === null, "confirm lines");
    check("B1", ARCHIVE_WITH_SIGNUPS_LINE.includes("unarchiving won't bring them back"), ARCHIVE_WITH_SIGNUPS_LINE);
    const line = holdBannerLine("2026-10-25");
    check("B1", line.startsWith("This season ended Oct 25, 2026.") && line.includes("archiving deletes volunteer names, emails and sign-ups"), line);
    check("B2", archiveSignupsState("s1", { data: ["s1"], error: null }) === "has", "has");
    check("B2", archiveSignupsState("s1", { data: [], error: null }) === "none", "none");
    check("B2", archiveSignupsState("s1", { data: null, error: { message: "x" } }) === "unknown", "error → unknown");
    check("B2", archiveSignupsState("s1", { data: [{ id: "s1" }], error: null }) === "unknown", "malformed → unknown");
    const modal = readFileSync(join(__dirname, "..", "..", "src/components/seasons/archive-modals.tsx"), "utf8");
    check("B3", modal.includes('disabled={busy || signups === "checking"}') && modal.includes("{archiveButtonLabel(signups)}")
      && modal.includes('supabase.rpc("volunteer_archive_holds", { p_season_ids: [seasonId] })'),
      "the archive confirm waits for the sign-up check and renders the shared label");
  });

  await section("ED", () => {
    const e1 = endDateEditCheck("2026-08-01", "2026-07-31", null);
    check("ED1", e1.error !== null && e1.error.includes("Aug 1, 2026"), `before start: ${JSON.stringify(e1)}`);
    const e2 = endDateEditCheck("2026-08-01", "2026-08-01", null);
    check("ED1", e2.error === null && e2.warning === null, `same day as start is allowed: ${JSON.stringify(e2)}`);
    const e3 = endDateEditCheck("2026-08-01", "2026-10-20", "2026-11-01");
    check("ED1", e3.error === null && e3.warning !== null && e3.warning.includes("Nov 1, 2026"), `before last game warns, never blocks: ${JSON.stringify(e3)}`);
    const e4 = endDateEditCheck("2026-08-01", "2026-11-01", "2026-11-01");
    check("ED1", e4.warning === null, `ending on the last game day doesn't warn: ${JSON.stringify(e4)}`);
    check("ED1", endDateEditCheck(null, "", null).error !== null, "an empty end date can't be saved");
    check("ED1", END_DATE_NOTE.includes("archives") && END_DATE_NOTE.includes("calendar feeds"), END_DATE_NOTE);
  });

  for (const [k, v] of Object.entries(counters)) check("V", v > 0, `anti-vacuity counter ${k} is 0`);
  console.log(`\n${passes} checks passed, ${failures} failed.`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(failures ? 1 : 0);
}

void main();
