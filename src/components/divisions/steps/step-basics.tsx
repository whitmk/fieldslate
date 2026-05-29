import type { WizardData } from "../wizard-types";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  /** Org-wide team cap (-1 for unlimited). Pulled from the plan limits and
   *  threaded down from the wizard's parent. */
  teamLimit: number;
  /** Org-wide team count as of wizard mount. */
  teamCount: number;
  /** In edit mode, the number of teams ALREADY in this division (from the
   *  teams table, not divisions.team_count). They don't count against
   *  headroom when re-saved — only NEW teams do. New mode passes 0. */
  existingTeamCountInDivision: number;
}

export function StepBasics({
  data,
  update,
  teamLimit,
  teamCount,
  existingTeamCountInDivision,
}: Props) {
  // Headroom: how many teams the org can still add before hitting the cap.
  // For edit mode, the existing teams in this division already count toward
  // teamCount and stay after save, so we add them back as available room.
  // Floor of 2 keeps the input shape sane even when at cap; the server RPC
  // is the authoritative enforcer.
  const effectiveMax =
    teamLimit === -1
      ? 64
      : Math.max(
          2,
          Math.min(64, teamLimit - teamCount + existingTeamCountInDivision),
        );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Division basics</h3>
        <p className="mt-0.5 text-sm text-gray-500">Name this division and set its team count and dates.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Division name</label>
        <input
          type="text"
          placeholder="e.g. 10U, Varsity, Rec A"
          value={data.name}
          onChange={(e) => update({ name: e.target.value })}
          className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Number of teams</label>
        <input
          type="number"
          min={2}
          max={effectiveMax}
          value={data.team_count}
          onChange={(e) =>
            update({
              team_count: Math.min(
                effectiveMax,
                Math.max(2, parseInt(e.target.value) || 2),
              ),
            })
          }
          className="h-11 w-32 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
        <p className="text-xs text-gray-400">Min 2, max {effectiveMax}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Start date</label>
          <input
            type="date"
            value={data.start_date}
            onChange={(e) => update({ start_date: e.target.value })}
            required
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">End date</label>
          <input
            type="date"
            value={data.end_date}
            min={data.start_date || undefined}
            onChange={(e) => update({ end_date: e.target.value })}
            required
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
      </div>
    </div>
  );
}
