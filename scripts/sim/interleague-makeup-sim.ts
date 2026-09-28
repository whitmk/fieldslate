// Harness for the rained-out interleague MAKEUP path (2026-09-28): an admin
// marks an interleague game rained out and reschedules it DIRECTLY by
// proposing a makeup time; the game stays cancelled until the partner accepts.
// There is no "restore then request" step.
//
// WHAT IT PINS, end to end on the host side (the partner's accept/decline are
// SQL and proven by scripts/sim/cancelled-reschedule-rpc-sim.sql):
//   1. every surface OFFERS the makeup on a rained-out interleague game — the
//      Schedule page menu (canRequestReschedule + rescheduleItemVisible), the
//      routers (routeScheduleReschedule / routeMoveTarget for played-out games)
//      — on Free, and on a locked division (rainout recovery is exempt);
//   2. the route ACCEPTS it (decideHostProposal → cancelled_makeup) and writes
//      NO status (statusAfterHostProposal → null);
//   3. a host decline of the partner's counter leaves it cancelled;
//   4. no interleague game reaches either picker;
//   5. (part S) every surface that used to open the picker itself now routes
//      through the shared hook, renders a refusal with MoveNoticeLine, and
//      names itself in the activity log (logSource) — the picker is rendered in
//      exactly three places (the hook, the panel's row icon, the panel's
//      rained-out row), each passing logSource;
//   6. (part L) withLogSource: absent means the message is byte-identical to
//      before — an old entry and a source-less new one read the same.
//
// ANTI-VACUITY: a cancelled interleague game routed + decided + status-checked
// end to end; an ordinary rained-out game still reaching the rainout picker.
//
// ── MUTATION LOG (2026-09-28) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   KM1  statusAfterHostProposal flips a makeup to reschedule_pending → [E2]
//   KM2  gameStatusAfterHostDecline revives a cancelled game          → [E3]
//   KM3  decideHostProposal refuses cancelled (the path is lost)       → [E1]
//   KM4  rescheduleItemVisible hides a rained-out interleague item on
//        Free (a surface omitting the makeup silently)                 → [V1]
//   KM5  the rained-out card stops rendering MoveNoticeLine (a surface
//        refusing silently)                                             → [S1]
//   KM6  the hook's render site drops logSource (a picker save with no
//        surface in the log)                                            → [S3]
//   KM7  log-rainout gates the makeup handoff on canReschedule (an
//        interleague rainout on Free left cancelled with no way forward) → [S2]

import {
  decideHostProposal,
  gameStatusAfterHostDecline,
  statusAfterHostProposal,
} from "@/lib/interleague/negotiation";
import { makeupIntro, routeMoveTarget } from "@/lib/schedule/panel-reschedule-route";
import {
  pickerFor,
  rescheduleItemVisible,
  routeScheduleReschedule,
} from "@/lib/schedule/schedule-page-reschedule-route";
import { respondPageCopy } from "@/lib/interleague/recipient-schedule";
import { withLogSource } from "@/lib/schedule/log-source";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = Date.parse("2026-09-28T12:00:00Z");
const RAINED_OUT_DAY = "2026-09-26T10:00:00+00:00"; // already passed
const MAKEUP = "2026-10-10T10:00:00+00:00";
const org = { name: "Westside LL" };
const ilRainedOut = { status: "cancelled", scheduled_at: RAINED_OUT_DAY, interleague_org_id: "io", away_team_id: null, interleague_org: org, external_team_name: "Rockies" };
const plainRainedOut = { status: "cancelled", scheduled_at: RAINED_OUT_DAY, interleague_org_id: null, away_team_id: "t_cubs", external_team_name: null };
const counters = { makeupEndToEnd: 0, ordinaryRainoutPicker: 0, surfacesChecked: 0 };

const SRC = join(__dirname, "..", "..", "src");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

function partS() {
  // The six surfaces that route through the hook. None may render the picker.
  const surfaces: [string, string][] = [
    ["schedule-list", read("components", "schedule", "schedule-list.tsx")],
    ["schedule-calendar", read("components", "schedule", "schedule-calendar.tsx")],
    ["log-rainout", read("components", "divisions", "log-rainout-modal.tsx")],
    ["rained-out card", read("components", "dashboard", "rained-out-stat-card.tsx")],
    ["conflict card", read("components", "dashboard", "conflict-stat-card.tsx")],
    ["upcoming list", read("components", "dashboard", "upcoming-games-list.tsx")],
  ];
  for (const [name, src] of surfaces) {
    counters.surfacesChecked++;
    ok(
      src.includes("useScheduleReschedule(") && src.includes("<MoveNoticeLine") &&
        /logSource: "/.test(src) && !src.includes("<RainoutRescheduleModal"),
      `[S1] ${name}: routes through the hook, renders refusals with MoveNoticeLine, names itself, never renders the picker`,
    );
  }
  const lr = read("components", "divisions", "log-rainout-modal.tsx");
  ok(
    lr.includes('rescheduleItemVisible("cancelled", canReschedule, markedIsInterleague)') &&
      lr.includes('"Propose makeup time" : "Reschedule now"'),
    "[S2] log-rainout offers the makeup handoff on an interleague rainout regardless of plan",
  );
  // Exactly three picker render sites, each passing logSource.
  const hook = read("components", "schedule", "use-schedule-reschedule.tsx");
  const panel = read("components", "divisions", "division-schedule-panel.tsx");
  const sites = (hook.match(/<RainoutRescheduleModal/g) ?? []).length + (panel.match(/<RainoutRescheduleModal/g) ?? []).length;
  const withSource = (hook.match(/logSource=\{logSource\}/g) ?? []).length + (panel.match(/logSource="division schedule panel"/g) ?? []).length;
  ok(
    sites === 3 && withSource === 3,
    "[S3] the picker is rendered in exactly three places (hook, panel ×2), each naming its surface",
    `sites=${sites} withSource=${withSource}`,
  );
  const manual = read("components", "divisions", "manual-move-form.tsx");
  ok(
    read("components", "divisions", "rainout-reschedule-modal.tsx").includes("logSource={logSource}") &&
      manual.includes("withLogSource(") && manual.includes("(entered manually)"),
    "[S4] the manual form inherits the picker's logSource",
  );
}

function partL() {
  ok(withLogSource("Mets vs Cubs rescheduled to X", undefined) === "Mets vs Cubs rescheduled to X", "[L1] no source → the message is byte-identical (absent means unknown)");
  ok(withLogSource("Mets vs Cubs rescheduled to X", "Schedule page") === "Mets vs Cubs rescheduled to X — via Schedule page", "[L2] with a source → '— via {source}' appended");
  ok(withLogSource("m", "  ") === "m", "[L3] a blank source is treated as absent");
}

function main() {
  console.log("\ninterleague-makeup sim");

  // ── Surfaces offer it ─────────────────────────────────────────────────────
  ok(
    rescheduleItemVisible("cancelled", false, true) && rescheduleItemVisible("cancelled", true, true),
    "[V1] the Schedule page shows the item on a rained-out interleague game, Free or Pro",
  );
  ok(
    !rescheduleItemVisible("cancelled", false, false) && rescheduleItemVisible("scheduled", false, false),
    "[V2] ordinary games unchanged: rained-out hidden on Free, scheduled shown",
  );
  const ctx = (locked: boolean, pro: boolean) => ({ locked, canReschedule: pro, divisionName: "AA", nowMs: NOW });
  const routes = [ctx(false, false), ctx(true, false), ctx(false, true), ctx(true, true)].map((c) =>
    routeScheduleReschedule(ilRainedOut, c),
  );
  ok(
    routes.every((r) => r.kind === "interleague_request" && r.intro === makeupIntro("Westside LL")),
    "[V3] routeScheduleReschedule: rained-out interleague → makeup request on Free, Pro, locked, unlocked",
    JSON.stringify(routes.map((r) => r.kind)),
  );
  ok(
    routeMoveTarget({ ...ilRainedOut, status: "scheduled" }, ctx(false, false)).kind === "interleague_request",
    "[V4] routeMoveTarget: a played-out accepted interleague game → request (no 'already played' refusal)",
  );
  ok(
    makeupIntro("Westside LL").includes("stays rained out until they accept"),
    "[V5] the makeup intro says the game stays rained out until the partner accepts",
  );

  // ── The route accepts and writes no status ────────────────────────────────
  const d = decideHostProposal(ilRainedOut, [], MAKEUP, NOW, "Westside LL");
  ok(d.ok && d.branch === "cancelled_makeup", "[E1] decideHostProposal: rained-out game, future makeup → cancelled_makeup", JSON.stringify(d));
  const after = d.ok ? statusAfterHostProposal(d.branch) : "n/a";
  ok(after === null, "[E2] a makeup proposal leaves the game CANCELLED (no status write)", String(after));
  ok(
    gameStatusAfterHostDecline("cancelled", 0) === null,
    "[E3] the host declining the partner's counter on a makeup leaves it cancelled",
  );
  if (d.ok && after === null && gameStatusAfterHostDecline("cancelled", 0) === null) counters.makeupEndToEnd++;
  ok(
    statusAfterHostProposal("confirmed_reschedule") === "reschedule_pending",
    "[E4] a confirmed game's request still flips it to reschedule_pending (unchanged)",
  );

  // ── Partner-facing copy ───────────────────────────────────────────────────
  const copy = respondPageCopy({ pending: false, rainedOut: true, senderName: "Whit", round: 1 });
  ok(
    copy.currentLabel === "Rained out" && copy.acceptLabel === "Accept makeup" &&
      copy.done.decline.message.includes("stays rained out") && !/original time/.test(JSON.stringify(copy)),
    "[C1] the partner's respond page reads as a makeup; decline never says 'stays at its original time'",
  );
  const confirmed = respondPageCopy({ pending: false, senderName: "Whit", round: 1 });
  ok(
    confirmed.acceptLabel === "Accept change" && confirmed.done.decline.message === "Whit has been notified. The game stays at its original time.",
    "[C2] a confirmed game's respond page is unchanged",
  );

  // ── No interleague game reaches a picker; ordinary rainout still does ─────
  ok(
    pickerFor(routeScheduleReschedule(ilRainedOut, ctx(false, true))) === null &&
      pickerFor(routeScheduleReschedule({ ...ilRainedOut, away_team_id: "t_x" }, ctx(false, true))) === null,
    "[G1] a rained-out interleague game never reaches the rainout picker",
  );
  const plain = pickerFor(routeScheduleReschedule(plainRainedOut, ctx(false, true)));
  ok(plain?.variant === "rainout", "[G2] an ordinary rained-out game still opens the rainout picker");
  if (plain?.variant === "rainout") counters.ordinaryRainoutPicker++;

  partS();
  partL();
  for (const [name, n] of Object.entries(counters)) ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  console.log("  counters:", JSON.stringify(counters));
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}
main();
