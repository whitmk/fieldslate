"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DivisionWizard } from "@/components/divisions/division-wizard";
import { DivisionBallIcon } from "@/components/divisions/division-ball-icon";
import { UpgradeModal, type CapName } from "@/components/plan/upgrade-cta";
import { PLAN_LIMITS, isUnlimited, type Plan } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";
import { getDivisionCount, getTeamCountForOrg } from "@/lib/plan/counts";

// Setup step 3 — the divisions & teams loop. Two data-derived states, same
// philosophy as the shell's step derivation: zero divisions → launch state;
// one or more → branch screen (also the landing spot after the wizard
// completes or is cancelled, so the user is never orphaned mid-loop). The
// wizard itself is the everyday DivisionWizard, launched as the modal it is.

type DivisionRow = {
  id: string;
  name: string;
  team_count: number;
};

type SeasonRow = {
  id: string;
  name: string;
  sport: string | null;
  start_date: string | null;
  end_date: string | null;
};

interface Props {
  currentOrgId: string;
  seasonId: string;
  plan: Plan;
  /** "That's all my divisions" — the shell advances to step 4. */
  onAllDone: () => void;
}

export function SetupDivisionsStep({
  currentOrgId,
  seasonId,
  plan,
  onAllDone,
}: Props) {
  const [initialLoading, setInitialLoading] = useState(true);
  const [league, setLeague] = useState<SeasonRow | null>(null);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [divisionCount, setDivisionCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Set when the wizard finishes — names the branch-screen heading. The id
  // rides in via the review step's onComplete payload; name resolves from
  // the refetched list, falling back to a generic heading.
  const [completed, setCompleted] = useState<{ id?: string } | null>(null);
  const [capHit, setCapHit] = useState<
    | { cap: CapName; limit: number; plan: Plan }
    | null
  >(null);

  // Same counter inputs the divisions page resolves server-side
  // (getDivisionCount / getTeamCountForOrg are pure helpers taking a client,
  // so the browser client reuses them as-is) — refreshed after every wizard
  // pass so cap checks and the wizard's team headroom stay current.
  const load = useCallback(async () => {
    const supabase = createClient();
    const [leagueRes, divisionsRes, freshDivisionCount, freshTeamCount] =
      await Promise.all([
        supabase
          .from("leagues")
          .select("id, name, sport, start_date, end_date")
          .eq("id", seasonId)
          .maybeSingle(),
        supabase
          .from("divisions")
          .select("id, name, team_count")
          .eq("league_id", seasonId)
          .order("created_at", { ascending: true }),
        getDivisionCount(supabase, currentOrgId),
        getTeamCountForOrg(supabase, currentOrgId),
      ]);
    setLeague((leagueRes.data as SeasonRow | null) ?? null);
    setDivisions((divisionsRes.data as DivisionRow[] | null) ?? []);
    setDivisionCount(freshDivisionCount);
    setTeamCount(freshTeamCount);
  }, [seasonId, currentOrgId]);

  useEffect(() => {
    load().then(() => setInitialLoading(false));
  }, [load]);

  const divisionLimit = PLAN_LIMITS[plan].divisions;
  const teamLimit = PLAN_LIMITS[plan].teamsPerOrg;
  // Mirrors AddDivisionButton's cap check on the divisions page.
  const atCap = !isUnlimited(divisionLimit) && divisionCount >= divisionLimit;

  function openWizard() {
    if (atCap) {
      setCapHit({ cap: "divisions", limit: divisionLimit, plan });
      return;
    }
    setCompleted(null);
    setWizardOpen(true);
  }

  function handleWizardComplete(savedDivisionId?: string) {
    setWizardOpen(false);
    setCompleted({ id: savedDivisionId });
    void load();
  }

  function handleWizardClose() {
    // Cancel/X mid-wizard: the render below re-derives launch vs branch from
    // the division list, so there's no blank state to fall into.
    setWizardOpen(false);
  }

  if (initialLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  if (!league) {
    return (
      <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
        Couldn&rsquo;t load the season — refresh to try again.
      </p>
    );
  }

  const completedName = completed?.id
    ? divisions.find((d) => d.id === completed.id)?.name
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      {divisions.length === 0 ? (
        /* ── Launch state — zero divisions ── */
        <>
          <p className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 px-4 py-3 text-sm leading-relaxed text-gray-700">
            Divisions are age or skill groups — T-Ball, AA, Majors. Each one
            gets its own teams and scheduling rules.
          </p>
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center">
            <p className="text-sm text-gray-500">
              The division wizard walks you through teams, fields, and game
              format — about two minutes per division.
            </p>
            <button
              onClick={openWizard}
              className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
            >
              <Plus className="h-4 w-4" />
              Set up your first division
            </button>
          </div>
        </>
      ) : (
        /* ── Branch screen — loop or move on ── */
        <>
          <div className="flex items-center gap-2">
            {completed && (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-[#22C55E]" />
            )}
            <h2 className="text-lg font-semibold text-[#0C1F3F]">
              {completed
                ? `${completedName ?? "Division"} is set up`
                : "Your divisions"}
            </h2>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            {divisions.map((div, idx) => (
              <div
                key={div.id}
                className="flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0"
              >
                <DivisionBallIcon
                  sport={league.sport ?? ""}
                  index={idx}
                  containerClassName="h-8 w-8 rounded-md"
                  iconClassName="h-3.5 w-3.5"
                />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                  {div.name}
                </p>
                <p className="text-xs text-gray-400">
                  {div.team_count} team{div.team_count !== 1 ? "s" : ""}
                </p>
              </div>
            ))}
          </div>

          <p className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 px-4 py-3 text-sm leading-relaxed text-gray-700">
            <strong className="font-semibold text-[#0C1F3F]">
              Most leagues add all their divisions now.
            </strong>{" "}
            When the generator can see every division, it routes games around
            field conflicts instead of flagging them afterward.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={openWizard}
              title={
                atCap
                  ? `You've reached your ${planLabel(plan)} plan division limit of ${divisionLimit}.`
                  : undefined
              }
              className={`flex flex-col items-start gap-2 rounded-2xl border bg-white p-5 text-left transition-colors ${
                atCap
                  ? "border-gray-200"
                  : "border-gray-200 hover:border-[#22C55E]/50 hover:bg-[#22C55E]/5"
              }`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  atCap ? "bg-gray-100" : "bg-[#22C55E]/10"
                }`}
              >
                {atCap ? (
                  <Lock className="h-4 w-4 text-gray-400" />
                ) : (
                  <Plus className="h-4 w-4 text-[#22C55E]" />
                )}
              </span>
              <span className="flex flex-wrap items-center gap-2 font-semibold text-[#0C1F3F]">
                Add another division
                {atCap && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {divisionCount} of {divisionLimit} · {planLabel(plan)} plan
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-500">
                {atCap
                  ? "Upgrade to add more divisions to this season."
                  : "Run the same setup for your next age group."}
              </span>
            </button>

            <button
              onClick={onAllDone}
              className="flex flex-col items-start gap-2 rounded-2xl border border-gray-200 bg-white p-5 text-left transition-colors hover:border-[#0C1F3F]/40 hover:bg-gray-50"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0C1F3F]/5">
                <ArrowRight className="h-4 w-4 text-[#0C1F3F]" />
              </span>
              <span className="font-semibold text-[#0C1F3F]">
                That&rsquo;s all my divisions
              </span>
              <span className="text-xs text-gray-500">
                Continue to schedule generation.
              </span>
            </button>
          </div>
        </>
      )}

      {wizardOpen && (
        <DivisionWizard
          leagueId={league.id}
          leagueName={league.name}
          leagueSport={league.sport ?? undefined}
          leagueStartDate={league.start_date ?? undefined}
          leagueEndDate={league.end_date ?? undefined}
          currentOrgId={currentOrgId}
          teamCount={teamCount}
          teamLimit={teamLimit}
          plan={plan}
          onClose={handleWizardClose}
          onComplete={handleWizardComplete}
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
    </div>
  );
}
