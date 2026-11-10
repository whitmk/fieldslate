// The one place the officials outbox drain (0124) is wired to the real
// database, email sender and clock: the shared drain (outbound-email) with
// the officials row parser and templates. Used by the 5-minute cron, the
// daily digest route, and the claim/drop routes right after a write (so a
// confirmation goes out at once). Server only: the admin client.
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import {
  baseOutboxRow,
  drainOutbox,
  outboxRowId,
  type DrainSummary,
} from "@/lib/outbound-email/outbox-drain";
import { renderOfficialEmail, type OfficialOutboxRow } from "./email-templates";
import type { GameInfo } from "./page";

export const OFFICIALS_OUTBOX_LABEL = "official-outbox";

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function gameOf(v: unknown): GameInfo | null {
  const o = obj(v);
  if (!o || typeof o.game_id !== "string" || typeof o.start !== "string" || typeof o.role !== "string") return null;
  return {
    game_id: o.game_id,
    start: o.start,
    minutes: typeof o.minutes === "number" ? o.minutes : 90,
    division: typeof o.division === "string" ? o.division : null,
    home: typeof o.home === "string" ? o.home : null,
    away: typeof o.away === "string" ? o.away : null,
    field: typeof o.field === "string" ? o.field : null,
    role: o.role,
  };
}

/** The take reply, row by row (rows with no id are dropped and logged). */
export function parseOfficialRows(raw: unknown): { rows: OfficialOutboxRow[]; dropped: number } {
  if (!Array.isArray(raw)) return { rows: [], dropped: 0 };
  const rows: OfficialOutboxRow[] = [];
  let dropped = 0;
  for (const r of raw) {
    const o = obj(r) ?? {};
    const id = outboxRowId(o);
    if (!Number.isSafeInteger(id)) {
      dropped++;
      continue;
    }
    rows.push({
      ...baseOutboxRow(id, o),
      seasonName: typeof o.season_name === "string" ? o.season_name : null,
      officialName: typeof o.official_name === "string" ? o.official_name : null,
      youth: o.youth === true,
      linkToken: typeof o.link_token === "string" ? o.link_token : null,
      game: gameOf(o.game),
      spots: Array.isArray(o.spots) ? (o.spots.map(gameOf).filter(Boolean) as GameInfo[]) : [],
      claims: Array.isArray(o.claims)
        ? (o.claims
            .map((c) => {
              const g = gameOf(c);
              return g ? { ...g, official_name: typeof obj(c)?.official_name === "string" ? (obj(c)!.official_name as string) : null } : null;
            })
            .filter(Boolean) as OfficialOutboxRow["claims"])
        : [],
    });
  }
  return { rows, dropped };
}

export async function runOfficialsDrain(opts: { limit?: number } = {}): Promise<DrainSummary> {
  const admin = createAdminClient();
  return drainOutbox<OfficialOutboxRow>(
    {
      label: OFFICIALS_OUTBOX_LABEL,
      envFrom: process.env.RESEND_FROM_EMAIL,
      take: async (limit) => {
        const { data, error } = await admin.rpc("official_outbox_take" as never, { p_limit: limit } as never);
        return error ? { ok: false, error: error.message } : { ok: true, rows: data };
      },
      parse: parseOfficialRows,
      finish: async ({ id, ok, resendId, error, retry }) => {
        const { error: rpcErr } = await admin.rpc(
          "official_outbox_finish" as never,
          { p_id: id, p_ok: ok, p_resend_id: resendId, p_error: error, p_retry: retry } as never,
        );
        return rpcErr ? { ok: false, error: rpcErr.message } : { ok: true };
      },
      hold: async ({ id, until, reason }) => {
        const { error: rpcErr } = await admin.rpc(
          "official_outbox_hold" as never,
          { p_id: id, p_until: until, p_reason: reason } as never,
        );
        return rpcErr ? { ok: false, error: rpcErr.message } : { ok: true };
      },
      send: ({ to, subject, html, text, from, replyTo, idempotencyKey }) =>
        sendEmail(to, subject, html, text, { from, replyTo, idempotencyKey }),
      render: renderOfficialEmail,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (m) => console.error(m),
    },
    opts.limit === undefined ? {} : { limit: opts.limit },
  );
}
