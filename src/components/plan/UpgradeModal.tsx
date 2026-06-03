"use client";

// Item 13 upgrade modal — drives Stripe Checkout. Two modes:
//
//   reason="locked-feature"  Free user hit a Pro/Elite gate. Shows Pro vs
//                            Elite, each as a 2-season purchase (qty 2) so the
//                            existing Free season is converted, not lost.
//   reason="add-season"      Paid user adds a season at their current price
//                            (qty 1, no tier choice).
//
// On CTA click it POSTs to /api/stripe/checkout and redirects to the returned
// Stripe URL. NOTE: this is a standalone component — wiring it into the
// sidebar / specific pages happens in Item 14.

import { useState } from "react";
import { X, Lock, Check, Loader2 } from "lucide-react";
import { SEASON_PRICE_USD } from "@/lib/stripe";
import type { Plan } from "@/lib/plan/limits";

type PaidPlan = Exclude<Plan, "free">;

interface Props {
  reason: "locked-feature" | "add-season";
  orgId: string;
  /** Required for reason="add-season" — the org's current paid plan. */
  currentPlan?: Plan;
  onClose: () => void;
}

const HIGHLIGHTS: Record<PaidPlan, string[]> = {
  pro: [
    "Unlimited divisions and teams",
    "Interleague scheduling (up to 5 partner leagues/season)",
    "Rainout rescheduler, practice scheduling, activity log",
    "Up to 2 admin seats",
  ],
  elite: [
    "Everything in Pro",
    "Playoff & tournament brackets, officials assignments",
    "Snack shack scheduling, reports dashboard",
    "Unlimited interleague partners · up to 5 admin seats",
  ],
};

function priceLabel(plan: PaidPlan, quantity: number): string {
  return `$${SEASON_PRICE_USD[plan] * quantity}`;
}

export function SeasonUpgradeModal({ reason, orgId, currentPlan, onClose }: Props) {
  // Tracks which CTA is mid-flight so only that button shows a spinner.
  const [pending, setPending] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(plan: PaidPlan, quantity: 1 | 2) {
    setPending(plan);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          quantity,
          orgId,
          // Absolute URLs — Stripe requires them. The route forwards as-is.
          successUrl: `${window.location.origin}/dashboard?upgraded=true`,
          cancelUrl: `${window.location.origin}/dashboard`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "Could not start checkout. Please try again.");
        setPending(null);
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError("Network error. Please try again.");
      setPending(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22C55E]/10">
              <Lock className="h-4 w-4 text-[#16a34a]" />
            </span>
            <h2 className="text-base font-semibold text-[#0C1F3F]">
              {reason === "locked-feature" ? "Upgrade to unlock" : "Add a season"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {reason === "locked-feature" ? (
          <LockedFeatureBody
            pending={pending}
            onChoose={(plan) => startCheckout(plan, 2)}
          />
        ) : (
          <AddSeasonBody
            currentPlan={currentPlan}
            pending={pending}
            onAdd={(plan) => startCheckout(plan, 1)}
          />
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ── locked-feature: Pro vs Elite, 2-season pricing ──────────────────────────

function LockedFeatureBody({
  pending,
  onChoose,
}: {
  pending: PaidPlan | null;
  onChoose: (plan: PaidPlan) => void;
}) {
  return (
    <>
      <p className="mt-2 text-sm text-gray-600">
        That&apos;s a paid feature. Pick a plan to unlock it — each upgrade
        includes <span className="font-semibold text-[#0C1F3F]">2 seasons</span>.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(["pro", "elite"] as PaidPlan[]).map((plan) => (
          <div
            key={plan}
            className={`flex flex-col rounded-xl p-5 ${
              plan === "elite"
                ? "bg-[#0C1F3F] text-white"
                : "bg-white ring-1 ring-gray-200"
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${
                plan === "elite" ? "text-[#22C55E]" : "text-gray-400"
              }`}
            >
              {plan === "pro" ? "Pro" : "Elite"}
            </p>
            <div className="mt-1 flex items-baseline gap-1">
              <span
                className={`text-2xl font-bold ${
                  plan === "elite" ? "text-white" : "text-[#0C1F3F]"
                }`}
              >
                ${SEASON_PRICE_USD[plan]}
              </span>
              <span
                className={`text-xs ${
                  plan === "elite" ? "text-white/50" : "text-gray-400"
                }`}
              >
                /season
              </span>
            </div>

            <ul className="mt-3 flex flex-1 flex-col gap-2">
              {HIGHLIGHTS[plan].map((h) => (
                <li key={h} className="flex items-start gap-2 text-xs">
                  <Check
                    className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
                      plan === "elite" ? "text-[#22C55E]" : "text-[#22C55E]"
                    }`}
                  />
                  <span
                    className={plan === "elite" ? "text-white/70" : "text-gray-600"}
                  >
                    {h}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => onChoose(plan)}
              disabled={pending !== null}
              className={`mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                plan === "elite"
                  ? "bg-[#22C55E] text-white hover:bg-[#16a34a]"
                  : "bg-[#0C1F3F] text-white hover:bg-[#0C1F3F]/85"
              }`}
            >
              {pending === plan && <Loader2 className="h-4 w-4 animate-spin" />}
              {`Upgrade to ${plan === "pro" ? "Pro" : "Elite"} — ${priceLabel(
                plan,
                2,
              )} for 2 seasons`}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        Your current Free season will be converted to a paid season — not lost.
      </p>
    </>
  );
}

// ── add-season: single tier at the current plan price ───────────────────────

function AddSeasonBody({
  currentPlan,
  pending,
  onAdd,
}: {
  currentPlan?: Plan;
  pending: PaidPlan | null;
  onAdd: (plan: PaidPlan) => void;
}) {
  // add-season only applies to paid orgs; guard against a missing/free plan.
  if (currentPlan !== "pro" && currentPlan !== "elite") {
    return (
      <p className="mt-3 text-sm text-gray-600">
        Adding a season requires a paid plan.
      </p>
    );
  }
  const plan: PaidPlan = currentPlan;

  return (
    <>
      <p className="mt-2 text-sm text-gray-600">
        Add another active season to your{" "}
        <span className="font-semibold text-[#0C1F3F]">
          {plan === "pro" ? "Pro" : "Elite"}
        </span>{" "}
        plan.
      </p>

      <div className="mt-5 rounded-xl p-5 ring-1 ring-gray-200">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {plan === "pro" ? "Pro" : "Elite"} season
        </p>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-bold text-[#0C1F3F]">
            ${SEASON_PRICE_USD[plan]}
          </span>
          <span className="text-xs text-gray-400">/season</span>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {HIGHLIGHTS[plan].map((h) => (
            <li key={h} className="flex items-start gap-2 text-xs text-gray-600">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#22C55E]" />
              {h}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => onAdd(plan)}
          disabled={pending !== null}
          className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-60"
        >
          {pending === plan && <Loader2 className="h-4 w-4 animate-spin" />}
          {`Add season — ${priceLabel(plan, 1)}`}
        </button>
      </div>
    </>
  );
}
