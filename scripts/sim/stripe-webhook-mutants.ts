// Mutation pass for stripe-webhook-sim.ts — each mutant must fail FIRST at
// its own assertion (see mutant-runner.ts).
import { runMutants, type Mutant } from "./mutant-runner";

const ROUTE = "src/app/api/stripe/webhook/route.ts";
const LIB = "src/lib/billing/season-purchase.ts";

const MUTANTS: Mutant[] = [
  {
    id: "WM1", what: "the purchase id not passed to the database", file: ROUTE,
    find: "        p_purchase_id: purchaseId,",
    replace: "        p_purchase_id: null,",
    expect: "W1",
  },
  {
    id: "WM2", what: "a missing purchase id sent as the nil uuid (legacy sessions flagged)", file: ROUTE,
    find: "      rawPurchase === undefined || rawPurchase === \"\"\n        ? null",
    replace: "      rawPurchase === undefined || rawPurchase === \"\"\n        ? NO_SUCH_PURCHASE",
    expect: "W2",
  },
  {
    id: "WM3", what: "a malformed purchase id passed through raw", file: ROUTE,
    find: "          : NO_SUCH_PURCHASE,",
    replace: "          : rawPurchase,",
    expect: "W3",
  },
  {
    id: "WM4", what: "quantity mapped onto 1/2 again (the removed quantity=2 shape)", file: ROUTE,
    find: "    quantity: Number.isInteger(rawQty) ? rawQty : 0,",
    replace: "    quantity: rawQty === 2 ? 2 : 1,",
    expect: "W4",
  },
  {
    id: "WM5", what: "a flagged payment never emailed", file: ROUTE,
    find: "    if (r.needs_review) {",
    replace: "    if (false && r.needs_review) {",
    expect: "W5",
  },
  {
    id: "WM6", what: "the email names the wrong amount (subtotal before discounts)", file: ROUTE,
    find: "        amountCents: typeof session.amount_total === \"number\" ? session.amount_total : null,",
    replace: "        amountCents: null,",
    expect: "W5",
  },
  {
    id: "WM7", what: "the reason sentence for a second payment lost", file: LIB,
    find: "    case \"purchase_not_pending\":",
    replace: "    case \"purchase_not_pending_x\":",
    expect: "W5",
  },
  {
    id: "WM8", what: "every processed event emailed", file: ROUTE,
    find: "    if (r.needs_review) {",
    replace: "    if (r.result === \"processed\") {",
    expect: "W6",
  },
  {
    id: "WM9", what: "a failed send turned into a 500", file: ROUTE,
    find: "        if (!sent.ok) {\n          console.error(\"[stripe webhook] needs_review email NOT sent\", { error: sent.error, ...mail });\n        }",
    replace: "        if (!sent.ok) {\n          return NextResponse.json({ error: sent.error }, { status: 500 });\n        }",
    expect: "W7",
  },
  {
    id: "WM10", what: "the comp guard removed", file: ROUTE,
    find: "    if (comped === true) {",
    replace: "    if (false && comped === true) {",
    expect: "W8",
  },
];

runMutants({ sim: "scripts/sim/stripe-webhook-sim.ts", mutants: MUTANTS });
