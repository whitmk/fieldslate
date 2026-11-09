// The one place the volunteer outbox drain is wired to the real database,
// email sender and clock. Used by the cron route (every 5 minutes) and by the
// sign-up route right after a claim, so a confirmation goes out at once
// rather than at the next cron. Server only: the admin client.
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { drainOutbox, type DrainSummary } from "./outbox-drain";
import { renderVolunteerEmail } from "./email-templates";

export async function runVolunteerDrain(opts: { limit?: number } = {}): Promise<DrainSummary> {
  const admin = createAdminClient();
  return drainOutbox(
    {
      envFrom: process.env.RESEND_FROM_EMAIL,
      take: async (limit) => {
        const { data, error } = await admin.rpc("volunteer_outbox_take" as never, { p_limit: limit } as never);
        return error ? { ok: false, error: error.message } : { ok: true, rows: data };
      },
      finish: async ({ id, ok, resendId, error, retry }) => {
        const { error: rpcErr } = await admin.rpc(
          "volunteer_outbox_finish" as never,
          { p_id: id, p_ok: ok, p_resend_id: resendId, p_error: error, p_retry: retry } as never,
        );
        return rpcErr ? { ok: false, error: rpcErr.message } : { ok: true };
      },
      send: ({ to, subject, html, text, from, replyTo, idempotencyKey }) =>
        sendEmail(to, subject, html, text, { from, replyTo, idempotencyKey }),
      render: renderVolunteerEmail,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (m) => console.error(m),
    },
    opts.limit === undefined ? {} : { limit: opts.limit },
  );
}
