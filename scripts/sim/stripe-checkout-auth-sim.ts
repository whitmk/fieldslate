// Harness for POST /api/stripe/checkout (and the signup callback that shares
// its checkout path) — who may start a checkout, for which org, for WHAT, at
// what price. Drives the REAL route handlers and the REAL
// src/lib/billing/start-checkout.ts; only the environment is faked, at the
// CJS loader (`Module._load`, the invite-page-sim technique):
//
//   @/lib/supabase/server  → a signed-in (or not) user: memberships from
//                            `state.memberships`, the leagues head count, and
//                            the two 0111 RPCs (begin_season_purchase,
//                            attach_purchase_session) recorded and answered
//   @/lib/supabase/admin   → the profiles read the comp guard makes
//   @/lib/stripe           → createCheckoutSession and verifySeasonPrice
//                            record their params; NOTHING reaches Stripe
//   @/lib/promo            → no coupon
//   next/headers           → the fs_org_id cookie from `state.cookieOrg`
//
// The fake begin_season_purchase answers like the database for the cases the
// route can affect (it picks the tier for add_season from the PLAN, never the
// request), so "the session's tier is the database's" is a real check. What
// the database itself refuses and why is proven in SQL
// (scripts/sim/season-purchase-sim.sql), not here.
//
// Every refused case asserts BOTH the status AND that zero sessions were
// created — a refusal that still built a session is the failure that matters.
//
// SECTIONS
//   A  sign-in and org derivation; the comp guard
//   B  the KIND decides the purchase, never the body's plan
//   C  return URLs built from SITE_URL, by kind; body URLs ignored
//   D  the live Stripe price check: mismatch → no session, purchase abandoned
//   E  metadata: purchaseId and quantity 1; the session id recorded
//   F  the signup callback: a paid signup is a 'signup' purchase
//
// Anti-vacuity: an allowed session, a refused attempt, and an abandoned
// purchase must each happen at least once, or the run fails.
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
  pending_plan: string | null;
  plan: "free" | "pro" | "elite";
};

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ORG_COMPED = "cccccccc-0000-4000-8000-000000000003";
const USER = ORG_A; // the user's own org id is their user id
const LONER = "dddddddd-0000-4000-8000-000000000004";

const profiles: Record<string, Profile> = {
  [ORG_A]: { id: ORG_A, comped: false, pending_promo: null, pending_plan: null, plan: "free" },
  [ORG_B]: { id: ORG_B, comped: false, pending_promo: null, pending_plan: null, plan: "free" },
  [ORG_COMPED]: { id: ORG_COMPED, comped: true, pending_promo: null, pending_plan: null, plan: "elite" },
  [LONER]: { id: LONER, comped: false, pending_promo: null, pending_plan: null, plan: "free" },
};

type Rpc = { fn: string; args: Record<string, unknown> };

const state: {
  user: { id: string } | null;
  memberships: Membership[];
  cookieOrg: string | undefined;
  activeSeasons: Record<string, number>;
  sessions: Record<string, unknown>[];
  priceChecks: { tier: string; upgradeOnly: boolean }[];
  rpcs: Rpc[];
  priceOk: boolean;
  sessionThrows: boolean;
  beginOverride: Record<string, unknown> | null;
  purchaseSeq: number;
} = {
  user: null,
  memberships: [],
  cookieOrg: undefined,
  activeSeasons: {},
  sessions: [],
  priceChecks: [],
  rpcs: [],
  priceOk: true,
  sessionThrows: false,
  beginOverride: null,
  purchaseSeq: 0,
};

// ── Fakes ───────────────────────────────────────────────────────────────────

type Filter = { col: string; op: "eq" | "in" | "is"; val: unknown };

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "organization_members") {
    return state.user ? state.memberships.map((m) => ({ ...m, user_id: state.user!.id })) : [];
  }
  if (table === "profiles") return Object.values(profiles);
  throw new Error(`fake: unexpected table ${table}`);
}

function builder(table: string) {
  const filters: Filter[] = [];
  let cols: string[] | null = null;
  let head = false;
  const run = () =>
    rowsFor(table)
      .filter((r) =>
        filters.every((f) =>
          f.op === "eq"
            ? r[f.col] === f.val
            : f.op === "is"
              ? r[f.col] === f.val
              : (f.val as unknown[]).includes(r[f.col]),
        ),
      )
      .map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : r));
  if (table === "leagues") {
    // Only the active-season head count reads leagues.
    let owner: string | null = null;
    const lb = {
      select: (_s?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), lb),
      eq: (col: string, val: unknown) => (col === "owner_id" ? (owner = String(val)) : null, lb),
      is: () => lb,
      then: (res: (v: { data: null; count: number | null; error: null }) => unknown) =>
        res({ data: null, count: head ? (state.activeSeasons[owner ?? ""] ?? 0) : null, error: null }),
    };
    return lb;
  }
  const b = {
    select: (s?: string) => {
      cols = s ? s.split(",").map((c) => c.trim()) : null;
      return b;
    },
    eq: (col: string, val: unknown) => (filters.push({ col, op: "eq", val }), b),
    in: (col: string, val: unknown[]) => (filters.push({ col, op: "in", val }), b),
    is: (col: string, val: unknown) => (filters.push({ col, op: "is", val }), b),
    order: () => b,
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: (v: { data: unknown; error: null }) => unknown) => res({ data: run(), error: null }),
  };
  return b;
}

// The database's answer for the cases the route can affect.
function fakeBegin(args: Record<string, unknown>): { data: unknown; error: unknown } {
  if (state.beginOverride) return { data: state.beginOverride, error: null };
  const org = String(args.p_org_id);
  const p = profiles[org];
  if (!state.user || !state.memberships.some((m) => m.org_id === org)) {
    return { data: null, error: { message: "not_org_member" } };
  }
  const kind = String(args.p_kind);
  const active = state.activeSeasons[org] ?? 0;
  const allowed =
    p.plan === "free" && active >= 1 ? "convert_free" : active >= 1 ? "add_season" : "first_season";
  let tier: string | null;
  if (kind === "upgrade_tier") {
    if (p.plan !== "pro") return { data: { error: "kind_not_allowed", allowed }, error: null };
    tier = "elite";
  } else if (kind === "signup") {
    if (p.plan !== "free" || active !== 0) return { data: { error: "kind_not_allowed", allowed }, error: null };
    tier = (args.p_tier as string | null) ?? null;
  } else if (kind !== allowed) {
    return { data: { error: "kind_not_allowed", allowed }, error: null };
  } else if (kind === "add_season") {
    tier = p.plan; // the league's plan, whatever the request said
  } else {
    tier = (args.p_tier as string | null) ?? null;
  }
  if (tier !== "pro" && tier !== "elite") return { data: { error: "tier_required" }, error: null };
  state.purchaseSeq++;
  return {
    data: {
      purchase_id: `11111111-0000-4000-8000-${String(state.purchaseSeq).padStart(12, "0")}`,
      kind,
      tier,
      upgrade_only: kind === "upgrade_tier",
    },
    error: null,
  };
}

function rpc(fn: string, args: Record<string, unknown>) {
  state.rpcs.push({ fn, args });
  if (fn === "begin_season_purchase") return Promise.resolve(fakeBegin(args));
  if (fn === "attach_purchase_session") return Promise.resolve({ data: { ok: true }, error: null });
  return Promise.resolve({ data: null, error: { message: `fake: unexpected rpc ${fn}` } });
}

const fakeServer = {
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: state.user }, error: null }),
    },
    from: builder,
    rpc,
  }),
};
const fakeAdmin = { createAdminClient: () => ({ from: builder }) };
const fakeStripe = {
  createCheckoutSession: async (params: Record<string, unknown>) => {
    if (state.sessionThrows) throw new Error("stripe down");
    state.sessions.push(params);
    return { url: "https://checkout.stripe.test/session", id: `cs_test_${state.sessions.length}` };
  },
  verifySeasonPrice: async (tier: string, upgradeOnly: boolean) => {
    state.priceChecks.push({ tier, upgradeOnly });
    return state.priceOk ? { ok: true } : { ok: false, reason: "price is 12900 cents, config says 24900" };
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
const counters = { allowedSession: 0, refusedNoSession: 0, abandoned: 0 };

function check(tag: string, ok: boolean, detail: string) {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL: [${tag}] ${detail}`);
  }
}

type Setup = { user: { id: string } | null; memberships?: Membership[]; cookieOrg?: string };

function member(org: string, role: "owner" | "admin" = "owner"): Membership {
  return { org_id: org, role, added_at: "2026-01-01T00:00:00Z" };
}

const SEASON = {
  name: "Spring 27",
  sport: "Baseball",
  seasonLabel: "Spring 2027",
  startDate: "2027-04-03",
  endDate: "2027-05-22",
};

type Result = {
  status: number;
  json: Record<string, unknown>;
  sessions: Record<string, unknown>[];
  rpcs: Rpc[];
  priceChecks: { tier: string; upgradeOnly: boolean }[];
};

async function post(setup: Setup, body: Record<string, unknown>): Promise<Result> {
  state.user = setup.user;
  state.memberships = setup.memberships ?? [];
  state.cookieOrg = setup.cookieOrg;
  state.sessions = [];
  state.rpcs = [];
  state.priceChecks = [];
  const { POST } = await import("@/app/api/stripe/checkout/route");
  const res = await POST(
    new Request("https://www.thefieldslate.com/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, sessions: [...state.sessions], rpcs: [...state.rpcs], priceChecks: [...state.priceChecks] };
}

const begun = (r: Result) => r.rpcs.filter((x) => x.fn === "begin_season_purchase");
const attaches = (r: Result) => r.rpcs.filter((x) => x.fn === "attach_purchase_session");

async function expectRefused(tag: string, status: number, setup: Setup, body: Record<string, unknown>, opts: { noBegin?: boolean; code?: string } = {}) {
  try {
    const r = await post(setup, body);
    check(tag, r.status === status, `expected ${status}, got ${r.status} (${JSON.stringify(r.json)})`);
    check(tag, r.sessions.length === 0, `expected no checkout session, got ${r.sessions.length}`);
    if (opts.noBegin) check(tag, begun(r).length === 0, `expected no purchase to be begun, got ${begun(r).length}`);
    if (opts.code) check(tag, r.json.code === opts.code, `expected code ${opts.code}, got ${JSON.stringify(r.json.code)}`);
    if (r.status === status && r.sessions.length === 0) counters.refusedNoSession++;
    return r;
  } catch (err) {
    check(tag, false, `CRASH: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function expectSession(tag: string, setup: Setup, body: Record<string, unknown>, want: Record<string, unknown>) {
  try {
    const r = await post(setup, body);
    check(tag, r.status === 200, `expected 200, got ${r.status} (${JSON.stringify(r.json)})`);
    check(tag, r.sessions.length === 1, `expected exactly one session, got ${r.sessions.length}`);
    const s = r.sessions[0] ?? {};
    for (const [k, v] of Object.entries(want)) {
      check(tag, s[k] === v, `session.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(s[k])}`);
    }
    if (r.status === 200 && r.sessions.length === 1) counters.allowedSession++;
    return r;
  } catch (err) {
    check(tag, false, `CRASH: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function main() {
  const asA: Setup = { user: { id: USER }, memberships: [member(ORG_A)] };
  const setPlan = (org: string, p: Profile["plan"], active: number) => {
    profiles[org].plan = p;
    state.activeSeasons[org] = active;
  };
  const ADD = { kind: "add_season", season: SEASON };

  // ── A: sign-in and org derivation ─────────────────────────────────────────
  setPlan(ORG_A, "elite", 1);
  setPlan(ORG_B, "elite", 1);
  await expectRefused("A1", 401, { user: null }, { ...ADD, orgId: ORG_A }, { noBegin: true });
  await expectRefused("A2", 403, { user: { id: LONER }, memberships: [] }, { ...ADD }, { noBegin: true });
  await expectRefused("A3", 409, asA, { ...ADD, orgId: ORG_B }, { noBegin: true });
  await expectSession("A4", asA, { ...ADD, orgId: ORG_A }, { orgId: ORG_A, quantity: 1 });
  await expectSession("A5", asA, { ...ADD }, { orgId: ORG_A });
  await expectSession(
    "A6",
    { user: { id: USER }, memberships: [member(ORG_A), member(ORG_B, "admin")], cookieOrg: ORG_B },
    { ...ADD, orgId: ORG_B },
    { orgId: ORG_B },
  );
  await expectRefused(
    "A7", 409,
    { user: { id: USER }, memberships: [member(ORG_A)], cookieOrg: ORG_B },
    { ...ADD, orgId: ORG_B },
    { noBegin: true },
  );
  // A8 the comp guard: refused before any purchase is begun, with the code
  // the screens turn into the "billing is managed" sentence + contact link.
  state.activeSeasons[ORG_COMPED] = 1;
  await expectRefused(
    "A8", 403,
    { user: { id: USER }, memberships: [member(ORG_COMPED, "admin")], cookieOrg: ORG_COMPED },
    { kind: "upgrade", tier: "elite", orgId: ORG_COMPED },
    { noBegin: true, code: "billing_managed" },
  );

  // ── B: the KIND decides the purchase ──────────────────────────────────────
  // B1 an unknown kind (or an old page's {plan, quantity} body) — refused
  // before anything is begun.
  await expectRefused("B1", 400, asA, { kind: "bogus", orgId: ORG_A }, { noBegin: true });
  await expectRefused("B1b", 400, asA, { plan: "pro", quantity: 1, orgId: ORG_A }, { noBegin: true });

  // B2 an Elite league adding a season while the body says Pro: the session
  // is Elite — the database's tier, never the request's.
  setPlan(ORG_A, "elite", 1);
  {
    const r = await expectSession("B2", asA, { ...ADD, tier: "pro", plan: "pro", orgId: ORG_A }, {
      plan: "elite",
      upgradeOnly: false,
    });
    if (r) {
      const b = begun(r)[0]?.args ?? {};
      check("B2", b.p_kind === "add_season", `begin kind: ${JSON.stringify(b.p_kind)}`);
      check("B2", b.p_name === "Spring 27" && b.p_start_date === "2027-04-03" && b.p_end_date === "2027-05-22",
        `season fields not passed: ${JSON.stringify(b)}`);
    }
  }

  // B3 "upgrade" from a Free league with its season active → convert_free.
  setPlan(ORG_A, "free", 1);
  {
    const r = await expectSession("B3", asA, { kind: "upgrade", tier: "elite", orgId: ORG_A }, { plan: "elite" });
    if (r) check("B3", begun(r)[0]?.args.p_kind === "convert_free", `begin kind: ${JSON.stringify(begun(r)[0]?.args.p_kind)}`);
  }
  // B4 "upgrade" from a Free league with nothing active → signup (a credit).
  setPlan(ORG_A, "free", 0);
  {
    const r = await expectSession("B4", asA, { kind: "upgrade", tier: "pro", orgId: ORG_A }, { plan: "pro" });
    if (r) check("B4", begun(r)[0]?.args.p_kind === "signup", `begin kind: ${JSON.stringify(begun(r)[0]?.args.p_kind)}`);
  }
  // B5 "upgrade" from Pro to Elite → the flat difference, upgradeOnly.
  setPlan(ORG_A, "pro", 1);
  {
    const r = await expectSession("B5", asA, { kind: "upgrade", tier: "elite", orgId: ORG_A }, {
      plan: "elite",
      upgradeOnly: true,
    });
    if (r) check("B5", begun(r)[0]?.args.p_kind === "upgrade_tier", `begin kind: ${JSON.stringify(begun(r)[0]?.args.p_kind)}`);
  }
  // B6 "upgrade" on an Elite league — nothing to buy, nothing begun.
  setPlan(ORG_A, "elite", 1);
  await expectRefused("B6", 409, asA, { kind: "upgrade", tier: "elite", orgId: ORG_A }, { noBegin: true });
  // B7 the database refuses (first_season while a season is active) — the
  // refusal is passed on as 409, no session.
  await expectRefused("B7", 409, asA, { kind: "first_season", tier: "pro", season: SEASON, orgId: ORG_A }, { code: "kind_not_allowed" });
  // B8 a season purchase without its dates — refused before begin.
  await expectRefused("B8", 400, asA, { kind: "add_season", season: { ...SEASON, endDate: "" }, orgId: ORG_A }, { noBegin: true });
  // B9 the database says billing_managed (a comp flag the route didn't see).
  state.beginOverride = { error: "billing_managed" };
  await expectRefused("B9", 403, asA, { ...ADD, orgId: ORG_A }, { code: "billing_managed" });
  state.beginOverride = null;

  // ── C: return URLs are built on the server, by kind ───────────────────────
  // Expected values are LITERALS, not SITE_URL.
  const hostile = { successUrl: "https://evil.example/thanks", cancelUrl: "https://evil.example/cancel", returnTo: "welcome" };
  setPlan(ORG_A, "elite", 1);
  {
    const r = await expectSession("C1", asA, { ...ADD, orgId: ORG_A, ...hostile }, {});
    const s = r?.sessions[0] ?? {};
    const pid = (r?.json.purchaseId as string) ?? "?";
    check("C1", s.successUrl === `https://www.thefieldslate.com/dashboard/purchases/${pid}`,
      `successUrl: got ${JSON.stringify(s.successUrl)}`);
    check("C1", s.cancelUrl === "https://www.thefieldslate.com/dashboard/leagues/new",
      `cancelUrl: got ${JSON.stringify(s.cancelUrl)}`);
  }
  setPlan(ORG_A, "pro", 1);
  await expectSession("C2", asA, { kind: "upgrade", tier: "elite", orgId: ORG_A, ...hostile }, {
    successUrl: "https://www.thefieldslate.com/dashboard?upgraded=true",
    cancelUrl: "https://www.thefieldslate.com/dashboard",
  });
  setPlan(ORG_A, "free", 0);
  await expectSession("C3", asA, { kind: "upgrade", tier: "pro", orgId: ORG_A, ...hostile }, {
    successUrl: "https://www.thefieldslate.com/dashboard?welcome=true",
  });
  // C4 source wiring (grep — weak by nature): no caller sends a URL, and the
  // route never reads one from the body.
  {
    const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
    for (const file of [
      "src/components/plan/UpgradeModal.tsx",
      "src/components/dashboard/complete-setup-cta.tsx",
      "src/components/seasons/new-season-flow.tsx",
    ]) {
      const src = read(file);
      check("C4", !/successUrl|cancelUrl/.test(src), `${file} sends a return URL`);
      check("C4", !/\bquantity\s*:/.test(src), `${file} sends a quantity`);
    }
    const route = read("src/app/api/stripe/checkout/route.ts");
    check("C4", !/body\.(successUrl|cancelUrl|plan|quantity|upgradeOnly)/.test(route),
      "the route reads a URL, plan, quantity or upgradeOnly from the body");
  }

  // ── D: the live Stripe price must match the config ────────────────────────
  setPlan(ORG_A, "elite", 1);
  state.priceOk = false;
  {
    const r = await expectRefused("D1", 503, asA, { ...ADD, orgId: ORG_A }, { code: "price_unavailable" });
    if (r) {
      const a = attaches(r);
      check("D1b", a.length === 1 && a[0].args.p_session_id === null,
        `the purchase was not abandoned: ${JSON.stringify(a.map((x) => x.args))}`);
      if (a.length === 1 && a[0].args.p_session_id === null) counters.abandoned++;
    }
  }
  state.priceOk = true;
  {
    setPlan(ORG_A, "pro", 1);
    const r = await post(asA, { kind: "upgrade", tier: "elite", orgId: ORG_A });
    check("D2", r.priceChecks.length === 1 && r.priceChecks[0].tier === "elite" && r.priceChecks[0].upgradeOnly === true,
      `price checked as ${JSON.stringify(r.priceChecks)} for the Pro → Elite upgrade`);
    setPlan(ORG_A, "elite", 1);
    const r2 = await post(asA, { ...ADD, tier: "pro", orgId: ORG_A });
    check("D2", r2.priceChecks.length === 1 && r2.priceChecks[0].tier === "elite" && r2.priceChecks[0].upgradeOnly === false,
      `price checked as ${JSON.stringify(r2.priceChecks)} for an Elite season`);
  }
  // D3 Stripe fails to open a session — 500, purchase abandoned.
  state.sessionThrows = true;
  {
    const r = await expectRefused("D3", 500, asA, { ...ADD, orgId: ORG_A });
    if (r) {
      const a = attaches(r);
      check("D3", a.length === 1 && a[0].args.p_session_id === null, `not abandoned: ${JSON.stringify(a.map((x) => x.args))}`);
      if (a.length === 1 && a[0].args.p_session_id === null) counters.abandoned++;
    }
  }
  state.sessionThrows = false;

  // ── E: metadata and the recorded session ──────────────────────────────────
  {
    const r = await post(asA, { ...ADD, orgId: ORG_A });
    const s = r.sessions[0] ?? {};
    const pid = r.json.purchaseId;
    check("E1", typeof pid === "string" && s.purchaseId === pid,
      `session purchaseId ${JSON.stringify(s.purchaseId)} vs reply ${JSON.stringify(pid)}`);
    check("E1", s.quantity === 1, `quantity ${JSON.stringify(s.quantity)}`);
    const a = attaches(r);
    check("E2", a.length === 1 && a[0].args.p_purchase_id === pid && a[0].args.p_session_id === "cs_test_1",
      `session id not recorded: ${JSON.stringify(a.map((x) => x.args))}`);
  }

  // ── F: the signup callback ────────────────────────────────────────────────
  {
    setPlan(ORG_A, "free", 0);
    profiles[ORG_A].pending_plan = "elite";
    state.user = { id: USER };
    state.memberships = [member(ORG_A)];
    state.sessions = [];
    state.rpcs = [];
    try {
      const { GET } = await import("@/app/api/auth/callback/route");
      const res = await GET(new Request("https://www.thefieldslate.com/api/auth/callback?code=abc"));
      const b = state.rpcs.find((x) => x.fn === "begin_season_purchase")?.args ?? {};
      check("F1", b.p_kind === "signup" && b.p_tier === "elite", `callback began ${JSON.stringify(b)}`);
      check("F1", res.headers.get("location") === "https://checkout.stripe.test/session",
        `callback redirected to ${res.headers.get("location")}`);
      const s = state.sessions[0] ?? {};
      check("F2", s.successUrl === "https://www.thefieldslate.com/dashboard?welcome=true",
        `callback successUrl ${JSON.stringify(s.successUrl)}`);
    } catch (err) {
      check("F1", false, `CRASH: ${err instanceof Error ? err.message : String(err)}`);
    }
    profiles[ORG_A].pending_plan = null;
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
