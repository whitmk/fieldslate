"use client";

import { useEffect, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SnackShackWizardData } from "../wizard-types";

interface Venue {
  id: string;
  name: string;
  city: string | null;
}

interface Props {
  data: SnackShackWizardData;
  update: (patch: Partial<SnackShackWizardData>) => void;
  leagueId: string;
  currentOrgId: string;
}

export function StepVenues({ data, update, leagueId, currentOrgId }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      // Load venues associated with this season via division_venues
      const { data: dvRaw } = await supabase
        .from("division_venues")
        .select("venue_id, division:divisions!inner(league_id)")
        .eq("division.league_id" as never, leagueId);

      const venueIds = Array.from(
        new Set(
          ((dvRaw ?? []) as { venue_id: string }[]).map((r) => r.venue_id),
        ),
      );

      if (venueIds.length > 0) {
        const { data: vRaw } = await supabase
          .from("venues")
          .select("id, name, city")
          .in("id", venueIds)
          .order("name", { ascending: true });
        setVenues((vRaw as Venue[] | null) ?? []);
      } else {
        // Fallback: load all venues owned by the user
        const { data: vRaw } = await supabase
          .from("venues")
          .select("id, name, city")
          .eq("owner_id", currentOrgId)
          .order("name", { ascending: true });
        setVenues((vRaw as Venue[] | null) ?? []);
      }
      setLoading(false);
    }
    load();
  }, [leagueId, currentOrgId]);

  function toggle(venueId: string) {
    const isOn = data.home_venue_ids.includes(venueId);
    update({
      home_venue_ids: isOn
        ? data.home_venue_ids.filter((id) => id !== venueId)
        : [...data.home_venue_ids, venueId],
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Home venues</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Select the venues considered &ldquo;home&rdquo; for Snack Shack duty. These are
          used when applying the scheduling preference.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : venues.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <MapPin className="mb-2 h-8 w-8 text-gray-200" />
          <p className="text-sm text-gray-500">No venues found for this season.</p>
          <p className="mt-0.5 text-xs text-gray-400">
            Add venues via Venues → then assign them to a division.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {venues.map((v, i) => {
            const isLast = i === venues.length - 1;
            const checked = data.home_venue_ids.includes(v.id);
            return (
              <label
                key={v.id}
                className={`flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50 ${
                  !isLast ? "border-b border-gray-100" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(v.id)}
                  className="h-4 w-4 rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]/30"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{v.name}</p>
                  {v.city && (
                    <p className="text-xs text-gray-400">{v.city}</p>
                  )}
                </div>
                {checked && (
                  <span className="rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-[10px] font-semibold text-[#16a34a]">
                    Home
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
