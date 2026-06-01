"use client";

// A feature-locked wizard step. Rendered IN PLACE of a real step (Umpires for
// non-Elite, Interleague for Free) so the gated step still appears in the
// wizard's flow and step indicator, but its body is an upsell + a Skip button
// that advances past it. Visually consistent with the wizard chrome (not a
// modal); the "Upgrade to <tier>" button opens the shared UpgradeModal in
// feature mode.

import { useState } from "react";
import { Lock, Check, ChevronRight } from "lucide-react";
import { UpgradeModal, type UpgradeTier } from "@/components/plan/upgrade-cta";

interface Props {
  /** Human feature label, e.g. "Umpire assignment", "Interleague play". */
  feature: string;
  /** Tier the upsell points at. */
  tier: UpgradeTier;
  /** Short sentence describing what the feature does. */
  description: string;
  /** Bullet list of what the user unlocks on upgrade. */
  previewBenefits: string[];
  /** Advance the wizard past this step. */
  onSkip: () => void;
}

export function WizardPreviewStep({
  feature,
  tier,
  description,
  previewBenefits,
  onSkip,
}: Props) {
  const [showUpgrade, setShowUpgrade] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#22C55E]/10 px-2.5 py-1 text-xs font-semibold text-[#16a34a]">
          <Lock className="h-3 w-3" />
          {tier} feature
        </div>
        <h3 className="mt-3 text-lg font-semibold text-[#0C1F3F]">{feature}</h3>
        <p className="mt-0.5 text-sm text-gray-500">{description}</p>
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Unlock on {tier}
        </p>
        <ul className="mt-3 flex flex-col gap-2.5">
          {previewBenefits.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-[#0C1F3F]">
              <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#22C55E]/15">
                <Check className="h-2.5 w-2.5 text-[#16a34a]" />
              </span>
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => setShowUpgrade(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C55E] py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#16a34a]"
        >
          <Lock className="h-4 w-4" />
          Upgrade to {tier}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
        >
          Skip this step
          <ChevronRight className="h-4 w-4" />
        </button>
        <p className="text-center text-xs text-gray-400">
          You can skip for now — this step isn&apos;t required to create the division.
        </p>
      </div>

      {showUpgrade && (
        <UpgradeModal
          mode="feature"
          feature={feature}
          tier={tier}
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </div>
  );
}
