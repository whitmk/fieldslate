import { Resend } from "resend";

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; status: number };

export type SendEmailOptions = {
  /** Set on the public form notifications so a reply in the inbox goes to
   *  the person who filled the form, not to the app's sender address. */
  replyTo?: string;
  /** A full From header ('"Name" <addr>'). Default: RESEND_FROM_EMAIL. The
   *  volunteer outbox builds it with volunteerFromHeader (sanitized). */
  from?: string;
  /** Sent as Resend's Idempotency-Key: a retried send with the same key is
   *  dropped by Resend instead of delivered twice. */
  idempotencyKey?: string;
};

/** The arguments sendEmail hands to resend.emails.send — split out so the
 *  sims can check them without a network. */
export function resendRequest(
  defaultFrom: string,
  to: string,
  subject: string,
  html: string,
  text: string | undefined,
  options: SendEmailOptions,
) {
  return {
    payload: {
      from: options.from ?? defaultFrom,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    },
    requestOptions: options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  };
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error:
        "Email is not configured. Set RESEND_API_KEY (and optionally RESEND_FROM_EMAIL) in your environment.",
    };
  }

  const resend = new Resend(apiKey);
  const { payload, requestOptions } = resendRequest(from, to, subject, html, text, options);
  const res = await resend.emails.send(payload, requestOptions);

  if (res.error) {
    return {
      ok: false,
      status: 500,
      error: res.error.message ?? "Failed to send email.",
    };
  }

  return { ok: true, id: res.data?.id ?? null };
}
