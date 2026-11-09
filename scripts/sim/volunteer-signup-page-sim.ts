// The public volunteer sign-up page (/v/<token>) and its routes — the rules
// and the server helper, through the REAL src/lib/volunteers/signup-page.ts
// and public-server.ts, then the routes' wiring.
//
//   npm run sim:volunteer-signup-page            (three host zones)
//   npm run sim:volunteer-signup-page:mutants
//
// ASSERTIONS (a mutant must die FIRST at its own tag):
//   P1  readPageReply: unknown / plan / ok; anything malformed → error
//       (the page says it couldn't load — never an empty list)
//   P2  spotAction: open spots counted, a full spot "Taken" (never a name),
//       rained-out and closed games offer no button
//   P3  groupSpots: role and division chips, grouped by date, time order
//   P4  formProblem: division, team, one-letter initial, last name, email, 18+
//   P5  claimOutcome: every database status worded; overlap asks again;
//       unknown → the generic failure, never a raw string
//   P6  titles, details and dates as the page prints them
//   P7  snack shack shifts (0122): read from `shifts` (none when the reply
//       has no key — a database before 0122), keyed by block, detailed
//       "9:30–11:30 AM · For Braves families" (no team → times only), spots
//       = the headcount, and never hidden by a division chip
//   Q1  publicConfig: no Turnstile secret, no salt or a short salt → null
//       (the claim route then answers 503 and touches nothing)
//   Q2  parseClaimBody: shape-checked; anything off → null (400); exactly
//       one of a game and a shift; a shift carries no for-team
//   Q3  verifyTurnstile: only Cloudflare's success counts; a failure, a
//       thrown fetch or no token → false; no remote IP when unknown
//   Q4  hashKey salted and stable; clientIp takes the first forwarded hop
//   W1  wiring: the claim route checks config, then the body, then
//       Turnstile, BEFORE the database; the data route answers 503 on a read
//       error; the page is noindex; /v/ is outside the middleware; the
//       route sends p_block_id only for a shift (a game claim is 0121's call)
// ANTI-VACUITY: every spot action and every claim outcome kind occurs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimOutcome,
  fmtDay,
  formProblem,
  groupSpots,
  readPageReply,
  spotAction,
  spotDetail,
  spotKey,
  spotTitle,
  type PageSpot,
} from "@/lib/volunteers/signup-page";
import { clientIp, hashKey, parseClaimBody, publicConfig, verifyTurnstile } from "@/lib/volunteers/public-server";
import * as W from "@/lib/volunteers/words";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let checks = 0;
const failures: string[] = [];
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
}
const counters = { signUp: 0, taken: 0, rainedOut: 0, closed: 0, done: 0, overlap: 0, refused: 0 };

async function main() {
  // P1
  ok(readPageReply({ status: "unknown" }).kind === "unknown", "P1", "unknown");
  ok(readPageReply({ status: "plan" }).kind === "plan", "P1", "plan");
  const okReply = { status: "ok", league_name: "Example LL", now: "2027-03-05T10:00", seasons: [{ id: "s1", name: "Spring 2027" }], season_id: "s1", divisions: [], roles: [], spots: [] };
  ok(readPageReply(okReply).kind === "ok", "P1", "ok");
  for (const bad of [null, "x", { status: "ok" }, { ...okReply, spots: null }, { ...okReply, now: 3 }, { status: "weird" }]) {
    ok(readPageReply(bad).kind === "error", "P1", `malformed → error: ${JSON.stringify(bad)?.slice(0, 60)}`);
  }

  // P2
  const base: PageSpot = {
    kind: "game", block_id: null, assigned_team_name: null,
    game_id: "g1", role_id: "rFP", for_team_id: null, for_team_name: null, division_id: "dM", division_name: "Majors",
    home_team_name: "Expos", away_team_name: "Pirates", interleague: false, is_away: false, field: "Field 1", park: "Main Park",
    start: "2027-03-06T08:15", game_start: "2027-03-06T09:00", end: "2027-03-06T10:30", state: "open", spots: 2, taken: 1,
  };
  const a1 = spotAction(base);
  ok(a1.kind === "sign_up" && a1.openLine === "1 of 2 spots open", "P2", "one of two open", JSON.stringify(a1));
  if (a1.kind === "sign_up") counters.signUp++;
  const a2 = spotAction({ ...base, spots: 1, taken: 0 });
  ok(a2.kind === "sign_up" && a2.openLine === "1 spot open", "P2", "a single spot", JSON.stringify(a2));
  const a3 = spotAction({ ...base, taken: 2 });
  ok(a3.kind === "taken", "P2", "full → Taken", JSON.stringify(a3));
  if (a3.kind === "taken") counters.taken++;
  ok(spotAction({ ...base, taken: 5 }).kind === "taken", "P2", "over-full still Taken");
  const a4 = spotAction({ ...base, state: "rained_out" });
  ok(a4.kind === "rained_out", "P2", "rained out → no button");
  if (a4.kind === "rained_out") counters.rainedOut++;
  const a5 = spotAction({ ...base, state: "closed" });
  ok(a5.kind === "closed", "P2", "closed → no button");
  if (a5.kind === "closed") counters.closed++;
  ok(spotAction({ ...base, state: "may_move" }).kind === "sign_up", "P2", "a game that may move still takes sign-ups");

  // P3
  const spots: PageSpot[] = [
    { ...base, game_id: "g2", start: "2027-03-13T09:00" },
    { ...base, game_id: "g1", start: "2027-03-06T12:00", role_id: "rGC" },
    { ...base, game_id: "g3", start: "2027-03-06T08:15", division_id: "dA", division_name: "AAA" },
  ];
  const all = groupSpots(spots, { roleId: null, divisionId: null });
  ok(all.length === 2 && all[0].date === "2027-03-06" && all[0].spots[0].start === "2027-03-06T08:15", "P3", "by date, time order",
    JSON.stringify(all.map((g) => [g.date, g.spots.map((s) => s.start)])));
  ok(groupSpots(spots, { roleId: "rGC", divisionId: null }).flatMap((g) => g.spots).every((s) => s.role_id === "rGC"), "P3", "role chip");
  ok(groupSpots(spots, { roleId: null, divisionId: "dA" }).flatMap((g) => g.spots).length === 1, "P3", "division chip");

  // P4
  const form = { divisionId: "dM", teamId: "tE", firstInitial: "a", lastName: "Garcia", email: "a@example.org", adult: true };
  ok(formProblem(form) === null, "P4", "a good form");
  for (const [what, p, want] of [
    ["no division", { divisionId: "" }, W.PUB_NEED_DIVISION], ["no team", { teamId: "" }, W.PUB_NEED_TEAM],
    ["two letters", { firstInitial: "ab" }, W.PUB_NEED_INITIAL], ["a digit", { firstInitial: "1" }, W.PUB_NEED_INITIAL],
    ["no last name", { lastName: "  " }, W.PUB_NEED_LAST], ["markup", { lastName: "<b>" }, W.PUB_NEED_LAST],
    ["bad email", { email: "x@y" }, W.PUB_NEED_EMAIL], ["two emails", { email: "a@b.org,c@d.org" }, W.PUB_NEED_EMAIL],
    ["not 18", { adult: false }, W.PUB_NEED_ADULT],
  ] as const) {
    ok(formProblem({ ...form, ...(p as object) }) === want, "P4", what);
  }

  // P5
  const done = claimOutcome({ status: "claimed", position: 1 });
  ok(done.kind === "done", "P5", "claimed"); if (done.kind === "done") counters.done++;
  const ov = claimOutcome({ status: "overlap_confirm_needed" });
  ok(ov.kind === "overlap", "P5", "overlap asks again"); if (ov.kind === "overlap") counters.overlap++;
  for (const [s, line] of [
    ["just_taken", W.PUB_JUST_TAKEN], ["already_signed_up", W.PUB_ALREADY], ["wrong_team", W.PUB_WRONG_TEAM],
    ["invalid_input", W.PUB_INVALID], ["rate_limited", W.PUB_RATE_LIMITED], ["captcha", W.PUB_CAPTCHA],
    ["rained_out", W.PUB_SPOT_GONE], ["past", W.PUB_SPOT_GONE], ["unpublished", W.PUB_SPOT_GONE], ["signups_closed", W.PUB_SPOT_GONE],
    ["no_slot", W.PUB_SPOT_GONE], ["closed", W.PUB_SPOT_GONE], ["unknown", W.PUB_LINK_OFF], ["plan", W.PUB_LINK_OFF],
  ] as const) {
    const o = claimOutcome({ status: s });
    ok(o.kind === "refused" && o.line === line, "P5", `${s} worded`, JSON.stringify(o));
    if (o.kind === "refused") counters.refused++;
  }
  ok(claimOutcome({ status: "claimed" }).kind === "refused", "P5", "claimed without a position isn't trusted");
  const odd = claimOutcome({ status: "<script>" });
  ok(odd.kind === "refused" && odd.line === W.PUB_FAILED, "P5", "an unknown status → the generic line");
  ok(claimOutcome(null).kind === "refused", "P5", "no reply → refused");

  // P6
  ok(spotTitle({ ...base, for_team_name: "Expos", role_id: "rGC" }, [{ id: "rGC", name: "GameChanger", kind: "per_team" }]) === "GameChanger · Expos", "P6", "per-team title");
  ok(spotDetail(base) === "8:15 AM · Expos vs Pirates · Field 1 (Main Park)", "P6", "detail", spotDetail(base));
  ok(spotDetail({ ...base, field: null, is_away: true, away_team_name: null, home_team_name: "Giants" }) === "8:15 AM · Giants · Away", "P6", "away detail",
    spotDetail({ ...base, field: null, is_away: true, away_team_name: null, home_team_name: "Giants" }));
  ok(fmtDay("2027-03-06T08:15") === "Saturday, March 6", "P6", "day", fmtDay("2027-03-06T08:15"));

  // P7 — snack shack shifts
  const withShifts = readPageReply({
    ...okReply,
    spots: [{ ...base }],
    shifts: [
      { block_id: "b1", role_id: "rSS", start: "2027-03-06T09:30", end: "2027-03-06T11:30", assigned_team_name: "Braves", spots: 2, taken: 1 },
      { block_id: "b2", role_id: "rSS", start: "2027-03-06T11:30", end: "2027-03-06T13:30", assigned_team_name: null, spots: 3, taken: 3 },
    ],
  });
  const shiftSpots = withShifts.kind === "ok" ? withShifts.data.spots.filter((s) => s.kind === "shift") : [];
  ok(withShifts.kind === "ok" && withShifts.data.spots.length === 3 && shiftSpots.length === 2 &&
     shiftSpots[0].block_id === "b1" && shiftSpots[0].game_id === "" && shiftSpots[0].for_team_id === null,
    "P7", "shifts read as spots", JSON.stringify(shiftSpots[0]));
  const noShifts = readPageReply(okReply);
  ok(noShifts.kind === "ok" && noShifts.data.spots.length === 0, "P7", "no shifts key → none");
  ok(spotKey(shiftSpots[0]) === "shift|b1" && spotKey(shiftSpots[1]) === "shift|b2", "P7", "keyed by block",
    shiftSpots.map(spotKey).join(","));
  ok(spotDetail(shiftSpots[0]) === "9:30–11:30 AM · For Braves families", "P7", "assigned shift detail", spotDetail(shiftSpots[0]));
  ok(spotDetail(shiftSpots[1]) === "11:30 AM–1:30 PM", "P7", "open shift: times only", spotDetail(shiftSpots[1]));
  const sa = spotAction(shiftSpots[0]);
  ok(sa.kind === "sign_up" && sa.openLine === "1 of 2 spots open" && spotAction(shiftSpots[1]).kind === "taken", "P7", "headcount spots", JSON.stringify(sa));
  ok(groupSpots(shiftSpots, { roleId: null, divisionId: "dM" }).flatMap((g) => g.spots).length === 2, "P7", "a division chip keeps shifts");
  ok(groupSpots(shiftSpots, { roleId: "rGC", divisionId: null }).length === 0, "P7", "a role chip filters shifts");

  // Q1
  const salt = "s".repeat(32);
  ok(publicConfig({ TURNSTILE_SECRET_KEY: "x", VOLUNTEER_HASH_SALT: salt }) !== null, "Q1", "configured");
  ok(publicConfig({ VOLUNTEER_HASH_SALT: salt }) === null, "Q1", "no secret");
  ok(publicConfig({ TURNSTILE_SECRET_KEY: "x" }) === null, "Q1", "no salt");
  ok(publicConfig({ TURNSTILE_SECRET_KEY: "x", VOLUNTEER_HASH_SALT: "short" }) === null, "Q1", "short salt");

  // Q2
  const U = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
  const good = { gameId: U(1), roleId: U(2), forTeamId: null, divisionId: U(3), teamId: U(4), firstInitial: "A", lastName: "Garcia", email: "a@example.org", adult: true, turnstileToken: "t" };
  ok(parseClaimBody(good)?.confirmOverlap === false, "Q2", "valid body");
  const shiftBody = parseClaimBody({ ...good, gameId: null, blockId: U(5), forTeamId: U(6) });
  ok(shiftBody?.blockId === U(5) && shiftBody.gameId === null && shiftBody.forTeamId === null, "Q2", "a shift body (no for-team)",
    JSON.stringify(shiftBody));
  ok(parseClaimBody({ ...good, blockId: U(5) }) === null, "Q2", "a game AND a shift → null");
  ok(parseClaimBody({ ...good, gameId: null }) === null, "Q2", "neither → null");
  ok(parseClaimBody({ ...good, gameId: null, blockId: "b1" }) === null, "Q2", "a bad block id → null");
  for (const [what, p] of [
    ["bad game id", { gameId: "g1" }], ["bad for-team", { forTeamId: "x" }], ["adult missing", { adult: undefined }],
    ["adult as text", { adult: "yes" }], ["no captcha", { turnstileToken: "" }], ["long name", { lastName: "x".repeat(201) }],
  ] as const) {
    ok(parseClaimBody({ ...good, ...(p as object) }) === null, "Q2", what);
  }

  // Q3
  const calls: { body: string }[] = [];
  const fake = (success: unknown, opts: { throws?: boolean; status?: number } = {}) =>
    (async (_u: unknown, init?: { body?: unknown }) => {
      calls.push({ body: String(init?.body ?? "") });
      if (opts.throws) throw new Error("net");
      return new Response(JSON.stringify({ success }), { status: opts.status ?? 200 });
    }) as unknown as typeof fetch;
  ok((await verifyTurnstile("sec", "tok", "1.2.3.4", fake(true))) === true, "Q3", "success");
  ok(calls[0]?.body.includes("remoteip=1.2.3.4") && calls[0].body.includes("secret=sec"), "Q3", "sends secret and ip", calls[0]?.body);
  ok((await verifyTurnstile("sec", "tok", "1.2.3.4", fake(false))) === false, "Q3", "failure");
  ok((await verifyTurnstile("sec", "tok", "1.2.3.4", fake("true"))) === false, "Q3", "only a real true counts");
  ok((await verifyTurnstile("sec", "tok", "1.2.3.4", fake(true, { status: 500 }))) === false, "Q3", "a 500");
  ok((await verifyTurnstile("sec", "tok", "1.2.3.4", fake(true, { throws: true }))) === false, "Q3", "a thrown fetch");
  const before = calls.length;
  ok((await verifyTurnstile("sec", null, "1.2.3.4", fake(true))) === false && calls.length === before, "Q3", "no token → no call, false");
  await verifyTurnstile("sec", "tok", "unknown", fake(true));
  ok(!calls[calls.length - 1].body.includes("remoteip"), "Q3", "no remote ip when unknown");

  // Q4
  ok(hashKey(salt, "ip:1.2.3.4") === hashKey(salt, "ip:1.2.3.4") && /^[0-9a-f]{64}$/.test(hashKey(salt, "x")), "Q4", "stable hex");
  ok(hashKey(salt, "ip:1.2.3.4") !== hashKey("t".repeat(32), "ip:1.2.3.4"), "Q4", "salted");
  ok(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })) === "9.9.9.9", "Q4", "first hop");
  ok(clientIp(new Headers({})) === "unknown", "Q4", "none → unknown");

  // W1
  const claim = read("src/app/api/volunteers/signup/[token]/claim/route.ts");
  const at = (s: string) => claim.indexOf(s);
  ok(at("publicConfig(process.env)") > 0 && at("publicConfig(process.env)") < at("parseClaimBody(") &&
     at("parseClaimBody(") < at("verifyTurnstile(") && at("verifyTurnstile(") < at('"volunteer_claim"'), "W1",
     "claim route: config → body → Turnstile → database");
  ok(/if \(!config\) \{[\s\S]*?status: 503/.test(claim), "W1", "no config → 503");
  const dataRoute = read("src/app/api/volunteers/signup/[token]/route.ts");
  ok(/if \(error\) \{[\s\S]*?status: 503/.test(dataRoute), "W1", "data route: a read error → 503");
  ok(read("src/app/v/[token]/page.tsx").includes("robots: { index: false, follow: false }"), "W1", "page is noindex");
  ok(read("src/middleware.ts").includes("|s/|v/|"), "W1", "/v/ outside the middleware");
  ok(claim.includes("...(body.blockId ? { p_block_id: body.blockId } : {})") && !/p_block_id: body\.blockId \?\?/.test(claim), "W1",
    "the route sends p_block_id only for a shift");
  const client = read("src/components/volunteers/signup-page-client.tsx");
  ok(client.includes('blockId: spot.kind === "shift" ? spot.block_id : null'), "W1", "the page sends the shift's block");

  for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(`\n${failures.length} failure(s) of ${checks} checks`);
    process.exit(1);
  }
  console.log(`sim:volunteer-signup-page — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);
}

void main();
