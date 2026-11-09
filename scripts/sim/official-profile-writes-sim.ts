// Harness for "official availability windows and blackout dates save, or say
// why they didn't" (2026-11-09, fix/official-availability-save).
//
// THE BUG. The edit-official modal rendered AvailabilitySection and
// BlackoutsSection — each with its own <form> — INSIDE the modal's <form>.
// With nested forms the bundled React ran neither onSubmit; the browser did a
// native submit that reloaded the page: no insert sent, no error shown. From
// 794577e (2026-07-14) the edit modal never saved a window or a blackout date
// (all 6 windows and 2 blackouts in production came from the ADD modal). The
// add modal had its own silent drop: its window and date fields are a draft
// until "Add" is clicked, and a draft never added vanished on save.
//
// ASSERTIONS
//   N1  official-profile-sections.tsx renders NO <form> (comments stripped) —
//       its sections are reused inside the edit modal's <form>
//   N2  its Save button is type="button" with an explicit onClick
//   W1  addAvailabilityWindows sends ONE insert to official_availability with
//       the given umpire id and the draft's day/start/end, asking for ids back
//   W2  an insert error comes back as ok:false with its message
//   W3  a reply without the rows sent (none, null) is "Nothing was saved"
//   W4  a reply with fewer rows than sent is "Nothing was saved"
//   W5  an invalid draft (end before start, half-typed time) is refused and
//       NO insert is sent
//   W6  no drafts → ok, no insert
//   B1  addBlackouts maps date and note (trimmed; blank → null), umpire id
//   B2  a unique-violation reply is worded by the caller's duplicate line
//   B3  a reply without rows is "Nothing was saved"
//   C1  addConflict maps team, relationship and note (trimmed; blank → null)
//   C2  an empty team or an unknown relationship is refused, NO insert sent
//   C3  a unique-violation reply is worded by the caller's duplicate line; any
//       other error is shown as is
//   C4  a reply without the row is "Nothing was saved"
//   R1  addCertification maps the trimmed name and dates (blank → null)
//   R2  an empty name or a half-typed date is refused, NO insert sent
//   R3  an insert error is shown
//   R4  a reply without the row is "Nothing was saved"
//   D1  unaddedDraftLine: a touched window or a picked date refuses; neither
//       passes
//   S1  SOURCE (weak by nature): the sections and the add modal save through
//       profile-writes.ts; no umpires component inserts into any of the four
//       tables directly
//   S2  SOURCE (weak by nature): the add modal checks unaddedDraftLine BEFORE
//       it inserts the official
// ANTI-VACUITY: an insert sent, an error surfaced, a short reply refused, an
// invalid draft refused unsent, a draft refusal.
//
// ── MUTATION LOG ────────────────────────────────────────────────────────────
// Criterion: killed only if the assertion written for it fails FIRST
// (npm run sim:official-profile-writes:mutants).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  addAvailabilityWindows,
  addBlackouts,
  addCertification,
  addConflict,
  CERT_DATE_INVALID,
  CERT_NAME_REQUIRED,
  RELATIONSHIP_REQUIRED,
  TEAM_REQUIRED,
  END_AFTER_START,
  NOTHING_SAVED,
  TIMES_REQUIRED,
  UNADDED_BLACKOUT,
  UNADDED_WINDOW,
  unaddedDraftLine,
  type WriteOutcome,
} from "@/lib/umpires/profile-writes";

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
const counters = { insertSent: 0, errorSurfaced: 0, shortReplyRefused: 0, invalidUnsent: 0, draftRefused: 0 };

// A recording client: one reply per insert, every call kept.
type Reply = { data: unknown; error: { code?: string; message: string } | null };
function stub(reply: Reply | ((rows: Record<string, unknown>[]) => Reply)) {
  const calls: { table: string; rows: Record<string, unknown>[]; select: string | null }[] = [];
  const client = {
    from(table: string) {
      return {
        insert(rows: Record<string, unknown>[]) {
          const call = { table, rows, select: null as string | null };
          calls.push(call);
          return {
            select(cols: string) {
              call.select = cols;
              return Promise.resolve(typeof reply === "function" ? reply(rows) : reply);
            },
          };
        },
      };
    },
  };
  return { client: client as never, calls };
}
const echo = (rows: Record<string, unknown>[]): Reply => ({ data: rows.map((_, i) => ({ id: `id-${i}` })), error: null });
const isFail = (o: WriteOutcome, msg: string) => !o.ok && o.message === msg;
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

async function main() {
  // ── N: the sections can live inside a host form ──────────────────────────
  {
    const src = strip(read("src/components/umpires/official-profile-sections.tsx"));
    ok(!/<form[\s>]/.test(src), "[N1]", "official-profile-sections.tsx renders a <form>");
    ok(/type="button"\s+onClick=\{onSave\}/.test(src) && !/type="submit"/.test(src), "[N2]",
      "the sections' Save must be type=\"button\" with onClick={onSave}");
  }

  // ── W: availability windows ──────────────────────────────────────────────
  {
    const { client, calls } = stub(echo);
    const o = await addAvailabilityWindows(client, "ump-bob", [{ day: "Sa", start: "09:00", end: "12:00" }]);
    ok(o.ok && calls.length === 1 && calls[0].table === "official_availability" &&
       calls[0].select === "id" &&
       JSON.stringify(calls[0].rows) === JSON.stringify([{ umpire_id: "ump-bob", day_of_week: "Sa", start_time: "09:00", end_time: "12:00" }]),
      "[W1]", JSON.stringify({ o, calls }));
    if (calls.length === 1) counters.insertSent++;
  }
  {
    const { client } = stub({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    const o = await addAvailabilityWindows(client, "ump-bob", [{ day: "Mo", start: "17:00", end: "20:00" }]);
    ok(isFail(o, "new row violates row-level security policy"), "[W2]", JSON.stringify(o));
    if (!o.ok) counters.errorSurfaced++;
  }
  for (const data of [[], null]) {
    const { client } = stub({ data, error: null });
    const o = await addAvailabilityWindows(client, "ump-bob", [{ day: "Mo", start: "17:00", end: "20:00" }]);
    ok(isFail(o, NOTHING_SAVED), "[W3]", `reply ${JSON.stringify(data)} → ${JSON.stringify(o)}`);
    if (isFail(o, NOTHING_SAVED)) counters.shortReplyRefused++;
  }
  {
    const { client } = stub({ data: [{ id: "only-one" }], error: null });
    const o = await addAvailabilityWindows(client, "ump-bob", [
      { day: "Mo", start: "17:00", end: "20:00" },
      { day: "We", start: "17:00", end: "20:00" },
    ]);
    ok(isFail(o, NOTHING_SAVED), "[W4]", JSON.stringify(o));
  }
  for (const [draft, msg] of [
    [{ day: "Mo", start: "20:00", end: "17:00" }, END_AFTER_START],
    [{ day: "Mo", start: "", end: "20:00" }, TIMES_REQUIRED],
    [{ day: "Mo", start: "17:0", end: "20:00" }, TIMES_REQUIRED],
  ] as const) {
    const { client, calls } = stub(echo);
    const o = await addAvailabilityWindows(client, "ump-bob", [draft]);
    ok(isFail(o, msg) && calls.length === 0, "[W5]", `${JSON.stringify(draft)} → ${JSON.stringify(o)}, ${calls.length} insert(s)`);
    if (calls.length === 0 && !o.ok) counters.invalidUnsent++;
  }
  {
    const { client, calls } = stub(echo);
    const o = await addAvailabilityWindows(client, "ump-bob", []);
    ok(o.ok && calls.length === 0, "[W6]", JSON.stringify({ o, calls }));
  }

  // ── B: blackout dates ────────────────────────────────────────────────────
  {
    const { client, calls } = stub(echo);
    const o = await addBlackouts(client, "ump-bob", [
      { date: "2026-11-14", note: "  Away  " },
      { date: "2026-11-21", note: "   " },
    ], (d) => `dup ${d}`);
    ok(o.ok && calls.length === 1 && calls[0].table === "official_blackouts" && calls[0].select === "id" &&
       JSON.stringify(calls[0].rows) === JSON.stringify([
         { umpire_id: "ump-bob", date: "2026-11-14", note: "Away" },
         { umpire_id: "ump-bob", date: "2026-11-21", note: null },
       ]), "[B1]", JSON.stringify({ o, calls }));
  }
  {
    const { client } = stub({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const o = await addBlackouts(client, "ump-bob", [{ date: "2026-11-14", note: "" }], (d) => `dup ${d}`);
    ok(isFail(o, "dup 2026-11-14"), "[B2]", JSON.stringify(o));
  }
  {
    const { client } = stub({ data: [], error: null });
    const o = await addBlackouts(client, "ump-bob", [{ date: "2026-11-14", note: "" }], (d) => `dup ${d}`);
    ok(isFail(o, NOTHING_SAVED), "[B3]", JSON.stringify(o));
  }

  // ── C: conflicts of interest ────────────────────────────────────────────
  {
    const { client, calls } = stub(echo);
    const o = await addConflict(client, "ump-bob", { teamId: "team-1", relationship: "sibling", note: "  Brother  " }, () => "dup");
    ok(o.ok && calls.length === 1 && calls[0].table === "official_conflicts" && calls[0].select === "id" &&
       JSON.stringify(calls[0].rows) === JSON.stringify([{ umpire_id: "ump-bob", team_id: "team-1", relationship: "sibling", note: "Brother" }]),
      "[C1]", JSON.stringify({ o, calls }));
    const blank = await addConflict(stub(echo).client, "ump-bob", { teamId: "team-1", relationship: "other", note: "   " }, () => "dup");
    ok(blank.ok, "[C1]", `blank note must save: ${JSON.stringify(blank)}`);
  }
  for (const [draft, msg] of [
    [{ teamId: "", relationship: "parent", note: "" }, TEAM_REQUIRED],
    [{ teamId: "team-1", relationship: "cousin", note: "" }, RELATIONSHIP_REQUIRED],
  ] as const) {
    const { client, calls } = stub(echo);
    const o = await addConflict(client, "ump-bob", draft, () => "dup");
    ok(isFail(o, msg) && calls.length === 0, "[C2]", `${JSON.stringify(draft)} → ${JSON.stringify(o)}, ${calls.length} insert(s)`);
    if (calls.length === 0 && !o.ok) counters.invalidUnsent++;
  }
  {
    const dup = await addConflict(stub({ data: null, error: { code: "23505", message: "duplicate key" } }).client,
      "ump-bob", { teamId: "team-1", relationship: "parent", note: "" }, () => "already listed for Cubs");
    const other = await addConflict(stub({ data: null, error: { code: "42501", message: "permission denied" } }).client,
      "ump-bob", { teamId: "team-1", relationship: "parent", note: "" }, () => "already listed for Cubs");
    ok(isFail(dup, "already listed for Cubs") && isFail(other, "permission denied"), "[C3]", JSON.stringify({ dup, other }));
  }
  {
    const o = await addConflict(stub({ data: [], error: null }).client, "ump-bob", { teamId: "team-1", relationship: "parent", note: "" }, () => "dup");
    ok(isFail(o, NOTHING_SAVED), "[C4]", JSON.stringify(o));
  }

  // ── R: certifications ────────────────────────────────────────────────────
  {
    const { client, calls } = stub(echo);
    const o = await addCertification(client, "ump-bob", { name: "  LL Level 1  ", issued: "2026-03-01", expiry: "" });
    ok(o.ok && calls.length === 1 && calls[0].table === "official_certifications" && calls[0].select === "id" &&
       JSON.stringify(calls[0].rows) === JSON.stringify([{ umpire_id: "ump-bob", name: "LL Level 1", issued_date: "2026-03-01", expiry_date: null }]),
      "[R1]", JSON.stringify({ o, calls }));
  }
  for (const [draft, msg] of [
    [{ name: "   ", issued: "", expiry: "" }, CERT_NAME_REQUIRED],
    [{ name: "Level 1", issued: "2026-3-1", expiry: "" }, CERT_DATE_INVALID],
    [{ name: "Level 1", issued: "", expiry: "2027-02" }, CERT_DATE_INVALID],
  ] as const) {
    const { client, calls } = stub(echo);
    const o = await addCertification(client, "ump-bob", draft);
    ok(isFail(o, msg) && calls.length === 0, "[R2]", `${JSON.stringify(draft)} → ${JSON.stringify(o)}, ${calls.length} insert(s)`);
  }
  {
    const o = await addCertification(stub({ data: null, error: { message: "permission denied" } }).client, "ump-bob", { name: "Level 1", issued: "", expiry: "" });
    ok(isFail(o, "permission denied"), "[R3]", JSON.stringify(o));
  }
  {
    const o = await addCertification(stub({ data: null, error: null }).client, "ump-bob", { name: "Level 1", issued: "", expiry: "" });
    ok(isFail(o, NOTHING_SAVED), "[R4]", JSON.stringify(o));
  }

  // ── D: the add modal's unadded draft ─────────────────────────────────────
  {
    const a = unaddedDraftLine({ windowDraftTouched: true, blackoutDraftDate: "" });
    const b = unaddedDraftLine({ windowDraftTouched: false, blackoutDraftDate: "2026-11-14" });
    const c = unaddedDraftLine({ windowDraftTouched: false, blackoutDraftDate: "" });
    ok(a === UNADDED_WINDOW && b === UNADDED_BLACKOUT && c === null, "[D1]", JSON.stringify({ a, b, c }));
    if (a && b) counters.draftRefused++;
  }

  // ── S: wiring (source checks, weak by nature) ────────────────────────────
  {
    const sections = strip(read("src/components/umpires/official-profile-sections.tsx"));
    const modal = strip(read("src/components/umpires/add-umpire-button.tsx"));
    const direct = readdirSync(join(ROOT, "src/components/umpires"))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /from\("official_(availability|blackouts|conflicts|certifications)"\)\s*\.insert/.test(strip(read(`src/components/umpires/${f}`))));
    ok(sections.includes("addAvailabilityWindows(") && sections.includes("addBlackouts(") &&
       sections.includes("addConflict(") && sections.includes("addCertification(") &&
       modal.includes("addAvailabilityWindows(") && modal.includes("addBlackouts(") && direct.length === 0,
      "[S1]", `direct inserts in: ${direct.join(", ")}`);
    const check = modal.indexOf("if (unadded)");
    const insert = modal.indexOf('.from("umpires")');
    ok(check > 0 && insert > 0 && check < insert, "[S2]", "the add modal must refuse an unadded draft before inserting the official");
  }

  for (const [k, v] of Object.entries(counters)) ok(v > 0, `[V-${k}] counter ${k} must be non-zero`, String(v));
  console.log(`${checks - fails}/${checks} checks passed`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.log(`  FAIL: [CRASH] ${(e as Error).stack ?? e}`);
  process.exit(1);
});
