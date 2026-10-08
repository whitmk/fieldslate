// Mutation pass for panel-reschedule-sim.ts — see mutant-runner.ts.
// The 15 mutants in the sim's MUTATION LOG (2026-09-25), which were applied by
// hand then; made repeatable 2026-10-08 when the request-modal golden was
// re-recorded for 5f114a2.
import { runMutants, type Mutant } from "./mutant-runner";

const HEADER = "src/components/divisions/reschedule-modal-header.tsx";
const REQUEST = "src/components/interleague/reschedule-request-modal.tsx";
const ROUTE = "src/lib/schedule/panel-reschedule-route.ts";
const VARIANT = "src/lib/schedule/reschedule-variant.ts";
const ROW = "src/components/divisions/move-game-row.tsx";
const PANEL = "src/components/divisions/division-schedule-panel.tsx";

const MUTANTS: Mutant[] = [
  {
    id: "HM1", what: "default variant flipped to move", file: HEADER,
    find: 'variant = "rainout",', replace: 'variant = "move",', expect: "H1",
  },
  {
    id: "HM2", what: "move still renders the rain cloud", file: HEADER,
    find: '? <CalendarClock className="h-4 w-4 text-[#22C55E]" />',
    replace: '? <CloudRain className="h-4 w-4 text-blue-400" />', expect: "H3",
  },
  {
    id: "PM1", what: "intro rendered even when absent (empty box)", file: REQUEST,
    find: "{intro && (", replace: "{(intro || true) && (", expect: "M1",
  },
  {
    id: "RM1", what: "interleague branch skipped", file: ROUTE,
    find: "  if (game.interleague_org_id) {", replace: "  if (false && game.interleague_org_id) {", expect: "R2",
  },
  {
    id: "RM2", what: "lock gate skipped on the plain path", file: ROUTE,
    find: '  if (ctx.locked) {\n    return {\n      kind: "blocked",\n      reason: "locked",\n      message: lockedReason(ctx.divisionName, "move")',
    replace: '  if (false && ctx.locked) {\n    return {\n      kind: "blocked",\n      reason: "locked",\n      message: lockedReason(ctx.divisionName, "move")',
    expect: "R7",
  },
  {
    id: "RM3", what: "ordinary status check dropped (completed moves)", file: ROUTE,
    find: '\n  if (game.status !== "scheduled") {', replace: "\n  if (false) {", expect: "R10",
  },
  {
    id: "RM4", what: "plain returns before the plan check (Free moves)", file: ROUTE,
    find: '  if (!ctx.canReschedule) return { kind: "upgrade" };', replace: '  if (false) return { kind: "upgrade" };', expect: "R8",
  },
  {
    id: "RM5", what: "reschedule_pending branch removed", file: ROUTE,
    find: '    if (game.status === "reschedule_pending") {', replace: "    if (false) {", expect: "R5",
  },
  {
    id: "VM1", what: "availabilityForVariant never strips", file: VARIANT,
    find: 'return variant === "move" ? stripMakeup(av) : av;', replace: "return av;", expect: "V2",
  },
  {
    id: "VM2", what: "availabilityForVariant always strips", file: VARIANT,
    find: 'return variant === "move" ? stripMakeup(av) : av;', replace: "return stripMakeup(av);", expect: "V1",
  },
  {
    id: "VM3", what: "noFieldCopy's move branch removed", file: VARIANT,
    find: '  if (p.variant === "move") {', replace: "  if (false) {", expect: "V3",
  },
  {
    id: "WM1", what: "MoveNoticeLine drops the message", file: ROW,
    find: "        {message}\n        {link && (", replace: "        {link && (", expect: "W3",
  },
  {
    id: "WM2", what: "MoveNoticeLine drops the link", file: ROW,
    find: "        {link && (", replace: "        {false && link && (", expect: "W4",
  },
  {
    id: "WM3", what: "MoveGameIcon never disabled (lock ignored)", file: ROW,
    find: "disabled={locked}", replace: "disabled={false}", expect: "W1",
  },
  {
    id: "WM4", what: "panel stops rendering MoveNoticeLine for a refusal", file: PANEL,
    find: "{rowNotice?.gameId === game.id && !selectMode && (\n                      <MoveNoticeLine",
    replace: "{false && (\n                      <MoveNoticeLine",
    expect: "S7",
  },
];

runMutants({ sim: "scripts/sim/panel-reschedule-sim.ts", timezones: ["UTC"], mutants: MUTANTS });
