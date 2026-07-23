"use client";

import { useState, useEffect } from "react";
import { Globe, Settings2, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ORDERED_DAYS, DEFAULT_DAY_WINDOW,
  type WizardData, type PlayingDay, type DayWindowMap,
} from "../wizard-types";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  leagueId: string;
}

type LeagueScheduleSettings = {
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
};

function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function slotsPerField(start: string, end: string, duration: number, buffer: number): number {
  const interval = Number(duration) + Number(buffer);
  if (interval <= 0) return 1;
  const w = toMins(end) - toMins(start);
  if (w < 0) return 0;
  return Math.max(1, Math.floor(w / interval) + 1);
}

function fmtMins12(mins: number): string {
  const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// A native number input's min/max constrain only the spinner — TYPED values
// bypass them, so committed state must clamp too. A typed "0" here once
// persisted game_duration: 0 into division settings (jsonb, no CHECK), which
// downstream code treats as "skip venue-window checks".
function clampNum(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

function NumField({
  label, value, min, max, hint, onChange,
}: {
  label: string; value: number; min?: number; max?: number; hint?: string;
  onChange: (v: number) => void;
}) {
  const [display, setDisplay] = useState(String(value));
  useEffect(() => { setDisplay(String(value)); }, [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number" min={min} max={max} value={display}
        onChange={(e) => {
          setDisplay(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(clampNum(n, min, max));
        }}
        onBlur={() => setDisplay(String(value))}
        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
      />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      aria-pressed={enabled}
      className={`relative flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-[#22C55E]" : "bg-gray-200"
      }`}
    >
      <span className={`absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
        enabled ? "translate-x-[18px]" : "translate-x-0.5"
      }`} />
    </button>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
    />
  );
}

export function StepPlayingSchedule({ data, update, leagueId }: Props) {
  const [leagueSettings, setLeagueSettings] = useState<LeagueScheduleSettings | null>(null);

  // Days that start expanded: any day with games already enabled
  const [expandedDays, setExpandedDays] = useState<Set<PlayingDay>>(() => {
    const s = new Set<PlayingDay>();
    for (const d of data.playing_days) s.add(d);
    return s;
  });

  // Per-day "same time" toggle. Default checked iff start === end. The toggle
  // is purely UI — the underlying day_windows still holds start + end, so the
  // schema and downstream code stay unchanged.
  const [sameTime, setSameTime] = useState<Partial<Record<PlayingDay, boolean>>>(() => {
    const init: Partial<Record<PlayingDay, boolean>> = {};
    for (const { key } of ORDERED_DAYS) {
      const w = data.day_windows[key];
      if (w) init[key] = w.start === w.end;
    }
    return init;
  });

  function isSameTime(day: PlayingDay): boolean {
    const cached = sameTime[day];
    if (cached !== undefined) return cached;
    const w = data.day_windows[day] ?? DEFAULT_DAY_WINDOW;
    return w.start === w.end;
  }

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("leagues")
      .select("schedule_settings")
      .eq("id", leagueId)
      .single()
      .then(({ data: row }) => {
        const s = (row as { schedule_settings: unknown } | null)?.schedule_settings;
        if (s && typeof s === "object" && !Array.isArray(s)) {
          setLeagueSettings(s as LeagueScheduleSettings);
        }
      });
  }, [leagueId]);

  function toggleExpand(day: PlayingDay) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  }

  function toggleGameDay(day: PlayingDay) {
    const enabled = data.playing_days.includes(day);
    if (enabled) {
      update({ playing_days: data.playing_days.filter((d) => d !== day) });
    } else {
      const windows: DayWindowMap = { ...data.day_windows };
      if (!windows[day]) windows[day] = { ...DEFAULT_DAY_WINDOW };
      update({ playing_days: [...data.playing_days, day], day_windows: windows });
      setExpandedDays((prev) => new Set(prev).add(day));
    }
  }

  function updateGameWindow(day: PlayingDay, field: "start" | "end", value: string) {
    const current = data.day_windows[day] ?? DEFAULT_DAY_WINDOW;
    // When "same time" is on, both endpoints move together — the user only
    // sees one picker but the underlying shape stays { start, end }.
    if (field === "start" && isSameTime(day)) {
      update({
        day_windows: {
          ...data.day_windows,
          [day]: { start: value, end: value },
        },
      });
      return;
    }
    update({
      day_windows: {
        ...data.day_windows,
        [day]: { ...current, [field]: value },
      },
    });
  }

  function toggleSameTime(day: PlayingDay) {
    const next = !isSameTime(day);
    setSameTime((prev) => ({ ...prev, [day]: next }));
    if (next) {
      // Snap end down to start so the single visible picker is authoritative.
      const current = data.day_windows[day] ?? DEFAULT_DAY_WINDOW;
      update({
        day_windows: {
          ...data.day_windows,
          [day]: { start: current.start, end: current.start },
        },
      });
    }
  }

  function handleScopeToggle(useLeague: boolean) {
    if (useLeague) {
      if (leagueSettings) {
        update({
          use_league_schedule: true,
          playing_days: leagueSettings.playing_days,
          day_windows: leagueSettings.day_windows,
        });
      } else {
        update({ use_league_schedule: true });
      }
    } else {
      update({ use_league_schedule: false });
    }
  }

  const hasLeagueDefaults = !!leagueSettings;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Playing schedule</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Define how often teams play and when fields are available.
        </p>
      </div>

      {/* ── Season / Per-division scope toggle ── */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Schedule scope</label>
        <div className="flex w-fit rounded-lg border border-gray-200 bg-gray-50 p-1 gap-1">
          <button
            type="button"
            onClick={() => handleScopeToggle(true)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              data.use_league_schedule
                ? "bg-[#22C55E] text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            Apply to entire season
          </button>
          <button
            type="button"
            onClick={() => handleScopeToggle(false)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              !data.use_league_schedule
                ? "bg-[#0C1F3F] text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Per division
          </button>
        </div>
        <p className="text-xs text-gray-400">
          {data.use_league_schedule
            ? hasLeagueDefaults
              ? "Season defaults loaded — changes here will update the season-wide schedule when saved."
              : "No season defaults exist yet — these settings will become the season defaults when saved."
            : hasLeagueDefaults
            ? "Custom windows for this division only — the season defaults are unchanged."
            : "Settings apply to this division only."}
        </p>
      </div>

      {/* ── Scheduling constraint fields ── */}
      <div className="grid grid-cols-2 gap-4">
        <NumField
          label="Max games / team / week"
          value={data.max_games_per_week} min={1} max={7}
          onChange={(v) => update({ max_games_per_week: v })}
        />
        <NumField
          label="Max games per team per day"
          value={data.max_games_per_team_per_day} min={1} max={10}
          hint="Set higher for tournaments."
          onChange={(v) => update({ max_games_per_team_per_day: v })}
        />
      </div>

      {/* ── Per-day scheduling table ── */}
      <div className="flex flex-col gap-2">
        <div>
          <label className="text-sm font-medium text-gray-700">Game days</label>
          <p className="mt-0.5 text-xs text-gray-400">
            Expand a day to set its time window.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {ORDERED_DAYS.map(({ key, label }, i) => {
            const gameEnabled = data.playing_days.includes(key);
            const isExpanded  = expandedDays.has(key);
            const isLast      = i === ORDERED_DAYS.length - 1;
            const gameWin     = data.day_windows[key] ?? DEFAULT_DAY_WINDOW;
            const slots       = gameEnabled
              ? slotsPerField(gameWin.start, gameWin.end, data.game_duration, data.buffer_minutes)
              : 0;
            const sameTimeOn  = isSameTime(key);
            // Last game starts at the "Latest game start" (gameWin.end) and
            // runs for game_duration. Buffer doesn't apply past the last
            // game, so it's intentionally excluded from this end-time hint.
            const lastEndStr  = fmtMins12(toMins(gameWin.end) + Number(data.game_duration || 0));

            return (
              <div key={key} className={!isLast ? "border-b border-gray-100" : ""}>
                <button
                  type="button"
                  onClick={() => toggleExpand(key)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/60"
                >
                  <span className="w-9 flex-shrink-0 text-sm font-semibold text-[#0C1F3F]">
                    {label}
                  </span>

                  <div className="flex flex-1 items-center gap-1.5">
                    {gameEnabled ? (
                      <span className="rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-semibold text-[#16a34a]">
                        Games
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">Off</span>
                    )}
                  </div>

                  <ChevronDown
                    className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-150 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-4 pb-3 pt-2.5">
                    <div className="flex items-start gap-3">
                      <Toggle enabled={gameEnabled} onChange={() => toggleGameDay(key)} />
                      <span className="mt-1.5 w-20 flex-shrink-0 text-xs font-semibold text-gray-600">
                        Games
                      </span>
                      {gameEnabled ? (
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className="flex items-end gap-2">
                            <div className="flex flex-1 flex-col gap-0.5">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                                Earliest game start
                              </p>
                              <TimeInput
                                value={gameWin.start}
                                onChange={(v) => updateGameWindow(key, "start", v)}
                              />
                            </div>
                            {!sameTimeOn && (
                              <>
                                <span className="mb-2 flex-shrink-0 text-xs text-gray-300">–</span>
                                <div className="flex flex-1 flex-col gap-0.5">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                                    Latest game start
                                  </p>
                                  <TimeInput
                                    value={gameWin.end}
                                    onChange={(v) => updateGameWindow(key, "end", v)}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={sameTimeOn}
                              onChange={() => toggleSameTime(key)}
                              className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]"
                            />
                            Same time (one game per field)
                          </label>
                          <p className="text-[11px] text-gray-500">
                            Last game ends ~{lastEndStr} · {slots} slot{slots !== 1 ? "s" : ""}/field
                          </p>
                        </div>
                      ) : (
                        <span className="mt-1.5 flex-1 text-xs italic text-gray-300">Off</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Game duration & buffer ── */}
      <div className="grid grid-cols-2 gap-4">
        <NumField
          label="Game duration (min)"
          value={data.game_duration} min={30} max={180}
          onChange={(v) => update({ game_duration: v })}
        />
        <NumField
          label="Buffer between games (min)"
          value={data.buffer_minutes} min={0} max={60}
          onChange={(v) => update({ buffer_minutes: v })}
        />
      </div>

      <NumField
        label="Bye weeks"
        value={data.bye_weeks} min={0} max={10}
        onChange={(v) => update({ bye_weeks: v })}
      />
    </div>
  );
}
