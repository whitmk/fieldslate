// The volunteer outbox (migration 0120): its row shape, the take reply's
// parser, and the volunteer drain. The drain itself — take, render, send,
// record, retry rules — is the shared src/lib/outbound-email/outbox-drain.ts
// (lifted 2026-11-09, behaviour unchanged; sim:volunteer-email drives it
// through this file).
import type { EmailSpot, RenderCtx } from "./email-templates";
import {
  DRAIN_GAP_MS,
  DRAIN_LIMIT,
  baseOutboxRow,
  drainOutbox as drainShared,
  outboxRowId,
  shouldRetry,
  type BaseOutboxRow,
  type DrainSummary,
  type RenderedEmail,
  type SendResult,
} from "@/lib/outbound-email/outbox-drain";

export { DRAIN_GAP_MS, DRAIN_LIMIT, shouldRetry };
export type { DrainSummary, RenderedEmail, SendResult };

export const VOLUNTEER_OUTBOX_LABEL = "volunteer-outbox";

export type OutboxRow = BaseOutboxRow & {
  /** What the take attached (0121 part 6) — see email-templates.ts. */
  spots: EmailSpot[];
  manageToken: string | null;
  signupToken: string | null;
};

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

export function outboxIdempotencyKey(id: number): string {
  return `${VOLUNTEER_OUTBOX_LABEL}-${id}`;
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
    const id = outboxRowId(o);
    if (!Number.isSafeInteger(id)) {
      dropped++;
      continue;
    }
    rows.push({
      ...baseOutboxRow(id, o),
      spots: Array.isArray(o.spots) ? (o.spots.filter((s) => s && typeof s === "object") as EmailSpot[]) : [],
      manageToken: typeof o.manage_token === "string" ? o.manage_token : null,
      signupToken: typeof o.signup_token === "string" ? o.signup_token : null,
    });
  }
  return { rows, dropped };
}

export function drainOutbox(
  deps: DrainDeps,
  opts: { limit?: number; gapMs?: number } = {},
): Promise<DrainSummary> {
  return drainShared<OutboxRow>(
    {
      ...deps,
      label: VOLUNTEER_OUTBOX_LABEL,
      parse: parseOutboxRows,
      render: (row) =>
        deps.render(row.kind, row.payload, {
          leagueName: row.leagueName,
          spots: row.spots,
          manageToken: row.manageToken,
          signupToken: row.signupToken,
        }),
    },
    opts,
  );
}
