"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Users, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Division, Team } from "@/types/database";
import { teamAvatarColor } from "@/lib/utils/team-avatar";
import { UpgradeModal, type CapName } from "@/components/plan/upgrade-cta";
import type { Plan } from "@/lib/plan/limits";

interface Props {
  leagueId: string;
  refreshKey?: number;
  /** Server-resolved counter inputs. The cap is org-wide (across all
   *  leagues/divisions) and the parent page passes the same numbers in. */
  teamCount: number;
  teamLimit: number;
  plan: Plan;
}

export function TeamSection({
  leagueId,
  refreshKey,
  teamCount,
  teamLimit,
  plan,
}: Props) {
  const [open, setOpen] = useState(false);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [capHit, setCapHit] = useState<
    | { cap: CapName; limit: number; plan: Plan }
    | null
  >(null);

  const atCap = teamLimit !== -1 && teamCount >= teamLimit;

  const fetchData = useCallback(async () => {
    const supabase = createClient();
    const [{ data: divData }, { data: teamData }] = await Promise.all([
      supabase.from("divisions").select("*").eq("league_id", leagueId).order("name"),
      supabase.from("teams").select("*").eq("league_id", leagueId).order("name"),
    ]);
    setDivisions((divData as Division[]) ?? []);
    setTeams((teamData as Team[]) ?? []);
    setLoading(false);
  }, [leagueId]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  function openModal() {
    if (atCap) {
      setCapHit({ cap: "teamsPerOrg", limit: teamLimit, plan });
      return;
    }
    setName("");
    setDivisionId(divisions[0]?.id ?? "");
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !divisionId) return;
    setSaving(true);
    setError("");

    const supabase = createClient();
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "create_team" as never,
      {
        p_league_id: leagueId,
        p_division_id: divisionId,
        p_name: name.trim(),
      } as never,
    );

    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }

    const payload = rpcData as
      | { row: { id: string } }
      | { error: "cap_reached"; cap: CapName; limit: number; plan: Plan };

    if ("error" in payload && payload.error === "cap_reached") {
      setOpen(false);
      setSaving(false);
      setCapHit({ cap: payload.cap, limit: payload.limit, plan: payload.plan });
      return;
    }

    setOpen(false);
    setSaving(false);
    fetchData();
  }

  const teamsByDivision = divisions.map((div) => ({
    division: div,
    teams: teams.filter((t) => t.division_id === div.id),
  }));

  const unassigned = teams.filter((t) => !t.division_id);

  return (
    <>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">Teams</h2>
          <button
            onClick={openModal}
            className={
              atCap
                ? "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400 opacity-70"
                : "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
            }
            title={
              atCap
                ? `You've reached your ${plan} plan team limit of ${teamLimit}.`
                : undefined
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add team
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center px-6 py-10">
            <svg className="h-5 w-5 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : divisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm text-gray-400">Add divisions first, then assign teams to them.</p>
          </div>
        ) : teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
              <Users className="h-5 w-5 text-gray-300" />
            </div>
            <p className="mt-4 font-medium text-[#0C1F3F]">No teams yet</p>
            <p className="mt-1 max-w-xs text-sm text-gray-400">
              Add teams and assign them to a division.
            </p>
            <button
              onClick={openModal}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
            >
              <Plus className="h-4 w-4" />
              Add your first team
            </button>
          </div>
        ) : (
          <div>
            {teamsByDivision.map(({ division, teams: divTeams }) =>
              divTeams.length === 0 ? null : (
                <div key={division.id} className="border-b border-gray-50 last:border-b-0">
                  <div className="bg-gray-50/70 px-6 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      {division.name}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {divTeams.map((team) => (
                      <div key={team.id} className="flex items-center gap-3 px-6 py-3.5">
                        <div
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                          style={{ backgroundColor: teamAvatarColor(teams.indexOf(team)) }}
                        >
                          {team.name.charAt(0).toUpperCase()}
                        </div>
                        <p className="text-sm font-medium text-[#0C1F3F]">{team.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
            {unassigned.length > 0 && (
              <div className="border-b border-gray-50 last:border-b-0">
                <div className="bg-gray-50/70 px-6 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Unassigned
                  </p>
                </div>
                <div className="divide-y divide-gray-50">
                  {unassigned.map((team) => (
                    <div key={team.id} className="flex items-center gap-3 px-6 py-3.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#0C1F3F]/[0.06] text-sm font-bold text-[#0C1F3F]/40">
                        {team.name.charAt(0).toUpperCase()}
                      </div>
                      <p className="text-sm font-medium text-[#0C1F3F]">{team.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h2 className="font-semibold text-[#0C1F3F]">Add team</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Team name</label>
                <input
                  type="text"
                  placeholder="e.g. Red Hawks"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Division</label>
                <select
                  value={divisionId}
                  onChange={(e) => setDivisionId(e.target.value)}
                  required
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                >
                  <option value="">Select a division…</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim() || !divisionId}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Add team"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
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
