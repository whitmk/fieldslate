// Harness for POST /api/stripe/webhook — the first one this route has had.
// Drives the REAL route; only the environment is faked at the CJS loader:
//
//   @/lib/stripe          → getStripe().webhooks.constructEvent parses the
//                           raw body (signature "valid" unless state says no)
//   @/lib/supabase/admin  → the profiles read (comp guard + league name) and
//                           process_checkout_event, recorded and answered
//                           from `state.rpcReply`
//   @/lib/email           → sendEmail recorded; can be made to fail or throw
//
// What it proves: the purchase id reaches the database exactly as the
// session carried it (a malformed one becomes the nil uuid, never the legacy
// path); quantity is passed as sent; a payment the database FLAGS is emailed
// to hello@ at once with the league, what was bought, the amount and why;
// nothing else is emailed; a failed or throwing send still acks 200 (the
// event is claimed — a redelivery would be skipped and send nothing); comped
// leagues and non-checkout events never reach the database.
//
// Mutants: npm run sim:stripe-webhook:mutants.
import Module from "node:module";

type Rpc = { fn: string; args: Record<string, unknown> };
type Mail = { to: string; subject: string; html: string; text?: string };

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const COMPED = "cccccccc-0000-4000-8000-000000000003";
const PURCHASE = "11111111-0000-4000-8000-000000000001";

const profiles: Record<string, { comped: boolean; org_name: string | null; email: string | null }> = {
  [ORG]: { comped: false, org_name: "Riverside Little League", email: "admin@riverside.test" },
  [COMPED]: { comped: true, org_name: "Comped League", email: "c@example.test" },
};

const state: {
  rpcs: Rpc[];
  mails: Mail[];
  rpcReply: Record<string, unknown>;
  mailFails: "no" | "error" | "throw";
} = { rpcs: [], mails: [], rpcReply: { result: "processed", outcome: "season_created" }, mailFails: "no" };

const fakeStripe = {
  getStripe: () => ({
    webhooks: {
      constructEvent: (raw: string, sig: string) => {
        if (sig !== "good") throw new Error("bad signature");
        return JSON.parse(raw);
      },
    },
  }),
};
const fakeAdmin = {
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`fake: unexpected table ${table}`);
      let id = "";
      const b = {
        select: () => b,
        eq: (_c: string, v: string) => ((id = v), b),
        maybeSingle: async () => ({ data: profiles[id] ?? null, error: null }),
      };
      return b;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      return { data: state.rpcReply, error: null };
    },
  }),
};
const fakeEmail = {
  sendEmail: async (to: string, subject: string, html: string, text?: string) => {
    if (state.mailFails === "throw") throw new Error("resend exploded");
    state.mails.push({ to, subject, html, text });
    return state.mailFails === "error" ? { ok: false, status: 500, error: "resend down" } : { ok: true, id: "m1" };
  },
};

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (request === "@/lib/stripe") return fakeStripe;
  if (request === "@/lib/supabase/admin") return fakeAdmin;
  if (request === "@/lib/email") return fakeEmail;
  return origLoad.call(this, request, parent, isMain);
};

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

let failures = 0;
let passes = 0;
const counters = { flaggedEmailed: 0, unflaggedSilent: 0, failedSendStill200: 0 };

function check(tag: string, ok: boolean, detail: string) {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL: [${tag}] ${detail}`);
  }
}

function event(meta: Record<string, string>, opts: { type?: string; amount?: number | null; id?: string } = {}) {
  return {
    id: opts.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: opts.type ?? "checkout.session.completed",
    data: {
      object: {
        id: "cs_live_123",
        amount_total: opts.amount === undefined ? 34900 : opts.amount,
        currency: "usd",
        metadata: meta,
      },
    },
  };
}

async function deliver(ev: unknown, sig = "good") {
  state.rpcs = [];
  state.mails = [];
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const res = await POST(
    new Request("https://www.thefieldslate.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": sig },
      body: JSON.stringify(ev),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, rpcs: [...state.rpcs], mails: [...state.mails] };
}

const META = { orgId: ORG, plan: "elite", quantity: "1", upgradeOnly: "false", purchaseId: PURCHASE };
const argsOf = (r: { rpcs: Rpc[] }) => r.rpcs.find((x) => x.fn === "process_checkout_event")?.args ?? {};

async function main() {
  // ── W1–W4: what reaches the database ──────────────────────────────────────
  state.rpcReply = { result: "processed", outcome: "season_created", needs_review: false };
  {
    const r = await deliver(event(META));
    check("W1", r.status === 200, `status ${r.status}`);
    check("W1", argsOf(r).p_purchase_id === PURCHASE, `p_purchase_id ${JSON.stringify(argsOf(r).p_purchase_id)}`);
    check("W1", argsOf(r).p_plan === "elite" && argsOf(r).p_org_id === ORG, `args ${JSON.stringify(argsOf(r))}`);
  }
  {
    const { purchaseId: _omit, ...legacy } = META;
    void _omit;
    const r = await deliver(event(legacy));
    check("W2", argsOf(r).p_purchase_id === null, `no purchaseId → ${JSON.stringify(argsOf(r).p_purchase_id)}`);
  }
  {
    const r = await deliver(event({ ...META, purchaseId: "not-a-uuid" }));
    check("W3", argsOf(r).p_purchase_id === "00000000-0000-0000-0000-000000000000",
      `malformed purchaseId → ${JSON.stringify(argsOf(r).p_purchase_id)}`);
  }
  {
    const r1 = await deliver(event({ ...META, quantity: "1" }));
    const r2 = await deliver(event({ ...META, quantity: "2" }));
    const r3 = await deliver(event({ ...META, quantity: "3" }));
    check("W4", argsOf(r1).p_quantity === 1 && argsOf(r2).p_quantity === 2 && argsOf(r3).p_quantity === 3,
      `quantity not passed as sent: ${argsOf(r1).p_quantity}/${argsOf(r2).p_quantity}/${argsOf(r3).p_quantity}`);
  }

  // ── W5: a flagged payment is emailed at once ──────────────────────────────
  state.rpcReply = {
    result: "processed",
    outcome: "credited",
    purchase_id: "22222222-0000-4000-8000-000000000002",
    kind: "unmatched",
    needs_review: true,
    review_reason: "purchase_not_pending:completed",
  };
  {
    const r = await deliver(event(META, { id: "evt_flag_1" }));
    check("W5", r.status === 200, `status ${r.status}`);
    check("W5", r.mails.length === 1, `expected one email, got ${r.mails.length}`);
    const m = r.mails[0] ?? { to: "", subject: "", html: "", text: "" };
    const t = m.text ?? "";
    check("W5", m.to === "hello@thefieldslate.com", `to ${m.to}`);
    check("W5", m.subject === "Payment needs review — Riverside Little League — $349.00", `subject ${m.subject}`);
    for (const want of [
      "League: Riverside Little League (aaaaaaaa-0000-4000-8000-000000000001)",
      "What was bought: Payment with no matching purchase",
      "Amount: $349.00",
      "Why it was flagged: The purchase was already completed — this looks like a second payment for it.",
      "What happened: The payment was kept as a season credit. Nothing else changed.",
      "Purchase: 22222222-0000-4000-8000-000000000002",
      "Stripe checkout session: cs_live_123",
      "Stripe event: evt_flag_1",
    ]) {
      check("W5", t.includes(want), `email text missing "${want}"`);
    }
    if (r.mails.length === 1 && m.to === "hello@thefieldslate.com") counters.flaggedEmailed++;
  }
  // W5b the league name falls back to the account email.
  profiles[ORG].org_name = null;
  {
    const r = await deliver(event(META));
    check("W5b", (r.mails[0]?.text ?? "").includes("League: admin@riverside.test"), `fallback name: ${r.mails[0]?.text}`);
  }
  profiles[ORG].org_name = "Riverside Little League";

  // ── W6: nothing else is emailed ───────────────────────────────────────────
  for (const reply of [
    { result: "processed", outcome: "season_created", needs_review: false },
    { result: "processed", outcome: "legacy" },
    { result: "skipped_duplicate" },
  ]) {
    state.rpcReply = reply;
    const r = await deliver(event(META));
    check("W6", r.status === 200 && r.mails.length === 0, `${JSON.stringify(reply)} → ${r.status}, ${r.mails.length} email(s)`);
    if (r.mails.length === 0) counters.unflaggedSilent++;
  }

  // ── W7: a failed or throwing send still acks 200 ──────────────────────────
  state.rpcReply = { result: "processed", outcome: "flagged", kind: "upgrade_tier", needs_review: true, review_reason: "not_on_pro:free" };
  for (const mode of ["error", "throw"] as const) {
    state.mailFails = mode;
    try {
      const r = await deliver(event(META));
      check("W7", r.status === 200, `send ${mode} → status ${r.status}`);
      if (r.status === 200) counters.failedSendStill200++;
    } catch (err) {
      check("W7", false, `send ${mode} → CRASH ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  state.mailFails = "no";

  // ── W8–W10: refused or ignored before the database ────────────────────────
  {
    const r = await deliver(event({ ...META, orgId: COMPED }));
    check("W8", r.status === 200 && r.rpcs.length === 0 && r.mails.length === 0,
      `comped → ${r.status}, ${r.rpcs.length} rpc, ${r.mails.length} mail`);
  }
  {
    const r = await deliver(event(META, { type: "charge.refunded" }));
    check("W9", r.status === 200 && r.rpcs.length === 0, `other event → ${r.status}, ${r.rpcs.length} rpc`);
  }
  {
    const r = await deliver(event(META), "forged");
    check("W10", r.status === 400 && r.rpcs.length === 0, `bad signature → ${r.status}, ${r.rpcs.length} rpc`);
  }

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
