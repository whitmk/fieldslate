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
//   * Retry (back to pending, later) on a thrown send, a 429 or a 5xx; any
//     other refusal is final. A row with no recipient, an unusable reply-to
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

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; status: number };

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
  error: string | null;
};

export const DRAIN_LIMIT = 25;
export const DRAIN_GAP_MS = 600;

/** Whether a failed send is worth another try. */
export function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
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
  const summary: DrainSummary = { taken: 0, sent: 0, retrying: 0, failed: 0, finishErrors: 0, error: null };
  const limit = opts.limit ?? DRAIN_LIMIT;
  const gapMs = opts.gapMs ?? DRAIN_GAP_MS;
  const tag = `[${deps.label}]`;

  const fromAddress = bareFromAddress(deps.envFrom);
  if (!fromAddress) {
    summary.error = "RESEND_FROM_EMAIL is not a usable address; nothing was taken.";
    deps.log(`${tag} ${summary.error}`);
    return summary;
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
    if (result.ok) await finish(row, true, result.id, null, false);
    else await finish(row, false, null, scrubError(result.error), shouldRetry(result.status));
  }

  return summary;
}
