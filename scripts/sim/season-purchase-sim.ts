// Harness for the pure Add-season decisions (src/lib/billing/season-purchase.ts
// + prices.ts) and the wiring that makes every "New season" entry point use
// them. Expected values are LITERALS written here, so a change to a rule or
// a sentence shows up as a failure, never as the module agreeing with itself.
//
// SECTIONS (in this order — mutant targets depend on it)
//   N   newSeasonScreen: every state → its screen
//   U   upgradeKindFor: the feature-lock upgrade, by state
//   LG  every Elite gate in src (feature="…" with tier="Elite") is in
//       ELITE_FEATURES — the "what you lose" line can't drift from the code
//   L   loseLine: the literal sentence; null when nothing is lost
//   P   purchasePageState, incl. the flag winning and the 30-second edge
//   C   purchasePageCopy titles
//   R   every flag reason 0111 can write has its own sentence (read out of
//       the migration file)
//   E   reviewEmail: subject, amount formatting, fields
//   D   seasonDateRange
//   PR  prices: the config's cents; no price typed by hand in src
//   S   wiring (greps — weak by nature, stated): the two hosts render
//       NewSeasonFlow; only it calls create_league; no screen still opens the
//       old add-season or season-cap modal
//
// Mutants: npm run sim:season-purchase:mutants.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  loseLine,
  newSeasonScreen,
  newSeasonView,
  purchasePageCopy,
  purchasePageState,
  reviewEmail,
  reviewReasonSentence,
  seasonDateRange,
  signupAwaitingWebhook,
  signupWaitStep,
  upgradeKindFor,
  type NewSeasonState,
  type PurchaseRow,
} from "@/lib/billing/season-purchase";
import { expectedPriceCents, priceLabel, SEASON_PRICE_USD } from "@/lib/billing/prices";
import { ELITE_FEATURES } from "@/lib/plan/limits";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
let passes = 0;
const counters = { awaitCasesSeen: 0, screensSeen: 0, eliteGatesFound: 0, flagReasonsFound: 0, srcFilesScanned: 0, blogPricesChecked: 0, blogFaqPricesChecked: 0 };

function check(tag: string, ok: boolean, detail: string) {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL: [${tag}] ${detail}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

function section(name: string, fn: () => void) {
  try {
    fn();
  } catch (err) {
    check(`CRASH-${name}`, false, err instanceof Error ? err.message : String(err));
  }
}

const S = (p: Partial<NewSeasonState>): NewSeasonState => ({
  plan: "free",
  comped: false,
  activeCount: 0,
  creditCount: 0,
  activeSeasonName: null,
  awaitingSignupPurchaseId: null,
  ...p,
});

section("N", () => {
  const table: [Partial<NewSeasonState>, string][] = [
    [{ plan: "free", activeCount: 0 }, "create"],
    [{ plan: "free", activeCount: 1 }, "convert_free"],
    [{ plan: "free", activeCount: 1, creditCount: 1 }, "convert_free"],
    [{ plan: "pro", activeCount: 1 }, "add_season"],
    [{ plan: "elite", activeCount: 3 }, "add_season"],
    [{ plan: "elite", activeCount: 0 }, "first_season"],
    [{ plan: "pro", activeCount: 0 }, "first_season"],
    [{ plan: "elite", activeCount: 1, creditCount: 1 }, "create"],
    [{ plan: "pro", activeCount: 0, creditCount: 2 }, "create"],
    [{ plan: "elite", comped: true, activeCount: 1 }, "create"],
    [{ plan: "elite", comped: true, activeCount: 0 }, "create"],
    [{ plan: "free", comped: true, activeCount: 1 }, "create"],
  ];
  const seen = new Set<string>();
  for (const [st, want] of table) {
    const got = newSeasonScreen(S(st));
    seen.add(got);
    check("N", got === want, `${JSON.stringify(st)} → ${got}, expected ${want}`);
  }
  counters.screensSeen = seen.size;
});

// The signup race: Stripe's success page can beat the webhook back. Until it
// lands the league is Free with nothing active, which on its own reads as
// "create" — a free season, and the payment's credit left unused.
section("W", () => {
  for (const st of [
    { plan: "free" as const, activeCount: 0 },
    { plan: "pro" as const, activeCount: 0, creditCount: 1 },
    { plan: "free" as const, activeCount: 1 },
  ]) {
    const got = newSeasonView(S({ ...st, awaitingSignupPurchaseId: "p1" }));
    if (got === "await_payment") counters.awaitCasesSeen++;
    check("W1", got === "await_payment", `${JSON.stringify(st)} with a paid signup pending → ${got}, expected await_payment`);
  }
  check("W1", newSeasonScreen(S({ plan: "free", activeCount: 0 })) === "create",
    "fixture: the race state without the wait must read as create, or W1 proves nothing");
  for (const st of [{}, { plan: "pro" as const, activeCount: 1 }, { plan: "elite" as const, comped: true }]) {
    check("W2", newSeasonView(S(st)) === newSeasonScreen(S(st)), `no pending signup must leave the screen unchanged: ${JSON.stringify(st)}`);
  }

  const now = Date.parse("2026-10-19T18:00:00Z");
  const r = (p: Partial<{ kind: string; status: string; stripe_session_id: string | null; created_at: string }>) => ({
    kind: "signup", status: "pending", stripe_session_id: "cs_1", created_at: "2026-10-19T17:59:00Z", ...p,
  });
  const cases: [string, ReturnType<typeof r>, string | null, boolean][] = [
    ["paid, webhook pending", r({}), "complete", true],
    ["checkout still open (left without paying)", r({}), "open", false],
    ["checkout expired", r({}), "expired", false],
    ["Stripe status unknown", r({}), null, false],
    ["no session attached", r({ stripe_session_id: null }), "complete", false],
    ["older than 24 hours", r({ created_at: "2026-10-18T17:59:59Z" }), "complete", false],
    ["just under 24 hours", r({ created_at: "2026-10-18T18:00:01Z" }), "complete", true],
    ["already credited", r({ status: "credited" }), "complete", false],
    ["not a signup", r({ kind: "add_season" }), "complete", false],
  ];
  for (const [what, row, status, want] of cases) {
    check("W3", signupAwaitingWebhook(row, status, now) === want, `${what}: expected ${want}`);
  }

  const steps: [Parameters<typeof signupWaitStep>[0], string][] = [
    ["waiting", "poll"], ["slow", "poll"], ["upgraded", "reload"], ["ready", "reload"],
    ["abandoned", "reload"], ["flagged", "show"], ["unreadable", "show"],
  ];
  for (const [st, want] of steps) check("W4", signupWaitStep(st) === want, `${st} → ${signupWaitStep(st)}, expected ${want}`);

  const signupRow = { id: "p1", kind: "signup", tier: "pro", status: "pending", needs_review: false, league_id: null, name: null, start_date: null, end_date: null };
  check("W5", purchasePageCopy("waiting", signupRow).title === "Payment received — setting up your account", purchasePageCopy("waiting", signupRow).title);
  const slow = purchasePageCopy("slow", signupRow);
  check("W5", slow.title === "Still working on it" && slow.lines.join(" ").includes("you don’t need to pay again") && !slow.lines.join(" ").includes("Seasons page"),
    `signup slow copy: ${JSON.stringify(slow)}`);

  const flow = read("src/components/seasons/new-season-flow.tsx");
  check("W6", /newSeasonView\(state\) === "await_payment"/.test(flow) && flow.includes("<SignupPaymentWait"),
    "NewSeasonFlow must gate on newSeasonView and render SignupPaymentWait");
  const loader = read("src/lib/billing/new-season-state.ts");
  check("W6", loader.includes("signupAwaitingWebhook(") && loader.includes("checkout.sessions.retrieve(") && loader.includes("awaitingSignupPurchaseId,"),
    "loadNewSeasonState must ask Stripe and set awaitingSignupPurchaseId");
  const wait = read("src/components/seasons/purchase-status.tsx");
  check("W6", wait.includes("signupWaitStep(state)") && wait.includes("router.refresh()"),
    "SignupPaymentWait must follow signupWaitStep and reload the server state");
});

section("U", () => {
  const table: [string, number, "pro" | "elite", string | null][] = [
    ["free", 1, "pro", "convert_free"],
    ["free", 1, "elite", "convert_free"],
    ["free", 0, "pro", "signup"],
    ["free", 0, "elite", "signup"],
    ["pro", 1, "elite", "upgrade_tier"],
    ["pro", 0, "elite", "upgrade_tier"],
    ["pro", 1, "pro", null],
    ["elite", 1, "elite", null],
    ["elite", 0, "pro", null],
  ];
  for (const [plan, active, tier, want] of table) {
    const got = upgradeKindFor(plan as "free", active, tier);
    check("U", got === want, `${plan}/${active}/${tier} → ${got}, expected ${want}`);
  }
});

section("LG", () => {
  const listed = new Set(ELITE_FEATURES.flatMap((f) => f.gates));
  const files = walk("src").filter((f) => f.endsWith(".tsx"));
  counters.srcFilesScanned = files.length;
  for (const f of files) {
    const src = read(f);
    // feature="X" with tier="Elite" in the same JSX element (≤ 3 lines apart).
    const re = /feature="([^"]+)"[\s\S]{0,120}?tier="Elite"|tier="Elite"[\s\S]{0,120}?feature="([^"]+)"/g;
    for (const m of src.matchAll(re)) {
      const label = m[1] ?? m[2];
      counters.eliteGatesFound++;
      check("LG1", listed.has(label), `${f}: Elite gate "${label}" is not in ELITE_FEATURES — the "what you lose" line would miss it`);
    }
  }
});

section("L", () => {
  const want =
    "Choosing Pro moves your whole league to Pro. You’ll lose playoff brackets, officials, snack shack, reports, team scheduling constraints and browsing and restoring archived seasons. Partner leagues are limited to 5 per season and admin seats to 2.";
  check("L1", loseLine("elite", "pro") === want, `elite→pro: ${loseLine("elite", "pro")}`);
  check("L2", loseLine("elite", "elite") === null, "elite→elite should lose nothing");
  check("L2", loseLine("pro", "elite") === null, "pro→elite should lose nothing");
  check("L2", loseLine("pro", "pro") === null, "pro→pro should lose nothing");
  check("L2", loseLine("free", "pro") === null, "free→pro should lose nothing");
});

const row = (p: Partial<PurchaseRow>): PurchaseRow => ({
  id: "p1",
  kind: "add_season",
  tier: "elite",
  status: "pending",
  needs_review: false,
  league_id: null,
  name: "Spring 27",
  start_date: "2027-04-03",
  end_date: "2027-05-22",
  ...p,
});

section("P", () => {
  const table: [PurchaseRow | null, number, string][] = [
    [null, 0, "unreadable"],
    [row({}), 0, "waiting"],
    [row({}), 29_999, "waiting"],
    [row({}), 30_000, "slow"],
    [row({ status: "completed", league_id: "L1" }), 0, "ready"],
    [row({ status: "completed", kind: "convert_free" }), 0, "upgraded"],
    [row({ status: "credited", kind: "signup" }), 0, "upgraded"],
    [row({ status: "abandoned" }), 0, "abandoned"],
    // The flag wins over every status.
    [row({ status: "credited", needs_review: true }), 0, "flagged"],
    // …but a flagged purchase whose season exists is ready (never "we
    // didn't create the season" about one that was created).
    [row({ status: "completed", league_id: "L1", needs_review: true }), 0, "ready"],
    [row({ status: "pending", needs_review: true }), 0, "flagged"],
  ];
  for (const [r, ms, want] of table) {
    const got = purchasePageState(r, ms);
    check("P", got === want, `${JSON.stringify(r && { s: r.status, rv: r.needs_review, l: r.league_id })} @${ms}ms → ${got}, expected ${want}`);
  }
});

section("C", () => {
  const r = row({ status: "completed", league_id: "L1" });
  const t = (s: Parameters<typeof purchasePageCopy>[0]) => purchasePageCopy(s, r).title;
  check("C", t("waiting") === "Payment received — creating your season", t("waiting"));
  check("C", t("slow") === "Still working on it", t("slow"));
  check("C", t("ready") === "Spring 27 is ready", t("ready"));
  check("C", purchasePageCopy("ready", r).meta === "Elite season · Apr 3 – May 22, 2027", String(purchasePageCopy("ready", r).meta));
  check("C", t("flagged") === "Payment received — we’ll finish this for you", t("flagged"));
  check("C", purchasePageCopy("flagged", r).lines.includes("You won’t be charged again."), "flagged page must say no second charge");
});

section("R", () => {
  // Every review_reason literal the migration writes.
  const mig = read("supabase/migrations/0111_season_purchases.sql");
  const reasons = new Set<string>();
  for (const m of mig.matchAll(/'([a-z_]+(?::)?)'(?:\s*\|\|)?/g)) {
    const s = m[1];
    if (/^(purchase_not_found|purchase_belongs_to_another_league|purchase_not_pending:|tier_mismatch:|upgrade_flag_mismatch|quantity_not_one|plan_changed:|season_active_at_payment|already_paid:|not_on_pro:)$/.test(s)) {
      reasons.add(s);
    }
  }
  counters.flagReasonsFound = reasons.size;
  check("R1", reasons.size === 10, `expected 10 flag reasons in 0111, found ${reasons.size}: ${[...reasons].join(", ")}`);
  for (const r of reasons) {
    const sample = r.endsWith(":") ? `${r}x` : r;
    const sentence = reviewReasonSentence(sample);
    check("R1", !sentence.startsWith("Flag reason:"), `no sentence for ${r} (got "${sentence}")`);
  }
  check("R2", reviewReasonSentence("plan_changed:pro->elite") ===
    "The league’s plan changed (pro → elite) between checkout and payment — check the price paid.",
    reviewReasonSentence("plan_changed:pro->elite"));
  check("R2", reviewReasonSentence("not_on_pro:free") ===
    "The $100 Elite upgrade was paid while the league was on free — no change was made.",
    reviewReasonSentence("not_on_pro:free"));
});

section("E", () => {
  const m = reviewEmail({
    leagueName: "Riverside LL",
    orgId: "org-1",
    kind: "add_season",
    outcome: "season_created",
    reason: "plan_changed:pro->elite",
    amountCents: 24900,
    currency: "usd",
    purchaseId: "p-1",
    sessionId: "cs_1",
    eventId: "evt_1",
  });
  check("E1", m.subject === "Payment needs review — Riverside LL — $249.00", m.subject);
  for (const want of ["League: Riverside LL (org-1)", "What was bought: Add season", "Amount: $249.00", "Purchase: p-1", "Stripe event: evt_1"]) {
    check("E1", m.text.includes(want), `missing "${want}"`);
  }
  const unknown = reviewEmail({
    leagueName: "X", orgId: "o", kind: "unmatched", outcome: "credited", reason: "purchase_not_found",
    amountCents: null, currency: null, purchaseId: null, sessionId: "cs", eventId: "e",
  });
  check("E2", unknown.text.includes("Amount: unknown amount") && unknown.text.includes("Purchase: none"), unknown.text);
  check("E2", !/<script/i.test(reviewEmail({ ...{ leagueName: "<script>x</script>", orgId: "o", kind: "k", outcome: null, reason: "r", amountCents: 1, currency: "usd", purchaseId: null, sessionId: "s", eventId: "e" } }).html),
    "the html email must escape the league name");
});

section("D", () => {
  check("D", seasonDateRange("2027-04-03", "2027-05-22") === "Apr 3 – May 22, 2027", seasonDateRange("2027-04-03", "2027-05-22"));
  check("D", seasonDateRange("2026-11-07", "2027-02-20") === "Nov 7, 2026 – Feb 20, 2027", seasonDateRange("2026-11-07", "2027-02-20"));
  check("D", seasonDateRange("", "2027-05-22") === "", "a missing date renders nothing");
});

section("PR", () => {
  check("PR2", expectedPriceCents("pro", false) === 24900 && expectedPriceCents("elite", false) === 34900 && expectedPriceCents("elite", true) === 10000,
    `cents: ${expectedPriceCents("pro", false)}/${expectedPriceCents("elite", false)}/${expectedPriceCents("elite", true)}`);
  check("PR2", priceLabel("elite") === "$349" && priceLabel("pro", true) === "$100", `${priceLabel("elite")} ${priceLabel("pro", true)}`);
  // No price typed by hand anywhere in src: "$249", "$349", "$100" outside
  // the config. Comments count too — a stale number in a comment is how the
  // next hand-typed one gets copied.
  const amounts = Object.values(SEASON_PRICE_USD).map(String);
  const re = new RegExp(`\\$\\s?(${amounts.join("|")})\\b`);
  for (const f of walk("src")) {
    if (f === join("src", "lib", "billing", "prices.ts")) continue;
    const src = read(f);
    src.split("\n").forEach((line, i) => {
      if (re.test(line)) check("PR1", false, `${f}:${i + 1} types a price by hand: ${line.trim()}`);
    });
  }
});

// The blog is markdown, so it can't call priceLabel. Every dollar amount in a
// post — body AND frontmatter (the FAQ answers search engines read) — must be
// one of the config's amounts, so a price change that misses a post fails here
// instead of drifting silently.
section("PB", () => {
  const amounts = new Set(Object.values(SEASON_PRICE_USD).map(String));
  const dir = join("content", "blog");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const f = join(dir, name);
    const lines = read(f).split("\n");
    let fence = 0;
    lines.forEach((line, i) => {
      if (line.trim() === "---") fence++;
      const inFrontmatter = fence === 1;
      for (const m of line.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)) {
        const amount = m[1].replace(/,/g, "");
        counters.blogPricesChecked++;
        if (inFrontmatter) counters.blogFaqPricesChecked++;
        check("PR3", amounts.has(amount),
          `${f}:${i + 1} names $${amount}, which is not a price in src/lib/billing/prices.ts: ${line.trim()}`);
      }
    });
  }
});

section("S", () => {
  const newPage = read("src/app/(dashboard)/dashboard/leagues/new/page.tsx");
  check("S1", newPage.includes("<NewSeasonFlow") && newPage.includes("loadNewSeasonState"), "/dashboard/leagues/new does not render NewSeasonFlow from loadNewSeasonState");
  const setup = read("src/components/setup/setup-shell.tsx");
  check("S1", setup.includes("<NewSeasonFlow"), "the setup wizard does not render NewSeasonFlow");
  check("S1", read("src/app/setup/page.tsx").includes("loadNewSeasonState"), "the setup page does not load the new-season state");
  const callers = walk("src").filter((f) => /["']create_league["']/.test(read(f)));
  check("S2", callers.length === 1 && callers[0].endsWith("new-season-flow.tsx"),
    `create_league must be called only by NewSeasonFlow; callers: ${callers.join(", ")}`);
  const list = read("src/components/seasons/seasons-list-client.tsx");
  check("S3", !list.includes("SeasonUpgradeModal") && !/cap="activeSeasons"/.test(list),
    "the Seasons page still opens the add-season or season-cap modal");
  check("S3", (list.match(/href="\/dashboard\/leagues\/new"/g) ?? []).length >= 2, "the Seasons page buttons don't link to the flow");
  for (const f of walk("src")) {
    const src = read(f);
    if (/reason="add-season"|AddSeasonBody|cap="activeSeasons"/.test(src)) {
      check("S4", false, `${f} still has the old add-season / season-cap path`);
    }
  }
});

for (const [name, n] of Object.entries(counters)) {
  check("V", n > 0, `counter ${name} is zero — the scenario it guards never happened`);
}
console.log(`\n${passes} checks passed, ${failures} failed.`);
console.log(`counters: ${JSON.stringify(counters)}`);
process.exit(failures ? 1 : 0);
