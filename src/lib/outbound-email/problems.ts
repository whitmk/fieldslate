// Email problems for admins (0128, 2026-11-10): the banner on the Volunteers
// "Who signed up" page and the Officials page. Pure: parses the reply of
// volunteer_email_problems / official_email_problems and builds every
// sentence the banner shows, rendered verbatim.
//
// RULES
//   * Names leave the database ONLY through those two functions (members,
//     Elite). This module and the banner are admin-only: no public page or
//     public API route may import them (sim:outbox-quota F1).
//   * A reply we can't read is "Couldn't check for email problems." — never
//     an empty banner, which would read as "nothing went wrong".
//   * "Sent" means the email left FieldSlate. Bounces are invisible (no
//     Resend webhook), and the banner says so.
//   * Times are shown in the LEAGUE's timezone; dates of games come from the
//     stored wall clock (never re-read in a timezone).

export type ProblemsFeature = "volunteers" | "officials";

export type EmailProblem = {
  id: number;
  kind: string;
  error: string | null;
  who: string;
  what: string | null;
};

export type EmailProblems = {
  failed: EmailProblem[];
  waiting: { count: number; reason: "quota_daily" | "quota_monthly"; until: string | null };
  triggerFailures: number;
  timezone: string;
};

export type ProblemsView = {
  summary: string;
  items: { id: number; line: string; why: string }[];
  ackIds: number[];
  hasTriggerFailures: boolean;
};

export const PROBLEMS_UNREADABLE = "Couldn't check for email problems.";
export const PROBLEMS_HELP =
  "Emails that left FieldSlate count as sent. We can't see whether they reached the inbox.";
export const PROBLEMS_ACK_FAILED = "Couldn't mark these as seen. Try again.";
export const PROBLEMS_ACK_LABEL = "Mark as seen";

export const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

const KIND_LABELS: Record<string, string> = {
  // volunteers
  signup_confirmed: "Sign-up confirmation",
  admin_assigned: "Assigned by the league",
  admin_canceled: "Canceled by the league",
  canceled_by_volunteer: "Cancel confirmation",
  game_moved: "Game moved",
  rained_out: "Rained out",
  makeup_set: "Makeup set",
  back_on: "Back on",
  spot_lost: "Spot lost",
  shift_changed: "Shift hours changed",
  shift_canceled: "Shift canceled",
  reminder: "Reminder",
  nudge: "Reminder to sign up",
  // officials
  help_request: "Ask for help",
  claim_confirmed: "Sign-up confirmation",
  drop_confirmed: "Drop confirmation",
  drop_notice: "Dropped spot notice",
  claims_digest: "Daily sign-ups summary",
  game_changes: "Game change notice",
  assignment_conflicts: "Assignment check",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Email";
}

/** Why a row failed, in words. Unknown errors (a provider's message) are
 *  "Couldn't be sent" — the raw text is in the log, never on the screen. */
export function whyLine(error: string | null): string {
  switch (error) {
    case "bad_recipient":
      return "No usable email address";
    case "no_email":
      return "No email on file";
    case "no_contact_email":
      return "No confirmed contact email";
    case "feature_off":
      return "Sign-ups were switched off";
    case "bad_reply_to":
      return "The contact email couldn't be used";
    case "unknown_kind":
      return "Couldn't be written";
    default:
      return "Couldn't be sent";
  }
}

/** "Sat, Oct 17" from a stored wall-clock "YYYY-MM-DDTHH:MI" (no timezone). */
export function wallDay(start: string | null): string | null {
  if (!start || !/^\d{4}-\d{2}-\d{2}/.test(start)) return null;
  const d = new Date(`${start.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** "Expos vs Mets" from two names, or the one there is. */
export function matchup(home: string | null, away: string | null): string | null {
  return home && away ? `${home} vs ${away}` : home ?? away;
}

/** How a feature describes one failed row: who it was for and what it was
 *  about. Each feature supplies its own (it knows its own columns). null =
 *  the row can't be read. */
export type DescribeProblem = (row: Record<string, unknown>) => { who: string; what: string | null } | null;

/** The problems reply, or null when it can't be read. */
export function parseProblems(raw: unknown, feature: ProblemsFeature, describe: DescribeProblem): EmailProblems | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.failed)) return null;
  const w = obj(o.waiting);
  if (!w || typeof w.count !== "number") return null;
  const failed: EmailProblem[] = [];
  for (const r of o.failed) {
    const f = obj(r);
    if (!f || typeof f.id !== "number" || typeof f.kind !== "string") return null;
    const d = describe(f);
    if (!d) return null;
    failed.push({ id: f.id, kind: f.kind, error: str(f.error), who: d.who, what: d.what });
  }
  // Both features return the count (volunteers 0128, officials 0130).
  const triggerFailures = typeof o.trigger_failures === "number" ? o.trigger_failures : NaN;
  if (!Number.isFinite(triggerFailures)) return null;
  return {
    failed,
    waiting: {
      count: w.count,
      reason: w.reason === "quota_monthly" ? "quota_monthly" : "quota_daily",
      until: str(w.until),
    },
    triggerFailures,
    timezone: str(o.timezone) ?? "America/Los_Angeles",
  };
}

/** "4:00 PM" — an instant shown in the league's timezone. */
export function leagueTime(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Everything the banner shows, or null when there is nothing to show. */
export function problemsView(p: EmailProblems, feature: ProblemsFeature): ProblemsView | null {
  const parts: string[] = [];
  const n = p.failed.length;
  if (n > 0) parts.push(`${n} ${plural(n, "email didn't", "emails didn't")} go out.`);
  if (p.waiting.count > 0) {
    const c = p.waiting.count;
    const at = leagueTime(p.waiting.until, p.timezone);
    const are = `${c} ${plural(c, "email is", "emails are")} waiting`;
    parts.push(
      p.waiting.reason === "quota_monthly"
        ? `${are}: the monthly email limit was reached.${at ? ` FieldSlate will try again at ${at}.` : ""}`
        : `${are} for the daily email limit to reset${at ? ` at ${at}` : ""}.`,
    );
  }
  if (p.triggerFailures > 0) {
    const t = p.triggerFailures;
    parts.push(
      `${t} schedule ${plural(t, "change", "changes")} couldn't be checked for ${feature === "volunteers" ? "volunteer" : "officials'"} emails.`,
    );
  }
  if (parts.length === 0) return null;
  return {
    summary: parts.join(" "),
    items: p.failed.map((f) => ({
      id: f.id,
      line: `${f.who} — ${kindLabel(f.kind)}${f.what ? ` · ${f.what}` : ""}`,
      why: whyLine(f.error),
    })),
    ackIds: p.failed.map((f) => f.id),
    hasTriggerFailures: p.triggerFailures > 0,
  };
}

/** The one-line pointer on the Volunteers roles page, or null. */
export function volunteerPointerLine(p: EmailProblems): string | null {
  const n = p.failed.length;
  if (n > 0) return `${n} volunteer ${plural(n, "email didn't", "emails didn't")} go out — see Who signed up.`;
  if (p.waiting.count > 0) {
    const c = p.waiting.count;
    return `${c} volunteer ${plural(c, "email is", "emails are")} waiting for the email limit — see Who signed up.`;
  }
  if (p.triggerFailures > 0) return "Some schedule changes couldn't be checked for volunteer emails — see Who signed up.";
  return null;
}

/** A feature's two database functions. Each feature names its own
 *  (src/lib/volunteers/email-problems.ts, src/lib/officials-signup/
 *  email-problems.ts): this shared module names neither, so the officials
 *  code never names a volunteer function (sim:volunteer-leaks U1). */
export type ProblemsRpc = { read: string; ack: string };

/** Everything a feature hands the shared banner and loader. */
export type ProblemsSpec = { feature: ProblemsFeature; rpc: ProblemsRpc; describe: DescribeProblem };

/** The ack call's arguments. */
export function ackArgs(feature: ProblemsFeature, seasonId: string, view: ProblemsView): Record<string, unknown> {
  return feature === "volunteers"
    ? { p_season_id: seasonId, p_ids: view.ackIds, p_trigger_failures: view.hasTriggerFailures }
    : { p_season_id: seasonId, p_ids: view.ackIds };
}

/** A database refusal that means "no banner, by design": the feature is off
 *  for this league (no emails go out at all). Anything else is unreadable. */
export function problemsReadIsOff(message: string | null | undefined): boolean {
  return typeof message === "string" && /\bfeature_off\b/.test(message);
}
