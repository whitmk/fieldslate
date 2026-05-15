import type { WizardData } from "../wizard-types";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

export function StepBasics({ data, update }: Props) {
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
          max={64}
          value={data.team_count}
          onChange={(e) => update({ team_count: Math.max(2, parseInt(e.target.value) || 2) })}
          className="h-11 w-32 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
        <p className="text-xs text-gray-400">Min 2, max 64</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Game start date</label>
          <input
            type="date"
            value={data.start_date}
            onChange={(e) => update({ start_date: e.target.value })}
            required
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Game end date</label>
          <input
            type="date"
            value={data.end_date}
            min={data.start_date || undefined}
            onChange={(e) => update({ end_date: e.target.value })}
            required
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Practice start date</label>
          <input
            type="date"
            value={data.practice_season_start}
            onChange={(e) => update({ practice_season_start: e.target.value })}
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
          <p className="text-xs text-gray-400">Leave blank to use the game start date.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Practice end date</label>
          <input
            type="date"
            value={data.practice_season_end}
            min={data.practice_season_start || undefined}
            onChange={(e) => update({ practice_season_end: e.target.value })}
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
          <p className="text-xs text-gray-400">Leave blank to use the game end date.</p>
        </div>
      </div>
    </div>
  );
}
