"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DivisionWizard } from "./division-wizard";
import { UpgradeModal, type CapName } from "@/components/plan/upgrade-cta";
import type { Plan } from "@/lib/plan/limits";

export type LeagueOption = {
  id: string;
  name: string;
  /** Drives the wizard's sport-aware labels (Umpires step) — without it
   *  the wizard falls back to generic "Officials". */
  sport: string;
  start_date: string | null;
  end_date: string | null;
};

interface Props {
  leagues: LeagueOption[];
  currentOrgId: string;
  /** Server-resolved counter inputs. At cap, the button opens the upgrade
   *  modal instead of the wizard. Team counts are forwarded into the
   *  wizard so the review step can fail-closed BEFORE writing anything
   *  if the wizard's team list would push the org over its cap. */
  divisionCount: number;
  divisionLimit: number;
  teamCount: number;
  teamLimit: number;
  plan: Plan;
}

export function AddDivisionButton({
  leagues,
  currentOrgId,
  divisionCount,
  divisionLimit,
  teamCount,
  teamLimit,
  plan,
}: Props) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [activeLeague, setActiveLeague] = useState<LeagueOption | null>(null);
  const [capHit, setCapHit] = useState<
    | { cap: CapName; limit: number; plan: Plan }
    | null
  >(null);

  const atCap = divisionLimit !== -1 && divisionCount >= divisionLimit;

  function handleClick() {
    if (leagues.length === 0) return;
    if (atCap) {
      setCapHit({ cap: "divisions", limit: divisionLimit, plan });
      return;
    }
    if (leagues.length === 1) {
      setActiveLeague(leagues[0]);
      return;
    }
    setPicking(true);
  }

  function handlePick(league: LeagueOption) {
    setPicking(false);
    setActiveLeague(league);
  }

  function handleClose() {
    setActiveLeague(null);
  }

  function handleComplete() {
    setActiveLeague(null);
    router.refresh();
  }

  const disabled = leagues.length === 0;

  return (
    <>
      <Button
        size="sm"
        onClick={handleClick}
        disabled={disabled}
        className={atCap ? "opacity-50" : undefined}
        title={
          disabled
            ? "Create a season first"
            : atCap
              ? `You've reached your ${plan} plan division limit of ${divisionLimit}.`
              : undefined
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        Add division
      </Button>

      {picking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPicking(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0C1F3F]">Add division to…</h3>
              <button
                onClick={() => setPicking(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-sm text-gray-500">Choose which season the new division belongs to.</p>
            <ul className="flex flex-col gap-1">
              {leagues.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => handlePick(l)}
                    className="w-full rounded-lg border border-gray-100 px-3 py-2.5 text-left text-sm font-medium text-[#0C1F3F] transition-colors hover:border-[#22C55E]/40 hover:bg-[#22C55E]/5"
                  >
                    {l.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {activeLeague && (
        <DivisionWizard
          leagueId={activeLeague.id}
          leagueName={activeLeague.name}
          leagueSport={activeLeague.sport}
          leagueStartDate={activeLeague.start_date ?? undefined}
          leagueEndDate={activeLeague.end_date ?? undefined}
          currentOrgId={currentOrgId}
          teamCount={teamCount}
          teamLimit={teamLimit}
          plan={plan}
          onClose={handleClose}
          onComplete={handleComplete}
        />
      )}

      {capHit ? (
        <UpgradeModal
          cap={capHit.cap}
          limit={capHit.limit}
          currentPlan={capHit.plan}
          onClose={() => setCapHit(null)}
        />
      ) : null}
    </>
  );
}
