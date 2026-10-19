// Mutation pass for stripe-checkout-auth-sim.ts. Each mutant is applied to
// the REAL source, the sim runs, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const ROUTE = "src/app/api/stripe/checkout/route.ts";
const START = "src/lib/billing/start-checkout.ts";
const CALLBACK = "src/app/api/auth/callback/route.ts";

const MUTANTS: Mutant[] = [
  {
    id: "SA1", what: "the sign-in check removed", file: ROUTE,
    find: "  if (!user) {\n",
    replace: "  if (false && !user) {\n",
    expect: "A1",
  },
  {
    id: "SA2", what: "the membership check removed (the userId fallback reaches Stripe)", file: ROUTE,
    find: "  if (!memberships.some((m) => m.org_id === orgId)) {",
    replace: "  if (false && !memberships.some((m) => m.org_id === orgId)) {",
    expect: "A2",
  },
  {
    id: "SA3", what: "a body orgId that differs from the derived org is let through", file: ROUTE,
    find: "  if (bodyOrgId !== null && bodyOrgId !== orgId) {",
    replace: "  if (false && bodyOrgId !== null && bodyOrgId !== orgId) {",
    expect: "A3",
  },
  {
    id: "SA4", what: "the body's orgId is trusted again", file: ROUTE,
    find: "  const orgId = await getCurrentOrgId(supabase, user.id, memberships);",
    replace: "  const orgId = bodyOrgId ?? (await getCurrentOrgId(supabase, user.id, memberships));",
    expect: "A3",
  },
  {
    id: "SA5", what: "the comp guard removed (a comped league reaches begin)", file: ROUTE,
    find: "  if (comped === true) {",
    replace: "  if (false && comped === true) {",
    expect: "A8",
  },
  {
    id: "SK1", what: "unknown kinds accepted", file: ROUTE,
    find: "  if (requested !== \"upgrade\" && !PURCHASE_KINDS.includes(requested as PurchaseKind)) {",
    replace: "  if (false && requested !== \"upgrade\" && !PURCHASE_KINDS.includes(requested as PurchaseKind)) {",
    expect: "B1",
  },
  {
    id: "SK2", what: "the session's tier taken from the request, not the database", file: START,
    find: "    plan: reply.tier,",
    replace: "    plan: i.tier ?? reply.tier,",
    expect: "B2",
  },
  {
    id: "SK3", what: "a Free upgrade ignores the active-season count", file: ROUTE,
    find: "    const k = upgradeKindFor(profileRow.plan, count, tier);",
    replace: "    const k = upgradeKindFor(profileRow.plan, 1, tier);",
    expect: "B4",
  },
  {
    id: "SK4", what: "the upgrade flag dropped from the session", file: START,
    find: "    quantity: 1,\n    upgradeOnly: reply.upgrade_only,",
    replace: "    quantity: 1,\n    upgradeOnly: false,",
    expect: "B5",
  },
  {
    id: "SK5", what: "season dates no longer required before begin", file: ROUTE,
    find: "  if (SEASON_KINDS.includes(kind) && (!season || !DATE_RE.test(season.startDate) || !DATE_RE.test(season.endDate))) {",
    replace: "  if (false && SEASON_KINDS.includes(kind) && (!season || !DATE_RE.test(season.startDate) || !DATE_RE.test(season.endDate))) {",
    expect: "B8",
  },
  {
    id: "SC1", what: "a season purchase returns to the dashboard, not its page", file: ROUTE,
    find: "      ? `${SITE_URL}/dashboard/purchases/${purchaseId}`",
    replace: "      ? `${SITE_URL}/dashboard?upgraded=true`",
    expect: "C1",
  },
  {
    id: "SC2", what: "a caller sends its own success URL again", file: "src/components/plan/UpgradeModal.tsx",
    find: "        body: JSON.stringify({ kind: \"upgrade\", tier: plan, orgId }),",
    replace: "        body: JSON.stringify({ kind: \"upgrade\", tier: plan, orgId, successUrl: `${window.location.origin}/dashboard` }),",
    expect: "C4",
  },
  {
    id: "SP1", what: "the live price check ignored", file: START,
    find: "  if (!price.ok) {",
    replace: "  if (false && !price.ok) {",
    expect: "D1",
  },
  {
    id: "SP2", what: "the purchase not abandoned when the price check fails", file: START,
    find: "      purchaseId,\n    });\n    await abandon();\n    return refusal(503, \"price_unavailable\");",
    replace: "      purchaseId,\n    });\n    return refusal(503, \"price_unavailable\");",
    expect: "D1b",
  },
  {
    id: "SP3", what: "the price checked as a full season for every purchase", file: START,
    find: "  const price = await verifySeasonPrice(reply.tier, reply.upgrade_only);",
    replace: "  const price = await verifySeasonPrice(reply.tier, false);",
    expect: "D2",
  },
  {
    id: "SE1", what: "the purchase id not sent to Stripe", file: START,
    find: "    orgId: i.orgId,\n    purchaseId,\n",
    replace: "    orgId: i.orgId,\n    purchaseId: \"\",\n",
    expect: "E1",
  },
  {
    id: "SE2", what: "the session id never recorded", file: START,
    find: "    { p_purchase_id: purchaseId, p_session_id: session.id } as never,",
    replace: "    { p_purchase_id: purchaseId, p_session_id: \"cs_unknown\" } as never,",
    expect: "E2",
  },
  {
    id: "SF1", what: "the signup callback buys a first season instead of a credit", file: CALLBACK,
    find: "          kind: \"signup\",",
    replace: "          kind: \"first_season\",",
    expect: "F1",
  },
];

runMutants({
  sim: "scripts/sim/stripe-checkout-auth-sim.ts",
  mutants: MUTANTS,
});
