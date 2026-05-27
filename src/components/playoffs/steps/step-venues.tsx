"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MapPin, Plus, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, VenueAssignment } from "../playoff-wizard-types";

interface Venue {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
}

interface Props {
  data: PlayoffWizardData;
  update: (patch: Partial<PlayoffWizardData>) => void;
  leagueId: string;
}

function CheckboxCell({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-1 select-none">
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <div
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
          checked
            ? "border-[#22C55E] bg-[#22C55E]"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        {checked && (
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </div>
    </label>
  );
}

export function StepVenues({ data, update }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Only show venues with hours configured — engine can't schedule against
      // unconfigured ones anyway.
      const { data: venueData } = await supabase
        .from("venues")
        .select("id, name, city, state")
        .eq("owner_id", user.id)
        .eq("availability_configured", true)
        .order("name");

      setVenues((venueData as Venue[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  function getAssignment(venueId: string): VenueAssignment | undefined {
    return data.venue_assignments.find((a) => a.venue_id === venueId);
  }

  function setAssignment(
    venueId: string,
    patch: Partial<Omit<VenueAssignment, "venue_id">>
  ) {
    const current = getAssignment(venueId);
    const next: VenueAssignment = current
      ? { ...current, ...patch }
      : { venue_id: venueId, allow_games: false, allow_practices: false, ...patch };

    if (!next.allow_games && !next.allow_practices) {
      update({
        venue_assignments: data.venue_assignments.filter(
          (a) => a.venue_id !== venueId
        ),
      });
    } else if (current) {
      update({
        venue_assignments: data.venue_assignments.map((a) =>
          a.venue_id === venueId ? next : a
        ),
      });
    } else {
      update({ venue_assignments: [...data.venue_assignments, next] });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Venues</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Choose which venues to use for playoff games and practices.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <svg
            className="h-5 w-5 animate-spin text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
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
            const assignment = getAssignment(venue.id);
            const isSelected = !!assignment;

            return (
              <div
                key={venue.id}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${
                  isSelected
                    ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                    : "border-gray-200"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <MapPin className="h-4 w-4 flex-shrink-0 text-gray-300" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#0C1F3F]">
                      {venue.name}
                    </p>
                    {(venue.city || venue.state) && (
                      <p className="text-xs text-gray-400">
                        {[venue.city, venue.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="ml-4 flex flex-shrink-0 items-center gap-5">
                  <CheckboxCell
                    label="Games"
                    checked={assignment?.allow_games ?? false}
                    onChange={(v) =>
                      setAssignment(venue.id, {
                        allow_games: v,
                        allow_practices: assignment?.allow_practices ?? false,
                      })
                    }
                  />
                  <CheckboxCell
                    label="Practices"
                    checked={assignment?.allow_practices ?? false}
                    onChange={(v) =>
                      setAssignment(venue.id, {
                        allow_games: assignment?.allow_games ?? false,
                        allow_practices: v,
                      })
                    }
                  />
                </div>
              </div>
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
