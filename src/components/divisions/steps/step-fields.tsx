"use client";

import { useState, useEffect } from "react";
import { MapPin, AlertTriangle, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { WizardData } from "../wizard-types";
import type { Venue } from "@/types/database";

interface Props {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  leagueId: string;
}

export function StepFields({ data, update, leagueId }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [conflictMap, setConflictMap] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueType, setNewVenueType] = useState<"game" | "practice" | "both">("game");
  const [addingVenue, setAddingVenue] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: venueData } = await supabase
        .from("venues")
        .select("*")
        .eq("owner_id", user.id)
        .order("name");

      const allVenues = (venueData as Venue[]) ?? [];
      setVenues(allVenues);

      // Find venues already assigned to other divisions in this league
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
  }, [leagueId]);

  function toggleVenue(id: string) {
    const ids = data.venue_ids.includes(id)
      ? data.venue_ids.filter((v) => v !== id)
      : [...data.venue_ids, id];
    update({ venue_ids: ids });
  }

  async function addVenue() {
    if (!newVenueName.trim()) return;
    setAddingVenue(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: newV } = await supabase
      .from("venues")
      .insert([{ name: newVenueName.trim(), owner_id: user.id, venue_type: newVenueType }])
      .select("*")
      .single();

    if (newV) {
      const venue = newV as Venue;
      setVenues((prev) => [...prev, venue].sort((a, b) => a.name.localeCompare(b.name)));
      update({ venue_ids: [...data.venue_ids, venue.id] });
    }

    setNewVenueName("");
    setNewVenueType("game");
    setShowAddForm(false);
    setAddingVenue(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Fields & venues</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Select which fields this division will use for scheduling.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <svg className="h-5 w-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      ) : venues.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-center">
          <MapPin className="h-6 w-6 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-600">No venues yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Add a venue below to assign fields to this division.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {venues.map((venue) => {
            const selected = data.venue_ids.includes(venue.id);
            const conflict = conflictMap[venue.id];
            return (
              <button
                key={venue.id}
                type="button"
                onClick={() => toggleVenue(venue.id)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                  selected
                    ? "border-[#22C55E] bg-[#22C55E]/5 ring-1 ring-[#22C55E]/30"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      selected ? "border-[#22C55E] bg-[#22C55E]" : "border-gray-300"
                    }`}
                  >
                    {selected && (
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
                  <div>
                    <p className="text-sm font-medium text-[#0C1F3F]">{venue.name}</p>
                    {(venue.city || venue.state) && (
                      <p className="text-xs text-gray-400">
                        {[venue.city, venue.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {venue.capacity != null && (
                    <span className="text-xs text-gray-400">{venue.capacity} cap.</span>
                  )}
                  {conflict && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                      <AlertTriangle className="h-3 w-3" />
                      Already used by {conflict}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showAddForm ? (
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Venue name"
            value={newVenueName}
            onChange={(e) => setNewVenueName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addVenue()}
            autoFocus
            className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
          <select
            value={newVenueType}
            onChange={(e) => setNewVenueType(e.target.value as "game" | "practice" | "both")}
            className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          >
            <option value="game">Game</option>
            <option value="practice">Practice</option>
            <option value="both">Both</option>
          </select>
          <button
            type="button"
            onClick={addVenue}
            disabled={addingVenue || !newVenueName.trim()}
            className="rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
          >
            {addingVenue ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(false);
              setNewVenueName("");
              setNewVenueType("game");
            }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
        >
          <Plus className="h-4 w-4" />
          Add a new venue
        </button>
      )}
    </div>
  );
}
