"use client";

import { useState, useEffect } from "react";
import { MapPin, Plus, Pencil, Check, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Venue } from "@/types/database";

const TYPE_LABELS: Record<string, string> = {
  game:     "Game",
  practice: "Practice",
  both:     "Both",
};

const TYPE_STYLES: Record<string, string> = {
  game:     "bg-blue-50 text-blue-700",
  practice: "bg-violet-50 text-violet-700",
  both:     "bg-emerald-50 text-emerald-700",
};

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState<string>("game");
  const [addCapacity, setAddCapacity] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<string>("game");
  const [editCapacity, setEditCapacity] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function loadVenues() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("venues")
      .select("*")
      .eq("owner_id", user.id)
      .order("name");
    setVenues((data as Venue[]) ?? []);
  }

  useEffect(() => {
    loadVenues().then(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    if (!addName.trim()) return;
    setAdding(true);
    setAddError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("venues")
      .insert([{
        name: addName.trim(),
        venue_type: addType,
        capacity: addCapacity ? parseInt(addCapacity, 10) : null,
        owner_id: user.id,
      }]);
    if (error) {
      setAddError(error.message);
      setAdding(false);
      return;
    }
    await loadVenues();
    setAddName("");
    setAddType("game");
    setAddCapacity("");
    setShowAdd(false);
    setAdding(false);
  }

  function startEdit(venue: Venue) {
    setEditId(venue.id);
    setEditName(venue.name);
    setEditType(venue.venue_type ?? "game");
    setEditCapacity(venue.capacity ? String(venue.capacity) : "");
    setSaveError(null);
  }

  function cancelEdit() {
    setEditId(null);
    setSaveError(null);
  }

  async function handleSave(venueId: string) {
    if (!editName.trim()) return;
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("venues")
      .update({
        name: editName.trim(),
        venue_type: editType,
        capacity: editCapacity ? parseInt(editCapacity, 10) : null,
      } as never)
      .eq("id", venueId);
    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }
    await loadVenues();
    setEditId(null);
    setSaving(false);
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

      {/* Add form */}
      {showAdd && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <input
            type="text"
            placeholder="Venue name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            autoFocus
            className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value)}
            className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          >
            <option value="game">Game</option>
            <option value="practice">Practice</option>
            <option value="both">Both</option>
          </select>
          <input
            type="number"
            placeholder="Capacity (optional)"
            value={addCapacity}
            onChange={(e) => setAddCapacity(e.target.value)}
            min="0"
            className="h-10 w-36 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !addName.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {adding ? "Adding…" : "Add venue"}
          </button>
          <button
            onClick={() => { setShowAdd(false); setAddName(""); setAddType("game"); setAddCapacity(""); setAddError(null); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 transition-colors hover:text-gray-700"
          >
            Cancel
          </button>
          {addError && (
            <p className="w-full text-xs text-red-500">{addError}</p>
          )}
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
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {venues.map((venue) =>
            editId === venue.id ? (
              /* ── Edit card ── */
              <div key={venue.id} className="flex flex-col gap-3 rounded-xl border border-[#22C55E]/40 bg-white p-4 shadow-sm">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave(venue.id)}
                  autoFocus
                  className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                >
                  <option value="game">Game</option>
                  <option value="practice">Practice</option>
                  <option value="both">Both</option>
                </select>
                <input
                  type="number"
                  placeholder="Capacity (optional)"
                  value={editCapacity}
                  onChange={(e) => setEditCapacity(e.target.value)}
                  min="0"
                  className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSave(venue.id)}
                    disabled={saving || !editName.trim()}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#22C55E] py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
                  >
                    <X className="h-3 w-3" />
                    Cancel
                  </button>
                </div>
                {saveError && (
                  <p className="text-xs text-red-500">{saveError}</p>
                )}
              </div>
            ) : (
              /* ── Display card ── */
              <div key={venue.id} className="group flex items-start justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-1.5">
                  <p className="font-semibold text-[#0C1F3F]">{venue.name}</p>
                  <span className={`self-start rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[venue.venue_type ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                    {TYPE_LABELS[venue.venue_type ?? ""] ?? venue.venue_type}
                  </span>
                  {venue.address && <p className="text-xs text-gray-400">{venue.address}</p>}
                  {(venue.city || venue.state) && (
                    <p className="text-xs text-gray-400">{[venue.city, venue.state].filter(Boolean).join(", ")}</p>
                  )}
                  {venue.capacity != null && (
                    <p className="text-xs text-gray-400">{venue.capacity.toLocaleString()} capacity</p>
                  )}
                </div>
                <button
                  onClick={() => startEdit(venue)}
                  className="ml-2 flex-shrink-0 rounded-lg p-1.5 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Edit venue"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
