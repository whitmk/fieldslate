import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WizardData } from "../wizard-types";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  leagueId: string;
}

export function StepCoaches({ data, update, leagueId }: Props) {
  const [otherDivisions, setOtherDivisions] = useState<{ id: string; name: string }[]>([]);
  const [teamsByDivision, setTeamsByDivision] = useState<Record<string, { id: string; name: string }[]>>({});

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: divs }, { data: allTeams }] = await Promise.all([
        supabase.from("divisions").select("id, name").eq("league_id", leagueId).order("name"),
        supabase.from("teams").select("id, name, division_id").eq("league_id", leagueId).order("name"),
      ]);
      setOtherDivisions((divs as { id: string; name: string }[]) ?? []);
      const grouped: Record<string, { id: string; name: string }[]> = {};
      for (const t of (allTeams as { id: string; name: string; division_id: string }[]) ?? []) {
        if (!grouped[t.division_id]) grouped[t.division_id] = [];
        grouped[t.division_id].push({ id: t.id, name: t.name });
      }
      setTeamsByDivision(grouped);
    }
    load();
  }, [leagueId]);

  function setTeamName(i: number, name: string) {
    const teams = data.teams.map((t, idx) => (idx === i ? { ...t, name } : t));
    update({ teams });
  }

  function setConflict(i: number, has_coach_conflict: boolean) {
    const teams = data.teams.map((t, idx) =>
      idx === i ? { ...t, has_coach_conflict, conflict_division: "", conflict_team: "" } : t
    );
    update({ teams });
  }

  function setConflictDivision(i: number, divisionId: string) {
    const teams = data.teams.map((t, idx) =>
      idx === i ? { ...t, conflict_division: divisionId, conflict_team: "" } : t
    );
    update({ teams });
  }

  function setConflictTeam(i: number, teamName: string) {
    const teams = data.teams.map((t, idx) =>
      idx === i ? { ...t, conflict_team: teamName } : t
    );
    update({ teams });
  }

  if (data.teams.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0C1F3F]">Coach conflicts</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Flag teams whose coaches also coach in another division.
          </p>
        </div>
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-400">
          Set the number of teams in Step 1 first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Coach conflicts</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Flag teams whose coaches also coach in another division to prevent same-day scheduling
          conflicts.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">
                Team name
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 whitespace-nowrap">
                Double-coach?
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">
                Other division
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">
                Other team
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.teams.map((team, i) => (
              <tr key={i} className={team.has_coach_conflict ? "bg-amber-50/40" : ""}>
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    value={team.name}
                    onChange={(e) => setTeamName(i, e.target.value)}
                    placeholder={`Team ${i + 1}`}
                    className="h-8 w-full rounded-md border border-gray-200 px-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-1 focus:ring-[#22C55E]/20"
                  />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => setConflict(i, !team.has_coach_conflict)}
                    className={`inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                      team.has_coach_conflict ? "bg-amber-400" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        team.has_coach_conflict ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  {team.has_coach_conflict && (
                    <select
                      value={team.conflict_division}
                      onChange={(e) => setConflictDivision(i, e.target.value)}
                      className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-1 focus:ring-[#22C55E]/20"
                    >
                      <option value="">Select division…</option>
                      {otherDivisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {team.has_coach_conflict && (
                    <select
                      value={team.conflict_team}
                      onChange={(e) => setConflictTeam(i, e.target.value)}
                      disabled={!team.conflict_division}
                      className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-1 focus:ring-[#22C55E]/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">Select team…</option>
                      {(teamsByDivision[team.conflict_division] ?? []).map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
        Flagged coaches will not be scheduled against their other team on the same day. You can
        update team names later from the division settings.
      </p>
    </div>
  );
}
