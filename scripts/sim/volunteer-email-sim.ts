// sim:volunteer-email — the volunteer email's headers and the outbox drain
// (migration 0120). Drives the REAL src/lib/volunteers/email-headers.ts,
// outbox-drain.ts and src/lib/email.ts's resendRequest; the database and the
// provider are fakes that record what they were asked.
//
//   H  From header: the league name is sanitized (CR/LF, quotes, angle
//      brackets, bidi controls, length), FieldSlate's address extracted
//   R  Reply-To: one plain address or nothing
//   X  the TypeScript address rule and the migration's CHECKs refuse the
//      same characters (read out of the migration file)
//   E  error text for the log carries no address
//   Q  the Resend request: From, Reply-To and the Idempotency-Key reach it
//   D  the drain: one send per row with its key, retry vs final, failures
//      written and logged, a failed finish doesn't stop the run, the gap
//      between sends, nothing taken without a From address, rows without a
//      recipient/reply-to/template never sent
//   S  the route: fails closed without CRON_SECRET, constant-time bearer
//      check, counts-only reply (source greps — weak by nature)
//   C  the Settings card: no card unless the switch is on, the link switch
//      needs a saved contact email, refusals in words (never the raw error)
//
// Every FAIL line is collected; a section that throws is recorded as
// [CRASH-…] and the run continues.
//
// MUTATION LOG (npm run sim:volunteer-email:mutants, 16 mutants):
//   2026-11-08 run 1 — 14 killed at their own tag, 2 at the WRONG one, both
//     harness gaps: VE1 (control strip removed) died only at H5 — `\s+`
//     already collapses CR/LF, so H2 couldn't see the strip; H2 gained NUL +
//     NEL, which only the strip removes. VE4 (comma allowed) died at X1 —
//     R2's two-address case also has two @ signs; R2 gained "x,y@…".
//   run 2 — 16/16 killed at their own tag; source restored green.
//   run 3 (Settings card: C, S6, VE17–VE20) — 20/20 killed at their own tag.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMAIL_SHAPE,
  FALLBACK_LEAGUE_NAME,
  bareFromAddress,
  isEmailShape,
  safeDisplayName,
  safeReplyTo,
  scrubError,
  volunteerFromHeader,
} from "../../src/lib/volunteers/email-headers";
import {
  drainOutbox,
  outboxIdempotencyKey,
  type DrainDeps,
  type SendResult,
} from "../../src/lib/volunteers/outbox-drain";
import { resendRequest } from "../../src/lib/email";
import { renderVolunteerEmail } from "../../src/lib/volunteers/email-templates";
import { cardDataFromAdminState, linkSwitchBlocked, volunteerSignupUrl } from "../../src/lib/volunteers/settings-card";
import { LINK_NEEDS_CONTACT, settingsErrorLine } from "../../src/lib/volunteers/words";

const ROOT = join(__dirname, "../..");
const failures: string[] = [];
let checks = 0;
const counters = { retried: 0, finalFailed: 0, sent: 0, gaps: 0, injectionStripped: 0 };

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

const ADDR = "hello@thefieldslate.com";

async function main() {
  // ── H — From ───────────────────────────────────────────────────────────
  await section("H", () => {
    eq(volunteerFromHeader("Santa Rosa Little League", ADDR),
      `"Santa Rosa Little League via FieldSlate" <${ADDR}>`, "H1", "an ordinary name");
    const inj = volunteerFromHeader("Evil\r\nBcc: victim@example.org", ADDR);
    ok(!/[\r\n]/.test(inj), "H2", "CR/LF never reaches the header", inj);
    eq(inj, `"Evil Bcc: victim@example.org via FieldSlate" <${ADDR}>`, "H2", "CR/LF become one space");
    if (!/[\r\n]/.test(inj)) counters.injectionStripped++;
    // Control characters \s does NOT cover (NUL, NEL) — only the control
    // strip removes these.
    eq(safeDisplayName("Evil\u0000Name\u0085League"), "Evil Name League", "H2", "NUL and NEL go");
    eq(safeDisplayName('Club "Stars" <x@y.z> \\ League'), "Club Stars x@y.z League", "H3",
      "quotes, angle brackets and backslashes go");
    eq(safeDisplayName("Club Atlético Ñandú"), "Club Atlético Ñandú", "H4", "accents are kept");
    eq(safeDisplayName("Good‮eugaeL"), "Good eugaeL", "H5", "a bidi override goes");
    eq(safeDisplayName("   "), FALLBACK_LEAGUE_NAME, "H6", "blank → Your league");
    eq(safeDisplayName(null), FALLBACK_LEAGUE_NAME, "H6", "null → Your league");
    eq(safeDisplayName("\r\n\t"), FALLBACK_LEAGUE_NAME, "H6", "only control characters → Your league");
    const long = "A".repeat(80);
    eq(safeDisplayName(long).length, 60, "H7", "cut to 60 characters");
    eq(bareFromAddress(`FieldSlate <${ADDR}>`), ADDR, "H8", "the address inside angle brackets");
    eq(bareFromAddress(ADDR), ADDR, "H8", "a bare address");
    eq(bareFromAddress(""), null, "H8", "empty → null");
    eq(bareFromAddress("FieldSlate"), null, "H8", "no address → null");
    eq(bareFromAddress("a@b.c, d@e.f"), null, "H8", "two addresses → null");
  });

  // ── R — Reply-To ───────────────────────────────────────────────────────
  await section("R", () => {
    eq(safeReplyTo(" board@example.org "), "board@example.org", "R1", "trimmed");
    for (const bad of ["a@b", "x@example.org\r\nBcc: y@example.org", "x@example.org,y@example.org",
                       "x,y@example.org", "<x@example.org>", "x y@example.org", '"x"@example.org', "x@exa;mple.org", "", null]) {
      eq(safeReplyTo(bad as string | null), null, "R2", `refused: ${JSON.stringify(bad)}`);
    }
    ok(!isEmailShape("a".repeat(250) + "@b.co"), "R3", "over 254 characters refused");
  });

  // ── X — parity with the migration's CHECKs ─────────────────────────────
  await section("X", () => {
    const mig = readFileSync(join(ROOT, "supabase/migrations/0120_volunteers_foundation.sql"), "utf8");
    const sqlClasses = [...mig.matchAll(/\[\^@\[:space:\]\[:cntrl:\]([^\]]*)\]/g)].map((m) => m[1]);
    ok(sqlClasses.length >= 9, "X1", "the migration's address classes were found", `found ${sqlClasses.length}`);
    const tsClass = EMAIL_SHAPE.source.match(/\[\^@\\s\\p\{Cc\}([^\]]*)\]/)?.[1];
    ok(tsClass !== undefined, "X1", "the TypeScript address class was found", EMAIL_SHAPE.source);
    // SQL writes a backslash as \\ inside the class, as does the JS source.
    for (const c of sqlClasses) eq(c, tsClass, "X1", "the SQL and TypeScript classes refuse the same characters");
    ok(/length\(contact_email\) <= 254/.test(mig) && /length\(email_lc\) <= 254/.test(mig), "X1",
      "the migration caps addresses at 254, as EMAIL_MAX does");
  });

  // ── E — error text for the log ─────────────────────────────────────────
  await section("E", () => {
    eq(scrubError("Invalid `to` field: bob@example.org is not allowed"),
      "Invalid `to` field: [address] is not allowed", "E1", "an address in the provider's error goes");
    eq(scrubError(new Error("line1\r\nline2")), "line1 line2", "E2", "control characters go");
    eq(scrubError("x".repeat(600)).length, 500, "E3", "cut to the column's 500");
    eq(scrubError(undefined), "send failed", "E4", "nothing → send failed");
  });

  // ── Q — the Resend request ─────────────────────────────────────────────
  await section("Q", () => {
    const from = volunteerFromHeader("Majors LL", ADDR);
    const r = resendRequest(ADDR, "v@example.org", "S", "<p>h</p>", "t",
      { from, replyTo: "board@example.org", idempotencyKey: "volunteer-outbox-7" });
    eq(r.payload.from, from, "Q1", "From is the league header");
    eq((r.payload as { replyTo?: string }).replyTo, "board@example.org", "Q1", "Reply-To reaches Resend");
    eq(r.requestOptions, { idempotencyKey: "volunteer-outbox-7" }, "Q2", "the idempotency key reaches Resend");
    const plain = resendRequest(ADDR, "v@example.org", "S", "<p>h</p>", undefined, {});
    eq(plain.payload, { from: ADDR, to: "v@example.org", subject: "S", html: "<p>h</p>" }, "Q3",
      "with no options the request is exactly what sendEmail sent before");
    eq(plain.requestOptions, undefined, "Q3", "no key → no request options");
  });

  // ── D — the drain ──────────────────────────────────────────────────────
  type Row = { id: number; kind: string; payload: Record<string, unknown>; attempts: number;
               to: string | null; league_name: string | null; reply_to: string | null };
  function fakeDeps(rows: Row[], sendPlan: Record<number, SendResult | "throw">, opts: {
    finishFailsFor?: number[]; takeError?: string; envFrom?: string | null;
    render?: DrainDeps["render"];
  } = {}) {
    const sends: Parameters<DrainDeps["send"]>[0][] = [];
    const finishes: Parameters<DrainDeps["finish"]>[0][] = [];
    const logs: string[] = [];
    const sleeps: number[] = [];
    let takes = 0;
    // Mimics the database: a taken row is 'sending' and is not taken again.
    const pending = new Set(rows.map((r) => r.id));
    const deps: DrainDeps = {
      envFrom: opts.envFrom === undefined ? `FieldSlate <${ADDR}>` : opts.envFrom,
      take: async (limit) => {
        takes++;
        if (opts.takeError) return { ok: false, error: opts.takeError };
        const out = rows.filter((r) => pending.has(r.id)).slice(0, limit);
        out.forEach((r) => pending.delete(r.id));
        return { ok: true, rows: out };
      },
      finish: async (a) => {
        finishes.push(a);
        return opts.finishFailsFor?.includes(a.id) ? { ok: false, error: "db down for x@y.org" } : { ok: true };
      },
      send: async (m) => {
        sends.push(m);
        const plan = sendPlan[Number(m.idempotencyKey.split("-").pop())] ?? { ok: true, id: `re_${m.idempotencyKey}` };
        if (plan === "throw") throw new Error("network reset for v@example.org");
        return plan;
      },
      render: opts.render ?? ((kind) => (kind === "unknown" ? null : { subject: `S ${kind}`, html: "<p>x</p>", text: "x" })),
      sleep: async (ms) => { sleeps.push(ms); },
      log: (m) => { logs.push(m); },
    };
    return { deps, sends, finishes, logs, sleeps, takes: () => takes };
  }
  const row = (id: number, extra: Partial<Row> = {}): Row => ({
    id, kind: "reminder", payload: {}, attempts: 1, to: `v${id}@example.org`,
    league_name: "Majors LL", reply_to: "board@example.org", ...extra,
  });

  await section("D", async () => {
    // D1 — one send per row, with its key, From, Reply-To and recipient.
    {
      const f = fakeDeps([row(1), row(2)], {});
      const s = await drainOutbox(f.deps, { gapMs: 600 });
      eq(f.sends.map((m) => m.idempotencyKey), [outboxIdempotencyKey(1), outboxIdempotencyKey(2)], "D1",
        "each row sent once, keyed by its id");
      eq(f.sends[0]?.from, `"Majors LL via FieldSlate" <${ADDR}>`, "D1", "From is the league header");
      eq(f.sends[0]?.replyTo, "board@example.org", "D1", "Reply-To is the league contact");
      eq(f.sends[0]?.to, "v1@example.org", "D1", "To is the row's recipient");
      eq(f.finishes.map((x) => [x.id, x.ok, x.resendId, x.retry]),
        [[1, true, "re_volunteer-outbox-1", false], [2, true, "re_volunteer-outbox-2", false]], "D1",
        "each success is recorded with Resend's id");
      eq([s.taken, s.sent, s.failed, s.retrying], [2, 2, 0, 0], "D1", "summary counts");
      counters.sent += s.sent;
      // A second drain over the same (now 'sending') rows sends nothing.
      const again = await drainOutbox(f.deps);
      eq([again.taken, f.sends.length], [0, 2], "D1", "a second drain sends nothing again");
    }
    // D7 — the gap between sends (none before the first).
    {
      const f = fakeDeps([row(1), row(2), row(3)], {});
      await drainOutbox(f.deps, { gapMs: 600 });
      eq(f.sleeps, [600, 600], "D7", "one 600ms gap between each pair of sends");
      counters.gaps += f.sleeps.length;
    }
    // D2 — a 5xx / 429 is retried; the failure is written AND logged, scrubbed.
    {
      const f = fakeDeps([row(1), row(2)], {
        1: { ok: false, status: 500, error: "Resend outage for v1@example.org" },
        2: { ok: false, status: 429, error: "rate limited" },
      });
      const s = await drainOutbox(f.deps);
      eq(f.finishes.map((x) => [x.id, x.ok, x.retry]), [[1, false, true], [2, false, true]], "D2",
        "a 500 and a 429 are retried");
      eq(f.finishes[0]?.error, "Resend outage for [address]", "D2", "the written error has no address");
      ok(f.logs.some((l) => l.includes("row 1") && l.includes("will retry")), "D2", "the failure is logged", f.logs.join(" | "));
      ok(!f.logs.some((l) => l.includes("v1@example.org")), "D2", "the log has no address", f.logs.join(" | "));
      eq(s.retrying, 2, "D2", "summary counts the retries");
      counters.retried += s.retrying;
    }
    // D3 — any other refusal is final.
    {
      const f = fakeDeps([row(1)], { 1: { ok: false, status: 422, error: "invalid to" } });
      const s = await drainOutbox(f.deps);
      eq(f.finishes.map((x) => [x.ok, x.retry]), [[false, false]], "D3", "a 422 is not retried");
      eq(s.failed, 1, "D3", "counted as failed");
      counters.finalFailed += s.failed;
    }
    // D4 — a thrown send is retried, scrubbed.
    {
      const f = fakeDeps([row(1)], { 1: "throw" });
      await drainOutbox(f.deps);
      eq(f.finishes.map((x) => [x.ok, x.retry, x.error]), [[false, true, "network reset for [address]"]], "D4",
        "a thrown send is retried");
    }
    // D5 — rows that can't be sent never are.
    {
      const f = fakeDeps([row(1, { kind: "unknown" }), row(2, { to: null }), row(3, { reply_to: "a@b" }),
                          row(4, { to: "x@example.org\r\nBcc: y@example.org" })], {});
      await drainOutbox(f.deps);
      eq(f.sends.length, 0, "D5", "nothing is sent");
      eq(f.finishes.map((x) => [x.id, x.error, x.retry]),
        [[1, "unknown_kind", false], [2, "bad_recipient", false], [3, "bad_reply_to", false], [4, "bad_recipient", false]],
        "D5", "each fails for its reason, never retried");
    }
    // D6 — a failed finish is logged and counted; the next row still goes.
    {
      const f = fakeDeps([row(1), row(2)], {}, { finishFailsFor: [1] });
      const s = await drainOutbox(f.deps);
      eq(f.sends.length, 2, "D6", "the second row is still sent");
      eq(s.finishErrors, 1, "D6", "the failed finish is counted");
      ok(f.logs.some((l) => l.includes("recording the outcome failed") && !l.includes("x@y.org")), "D6",
        "the failed finish is logged, scrubbed", f.logs.join(" | "));
    }
    // D8 — a failed take sends nothing and says so.
    {
      const f = fakeDeps([row(1)], {}, { takeError: "permission denied" });
      const s = await drainOutbox(f.deps);
      eq([f.sends.length, s.error], [0, "take failed: permission denied"], "D8", "a failed take sends nothing");
    }
    // D9 — no usable From address: nothing is even taken.
    {
      const f = fakeDeps([row(1)], {}, { envFrom: "FieldSlate" });
      const s = await drainOutbox(f.deps);
      eq([f.takes(), f.sends.length], [0, 0], "D9", "nothing taken without a From address");
      ok(s.error !== null, "D9", "the summary says why");
    }
    // D10 — 0120 has no templates: every kind fails as unknown_kind.
    {
      const f = fakeDeps([row(1, { kind: "signup_confirmed" })], {}, { render: renderVolunteerEmail });
      await drainOutbox(f.deps);
      eq([f.sends.length, f.finishes[0]?.error], [0, "unknown_kind"], "D10", "no 0120 kind has an email yet");
    }
  });

  // ── S — the route (source greps — weak by nature) ──────────────────────
  await section("S", () => {
    const src = readFileSync(join(ROOT, "src/app/api/volunteers/outbox/drain/route.ts"), "utf8");
    ok(/if \(!secret\) \{\s*return NextResponse\.json\([^)]*\{ status: 503/.test(src), "S1",
      "no CRON_SECRET → 503 before anything else");
    ok(src.includes("timingSafeEqual") && src.includes("bearerMatches(request.headers.get(\"authorization\"), secret)"),
      "S2", "the bearer is compared in constant time");
    ok(src.includes("drainOutbox(") && src.includes("NextResponse.json(summary"), "S3",
      "the reply is the drain summary (counts only)");
    ok(!/from\(\s*["']volunteer/.test(src), "S4", "the route reads no volunteer table directly");
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[] };
    eq(vercel.crons?.find((c) => c.path === "/api/volunteers/outbox/drain")?.schedule, "*/5 * * * *", "S5",
      "the cron runs the drain every 5 minutes");
  });

  // ── C — the Settings card ──────────────────────────────────────────────
  await section("C", () => {
    const tok = "a".repeat(64);
    eq(cardDataFromAdminState({ feature: false }), null, "C1", "switch off → no card");
    eq(cardDataFromAdminState(null), null, "C1", "no reply → no card");
    eq(cardDataFromAdminState({ feature: "true", elite: true }), null, "C1", "a non-boolean switch → no card");
    eq(cardDataFromAdminState({ feature: true, elite: false, settings: null }), { elite: false, settings: null }, "C1",
      "switch on, no settings yet");
    eq(cardDataFromAdminState({ feature: true, elite: true,
        settings: { link_token: tok, link_enabled: true, contact_email: "board@example.org" } }),
      { elite: true, settings: { linkToken: tok, linkEnabled: true, contactEmail: "board@example.org" } }, "C1",
      "switch on with settings");
    eq(cardDataFromAdminState({ feature: true, elite: true, settings: { link_token: "nope" } }), null, "C1",
      "a malformed token → no card");
    eq(volunteerSignupUrl(tok), `https://www.thefieldslate.com/v/${tok}`, "C1", "the link is on www, under /v/");

    eq(linkSwitchBlocked({ linkEnabled: false, savedContact: null }), LINK_NEEDS_CONTACT, "C2",
      "off with no saved contact → can't turn on, says why");
    eq(linkSwitchBlocked({ linkEnabled: false, savedContact: "board@example.org" }), null, "C2", "off with a contact → can turn on");
    eq(linkSwitchBlocked({ linkEnabled: true, savedContact: null }), null, "C2", "on → can always turn off");

    const raw = 'new row for relation "volunteer_settings" violates check constraint';
    ok(!settingsErrorLine(raw).includes("volunteer_settings"), "C3", "an unknown error is never shown raw", settingsErrorLine(raw));
    ok(settingsErrorLine("invalid_email").includes("email address"), "C3", "invalid_email in words");
    ok(settingsErrorLine("P0001: contact_required").startsWith("Turn the sign-up link off"), "C3", "contact_required in words");
    ok(settingsErrorLine("plan_required").includes("plan"), "C3", "plan_required in words");
  });

  await section("S6", () => {
    const page = readFileSync(join(ROOT, "src/app/(dashboard)/dashboard/settings/page.tsx"), "utf8");
    ok(page.includes("{volunteers && <VolunteersCard orgId={currentOrgId} data={volunteers} />}"), "S6",
      "the card renders only when the loader returned data");
    const loader = readFileSync(join(ROOT, "src/lib/volunteers/feature-state.ts"), "utf8");
    ok(page.includes('loadVolunteerFeature(supabase, currentOrgId, "settings")'), "S6", "Settings reads through the shared loader");
    ok(/if \(error\) \{\s*console\.error\(`\[\$\{where\}\] volunteer feature read failed:`, error\.message\);\s*return null;/.test(loader),
      "S6", "a failed read means no card");
    ok(loader.includes("return cardDataFromAdminState(data);"), "S6", "the reply goes through cardDataFromAdminState");
  });

  for (const [k, v] of Object.entries(counters)) ok(v > 0, "VAC", `anti-vacuity counter ${k} is zero`);

  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(`\n${failures.length} failure(s) of ${checks} checks`);
    process.exit(1);
  }
  console.log(`sim:volunteer-email — ${checks} checks pass; counters ${JSON.stringify(counters)}`);
}

main().catch((e) => {
  console.log(`FAIL: [CRASH-main] ${(e as Error).stack ?? e}`);
  process.exit(1);
});
