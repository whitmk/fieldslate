// Harness for the Schedule page's "Reschedule" (list row menu + calendar
// popover): src/lib/schedule/schedule-page-reschedule-route.ts, wired through
// src/components/schedule/use-schedule-reschedule.tsx.
//
// WHAT IT PINS
// - R: routing across every status × interleague × lock × plan. A scheduled
//   game routes to the MOVE picker; a rained-out game to the RAINOUT picker,
//   even on a locked division (rainout recovery is exempt); no interleague game
//   ever reaches a picker; a COMPLETED game is refused (the picker's save would
//   have silently un-completed it); every refusal carries a sentence.
// - V: the variant is chosen PER GAME (`pickerFor`), and end to end through the
//   REAL slot builder a rained-out game is still offered its makeup day while a
//   scheduled game is not.
// - S: source wiring — both surfaces go through the shared hook, and the hook's
//   one render site passes the ROUTED variant and typed awayTeamId.
//
// ANTI-VACUITY: counters for a scheduled game routed to the move picker, a
// rained-out game routed to the rainout picker, and interleague games routed.
//
// ── MUTATION LOG (2026-09-26) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   SM1  pickerFor fixed to "move" (variant fixed for the surface)   → [V1]
//   SM2  rainout variant loses makeup days (strip on every variant)  → [V2]
//   SM3  wrapper's rained-out case removed (falls to routeMoveTarget) → [R2]
//   SM4  the hook's render site passes a fixed variant                → [S2]
// RESULT: 4/4 killed, each FIRST at its own assertion.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pickerFor,
  routeScheduleReschedule,
  type ScheduleRescheduleRoute,
} from "@/lib/schedule/schedule-page-reschedule-route";
import { availabilityForVariant } from "@/lib/schedule/reschedule-variant";
import { buildSlotsAndDiagnostics } from "@/lib/schedule/reschedule-slots";
import { parseAvailability } from "@/lib/venues/availability";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = Date.parse("2026-09-26T12:00:00Z");
const FUTURE = "2026-10-10T15:30:00+00:00";
const PAST = "2026-09-20T15:30:00+00:00";
const org = { name: "Westside LL" };

const games = {
  scheduled: { status: "scheduled", scheduled_at: FUTURE, interleague_org_id: null, away_team_id: "t_cubs" },
  rainedOut: { status: "cancelled", scheduled_at: PAST, interleague_org_id: null, away_team_id: "t_cubs" },
  completed: { status: "completed", scheduled_at: PAST, interleague_org_id: null, away_team_id: "t_cubs" },
  rainedOutNoOpp: { status: "cancelled", scheduled_at: PAST, interleague_org_id: null, away_team_id: null },
  ilAccepted: { status: "scheduled", scheduled_at: FUTURE, interleague_org_id: "io", away_team_id: null, interleague_org: org },
  ilAnomaly: { status: "scheduled", scheduled_at: FUTURE, interleague_org_id: "io", away_team_id: "t_x", interleague_org: org },
  ilRainedOut: { status: "cancelled", scheduled_at: PAST, interleague_org_id: "io", away_team_id: null, interleague_org: org },
  ilRainedOutAnomaly: { status: "cancelled", scheduled_at: PAST, interleague_org_id: "io", away_team_id: "t_x", interleague_org: org },
  ilPending: { status: "pending_interleague", scheduled_at: FUTURE, interleague_org_id: "io", away_team_id: null, interleague_org: org },
  ilRequested: { status: "reschedule_pending", scheduled_at: FUTURE, interleague_org_id: "io", away_team_id: null, interleague_org: org },
  ilPast: { status: "scheduled", scheduled_at: PAST, interleague_org_id: "io", away_team_id: null, interleague_org: org },
} as const;
type Name = keyof typeof games;

const route = (n: Name, locked = false, pro = true): ScheduleRescheduleRoute =>
  routeScheduleReschedule(games[n], { locked, canReschedule: pro, divisionName: "AA", nowMs: NOW });

const counters = { scheduledToMove: 0, rainedOutToRainout: 0, interleagueRouted: 0 };

function partR() {
  const all: { n: Name; r: ScheduleRescheduleRoute }[] = [];
  for (const n of Object.keys(games) as Name[]) {
    for (const locked of [false, true]) {
      for (const pro of [false, true]) {
        const r = route(n, locked, pro);
        all.push({ n, r });
        const p = pickerFor(r);
        if (n === "scheduled" && p?.variant === "move") counters.scheduledToMove++;
        if (n === "rainedOut" && p?.variant === "rainout") counters.rainedOutToRainout++;
        if (games[n].interleague_org_id) counters.interleagueRouted++;
      }
    }
  }

  const r1 = route("scheduled");
  ok(r1.kind === "plain" && r1.awayTeamId === "t_cubs", "[R1] scheduled game → the plain (move) route", JSON.stringify(r1));
  const r2 = route("rainedOut");
  ok(r2.kind === "rainout" && r2.awayTeamId === "t_cubs", "[R2] rained-out game → the rainout route", JSON.stringify(r2));
  ok(
    route("rainedOut", true, true).kind === "rainout",
    "[R3] a rained-out game on a LOCKED division still routes to rainout (exempt)",
  );
  const ilPicker = all.filter((x) => games[x.n].interleague_org_id && pickerFor(x.r) !== null);
  ok(ilPicker.length === 0, "[R4] NO interleague game reaches either picker, in any context",
    JSON.stringify(ilPicker.map((x) => x.n)));
  const r5 = route("completed");
  ok(
    r5.kind === "blocked" && r5.reason === "not_movable_status",
    "[R5] a COMPLETED game is refused (the picker's save would un-complete it)",
    JSON.stringify(r5),
  );
  const r6 = route("ilRainedOut");
  ok(
    r6.kind === "blocked" && r6.reason === "cancelled_interleague" &&
      r6.message.includes("Westside LL") && r6.link?.href === "/dashboard/interleague",
    "[R6] rained-out interleague game → refusal naming the partner, with the link",
  );
  ok(
    ["ilPending", "ilRequested", "ilPast"].every((n) => route(n as Name).kind === "blocked"),
    "[R7] pending / already-requested / past interleague → a refusal (not a silent no-op)",
  );
  ok(route("ilAccepted").kind === "interleague_request", "[R7b] accepted upcoming interleague → request flow");
  ok(
    route("scheduled", false, false).kind === "upgrade" && route("rainedOut", false, false).kind === "upgrade",
    "[R8] Free plan → the upsell, never a picker",
  );
  ok(route("rainedOutNoOpp").kind === "blocked", "[R9] rained-out game with no opponent → refusal");
  const silent = all.filter((x) => x.r.kind === "blocked" && !x.r.message.trim());
  ok(silent.length === 0, "[R10] every refusal carries a sentence");
}

function partV() {
  ok(
    pickerFor({ kind: "rainout", awayTeamId: "a" })?.variant === "rainout" &&
      pickerFor({ kind: "plain", awayTeamId: "a" })?.variant === "move" &&
      pickerFor({ kind: "upgrade" }) === null,
    "[V1] pickerFor chooses the variant from the route — rainout vs move, per game",
  );

  // End to end: Saturday-only division, makeup-flagged Friday.
  const raw = parseAvailability({
    Sa: { start: "08:00", end: "20:00" },
    Fr: { start: "16:30", end: "21:00", makeup: true },
  });
  const friSlots = (n: Name) => {
    const p = pickerFor(route(n));
    if (!p) return -1;
    const res = buildSlotsAndDiagnostics({
      startDate: "2026-08-15", endDate: "2026-08-22",
      playingDays: ["Sa"], dayWindows: { Sa: { start: "10:00", end: "18:00" } },
      earliestStart: "10:00", latestStart: "18:00",
      gameDuration: 105, bufferMinutes: 30, maxPerTeamDay: 1,
      venueIds: ["v"], venueNames: { v: "Andrews" },
      venueAvailability: { v: availabilityForVariant(raw, p.variant) },
      blackoutDates: new Set(), venueBookings: new Map(),
      homeTeamSpans: new Map(), awayTeamSpans: new Map(),
      homeTeamDayCounts: new Map(), awayTeamDayCounts: new Map(),
      homeTeamId: "h", awayTeamId: p.awayTeamId,
      constraintRules: new Map(), today: "2026-08-15",
    });
    return res.slots.filter((s) => s.date === "2026-08-21").length;
  };
  const rainFri = friSlots("rainedOut");
  const moveFri = friSlots("scheduled");
  ok(rainFri > 0, "[V2] a rained-out game is still offered its makeup day (real builder)", `got ${rainFri}`);
  ok(moveFri === 0, "[V3] a scheduled game is not offered the makeup day", `got ${moveFri}`);
}

function partS() {
  const root = join(__dirname, "..", "..", "src", "components", "schedule");
  const hook = readFileSync(join(root, "use-schedule-reschedule.tsx"), "utf8");
  const list = readFileSync(join(root, "schedule-list.tsx"), "utf8");
  const cal = readFileSync(join(root, "schedule-calendar.tsx"), "utf8");
  ok(
    [list, cal].every((f) => f.includes("useScheduleReschedule(") && !f.includes("<RainoutRescheduleModal")),
    "[S1] list and calendar both route through the shared hook; neither renders the picker itself",
  );
  ok(
    hook.includes("variant={target.variant}") && hook.includes("awayTeamId={target.awayTeamId}") &&
      !/variant="(move|rainout)"/.test(hook),
    "[S2] the hook's one render site passes the ROUTED variant and typed awayTeamId",
  );
  ok(
    hook.includes("routeScheduleReschedule(") && hook.includes("pickerFor(route)"),
    "[S3] the hook routes through the shared wrapper",
  );
  ok(
    [list, cal].every((f) => f.includes("<MoveNoticeLine")),
    "[S4] both surfaces render a refusal with MoveNoticeLine",
  );
}

function main() {
  console.log("\nschedule-page-reschedule sim");
  partR();
  partV();
  partS();
  for (const [name, n] of Object.entries(counters)) {
    ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  }
  console.log("  counters:", JSON.stringify(counters));
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}

main();
