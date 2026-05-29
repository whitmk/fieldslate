"use client";

// Centralized upgrade copy + CTA. One source of truth for the tier-cap
// surfaces (divisions / teams / active seasons / admins) AND the Pro+
// feature-lock surfaces (practices, activity log, rainout rescheduler,
// exporters), so when item 13 swaps mailto for Stripe checkout it's a
// one-line change here.
//
// Exports:
//   - humanCapPhrase()      → "1 admin", "6 teams", "1 active season"
//   - upgradeMessage()      → full cap-reached banner sentence
//   - featureMessage()      → "[Feature] is available on Pro. Upgrade to unlock."
//   - <UpgradeModal />      → click-triggered modal, cap OR feature mode
//   - <FeatureLockedCard /> → full-page upsell for Pro+ route guards

import Link from "next/link";
import { ArrowLeft, Lock, X } from "lucide-react";
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

// Pro+ feature-lock copy. `feature` is the human label, e.g. "Practices",
// "Activity Log", "SportsConnect export".
export function featureMessage(feature: string): string {
  return `${feature} is available on Pro. Upgrade to unlock.`;
}

// Discriminated union: cap mode is the default (existing callers pass
// cap/limit/currentPlan with no `mode`); feature mode takes a feature label.
type UpgradeModalProps =
  | {
      mode?: "cap";
      cap: CapName;
      limit: number;
      currentPlan: Plan;
      onClose: () => void;
    }
  | {
      mode: "feature";
      feature: string;
      onClose: () => void;
    };

export function UpgradeModal(props: UpgradeModalProps) {
  const { onClose } = props;
  const message =
    props.mode === "feature"
      ? featureMessage(props.feature)
      : upgradeMessage(props.currentPlan, props.cap, props.limit);

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

        <p className="mt-2 text-sm text-gray-600">{message}</p>

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

// Full-page upsell rendered by Pro-only route guards (server components) when
// a Free user reaches the route directly. Same mailto CTA + copy source as
// the modal, plus a back link so the locked route isn't a dead end.
export function FeatureLockedCard({
  feature,
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
}: {
  feature: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F]"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      <div className="mx-auto mt-8 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#22C55E]/10">
          <Lock className="h-6 w-6 text-[#22C55E]" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[#0C1F3F]">Pro feature</h2>
          <p className="mt-1.5 text-sm text-gray-600">{featureMessage(feature)}</p>
        </div>
        <a
          href={UPGRADE_MAILTO}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
        >
          Request upgrade
        </a>
      </div>
    </div>
  );
}
