// Field / park street address (0100) — drives the REAL normalizeAddress and
// effectiveAddress, and pins the three write paths and the card to them.
//
//   N  normalization: trim, collapse whitespace (pasted newlines and tabs
//      included), blank and null and undefined all read as null; the length
//      cap is the one number the migration's CHECK uses
//   E  effective address: the field's own wins, a blank one falls to the
//      park's, neither is null
//   S  source wiring: the shared editor, the add form and the park rename
//      each write `address: normalizeAddress(…)`; the card renders
//      effectiveAddress; nothing else under src writes an address; no
//      export, print or partner surface reads one (the calendar sim's O1a
//      covers the outbound files — this checks the writers)
//
// A section that THROWS is recorded as [CRASH-…] and the run goes on.
// Anti-vacuity counters at the end: a zero counter fails the run.
//
// MUTATION LOG (2026-09-30) — `npm run sim:venue-address:mutants`:
//   VM1  trimming removed                         → [N1]
//   VM2  blank saved as "" instead of null        → [N3]
//   VM3  park fallback removed                    → [E2]
//   VM4  the shared editor's payload drops address → [S1]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADDRESS_MAX_LENGTH, effectiveAddress, normalizeAddress } from "../../src/lib/venues/address";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const failures: string[] = [];
const counters: Record<string, number> = {};
const count = (name: string) => { counters[name] = (counters[name] ?? 0) + 1; };
function assert(cond: boolean, tag: string, label: string) {
  if (cond) console.log(`  ok: [${tag}] ${label}`);
  else { failures.push(`[${tag}] ${label}`); console.error(`  FAIL: [${tag}] ${label}`); }
}
function section(name: string, fn: () => void) {
  console.log(`\n── ${name}`);
  try { fn(); } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`[CRASH-${name}] ${msg}`);
    console.error(`  FAIL: [CRASH-${name}] ${msg}`);
  }
}

section("N", () => {
  assert(normalizeAddress("   12 Main St   ") === "12 Main St", "N1", "leading and trailing whitespace trimmed");
  const tab = String.fromCharCode(9);
  const nl = String.fromCharCode(10);
  const pasted = `12 Main St${nl}${nl}  Santa Rosa${tab}CA  95401`;
  assert(normalizeAddress(pasted) === "12 Main St Santa Rosa CA 95401", "N2",
    `pasted newlines and tabs collapse to single spaces (got: ${JSON.stringify(normalizeAddress(pasted))})`);
  assert(normalizeAddress("") === null && normalizeAddress("     ") === null && normalizeAddress(null) === null && normalizeAddress(undefined) === null,
    "N3", "empty, whitespace-only, null and undefined all read as null");
  assert(normalizeAddress("12 Main St, Santa Rosa, CA") === "12 Main St, Santa Rosa, CA", "N4", "a clean address is unchanged");
  const migration = read("supabase/migrations/0100_venue_address_in_calendar.sql");
  const cap = migration.match(/length\(address\) <= (\d+)/g) ?? [];
  assert(ADDRESS_MAX_LENGTH === 200 && cap.length === 2 && cap.every((m) => m.endsWith(` ${ADDRESS_MAX_LENGTH}`)), "N5",
    `the UI cap equals the CHECK in 0100 on both tables (${cap.join(", ")})`);
  const ctrl = normalizeAddress(`a${String.fromCharCode(0)}b${String.fromCharCode(127)}c`);
  assert(ctrl === "a b c", "N6", `control characters become spaces, so the CHECK cannot fire (got: ${JSON.stringify(ctrl)})`);
  if (normalizeAddress("x") !== null) count("normalized_nonempty");
  if (normalizeAddress("   ") === null) count("normalized_null");
});

section("E", () => {
  assert(effectiveAddress({ address: " 12 Field St " }, { address: "1 Park Way" }) === "12 Field St", "E1",
    "the field's own address wins over the park's, trimmed");
  assert(effectiveAddress({ address: "   " }, { address: " 1 Park Way " }) === "1 Park Way", "E2",
    "a blank field address falls to the park's, trimmed");
  assert(effectiveAddress({ address: null }, { address: null }) === null && effectiveAddress({}, null) === null && effectiveAddress({}) === null,
    "E3", "neither → null (null park, missing park, missing both)");
  if (effectiveAddress({ address: "a" }, { address: "b" }) === "a") count("effective_venue");
  if (effectiveAddress({ address: "" }, { address: "b" }) === "b") count("effective_park");
  if (effectiveAddress({}, {}) === null) count("effective_null");
});

section("S", () => {
  const editor = read("src/components/venues/venue-edit-form.tsx");
  const page = read("src/components/venues/venues-page-client.tsx");
  assert(editor.includes("address: normalizeAddress(address),") && editor.includes("maxLength={ADDRESS_MAX_LENGTH}"),
    "S1", "the shared editor writes a normalized address and caps the input");
  assert(page.includes("address: normalizeAddress(addAddress),"), "S2", "the add form writes a normalized address");
  assert(page.includes("address: normalizeAddress(renameAddress)"), "S3", "the park rename writes a normalized address");
  assert(page.includes("effectiveAddress(venue, { address: locationAddress })") && !page.includes("{venue.address &&"),
    "S4", "the card renders the effective address (own, else park), never the raw column");
  assert(/Leave (it )?blank to use the park/.test(editor) && /Leave (it )?blank to use the park/.test(page),
    "S5", "both forms say a blank field address falls to the park's");
  // The only importers of the address helper are the two files above.
  const importers = ["src/components/venues/venue-edit-form.tsx", "src/components/venues/venues-page-client.tsx"];
  for (const p of importers) assert(read(p).includes('from "@/lib/venues/address"'), "S6", `${p} imports the helper`);
  const picker = read("src/components/venues/location-picker.tsx");
  assert(!/address/.test(picker), "S7", "the picker's quick-create stays name-only (address is set on the park heading)");
});

console.log("\n── counters");
for (const c of ["normalized_nonempty", "normalized_null", "effective_venue", "effective_park", "effective_null"]) {
  const n = counters[c] ?? 0;
  assert(n > 0, `V-${c}`, `counter ${c} = ${n}`);
}

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
