// Mutation pass for official-signup-page-sim.ts (2026-11-09). Each mutant is
// applied to the REAL source, the sim runs under three zones, the source is
// restored and verified byte-for-byte, and the mutant counts as killed only
// if the FIRST failing assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const PAGE = "src/lib/officials-signup/page.ts";
const MAIL = "src/lib/officials-signup/email-templates.ts";
const RUNNER = "src/lib/officials-signup/drain-runner.ts";
const CRON = "src/lib/outbound-email/cron-auth.ts";
const ROUTE = "src/app/api/officials/signup/[token]/route.ts";
const COPY = "src/lib/officials-signup/link-copy.ts";
const SECTION = "src/components/umpires/official-signup-section.tsx";

const MUTANTS: Mutant[] = [
  { id: "SP1", what: "a malformed game on the list is skipped, not an error", file: PAGE,
    find: "    if (!g || !gu) return { kind: \"error\" };", replace: "    if (!g || !gu) continue;", expect: "P1" },
  { id: "SP2", what: "an unknown problem key shown raw", file: PAGE,
    find: "    else cannot.push({ spot: s, line: W.PROBLEM_LINES[s.problem] ?? W.NOT_OPEN });",
    replace: "    else cannot.push({ spot: s, line: W.PROBLEM_LINES[s.problem] ?? s.problem });", expect: "P2" },
  { id: "SP3", what: "Drop offered on every self-claim, inside 48 hours too", file: PAGE,
    find: "  if (g.can_drop) return { kind: \"drop\" };", replace: "  if (g.self_claimed) return { kind: \"drop\" };", expect: "P3" },
  { id: "SP4", what: "an unknown claim reply read as a success", file: PAGE,
    find: "      return { ok: false, line: W.SOMETHING_WRONG };\n  }\n}\n\n/** The drop route's",
    replace: "      return { ok: true, line: W.SOMETHING_WRONG };\n  }\n}\n\n/** The drop route's", expect: "P4" },
  { id: "SP5", what: "the drop refusal ignores the contact the database sent", file: PAGE,
    find: "  const contact = str(r.contact_email) ?? contactFallback;", replace: "  const contact = contactFallback;", expect: "P5" },
  { id: "SP6", what: "a help reply with no numeric count read as sent", file: PAGE,
    find: "  if (!r || typeof r.queued !== \"number\" || !Array.isArray(r.skipped)) return { ok: false, lines: [W.HELP_FAILED] };",
    replace: "  if (!r || !Array.isArray(r.skipped)) return { ok: false, lines: [W.HELP_FAILED] };", expect: "P6" },
  { id: "SP7", what: "a help email without a valid link is sent", file: MAIL,
    find: "      if (!row.linkToken || !/^[0-9a-f]{64}$/.test(row.linkToken) || !name) return null;",
    replace: "      if (!name) return null;", expect: "M2" },
  { id: "SP8", what: "names not escaped in the html", file: MAIL,
    find: "function esc(s: string): string {\n  return s.replace(",
    replace: "function esc(s: string): string {\n  return s; void s.replace(", expect: "M3" },
  { id: "SP9", what: "the parser drops the take's link token", file: RUNNER,
    find: "      linkToken: typeof o.link_token === \"string\" ? o.link_token : null,", replace: "      linkToken: null,", expect: "D1" },
  { id: "SP10", what: "the cron runs with CRON_SECRET unset", file: CRON,
    find: "  if (!secret) return { status: 503, error: \"CRON_SECRET is not configured.\" };", replace: "", expect: "C1" },
  { id: "SP11", what: "the page data is cached", file: ROUTE,
    find: "const NO_STORE = { \"Cache-Control\": \"no-store\", \"X-Robots-Tag\": \"noindex, nofollow\" };",
    replace: "const NO_STORE = { \"Cache-Control\": \"public, max-age=60\", \"X-Robots-Tag\": \"noindex, nofollow\" };", expect: "F1" },
  { id: "SP12", what: "the create reply accepts any string token", file: COPY,
    find: "  if (error || typeof token !== \"string\" || !/^[0-9a-f]{64}$/.test(token)) {",
    replace: "  if (error || typeof token !== \"string\") {", expect: "L1" },
  { id: "SP13", what: "copyLink writes the clipboard after an await (the Safari bug)", file: COPY,
    find: "    write = clipboard.writeText(url);",
    replace: "    write = Promise.resolve().then(() => clipboard.writeText(url));", expect: "L2" },
  { id: "SP14", what: "a refused copy read as copied", file: COPY,
    find: "    () => \"refused\" as const,\n  );",
    replace: "    () => \"copied\" as const,\n  );", expect: "L3" },
  { id: "SP15", what: "the Copy click awaits before copying", file: SECTION,
    find: "  function copyShownLink() {\n    if (!shownLink) return;",
    replace: "  async function copyShownLink() {\n    if (!shownLink) return;\n    await Promise.resolve();", expect: "L4" },
  { id: "SP16", what: "the new link is not put in the field after it is made", file: SECTION,
    find: "    setLinkNotice({ ok: true, line: W.LINK_CREATED });\n    setShownLink(out.url);",
    replace: "    setLinkNotice({ ok: true, line: W.LINK_CREATED });", expect: "L4" },
];

runMutants({
  sim: "scripts/sim/official-signup-page-sim.ts",
  timezones: ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"],
  mutants: MUTANTS,
});
