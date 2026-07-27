"use client";

import { useState, useEffect } from "react";
import {
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  Check,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";
import { VenueEditForm } from "@/components/venues/venue-edit-form";
import { LocationPicker } from "@/components/venues/location-picker";
import type { Venue, Location } from "@/types/database";
import {
  DAY_KEYS,
  DAY_LABELS,
  parseAvailability,
} from "@/lib/venues/availability";
import {
  deriveVenueGameDays,
  venuesWithAnyGame,
  type GameDayInput,
  type VenueGameDays,
} from "@/lib/venues/game-days";

interface Props {
  currentOrgId: string;
  /** Fires after a successful venue insert or update. Embedders that track
   *  venue state outside this component (the /setup wizard's step gating)
   *  re-check here instead of polling. */
  onChanged?: () => void;
  /** Server-resolved /setup link gate (Chunk 4): own-org owner with setup
   *  incomplete. Absent in the /setup embed itself — no self-referential
   *  link inside the wizard. */
  showSetupLink?: boolean;
}

export function VenuesPageClient({
  currentOrgId,
  onChanged,
  showSetupLink,
}: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  // Locations (park/complex groupings). When the org has none, the list renders
  // exactly as before — a flat grid — and no headings appear.
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  // Derived game days per venue (read-only) + which venues have any schedule.
  // Fetched once per load, not per card — the card only reads its slice.
  const [gameDaysByVenue, setGameDaysByVenue] = useState<Map<string, VenueGameDays>>(new Map());
  const [venuesWithGames, setVenuesWithGames] = useState<Set<string>>(new Set());

  // Add form (basics only — admin sets hours after creating)
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addLocationId, setAddLocationId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Inline edit — all field/draft state lives in the shared VenueEditForm;
  // this page only tracks WHICH venue is in edit mode.
  const [editId, setEditId] = useState<string | null>(null);

  // Delete — the venue queued for the confirm dialog. Deletion goes through
  // the delete_venue_if_unreferenced RPC (0078), which is the guard: it
  // re-checks every live reference server-side and refuses if any exist. The
  // dialog owns the RPC call and busy/error/blocked state.
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null);

  // Location queued for the delete-confirm dialog. Deletion goes through the
  // delete_location_if_unreferenced RPC (0085), which refuses (and names the
  // fields) while any venue still points at the location.
  const [deleteLocationTarget, setDeleteLocationTarget] = useState<Location | null>(null);

  // Inline location rename (heading pencil). A plain update — venues reference
  // locations by id, so a rename touches nothing else (no name-keyed refs, no
  // reference integrity to guard, no RPC needed).
  const [renamingLocationId, setRenamingLocationId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  function startRenameLocation(loc: Location) {
    setRenamingLocationId(loc.id);
    setRenameName(loc.name);
    setRenameError(null);
  }

  function cancelRenameLocation() {
    setRenamingLocationId(null);
    setRenameName("");
    setRenameError(null);
  }

  async function handleRenameLocation(loc: Location) {
    const name = renameName.trim();
    if (renameSaving) return;
    if (!name) {
      setRenameError("Location name can't be empty.");
      return;
    }
    // Reject a case-insensitive duplicate of ANOTHER location in this org —
    // there is no uniqueness constraint, and two "Monroe Complex" rows would be
    // indistinguishable in every picker. An unchanged name (same row) is fine.
    const clash = locations.some(
      (l) => l.id !== loc.id && l.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      setRenameError("A location with that name already exists.");
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("locations")
      .update({ name } as never)
      .eq("id", loc.id);
    if (error) {
      // 23505 = the 0086 unique index firing on a race the app guard above
      // couldn't see (two tabs). Map it to the same friendly message; never
      // surface a raw unique-violation.
      setRenameError(
        (error as { code?: string }).code === "23505"
          ? "A location with that name already exists."
          : error.message ?? "Could not rename location.",
      );
      setRenameSaving(false);
      return;
    }
    await loadLocations();
    setRenameSaving(false);
    cancelRenameLocation();
  }

  async function loadLocations() {
    const supabase = createClient();
    const { data } = await supabase
      .from("locations")
      .select("*")
      .eq("owner_id", currentOrgId)
      .order("name");
    setLocations((data as Location[]) ?? []);
  }

  async function loadVenues() {
    const supabase = createClient();
    await loadLocations();
    const { data } = await supabase
      .from("venues")
      .select("*")
      .eq("owner_id", currentOrgId)
      .order("name");
    const venueRows = (data as Venue[]) ?? [];
    setVenues(venueRows);

    // One grouped games read for all this org's venues → derived game days.
    const ids = venueRows.map((v) => v.id);
    if (ids.length > 0) {
      const { data: games } = await supabase
        .from("games")
        .select("venue_id, scheduled_at, status")
        .in("venue_id", ids);
      const rows = (games ?? []) as GameDayInput[];
      setGameDaysByVenue(deriveVenueGameDays(rows));
      setVenuesWithGames(venuesWithAnyGame(rows));
    } else {
      setGameDaysByVenue(new Map());
      setVenuesWithGames(new Set());
    }
  }

  useEffect(() => {
    loadVenues().then(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    if (!addName.trim()) return;
    setAdding(true);
    setAddError(null);
    const supabase = createClient();
    const { data: newRow, error } = await supabase
      .from("venues")
      .insert([{
        name: addName.trim(),
        location_id: addLocationId,
        owner_id: currentOrgId,
      }] as never)
      .select("*")
      .single();
    if (error || !newRow) {
      setAddError(error?.message ?? "Could not create venue.");
      setAdding(false);
      return;
    }
    await loadVenues();
    setAddName("");
    setAddLocationId(null);
    setShowAdd(false);
    setAdding(false);
    // Drop the admin straight into the availability editor for the new venue.
    setEditId(newRow.id);
    onChanged?.();
  }

  const unconfiguredCount = venues.filter((v) => !v.availability_configured).length;

  // Edit-or-display card for one venue. Shared by the flat and grouped layouts
  // so both stay byte-identical in behavior.
  const renderVenueCard = (venue: Venue) =>
    editId === venue.id ? (
      <VenueEditForm
        key={venue.id}
        venue={venue}
        gameDays={gameDaysByVenue.get(venue.id)}
        venueHasGames={venuesWithGames.has(venue.id)}
        className="rounded-xl border border-[#22C55E]/40 bg-white p-4 shadow-sm"
        onLocationsChanged={loadLocations}
        onSaved={async () => {
          await loadVenues();
          setEditId(null);
          onChanged?.();
        }}
        onCancel={() => setEditId(null)}
      />
    ) : (
      <DisplayCard
        key={venue.id}
        venue={venue}
        onEdit={() => setEditId(venue.id)}
        onDelete={() => setDeleteTarget(venue)}
      />
    );

  // Group venues by location for the nested layout. Only used when the org has
  // at least one location; otherwise the flat grid renders exactly as before.
  const venuesByLocation = new Map<string, Venue[]>();
  const unassignedVenues: Venue[] = [];
  for (const v of venues) {
    if (v.location_id) {
      const list = venuesByLocation.get(v.location_id) ?? [];
      list.push(v);
      venuesByLocation.set(v.location_id, list);
    } else {
      unassignedVenues.push(v);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">Venues</h1>
          <p className="mt-1 text-sm text-gray-500">Manage fields and facilities.</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
          >
            <Plus className="h-4 w-4" />
            Add venue
          </button>
        )}
      </div>

      {/* Banner when any venue is missing hours */}
      {!loading && unconfiguredCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            {unconfiguredCount} {unconfiguredCount === 1 ? "venue needs" : "venues need"} availability set before
            {unconfiguredCount === 1 ? " it" : " they"} can be used for scheduling.
          </p>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Venue (field) name</label>
              <input
                type="text"
                placeholder="e.g. Andrews"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                autoFocus
                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Location (optional)</label>
              <LocationPicker
                ownerId={currentOrgId}
                value={addLocationId}
                onChange={setAddLocationId}
                onLocationsChanged={loadLocations}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAdd}
              disabled={adding || !addName.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {adding ? "Adding…" : "Add venue"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddName(""); setAddLocationId(null); setAddError(null); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 transition-colors hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          {addError && (
            <p className="text-xs text-red-500">{addError}</p>
          )}
          <p className="text-xs text-gray-400">
            You&rsquo;ll set the venue&rsquo;s open hours next. A location groups
            several fields under one park or complex — it&rsquo;s for labeling
            only and doesn&rsquo;t change scheduling.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
        </div>
      ) : venues.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <MapPin className="mb-3 h-8 w-8 text-gray-300" />
          <p className="font-medium text-[#0C1F3F]">No venues yet</p>
          <p className="mt-1 text-sm text-gray-400">Add your first venue to assign games to fields.</p>
          {showSetupLink && <FinishSetupLink className="mt-3" />}
        </div>
      ) : locations.length === 0 ? (
        // No locations yet → flat grid, exactly as before this feature.
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {venues.map((venue) => renderVenueCard(venue))}
        </div>
      ) : (
        // Nested: one section per location, its fields beneath, then an
        // "Unassigned" group for venues with no location.
        <div className="flex flex-col gap-6">
          {locations.map((loc) => {
            const locVenues = venuesByLocation.get(loc.id) ?? [];
            return (
              <section key={loc.id} className="group flex flex-col gap-3">
                {renamingLocationId === loc.id ? (
                  <div className="flex flex-col gap-1 border-b border-gray-100 pb-1.5">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 flex-shrink-0 text-[#22C55E]" />
                      <input
                        value={renameName}
                        autoFocus
                        onChange={(e) => { setRenameName(e.target.value); setRenameError(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameLocation(loc);
                          if (e.key === "Escape") cancelRenameLocation();
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30"
                      />
                      <button
                        type="button"
                        onClick={() => handleRenameLocation(loc)}
                        disabled={renameSaving || !renameName.trim()}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#22C55E] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                      >
                        {renameSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelRenameLocation}
                        disabled={renameSaving}
                        className="rounded-lg px-2 py-1 text-xs text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {renameError && <p className="pl-6 text-xs text-red-500">{renameError}</p>}
                  </div>
                ) : (
                  <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-[#0C1F3F]">
                      <MapPin className="h-4 w-4 text-[#22C55E]" />
                      {loc.name}
                      <span className="text-xs font-normal text-gray-400">
                        {locVenues.length} field{locVenues.length === 1 ? "" : "s"}
                      </span>
                    </h2>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => startRenameLocation(loc)}
                        title="Rename location"
                        className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
                        aria-label={`Rename location ${loc.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteLocationTarget(loc)}
                        title="Delete location"
                        className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                        aria-label={`Delete location ${loc.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
                {locVenues.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    No fields in this location yet. Assign a field to it from the
                    field&rsquo;s edit form, or delete this empty location.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {locVenues.map((venue) => renderVenueCard(venue))}
                  </div>
                )}
              </section>
            );
          })}

          {unassignedVenues.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="border-b border-gray-100 pb-1.5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                  Unassigned
                  <span className="text-xs font-normal text-gray-400">
                    {unassignedVenues.length} field{unassignedVenues.length === 1 ? "" : "s"}
                  </span>
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {unassignedVenues.map((venue) => renderVenueCard(venue))}
              </div>
            </section>
          )}
        </div>
      )}

      {deleteTarget && (
        <DeleteVenueDialog
          venue={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={async () => {
            await loadVenues();
            setDeleteTarget(null);
            onChanged?.();
          }}
        />
      )}

      {deleteLocationTarget && (
        <DeleteLocationDialog
          location={deleteLocationTarget}
          onClose={() => setDeleteLocationTarget(null)}
          onDeleted={async () => {
            await loadVenues();
            setDeleteLocationTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ── Display card ───────────────────────────────────────────────────────────

function DisplayCard({
  venue,
  onEdit,
  onDelete,
}: {
  venue: Venue;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const availability = parseAvailability(venue.availability);
  const openDays = DAY_KEYS.filter((k) => availability[k]);

  return (
    <div className="group flex items-start justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-[#0C1F3F]">{venue.name}</p>
          {!venue.availability_configured && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-100"
            >
              <Clock className="h-2.5 w-2.5" />
              Set hours
            </button>
          )}
        </div>
        {venue.address && <p className="text-xs text-gray-400">{venue.address}</p>}
        {(venue.city || venue.state) && (
          <p className="text-xs text-gray-400">{[venue.city, venue.state].filter(Boolean).join(", ")}</p>
        )}
        {venue.availability_configured && openDays.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {openDays.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500"
                title={`${availability[k]!.start} – ${availability[k]!.end}`}
              >
                {DAY_LABELS[k]}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="ml-2 flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Edit venue"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
          aria-label="Delete venue"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Delete dialog ────────────────────────────────────────────────────────────

// Counts returned by delete_venue_if_unreferenced (0078) when it blocks. Keys
// mirror the RPC's jsonb exactly. Every one names a live, user-clearable thing;
// practices_legacy is deliberately absent from the RPC, so it can never appear
// here.
interface BlockCounts {
  games: number;
  playoff_games: number;
  practices: number;
  division_venues: number;
  division_default: number;
  team_preferred: number;
  snack_shack: number;
}

type DeleteRpcResult =
  | { deleted: true; name: string }
  | { blocked: true; name: string; counts: BlockCounts };

// Turn the block counts into plain-English phrases naming only things an admin
// can find and clear in the app. Games (regular + playoff) read as one bucket.
function describeBlockReasons(c: BlockCounts): string[] {
  const parts: string[] = [];
  const games = c.games + c.playoff_games;
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  if (games > 0) parts.push(plural(games, "game", "games"));
  if (c.practices > 0) parts.push(plural(c.practices, "practice", "practices"));
  if (c.division_venues > 0)
    parts.push(
      `assigned to ${plural(c.division_venues, "division", "divisions")}`,
    );
  if (c.division_default > 0)
    parts.push(
      `the default practice venue for ${plural(c.division_default, "division", "divisions")}`,
    );
  if (c.team_preferred > 0)
    parts.push(
      `the preferred field for ${plural(c.team_preferred, "team", "teams")}`,
    );
  if (c.snack_shack > 0)
    parts.push(`in ${plural(c.snack_shack, "snack shack setup", "snack shack setups")}`);
  return parts;
}

function DeleteVenueDialog({
  venue,
  onClose,
  onDeleted,
}: {
  venue: Venue;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockCounts | null>(null);

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    const supabase = createClient();
    // The RPC is the guard — it re-checks every reference server-side and
    // deletes only when there are none. A returned { blocked } means it
    // refused; nothing was deleted.
    const { data, error: rpcErr } = await supabase.rpc(
      "delete_venue_if_unreferenced" as never,
      { p_venue_id: venue.id } as never,
    );
    if (rpcErr) {
      setError(rpcErr.message ?? "Could not delete this venue.");
      setBusy(false);
      return;
    }
    const result = data as unknown as DeleteRpcResult;
    if ("blocked" in result) {
      setBlocked(result.counts);
      setBusy(false);
      return;
    }
    await onDeleted();
  }

  const reasons = blocked ? describeBlockReasons(blocked) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
          <Trash2 className="h-4 w-4 text-red-500" />
          <h2 className="text-base font-semibold text-[#0C1F3F]">Delete venue</h2>
        </div>
        <div className="flex flex-col gap-3 px-6 py-4">
          {blocked ? (
            <>
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{venue.name}</span> can&rsquo;t be
                deleted yet — it&rsquo;s still in use:
              </p>
              <ul className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-amber-500" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-500">
                Reassign or remove these first, then delete the venue.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-700">
              Delete <span className="font-semibold">{venue.name}</span>? This
              can&rsquo;t be undone. It will only be removed if nothing is
              scheduled at or set to use this venue.
            </p>
          )}
          {error && (
            <p className="rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          {blocked ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
            >
              Got it
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {busy ? "Deleting…" : "Delete venue"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Delete-location dialog ───────────────────────────────────────────────────

// Result shape of delete_location_if_unreferenced (0085). The COUNT is the
// guard: a location with any venue still pointing at it returns { blocked }
// and is NOT deleted; venue_names names the fields so the admin knows what to
// move first.
type DeleteLocationRpcResult =
  | { deleted: true; name: string }
  | { blocked: true; name: string; count: number; venue_names: string[] };

function DeleteLocationDialog({
  location,
  onClose,
  onDeleted,
}: {
  location: Location;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ count: number; venue_names: string[] } | null>(null);

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    const supabase = createClient();
    const { data, error: rpcErr } = await supabase.rpc(
      "delete_location_if_unreferenced" as never,
      { p_location_id: location.id } as never,
    );
    if (rpcErr) {
      setError(rpcErr.message ?? "Could not delete this location.");
      setBusy(false);
      return;
    }
    const result = data as unknown as DeleteLocationRpcResult;
    if ("blocked" in result) {
      setBlocked({ count: result.count, venue_names: result.venue_names });
      setBusy(false);
      return;
    }
    await onDeleted();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
          <Trash2 className="h-4 w-4 text-red-500" />
          <h2 className="text-base font-semibold text-[#0C1F3F]">Delete location</h2>
        </div>
        <div className="flex flex-col gap-3 px-6 py-4">
          {blocked ? (
            <>
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{location.name}</span> can&rsquo;t
                be deleted yet — {blocked.count} field
                {blocked.count === 1 ? " is" : "s are"} still in it:
              </p>
              <ul className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {blocked.venue_names.map((n) => (
                  <li key={n} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-amber-500" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-500">
                Move these fields to another location (or Unassigned) first, then
                delete this location. The fields themselves are not affected.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-700">
              Delete <span className="font-semibold">{location.name}</span>? This
              only removes the location grouping — it will succeed only if no
              fields are still assigned to it. No venue or schedule is affected.
            </p>
          )}
          {error && (
            <p className="rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          {blocked ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
            >
              Got it
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {busy ? "Deleting…" : "Delete location"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The edit card now lives in venue-edit-form.tsx (shared with the Practice
// tab's modal).
