// Mutation pass for stripe-checkout-auth-sim.ts. Each mutant is applied to
// the REAL route source, the sim runs, the source is restored and verified
// byte-for-byte, and the mutant counts as killed only if the FIRST failing
// assertion is the one written for it.
import { runMutants, type Mutant } from "./mutant-runner";

const ROUTE = "src/app/api/stripe/checkout/route.ts";

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
    id: "SB1", what: "upgradeOnly accepted from any plan", file: ROUTE,
    find: "  if (upgradeOnly && currentPlan !== \"pro\") {",
    replace: "  if (false && upgradeOnly && currentPlan !== \"pro\") {",
    expect: "B1",
  },
  {
    id: "SB2", what: "upgradeOnly refused only from Free (Elite let through)", file: ROUTE,
    find: "  if (upgradeOnly && currentPlan !== \"pro\") {",
    replace: "  if (upgradeOnly && currentPlan === \"free\") {",
    expect: "B2",
  },
  {
    id: "SB3", what: "a Pro season accepted on an Elite org (downgrade)", file: ROUTE,
    find: "  if (!upgradeOnly && plan === \"pro\" && currentPlan === \"elite\") {",
    replace: "  if (false && !upgradeOnly && plan === \"pro\" && currentPlan === \"elite\") {",
    expect: "B4",
  },
  {
    id: "SB4", what: "the current plan is not read", file: ROUTE,
    find: "    .select(\"comped, pending_promo, plan\")",
    replace: "    .select(\"comped, pending_promo\")",
    expect: "B3",
  },
];

runMutants({
  sim: "scripts/sim/stripe-checkout-auth-sim.ts",
  mutants: MUTANTS,
});
