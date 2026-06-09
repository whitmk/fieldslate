"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

// Safety net for the cross-device confirmation case: a user verified their
// email on a different device than they signed up on, so the PKCE code
// exchange in /api/auth/callback couldn't run and never bounced them into
// Stripe. They land here as plan=free with pending_plan still set. This CTA
// re-triggers the exact same checkout the callback would have (quantity:1 —
// the plan's included season; NO extra season is provisioned).
//
// Idempotency: the button disables on first click, and the server only renders
// this component while pending_plan is set AND plan is still free — so the
// moment the webhook flips the plan and clears pending_plan, the CTA is gone.
export function CompleteSetupCta({
  plan,
  planLabel,
  orgId,
}: {
  plan: "pro" | "elite";
  planLabel: string;
  orgId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setLoading(true);
    setError("");
    try {
      const origin = window.location.origin;
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          quantity: 1,
          orgId,
          successUrl: `${origin}/dashboard?welcome=true`,
          cancelUrl: `${origin}/dashboard`,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start checkout. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not start checkout. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#0C1F3F]/15 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-[#0C1F3F]">
          Finish setting up your {planLabel} plan
        </p>
        <p className="mt-0.5 text-sm text-gray-600">
          You picked {planLabel} at signup — complete checkout to activate it.
        </p>
        {error && <p className="mt-1.5 text-sm text-red-500">{error}</p>}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <>
            Complete setup
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
