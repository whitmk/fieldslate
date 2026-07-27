"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/types/database";

// Sentinel option value for "＋ New location…". Not a real id, so it can never
// collide with a location uuid; selecting it opens the inline create field.
const NEW_SENTINEL = "__new_location__";

interface Props {
  /** Org that owns both the venue being edited and its locations. Scopes the
   *  list AND stamps owner_id on a newly-created location. */
  ownerId: string;
  /** Currently-selected location_id, or null for Unassigned. */
  value: string | null;
  onChange: (locationId: string | null) => void;
  /** Fires after a location is created here, so a host that renders its own
   *  location list (the Venues page grouping) can refresh. */
  onLocationsChanged?: () => void;
  disabled?: boolean;
}

/** Location chooser for the venue add/edit forms. A venue with no location
 *  behaves exactly as before this feature — "Unassigned" writes null. The
 *  venue stays the atomic bookable unit; the location is a display grouping
 *  only (scope fence). Self-fetches its list so it drops into both the Venues
 *  page add form and the shared VenueEditForm (two hosts) without threading
 *  location state through either. */
export function LocationPicker({
  ownerId,
  value,
  onChange,
  onLocationsChanged,
  disabled,
}: Props) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline "＋ New location" state.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLocations() {
    const supabase = createClient();
    const { data } = await supabase
      .from("locations")
      .select("*")
      .eq("owner_id", ownerId)
      .order("name");
    setLocations((data as Location[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadLocations();
  }, [ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(raw: string) {
    if (raw === NEW_SENTINEL) {
      setCreating(true);
      setError(null);
      return;
    }
    onChange(raw === "" ? null : raw);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name || saving) return;
    // Reject a case-insensitive duplicate of an existing location — there is no
    // uniqueness constraint, and two "Monroe Complex" rows would be
    // indistinguishable in every picker.
    const clash = locations.some(
      (l) => l.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      setError("A location with that name already exists.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data, error: dbErr } = await supabase
      .from("locations")
      .insert([{ name, owner_id: ownerId }] as never)
      .select("*")
      .single();
    if (dbErr || !data) {
      // 23505 = the 0086 unique index firing on a race the app guard above
      // couldn't see (two tabs). Map it to the same friendly message; never
      // surface a raw unique-violation.
      setError(
        dbErr?.code === "23505"
          ? "A location with that name already exists."
          : dbErr?.message ?? "Could not create location.",
      );
      setSaving(false);
      return;
    }
    const created = data as Location;
    // Insert into the local list in name order, select it, notify the host.
    setLocations((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    onChange(created.id);
    onLocationsChanged?.();
    setCreating(false);
    setNewName("");
    setSaving(false);
  }

  function cancelCreate() {
    setCreating(false);
    setNewName("");
    setError(null);
  }

  if (creating) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            autoFocus
            placeholder="New location name (e.g. Monroe Complex)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") cancelCreate();
            }}
            disabled={saving}
            className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !newName.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-[#22C55E] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </button>
          <button
            type="button"
            onClick={cancelCreate}
            disabled={saving}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => handleSelect(e.target.value)}
      disabled={disabled || loading}
      aria-label="Location"
      className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:opacity-50"
    >
      <option value="">{loading ? "Loading locations…" : "Unassigned (no location)"}</option>
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
        </option>
      ))}
      <option value={NEW_SENTINEL}>＋ New location…</option>
    </select>
  );
}
