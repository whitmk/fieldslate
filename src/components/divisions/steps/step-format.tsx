import { useState, useEffect } from "react";
import type { WizardData, ScheduleFormat } from "../wizard-types";

const FORMATS: {
  value: ScheduleFormat;
  label: string;
  description: string;
}[] = [
  {
    value: "round_robin",
    label: "Round robin",
    description:
      "Every team plays every other team at least once. Best for equal competition across the division.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description:
      "Teams play a fixed number of games with balanced home/away distribution. Good for larger divisions.",
  },
  {
    value: "pool_play",
    label: "Pool play",
    description:
      "Teams are divided into pools, then top teams advance. Ideal for tournament-style formats.",
  },
];

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

function NumField({
  label, hint, value, min, max, onChange,
}: {
  label: string; hint?: string; value: number; min?: number; max?: number;
  onChange: (v: number) => void;
}) {
  const [display, setDisplay] = useState(String(value));
  useEffect(() => { setDisplay(String(value)); }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number" min={min} max={max} value={display}
        onChange={(e) => { setDisplay(e.target.value); const n = parseInt(e.target.value, 10); if (!isNaN(n)) onChange(n); }}
        onBlur={() => setDisplay(String(value))}
        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
      />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          checked ? "bg-[#22C55E]" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function StepFormat({ data, update }: Props) {
  const interleagueTotal = data.plays_interleague
    ? data.interleague_games.reduce((s, g) => s + g.game_count, 0)
    : 0;
  const totalPerTeam = data.games_per_team + interleagueTotal;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Schedule format</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Choose how games are structured and what features to enable.
        </p>
      </div>

      {/* ── Game counts ── */}
      <div className="flex flex-col gap-3">
        <NumField
          label="Intra-division games per team"
          hint="Games each team plays against other teams within this division."
          value={data.games_per_team}
          min={1}
          max={50}
          onChange={(v) => update({ games_per_team: v })}
        />

        {/* Total preview */}
        <div className="flex items-center justify-between rounded-xl bg-[#0C1F3F]/5 px-4 py-3 text-sm">
          <span className="text-gray-600">
            {data.games_per_team} intra-division
            {data.plays_interleague && interleagueTotal > 0
              ? ` + ${interleagueTotal} interleague`
              : ""}
          </span>
          <span className="font-bold text-[#0C1F3F]">
            {totalPerTeam} total per team
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {FORMATS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => update({ format: f.value })}
            className={`flex items-start gap-4 rounded-xl border p-4 text-left transition-all ${
              data.format === f.value
                ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div
              className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                data.format === f.value ? "border-[#22C55E]" : "border-gray-300"
              }`}
            >
              {data.format === f.value && (
                <div className="h-2 w-2 rounded-full bg-[#22C55E]" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#0C1F3F]">{f.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{f.description}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50/50 px-4">
        <Toggle
          label="Auto-rotate home and away"
          checked={data.auto_rotate}
          onChange={(v) => update({ auto_rotate: v })}
        />
      </div>
    </div>
  );
}
