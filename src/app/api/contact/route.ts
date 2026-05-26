import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const CONTACT_INBOX = "hello@thefieldslate.com";

const REQUEST_TYPES = [
  "General inquiry",
  "Data access request",
  "Data deletion request",
  "Data correction request",
  "Other",
] as const;

type RequestType = (typeof REQUEST_TYPES)[number];

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

export async function POST(request: Request) {
  let body: {
    name?: unknown;
    email?: unknown;
    request_type?: unknown;
    message?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const requestType =
    typeof body.request_type === "string" ? body.request_type.trim() : "";
  const message =
    typeof body.message === "string" ? body.message.trim() : "";

  // Validation — server mirrors the client form so we never trust the client.
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }
  if (!REQUEST_TYPES.includes(requestType as RequestType)) {
    return NextResponse.json(
      { error: "Please choose a request type." },
      { status: 400 },
    );
  }
  if (!message) {
    return NextResponse.json(
      { error: "Please include a message." },
      { status: 400 },
    );
  }
  // Reasonable upper bounds — defense in depth against accidental dumps.
  if (name.length > 200 || email.length > 320 || message.length > 5000) {
    return NextResponse.json(
      { error: "One or more fields exceed the allowed length." },
      { status: 400 },
    );
  }

  const subject = `[FieldSlate Contact] ${requestType} from ${name}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:20px 24px;">
      <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">FieldSlate</p>
      <p style="margin:2px 0 0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Contact form submission</p>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>
          <tr>
            <td style="padding:8px 0;color:#6b7280;width:120px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Name</td>
            <td style="padding:8px 0;color:#0C1F3F;">${escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Email</td>
            <td style="padding:8px 0;color:#0C1F3F;"><a href="mailto:${escapeHtml(email)}" style="color:#22C55E;text-decoration:none;">${escapeHtml(email)}</a></td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Type</td>
            <td style="padding:8px 0;color:#0C1F3F;font-weight:600;">${escapeHtml(requestType)}</td>
          </tr>
        </tbody>
      </table>
      <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;"/>
      <p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
      <div style="color:#0C1F3F;font-size:14px;line-height:1.55;white-space:normal;">${nl2br(message)}</div>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        Reply directly to this thread — the requester's email is in the From metadata above.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `New contact form submission`,
    ``,
    `Name:  ${name}`,
    `Email: ${email}`,
    `Type:  ${requestType}`,
    ``,
    `Message:`,
    message,
  ].join("\n");

  const result = await sendEmail(CONTACT_INBOX, subject, html, text);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
