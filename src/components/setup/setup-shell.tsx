"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Hammer, Loader2 } from "lucide-react";
import { FieldSlateLockup } from "@/components/brand/FieldSlateLockup";
import { createClient } from "@/lib/supabase/client";
import { VenuesPageClient } from "@/components/venues/venues-page-client";
import { NewLeagueForm } from "@/components/leagues/new-league-form";
import { SetupDivisionsStep } from "@/components/setup/setup-divisions-step";
import { SetupGenerateStep } from "@/components/setup/setup-generate-step";
import type { Plan } from "@/lib/plan/limits";

// First-run setup wizard shell (/setup). Chrome-less — no dashboard sidebar;
// a navy progress rail (horizontal stepper on mobile) frames the embedded
// real product components. Progress is data-derived: the server page computes
// initialStep from venue/season/division state, and this shell only ever
// advances within a visit — a reload re-derives. Step 4 is a placeholder
// until the generate chunk lands.

const STEPS = [
  { label: "Venues", sub: "Fields and open hours" },
  { label: "Season", sub: "Your first season" },
  { label: "Divisions & teams", sub: "One pass per division" },
  { label: "Generate schedule", sub: "Every division at once" },
];

interface Props {
  currentOrgId: string;
  /** 1-based; derived from data state by the server page. */
  initialStep: number;
  initialVenueCount: number;
  /** The selected season (Chunk 1 cookie chain) — the division wizard's
   *  leagueId. Null until a season exists; step 2 fills it client-side. */
  initialSeasonId: string | null;
  plan: Plan;
}

export function SetupShell({
  currentOrgId,
  initialStep,
  initialVenueCount,
  initialSeasonId,
  plan,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [venueCount, setVenueCount] = useState(initialVenueCount);
  const [seasonId, setSeasonId] = useState(initialSeasonId);
  const [dismissing, setDismissing] = useState(false);
  const [dismissError, setDismissError] = useState<string | null>(null);
  // Generation loop in flight — locks the later-link so the user can't
  // navigate away mid-run and lose the progress view.
  const [genRunning, setGenRunning] = useState(false);

  // Step 1 gating — re-count after every venue write the embed reports.
  async function refreshVenueCount() {
    const supabase = createClient();
    const { count } = await supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", currentOrgId);
    setVenueCount(count ?? venueCount);
  }

  async function handleDismiss() {
    setDismissing(true);
    setDismissError(null);
    try {
      const res = await fetch("/api/setup/dismiss", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setDismissError(data.error ?? "Could not save — try again.");
        setDismissing(false);
        return;
      }
      router.push("/dashboard");
    } catch {
      setDismissError("Network error — try again.");
      setDismissing(false);
    }
  }

  async function handleSeasonCreated(leagueId: string) {
    // Make the new season the topbar selection before the user lands back in
    // the dashboard. Best-effort: with a single active season,
    // getCurrentSeasonId falls back to it anyway if this write fails.
    try {
      await fetch("/api/seasons/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season_id: leagueId }),
      });
    } catch {}
    setSeasonId(leagueId);
    setStep(3);
  }

  return (
    <div className="flex min-h-screen bg-[#f4f5f0]">
      {/* ── Desktop progress rail ── */}
      <aside className="hidden w-72 flex-shrink-0 flex-col justify-between bg-[#0b1c39] p-8 md:flex">
        <div>
          <FieldSlateLockup height={28} variant="dark" />
          <p className="mt-10 text-[10px] font-bold uppercase tracking-wider text-white/40">
            League setup
          </p>
          <ol className="mt-4 flex flex-col gap-5">
            {STEPS.map((s, i) => {
              const n = i + 1;
              const state = n < step ? "done" : n === step ? "active" : "upcoming";
              return (
                <li key={s.label} className="flex items-start gap-3">
                  <span
                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      state === "done"
                        ? "bg-[#22C55E] text-white"
                        : state === "active"
                          ? "bg-white text-[#0b1c39]"
                          : "border border-white/20 text-white/40"
                    }`}
                  >
                    {state === "done" ? <Check className="h-3.5 w-3.5" /> : n}
                  </span>
                  <span className="flex flex-col">
                    <span
                      className={`text-sm font-semibold ${
                        state === "active" ? "text-white" : state === "done" ? "text-white/70" : "text-white/40"
                      }`}
                    >
                      {s.label}
                    </span>
                    <span className="text-xs text-white/30">{s.sub}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="text-xs leading-relaxed text-white/30">
          Your progress saves as you go — leave anytime and pick up where you
          left off.
        </p>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* Mobile header: lockup + horizontal stepper */}
        <div className="border-b border-gray-200 bg-[#0b1c39] px-4 py-3 md:hidden">
          <FieldSlateLockup height={22} variant="dark" />
          <ol className="mt-3 flex items-center gap-2">
            {STEPS.map((s, i) => {
              const n = i + 1;
              const state = n < step ? "done" : n === step ? "active" : "upcoming";
              return (
                <li key={s.label} className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={`h-1 rounded-full ${
                      state === "done"
                        ? "bg-[#22C55E]"
                        : state === "active"
                          ? "bg-white"
                          : "bg-white/20"
                    }`}
                  />
                  <span
                    className={`truncate text-[10px] font-medium ${
                      state === "active" ? "text-white" : "text-white/40"
                    }`}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-8 sm:px-6 md:py-12">
          {/* Step eyebrow + escape hatch */}
          <div className="flex items-start justify-between gap-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Step {Math.min(step, STEPS.length)} of {STEPS.length} ·{" "}
              {STEPS[Math.min(step, STEPS.length) - 1].label}
            </p>
            <div className="flex flex-col items-end">
              <button
                onClick={handleDismiss}
                disabled={dismissing || genRunning}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-[#0C1F3F] disabled:opacity-50"
              >
                {dismissing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                I&rsquo;ll do this later
              </button>
              {dismissError && (
                <p className="mt-1 text-xs text-red-500">{dismissError}</p>
              )}
            </div>
          </div>

          <div className="mt-6">
            {step === 1 ? (
              <div className="flex flex-col gap-6">
                <p className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 px-4 py-3 text-sm leading-relaxed text-gray-700">
                  Everything in FieldSlate schedules around your fields — add
                  them first and conflict detection works from day one. Add
                  every field you use, even shared ones.
                </p>
                <VenuesPageClient
                  currentOrgId={currentOrgId}
                  onChanged={() => void refreshVenueCount()}
                />
                <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-5">
                  {venueCount === 0 && (
                    <p className="text-xs text-gray-400">
                      Add at least one venue to continue.
                    </p>
                  )}
                  <button
                    onClick={() => setStep(2)}
                    disabled={venueCount === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Continue to season
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : step === 2 ? (
              <div className="flex flex-col gap-6">
                <p className="rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 px-4 py-3 text-sm leading-relaxed text-gray-700">
                  A season holds everything you&rsquo;ll build next — divisions,
                  teams, and the game schedule.
                </p>
                <NewLeagueForm
                  currentOrgId={currentOrgId}
                  onCreated={(leagueId) => void handleSeasonCreated(leagueId)}
                />
              </div>
            ) : step === 3 && seasonId ? (
              <SetupDivisionsStep
                currentOrgId={currentOrgId}
                seasonId={seasonId}
                plan={plan}
                onAllDone={() => setStep(4)}
              />
            ) : step >= 4 && seasonId ? (
              /* Step 4 (and 5 = finished — same component, it derives
                 generate-vs-done itself; 5 just marks the rail done). */
              <SetupGenerateStep
                currentOrgId={currentOrgId}
                seasonId={seasonId}
                onBackToDivisions={() => setStep(3)}
                onAllScheduled={() => setStep(5)}
                onRunningChange={setGenRunning}
              />
            ) : (
              /* Defensive fallback: steps 3+ reached without a season —
                 derivation prevents this, but never a blank screen. */
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
                <Hammer className="h-8 w-8 text-gray-300" />
                <div>
                  <p className="font-semibold text-[#0C1F3F]">
                    We couldn&rsquo;t find your season
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                    Head to the dashboard — your venues and any saved work are
                    still there.
                  </p>
                </div>
                <button
                  onClick={() => router.push("/dashboard")}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/85"
                >
                  Go to dashboard
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
