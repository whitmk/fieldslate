// Harness for the public bracket page (/s/<token>/bracket/<division>, 0116):
//
//   V  the page's rules (public-bracket/view.ts): rows from the reader (scores
//      dropped when the bracket hides them — the second lock), slot labels,
//      round headings, the opening stage, sit-outs, every state card's words
//   S  sharing (public-bracket/share.ts): the card's copy rule and its one
//      "why" line in order, the www URL, the switch, the save reply
//   R  the reader parse (read.ts) against a faked no-store client: malformed
//      input never reaches the database; anything unexpected is "error"
//   D  the data route's HTTP answer: 60s edge cache for an answer, 503 +
//      no-store for a failed read
//   P  the page RENDERED (PublicBracketView) for single elimination, a series
//      bracket, scores off and a two-stage pair: no admin button, no daylight,
//      "Date TBD", no score when hidden, the sit-out line, no records
//   G  PUBLIC_TREE / PUBLIC_GROUP are SCREEN_* without the action row
//   F  fences: an import walk from the page, its route and its client reaches
//      no browser data client, modal, daylight, admin wrapper or two-stage
//      card; no public file names the round-robin records (admin-only)
//   L  the public schedule's "Bracket →": set on a shareable bracket's rows,
//      never on double elimination or a regular game
//
// Run: npm run sim:public-bracket (+ :mutants).
import Module from "node:module";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

(globalThis as { React?: unknown }).React = React;

const ROOT = join(__dirname, "../..");
let checks = 0;
let fails = 0;
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
  }
}
function eq<T>(got: T, want: T, tag: string, what: string) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(g === w, tag, what, g === w ? "" : `got ${g}, want ${w}`);
}
const counters = { rowsBuilt: 0, scoresDropped: 0, whyLines: 0, readerRefusals: 0, rendersChecked: 0, fencedModules: 0, bracketLinks: 0 };

// ── The faked no-store client (read.ts) ─────────────────────────────────────
let rpcAnswer: { data: unknown; error: unknown } = { data: null, error: null };
let rpcCalls = 0;
type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (request === "@/lib/supabase/no-store") {
    return {
      createNoStoreClient: () => ({
        rpc: async () => {
          rpcCalls++;
          return rpcAnswer;
        },
      }),
    };
  }
  return origLoad.call(this, request, parent, isMain);
};
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://fake";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "fake";

/* eslint-disable @typescript-eslint/no-require-imports */
const view = require("../../src/lib/public-bracket/view") as typeof import("../../src/lib/public-bracket/view");
const share = require("../../src/lib/public-bracket/share") as typeof import("../../src/lib/public-bracket/share");
const read = require("../../src/lib/public-bracket/read") as typeof import("../../src/lib/public-bracket/read");
const printLib = require("../../src/lib/playoffs/bracket-print") as typeof import("../../src/lib/playoffs/bracket-print");
const schedView = require("../../src/lib/public-schedule/view") as typeof import("../../src/lib/public-schedule/view");
const client = require("../../src/components/public-bracket/public-bracket-client") as typeof import("../../src/components/public-bracket/public-bracket-client");
/* eslint-enable @typescript-eslint/no-require-imports */
import type { PublicBracket, PublicBracketGame, PublicBracketOk } from "../../src/lib/public-bracket/types";

const TOKEN = "a".repeat(64);
const DIV = "11111111-2222-4333-8444-555555555555";

// ── Fixtures (the reader's shape) ───────────────────────────────────────────
function game(p: Partial<PublicBracketGame> & { id: string; round: string; game_number: number }): PublicBracketGame {
  return {
    series_game: 1, series_length: 1, scheduled_date: null, start_time: null, status: "scheduled",
    seed_home: null, seed_away: null, home_team: null, away_team: null, winner_id: null,
    home_score: null, away_score: null, venue: null, ...p,
  };
}
const T = (id: string, name: string) => ({ id, name });
const FIELD = { name: "Andrews", location: { name: "Monroe Complex" } };

/** 4-team single elimination: game 1 played (Braves 7–4 Cubs), game 2 dated,
 *  the Final undated. */
function se4(showScores: boolean): PublicBracket {
  return {
    id: "pb1", stage: 1, format: "single_elimination", advance_count: null, show_scores: showScores,
    games: [
      game({ id: "g1", round: "R1", game_number: 1, scheduled_date: "2026-10-24", start_time: "09:00", status: "completed",
        home_team: T("t1", "Braves"), away_team: T("t4", "Cubs"), winner_id: "t1",
        home_score: showScores ? 7 : null, away_score: showScores ? 4 : null, venue: FIELD }),
      game({ id: "g2", round: "R1", game_number: 2, scheduled_date: "2026-10-24", start_time: "11:30",
        home_team: T("t2", "Mets"), away_team: T("t3", "Giants"), venue: FIELD }),
      game({ id: "g3", round: "F", game_number: 3, home_team: T("t1", "Braves") }),
    ],
  };
}
/** A best-of-3 Final: game 1 Braves won; games 2 and 3 to play (3 if needed). */
function seriesFinal(): PublicBracket {
  return {
    id: "pb2", stage: 1, format: "single_elimination", advance_count: null, show_scores: true,
    games: [1, 2, 3].map((k) =>
      game({ id: `f${k}`, round: "F", game_number: 1, series_game: k, series_length: 3,
        scheduled_date: k < 3 ? `2026-10-3${k}` : null, start_time: k < 3 ? "10:00" : null,
        status: k === 1 ? "completed" : "scheduled",
        home_team: k === 2 ? T("t2", "Expos") : T("t1", "Braves"), away_team: k === 2 ? T("t1", "Braves") : T("t2", "Expos"),
        winner_id: k === 1 ? "t1" : null, home_score: k === 1 ? 5 : null, away_score: k === 1 ? 2 : null, venue: FIELD })),
  };
}
/** A best-of-3 Final Braves won 2–0: the reader sends games 1 and 2 only
 *  (game 3 was not needed) with series_length 3. */
function sweep(): PublicBracket {
  const b = seriesFinal();
  b.games = b.games.filter((g) => g.series_game < 3).map((g) =>
    g.series_game === 2 ? { ...g, status: "completed", winner_id: "t1", home_score: 3, away_score: 4 } : g);
  return b;
}
function twoStage(seeded: boolean): PublicBracket[] {
  return [
    {
      id: "s1", stage: 1, format: "round_robin", advance_count: null, show_scores: true,
      games: [
        game({ id: "r1", round: "RR1", game_number: 1, scheduled_date: "2026-10-17", start_time: "09:00", status: "completed",
          home_team: T("u1", "Bears"), away_team: T("u2", "Lions"), winner_id: "u1", home_score: 5, away_score: 1 }),
        game({ id: "r2", round: "RR2", game_number: 2, home_team: T("u3", "Owls"), away_team: T("u1", "Bears") }),
      ],
    },
    {
      id: "s2", stage: 2, format: "single_elimination", advance_count: 2, show_scores: true,
      games: [game({ id: "x1", round: "F", game_number: 1, seed_home: 1, seed_away: 2,
        home_team: seeded ? T("u1", "Bears") : null, away_team: seeded ? T("u2", "Lions") : null })],
    },
  ];
}
function ok_(brackets: PublicBracket[]): PublicBracketOk {
  return {
    status: "ok", org: { name: "Riverside LL", timezone: "America/Los_Angeles" }, today: "2026-10-20",
    season: { id: "s", name: "Fall 2026" }, division: { id: DIV, name: "Majors" }, brackets,
  };
}

async function main() {
  // ── V ─────────────────────────────────────────────────────────────────────
  {
    const rows = view.toRows(se4(true));
    counters.rowsBuilt += rows.length;
    eq(rows[0].venue_name, "Monroe Complex — Andrews", "V", "the field carries its park");
    eq([rows[0].home_score, rows[0].away_score, rows[0].winner_name], [7, 4, "Braves"], "V", "scores and the winner's name");
    eq(rows[0].playoff_id, "pb1", "V", "a row knows its bracket");
    // The second lock: a bracket that hides scores never shows one, even if a
    // reader ever sent it.
    const leaky: PublicBracket = { ...se4(true), show_scores: false };
    const hidden = view.toRows(leaky);
    ok(hidden.every((r) => r.home_score === null && r.away_score === null), "V", "scores off: no score survives toRows");
    eq(hidden[0].winner_id, "t1", "V", "scores off: the winner stays");
    counters.scoresDropped += hidden.filter((r, i) => r.home_score === null && leaky.games[i].home_score !== null).length;

    eq(view.slotText(rows[2], "away", rows, "single_elimination", false), "Winner of Game 2", "V", "an empty Final slot reads Winner of Game 2");
    const ts = twoStage(true);
    const s2rows = view.toRows(ts[1]);
    eq(view.slotText(s2rows[0], "home", s2rows, "single_elimination", true), "1 · Bears", "V", "a seeded Stage 2 slot reads 1 · Bears");
    const s2open = view.toRows(twoStage(false)[1]);
    eq(view.slotText(s2open[0], "home", s2open, "single_elimination", true), "Seed 1", "V", "an unseeded Stage 2 slot reads Seed 1");
    const sw = view.toRows(sweep());
    const rebuilt = sw.filter((r) => r.series_game === 3);
    eq(rebuilt.map((r) => [r.status, r.home_team_id, r.scheduled_date]), [["not_needed", null, null]], "V", "a 2–0 best-of-3 gets its not-needed Game 3 back, empty");
    eq(view.roundHeading("F", sw), "Final · best of 3", "V", "so it still reads best of 3");
    eq(sw.filter(view.shown).length, 2, "V", "and the rebuilt game is never drawn");
    const fr = view.toRows(seriesFinal());
    eq(view.roundHeading("F", fr), "Final · best of 3", "V", "a series round's heading");
    eq(view.roundHeading("R1", rows), "Semifinals", "V", "a 4-team first round is the Semifinals");
    eq(view.defaultStage(ok_(twoStage(false))), 1, "V", "two-stage opens on Stage 1 before seeding");
    eq(view.defaultStage(ok_(twoStage(true))), 2, "V", "and on Stage 2 once a slot has a team");
    eq(view.advanceLine(4), "Top 4 move on to the bracket.", "V", "the advancing line");
    eq([...view.sitOuts(view.toRows(ts[0])).entries()], [["RR1", ["Owls"]], ["RR2", ["Lions"]]], "V", "sit-outs per round, A–Z");
    eq(view.sitOutLine(["Foxes"]), "Sits out: Foxes", "V", "the sit-out line");
    eq(view.clockLabel(new Date(2026, 9, 20, 14, 41)), "2:41 PM", "V", "the clock label");
    eq(view.staleLine("2:41 PM"), "Couldn't refresh. Showing results as of 2:41 PM.", "V", "the stale line");
    eq(view.formatLine(ok_(twoStage(false))), "Round robin, then bracket", "V", "two-stage format line");
    eq(view.formatLine(ok_([se4(true)])), "Single elimination", "V", "single elimination format line");
    eq(view.UNDATED_PUBLIC, "Date TBD", "V", "an undated game reads Date TBD");
    eq(view.REFRESH_MS, 60_000, "V", "refetch every 60 seconds");
    eq([view.openingMode(375), view.openingMode(639), view.openingMode(640), view.openingMode(1280)], ["list", "list", "bracket", "bracket"], "V", "a phone opens on the list, a wider screen on the bracket");
    const client2 = readFileSync(join(ROOT, "src/components/public-bracket/public-bracket-client.tsx"), "utf8");
    ok(client2.includes("setMode(openingMode(window.innerWidth));") && !/useState[^;]*window\./.test(client2), "V", "the viewport is read after mount, never in a state initializer");
    const copies: [Parameters<typeof view.stateCopy>[0], string, string, boolean, boolean][] = [
      [{ status: "error" }, "We couldn't load the bracket right now", "This is a problem on our side, not a change to the games. Try again in a few minutes.", false, true],
      [{ status: "unknown" }, "This link isn't recognized", "Check the link with your league — it may have been replaced.", false, false],
      [{ status: "off" }, "This bracket isn't available", "This league has turned off its public schedule. Check the league's website or ask your coach.", false, false],
      [{ status: "plan" }, "This bracket isn't available", "This league has turned off its public schedule. Check the league's website or ask your coach.", false, false],
      [{ status: "unavailable" }, "This bracket isn't available", "The league may have moved on to a new season. Check the league's website or ask your coach.", true, false],
      [{ status: "unpublished", division: { name: "Majors" } }, "Majors isn't published yet", "The league hasn't published this division's schedule. Check back soon.", true, false],
      [{ status: "no_bracket", division: { name: "Majors" } }, "No bracket for Majors yet", "The league hasn't set up playoffs for this division. Check back soon.", true, false],
      [{ status: "not_shareable", division: { name: "Juniors" } }, "This bracket can't be shown here yet", "The league's games are still on the full schedule.", true, false],
    ];
    for (const [r, title, body, allGames, retry] of copies) {
      eq(view.stateCopy(r), { title, body, allGames, retry }, "V", `state card for ${r.status}`);
    }
  }

  // ── S ─────────────────────────────────────────────────────────────────────
  {
    type ShareIn = Parameters<typeof share.shareState>[0];
    const base: ShareIn = { plan: "elite", link: { token: TOKEN, enabled: true }, status: "active", format: "single_elimination", divisionName: "AA", divisionLocked: true };
    const st = (p: Partial<ShareIn>) => share.shareState({ ...base, ...p }, DIV, "season1");
    const good = st({});
    eq(good, { canCopy: true, url: `https://www.thefieldslate.com/s/${TOKEN}/bracket/${DIV}` }, "S", "a shareable bracket copies the www link");
    const why = (s: ReturnType<typeof share.shareState>) => (s.canCopy ? "COPY" : s.why);
    const cases: [Parameters<typeof st>[0], string][] = [
      [{ plan: "free" }, "Public pages are on the Pro and Elite plans."],
      [{ link: "unreadable" }, "Couldn't check your public schedule link, so the link isn't offered."],
      [{ link: null }, "The public schedule is off, so bracket links don't work."],
      [{ link: { token: TOKEN, enabled: false } }, "The public schedule is off, so bracket links don't work."],
      [{ status: "draft" }, "A draft bracket isn't public. Generate its games to share it."],
      [{ format: "double_elimination" }, "Double elimination brackets can't be shared yet."],
      [{ divisionLocked: false }, "AA's schedule isn't locked, so its bracket isn't public yet."],
      [{ divisionLocked: null }, "Couldn't check whether AA's schedule is locked, so the link isn't offered."],
      [{ plan: "pro" }, "COPY"],
      [{ format: "round_robin" }, "COPY"],
    ];
    for (const [p, want] of cases) {
      eq(why(st(p)), want, "S", `why: ${JSON.stringify(p)}`);
      if (want !== "COPY") counters.whyLines++;
    }
    // Order: the first thing an admin can act on wins.
    eq(why(st({ link: null, status: "draft", format: "double_elimination", divisionLocked: false })), "The public schedule is off, so bracket links don't work.", "S", "the public page comes before draft/format/lock");
    eq(why(st({ status: "draft", divisionLocked: false })), "A draft bracket isn't public. Generate its games to share it.", "S", "draft before the lock");
    const lock = st({ divisionLocked: false });
    eq(lock.canCopy ? null : lock.fix, { label: "Lock it on the season page", href: "/dashboard/leagues/season1" }, "S", "the lock line links the season page");
    const off = st({ link: null });
    eq(off.canCopy ? null : off.fix, { label: "Turn it on in Settings", href: "/dashboard/settings" }, "S", "the off line links Settings");
    eq([share.scoresSwitchShown("active", "single_elimination"), share.scoresSwitchShown("draft", "single_elimination"), share.scoresSwitchShown("active", "double_elimination")], [true, false, false], "S", "the switch shows only for a bracket that can be public");
    eq(share.scoresSaveOutcome({ committed: true, changed: true, show_scores: false }, null, false), { ok: true, show: false }, "S", "a confirming reply is saved");
    eq(share.scoresSaveOutcome({ committed: false, show_scores: false }, null, false), { ok: false }, "S", "an uncommitted reply is not saved");
    eq(share.scoresSaveOutcome({ committed: true, show_scores: true }, null, false), { ok: false }, "S", "a reply holding the other value is not saved");
    eq(share.scoresSaveOutcome(null, { message: "x" }, true), { ok: false }, "S", "an error is not saved");
    eq(share.bracketPath(TOKEN, DIV), `/s/${TOKEN}/bracket/${DIV}`, "S", "the relative path");
    eq(share.SETTINGS_OFF_ALSO_BRACKETS, "Turning this off also turns off every playoff bracket link.", "S", "Settings off sentence");
    eq(share.SETTINGS_RESET_ALSO_BRACKETS, "Playoff bracket links stop working too — copy them again from the Playoffs page.", "S", "Settings reset sentence");
  }

  // ── R ─────────────────────────────────────────────────────────────────────
  {
    rpcCalls = 0;
    eq(await read.readPublicBracket("nope", DIV), { status: "unknown" }, "R", "a malformed token is unknown");
    eq(await read.readPublicBracket(TOKEN, "not-a-uuid"), { status: "unavailable" }, "R", "a malformed division is unavailable");
    eq(rpcCalls, 0, "R", "neither reached the database");
    const answers: [unknown, unknown, string][] = [
      [null, { message: "boom" }, "error"],
      [{ status: "weird" }, null, "error"],
      [{ status: "ok" }, null, "error"],
      [{ status: "unpublished" }, null, "error"],
      [{ status: "unavailable" }, null, "unavailable"],
      [{ status: "no_bracket", division: { name: "Majors" } }, null, "no_bracket"],
      [ok_([se4(true)]), null, "ok"],
    ];
    for (const [data, error, want] of answers) {
      rpcAnswer = { data, error };
      const r = await read.readPublicBracket(TOKEN, DIV);
      eq(r.status, want, "R", `reader answer ${JSON.stringify(data)?.slice(0, 40)} → ${want}`);
      if (want !== "ok") counters.readerRefusals++;
    }
  }

  // ── D ─────────────────────────────────────────────────────────────────────
  {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const route = require("../../src/app/s/[token]/bracket/[division]/data/route") as typeof import("../../src/app/s/[token]/bracket/[division]/data/route");
    rpcAnswer = { data: ok_([se4(true)]), error: null };
    const okRes = await route.GET(new Request("http://x"), { params: { token: TOKEN, division: DIV } });
    eq([okRes.status, okRes.headers.get("cache-control")], [200, "public, max-age=0, s-maxage=60"], "D", "an answer is edge-cached for 60 seconds");
    rpcAnswer = { data: null, error: { message: "down" } };
    const bad = await route.GET(new Request("http://x"), { params: { token: TOKEN, division: DIV } });
    eq([bad.status, bad.headers.get("cache-control"), bad.headers.get("retry-after")], [503, "private, no-store", "60"], "D", "a failed read is 503 + no-store");
    rpcAnswer = { data: { status: "unavailable" }, error: null };
    const un = await route.GET(new Request("http://x"), { params: { token: TOKEN, division: DIV } });
    eq([un.status, un.headers.get("x-robots-tag")], [200, "noindex, nofollow"], "D", "a refusal is an answer, never indexed");
    const src = readFileSync(join(ROOT, "src/app/s/[token]/bracket/[division]/data/route.ts"), "utf8");
    ok(src.includes('export const dynamic = "force-dynamic";') && src.includes('export const fetchCache = "force-no-store";'), "D", "the route is dynamic and force-no-store");
  }

  // ── P ─────────────────────────────────────────────────────────────────────
  {
    const ADMIN = /Enter result|Edit result|Set time|>Move<|Set date, time and field|data-daylight-chip|Records|records/;
    // The opening view is read from the viewport after mount (an effect);
    // a static render passes it, and openingMode is checked in V.
    const renderView = (data: PublicBracketOk, width?: number) =>
      renderToStaticMarkup(h(client.PublicBracketView, { data, token: TOKEN, embed: false, staleNote: null, initialMode: view.openingMode(width ?? 1280) }));
    const on = renderView(ok_([se4(true)]));
    counters.rendersChecked++;
    ok(!ADMIN.test(on), "P", "single elimination: no admin button, chip or records", on.match(ADMIN)?.[0] ?? "");
    ok(on.includes("Majors Playoffs") && on.includes("Fall 2026 · Single elimination"), "P", "the title and format line");
    ok(on.includes(`href="https://www.thefieldslate.com/s/${TOKEN}"`), "P", "See all games goes to the www schedule");
    ok(on.includes("Game 3 · Date TBD"), "P", "the undated Final reads Date TBD");
    ok(on.includes(">7<") && on.includes(">4<"), "P", "scores on: the played game's score shows");
    ok(on.includes("Winner of Game 2"), "P", "the empty slot reads Winner of Game 2");
    ok(!on.includes("flex h-8 flex-none items-center border-t"), "P", "no card has an action row");
    ok(on.includes(`height:${printLib.PUBLIC_TREE.cardH}px`), "P", "cards are PUBLIC_TREE's height");

    const off = renderView(ok_([se4(false)]));
    counters.rendersChecked++;
    ok(!off.includes(">7<") && !off.includes(">4<"), "P", "scores off: no score shows");
    ok(off.includes("font-bold text-[#0C1F3F]\">Braves<"), "P", "scores off: the winner is still bold");
    const offText = off.replace(/<[^>]*>/g, " ");
    ok(!/hidden|not shown|scores are/i.test(offText), "P", "scores off: the page never says scores are hidden", offText.match(/.{0,40}(hidden|not shown|scores are).{0,40}/i)?.[0] ?? "");

    const ser = renderView(ok_([seriesFinal()]));
    counters.rendersChecked++;
    ok(ser.includes("data-series-group") && ser.includes("Braves lead 1–0"), "P", "a series group with its standing");
    ok(!ADMIN.test(ser), "P", "series: no admin button", ser.match(ADMIN)?.[0] ?? "");

    const swp = renderView(ok_([sweep()]));
    counters.rendersChecked++;
    ok(swp.includes("Final · best of 3") && swp.includes("Braves win 2–0") && (swp.match(/data-series-game=/g) ?? []).length === 2,
      "P", "a 2–0 best-of-3: best of 3, Braves win 2–0, two cards (no not-needed card)");
    const swl = renderView(ok_([sweep()]), 375);
    ok(!swl.includes("Game 3 of 3"), "P", "the list draws no row for the rebuilt game");

    const list = renderView(ok_([se4(true)]), 375);
    counters.rendersChecked++;
    ok(list.includes("aria-pressed=\"true\"") && /aria-pressed="true"[^>]*>(<svg[\s\S]*?<\/svg>)?List/.test(list), "P", "a phone opens on the list");
    ok(list.includes("Date TBD") && !ADMIN.test(list), "P", "the list: Date TBD, no admin button");

    const ts1 = renderView(ok_(twoStage(false)));
    counters.rendersChecked++;
    ok(ts1.includes("Stage 1 · Round robin") && ts1.includes("Sits out: Owls") && ts1.includes("Top 2 move on to the bracket."), "P", "two-stage Stage 1: rounds, sit-outs, the advancing line");
    ok(!ADMIN.test(ts1), "P", "two-stage: no records, no admin button", ts1.match(ADMIN)?.[0] ?? "");
  }

  // ── G ─────────────────────────────────────────────────────────────────────
  {
    const { SCREEN_TREE, SCREEN_GROUP, PUBLIC_TREE, PUBLIC_GROUP } = printLib;
    eq({ ...PUBLIC_TREE, cardH: PUBLIC_TREE.cardH + 32, slotH: PUBLIC_TREE.slotH + 32 }, SCREEN_TREE, "G", "PUBLIC_TREE is SCREEN_TREE without the 32px action row");
    eq(SCREEN_TREE.slotH - SCREEN_TREE.cardH, PUBLIC_TREE.slotH - PUBLIC_TREE.cardH, "G", "the gap under a card is kept");
    eq({ ...PUBLIC_GROUP, footH: SCREEN_GROUP.footH, flagH: SCREEN_GROUP.flagH }, SCREEN_GROUP, "G", "PUBLIC_GROUP is SCREEN_GROUP without the action row and chip");
    eq([PUBLIC_GROUP.footH, PUBLIC_GROUP.flagH], [0, 0], "G", "no action row, no chip");
  }

  // ── F ─────────────────────────────────────────────────────────────────────
  {
    const resolve = (from: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
      else if (spec.startsWith(".")) base = join(dirname(from), spec);
      else return null;
      for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
      return existsSync(base) ? base : null;
    };
    const IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
    const starts = [
      "src/app/s/[token]/bracket/[division]/page.tsx",
      "src/app/s/[token]/bracket/[division]/data/route.ts",
      "src/components/public-bracket/public-bracket-client.tsx",
    ].map((f) => join(ROOT, f));
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const m of readFileSync(f, "utf8").matchAll(IMPORT)) {
        if (/^(import|export)\s+type\s/.test(m[0])) continue; // types carry no code
        const r = resolve(f, m[1]);
        if (r) queue.push(r);
      }
    }
    const reach = [...seen].map((f) => relative(ROOT, f)).sort();
    counters.fencedModules = reach.length;
    const BAD = /supabase\/(client|server)\.ts$|daylight|-modal\.tsx$|bracket-view\.tsx$|two-stage-card\.tsx$|use-[a-z-]+\.tsx?$/;
    const bad = reach.filter((f) => BAD.test(f));
    ok(bad.length === 0, "F", "nothing reachable from the public bracket page is a browser data client, a modal, daylight, the admin wrapper or the two-stage card", bad.join(", "));
    ok(reach.includes("src/components/playoffs/bracket-pieces.tsx") && reach.includes("src/lib/supabase/no-store.ts"), "F", "the walk reaches the pieces and the no-store client");
    // Records (round-robin standings) are admin-only: no public file names them.
    const PUBLIC_FILES = reach.filter((f) =>
      /^src\/(app\/s\/|lib\/public-(schedule|bracket)\/|components\/public-(schedule|bracket)\/)|bracket-pieces\.tsx$|series-card\.tsx$/.test(f));
    const recs = PUBLIC_FILES.filter((f) => /roundRobinRecords|recordsFootnote|\bRecords\b/.test(readFileSync(join(ROOT, f), "utf8")));
    ok(recs.length === 0, "F", "no public file names the round-robin records", recs.join(", "));
    ok(PUBLIC_FILES.length >= 8, "F", `the records scan covered ${PUBLIC_FILES.length} public files`);
  }

  // ── L ─────────────────────────────────────────────────────────────────────
  {
    const pg = (id: string, format: string, division: string) => ({
      id, playoff_id: `p-${format}`, format, division_id: division, round: "F", game_number: 1,
      scheduled_date: "2026-10-31", start_time: "10:00", status: "scheduled",
      home_team: { id: "t1", name: "Braves" }, away_team: { id: "t2", name: "Mets" }, venue: null,
    });
    const season = {
      id: "s", name: "Fall", start_date: "2026-09-01", end_date: "2026-11-30",
      divisions: [{ id: "dse", name: "Majors", game_duration: 90 }, { id: "dde", name: "Juniors", game_duration: 90 }],
      unpublished: [], teams: [],
      games: [{ id: "rg", scheduled_at: "2026-10-10T09:00:00+00:00", status: "scheduled", is_away: false, interleague: false,
        division_id: "dse", home_team_id: "t1", away_team_id: "t2", external_team_name: null, proposed_venue_name: null,
        home_team: { name: "Braves" }, away_team: { name: "Mets" }, venue: null }],
      playoff_games: [pg("a", "single_elimination", "dse"), pg("b", "double_elimination", "dde")],
    };
    const rows = schedView.buildRows(season as unknown as Parameters<typeof schedView.buildRows>[0]);
    const byKey = new Map(rows.map((r) => [r.key, r.bracketDivisionId]));
    eq([byKey.get("p-a"), byKey.get("p-b"), byKey.get("g-rg")], ["dse", null, null], "L", "Bracket → on a shareable bracket's row only");
    counters.bracketLinks += [...byKey.values()].filter(Boolean).length;
    const ui = readFileSync(join(ROOT, "src/components/public-schedule/public-schedule-client.tsx"), "utf8");
    ok(ui.includes("href={bracketPath(token, row.bracketDivisionId)}") && (ui.match(/<BracketLink /g) ?? []).length === 2, "L", "both row layouts render the link through bracketPath");
  }

  for (const [name, n] of Object.entries(counters)) ok(n > 0, "AV", `counter ${name} is ${n}`);
  console.log(`public-bracket: ${checks - fails}/${checks} checks passed  ${JSON.stringify(counters)}`);
  if (fails) process.exit(1);
}

main().catch((e) => {
  console.log(`  FAIL: [CRASH] ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
