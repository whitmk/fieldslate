// Drains the volunteer outbox (migration 0120): take due rows, render, send,
// record each outcome. Pure orchestration — the database calls, the sender,
// the renderer and the clock are all injected, so sim:volunteer-email drives
// this exact code.
//
// RULES (each pinned by the sim):
//   * Nothing is taken when FieldSlate's own From address is unusable — a
//     taken row that can't be sent sits in 'sending' for 10 minutes.
//   * One send per taken row, with the idempotency key
//     `volunteer-outbox-<id>`: if a drain dies after the provider accepted
//     the email, the row comes back after 10 minutes and the provider drops
//     the second send.
//   * Retry (back to pending, later) on a thrown send, a 429 or a 5xx; any
//     other refusal is final. A row with no recipient, an unusable reply-to
//     or a kind with no template fails at once and is never sent.
//   * Every failure is written to the row's `error` (scrubbed: no address)
//     AND logged. A failed finish is logged and counted; the next row still
//     goes.
//   * At most one send per `gapMs` (Resend's default limit is about two
//     requests a second).
import type { EmailSpot, RenderCtx } from "./email-templates";
import { bareFromAddress, safeReplyTo, scrubError, volunteerFromHeader, isEmailShape } from "./email-headers";

export type OutboxRow = {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  to: string | null;
  leagueName: string | null;
  replyTo: string | null;
  /** What the take attached (0121 part 6) — see email-templates.ts. */
  spots: EmailSpot[];
  manageToken: string | null;
  signupToken: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; status: number };

export type DrainDeps = {
  take(limit: number): Promise<{ ok: true; rows: unknown } | { ok: false; error: string }>;
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
  render(kind: string, payload: Record<string, unknown>, ctx: RenderCtx): RenderedEmail | null;
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
  error: string | null;
};

export const DRAIN_LIMIT = 25;
export const DRAIN_GAP_MS = 600;

export function outboxIdempotencyKey(id: number): string {
  return `volunteer-outbox-${id}`;
}

/** Whether a failed send is worth another try. */
export function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

/** The take reply, row by row. A row without a numeric id can't be finished
 *  and is dropped (and logged by the caller); anything else malformed comes
 *  back with nulls so it fails visibly. */
export function parseOutboxRows(raw: unknown): { rows: OutboxRow[]; dropped: number } {
  if (!Array.isArray(raw)) return { rows: [], dropped: 0 };
  const rows: OutboxRow[] = [];
  let dropped = 0;
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const id = typeof o.id === "number" ? o.id : typeof o.id === "string" && /^\d+$/.test(o.id) ? Number(o.id) : NaN;
    if (!Number.isSafeInteger(id)) {
      dropped++;
      continue;
    }
    rows.push({
      id,
      kind: typeof o.kind === "string" ? o.kind : "",
      payload: o.payload && typeof o.payload === "object" && !Array.isArray(o.payload)
        ? (o.payload as Record<string, unknown>)
        : {},
      attempts: typeof o.attempts === "number" ? o.attempts : 0,
      to: typeof o.to === "string" ? o.to : null,
      leagueName: typeof o.league_name === "string" ? o.league_name : null,
      replyTo: typeof o.reply_to === "string" ? o.reply_to : null,
      spots: Array.isArray(o.spots) ? (o.spots.filter((s) => s && typeof s === "object") as EmailSpot[]) : [],
      manageToken: typeof o.manage_token === "string" ? o.manage_token : null,
      signupToken: typeof o.signup_token === "string" ? o.signup_token : null,
    });
  }
  return { rows, dropped };
}

export async function drainOutbox(
  deps: DrainDeps,
  opts: { limit?: number; gapMs?: number } = {},
): Promise<DrainSummary> {
  const summary: DrainSummary = { taken: 0, sent: 0, retrying: 0, failed: 0, finishErrors: 0, error: null };
  const limit = opts.limit ?? DRAIN_LIMIT;
  const gapMs = opts.gapMs ?? DRAIN_GAP_MS;

  const fromAddress = bareFromAddress(deps.envFrom);
  if (!fromAddress) {
    summary.error = "RESEND_FROM_EMAIL is not a usable address; nothing was taken.";
    deps.log(`[volunteer-outbox] ${summary.error}`);
    return summary;
  }

  const took = await deps.take(limit);
  if (!took.ok) {
    summary.error = `take failed: ${scrubError(took.error)}`;
    deps.log(`[volunteer-outbox] ${summary.error}`);
    return summary;
  }
  const { rows, dropped } = parseOutboxRows(took.rows);
  if (dropped) deps.log(`[volunteer-outbox] ${dropped} taken row(s) had no id and were skipped`);
  summary.taken = rows.length;

  async function finish(row: OutboxRow, ok: boolean, resendId: string | null, error: string | null, retry: boolean) {
    if (ok) summary.sent++;
    else if (retry) summary.retrying++;
    else summary.failed++;
    if (!ok) deps.log(`[volunteer-outbox] row ${row.id} (${row.kind}) ${retry ? "will retry" : "failed"}: ${error}`);
    const r = await deps.finish({ id: row.id, ok, resendId, error, retry });
    if (!r.ok) {
      summary.finishErrors++;
      deps.log(`[volunteer-outbox] row ${row.id}: recording the outcome failed: ${scrubError(r.error)}`);
    }
  }

  let sentBefore = false;
  for (const row of rows) {
    if (!isEmailShape(row.to)) {
      await finish(row, false, null, "bad_recipient", false);
      continue;
    }
    const replyTo = safeReplyTo(row.replyTo);
    if (!replyTo) {
      await finish(row, false, null, "bad_reply_to", false);
      continue;
    }
    const rendered = deps.render(row.kind, row.payload, {
      leagueName: row.leagueName,
      spots: row.spots,
      manageToken: row.manageToken,
      signupToken: row.signupToken,
    });
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
        from: volunteerFromHeader(row.leagueName, fromAddress),
        replyTo,
        idempotencyKey: outboxIdempotencyKey(row.id),
      });
    } catch (e) {
      await finish(row, false, null, scrubError(e), true);
      continue;
    }
    if (result.ok) await finish(row, true, result.id, null, false);
    else await finish(row, false, null, scrubError(result.error), shouldRetry(result.status));
  }

  return summary;
}
