"use client";

// Two-stage "Dates & fields": one panel per stage, each with its own date
// range, days, windows, per-team daily limit and fields (approved mockup,
// screen 3). Days start from the division's own (playoffDefaultsFromDivision,
// applied when the division is picked). Day toggles use the shared
// toggleDayWithWindows, with one session stash per stage, held by the wizard.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ORDERED_DAYS, DEFAULT_DAY_WINDOW } from "@/components/divisions/wizard-types";
import { toggleDayWithWindows, type WindowStash } from "@/lib/divisions/day-window-toggle";
import { qualifiedVenueLabel, byQualifiedVenueLabel } from "@/lib/venues/venue-label";
import { stageDateProblem } from "@/lib/playoffs/two-stage";
import type {
  DayWindowMap,
  GamesPerDay,
  PlayingDay,
  PlayoffWizardData,
  VenueAssignment,
} from "../playoff-wizard-types";
import { GamesPerDayControl, RR_PER_DAY_HINT, STAGE2_PER_DAY_HINT } from "./games-per-day-control";
import { SeriesLengthsControl } from "./series-lengths-control";
import { bracketGamesLabel, wizardRounds } from "@/lib/playoffs/series";

type Venue = { id: string; name: string; location?: { name: string } | null };

type StageValue = {
  start_date: string;
  end_date: string;
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
  venue_assignments: VenueAssignment[];
  games_per_team_per_day: GamesPerDay;
};

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
  currentOrgId: string;
  stash1: WindowStash<PlayingDay>;
  stash2: WindowStash<PlayingDay>;
  onStash1Change: (s: WindowStash<PlayingDay>) => void;
  onStash2Change: (s: WindowStash<PlayingDay>) => void;
}

const DAY_LONG: Record<string, string> = {
  Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday",
};

function StagePanel({
  num,
  title,
  gamesLabel,
  value,
  onChange,
  stash,
  onStashChange,
  venues,
  showFields,
  perDayHint,
  beforePerDay,
  footer,
}: {
  num: 1 | 2;
  title: string;
  /** "21 games", "Up to 11 games". */
  gamesLabel: string;
  value: StageValue;
  onChange: (patch: Partial<StageValue>) => void;
  stash: WindowStash<PlayingDay>;
  onStashChange: (s: WindowStash<PlayingDay>) => void;
  venues: Venue[] | null;
  showFields: boolean;
  perDayHint: string;
  /** Above the per-day control (Stage 2: the series lengths). */
  beforePerDay?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  function toggleDay(day: PlayingDay) {
    const next = toggleDayWithWindows(value.playing_days, value.day_windows, stash, day, DEFAULT_DAY_WINDOW);
    onChange({ playing_days: next.playingDays, day_windows: next.dayWindows as DayWindowMap });
    onStashChange(next.stash);
  }
  function setWindow(day: PlayingDay, field: "start" | "end", v: string) {
    onChange({
      day_windows: { ...value.day_windows, [day]: { ...(value.day_windows[day] ?? DEFAULT_DAY_WINDOW), [field]: v } },
    });
  }
  function toggleVenue(id: string) {
    const on = value.venue_assignments.some((a) => a.venue_id === id);
    onChange({
      venue_assignments: on
        ? value.venue_assignments.filter((a) => a.venue_id !== id)
        : [...value.venue_assignments, { venue_id: id, allow_games: true, allow_practices: false }],
    });
  }
  const id = (k: string) => `stage${num}-${k}`;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0C1F3F] text-xs font-bold text-white">{num}</span>
        <h4 className="text-sm font-semibold text-[#0C1F3F]">{title}</h4>
        <span className="ml-auto text-xs text-gray-400">{gamesLabel}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label htmlFor={id("start")} className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Starts
          <input
            id={id("start")}
            type="date"
            value={value.start_date}
            onChange={(e) => onChange({ start_date: e.target.value })}
            className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </label>
        <label htmlFor={id("end")} className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
          Ends
          <input
            id={id("end")}
            type="date"
            value={value.end_date}
            onChange={(e) => onChange({ end_date: e.target.value })}
            className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-gray-700">Days</span>
        <div className="flex flex-wrap gap-1.5">
          {ORDERED_DAYS.map(({ key, label }) => {
            const on = value.playing_days.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(key)}
                className={`h-9 w-11 rounded-lg border text-xs font-semibold transition-colors ${
                  on ? "border-[#0C1F3F] bg-[#0C1F3F] text-white" : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {value.playing_days.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ORDERED_DAYS.filter(({ key }) => value.playing_days.includes(key)).map(({ key }) => {
            const w = value.day_windows[key] ?? DEFAULT_DAY_WINDOW;
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-gray-700">{DAY_LONG[key]}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label={`${DAY_LONG[key]} start`}
                    value={w.start}
                    onChange={(e) => setWindow(key, "start", e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none"
                  />
                  <span className="text-xs text-gray-300">–</span>
                  <input
                    type="time"
                    aria-label={`${DAY_LONG[key]} end`}
                    value={w.end}
                    onChange={(e) => setWindow(key, "end", e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {beforePerDay}

      <GamesPerDayControl
        value={value.games_per_team_per_day}
        onChange={(v) => onChange({ games_per_team_per_day: v })}
        hint={perDayHint}
      />

      {showFields && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700">Fields</span>
          {venues === null ? (
            <p className="text-xs text-gray-400">Loading fields…</p>
          ) : venues.length === 0 ? (
            <p className="text-xs text-gray-500">
              No fields have hours set yet.{" "}
              <Link href="/dashboard/venues" className="font-medium text-[#16a34a] underline">
                Set hours on the Venues page
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {venues.map((v) => {
                const on = value.venue_assignments.some((a) => a.venue_id === v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleVenue(v.id)}
                    className={`min-h-9 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      on ? "border-[#0C1F3F] bg-[#0C1F3F] text-white" : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {qualifiedVenueLabel(v)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {footer}
    </section>
  );
}

export function StepStageDates({
  data,
  update,
  currentOrgId,
  stash1,
  stash2,
  onStash1Change,
  onStash2Change,
}: Props) {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venueError, setVenueError] = useState(false);

  useEffect(() => {
    createClient()
      .from("venues")
      .select("id, name, location:locations(name)")
      .eq("owner_id", currentOrgId)
      .eq("availability_configured", true)
      .then(({ data: rows, error }) => {
        if (error) setVenueError(true);
        setVenues(((rows as Venue[]) ?? []).slice().sort(byQualifiedVenueLabel));
      });
  }, [currentOrgId]);

  const teams = data.seeding.length;
  const rrGames = (teams * (teams - 1)) / 2;
  const bracketGames = bracketGamesLabel(wizardRounds(data.advance_count), data.stage2.series_by_round);
  const order = stageDateProblem(data.end_date, data.stage2.start_date);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Dates &amp; fields</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Each stage has its own dates, days and fields. Stage 2 has to start after Stage 1&apos;s last day.
        </p>
      </div>
      {venueError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Couldn&apos;t load your fields. Close the wizard and try again.
        </p>
      )}

      <StagePanel
        num={1}
        title="Stage 1 · Round robin"
        gamesLabel={`${rrGames} game${rrGames === 1 ? "" : "s"}`}
        value={{
          start_date: data.start_date,
          end_date: data.end_date,
          playing_days: data.playing_days,
          day_windows: data.day_windows,
          venue_assignments: data.venue_assignments,
          games_per_team_per_day: data.games_per_team_per_day,
        }}
        onChange={(patch) => update(patch)}
        stash={stash1}
        onStashChange={onStash1Change}
        venues={venues}
        showFields
        perDayHint={RR_PER_DAY_HINT}
      />

      <StagePanel
        num={2}
        title="Stage 2 · Bracket"
        gamesLabel={bracketGames}
        value={data.stage2}
        onChange={(patch) => update({ stage2: { ...data.stage2, ...patch } })}
        stash={stash2}
        onStashChange={onStash2Change}
        venues={venues}
        showFields={!data.stage2.same_fields}
        perDayHint={STAGE2_PER_DAY_HINT}
        beforePerDay={
          <SeriesLengthsControl
            teamCount={data.advance_count}
            value={data.stage2.series_by_round}
            onChange={(series_by_round) => update({ stage2: { ...data.stage2, series_by_round } })}
          />
        }
        footer={
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={data.stage2.same_fields}
              onChange={(e) =>
                update({
                  stage2: {
                    ...data.stage2,
                    same_fields: e.target.checked,
                    // Turning it off starts from Stage 1's fields.
                    venue_assignments: e.target.checked ? data.stage2.venue_assignments : data.venue_assignments,
                  },
                })
              }
              className="h-4 w-4 rounded border-gray-300 accent-[#22C55E]"
            />
            Same fields as Stage 1
          </label>
        }
      />

      {order && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {order}
        </p>
      )}
    </div>
  );
}
