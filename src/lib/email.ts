import { Resend } from "resend";

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; status: number };

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
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
  const res = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
  });

  if (res.error) {
    return {
      ok: false,
      status: 500,
      error: res.error.message ?? "Failed to send email.",
    };
  }

  return { ok: true, id: res.data?.id ?? null };
}
