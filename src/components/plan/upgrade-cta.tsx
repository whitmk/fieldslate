"use client";

// Centralized upgrade copy + CTA. One source of truth for the four
// tier-cap surfaces (divisions / teams / active seasons / admins) so when
// item 13 swaps mailto for Stripe checkout, it's a one-line change here.
//
// Three exports:
//   - humanCapPhrase()    → "1 admin", "6 teams", "1 active season"
//   - upgradeMessage()    → full banner sentence
//   - <UpgradeModal />    → click-triggered modal, mailto CTA

import { X } from "lucide-react";
import type { Plan } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";

export type CapName =
  | "divisions"
  | "teamsPerOrg"
  | "activeSeasons"
  | "admins"
  | "interleagueOrgsPerSeason";

const UPGRADE_MAILTO =
  "mailto:whit@thefieldslate.com?subject=FieldSlate%20upgrade%20request";

function capNoun(cap: CapName, limit: number): string {
  const plural = limit !== 1;
  switch (cap) {
    case "divisions":
      return plural ? "divisions" : "division";
    case "teamsPerOrg":
      return plural ? "teams" : "team";
    case "activeSeasons":
      return plural ? "active seasons" : "active season";
    case "admins":
      return plural ? "admins" : "admin";
    case "interleagueOrgsPerSeason":
      return plural
        ? "partner organizations per season"
        : "partner organization per season";
  }
}

export function humanCapPhrase(cap: CapName, limit: number): string {
  return `${limit} ${capNoun(cap, limit)}`;
}

export function upgradeMessage(
  plan: Plan,
  cap: CapName,
  limit: number,
): string {
  return `You've reached your ${planLabel(plan)} plan limit of ${humanCapPhrase(cap, limit)}. Upgrade to add more.`;
}

interface UpgradeModalProps {
  cap: CapName;
  limit: number;
  currentPlan: Plan;
  onClose: () => void;
}

export function UpgradeModal({
  cap,
  limit,
  currentPlan,
  onClose,
}: UpgradeModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">
            Upgrade your plan
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          {upgradeMessage(currentPlan, cap, limit)}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Maybe later
          </button>
          <a
            href={UPGRADE_MAILTO}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            Request upgrade
          </a>
        </div>
      </div>
    </div>
  );
}
