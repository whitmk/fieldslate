// Season purchases (0111): every decision and every sentence, pure.
//
// The DATABASE decides what may be bought (begin_season_purchase) and what a
// payment does (process_checkout_event). This module only decides which
// SCREEN to show for the state the server read, and words every reply.
// Screens render these sentences VERBATIM; never hand-write one at a call
// site. Prices come from ./prices, never typed here.
//
// Harness: npm run sim:season-purchase (+ :mutants).

import { ELITE_FEATURES, PLAN_LIMITS, type Plan } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";
import { priceLabel, type PaidTier } from "./prices";

export type PurchaseKind =
  | "add_season"
  | "first_season"
  | "convert_free"
  | "upgrade_tier"
  | "signup";

export const PURCHASE_KINDS: readonly PurchaseKind[] = [
  "add_season",
  "first_season",
  "convert_free",
  "upgrade_tier",
  "signup",
];

export const CONTACT_EMAIL = "hello@thefieldslate.com";

// ── Which screen "New season" shows ─────────────────────────────────────────

export type NewSeasonState = {
  plan: Plan;
  comped: boolean;
  /** Unarchived seasons. */
  activeCount: number;
  /** season_purchases rows `credited` with no league yet. */
  creditCount: number;
  /** The oldest active season's name (the one a Free upgrade converts). */
  activeSeasonName: string | null;
};

/**
 * "create"       — the plain form; create_league makes the season (Free with
 *                  nothing active, a comped league, or a paid league using a
 *                  credit).
 * "add_season"   — the form, then checkout at the league's current plan.
 * "first_season" — the form plus a Pro/Elite choice (nothing active).
 * "convert_free" — a Free league with its season active: upgrade that season.
 */
export type NewSeasonScreen = "create" | "add_season" | "first_season" | "convert_free";

export function newSeasonScreen(s: NewSeasonState): NewSeasonScreen {
  // Comped: billing is FieldSlate's, so seasons are created freely.
  if (s.comped) return "create";
  if (s.plan === "free") return s.activeCount === 0 ? "create" : "convert_free";
  // Paid: a season is paid for. An unused credit already paid for one.
  if (s.creditCount > 0) return "create";
  return s.activeCount > 0 ? "add_season" : "first_season";
}

/**
 * A feature-lock upgrade ("Upgrade to unlock") from the league's state —
 * decided on the SERVER from the plan and active count it read, never from
 * the request. null = nothing to buy.
 */
export function upgradeKindFor(
  plan: Plan,
  activeCount: number,
  tier: PaidTier,
): "convert_free" | "upgrade_tier" | "signup" | null {
  if (plan === "free") return activeCount > 0 ? "convert_free" : "signup";
  if (plan === "pro" && tier === "elite") return "upgrade_tier";
  return null;
}

// ── Words ───────────────────────────────────────────────────────────────────

/** The comped sentence; "contact us" is the link to CONTACT_EMAIL. */
export const BILLING_MANAGED = {
  before: "This league’s billing is managed by FieldSlate — ",
  link: "contact us",
  after: ".",
} as const;

export function billingManagedText(): string {
  return `${BILLING_MANAGED.before}${BILLING_MANAGED.link}${BILLING_MANAGED.after}`;
}

/** A refusal from begin_season_purchase, or the route, in plain English. */
export function purchaseErrorMessage(code: string, field?: string | null): string {
  switch (code) {
    case "billing_managed":
      return billingManagedText();
    case "kind_not_allowed":
      return "Your league changed since this page loaded. Refresh the page and try again.";
    case "tier_required":
      return "Choose Pro or Elite.";
    case "invalid_season":
      switch (field) {
        case "name":
          return "Give the season a name (up to 120 characters).";
        case "sport":
          return "Choose a sport.";
        case "season_label":
          return "The season label can be up to 60 characters.";
        case "dates":
          return "Enter a start date and an end date.";
        case "end_before_start":
          return "The season can’t end before it starts.";
        default:
          return "Check the season details and try again.";
      }
    case "price_unavailable":
      return "Checkout is unavailable right now — nothing was charged. Please try again in a few minutes.";
    default:
      return "Could not start checkout. Please try again.";
  }
}

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The "what you lose" line for a league choosing a LOWER plan (only Elite →
 * Pro exists). Built from PLAN_LIMITS and ELITE_FEATURES, never typed.
 * null when nothing is lost.
 */
export function loseLine(from: Plan, to: PaidTier): string | null {
  if (!(from === "elite" && to === "pro")) return null;
  const pro = PLAN_LIMITS.pro;
  const features = joinList(ELITE_FEATURES.map((f) => f.lose));
  return (
    `Choosing Pro moves your whole league to Pro. You’ll lose ${features}. ` +
    `Partner leagues are limited to ${pro.interleagueOrgsPerSeason} per season ` +
    `and admin seats to ${pro.admins}.`
  );
}

export const TIER_HIGHLIGHTS: Record<PaidTier, readonly string[]> = {
  pro: [
    "Unlimited divisions and teams",
    `Interleague scheduling (up to ${PLAN_LIMITS.pro.interleagueOrgsPerSeason} partner leagues/season)`,
    "Rainout rescheduler, practice scheduling, activity log",
    `Up to ${PLAN_LIMITS.pro.admins} admin seats`,
  ],
  elite: [
    "Everything in Pro",
    "Playoff & tournament brackets, officials assignments",
    "Snack shack scheduling, reports dashboard",
    `Unlimited interleague partners · up to ${PLAN_LIMITS.elite.admins} admin seats`,
  ],
};

/** "Add season — " + the tier's price. */
export function addSeasonButton(tier: PaidTier): string {
  return `Add season — ${priceLabel(tier)}`;
}

/** "Upgrade {season} — " + the tier's price. */
export function convertButton(seasonName: string, tier: PaidTier): string {
  return `Upgrade ${seasonName} — ${priceLabel(tier)}`;
}

export const CHECKOUT_FINE_PRINT =
  "You’ll pay on Stripe’s secure page. Leaving checkout charges nothing and creates nothing.";

// ── After Stripe: the purchase page ─────────────────────────────────────────

export type PurchaseRow = {
  id: string;
  kind: string;
  tier: string;
  status: string;
  needs_review: boolean;
  league_id: string | null;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type PurchasePageState =
  | "waiting"
  | "slow"
  | "ready"
  | "upgraded"
  | "flagged"
  | "abandoned"
  | "unreadable";

/** After this long with no answer, the page says it is taking a while. */
export const SLOW_AFTER_MS = 30_000;

export function purchasePageState(row: PurchaseRow | null, elapsedMs: number): PurchasePageState {
  if (!row) return "unreadable";
  // A flag with NO season wins over every other status: the payment was
  // received, did not create what was bought, and a person will finish it.
  // A flagged purchase that DID create its season (the plan moved between
  // checkout and payment — a price question for FieldSlate, already
  // emailed) is simply ready: the page must never say "we didn't create
  // the season" about a season that exists.
  if (row.needs_review && !row.league_id) return "flagged";
  if (row.status === "abandoned") return "abandoned";
  if (row.status === "pending") return elapsedMs >= SLOW_AFTER_MS ? "slow" : "waiting";
  if (row.status === "completed" && row.league_id) return "ready";
  if (row.status === "completed" || row.status === "credited") return "upgraded";
  return "unreadable";
}

// ── needs_review: the email to FieldSlate ───────────────────────────────────

export const NEEDS_REVIEW_TO = CONTACT_EMAIL;

/** One sentence per flag reason process_checkout_event can write. */
export function reviewReasonSentence(reason: string): string {
  const cut = reason.indexOf(":");
  const code = cut < 0 ? reason : reason.slice(0, cut);
  const detail = cut < 0 ? undefined : reason.slice(cut + 1);
  switch (code) {
    case "purchase_not_found":
      return "The payment named a purchase that doesn’t exist.";
    case "purchase_belongs_to_another_league":
      return "The payment named a purchase that belongs to another league.";
    case "purchase_not_pending":
      return `The purchase was already ${detail ?? "finished"} — this looks like a second payment for it.`;
    case "tier_mismatch":
      return `Stripe charged a different plan than the purchase was for (${detail ?? "unknown"}).`;
    case "upgrade_flag_mismatch":
      return "The payment's upgrade flag doesn't match the purchase.";
    case "quantity_not_one":
      return "The payment was for a quantity other than 1.";
    case "plan_changed":
      return `The league’s plan changed (${(detail ?? "").replace("->", " → ")}) between checkout and payment — check the price paid.`;
    case "season_active_at_payment":
      return "A season became active between checkout and payment, so the plan was not lowered.";
    case "already_paid":
      return `The league was already on ${detail ?? "a paid plan"} when the upgrade was paid.`;
    case "not_on_pro":
      return `The ${priceLabel("elite", true)} Elite upgrade was paid while the league was on ${detail ?? "another plan"} — no change was made.`;
    default:
      return `Flag reason: ${reason}`;
  }
}

/** What process_checkout_event did with the money, for the email. */
export function outcomeSentence(outcome: string | null | undefined): string {
  switch (outcome) {
    case "credited":
      return "The payment was kept as a season credit. Nothing else changed.";
    case "flagged":
      return "No credit and no plan change were made. Refund or fix it by hand.";
    case "season_created":
      return "The season was created; the plan was not lowered.";
    default:
      return `Outcome: ${outcome ?? "unknown"}.`;
  }
}

export type ReviewEmailInput = {
  leagueName: string;
  orgId: string;
  kind: string;
  outcome: string | null;
  reason: string;
  amountCents: number | null;
  currency: string | null;
  purchaseId: string | null;
  sessionId: string;
  eventId: string;
};

function money(cents: number | null, currency: string | null): string {
  if (cents === null) return "unknown amount";
  const amount = (cents / 100).toFixed(2);
  return currency && currency.toLowerCase() !== "usd"
    ? `${amount} ${currency.toUpperCase()}`
    : `$${amount}`;
}

const KIND_LABEL: Record<string, string> = {
  add_season: "Add season",
  first_season: "First season (plan chosen)",
  convert_free: "Upgrade a Free season",
  upgrade_tier: "Pro → Elite upgrade",
  signup: "Paid signup",
  unmatched: "Payment with no matching purchase",
};

export function reviewEmail(i: ReviewEmailInput): { subject: string; text: string; html: string } {
  const amount = money(i.amountCents, i.currency);
  const kind = KIND_LABEL[i.kind] ?? i.kind;
  const lines = [
    `A payment needs review.`,
    ``,
    `League: ${i.leagueName} (${i.orgId})`,
    `What was bought: ${kind}`,
    `Amount: ${amount}`,
    `Why it was flagged: ${reviewReasonSentence(i.reason)}`,
    `What happened: ${outcomeSentence(i.outcome)}`,
    ``,
    `Purchase: ${i.purchaseId ?? "none"}`,
    `Stripe checkout session: ${i.sessionId}`,
    `Stripe event: ${i.eventId}`,
    `Raw reason: ${i.reason}`,
  ];
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    subject: `Payment needs review — ${i.leagueName} — ${amount}`,
    text: lines.join("\n"),
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${lines
      .map((l) => (l ? esc(l) : "&nbsp;"))
      .join("<br>")}</div>`,
  };
}

/** "Elite" — plan names on these screens come from the one label map. */
export function tierName(tier: PaidTier): string {
  return planLabel(tier);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Apr 3 – May 22, 2027" from two YYYY-MM-DD strings, read as wall-clock
 *  dates (never parsed into an instant). "" when either is missing. */
export function seasonDateRange(start: string, end: string): string {
  const parse = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
  };
  const a = parse(start);
  const b = parse(end);
  if (!a || !b) return "";
  const left = `${MONTHS[a.mo - 1]} ${a.d}${a.y !== b.y ? `, ${a.y}` : ""}`;
  return `${left} – ${MONTHS[b.mo - 1]} ${b.d}, ${b.y}`;
}

/** The screen's heading and the sentence under it. */
export function newSeasonHeading(
  screen: NewSeasonScreen,
  s: NewSeasonState,
): { title: string; sub: string } {
  switch (screen) {
    case "create":
      return { title: "Create a season", sub: "Enter the basics — you can add divisions and teams after." };
    case "add_season": {
      const tier = s.plan === "free" ? "pro" : s.plan;
      return {
        title: "Add a season",
        sub: `Your league is on ${planLabel(s.plan)}. Each season is paid once — ${priceLabel(tier)}, no subscription.`,
      };
    }
    case "first_season":
      return {
        title: "Add a season",
        sub: "You have no active seasons, so you can choose the plan for this one. The plan applies to your whole league.",
      };
    case "convert_free":
      return {
        title: "Upgrade this season",
        sub: `The Free plan includes one active season. Upgrade ${s.activeSeasonName ?? "your current season"} to a paid plan — everything in it stays as it is. After that you can add seasons at your new plan’s price.`,
      };
  }
}

/** Every sentence on the purchase page, per state. Rendered verbatim. */
export function purchasePageCopy(
  state: PurchasePageState,
  row: PurchaseRow | null,
): { title: string; lines: string[]; meta?: string } {
  const name = row?.name ?? "Your season";
  const tier = row?.tier === "pro" || row?.tier === "elite" ? (row.tier as PaidTier) : null;
  switch (state) {
    case "waiting":
      return {
        title: "Payment received — creating your season",
        lines: [
          `This usually takes a few seconds. You can leave this page; ${name} will be on your Seasons page when it’s ready.`,
        ],
      };
    case "slow":
      return {
        title: "Still working on it",
        lines: [
          "This is taking longer than usual. Your payment went through and your season will appear on your Seasons page — you don’t need to pay again.",
        ],
      };
    case "ready":
      return {
        title: `${name} is ready`,
        meta: [tier ? `${planLabel(tier)} season` : null, seasonDateRange(row?.start_date ?? "", row?.end_date ?? "")]
          .filter(Boolean)
          .join(" · "),
        lines: ["Stripe has emailed your receipt."],
      };
    case "upgraded":
      return {
        title: "Payment received",
        lines: [tier ? `Your league is on ${planLabel(tier)}.` : "Your league’s plan is updated.", "Stripe has emailed your receipt."],
      };
    case "flagged":
      return {
        title: "Payment received — we’ll finish this for you",
        lines: [
          "Something about this purchase didn’t match what we expected, so we didn’t create the season automatically. Your payment is safe and held as a credit for one season. FieldSlate has been notified and will be in touch.",
          "You won’t be charged again.",
        ],
      };
    case "abandoned":
      return {
        title: "Checkout didn’t start",
        lines: ["Nothing was charged. You can try again from your Seasons page."],
      };
    case "unreadable":
      return {
        title: "We couldn’t read this purchase",
        lines: [
          "If you just paid, your payment is safe — refresh this page in a minute, or check your Seasons page.",
        ],
      };
  }
}
