// "Request a demo" — the ONE place the form's options, limits, server
// validation and notification email live. The page, the form and the API
// route all import from here; nothing is duplicated in a surface.
//
// The pick-list options and the length caps MUST match migration 0101's
// CHECK constraints (sim:demo-request parses the migration and compares), so
// the route's validation is what a prospect meets and the database CHECK is
// a backstop that cannot fire on validated input.
//
// Pure: no I/O. The route does the spam check, the insert, the send and the
// row update in that order (see src/app/api/demo-request/route.ts).

export const DEMO_INBOX = "hello@thefieldslate.com";

export const DEMO_ROLES = ["President", "Scheduler", "Board member", "Other"] as const;
export const DEMO_SPORTS = ["Baseball/softball", "Soccer", "Flag football", "Other"] as const;
export const DEMO_INTERLEAGUE = ["Yes", "No", "Not sure"] as const;
export const DEMO_TIMEZONES = ["Pacific", "Mountain", "Central", "Eastern", "Other"] as const;

export type DemoRole = (typeof DEMO_ROLES)[number];
export type DemoSport = (typeof DEMO_SPORTS)[number];
export type DemoInterleague = (typeof DEMO_INTERLEAGUE)[number];
export type DemoTimezone = (typeof DEMO_TIMEZONES)[number];

/** Length caps — identical to demo_requests_lengths_check in 0101. */
export const DEMO_LIMITS = {
  name: 200,
  email: 320,
  league_name: 200,
  phone: 50,
  divisions_teams: 500,
  fields_parks: 500,
  current_scheduling_tool: 200,
  registration_platform: 200,
  next_season_start: 200,
  best_times: 500,
  notes: 5000,
} as const;

export type DemoRequest = {
  name: string;
  email: string;
  league_name: string;
  role: DemoRole;
  sport: DemoSport;
  phone: string | null;
  divisions_teams: string | null;
  fields_parks: string | null;
  plays_interleague: DemoInterleague | null;
  current_scheduling_tool: string | null;
  registration_platform: string | null;
  next_season_start: string | null;
  timezone: DemoTimezone | null;
  best_times: string | null;
  notes: string | null;
};

export type DemoValidation =
  | { ok: true; data: DemoRequest }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function optional(v: unknown): string | null {
  const s = str(v);
  return s.length === 0 ? null : s;
}
function pick<T extends readonly string[]>(v: unknown, options: T): T[number] | null {
  const s = str(v);
  return (options as readonly string[]).includes(s) ? (s as T[number]) : null;
}

/** Server-side validation. Trims every field, requires the five required
 *  ones, checks the pick-lists against their options, reads an empty optional
 *  as null, and refuses anything over its cap. Never trusts the client. */
export function validateDemoRequest(body: unknown): DemoValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const b = body as Record<string, unknown>;

  const name = str(b.name);
  const email = str(b.email);
  const league_name = str(b.league_name);
  const role = pick(b.role, DEMO_ROLES);
  const sport = pick(b.sport, DEMO_SPORTS);

  if (!name) return { ok: false, error: "Please enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };
  if (!league_name) return { ok: false, error: "Please enter your league's name." };
  if (!role) return { ok: false, error: "Please choose your role." };
  if (!sport) return { ok: false, error: "Please choose your sport." };

  const plays_interleague = str(b.plays_interleague) ? pick(b.plays_interleague, DEMO_INTERLEAGUE) : null;
  if (str(b.plays_interleague) && !plays_interleague) return { ok: false, error: "Please choose Yes, No or Not sure for interleague." };
  const timezone = str(b.timezone) ? pick(b.timezone, DEMO_TIMEZONES) : null;
  if (str(b.timezone) && !timezone) return { ok: false, error: "Please choose a time zone from the list." };

  const data: DemoRequest = {
    name,
    email,
    league_name,
    role,
    sport,
    phone: optional(b.phone),
    divisions_teams: optional(b.divisions_teams),
    fields_parks: optional(b.fields_parks),
    plays_interleague,
    current_scheduling_tool: optional(b.current_scheduling_tool),
    registration_platform: optional(b.registration_platform),
    next_season_start: optional(b.next_season_start),
    timezone,
    best_times: optional(b.best_times),
    notes: optional(b.notes),
  };

  for (const key of Object.keys(DEMO_LIMITS) as (keyof typeof DEMO_LIMITS)[]) {
    const v = data[key];
    if (typeof v === "string" && v.length > DEMO_LIMITS[key]) {
      return { ok: false, error: `${LABELS[key]} is too long (${DEMO_LIMITS[key]} characters at most).` };
    }
  }
  return { ok: true, data };
}

/** Labels, in the order the email lists them. Interleague sits near the top
 *  on purpose: it is the first thing Whit wants to know. */
export const LABELS: Record<keyof DemoRequest, string> = {
  name: "Name",
  email: "Email",
  league_name: "League",
  role: "Role",
  sport: "Sport",
  plays_interleague: "Plays other leagues (interleague)",
  phone: "Phone",
  divisions_teams: "Divisions and teams",
  fields_parks: "Fields or parks shared",
  current_scheduling_tool: "Current scheduling tool",
  registration_platform: "Registration platform",
  next_season_start: "Next season starts",
  timezone: "Time zone",
  best_times: "Good times to talk",
  notes: "Anything else",
};

export const EMAIL_ORDER = Object.keys(LABELS) as (keyof DemoRequest)[];

export const BLANK = "—";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function demoEmailSubject(d: Pick<DemoRequest, "league_name" | "sport">): string {
  return `Demo request — ${d.league_name} (${d.sport})`;
}

/** The notification to hello@: every answer, labelled, blank optionals as
 *  "—", interleague near the top. `siteUrl` is for the logo only. */
export function buildDemoEmail(d: DemoRequest, siteUrl: string): { subject: string; text: string; html: string } {
  const value = (k: keyof DemoRequest): string => {
    const v = d[k];
    return v == null || v === "" ? BLANK : v;
  };
  const text = [
    "New demo request",
    "",
    ...EMAIL_ORDER.map((k) => `${LABELS[k]}: ${value(k)}`),
    "",
    "Reply to this email to answer the requester directly.",
  ].join("\n");

  const rows = EMAIL_ORDER.map((k) => {
    const v = value(k);
    const cell =
      k === "email" && v !== BLANK
        ? `<a href="mailto:${escapeHtml(v)}" style="color:#22C55E;text-decoration:none;">${escapeHtml(v)}</a>`
        : escapeHtml(v).replace(/\n/g, "<br>");
    return `          <tr>
            <td style="padding:8px 0;color:#6b7280;width:200px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">${escapeHtml(LABELS[k])}</td>
            <td style="padding:8px 0;color:#0C1F3F;${k === "plays_interleague" ? "font-weight:600;" : ""}">${cell}</td>
          </tr>`;
  }).join("\n");

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;background:#f6f7f9;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="background:#0C1F3F;padding:20px 24px;">
      <img src="${siteUrl}/brand/lockup-email-dark-2x.png" alt="FieldSlate" width="160" height="36" style="display:block;border:0;outline:none;text-decoration:none;" />
      <p style="margin:2px 0 0;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Demo request</p>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #f3f4f6;background:#fafafa;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        Reply to this email to answer the requester — replies go to ${escapeHtml(d.email)}, not to the app's sender address.
      </p>
    </div>
  </div>
</body></html>`;

  return { subject: demoEmailSubject(d), text, html };
}
