// Harness for POST /api/stripe/checkout — who may start a checkout, for which
// org, and on what terms. Drives the REAL route handler; only its environment
// is faked, at the CJS loader (`Module._load`, the invite-page-sim technique):
//
//   @/lib/supabase/server  → a signed-in (or not) user whose memberships come
//                            from `state.memberships` (listMemberships and
//                            getCurrentOrgId themselves run for real)
//   @/lib/supabase/admin   → the profiles read the comp guard makes
//   @/lib/stripe           → createCheckoutSession records its params; NO
//                            network, nothing reaches Stripe
//   @/lib/promo            → no coupon
//   next/headers           → the fs_org_id cookie from `state.cookieOrg`
//
// Every refused case asserts BOTH the status AND that zero sessions were
// created — a refusal that still built a session is the failure that matters.
//
// SECTIONS
//   A  sign-in and org derivation (commit 1)
//   B  the purchase fits the org's current plan (commit 2): upgradeOnly only
//      from Pro; no Pro season on an Elite org
//   C  return URLs built from SITE_URL by name (commit 3); body URLs ignored
//
// Anti-vacuity: an allowed session and a refused attempt must each happen at
// least once, or the run fails.
//
// Mutants: npm run sim:stripe-checkout-auth:mutants — each must fail FIRST at
// its own assertion.
import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Membership = { org_id: string; role: "owner" | "admin"; added_at: string };
type Profile = {
  id: string;
  comped: boolean;
  pending_promo: string | null;
  plan: "free" | "pro" | "elite";
  org_name: string | null;
  full_name: string | null;
  email: string;
};

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ORG_COMPED = "cccccccc-0000-4000-8000-000000000003";
const USER = ORG_A; // the user's own org id is their user id
const LONER = "dddddddd-0000-4000-8000-000000000004"; // a user with no readable memberships

const profiles: Record<string, Profile> = {
  [ORG_A]: { id: ORG_A, comped: false, pending_promo: null, plan: "free", org_name: "A League", full_name: null, email: "a@example.test" },
  [ORG_B]: { id: ORG_B, comped: false, pending_promo: null, plan: "free", org_name: "B League", full_name: null, email: "b@example.test" },
  [ORG_COMPED]: { id: ORG_COMPED, comped: true, pending_promo: null, plan: "elite", org_name: "Comped", full_name: null, email: "c@example.test" },
  [LONER]: { id: LONER, comped: false, pending_promo: null, plan: "free", org_name: "Loner", full_name: null, email: "d@example.test" },
};

const state: {
  user: { id: string } | null;
  memberships: Membership[];
  cookieOrg: string | undefined;
  sessions: Record<string, unknown>[];
} = { user: null, memberships: [], cookieOrg: undefined, sessions: [] };

// ── Fakes ───────────────────────────────────────────────────────────────────

type Filter = { col: string; op: "eq" | "in"; val: unknown };

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "organization_members") {
    return state.user ? state.memberships.map((m) => ({ ...m, user_id: state.user!.id })) : [];
  }
  if (table === "profiles") return Object.values(profiles);
  throw new Error(`fake: unexpected table ${table}`);
}

function builder(table: string) {
  const filters: Filter[] = [];
  // Only the selected columns come back, like PostgREST — so a read that
  // stops selecting a column (mutant SB4) really loses it.
  let cols: string[] | null = null;
  const run = () =>
    rowsFor(table)
      .filter((r) =>
        filters.every((f) =>
          f.op === "eq" ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col]),
        ),
      )
      .map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : r));
  const b = {
    select: (s?: string) => {
      cols = s ? s.split(",").map((c) => c.trim()) : null;
      return b;
    },
    eq: (col: string, val: unknown) => (filters.push({ col, op: "eq", val }), b),
    in: (col: string, val: unknown[]) => (filters.push({ col, op: "in", val }), b),
    order: () => b,
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: (v: { data: unknown; error: null }) => unknown) => res({ data: run(), error: null }),
  };
  return b;
}

const fakeServer = {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: builder,
  }),
};
const fakeAdmin = { createAdminClient: () => ({ from: builder }) };
const fakeStripe = {
  createCheckoutSession: async (params: Record<string, unknown>) => {
    state.sessions.push(params);
    return { url: "https://checkout.stripe.test/session" };
  },
};
const fakePromo = { resolvePromoCoupon: async () => null };
const fakeHeaders = {
  cookies: () => ({
    get: (name: string) =>
      name === "fs_org_id" && state.cookieOrg ? { name, value: state.cookieOrg } : undefined,
    getAll: () => [],
    set: () => {},
  }),
};

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (request === "@/lib/supabase/server") return fakeServer;
  if (request === "@/lib/supabase/admin") return fakeAdmin;
  if (request === "@/lib/stripe") return fakeStripe;
  if (request === "@/lib/promo") return fakePromo;
  if (request === "next/headers") return fakeHeaders;
  return origLoad.call(this, request, parent, isMain);
};

// ── Harness ─────────────────────────────────────────────────────────────────

let failures = 0;
let passes = 0;
const counters = { allowedSession: 0, refusedNoSession: 0 };

function check(tag: string, ok: boolean, detail: string) {
  if (ok) {
    passes++;
  } else {
    failures++;
    console.log(`FAIL: [${tag}] ${detail}`);
  }
}

type Setup = {
  user: { id: string } | null;
  memberships?: Membership[];
  cookieOrg?: string;
};

function member(org: string, role: "owner" | "admin" = "owner"): Membership {
  return { org_id: org, role, added_at: "2026-01-01T00:00:00Z" };
}

const BASE_BODY = { plan: "pro", quantity: 1, returnTo: "upgraded" };

async function post(
  setup: Setup,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown>; sessions: Record<string, unknown>[] }> {
  state.user = setup.user;
  state.memberships = setup.memberships ?? [];
  state.cookieOrg = setup.cookieOrg;
  state.sessions = [];
  const { POST } = await import("@/app/api/stripe/checkout/route");
  const res = await POST(
    new Request("https://www.thefieldslate.com/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, sessions: [...state.sessions] };
}

async function expectRefused(tag: string, status: number, setup: Setup, body: Record<string, unknown>) {
  try {
    const r = await post(setup, body);
    check(tag, r.status === status, `expected ${status}, got ${r.status} (${JSON.stringify(r.json)})`);
    check(tag, r.sessions.length === 0, `expected no checkout session, got ${r.sessions.length}`);
    if (r.status === status && r.sessions.length === 0) counters.refusedNoSession++;
  } catch (err) {
    check(tag, false, `CRASH: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function expectSession(
  tag: string,
  setup: Setup,
  body: Record<string, unknown>,
  want: Record<string, unknown>,
) {
  try {
    const r = await post(setup, body);
    check(tag, r.status === 200, `expected 200, got ${r.status} (${JSON.stringify(r.json)})`);
    check(tag, r.sessions.length === 1, `expected exactly one session, got ${r.sessions.length}`);
    const s = r.sessions[0] ?? {};
    for (const [k, v] of Object.entries(want)) {
      check(tag, s[k] === v, `session.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(s[k])}`);
    }
    if (r.status === 200 && r.sessions.length === 1) counters.allowedSession++;
  } catch (err) {
    check(tag, false, `CRASH: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  // ── A: sign-in and org derivation ─────────────────────────────────────────

  // A1 signed out — refused before anything else, even with a valid body
  // naming a real, uncomped org.
  await expectRefused("A1", 401, { user: null }, { ...BASE_BODY, orgId: ORG_A });

  // A2 signed in, but no membership can be read — getCurrentOrgId falls back
  // to the user's own id, which must NOT reach Stripe.
  await expectRefused("A2", 403, { user: { id: LONER }, memberships: [] }, { ...BASE_BODY });

  // A3 a member of A naming B in the body — the old attack. Refused, no
  // session, and the session is never built for A either.
  await expectRefused(
    "A3", 409,
    { user: { id: USER }, memberships: [member(ORG_A)] },
    { ...BASE_BODY, orgId: ORG_B },
  );

  // A4 a member of A naming A — allowed, and the session is for A.
  await expectSession(
    "A4",
    { user: { id: USER }, memberships: [member(ORG_A)] },
    { ...BASE_BODY, orgId: ORG_A },
    { orgId: ORG_A, plan: "pro", quantity: 1 },
  );

  // A5 no orgId in the body — the org is derived, never required from it.
  await expectSession(
    "A5",
    { user: { id: USER }, memberships: [member(ORG_A)] },
    { ...BASE_BODY },
    { orgId: ORG_A },
  );

  // A6 a member of A and B acting under B (cookie) — the session is for B.
  await expectSession(
    "A6",
    { user: { id: USER }, memberships: [member(ORG_A), member(ORG_B, "admin")], cookieOrg: ORG_B },
    { ...BASE_BODY, orgId: ORG_B },
    { orgId: ORG_B },
  );

  // A7 the cookie names an org the user doesn't belong to — it is ignored,
  // the user acts under their own org, and a body naming the cookie org is a
  // mismatch.
  await expectRefused(
    "A7", 409,
    { user: { id: USER }, memberships: [member(ORG_A)], cookieOrg: ORG_B },
    { ...BASE_BODY, orgId: ORG_B },
  );

  // A8 the comp guard is unchanged: a member of a comped org is refused.
  await expectRefused(
    "A8", 403,
    { user: { id: USER }, memberships: [member(ORG_COMPED, "admin")], cookieOrg: ORG_COMPED },
    { ...BASE_BODY, plan: "elite", orgId: ORG_COMPED },
  );

  // ── B: the purchase must fit the org's current plan ───────────────────────
  // Every case is a signed-in member of A buying for A; only A's plan moves.
  const asA: Setup = { user: { id: USER }, memberships: [member(ORG_A)] };
  const forA = { ...BASE_BODY, orgId: ORG_A };
  const onPlan = (p: Profile["plan"]) => {
    profiles[ORG_A].plan = p;
  };

  // B1 the $100 Pro→Elite difference from Free — Elite for $100.
  onPlan("free");
  await expectRefused("B1", 400, asA, { ...forA, plan: "elite", upgradeOnly: true });

  // B2 the upgrade price from Elite — pays for nothing.
  onPlan("elite");
  await expectRefused("B2", 400, asA, { ...forA, plan: "elite", upgradeOnly: true });

  // B3 the upgrade price from Pro — the one case it exists for.
  onPlan("pro");
  await expectSession("B3", asA, { ...forA, plan: "elite", upgradeOnly: true }, {
    orgId: ORG_A, plan: "elite", upgradeOnly: true,
  });

  // B4 a Pro season on an Elite org — would set plan = 'pro'.
  onPlan("elite");
  await expectRefused("B4", 400, asA, { ...forA, plan: "pro" });

  // B5–B7 the purchases the UI does offer still go through.
  await expectSession("B5", asA, { ...forA, plan: "elite" }, { plan: "elite", upgradeOnly: false });
  onPlan("pro");
  await expectSession("B6", asA, { ...forA, plan: "pro" }, { plan: "pro", upgradeOnly: false });
  onPlan("free");
  await expectSession("B7", asA, { ...forA, plan: "elite" }, { plan: "elite", upgradeOnly: false });

  // ── C: return URLs are built on the server ────────────────────────────────
  // Expected values are LITERALS, not SITE_URL, so a change to the base URL
  // shows up here too.
  onPlan("free");
  const hostile = {
    successUrl: "https://evil.example/thanks",
    cancelUrl: "https://evil.example/cancel",
  };

  // C1 a hostile body: both URLs are ignored.
  {
    const tagSuccess = "C1a";
    const tagCancel = "C1b";
    try {
      const r = await post(asA, { plan: "pro", quantity: 1, orgId: ORG_A, returnTo: "upgraded", ...hostile });
      const s = r.sessions[0] ?? {};
      check(tagSuccess, r.status === 200 && r.sessions.length === 1, `expected one session, got ${r.status}/${r.sessions.length}`);
      check(tagSuccess, s.successUrl === "https://www.thefieldslate.com/dashboard?upgraded=true",
        `successUrl: got ${JSON.stringify(s.successUrl)}`);
      check(tagCancel, s.cancelUrl === "https://www.thefieldslate.com/dashboard",
        `cancelUrl: got ${JSON.stringify(s.cancelUrl)}`);
      if (r.sessions.length === 1) counters.allowedSession++;
    } catch (err) {
      check(tagSuccess, false, `CRASH: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // C2 returnTo "welcome" (the post-setup CTA).
  await expectSession("C2", asA, { plan: "pro", quantity: 1, orgId: ORG_A, returnTo: "welcome", ...hostile }, {
    successUrl: "https://www.thefieldslate.com/dashboard?welcome=true",
    cancelUrl: "https://www.thefieldslate.com/dashboard",
  });

  // C3 no returnTo — a tab still running the old page sends only URLs. It
  // still gets a checkout, returning to "upgraded".
  await expectSession("C3", asA, { plan: "pro", quantity: 1, orgId: ORG_A, ...hostile }, {
    successUrl: "https://www.thefieldslate.com/dashboard?upgraded=true",
  });

  // C4 source wiring (a grep — weak by nature): both callers name a returnTo
  // and send no URLs; the route never reads a URL from the body.
  {
    const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
    const callers = {
      "src/components/plan/UpgradeModal.tsx": '"upgraded"',
      "src/components/dashboard/complete-setup-cta.tsx": '"welcome"',
    };
    for (const [file, value] of Object.entries(callers)) {
      const src = read(file);
      check("C4", src.includes(`returnTo: ${value}`), `${file} does not send returnTo: ${value}`);
      check("C4", !/successUrl|cancelUrl/.test(src), `${file} still sends a return URL`);
    }
    const route = read("src/app/api/stripe/checkout/route.ts");
    check("C4", !/body\.(successUrl|cancelUrl)/.test(route), "the route reads a URL from the body");
  }

  // ── Anti-vacuity ──────────────────────────────────────────────────────────
  for (const [name, n] of Object.entries(counters)) {
    check("V", n > 0, `counter ${name} is zero — the scenario it guards never happened`);
  }

  console.log(`\n${passes} checks passed, ${failures} failed.`);
  console.log(`counters: ${JSON.stringify(counters)}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.log(`FAIL: [CRASH] ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
