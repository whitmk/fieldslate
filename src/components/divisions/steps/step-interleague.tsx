"use client";

import { useState, useEffect } from "react";
import { Building2, Loader2, Plus, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { WizardData, InterleagueGameEntry } from "../wizard-types";
import type { InterleagueOrg } from "@/types/database";
import { PLAN_LIMITS, isUnlimited, type Plan } from "@/lib/plan/limits";
import { UpgradeModal } from "@/components/plan/upgrade-cta";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  currentOrgId: string;
  /** Pro or Elite here — Free gets the WizardPreviewStep upsell instead, so
   *  this real step never renders for Free. */
  plan: Plan;
  /** Season id (leagues.id) — used to count this season's distinct partner
   *  orgs against the per-season cap. */
  leagueId: string;
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-1 text-left"
    >
      <div>
        <p className="text-sm font-semibold text-[#0C1F3F]">{label}</p>
        {description && <p className="mt-0.5 text-xs text-gray-400">{description}</p>}
      </div>
      <div
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[#22C55E]" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
    </button>
  );
}

export function StepInterleague({ data, update, currentOrgId, plan, leagueId }: Props) {
  const [orgs, setOrgs] = useState<InterleagueOrg[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinct partner orgs already invited for THIS season — the same measure
  // the create_interleague_org cap RPC enforces (counts.ts
  // getInterleagueOrgCountForSeason). null until loaded.
  const [partnerCount, setPartnerCount] = useState<number | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const partnerLimit = PLAN_LIMITS[plan].interleagueOrgsPerSeason;
  const capped = !isUnlimited(partnerLimit);
  const atCap = capped && partnerCount !== null && partnerCount >= partnerLimit;

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("interleague_orgs")
      .select("*")
      .eq("owner_id", currentOrgId)
      .order("name")
      .then(({ data: rows }) => {
        setOrgs((rows as InterleagueOrg[]) ?? []);
        setLoading(false);
      });
  }, [currentOrgId]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("interleague_invites")
      .select("interleague_org_id")
      .eq("season_id", leagueId)
      .then(({ data: rows }) => {
        const distinct = new Set(
          ((rows as { interleague_org_id: string }[]) ?? []).map(
            (r) => r.interleague_org_id,
          ),
        );
        setPartnerCount(distinct.size);
      });
  }, [leagueId]);

  function getEntry(orgId: string): InterleagueGameEntry | undefined {
    return data.interleague_games.find((g) => g.interleague_org_id === orgId);
  }

  function getCount(orgId: string): number {
    return getEntry(orgId)?.game_count ?? 0;
  }

  function getHome(orgId: string): number {
    return getEntry(orgId)?.home_games_per_team ?? 0;
  }

  function upsertEntry(org: InterleagueOrg, patch: Partial<InterleagueGameEntry>) {
    const existing = getEntry(org.id) ?? {
      interleague_org_id: org.id,
      org_name: org.name,
      game_count: 0,
      home_games_per_team: 0,
    };
    const merged: InterleagueGameEntry = { ...existing, ...patch };
    // Clamp home to [0, game_count]
    merged.home_games_per_team = Math.max(0, Math.min(merged.game_count, merged.home_games_per_team));
    const rest = data.interleague_games.filter((g) => g.interleague_org_id !== org.id);
    update({ interleague_games: [...rest, merged] });
  }

  function setCount(org: InterleagueOrg, raw: string) {
    const game_count = Math.max(0, Math.min(20, parseInt(raw, 10) || 0));
    upsertEntry(org, { game_count });
  }

  function setHome(org: InterleagueOrg, raw: string) {
    const home = Math.max(0, parseInt(raw, 10) || 0);
    upsertEntry(org, { home_games_per_team: home });
  }

  const totalGames = data.interleague_games.reduce((s, g) => s + g.game_count, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Interleague games</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Configure games each team in this division plays against external
          organizations. Counts are <span className="font-medium text-[#0C1F3F]">per team</span>.
        </p>
      </div>

      {/* Per-season partner counter + entry point to add partners. Partners are
          created/invited on the standalone Interleague page; this links there
          (cap enforced server-side at invite time). */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Building2 className="h-4 w-4 text-gray-400" />
          <span className="text-gray-500">
            {partnerCount === null ? (
              "Loading partner leagues…"
            ) : (
              <>
                <span className="font-semibold text-[#0C1F3F]">{partnerCount}</span>
                {capped ? ` of ${partnerLimit}` : ""} partner league
                {partnerCount === 1 && !capped ? "" : "s"}
                {" this season"}
              </>
            )}
          </span>
        </div>
        {atCap ? (
          <button
            type="button"
            onClick={() => setShowUpgrade(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-400"
            title="You've reached your plan's partner-league limit for this season"
          >
            <Plus className="h-3.5 w-3.5" />
            Add partner league
          </button>
        ) : (
          <a
            href={`/dashboard/interleague?season=${leagueId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#22C55E]/40 bg-[#22C55E]/10 px-3 py-1.5 text-xs font-semibold text-[#16a34a] transition-colors hover:bg-[#22C55E]/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Add partner league
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3.5">
        <Toggle
          label="This division plays interleague games"
          checked={data.plays_interleague}
          onChange={(v) => update({ plays_interleague: v })}
        />
      </div>

      {data.plays_interleague && (
        <>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : orgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-center">
              <Building2 className="mb-2.5 h-7 w-7 text-gray-300" />
              <p className="text-sm font-medium text-[#0C1F3F]">No interleague orgs added yet</p>
              <p className="mt-1 max-w-xs text-xs text-gray-400">
                Go to the{" "}
                <span className="font-semibold text-[#0C1F3F]">Interleague</span> page in the
                sidebar to add orgs you play against.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                {orgs.map((org, i) => {
                  const total = getCount(org.id);
                  const home = getHome(org.id);
                  const away = Math.max(0, total - home);
                  return (
                    <div
                      key={org.id}
                      className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                        i !== 0 ? "border-t border-gray-50" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#0C1F3F]">{org.name}</p>
                        {org.contact_name && (
                          <p className="truncate text-xs text-gray-400">{org.contact_name}</p>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            Games per team
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="20"
                            value={total}
                            onChange={(e) => setCount(org, e.target.value)}
                            className="h-8 w-16 rounded-lg border border-gray-200 px-2 text-center text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            Home per team
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={total}
                            value={home}
                            disabled={total === 0}
                            onChange={(e) => setHome(org, e.target.value)}
                            className="h-8 w-16 rounded-lg border border-gray-200 px-2 text-center text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:bg-gray-50 disabled:text-gray-300"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            Away
                          </span>
                          <span className="flex h-8 w-16 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-center text-sm font-semibold text-gray-500">
                            {total === 0 ? 0 : away}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between rounded-xl bg-[#0C1F3F]/5 px-4 py-3">
                <span className="text-sm font-medium text-[#0C1F3F]">Total interleague games</span>
                <span className="text-sm font-bold text-[#0C1F3F]">{totalGames}</span>
              </div>
            </>
          )}
        </>
      )}

      {showUpgrade && (
        <UpgradeModal
          cap="interleagueOrgsPerSeason"
          limit={capped ? partnerLimit : 0}
          currentPlan={plan}
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </div>
  );
}
