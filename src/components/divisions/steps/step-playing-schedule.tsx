"use client";

import { useState, useEffect } from "react";
import { Globe, Settings2 } from "lucide-react";
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
          if (!isNaN(n)) onChange(n);
        }}
        onBlur={() => setDisplay(String(value))}
        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
      />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

type PracticeVenueOption = { id: string; name: string };

export function StepPlayingSchedule({ data, update, leagueId }: Props) {
  const [leagueSettings, setLeagueSettings] = useState<LeagueScheduleSettings | null>(null);
  const [practiceVenues, setPracticeVenues] = useState<PracticeVenueOption[]>([]);

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

  useEffect(() => {
    async function loadPracticeVenues() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: rows } = await supabase
        .from("venues")
        .select("id, name")
        .eq("owner_id", user.id)
        .in("venue_type", ["practice", "both"])
        .order("name");
      setPracticeVenues((rows as PracticeVenueOption[]) ?? []);
    }
    loadPracticeVenues();
  }, []);

  function toggleDay(day: PlayingDay) {
    const enabled = data.playing_days.includes(day);
    if (enabled) {
      update({ playing_days: data.playing_days.filter((d) => d !== day) });
    } else {
      const windows: DayWindowMap = { ...data.day_windows };
      if (!windows[day]) windows[day] = { ...DEFAULT_DAY_WINDOW };
      update({ playing_days: [...data.playing_days, day], day_windows: windows });
    }
  }

  function updateWindow(day: PlayingDay, field: "start" | "end", value: string) {
    update({
      day_windows: {
        ...data.day_windows,
        [day]: { ...(data.day_windows[day] ?? DEFAULT_DAY_WINDOW), [field]: value },
      },
    });
  }

  function handleScopeToggle(useLeague: boolean) {
    if (useLeague) {
      if (leagueSettings) {
        // Populate fields from league defaults
        update({
          use_league_schedule: true,
          playing_days: leagueSettings.playing_days,
          day_windows: leagueSettings.day_windows,
        });
      } else {
        // No league defaults yet — current settings will become the defaults on save
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

      {/* ── League / Per-division scope toggle ── */}
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
            Apply to entire league
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
              ? "League defaults loaded — changes here will update the league-wide schedule when saved."
              : "No league defaults exist yet — these settings will become the league defaults when saved."
            : hasLeagueDefaults
            ? "Custom windows for this division only — the league defaults are unchanged."
            : "Settings apply to this division only."}
        </p>
      </div>

      {/* ── Game count fields ── */}
      <div className="grid grid-cols-2 gap-4">
        <NumField
          label="Games per team"
          value={data.games_per_team} min={1} max={50}
          onChange={(v) => update({ games_per_team: v })}
        />
        <NumField
          label="Max games / team / week"
          value={data.max_games_per_week} min={1} max={7}
          onChange={(v) => update({ max_games_per_week: v })}
        />
      </div>

      <NumField
        label="Max games per team per day"
        value={data.max_games_per_team_per_day} min={1} max={10}
        hint="Set higher for tournaments or playoff days."
        onChange={(v) => update({ max_games_per_team_per_day: v })}
      />

      <NumField
        label="Activities per week"
        value={data.activities_per_week} min={1} max={7}
        hint="Total games and practices combined per week per team."
        onChange={(v) => update({ activities_per_week: v })}
      />

      {/* ── Per-day scheduling table ── */}
      <div className="flex flex-col gap-2">
        <div>
          <label className="text-sm font-medium text-gray-700">Playing days &amp; time windows</label>
          <p className="mt-0.5 text-xs text-gray-400">
            Toggle each day on or off. Enabled days get their own start and end times.
            Disabled days are completely skipped by the scheduler.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          {ORDERED_DAYS.map(({ key, label }, i) => {
            const enabled = data.playing_days.includes(key);
            const win = data.day_windows[key] ?? DEFAULT_DAY_WINDOW;
            const slots = enabled
              ? slotsPerField(win.start, win.end, data.game_duration, data.buffer_minutes)
              : 0;
            const isLast = i === ORDERED_DAYS.length - 1;

            return (
              <div
                key={key}
                className={`flex items-center gap-3 px-4 py-3 ${!isLast ? "border-b border-gray-100" : ""} ${
                  enabled ? "bg-white" : "bg-gray-50/60"
                }`}
              >
                {/* Toggle switch */}
                <button
                  type="button"
                  onClick={() => toggleDay(key)}
                  aria-label={enabled ? `Disable ${label}` : `Enable ${label}`}
                  className={`relative flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    enabled ? "bg-[#22C55E]" : "bg-gray-200"
                  }`}
                >
                  <span
                    className={`absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      enabled ? "translate-x-[18px]" : "translate-x-0.5"
                    }`}
                  />
                </button>

                {/* Day label */}
                <span
                  className={`w-9 flex-shrink-0 text-sm font-semibold ${
                    enabled ? "text-[#0C1F3F]" : "text-gray-300"
                  }`}
                >
                  {label}
                </span>

                {enabled ? (
                  <>
                    <div className="flex min-w-0 flex-1 items-end gap-2">
                      <div className="flex flex-1 flex-col gap-0.5">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                          Start
                        </label>
                        <input
                          type="time"
                          value={win.start}
                          onChange={(e) => updateWindow(key, "start", e.target.value)}
                          className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-0.5">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                          End
                        </label>
                        <input
                          type="time"
                          value={win.end}
                          onChange={(e) => updateWindow(key, "end", e.target.value)}
                          className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        />
                      </div>
                    </div>
                    <span className="w-16 flex-shrink-0 text-right text-xs text-gray-400">
                      {slots} slot{slots !== 1 ? "s" : ""}/field
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-xs italic text-gray-300">
                    No games scheduled
                  </span>
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

      {/* ── Practice venue ── */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-gray-700">Practice venue</label>
        {practiceVenues.length === 0 ? (
          <p className="text-xs text-gray-400 rounded-lg border border-dashed border-gray-200 px-3 py-3">
            No practice venues available. In Venues settings, set a venue type to &ldquo;Practice&rdquo; or &ldquo;Both&rdquo; to enable this field.
          </p>
        ) : (
          <select
            value={data.practice_venue_id}
            onChange={(e) => update({ practice_venue_id: e.target.value })}
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 bg-white focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          >
            <option value="">None</option>
            {practiceVenues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        )}
        <p className="text-xs text-gray-400">Default venue used for practice sessions.</p>
      </div>
    </div>
  );
}
