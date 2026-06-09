"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

// Shown once after a successful post-signup checkout (success_url carries
// ?welcome=true). Auto-dismisses after 5s or on click. `planLabel` is resolved
// server-side from profiles.plan, falling back to the pending plan during the
// brief window before the Stripe webhook flips the tier (see DashboardPage).
export function WelcomeBanner({ planLabel }: { planLabel: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/10 px-5 py-4">
      <div>
        <p className="text-sm font-semibold text-[#0C1F3F]">
          Welcome to FieldSlate — your {planLabel} plan is active.
        </p>
        <p className="mt-0.5 text-sm text-gray-600">
          Create your first season to get started.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        className="flex-shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
