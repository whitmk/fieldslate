// Drains an outbox (the volunteer outbox, 0120; the officials outbox, 0124):
// take due rows, render, send, record each outcome. Pure orchestration — the
// database calls, the row parser, the sender, the renderer and the clock are
// all injected, so the sims drive this exact code. Lifted from
// src/lib/volunteers/outbox-drain.ts (2026-11-09); the rules did not change.
//
// RULES (each pinned by sim:volunteer-email):
//   * Nothing is taken when FieldSlate's own From address is unusable — a
//     taken row that can't be sent sits in 'sending' for 10 minutes.
//   * One send per taken row, with the idempotency key `<label>-<id>`: if a
//     drain dies after the provider accepted the email, the row comes back
//     after 10 minutes and the provider drops the second send.
//   * What a failed send means is ONE decision, `sendOutcome` (0128,
//     2026-11-10): a Resend quota stop (daily or monthly) or rate limit puts
//     the row — and every row still waiting in this run — back WITHOUT using
//     an attempt and stops the run (`hold`); a 5xx, an unknown status or a
//     thrown send is retried with backoff; any other 4xx is final (never
//     retried: it can't succeed). Before 0128 sendEmail reported every
//     provider error as 500, so a quota stop burned all 5 attempts in ~30
//     minutes and the rest of the day's emails failed for good.
//   * `beforeTake` (the volunteer outbox's started-game drop) runs before the
//     take; if it fails, that is logged and the drain still runs. A row with no recipient, an unusable reply-to
//     or a kind with no template fails at once and is never sent.
//   * Every failure is written to the row's `error` (scrubbed: no address)
//     AND logged. A failed finish is logged and counted; the next row still
//     goes.
//   * At most one send per `gapMs` (Resend's default limit is about two
//     requests a second).
import { bareFromAddress, leagueFromHeader, safeReplyTo, scrubError, isEmailShape } from "./headers";

/** What every outbox row carries; each outbox adds its own fields. */
export type BaseOutboxRow = {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  to: string | null;
  leagueName: string | null;
  replyTo: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; status: number; name?: string | null; providerStatus?: number | null };

/** Why a taken row is put back without using an attempt (0128). */
export type HoldReason = "quota_daily" | "quota_monthly" | "rate_limited";

/** What a failed send means. */
export type SendOutcome = HoldReason | "retry" | "fail";

export type DrainDeps<R extends BaseOutboxRow> = {
  /** Log prefix and idempotency-key prefix, e.g. "volunteer-outbox". */
  label: string;
  take(limit: number): Promise<{ ok: true; rows: unknown } | { ok: false; error: string }>;
  parse(raw: unknown): { rows: R[]; dropped: number };
  finish(args: {
    id: number;
    ok: boolean;
    resendId: string | null;
    error: string | null;
    retry: boolean;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  send(msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
    from: string;
    replyTo: string;
    idempotencyKey: string;
  }): Promise<SendResult>;
  /** Put a taken row back to pending until `until` without using an attempt
   *  (volunteer_outbox_hold / official_outbox_hold, 0128). */
  hold(args: { id: number; until: string; reason: HoldReason }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Runs before the take; a failure is logged and the drain goes on. */
  beforeTake?(): Promise<{ ok: true; dropped: number } | { ok: false; error: string }>;
  /** The clock (for the hold time). Default: the real one. */
  now?(): Date;
  render(row: R): RenderedEmail | null;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  /** RESEND_FROM_EMAIL, as configured. */
  envFrom: string | null | undefined;
};

export type DrainSummary = {
  taken: number;
  sent: number;
  retrying: number;
  failed: number;
  finishErrors: number;
  /** Rows put back without using an attempt (quota or rate limit). */
  held: number;
  /** Why the run stopped early, if it did. */
  stopped: HoldReason | null;
  /** Pending notices dropped because their game had started (beforeTake). */
  droppedStarted: number;
  error: string | null;
};

export const DRAIN_LIMIT = 25;
export const DRAIN_GAP_MS = 600;

/** What a failed send means (0128). Resend's error NAME decides first; then
 *  its own status (`providerStatus`), else the result's `status`. */
export function sendOutcome(r: { status: number; name?: string | null; providerStatus?: number | null }): SendOutcome {
  if (r.name === "daily_quota_exceeded") return "quota_daily";
  if (r.name === "monthly_quota_exceeded") return "quota_monthly";
  const status = typeof r.providerStatus === "number" ? r.providerStatus : r.status;
  if (r.name === "rate_limit_exceeded" || status === 429) return "rate_limited";
  if (status >= 500 || !Number.isFinite(status)) return "retry";
  return "fail";
}

/** When a held row is due again (sources read 2026-11-10):
 *   - daily quota → the next 00:00 UTC. Resend: "a UTC calendar day
 *     (00:00–24:00 UTC) and resets at midnight UTC", "not a rolling 24-hour
 *     window" (docs/knowledge-base/account-quotas-and-limits and
 *     docs/api-reference/rate-limit). Free plan only — paid plans have no
 *     daily quota.
 *   - monthly quota → re-tried in 6 hours. Resend pauses sending "until the
 *     next billing cycle" and doesn't state the date, so the banner says when
 *     FieldSlate will TRY AGAIN, never when the limit resets.
 *   - rate limit (10 requests a second per team) → the next run. */
export function holdUntil(reason: HoldReason, now: Date): string {
  if (reason === "quota_daily") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return d.toISOString();
  }
  if (reason === "quota_monthly") return new Date(now.getTime() + 6 * 3600_000).toISOString();
  return now.toISOString();
}

/** The id of a take reply row, or NaN when it has none. */
export function outboxRowId(o: Record<string, unknown>): number {
  return typeof o.id === "number" ? o.id : typeof o.id === "string" && /^\d+$/.test(o.id) ? Number(o.id) : NaN;
}

/** The fields every outbox row shares, read from a take reply row. */
export function baseOutboxRow(id: number, o: Record<string, unknown>): BaseOutboxRow {
  return {
    id,
    kind: typeof o.kind === "string" ? o.kind : "",
    payload: o.payload && typeof o.payload === "object" && !Array.isArray(o.payload)
      ? (o.payload as Record<string, unknown>)
      : {},
    attempts: typeof o.attempts === "number" ? o.attempts : 0,
    to: typeof o.to === "string" ? o.to : null,
    leagueName: typeof o.league_name === "string" ? o.league_name : null,
    replyTo: typeof o.reply_to === "string" ? o.reply_to : null,
  };
}

export async function drainOutbox<R extends BaseOutboxRow>(
  deps: DrainDeps<R>,
  opts: { limit?: number; gapMs?: number } = {},
): Promise<DrainSummary> {
  const summary: DrainSummary = {
    taken: 0, sent: 0, retrying: 0, failed: 0, finishErrors: 0, held: 0, stopped: null, droppedStarted: 0, error: null,
  };
  const limit = opts.limit ?? DRAIN_LIMIT;
  const gapMs = opts.gapMs ?? DRAIN_GAP_MS;
  const tag = `[${deps.label}]`;

  const fromAddress = bareFromAddress(deps.envFrom);
  if (!fromAddress) {
    summary.error = "RESEND_FROM_EMAIL is not a usable address; nothing was taken.";
    deps.log(`${tag} ${summary.error}`);
    return summary;
  }

  if (deps.beforeTake) {
    const b = await deps.beforeTake();
    if (b.ok) summary.droppedStarted = b.dropped;
    else deps.log(`${tag} dropping started-game notices failed: ${scrubError(b.error)}`);
  }

  const took = await deps.take(limit);
  if (!took.ok) {
    summary.error = `take failed: ${scrubError(took.error)}`;
    deps.log(`${tag} ${summary.error}`);
    return summary;
  }
  const { rows, dropped } = deps.parse(took.rows);
  if (dropped) deps.log(`${tag} ${dropped} taken row(s) had no id and were skipped`);
  summary.taken = rows.length;

  async function finish(row: R, ok: boolean, resendId: string | null, error: string | null, retry: boolean) {
    if (ok) summary.sent++;
    else if (retry) summary.retrying++;
    else summary.failed++;
    if (!ok) deps.log(`${tag} row ${row.id} (${row.kind}) ${retry ? "will retry" : "failed"}: ${error}`);
    const r = await deps.finish({ id: row.id, ok, resendId, error, retry });
    if (!r.ok) {
      summary.finishErrors++;
      deps.log(`${tag} row ${row.id}: recording the outcome failed: ${scrubError(r.error)}`);
    }
  }

  async function hold(row: R, reason: HoldReason, until: string) {
    summary.held++;
    const r = await deps.hold({ id: row.id, until, reason });
    if (!r.ok) {
      summary.finishErrors++;
      deps.log(`${tag} row ${row.id}: holding it failed: ${scrubError(r.error)}`);
    }
  }

  let sentBefore = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isEmailShape(row.to)) {
      await finish(row, false, null, "bad_recipient", false);
      continue;
    }
    const replyTo = safeReplyTo(row.replyTo);
    if (!replyTo) {
      await finish(row, false, null, "bad_reply_to", false);
      continue;
    }
    const rendered = deps.render(row);
    if (!rendered) {
      await finish(row, false, null, "unknown_kind", false);
      continue;
    }

    if (sentBefore) await deps.sleep(gapMs);
    sentBefore = true;

    let result: SendResult;
    try {
      result = await deps.send({
        to: row.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        from: leagueFromHeader(row.leagueName, fromAddress),
        replyTo,
        idempotencyKey: `${deps.label}-${row.id}`,
      });
    } catch (e) {
      await finish(row, false, null, scrubError(e), true);
      continue;
    }
    if (result.ok) {
      await finish(row, true, result.id, null, false);
      continue;
    }
    const outcome = sendOutcome(result);
    if (outcome === "retry" || outcome === "fail") {
      await finish(row, false, null, scrubError(result.error), outcome === "retry");
      continue;
    }
    // A quota stop or rate limit: this row and every row still waiting in
    // this run go back, no attempt used, and the run stops — more sends would
    // only be refused the same way.
    const until = holdUntil(outcome, deps.now ? deps.now() : new Date());
    deps.log(`${tag} ${outcome}: holding ${rows.length - i} row(s) until ${until}`);
    for (const rest of rows.slice(i)) await hold(rest, outcome, until);
    summary.stopped = outcome;
    break;
  }

  return summary;
}
