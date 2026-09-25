// Harness for the division panel's "Reschedule a game" action.
//
// PART H — the reschedule modal's header variant
// (src/components/divisions/reschedule-modal-header.tsx).
// The header was lifted verbatim out of RainoutRescheduleModal and given a
// `variant` so a plain move doesn't wear a rain cloud. Every existing caller
// omits the prop, so the DEFAULT render must be byte-identical to the markup
// recorded before the variant existed
// (scripts/sim/fixtures/reschedule-modal-header-golden.html). If [H1] fails,
// an existing caller's header changed — fix the component, never re-record.
//
// PART M — RescheduleRequestModal's optional `intro` line. Absent, the modal
// must render byte-identically to scripts/sim/fixtures/
// reschedule-request-modal-golden.html, recorded before the prop existed
// (TZ=UTC: the "Currently" line formats a date).
//
// PART R — routeMoveTarget (src/lib/schedule/panel-reschedule-route.ts), the
// one decision about where a picked game goes. The load-bearing properties:
// an interleague game NEVER reaches the plain picker, in any context; the plain
// route's awayTeamId is a real string; a locked division refuses a plain move
// with the "move" reason; every refusal carries a sentence.
// The fixture includes an interleague game WITH an away_team_id set — not a
// live shape (66/66 live interleague games have it null), but without it a
// mutant that forgets the interleague branch would land on `no_opponent`
// rather than `plain` and the plain-path assertion would prove nothing.
//
// PART V — the move variant offers NO makeup days (2026-09-25). Makeup means
// "a rained-out game may move here"; a plain move is not a rainout, so
// `availabilityForVariant` strips the flags for "move" and leaves "rainout"
// untouched (src/lib/schedule/reschedule-variant.ts). Driven through the REAL
// slot builder on a Saturday-only division with a makeup-flagged Friday: the
// rainout door must offer Friday, the move door must not, and Saturday must be
// identical through both. Case (a)'s empty-day wording is pinned too — the
// rainout strings as LITERALS (byte-identical to before), and no move string
// may name makeups.
//
// PART S — source wiring. The harness drives the lib, not the panel; these
// textual checks pin that the panel still CALLS the router and renders the
// picker from the router's typed awayTeamId. Weak by nature (a grep), stated.
//
// ANTI-VACUITY: counters for an ordinary game routed to the plain picker, an
// interleague game routed to the request flow, the upsell, and every blocked
// reason. A zero fails the run.
//
// JSX: the repo's tsconfig uses `jsx: preserve` (Next compiles it), so tsx
// falls back to the classic runtime and needs a global React. The component is
// therefore imported dynamically after that global is set.
//
// ── MUTATION LOG (2026-09-25) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   HM1  default variant flipped to "move"          → [H1]
//   HM2  "move" still renders the rain cloud          → [H3]
// RESULT: 2/2 killed, each at its own assertion.
//   PM1  intro rendered even when absent (empty box)   → [M1]
//   RM1  interleague branch skipped → anomaly row goes plain  → [R2]
//   RM2  lock gate skipped on the plain path                → [R7]
//   RM3  ordinary status check dropped (completed moves)    → [R10]
//   RM4  plain returns before the plan check (Free moves)   → [R8]
//   VM1  availabilityForVariant never strips (move offers makeups) → [V2]
//   VM2  availabilityForVariant always strips (rainout loses them) → [V1]
//   VM3  noFieldCopy's move branch removed (move names makeups)    → [V3]
// RESULT (V): 3/3 killed, each FIRST at its own assertion.
//   RM5  reschedule_pending branch removed (falls through)   → [R5]
// RESULT: 6/6 killed, each FIRST at its own assertion. RM1 is the one the
// ilAnomaly fixture exists for: without an interleague row carrying an
// away_team_id, the mutant lands on `no_opponent` and [R2] passes vacuously.

import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function partH() {
  const { RescheduleModalHeader } = await import(
    "@/components/divisions/reschedule-modal-header"
  );
  const golden = readFileSync(
    join(__dirname, "fixtures", "reschedule-modal-header-golden.html"),
    "utf8",
  ).trimEnd();
  const base = { homeTeamName: "Mets", awayTeamName: "Cubs & Co", onClose: () => {} };
  const render = (variant?: "rainout" | "move") =>
    renderToStaticMarkup(
      React.createElement(RescheduleModalHeader, variant ? { ...base, variant } : base),
    );

  const dflt = render();
  ok(dflt === golden, "[H1] default header byte-identical to the pre-variant golden");
  ok(render("rainout") === golden, "[H2] explicit rainout byte-identical to the golden");
  const move = render("move");
  ok(
    move.includes("lucide-calendar-clock") && !move.includes("lucide-cloud-rain"),
    "[H3] move variant shows no rain cloud",
  );
  const stripIcon = (html: string) =>
    html.replace(/<svg[^>]*class="lucide lucide-(cloud-rain|calendar-clock)[\s\S]*?<\/svg>/, "<ICON/>");
  ok(
    stripIcon(move) === stripIcon(golden),
    "[H4] move variant differs from rainout in the icon ONLY",
  );
}

async function partM() {
  const { RescheduleRequestModal } = await import(
    "@/components/interleague/reschedule-request-modal"
  );
  const golden = readFileSync(
    join(__dirname, "fixtures", "reschedule-request-modal-golden.html"),
    "utf8",
  ).trimEnd();
  const base = {
    game: {
      scheduled_at: "2026-10-10T15:30:00+00:00",
      is_away: false,
      external_team_name: "Tigers",
      proposed_venue_name: null,
      home_team: { name: "Mets" },
      venue: { name: "Andrews" },
      interleague_org: { name: "Westside LL" },
    },
    busy: false,
    error: null,
    onSubmit: () => {},
    onClose: () => {},
  };
  const without = renderToStaticMarkup(React.createElement(RescheduleRequestModal, base));
  ok(without === golden, "[M1] no intro → byte-identical to the pre-prop golden");
  const intro = "Westside LL agreed to this time, so moving it sends them a request.";
  const withIntro = renderToStaticMarkup(
    React.createElement(RescheduleRequestModal, { ...base, intro }),
  );
  ok(withIntro.includes(intro), "[M2] intro text rendered when given");
  ok(
    withIntro.replace(/<p class="rounded-lg border border-purple-100[^"]*">[^<]*<\/p>/, "") === golden,
    "[M3] intro adds its one line and changes nothing else",
  );
}

async function partR() {
  const { routeMoveTarget, MOVE_UPGRADE_FEATURE } = await import(
    "@/lib/schedule/panel-reschedule-route"
  );
  const { lockedReason } = await import("@/lib/schedule/division-lock");
  type Route = ReturnType<typeof routeMoveTarget>;

  const NOW = Date.parse("2026-09-25T12:00:00Z");
  const FUTURE = "2026-10-10T15:30:00+00:00";
  const PAST = "2026-09-20T15:30:00+00:00";
  const DIV = "AA";
  const org = { name: "Westside LL" };

  const games = {
    ordinary: { status: "scheduled", scheduled_at: FUTURE, interleague_org_id: null, away_team_id: "t_cubs" },
    ordinaryPast: { status: "scheduled", scheduled_at: PAST, interleague_org_id: null, away_team_id: "t_cubs" },
    cancelled: { status: "cancelled", scheduled_at: FUTURE, interleague_org_id: null, away_team_id: "t_cubs" },
    completed: { status: "completed", scheduled_at: PAST, interleague_org_id: null, away_team_id: "t_cubs" },
    noOpponent: { status: "scheduled", scheduled_at: FUTURE, interleague_org_id: null, away_team_id: null },
    ilAccepted: { status: "scheduled", scheduled_at: FUTURE, interleague_org_id: "io_1", away_team_id: null, interleague_org: org },
    ilAnomaly: { status: "scheduled", scheduled_at: FUTURE, interleague_org_id: "io_1", away_team_id: "t_cubs", interleague_org: org },
    ilPast: { status: "scheduled", scheduled_at: PAST, interleague_org_id: "io_1", away_team_id: null, interleague_org: org },
    ilPending: { status: "pending_interleague", scheduled_at: FUTURE, interleague_org_id: "io_1", away_team_id: null, interleague_org: org },
    ilRequested: { status: "reschedule_pending", scheduled_at: FUTURE, interleague_org_id: "io_1", away_team_id: null, interleague_org: org },
  } as const;
  const ctx = (locked: boolean, canReschedule: boolean) => ({
    locked,
    canReschedule,
    divisionName: DIV,
    nowMs: NOW,
  });
  const route = (g: keyof typeof games, locked = false, pro = true): Route =>
    routeMoveTarget(games[g], ctx(locked, pro));

  const counters: Record<string, number> = {
    plainRouted: 0,
    interleagueRouted: 0,
    upgrade: 0,
    blocked_cancelled: 0,
    blocked_locked: 0,
    blocked_pending_interleague: 0,
    blocked_already_requested: 0,
    blocked_past_interleague: 0,
    blocked_not_movable_status: 0,
    blocked_no_opponent: 0,
  };
  const all: { name: string; isIL: boolean; r: Route }[] = [];
  for (const name of Object.keys(games) as (keyof typeof games)[]) {
    for (const locked of [false, true]) {
      for (const pro of [false, true]) {
        const r = route(name, locked, pro);
        all.push({ name, isIL: games[name].interleague_org_id !== null, r });
        if (r.kind === "plain") counters.plainRouted++;
        else if (r.kind === "interleague_request") counters.interleagueRouted++;
        else if (r.kind === "upgrade") counters.upgrade++;
        else counters[`blocked_${r.reason}`]++;
      }
    }
  }

  const r1 = route("ordinary");
  ok(
    r1.kind === "plain" && r1.awayTeamId === "t_cubs",
    "[R1] ordinary scheduled game, unlocked, Pro → plain picker with its away team",
    JSON.stringify(r1),
  );
  const ilPlain = all.filter((x) => x.isIL && x.r.kind === "plain");
  ok(
    ilPlain.length === 0,
    "[R2] NO interleague game reaches the plain picker, in any context",
    JSON.stringify(ilPlain.map((x) => x.name)),
  );
  const r3 = route("ilAccepted");
  ok(
    r3.kind === "interleague_request" && r3.intro.includes("Westside LL"),
    "[R3] accepted upcoming interleague game → request flow, naming the partner",
    JSON.stringify(r3),
  );
  const r4 = route("ilPending");
  ok(
    r4.kind === "blocked" && r4.reason === "pending_interleague" &&
      r4.link?.href === "/dashboard/interleague",
    "[R4] pending_interleague → pointed at the Interleague page",
    JSON.stringify(r4),
  );
  const r5 = route("ilRequested");
  ok(
    r5.kind === "blocked" && r5.reason === "already_requested" &&
      r5.link?.href === "/dashboard/interleague",
    "[R5] reschedule_pending → 'already waiting', pointed at the Interleague page",
    JSON.stringify(r5),
  );
  const r6 = route("ilPast");
  ok(
    r6.kind === "blocked" && r6.reason === "past_interleague",
    "[R6] past interleague game → nothing to request",
  );
  const r7 = route("ordinary", true, true);
  ok(
    r7.kind === "blocked" && r7.reason === "locked" &&
      r7.message === lockedReason(DIV, "move"),
    "[R7] locked division refuses a plain move with the shared 'move' sentence",
    JSON.stringify(r7),
  );
  const r7b = route("ilAccepted", true, true);
  ok(
    r7b.kind === "blocked" && r7b.reason === "locked" &&
      r7b.message === lockedReason(DIV, "rescheduleInterleague"),
    "[R7b] locked division refuses an interleague request with the route's own sentence",
  );
  const r8 = route("ordinary", false, false);
  ok(r8.kind === "upgrade", "[R8] Free plan, ordinary game → Pro upsell", JSON.stringify(r8));
  ok(
    route("ilAccepted", false, false).kind === "interleague_request",
    "[R8b] Free plan, interleague game → request flow (stays Free)",
  );
  const r9 = route("cancelled");
  ok(r9.kind === "blocked" && r9.reason === "cancelled", "[R9] rained-out game → its own button");
  const r10 = route("completed");
  ok(
    r10.kind === "blocked" && r10.reason === "not_movable_status",
    "[R10] a non-scheduled ordinary game (completed) is never moved",
    JSON.stringify(r10),
  );
  const r11 = route("noOpponent");
  ok(
    r11.kind === "blocked" && r11.reason === "no_opponent",
    "[R11] ordinary game with no away team never reaches the picker",
  );
  const silent = all.filter((x) => x.r.kind === "blocked" && !x.r.message.trim());
  ok(silent.length === 0, "[R12] every refusal carries a sentence");
  const plains = all.filter((x) => x.r.kind === "plain");
  ok(
    plains.every(
      (x) => x.r.kind === "plain" && typeof x.r.awayTeamId === "string" &&
        x.r.awayTeamId.length > 0 && !x.isIL,
    ),
    "[R13] every plain route carries a real away team and no interleague org",
  );
  ok(
    route("ordinaryPast").kind === "plain",
    "[R14] a past ORDINARY game can still be moved (only interleague is future-only)",
  );
  ok(MOVE_UPGRADE_FEATURE.length > 0, "[R15] upsell names a feature");

  for (const [name, n] of Object.entries(counters)) {
    ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  }
  console.log("  counters:", JSON.stringify(counters));
}

async function partV() {
  const { availabilityForVariant, noFieldCopy } = await import(
    "@/lib/schedule/reschedule-variant"
  );
  const { buildSlotsAndDiagnostics } = await import("@/lib/schedule/reschedule-slots");
  const { parseAvailability } = await import("@/lib/venues/availability");
  type Params = Parameters<typeof buildSlotsAndDiagnostics>[0];

  const VEN = "v_andrews";
  const SAT = "2026-08-15";
  const FRI = "2026-08-21";
  const raw = parseAvailability({
    Sa: { start: "08:00", end: "20:00", practice: true },
    Fr: { start: "16:30", end: "21:00", practice: true, makeup: true },
  });
  const params = (variant: "rainout" | "move", overrides?: Params["overrides"]): Params => ({
    startDate: SAT,
    endDate: "2026-08-22",
    playingDays: ["Sa"],
    dayWindows: { Sa: { start: "10:00", end: "18:00" } },
    earliestStart: "10:00",
    latestStart: "18:00",
    gameDuration: 105,
    bufferMinutes: 30,
    maxPerTeamDay: 1,
    venueIds: [VEN],
    venueNames: { [VEN]: "Andrews" },
    venueAvailability: { [VEN]: availabilityForVariant(raw, variant) },
    blackoutDates: new Set<string>(),
    venueBookings: new Map(),
    homeTeamSpans: new Map(),
    awayTeamSpans: new Map(),
    homeTeamDayCounts: new Map(),
    awayTeamDayCounts: new Map(),
    homeTeamId: "h",
    awayTeamId: "a",
    constraintRules: new Map(),
    today: SAT,
    ...(overrides ? { overrides } : {}),
  });
  const onDate = (r: ReturnType<typeof buildSlotsAndDiagnostics>, d: string) =>
    r.slots.filter((x) => x.date === d).map((x) => `${x.isoString}|${x.venueId}`);

  const rain = buildSlotsAndDiagnostics(params("rainout"));
  const move = buildSlotsAndDiagnostics(params("move"));
  const counters = {
    makeupDayOfferedOnRainout: onDate(rain, FRI).length,
    makeupDayWithheldOnMove: onDate(move, FRI).length === 0 && raw.Fr?.makeup === true ? 1 : 0,
    playingDaySlotsCompared: onDate(rain, SAT).length,
  };

  ok(onDate(rain, FRI).length > 0, "[V1] rainout door offers the makeup-flagged Friday");
  ok(
    onDate(move, FRI).length === 0,
    "[V2] move door offers NOTHING on the makeup-flagged Friday",
    JSON.stringify(onDate(move, FRI).slice(0, 3)),
  );
  const friDiag = move.diagnostics.get(FRI);
  const friCopy = noFieldCopy({
    variant: "move",
    includeNonPlayingDays: false,
    playsThatDay: false,
    divisionName: "AA",
    countSuffix: "",
  });
  ok(
    friDiag?.kind === "no_field" &&
      friCopy.text === "AA doesn't play that day." &&
      friCopy.tone === "info" && friCopy.link === null,
    "[V3] move: the withheld Friday reads 'doesn't play', grey, no Makeup link",
    JSON.stringify({ friDiag, friCopy }),
  );
  ok(
    JSON.stringify(onDate(rain, SAT)) === JSON.stringify(onDate(move, SAT)) &&
      onDate(rain, SAT).length > 0,
    "[V4] the playing day is identical through both doors",
  );
  const moveOff = buildSlotsAndDiagnostics(params("move", { includeNonPlayingDays: true }));
  const offFri = moveOff.slots.filter((x) => x.date === FRI);
  ok(
    offFri.length > 0 && offFri.every((x) => x.exceptions?.includes("off_day")),
    "[V5] move + 'include non-playing days' reaches Friday, every slot marked Off day",
  );

  // Rainout wording — LITERALS, byte-identical to the pre-change JSX strings.
  const rc = (inp: boolean, suffix: string) =>
    noFieldCopy({ variant: "rainout", includeNonPlayingDays: inp, playsThatDay: false, divisionName: "AA", countSuffix: suffix });
  const r0 = rc(false, "");
  const r1 = rc(true, " (2 dates)");
  ok(
    r0.text === "no field is open and marked for makeups." &&
      r0.link === "Mark a field \u201cMakeup\u201d on the Venues page" && r0.tone === "config",
    "[V6] rainout, override off: unchanged makeup wording + link",
  );
  ok(
    r1.text === "no field is open that day (2 dates)." &&
      r1.link === "Set field hours on the Venues page" && r1.tone === "config",
    "[V6b] rainout, override on: unchanged wording + link",
  );
  const mPlay = noFieldCopy({ variant: "move", includeNonPlayingDays: false, playsThatDay: true, divisionName: "AA", countSuffix: "" });
  ok(
    mPlay.text === "no field is open that day." && mPlay.link === "Set field hours on the Venues page",
    "[V7] move, a playing day with no open field: 'no field is open', Set-hours link",
  );
  const moveCopies = [false, true].flatMap((inp) =>
    [false, true].map((plays) =>
      noFieldCopy({ variant: "move", includeNonPlayingDays: inp, playsThatDay: plays, divisionName: "AA", countSuffix: "" }),
    ),
  );
  ok(
    moveCopies.every((c) => !/makeup/i.test(`${c.text} ${c.link ?? ""}`)),
    "[V8] no move-variant sentence or link names makeups",
  );
  ok(availabilityForVariant(raw, "rainout") === raw, "[V9] rainout passes availability through untouched");

  for (const [name, n] of Object.entries(counters)) {
    ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  }
  console.log("  counters V:", JSON.stringify(counters));
}

function partS() {
  const src = readFileSync(
    join(__dirname, "..", "..", "src", "components", "divisions", "division-schedule-panel.tsx"),
    "utf8",
  );
  ok(src.includes("routeMoveTarget(game,"), "[S1] the panel routes picks through routeMoveTarget");
  ok(
    src.includes("awayTeamId={moveTarget.awayTeamId}") &&
      !/awayTeamId=\{moveTarget[^}]*!\}/.test(src),
    "[S2] the move render site passes the router's typed awayTeamId, no `!`",
  );
  ok(src.includes('variant="move"'), "[S3] the plain move opens the picker with the move header");
  ok(
    src.includes("submitInterleagueRescheduleRequest("),
    "[S4] the panel submits requests through the shared helper",
  );
  const modal = readFileSync(
    join(__dirname, "..", "..", "src", "components", "divisions", "rainout-reschedule-modal.tsx"),
    "utf8",
  );
  ok(
    /availabilityForVariant\(\s*parseAvailability\([^)]*\),\s*variant,?\s*\)/.test(modal),
    "[S5] the picker feeds the builder through availabilityForVariant(…, variant)",
  );
  ok(
    (modal.match(/variant=\{variant\}/g) ?? []).length >= 3,
    "[S6] both empty-day renderings and the header receive the variant",
  );
}

async function main() {
  console.log("\npanel-reschedule sim");
  await partH();
  await partM();
  await partR();
  await partV();
  partS();
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
