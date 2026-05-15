"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export type LeagueOption = {
  id: string;
  name: string;
};

export type DivisionOption = {
  id: string;
  name: string;
  league_id: string;
};

interface Props {
  leagues: LeagueOption[];
  divisions: DivisionOption[];
}

export function AddTeamButton({ leagues, divisions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [leagueId, setLeagueId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const leagueDivisions = useMemo(
    () => divisions.filter((d) => d.league_id === leagueId),
    [divisions, leagueId],
  );

  function openModal() {
    if (leagues.length === 0) return;
    const initialLeague = leagues.length === 1 ? leagues[0].id : "";
    const initialDivision =
      leagues.length === 1
        ? divisions.find((d) => d.league_id === initialLeague)?.id ?? ""
        : "";
    setName("");
    setLeagueId(initialLeague);
    setDivisionId(initialDivision);
    setError("");
    setOpen(true);
  }

  function handleLeagueChange(nextId: string) {
    setLeagueId(nextId);
    const firstDivision = divisions.find((d) => d.league_id === nextId);
    setDivisionId(firstDivision?.id ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !leagueId || !divisionId) return;
    setSaving(true);
    setError("");

    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("teams")
      .insert([
        { league_id: leagueId, division_id: divisionId, name: name.trim() },
      ] as never);

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  const disabled = leagues.length === 0;
  const noDivisionsInLeague = !!leagueId && leagueDivisions.length === 0;

  return (
    <>
      <Button
        size="sm"
        onClick={openModal}
        disabled={disabled}
        title={disabled ? "Create a league first" : undefined}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add team
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-[#0C1F3F]">Add team</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
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

              {leagues.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">League</label>
                  <select
                    value={leagueId}
                    onChange={(e) => handleLeagueChange(e.target.value)}
                    required
                    className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                  >
                    <option value="">Select a league…</option>
                    {leagues.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Division</label>
                <select
                  value={divisionId}
                  onChange={(e) => setDivisionId(e.target.value)}
                  required
                  disabled={!leagueId || noDivisionsInLeague}
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">Select a division…</option>
                  {leagueDivisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {noDivisionsInLeague && (
                  <p className="text-xs text-amber-600">
                    This league has no divisions yet — create one on the Divisions tab first.
                  </p>
                )}
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
                  disabled={saving}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim() || !leagueId || !divisionId}
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
    </>
  );
}
