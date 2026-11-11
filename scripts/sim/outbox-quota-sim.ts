// sim:outbox-quota — the Resend quota fix (0128, 2026-11-10). Drives the REAL
// src/lib/outbound-email/outbox-drain.ts (sendOutcome, holdUntil, the drain),
// src/lib/email.ts (resendFailure), src/lib/outbound-email/problems.ts and
// the two feature specs; the database and Resend are fakes that record what
// they were asked.
//
//   O  what a failed send means: Resend's error NAME first (daily / monthly
//      quota, rate limit), then its own status; a 4xx is final, a 5xx or an
//      unknown status is retried; resendFailure keeps `status` 500 (what our
//      routes return) and carries the name and Resend's status alongside
//   H  when a held row is due again: next 00:00 UTC / +6 hours / now
//   D  the drain: a quota stop HOLDS this row and every row still waiting in
//      the run (hold, never finish — no attempt used), sends nothing more and
//      stops; a rate limit the same; a permanent 4xx is final and the run goes
//      on; a 5xx is retried; a failed hold is counted and logged; beforeTake
//      runs once before the take, and its failure doesn't stop the run
//   R  wiring: each runner's hold calls its own function; only the volunteer
//      runner drops started-game notices (source greps — weak by nature)
//   W  the banner's words: summary, waiting time in the league's timezone,
//      monthly wording, trigger failures, the pointer, reasons in words,
//      unreadable replies are null, each feature's description, ack args
//   F  the fence: no public page or public API route reaches the banner, its
//      words, the loader or a feature's problems functions — through any
//      import chain; the migration grants the problems functions to
//      authenticated only; the banner renders only on the admin pages
//
// MUTATION LOG (npm run sim:outbox-quota:mutants, 12 mutants × 3 zones):
//   2026-11-10 run 1 — 12/12 killed at their own tag; source restored green.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import {
  drainOutbox,
  holdUntil,
  sendOutcome,
  type BaseOutboxRow,
  type DrainDeps,
  type SendResult,
} from "../../src/lib/outbound-email/outbox-drain";
import { resendFailure } from "../../src/lib/email";
import {
  PROBLEMS_UNREADABLE,
  ackArgs,
  parseProblems,
  problemsReadIsOff,
  problemsView,
  volunteerPointerLine,
  whyLine,
} from "../../src/lib/outbound-email/problems";
import { VOLUNTEER_PROBLEMS } from "../../src/lib/volunteers/email-problems";
import { OFFICIAL_PROBLEMS } from "../../src/lib/officials-signup/email-problems";

const ROOT = join(__dirname, "../..");
const failures: string[] = [];
let checks = 0;
const counters = { quotaHeld: 0, rateHeld: 0, finalNotRetried: 0, retried: 0, publicFilesWalked: 0 };

function ok(cond: boolean, tag: string, msg: string, detail?: string) {
  checks++;
  if (!cond) failures.push(`FAIL: [${tag}] ${msg}${detail ? `\n      ${detail}` : ""}`);
}
function eq(actual: unknown, expected: unknown, tag: string, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, tag, msg, `expected ${e}\n      got      ${a}`);
}
async function section(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    failures.push(`FAIL: [CRASH-${name}] ${(e as Error).stack ?? e}`);
  }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const NOW = new Date("2026-11-10T18:00:00Z");
const NEXT_MIDNIGHT = "2026-11-11T00:00:00.000Z";

type Row = BaseOutboxRow;
function fake(rows: Row[], plan: Record<number, SendResult | "throw">, opts: { holdFails?: boolean; before?: DrainDeps<Row>["beforeTake"] } = {}) {
  const sends: number[] = [];
  const finishes: { id: number; ok: boolean; retry: boolean; error: string | null }[] = [];
  const holds: { id: number; until: string; reason: string }[] = [];
  const logs: string[] = [];
  const order: string[] = [];
  const deps: DrainDeps<Row> = {
    label: "test-outbox",
    envFrom: "FieldSlate <hello@thefieldslate.com>",
    take: async () => {
      order.push("take");
      return { ok: true, rows };
    },
    parse: (raw) => ({ rows: raw as Row[], dropped: 0 }),
    finish: async (a) => {
      finishes.push({ id: a.id, ok: a.ok, retry: a.retry, error: a.error });
      return { ok: true };
    },
    hold: async (a) => {
      holds.push(a);
      return opts.holdFails ? { ok: false, error: "db down" } : { ok: true };
    },
    beforeTake: opts.before
      ? async () => {
          order.push("before");
          return opts.before!();
        }
      : undefined,
    now: () => NOW,
    send: async (m) => {
      const id = Number(m.idempotencyKey.split("-").pop());
      sends.push(id);
      const p = plan[id] ?? { ok: true, id: `re_${id}` };
      if (p === "throw") throw new Error("network");
      return p;
    },
    render: () => ({ subject: "S", html: "<p>x</p>", text: "x" }),
    sleep: async () => {},
    log: (m) => logs.push(m),
  };
  return { deps, sends, finishes, holds, logs, order };
}
const row = (id: number): Row => ({
  id, kind: "reminder", payload: {}, attempts: 1, to: `v${id}@example.org`, leagueName: "Majors LL", replyTo: "board@example.org",
});
type Fail = Extract<SendResult, { ok: false }>;
const quotaDaily: Fail = { ok: false, status: 500, error: "You have reached your daily email sending quota.", name: "daily_quota_exceeded", providerStatus: 429 };
const quotaMonthly: Fail = { ok: false, status: 500, error: "monthly quota", name: "monthly_quota_exceeded", providerStatus: 429 };
const rateLimit: Fail = { ok: false, status: 500, error: "Too many requests", name: "rate_limit_exceeded", providerStatus: 429 };
const invalid: Fail = { ok: false, status: 500, error: "Invalid `to` field", name: "validation_error", providerStatus: 422 };
const outage: Fail = { ok: false, status: 500, error: "Internal server error", name: "internal_server_error", providerStatus: 500 };

async function main() {
  // ── O — what a failed send means ───────────────────────────────────────
  await section("O", () => {
    eq(sendOutcome(quotaDaily), "quota_daily", "O1", "daily quota by name (even though its status is 429)");
    eq(sendOutcome(quotaMonthly), "quota_monthly", "O1", "monthly quota by name");
    eq(sendOutcome(rateLimit), "rate_limited", "O2", "rate limit by name");
    eq(sendOutcome({ status: 500, providerStatus: 429 }), "rate_limited", "O2", "a bare 429 is a rate limit");
    eq(sendOutcome(invalid), "fail", "O3", "a 422 is final, though `status` is 500");
    eq(sendOutcome({ status: 500, name: "not_found", providerStatus: 404 }), "fail", "O3", "a 404 is final");
    eq(sendOutcome({ status: 403 }), "fail", "O3", "a 403 with no provider status is final");
    eq(sendOutcome(outage), "retry", "O4", "a provider 500 is retried");
    eq(sendOutcome({ status: 500, providerStatus: null }), "retry", "O4", "no provider status (network) is retried");
    eq(sendOutcome({ status: 503 }), "retry", "O4", "a 503 is retried");

    const f = resendFailure({ message: "You have reached your daily email sending quota.", name: "daily_quota_exceeded", statusCode: 429 });
    eq([f.ok, f.status, f.name, f.providerStatus], [false, 500, "daily_quota_exceeded", 429], "O5",
      "resendFailure keeps status 500 and carries Resend's name and status");
    const g = resendFailure({ message: "x", name: "application_error", statusCode: null });
    eq([g.status, g.name, g.providerStatus], [500, "application_error", null], "O5", "a null statusCode stays null");
    const h = resendFailure("garbage");
    eq([h.status, h.error, h.name, h.providerStatus], [500, "Failed to send email.", null, null], "O5", "an unreadable error");
  });

  // ── H — when a held row is due ─────────────────────────────────────────
  await section("H", () => {
    eq(holdUntil("quota_daily", NOW), NEXT_MIDNIGHT, "H1", "daily → the next 00:00 UTC");
    eq(holdUntil("quota_daily", new Date("2026-11-10T23:59:59Z")), NEXT_MIDNIGHT, "H1", "one second before midnight");
    eq(holdUntil("quota_daily", new Date("2026-11-11T00:00:00Z")), "2026-11-12T00:00:00.000Z", "H1", "at midnight → the next one");
    eq(holdUntil("quota_daily", new Date("2026-12-31T20:00:00Z")), "2027-01-01T00:00:00.000Z", "H1", "across New Year");
    eq(holdUntil("quota_monthly", NOW), "2026-11-11T00:00:00.000Z", "H2", "monthly → six hours");
    eq(holdUntil("rate_limited", NOW), NOW.toISOString(), "H3", "rate limit → now (the next run)");
  });

  // ── D — the drain ──────────────────────────────────────────────────────
  await section("D", async () => {
    // QD1 — a daily quota stop on row 2 of 4.
    {
      const f = fake([row(1), row(2), row(3), row(4)], { 2: quotaDaily });
      const s = await drainOutbox(f.deps);
      eq(f.sends, [1, 2], "QD1", "nothing is sent after the quota stop");
      eq(f.finishes.map((x) => x.id), [1], "QD1", "only the sent row is finished — the held rows use no attempt");
      eq(f.holds.map((x) => [x.id, x.reason, x.until]),
        [[2, "quota_daily", NEXT_MIDNIGHT], [3, "quota_daily", NEXT_MIDNIGHT], [4, "quota_daily", NEXT_MIDNIGHT]], "QD1",
        "the refused row and every row still waiting are held until the next UTC midnight");
      eq([s.sent, s.held, s.stopped, s.retrying, s.failed], [1, 3, "quota_daily", 0, 0], "QD1", "summary");
      counters.quotaHeld += s.held;
    }
    // QD2 — monthly: held 6 hours.
    {
      const f = fake([row(1), row(2)], { 1: quotaMonthly });
      const s = await drainOutbox(f.deps);
      eq(f.holds.map((x) => [x.id, x.reason, x.until]),
        [[1, "quota_monthly", "2026-11-11T00:00:00.000Z"], [2, "quota_monthly", "2026-11-11T00:00:00.000Z"]], "QD2",
        "monthly quota holds every row for six hours");
      eq([f.sends, f.finishes.length, s.stopped], [[1], 0, "quota_monthly"], "QD2", "no finish, no further send");
    }
    // QD3 — a rate limit: held until now (the next run), no attempt used.
    {
      const f = fake([row(1), row(2)], { 1: rateLimit });
      const s = await drainOutbox(f.deps);
      eq(f.holds.map((x) => [x.id, x.reason]), [[1, "rate_limited"], [2, "rate_limited"]], "QD3", "rate limit holds, never finishes");
      eq([f.finishes.length, s.stopped], [0, "rate_limited"], "QD3", "no attempt used");
      counters.rateHeld += s.held;
    }
    // QD4 — a permanent 4xx is final, not retried, and the run goes on.
    {
      const f = fake([row(1), row(2)], { 1: invalid });
      const s = await drainOutbox(f.deps);
      eq(f.finishes.map((x) => [x.id, x.ok, x.retry]), [[1, false, false], [2, true, false]], "QD4",
        "a 422 is final (never retried) and the next row is still sent");
      eq([s.failed, s.retrying, s.held], [1, 0, 0], "QD4", "summary");
      counters.finalNotRetried += s.failed;
    }
    // QD5 — a provider 5xx and a thrown send are retried.
    {
      const f = fake([row(1), row(2)], { 1: outage, 2: "throw" });
      const s = await drainOutbox(f.deps);
      eq(f.finishes.map((x) => [x.id, x.retry]), [[1, true], [2, true]], "QD5", "5xx and a thrown send are retried");
      counters.retried += s.retrying;
    }
    // QD6 — a hold that fails is counted and logged.
    {
      const f = fake([row(1)], { 1: quotaDaily }, { holdFails: true });
      const s = await drainOutbox(f.deps);
      eq(s.finishErrors, 1, "QD6", "the failed hold is counted");
      ok(f.logs.some((l) => l.includes("holding it failed")), "QD6", "and logged", f.logs.join(" | "));
    }
    // QD7 — beforeTake runs once, before the take; a failure doesn't stop it.
    {
      const f = fake([row(1)], {}, { before: async () => ({ ok: true, dropped: 2 }) });
      const s = await drainOutbox(f.deps);
      eq([f.order, s.droppedStarted], [["before", "take"], 2], "QD7", "beforeTake runs first, its count is reported");
      const g = fake([row(1)], {}, { before: async () => ({ ok: false, error: "boom for v@example.org" }) });
      const t = await drainOutbox(g.deps);
      eq([g.sends, t.sent], [[1], 1], "QD7", "a failed beforeTake still sends");
      ok(g.logs.some((l) => l.includes("dropping started-game notices failed") && !l.includes("v@example.org")), "QD7",
        "the failure is logged, scrubbed", g.logs.join(" | "));
    }
  });

  // ── R — wiring ─────────────────────────────────────────────────────────
  await section("R", () => {
    const v = read("src/lib/volunteers/drain-runner.ts");
    const o = read("src/lib/officials-signup/drain-runner.ts");
    ok(/hold: async[\s\S]*?"volunteer_outbox_hold"/.test(v), "R1", "the volunteer runner holds through volunteer_outbox_hold");
    ok(/hold: async[\s\S]*?"official_outbox_hold"/.test(o), "R1", "the officials runner holds through official_outbox_hold");
    ok(/beforeTake: async[\s\S]*?"volunteer_outbox_drop_started"/.test(v), "R2", "the volunteer runner drops started-game notices");
    ok(!o.includes("beforeTake"), "R2", "the officials runner has no started-game drop (none of its kinds are about a game time)");
    const d = read("src/lib/outbound-email/outbox-drain.ts");
    ok(!/shouldRetry/.test(d), "R3", "the drain decides only with sendOutcome");
    const e = read("src/lib/email.ts");
    ok(e.includes("return resendFailure(res.error);"), "R4", "sendEmail reports Resend errors through resendFailure");
  });

  // ── W — the banner's words ─────────────────────────────────────────────
  await section("W", () => {
    const raw = {
      timezone: "America/Los_Angeles",
      failed: [
        { id: 11, kind: "rained_out", error: "bad_recipient", first_initial: "j", last_name: "Smith",
          spot: { kind: "game", start: "2026-10-17T09:00", role_name: "Scorekeeper", home_team_name: "Expos", away_team_name: "Mets" } },
        { id: 12, kind: "shift_changed", error: "Resend said no for x@y.org", first_initial: "K", last_name: "Lee",
          spot: { kind: "shift", start: "2026-10-18T11:30" } },
      ],
      waiting: { count: 4, reason: "quota_daily", until: NEXT_MIDNIGHT },
      trigger_failures: 1,
    };
    const p = parseProblems(raw, "volunteers", VOLUNTEER_PROBLEMS.describe);
    ok(p !== null, "W1", "a good reply parses");
    const v = p ? problemsView(p, "volunteers") : null;
    eq(v?.summary,
      "2 emails didn't go out. 4 emails are waiting for the daily email limit to reset at 4:00 PM. 1 schedule change couldn't be checked for volunteer emails.",
      "W1", "summary, waiting time in the league's timezone");
    eq(v?.items, [
      { id: 11, line: "J. Smith — Rained out · Scorekeeper · Expos vs Mets · Sat, Oct 17", why: "No usable email address" },
      { id: 12, line: "K. Lee — Shift hours changed · Snack shack · Sun, Oct 18", why: "Couldn't be sent" },
    ], "W2", "each row: who, what, why (a provider message is never shown)");
    eq(v ? ackArgs("volunteers", "s1", v) : null, { p_season_id: "s1", p_ids: [11, 12], p_trigger_failures: true }, "W3", "volunteer ack args");
    eq(p ? volunteerPointerLine(p) : null, "2 volunteer emails didn't go out — see Who signed up.", "W4", "the pointer");

    const one = parseProblems({ timezone: "America/New_York", failed: [], waiting: { count: 1, reason: "quota_monthly", until: "2026-11-11T00:00:00Z" }, trigger_failures: 0 }, "volunteers", VOLUNTEER_PROBLEMS.describe);
    eq(one ? problemsView(one, "volunteers")?.summary : null,
      "1 email is waiting: the monthly email limit was reached. FieldSlate will try again at 7:00 PM.", "W5", "monthly wording, New York time");
    eq(one ? volunteerPointerLine(one) : null, "1 volunteer email is waiting for the email limit — see Who signed up.", "W4", "waiting pointer");
    const none = parseProblems({ timezone: "America/Los_Angeles", failed: [], waiting: { count: 0, reason: null, until: null }, trigger_failures: 0 }, "volunteers", VOLUNTEER_PROBLEMS.describe);
    eq([none ? problemsView(none, "volunteers") : "x", none ? volunteerPointerLine(none) : "x"], [null, null], "W6", "nothing to show → no banner");

    eq(parseProblems({ failed: "nope", waiting: { count: 0 } }, "volunteers", VOLUNTEER_PROBLEMS.describe), null, "W7", "unreadable → null");
    eq(parseProblems({ failed: [], waiting: {} }, "officials", OFFICIAL_PROBLEMS.describe), null, "W7", "no waiting count → null");
    eq(parseProblems({ failed: [], waiting: { count: 0 } }, "volunteers", VOLUNTEER_PROBLEMS.describe), null, "W7",
      "volunteers without a trigger-failure count → null");
    eq(PROBLEMS_UNREADABLE, "Couldn't check for email problems.", "W7", "the unreadable sentence");

    const op = parseProblems({
      timezone: "America/Chicago",
      failed: [
        { id: 3, kind: "claim_confirmed", error: "bad_recipient", official_name: "Sam R.", to_contact: false,
          game: { division: "Majors", home: "Expos", away: "Mets", start: "2026-10-17T13:00" } },
        { id: 4, kind: "claims_digest", error: null, official_name: null, to_contact: true, game: null },
      ],
      waiting: { count: 0, reason: null, until: null },
      trigger_failures: 0,
    }, "officials", OFFICIAL_PROBLEMS.describe);
    const ov = op ? problemsView(op, "officials") : null;
    eq(ov?.items.map((i) => i.line), [
      "Sam R. — Sign-up confirmation · Majors · Expos vs Mets · Sat, Oct 17",
      "Your officials contact — Daily sign-ups summary",
    ], "W8", "officials rows");
    eq(ov ? ackArgs("officials", "s2", ov) : null, { p_season_id: "s2", p_ids: [3, 4] }, "W8", "officials ack args");
    eq([whyLine("no_contact_email"), whyLine("feature_off"), whyLine("bad_reply_to"), whyLine("unknown_kind"), whyLine(null)],
      ["No confirmed contact email", "Sign-ups were switched off", "The contact email couldn't be used", "Couldn't be written", "Couldn't be sent"],
      "W9", "reasons in words");
    eq([problemsReadIsOff("P0001: feature_off"), problemsReadIsOff("permission denied"), problemsReadIsOff(null)], [true, false, false],
      "W10", "only feature_off means no banner");
  });

  // ── F — the fence ──────────────────────────────────────────────────────
  await section("F", () => {
    const PUBLIC_DIRS = [
      "src/app/v", "src/app/o", "src/app/s", "src/app/api/volunteers", "src/app/api/officials",
      "src/app/(marketing)", "src/app/confirm-email", "src/app/invite", "src/app/schedule", "src/app/reschedule",
      "src/app/calendar", "src/app/api/invite", "src/app/api/schedule", "src/app/api/reschedule", "src/app/api/contact-verify",
    ];
    const BANNED = [
      "src/lib/outbound-email/problems.ts",
      "src/lib/outbound-email/problems-read.ts",
      "src/lib/volunteers/email-problems.ts",
      "src/lib/officials-signup/email-problems.ts",
      "src/components/email-problems/email-problems-banner.tsx",
    ];
    const files: string[] = [];
    const walk = (d: string) => {
      const abs = join(ROOT, d);
      if (!existsSync(abs)) return;
      for (const n of readdirSync(abs)) {
        const p = join(d, n);
        if (statSync(join(ROOT, p)).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) files.push(p);
      }
    };
    PUBLIC_DIRS.forEach(walk);
    const resolve = (from: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith("@/")) base = join("src", spec.slice(2));
      else if (spec.startsWith(".")) base = join(dirname(from), spec);
      else return null;
      for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const c = base + ext;
        if (existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile()) return relative(ROOT, join(ROOT, c));
      }
      return null;
    };
    const bad: string[] = [];
    for (const start of files) {
      counters.publicFilesWalked++;
      const seen = new Set<string>();
      const stack = [start];
      while (stack.length) {
        const f = stack.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        const src = read(f);
        if (BANNED.includes(f) || /email_problems/.test(src)) {
          bad.push(`${start} → ${f}`);
          break;
        }
        for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^'"]*?from\s+["']([^"']+)["']/gm)) {
          const r = resolve(f, m[1]);
          if (r) stack.push(r);
        }
      }
    }
    ok(files.length > 20, "F1", "the public file list is real", String(files.length));
    eq(bad, [], "F1", "no public page or public API route reaches the email-problems banner, words, loader or functions");

    const mig = read("supabase/migrations/0128_outbox_quota_hold.sql");
    for (const fn of ["volunteer_email_problems(uuid)", "official_email_problems(uuid)",
                      "volunteer_email_problems_ack(uuid, bigint[], boolean)", "official_email_problems_ack(uuid, bigint[])"]) {
      const grants = [...mig.matchAll(new RegExp(`grant execute on function public\\.${fn.replace(/[()[\]]/g, "\\$&")}\\s+to\\s+(\\w+)`, "g"))].map((m) => m[1]);
      eq(grants, ["authenticated"], "F2", `${fn} is granted to authenticated only`);
    }

    const sites = ["src/app/(dashboard)/dashboard/volunteers/signups/page.tsx", "src/app/(dashboard)/dashboard/umpires/page.tsx"];
    const all: string[] = [];
    const walkAll = (d: string) => {
      for (const n of readdirSync(join(ROOT, d))) {
        const p = join(d, n);
        if (statSync(join(ROOT, p)).isDirectory()) walkAll(p);
        else if (/\.tsx$/.test(n) && read(p).includes("<EmailProblemsBanner")) all.push(p);
      }
    };
    walkAll("src");
    eq(all.sort(), sites.sort(), "F3", "the banner renders only on Who signed up and the Officials page");
  });

  for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);

  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(`\n${failures.length} failure(s) of ${checks} checks`);
    process.exit(1);
  }
  console.log(`sim:outbox-quota — ${checks} checks pass (TZ=${process.env.TZ ?? "host"}); counters ${JSON.stringify(counters)}`);
}

main().catch((e) => {
  console.log(`FAIL: [CRASH-main] ${(e as Error).stack ?? e}`);
  process.exit(1);
});
