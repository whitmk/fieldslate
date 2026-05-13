import { useState, useEffect } from "react";
import type { WizardData, PlayingDay } from "../wizard-types";

const DAYS: { key: PlayingDay; label: string }[] = [
  { key: "Mo", label: "Mo" },
  { key: "Tu", label: "Tu" },
  { key: "We", label: "We" },
  { key: "Th", label: "Th" },
  { key: "Fr", label: "Fr" },
  { key: "Sa", label: "Sa" },
  { key: "Su", label: "Su" },
];

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function calcMaxGamesPerField(
  earliest: string,
  latest: string,
  gameDuration: number,
  bufferMinutes: number,
): number {
  const interval = Number(gameDuration) + Number(bufferMinutes);
  if (interval <= 0) return 1;
  const window = toMins(latest) - toMins(earliest);
  if (window < 0) return 1;
  return Math.max(1, Math.floor(window / interval) + 1);
}

function NumField({
  label,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const [display, setDisplay] = useState(String(value));

  useEffect(() => {
    setDisplay(String(value));
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={display}
        onChange={(e) => {
          setDisplay(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(n);
        }}
        onBlur={() => setDisplay(String(value))}
        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
      />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export function StepPlayingSchedule({ data, update }: Props) {
  function toggleDay(day: PlayingDay) {
    const days = data.playing_days.includes(day)
      ? data.playing_days.filter((d) => d !== day)
      : [...data.playing_days, day];
    update({ playing_days: days });
  }

  // Auto-calculate and sync max_games_per_field_per_day whenever its inputs change
  useEffect(() => {
    const calc = calcMaxGamesPerField(
      data.earliest_start,
      data.latest_start,
      data.game_duration,
      data.buffer_minutes,
    );
    if (calc !== data.max_games_per_field_per_day) {
      update({ max_games_per_field_per_day: calc });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.earliest_start, data.latest_start, data.game_duration, data.buffer_minutes]);

  const derivedMaxGames = calcMaxGamesPerField(
    data.earliest_start,
    data.latest_start,
    data.game_duration,
    data.buffer_minutes,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Playing schedule</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Define how often teams play and when fields are available.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <NumField
          label="Games per team"
          value={data.games_per_team}
          min={1}
          max={50}
          onChange={(v) => update({ games_per_team: v })}
        />
        <NumField
          label="Max games / team / week"
          value={data.max_games_per_week}
          min={1}
          max={7}
          onChange={(v) => update({ max_games_per_week: v })}
        />
      </div>

      <NumField
        label="Max games per team per day"
        value={data.max_games_per_team_per_day}
        min={1}
        max={10}
        hint="Set higher for tournaments or playoff days."
        onChange={(v) => update({ max_games_per_team_per_day: v })}
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Playing days</label>
        <div className="flex gap-2">
          {DAYS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => toggleDay(d.key)}
              className={`flex h-9 w-10 items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
                data.playing_days.includes(d.key)
                  ? "bg-[#22C55E] text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Earliest start time</label>
          <input
            type="time"
            value={data.earliest_start}
            onChange={(e) => update({ earliest_start: e.target.value })}
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Latest start time</label>
          <input
            type="time"
            value={data.latest_start}
            onChange={(e) => update({ latest_start: e.target.value })}
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <NumField
          label="Game duration (min)"
          value={data.game_duration}
          min={30}
          max={180}
          onChange={(v) => update({ game_duration: v })}
        />
        <NumField
          label="Buffer between games (min)"
          value={data.buffer_minutes}
          min={0}
          max={60}
          onChange={(v) => update({ buffer_minutes: v })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Read-only — derived from start/end times + game duration + buffer */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Max games / field / day</label>
          <div className="flex h-11 items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3">
            <span className="text-sm font-semibold text-[#0C1F3F]">{derivedMaxGames}</span>
            <span className="text-xs text-gray-400">auto-calculated</span>
          </div>
          <p className="text-xs text-gray-400">
            Based on your time window and slot size
          </p>
        </div>

        <NumField
          label="Bye weeks"
          value={data.bye_weeks}
          min={0}
          max={10}
          onChange={(v) => update({ bye_weeks: v })}
        />
      </div>
    </div>
  );
}
