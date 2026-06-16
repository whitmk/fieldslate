"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MapPin, AlertTriangle, Plus, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  parseAvailability,
  DAY_KEYS,
  DAY_LABELS,
  type DayKey,
} from "@/lib/venues/availability";
import type { WizardData, VenueAssignment } from "../wizard-types";
import type { Venue } from "@/types/database";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  leagueId: string;
  currentOrgId: string;
}

export function StepFields({ data, update, leagueId, currentOrgId }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [conflictMap, setConflictMap] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const { data: venueData } = await supabase
        .from("venues")
        .select("*")
        .eq("owner_id", currentOrgId)
        .eq("availability_configured", true)
        .order("name");

      const allVenues = (venueData as Venue[]) ?? [];
      setVenues(allVenues);

      const { data: existingDivisions } = await supabase
        .from("divisions")
        .select("id, name")
        .eq("league_id", leagueId);

      if (existingDivisions && existingDivisions.length > 0) {
        const divIds = existingDivisions.map((d: { id: string }) => d.id);
        const { data: dvRows } = await supabase
          .from("division_venues")
          .select("venue_id, division_id")
          .in("division_id", divIds);

        if (dvRows) {
          const map: Record<string, string> = {};
          for (const row of dvRows as { venue_id: string; division_id: string }[]) {
            const div = existingDivisions.find((d: { id: string; name: string }) => d.id === row.division_id);
            if (div) map[row.venue_id] = (div as { id: string; name: string }).name;
          }
          setConflictMap(map);
        }
      }

      setLoading(false);
    }
    load();
  }, [leagueId, currentOrgId]);

  function isSelected(venueId: string): boolean {
    return data.venue_assignments.some((a) => a.venue_id === venueId);
  }

  function toggleAssignment(venueId: string) {
    if (isSelected(venueId)) {
      update({ venue_assignments: data.venue_assignments.filter((a) => a.venue_id !== venueId) });
    } else {
      const next: VenueAssignment = { venue_id: venueId, allow_games: true, allow_practices: false };
      update({ venue_assignments: [...data.venue_assignments, next] });
    }
  }

  // Live closed-day warning: once at least one game venue is selected, flag any
  // chosen playing day that none of those venues are open on — those games
  // won't schedule (the same condition generateSchedule now rejects by name).
  // Derived in render, so it tracks venue selection and playing days live.
  const selectedGameVenueIds = new Set(
    data.venue_assignments.filter((a) => a.allow_games).map((a) => a.venue_id),
  );
  const openDays = new Set<DayKey>();
  for (const v of venues) {
    if (!selectedGameVenueIds.has(v.id)) continue;
    const av = parseAvailability(v.availability);
    for (const key of DAY_KEYS) if (av[key]) openDays.add(key);
  }
  const uncoveredDays = DAY_KEYS.filter(
    (d) => data.playing_days.includes(d) && !openDays.has(d),
  );
  const showDayWarning = selectedGameVenueIds.size > 0 && uncoveredDays.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Fields & venues</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Choose which venues this division can use for games.
        </p>
      </div>

      {!loading && showDayWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            This division plays{" "}
            {uncoveredDays.map((d) => DAY_LABELS[d]).join(", ")}, but none of
            your selected fields are open{" "}
            {uncoveredDays.length === 1 ? "that day" : "those days"} — those
            games won&rsquo;t schedule.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <svg className="h-5 w-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : venues.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
          <Clock className="h-6 w-6 text-gray-300" />
          <p className="text-sm font-medium text-gray-600">
            No venues with availability set
          </p>
          <p className="text-xs text-gray-400">
            Configure venue hours first.
          </p>
          <Link
            href="/dashboard/venues"
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a]"
          >
            Go to Venues
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {venues.map((venue) => {
            const selected = isSelected(venue.id);
            const conflict = conflictMap[venue.id];

            return (
              <button
                key={venue.id}
                type="button"
                onClick={() => toggleAssignment(venue.id)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                  selected
                    ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <MapPin className="h-4 w-4 flex-shrink-0 text-gray-300" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#0C1F3F] truncate">{venue.name}</p>
                    {(venue.city || venue.state) && (
                      <p className="text-xs text-gray-400">
                        {[venue.city, venue.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {conflict && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        Also used by {conflict}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                    selected ? "border-[#22C55E] bg-[#22C55E]" : "border-gray-300"
                  }`}
                >
                  {selected && (
                    <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {venues.length > 0 && (
        <Link
          href="/dashboard/venues"
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
        >
          <Plus className="h-4 w-4" />
          Add a new venue
        </Link>
      )}
    </div>
  );
}
