"use client";

// The feature-lock upgrade modal ("Upgrade to unlock") — drives Stripe
// Checkout. A Free league picks Pro or Elite: with its season active that
// season is upgraded in place, with none the payment becomes a season credit.
// A Pro league moving to Elite pays the flat difference. The SERVER decides
// which from the league's state (`kind: "upgrade"`); this modal sends only
// the tier. Adding a season is NOT here — every "New season" goes through
// NewSeasonFlow. Prices come from src/lib/billing/prices.
//
// On CTA click it POSTs to /api/stripe/checkout and redirects to the returned
// Stripe URL.

import { useState } from "react";
import { X, Lock, Check, Loader2 } from "lucide-react";
import { SEASON_PRICE_USD } from "@/lib/billing/prices";
import { TIER_HIGHLIGHTS } from "@/lib/billing/season-purchase";
import { BillingManaged } from "@/components/seasons/new-season-flow";
import type { Plan } from "@/lib/plan/limits";

type PaidPlan = Exclude<Plan, "free">;

interface Props {
  reason: "locked-feature";
  orgId: string;
  /** The org's current plan — only tiers above it are offered. */
  currentPlan?: Plan;
  onClose: () => void;
}

const HIGHLIGHTS = TIER_HIGHLIGHTS;

function priceLabel(plan: PaidPlan): string {
  return `$${SEASON_PRICE_USD[plan]}`;
}

export function SeasonUpgradeModal({
  orgId,
  currentPlan,
  onClose,
}: Props) {
  // Tracks which CTA is mid-flight so only that button shows a spinner.
  const [pending, setPending] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingManaged, setBillingManaged] = useState(false);

  async function startCheckout(plan: PaidPlan) {
    setPending(plan);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // "upgrade": the server decides from the league's state whether this
        // upgrades the Free season, buys a credit, or is the Pro → Elite
        // difference. The route builds the return URLs.
        body: JSON.stringify({ kind: "upgrade", tier: plan, orgId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        if (data?.code === "billing_managed") setBillingManaged(true);
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
              Upgrade to unlock
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

        <LockedFeatureBody
          currentPlan={currentPlan}
          pending={pending}
          onChoose={(plan) => {
            // One purchase, quantity 1, never a second season.
            void startCheckout(plan);
          }}
        />

        {billingManaged ? (
          // Not an error: comped leagues' billing is FieldSlate's (mockup
          // screen 4) — a plain sentence with the contact link.
          <p className="mt-4 text-sm text-gray-700">
            <BillingManaged subject="Plan upgrade" />
          </p>
        ) : error ? (
          <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── locked-feature: Pro vs Elite, 2-season pricing ──────────────────────────

function LockedFeatureBody({
  currentPlan,
  pending,
  onChoose,
}: {
  currentPlan?: Plan;
  pending: PaidPlan | null;
  onChoose: (plan: PaidPlan, upgradeOnly: boolean) => void;
}) {
  // Only offer tiers ABOVE the user's current plan — a Pro user shouldn't be
  // shown the Pro card they already have. Absent currentPlan we treat them as
  // Free and show everything.
  const RANK: Record<Plan, number> = { free: 0, pro: 1, elite: 2 };
  const currentRank = RANK[currentPlan ?? "free"];
  const offers = (["pro", "elite"] as PaidPlan[]).filter(
    (p) => RANK[p] > currentRank,
  );
  // The "converted, not lost" footnote only applies to a Free→paid upgrade:
  // that flow converts the org's current Free season in place. A paid org
  // (Pro→Elite) has no Free season to convert, so it never shows.
  const isFreeUpgrade = currentRank === 0;

  if (offers.length === 0) {
    return (
      <p className="mt-3 text-sm text-gray-600">
        You already have access to every feature on your plan.
      </p>
    );
  }

  return (
    <>
      <p className="mt-2 text-sm text-gray-600">
        {isFreeUpgrade ? (
          <>That&apos;s a paid feature. Pick a plan to unlock it.</>
        ) : (
          <>That&apos;s an Elite feature. Upgrade this season to unlock it.</>
        )}
      </p>

      <div
        className={`mt-5 grid grid-cols-1 gap-4 ${
          offers.length > 1 ? "sm:grid-cols-2" : ""
        }`}
      >
        {offers.map((plan) => {
          // Pro→Elite is a tier upgrade, not a new season: charge the
          // one-time difference for this season.
          const isProToElite = currentPlan === "pro" && plan === "elite";
          return (
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
                $
                {isProToElite
                  ? SEASON_PRICE_USD.pro_to_elite
                  : SEASON_PRICE_USD[plan]}
              </span>
              <span
                className={`text-xs ${
                  plan === "elite" ? "text-white/50" : "text-gray-400"
                }`}
              >
                {isProToElite ? "one-time upgrade" : "/season"}
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
              onClick={() => onChoose(plan, isProToElite)}
              disabled={pending !== null}
              className={`mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                plan === "elite"
                  ? "bg-[#22C55E] text-white hover:bg-[#16a34a]"
                  : "bg-[#0C1F3F] text-white hover:bg-[#0C1F3F]/85"
              }`}
            >
              {pending === plan && <Loader2 className="h-4 w-4 animate-spin" />}
              {isProToElite
                ? `Upgrade to Elite for just $${SEASON_PRICE_USD.pro_to_elite}`
                : `Upgrade to ${plan === "pro" ? "Pro" : "Elite"} · ${priceLabel(
                    plan,
                  )}/season`}
            </button>

            {isProToElite && (
              <p className="mt-3 text-center text-xs text-white/50">
                Pay ${SEASON_PRICE_USD.pro_to_elite} more to unlock all Elite
                features for this season.
              </p>
            )}
          </div>
          );
        })}
      </div>

      {isFreeUpgrade && (
        <p className="mt-4 text-center text-xs text-gray-400">
          Your current Free season will be converted to a paid season — not lost.
        </p>
      )}
    </>
  );
}
