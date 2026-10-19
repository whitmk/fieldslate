"use client";

// "New season" — ONE flow for every entry point (the Overview and Seasons
// buttons, the empty states, /dashboard/leagues/new, the setup wizard). The
// server reads the league's state (loadNewSeasonState) and newSeasonScreen
// picks the screen; this component only renders it and submits:
//   create        → create_league (Free with nothing active, comped, or a
//                   paid league using a credit)
//   add_season    → checkout at the league's current plan
//   first_season  → checkout at the plan chosen here (nothing active)
//   convert_free  → checkout to upgrade the Free season in place
// Every sentence and price comes from src/lib/billing; nothing is typed here.
// Approved mockup: docs/mockups/add-season.html.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { priceLabel, type PaidTier } from "@/lib/billing/prices";
import {
  BILLING_MANAGED,
  CHECKOUT_FINE_PRINT,
  CONTACT_EMAIL,
  TIER_HIGHLIGHTS,
  addSeasonButton,
  convertButton,
  loseLine,
  newSeasonHeading,
  newSeasonScreen,
  purchaseErrorMessage,
  seasonDateRange,
  tierName,
  type NewSeasonState,
} from "@/lib/billing/season-purchase";

// "Other" keeps the field open-ended for any sport not named above — the
// engine is sport-agnostic (sport is unconstrained text; official labels fall
// back to "Referee"), so the homepage can truthfully claim any-sport support.
const SPORTS = [
  "Baseball",
  "Softball",
  "Soccer",
  "Football",
  "Basketball",
  "Volleyball",
  "Lacrosse",
  "Hockey",
  "Other",
] as const;

function getSeasonLabel(startDate: string): string {
  const month = new Date(startDate + "T00:00:00").getMonth() + 1;
  const year = new Date(startDate + "T00:00:00").getFullYear();
  if (month >= 3 && month <= 5) return `Spring ${year}`;
  if (month >= 6 && month <= 8) return `Summer ${year}`;
  if (month >= 9 && month <= 11) return `Fall ${year}`;
  return `Winter ${year}`;
}

const INPUT =
  "h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";

type ErrorState = { message: string; code: string | null } | null;

interface Props {
  currentOrgId: string;
  /** From loadNewSeasonState; null with loadError when the read failed. */
  state: NewSeasonState | null;
  loadError?: string | null;
  /** When provided, called with the new season id on success INSTEAD of the
   *  default redirect — embedders (the /setup wizard) own navigation. */
  onCreated?: (leagueId: string) => void;
}

export function NewSeasonFlow({ currentOrgId, state, loadError, onCreated }: Props) {
  if (!state) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700">
          {loadError ?? "Couldn’t load your league’s seasons. Refresh the page to try again."}
        </div>
      </div>
    );
  }
  return <Flow currentOrgId={currentOrgId} state={state} onCreated={onCreated} />;
}

function Flow({
  currentOrgId,
  state,
  onCreated,
}: {
  currentOrgId: string;
  state: NewSeasonState;
  onCreated?: (leagueId: string) => void;
}) {
  const router = useRouter();
  const screen = newSeasonScreen(state);
  const heading = newSeasonHeading(screen, state);
  const paidPlan: PaidTier | null = state.plan === "free" ? null : state.plan;

  const [name, setName] = useState("");
  const [sport, setSport] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [season, setSeason] = useState("");
  const [seasonEdited, setSeasonEdited] = useState(false);
  // The plan a choice screen starts on: the league's own (nothing lost), or
  // Pro for a Free league upgrading.
  const [tier, setTier] = useState<PaidTier>(paidPlan ?? "pro");
  const [error, setError] = useState<ErrorState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (startDate && !seasonEdited) setSeason(getSeasonLabel(startDate));
  }, [startDate, seasonEdited]);

  const showForm = screen !== "convert_free";
  const showTiers = screen === "first_season" || screen === "convert_free";
  const lose = screen === "first_season" ? loseLine(state.plan, tier) : null;

  async function createFree() {
    const supabase = createClient();
    const seasonValue = season.trim() || (startDate ? getSeasonLabel(startDate) : "Season 1");
    const { data, error: rpcError } = await supabase.rpc(
      "create_league" as never,
      {
        p_org_id: currentOrgId,
        p_name: name.trim(),
        p_sport: sport,
        p_season: seasonValue,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      } as never,
    );
    if (rpcError) {
      setError({ message: rpcError.message, code: null });
      setLoading(false);
      return;
    }
    const payload = data as { row?: { id: string }; error?: string };
    if (payload.error || !payload.row) {
      // The league changed since the page was read (another tab used the
      // credit, a season was restored…). Re-read; the server picks the
      // screen again.
      setNotice("Your league changed since this page loaded — showing the current options.");
      setLoading(false);
      router.refresh();
      return;
    }
    if (onCreated) {
      // Leave `loading` true — the embedder is about to swap this form out.
      onCreated(payload.row.id);
      return;
    }
    router.push(`/dashboard/leagues/${payload.row.id}`);
  }

  async function checkout() {
    const kind = screen === "add_season" ? "add_season" : screen === "first_season" ? "first_season" : "convert_free";
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          // Only a choice screen sends a tier; the server ignores it otherwise.
          tier: showTiers ? tier : null,
          season: showForm
            ? {
                name: name.trim(),
                sport,
                seasonLabel: season.trim() || null,
                startDate,
                endDate,
              }
            : null,
          orgId: currentOrgId,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string; code?: string };
      if (!res.ok || !data.url) {
        setError({
          message: data.error ?? purchaseErrorMessage(data.code ?? ""),
          code: data.code ?? null,
        });
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError({ message: purchaseErrorMessage(""), code: null });
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (showForm && endDate && startDate && endDate < startDate) {
      setError({ message: purchaseErrorMessage("invalid_season", "end_before_start"), code: null });
      return;
    }
    setLoading(true);
    if (screen === "create") await createFree();
    else await checkout();
  }

  const submitLabel =
    screen === "create"
      ? loading
        ? "Creating…"
        : "Create season"
      : screen === "add_season"
        ? addSeasonButton(paidPlan ?? "pro")
        : screen === "first_season"
          ? addSeasonButton(tier)
          : convertButton(state.activeSeasonName ?? "this season", tier);

  return (
    <div className="mx-auto max-w-xl">
      {!onCreated && (
        <Link
          href="/dashboard/leagues"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-[#0C1F3F]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to seasons
        </Link>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0C1F3F]">{heading.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{heading.sub}</p>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {showForm && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">
                  Season name
                </label>
                <input
                  id="name"
                  type="text"
                  placeholder="Riverside Youth Baseball"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={120}
                  className={INPUT}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="sport" className="text-sm font-medium text-gray-700">
                  Sport
                </label>
                <select
                  id="sport"
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  required
                  className={`${INPUT} appearance-none bg-white`}
                >
                  <option value="" disabled>
                    Select a sport…
                  </option>
                  {SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="startDate" className="text-sm font-medium text-gray-700">
                    Season start
                  </label>
                  <input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className={INPUT}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="endDate" className="text-sm font-medium text-gray-700">
                    Season end
                  </label>
                  <input
                    id="endDate"
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="season" className="text-sm font-medium text-gray-700">
                  Season label
                </label>
                <input
                  id="season"
                  type="text"
                  placeholder="e.g. Spring 2026, Fall Ball 2026"
                  value={season}
                  onChange={(e) => {
                    setSeason(e.target.value);
                    setSeasonEdited(true);
                  }}
                  required
                  maxLength={60}
                  className={INPUT}
                />
                <p className="text-xs text-gray-400">
                  Auto-filled from start date — type over it to use a custom name.
                </p>
              </div>
            </>
          )}

          {showTiers && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Plan">
              {(["pro", "elite"] as PaidTier[]).map((t) => {
                const on = tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTier(t)}
                    className={`rounded-xl border-[1.5px] p-4 text-left transition-shadow ${
                      on
                        ? "border-[#16a34a] shadow-[0_0_0_3px_rgba(34,197,94,0.15)]"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-2 font-bold text-[#0C1F3F]">
                        <span
                          className={`inline-block h-4 w-4 rounded-full border-2 ${
                            on ? "border-[#16a34a] bg-[radial-gradient(#16a34a_45%,transparent_50%)]" : "border-gray-300"
                          }`}
                        />
                        {tierName(t)}
                      </span>
                      <span className="text-xl font-bold text-[#0C1F3F]">
                        {priceLabel(t)} <span className="text-xs font-semibold text-gray-400">once</span>
                      </span>
                    </div>
                    {screen === "first_season" && state.plan === t && (
                      <p className="mt-1 text-xs font-semibold text-[#16a34a]">Your current plan</p>
                    )}
                    {screen === "convert_free" && (
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {TIER_HIGHLIGHTS[t].map((h) => (
                          <li key={h} className="flex items-start gap-1.5 text-xs text-gray-600">
                            <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#22C55E]" />
                            {h}
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {lose && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{lose}</span>
            </div>
          )}

          {screen === "add_season" && paidPlan && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="truncate font-semibold text-[#0C1F3F]">
                  {tierName(paidPlan)} season{name.trim() ? ` · ${name.trim()}` : ""}
                </p>
                <p className="text-gray-500">{seasonDateRange(startDate, endDate) || "Pick the dates above"}</p>
              </div>
              <p className="whitespace-nowrap text-xl font-bold text-[#0C1F3F]">
                {priceLabel(paidPlan)} <span className="text-xs font-semibold text-gray-400">once</span>
              </p>
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
              {notice}
            </div>
          )}

          {error &&
            (error.code === "billing_managed" ? (
              <p className="text-sm text-gray-700">
                <BillingManaged />
              </p>
            ) : (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600">
                {error.message}
              </div>
            ))}

          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            {!onCreated && (
              <Link
                href="/dashboard/leagues"
                className="rounded-lg px-4 py-2 text-center text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
              >
                {screen === "convert_free" ? "Not now" : "Cancel"}
              </Link>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitLabel}
            </button>
          </div>

          {screen !== "create" && <p className="text-xs text-gray-400">{CHECKOUT_FINE_PRINT}</p>}
        </form>
      </div>
    </div>
  );
}

/** The comped sentence, with "contact us" as a mailto link. */
export function BillingManaged({ subject = "New season" }: { subject?: string }) {
  return (
    <span>
      {BILLING_MANAGED.before}
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`}
        className="font-semibold underline"
      >
        {BILLING_MANAGED.link}
      </a>
      {BILLING_MANAGED.after}
    </span>
  );
}
