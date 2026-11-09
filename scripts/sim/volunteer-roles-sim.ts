// Admin: volunteer roles (/dashboard/volunteers) — the screen's rules and
// wiring. Drives the REAL src/lib/volunteers/roles-screen.ts (and through it
// slots.ts) with hand-written expectations, then checks the page, component
// and sidebar are wired to them.
//
//   npm run sim:volunteer-roles            (no clock; three host zones)
//   npm run sim:volunteer-roles:mutants    (mutation pass, real source)
//
// ASSERTIONS (a mutant must die FIRST at its own tag):
//   R1  slotsLabel: "1 per home game" / "2 per our team, per game"
//   R2  divisionsLabel: All / None / the picked names in season order
//   R3  slotCount over a fixture: per_game on home games only (none when the
//       partner hosts), per_team one set per OUR team, none on a pending
//       interleague game, only the picked divisions; createsLine plurals
//   R4  activeByRole counts active claims only
//   R5  previewOutcome: 0 → go; n → confirm with the cancel line; a committed
//       reply, a missing or bad count, or junk → error (never "go")
//   R6  kindLocked: a saved role with sign-ups is locked; unknown counts lock
//   R7  draftProblem: name, spots 1–10, lead 0–120, at least one division
//   R8  roleErrorLine: each refusal key in words; unknown never shown raw
//   W1  wiring: the page 404s without the feature and gates Elite; the
//       sidebar item appears only with the feature; the editor previews
//       (p_commit false) before it commits
//   W2  the editor's "How spots are made" section: the approved words
//       (2026-11-09) verbatim, rendered from words.ts
// ANTI-VACUITY: R3's fixture must produce slots for both kinds and skip at
// least one game for each reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeByRole,
  createsLine,
  divisionsLabel,
  draftProblem,
  kindLocked,
  previewOutcome,
  slotCount,
  slotsLabel,
  type RoleDraft,
} from "@/lib/volunteers/roles-screen";
import type { SlotGame } from "@/lib/volunteers/slots";
import * as W from "@/lib/volunteers/words";
import { roleErrorLine } from "@/lib/volunteers/words";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
let checks = 0;
const failures: string[] = [];
function ok(cond: boolean, tag: string, what: string, detail = "") {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${what}${detail ? ` — ${detail}` : ""}`);
}
const counters = { perGameSlots: 0, perTeamSlots: 0, skippedAway: 0, skippedPending: 0, skippedDivision: 0 };

// R1
ok(slotsLabel("per_game", 1) === "1 per home game", "R1", "per game", slotsLabel("per_game", 1));
ok(slotsLabel("per_team", 2) === "2 per our team, per game", "R1", "per team", slotsLabel("per_team", 2));

// R2
const DIVS = [{ id: "dM", name: "Majors" }, { id: "dA", name: "AAA" }, { id: "dT", name: "Tee Ball" }];
ok(divisionsLabel({ divisionIds: ["dM", "dA", "dT"] }, DIVS) === "All", "R2", "all");
ok(divisionsLabel({ divisionIds: [] }, DIVS) === "None", "R2", "none");
ok(divisionsLabel({ divisionIds: ["dT", "dM"] }, DIVS) === "Majors, Tee Ball", "R2", "season order", divisionsLabel({ divisionIds: ["dT", "dM"] }, DIVS));

// R3 — teams: Expos, Mets (Majors), Owls (AAA), Bees (Tee Ball)
const TD = new Map([["tE", "dM"], ["tM", "dM"], ["tO", "dA"], ["tB", "dT"]]);
const g = (id: string, home: string, away: string | null, extra: Partial<SlotGame> = {}): SlotGame => ({
  id, scheduledAt: "2027-03-06T09:00:00", status: "scheduled", homeTeamId: home, awayTeamId: away,
  interleagueOrgId: null, isAway: false, ...extra,
});
const GAMES: SlotGame[] = [
  g("g1", "tE", "tM"), // Majors v Majors
  g("g2", "tE", null, { interleagueOrgId: "p1", isAway: false }), // we host a partner
  g("g3", "tM", null, { interleagueOrgId: "p1", isAway: true }), // partner hosts
  g("g4", "tO", "tB"), // AAA v Tee Ball
  g("g5", "tE", "tM", { status: "pending_interleague" }),
];
const perGame = slotCount({ kind: "per_game", spots: 2, divisionIds: ["dM"] }, GAMES, TD);
ok(perGame.spots === 4 && perGame.games === 2, "R3", "per_game Majors: g1 + g2, 2 each", JSON.stringify(perGame));
if (perGame.spots > 0) counters.perGameSlots++;
const one = (id: string) => slotCount({ kind: "per_game", spots: 2, divisionIds: ["dM"] }, GAMES.filter((x) => x.id === id), TD).spots;
ok(one("g3") === 0, "R3", "partner hosts → no per-game slots"); if (one("g3") === 0) counters.skippedAway++;
ok(one("g5") === 0, "R3", "pending interleague → no slots"); if (one("g5") === 0) counters.skippedPending++;
ok(one("g4") === 0, "R3", "a division the role doesn't cover → no slots"); if (one("g4") === 0) counters.skippedDivision++;
const perTeam = slotCount({ kind: "per_team", spots: 1, divisionIds: ["dM", "dT"] }, GAMES, TD);
// g1: Expos + Mets = 2; g2: Expos = 1; g3: Mets (ours, partner hosts) = 1; g4: Bees = 1
ok(perTeam.spots === 5 && perTeam.games === 4, "R3", "per_team Majors + Tee Ball", JSON.stringify(perTeam));
if (perTeam.spots > 0) counters.perTeamSlots++;
ok(createsLine({ spots: 96, games: 48 }) === "This creates 96 slots across 48 games.", "R3", "plural line");
ok(createsLine({ spots: 1, games: 1 }) === "This creates 1 slot across 1 game.", "R3", "singular line", createsLine({ spots: 1, games: 1 }));

// R4
const act = activeByRole([
  { role_id: "r1", status: "active" }, { role_id: "r1", status: "active" }, { role_id: "r1", status: "canceled" },
  { role_id: "r2", status: "detached" }, { role_id: null, status: "active" },
]);
ok(act.get("r1") === 2 && !act.has("r2"), "R4", "active only", JSON.stringify([...act]));

// R5
ok(previewOutcome({ committed: false, claims_to_cancel: 0 }).kind === "go", "R5", "nothing to cancel");
const c3 = previewOutcome({ committed: false, claims_to_cancel: 3 });
ok(c3.kind === "confirm" && c3.line.startsWith("This cancels 3 sign-ups."), "R5", "three cancels", JSON.stringify(c3));
const c1 = previewOutcome({ committed: false, claims_to_cancel: 1 });
ok(c1.kind === "confirm" && c1.line.startsWith("This cancels 1 sign-up."), "R5", "one cancel", JSON.stringify(c1));
for (const bad of [{ committed: true, claims_to_cancel: 0 }, { committed: false }, { committed: false, claims_to_cancel: -1 },
                   { committed: false, claims_to_cancel: "2" }, null, "x"]) {
  ok(previewOutcome(bad).kind === "error", "R5", `not a preview → error: ${JSON.stringify(bad)}`);
}

// R6
ok(kindLocked("r1", new Map([["r1", 1]])) === true, "R6", "signed up → locked");
ok(kindLocked("r1", new Map()) === false, "R6", "nobody signed up → open");
ok(kindLocked("r1", null) === true, "R6", "counts unknown → locked");
ok(kindLocked(null, null) === false, "R6", "a new role is never locked");

// R7
const base: RoleDraft = { id: null, name: "Field prep", kind: "per_game", spots: 2, leadMinutes: 45, divisionIds: ["dM"], signupsOpen: true, countsTowardGoal: true };
ok(draftProblem(base) === null, "R7", "a good draft");
for (const [what, p] of [
  ["blank name", { name: "   " }], ["61 characters", { name: "x".repeat(61) }], ["0 spots", { spots: 0 }],
  ["11 spots", { spots: 11 }], ["lead 121", { leadMinutes: 121 }], ["lead -1", { leadMinutes: -1 }], ["no division", { divisionIds: [] }],
] as const) {
  ok(draftProblem({ ...base, ...(p as Partial<RoleDraft>) }) !== null, "R7", `refused: ${what}`);
}
ok(draftProblem({ ...base, spots: 10, leadMinutes: 120 }) === null, "R7", "10 spots, 120 minutes allowed");

// R8
for (const [key, needle] of [
  ["name_taken", "already has a role"], ["name_required", "name"], ["invalid_spots", "1 to 10"], ["invalid_lead", "0 to 120"],
  ["division_not_in_season", "isn't in this season"], ["kind_locked", "signed up"], ["role_not_found", "deleted"],
] as const) {
  ok(roleErrorLine(`P0001: ${key}`).includes(needle), "R8", key, roleErrorLine(key));
}
ok(!roleErrorLine('new row for relation "volunteer_roles" violates').includes("volunteer_roles"), "R8", "unknown never raw");

// W1
const page = read("src/app/(dashboard)/dashboard/volunteers/page.tsx");
ok(/if \(!feature\) notFound\(\);/.test(page) && /if \(!feature\.elite\) return <FeatureLockedCard/.test(page), "W1", "page: 404 without the feature, Elite gate");
ok(page.includes("activeByRole("), "W1", "page counts Filled through activeByRole");
const side = read("src/components/dashboard/sidebar.tsx");
ok(/if \(!volunteers\) return navItems;/.test(side) && side.includes("itemsFor(volunteers).map("), "W1", "sidebar item only with the feature");
const layout = read("src/app/(dashboard)/layout.tsx");
ok(layout.includes("volunteers={volunteerFeature !== null}"), "W1", "layout passes the switch to the sidebar");
const comp = read("src/components/volunteers/roles-screen.tsx");
ok(/const r = await call\(fn, false\);[\s\S]*previewOutcome\(r\.data\)/.test(comp) && /const r = await call\(fn, true\);[\s\S]*commitOk\(r\.data\)/.test(comp),
  "W1", "the editor previews before it commits, and checks the commit");

// W2
ok(W.FIELD_KIND === "How spots are made", "W2", "heading", W.FIELD_KIND);
ok(W.KIND_PER_GAME === "One per game." &&
  W.KIND_PER_GAME_DETAIL === "Only one needed per game, like field prep, scoreboard or announcer.", "W2", "one per game", W.KIND_PER_GAME_DETAIL);
ok(W.KIND_PER_TEAM === "One per team." &&
  W.KIND_PER_TEAM_DETAIL === "Each team needs its own, like GameChanger. Two of our league's teams playing each other get two. Against another league's team, just one.",
  "W2", "one per team", W.KIND_PER_TEAM_DETAIL);
ok(roleErrorLine("P0001: invalid_kind") === "Choose how spots are made.", "W2", "kind refusal");
ok(comp.includes("{W.FIELD_KIND}") && comp.includes("W.KIND_PER_GAME_DETAIL") && comp.includes("W.KIND_PER_TEAM_DETAIL") && !/Slots are created/.test(comp),
  "W2", "the editor renders the section from words.ts");

for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${failures.length} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`sim:volunteer-roles — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);
