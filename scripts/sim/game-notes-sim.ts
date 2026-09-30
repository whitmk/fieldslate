// Harness for game notes (src/lib/schedule/game-notes.ts, the three render
// pieces in src/components/schedule/game-note.tsx, and the OMISSION proof).
//
// THE OMISSION PROOF, three ways (decided 2026-09-28 — the third matters most):
//   O1  SOURCE SCAN — neither print region, neither CSV builder, no email
//       builder or partner-facing page references `notes`.
//   O2  (SQL side, scripts/sim/game-notes-triggers-sim.sql K1/K2) — no token
//       RPC's prosrc mentions notes, and a note planted on an accepted
//       interleague game does not come back through the schedule token.
//   O3  THE SELECTS CARRY IT, THE PRINT FILES DON'T — the Schedule page's and
//       the panel's games selects include NOTE_SELECT_FIELDS (so the row line
//       can render), which means the very object the print regions render
//       from now carries a note. The print files must never reference it.
// Plus: every surface that shows a game renders the shared pieces; the pure
// helpers (hasNote, noteDraft, noteLineText, noteAttribution, noteLogEntry);
// the real components rendered with and without a note.
//
// ANTI-VACUITY: a game WITH a note and one WITHOUT each rendered through the
// icon, the line and the dot; every surface file checked.
//
// ── MUTATION LOG (2026-09-28) ──────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails first.
//   GM1  SchedulePrintRegion renders `{g.notes}`               → [O1]
//   GM2  the Sports Connect builder's select adds `notes`      → [O1b]
//   GM3  noteDraft accepts 501 characters                      → [D2]
//   GM4  hasNote is true for whitespace                        → [H1]
//   GM5  GameNoteLine drops the full-text title                → [R2]
//   GM6  the Schedule page's select drops NOTE_SELECT_FIELDS   → [O3]
//   GM7  the empty icon goes back to hover-revealed              → [R1b]
// RESULT (GM7, 2026-09-28): killed at [R1b] alone.
// RESULT: 6/6 killed, each FIRST (and only) at its own assertion. GM1 is the
// one the design exists for: the print region rendering `{g.notes}` from the
// object it already receives.

import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NOTE_MAX_CHARS,
  NOTE_SELECT_FIELDS,
  hasNote,
  noteAttribution,
  noteDraft,
  noteLineText,
  noteLogEntry,
} from "@/lib/schedule/game-notes";

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
const SRC = join(__dirname, "..", "..", "src");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const mentionsNotes = (s: string) => /\bnotes\b/.test(s);
// 0100: a field's street address is emitted by the calendar feed ONLY. The
// same outbound surfaces that must never carry a note must never carry it.
const mentionsAddress = (s: string) => /\baddress\b/i.test(s);
const counters = { withNoteRendered: 0, withoutNoteRendered: 0, surfacesChecked: 0, omissionFilesChecked: 0 };

function partH() {
  ok(hasNote({ notes: "Lights out" }) && !hasNote({ notes: "   " }) && !hasNote({ notes: null }) && !hasNote({}), "[H1] hasNote: text yes; whitespace, null, absent no");
  ok(noteLineText({ notes: "line one\n\nline two " }) === "line one · line two", "[H2] the row line collapses newlines to one line", noteLineText({ notes: "line one\n\nline two " }));
  const d = noteDraft("  hello  ");
  ok(d.ok && d.value === "hello" && d.remaining === NOTE_MAX_CHARS - 5, "[D1] a draft is trimmed and counted");
  const empty = noteDraft("   ");
  ok(empty.ok && empty.value === null, "[D1b] an empty draft saves NULL (same as Remove)");
  const long = noteDraft("x".repeat(501));
  ok(!long.ok && long.reason === "too_long", "[D2] 501 characters is refused");
  ok(noteDraft("x".repeat(500)).ok, "[D2b] 500 characters is accepted");
  const at = noteAttribution({ notes: "n", notes_updated_at: "2026-09-28T17:00:00Z", notes_editor: { full_name: "Whit" } }, new Date("2026-09-28T18:00:00Z"));
  ok(at === "Last edited by Whit, Sep 28", "[A1] attribution names the editor and the date", String(at));
  const noName = noteAttribution({ notes: "n", notes_updated_at: "2025-03-01T17:00:00Z", notes_editor: null }, new Date("2026-09-28T18:00:00Z"));
  ok(noName === "Last edited Mar 1, 2025", "[A2] a missing editor still yields the date (with the year when it differs)", String(noName));
  ok(noteAttribution({ notes: "n" }) === null, "[A3] nothing known → null");
  const e1 = noteLogEntry({ matchup: "Mets vs Cubs", dateLabel: "Sat, Oct 10", before: null, after: "Lights out" });
  const e2 = noteLogEntry({ matchup: "Mets vs Cubs", dateLabel: "Sat, Oct 10", before: "a", after: "b" });
  const e3 = noteLogEntry({ matchup: "Mets vs Cubs", dateLabel: "Sat, Oct 10", before: "a", after: null });
  const e4 = noteLogEntry({ matchup: "Mets vs Cubs", dateLabel: "Sat, Oct 10", before: "a", after: "a" });
  ok(
    e1?.eventType === "game_note_updated" && e1.message === "Note added to Mets vs Cubs on Sat, Oct 10" &&
      e2?.eventType === "game_note_updated" && e2.message.startsWith("Note updated on") &&
      e3?.eventType === "game_note_removed" && e4 === null,
    "[L1] the log records the event (added / updated / removed), never the text",
  );
  ok(
    [e1, e2, e3].every((e) => e && !e.message.includes("Lights out") && !e.message.includes(" a ") && !e.message.endsWith(" b")),
    "[L2] no note text reaches the log message",
  );
}

async function partR() {
  const { GameNoteIcon, GameNoteLine, GameNoteDot } = await import("@/components/schedule/game-note");
  const withNote = { notes: "Lights out on field 2 <after 7>" };
  const without = { notes: null };
  const r = (C: React.ComponentType<never>, props: object) =>
    renderToStaticMarkup(React.createElement(C as React.ComponentType<object>, props));
  const iconOn = r(GameNoteIcon, { game: withNote, onClick: () => {} });
  const iconOff = r(GameNoteIcon, { game: without, onClick: () => {} });
  counters.withNoteRendered++; counters.withoutNoteRendered++;
  ok(
    iconOn.includes('data-note="present"') && iconOn.includes("text-violet-600") && iconOn.includes('fill="currentColor"'),
    "[R1] icon with a note: filled, violet, always visible",
  );
  ok(
    iconOff.includes('data-note="empty"') && !iconOff.includes("opacity-0") && iconOff.includes("text-gray-300") &&
      iconOff.includes('fill="none"') && iconOff.includes("Add a note"),
    "[R1b] icon without a note: faint outline, ALWAYS visible (never hover-revealed)",
  );
  const lineOn = r(GameNoteLine, { game: withNote, onClick: () => {} });
  const lineOff = r(GameNoteLine, { game: without, onClick: () => {} });
  counters.withNoteRendered++; counters.withoutNoteRendered++;
  ok(
    lineOn.includes('title="Lights out on field 2 &lt;after 7&gt;"') && lineOn.includes("truncate") && lineOn.includes("data-note-line"),
    "[R2] the line carries the FULL text as its title (hover) and truncates on screen",
    lineOn,
  );
  ok(lineOff === "", "[R2b] no note → no line at all (absence means no note)");
  const dotOn = r(GameNoteDot, { game: withNote });
  const dotOff = r(GameNoteDot, { game: without });
  counters.withNoteRendered++; counters.withoutNoteRendered++;
  ok(dotOn.includes("data-note-dot") && dotOn.includes("bg-violet-500") && dotOn.includes("title="), "[R3] the dot: violet, full text on hover");
  ok(dotOff === "", "[R3b] no note → no dot");
}

function partO() {
  // O1 — nothing outbound references notes.
  const outbound: [string, string[]][] = [
    ["schedule print region", ["components", "schedule", "schedule-print-region.tsx"]],
    ["Sports Connect builder", ["lib", "schedule", "sports-connect-export.ts"]],
    ["generic CSV export", ["components", "divisions", "export-picker-modal.tsx"]],
    ["generic CSV builder", ["lib", "schedule", "generic-games-export.ts"]],
    ["shared export selection", ["lib", "schedule", "export-games.ts"]],
    ["partner schedule page", ["app", "schedule", "[token]", "page.tsx"]],
    ["partner respond page", ["app", "reschedule", "[token]", "page.tsx"]],
    ["partner respond form", ["components", "interleague", "reschedule-form.tsx"]],
    ["invite form", ["components", "interleague", "invite-form.tsx"]],
    ["recipient-schedule wording", ["lib", "interleague", "recipient-schedule.ts"]],
    ["negotiation emails", ["lib", "interleague", "negotiation-emails.ts"]],
    ["umpire print-all page", ["app", "(dashboard)", "dashboard", "umpires", "print-all", "page.tsx"]],
  ];
  for (const [name, p] of outbound) {
    counters.omissionFilesChecked++;
    ok(!mentionsNotes(read(...p)), `[O1] ${name} never references notes`);
    ok(!mentionsAddress(read(...p)), `[O1a] ${name} never references a field address`);
  }
  // The panel's own print region: the print block inside the panel must not.
  const panel = read("components", "divisions", "division-schedule-panel.tsx");
  const printStart = panel.indexOf('className="fieldslate-print-region hidden"');
  const printEnd = panel.indexOf("{/* ── Bulk rainout confirmation modal", printStart);
  ok(printStart > 0 && printEnd > printStart && !mentionsNotes(panel.slice(printStart, printEnd)), "[O1b] the division panel's print region never references notes");
  ok(printStart > 0 && !mentionsAddress(panel.slice(printStart, printEnd)), "[O1c] the division panel's print region never references a field address");
  // O3 — the selects that feed those very surfaces DO carry notes.
  const page = read("app", "(dashboard)", "dashboard", "schedule", "page.tsx");
  ok(page.includes(NOTE_SELECT_FIELDS), "[O3] the Schedule page's shared games select carries NOTE_SELECT_FIELDS");
  ok(panel.includes(NOTE_SELECT_FIELDS), "[O3b] the division panel's games select carries NOTE_SELECT_FIELDS");
  ok(
    read("app", "(dashboard)", "dashboard", "page.tsx").includes(NOTE_SELECT_FIELDS) &&
      read("app", "(dashboard)", "dashboard", "leagues", "[id]", "page.tsx").includes(NOTE_SELECT_FIELDS),
    "[O3c] the dashboard and league page selects carry NOTE_SELECT_FIELDS",
  );
}

function partS() {
  const surfaces: [string, string[], string[]][] = [
    ["schedule list", ["components", "schedule", "schedule-list.tsx"], ["<GameNoteIcon", "<GameNoteLine", "useGameNoteEditor("]],
    ["schedule calendar", ["components", "schedule", "schedule-calendar.tsx"], ["<GameNoteDot", "<GameNoteIcon", "<GameNoteLine", "useGameNoteEditor("]],
    ["week grid", ["components", "schedule", "schedule-week-grid.tsx"], ["<GameNoteDot"]],
    ["division panel", ["components", "divisions", "division-schedule-panel.tsx"], ["<GameNoteIcon", "<GameNoteLine", "useGameNoteEditor("]],
    ["upcoming list", ["components", "dashboard", "upcoming-games-list.tsx"], ["<GameNoteIcon", "<GameNoteLine", "useGameNoteEditor("]],
    ["rained-out card", ["components", "dashboard", "rained-out-stat-card.tsx"], ["<GameNoteIcon", "<GameNoteLine", "useGameNoteEditor("]],
    ["conflict card", ["components", "dashboard", "conflict-stat-card.tsx"], ["<GameNoteIcon", "<GameNoteLine", "useGameNoteEditor("]],
    ["game detail modal", ["components", "umpires", "game-detail-modal.tsx"], ["noteAttribution(", "data-note-line"]],
  ];
  for (const [name, p, needles] of surfaces) {
    counters.surfacesChecked++;
    const src = read(...p);
    ok(needles.every((n) => src.includes(n)), `[S1] ${name} renders the shared note pieces`, needles.filter((n) => !src.includes(n)).join(","));
  }
  ok(
    !read("components", "divisions", "log-rainout-modal.tsx").includes("GameNote") &&
      !read("components", "schedule", "add-game-modal.tsx").includes("GameNote"),
    "[S2] no note in the log-rainout picker or the add-game modal (decided)",
  );
  const editor = read("components", "schedule", "use-game-note-editor.tsx");
  ok(
    editor.includes("NOTE_PRIVACY_LINE") && editor.includes("Remove note") && editor.includes("maxLength={NOTE_MAX_CHARS}") &&
      editor.includes(".update({ notes: value } as never)") && editor.includes(".select(NOTE_SELECT_FIELDS)"),
    "[S3] the editor: privacy line, Remove note, the 500 count, a note-only write that reads the fresh row back",
  );
}

async function main() {
  console.log("\ngame-notes sim");
  partH();
  await partR();
  partO();
  partS();
  for (const [name, n] of Object.entries(counters)) ok(n > 0, `[AV] counter ${name} fired`, `got ${n}`);
  console.log("  counters:", JSON.stringify(counters));
  console.log(`\n${checks - fails}/${checks} checks passed`);
  if (fails > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
