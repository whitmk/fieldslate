"use client";

import { useState, useEffect } from "react";
import {
  MapPin,
  Plus,
  Pencil,
  Check,
  X,
  Loader2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";
import type { Venue } from "@/types/database";
import {
  DAY_KEYS,
  DAY_LABELS,
  hasAnyDayConfigured,
  parseAvailability,
  validateAvailability,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";

type AvailabilityDraft = Record<DayKey, { open: boolean; start: string; end: string }>;

const DEFAULT_DRAFT: AvailabilityDraft = {
  Mo: { open: false, start: "17:00", end: "21:00" },
  Tu: { open: false, start: "17:00", end: "21:00" },
  We: { open: false, start: "17:00", end: "21:00" },
  Th: { open: false, start: "17:00", end: "21:00" },
  Fr: { open: false, start: "17:00", end: "21:00" },
  Sa: { open: false, start: "08:00", end: "19:00" },
  Su: { open: false, start: "09:00", end: "17:00" },
};

function draftFromAvailability(av: VenueAvailability): AvailabilityDraft {
  const draft: AvailabilityDraft = { ...DEFAULT_DRAFT };
  for (const key of DAY_KEYS) {
    const w = av[key];
    if (w) draft[key] = { open: true, start: w.start, end: w.end };
    else draft[key] = { ...DEFAULT_DRAFT[key], open: false };
  }
  return draft;
}

function draftToAvailability(draft: AvailabilityDraft): VenueAvailability {
  const out: VenueAvailability = {};
  for (const key of DAY_KEYS) {
    const d = draft[key];
    if (d.open) out[key] = { start: d.start, end: d.end };
  }
  return out;
}

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
  const [loading, setLoading] = useState(true);

  // Add form (basics only — admin sets hours after creating)
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCapacity, setAddCapacity] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editDraft, setEditDraft] = useState<AvailabilityDraft>(DEFAULT_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function loadVenues() {
    const supabase = createClient();
    const { data } = await supabase
      .from("venues")
      .select("*")
      .eq("owner_id", currentOrgId)
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
    const { data: newRow, error } = await supabase
      .from("venues")
      .insert([{
        name: addName.trim(),
        capacity: addCapacity ? parseInt(addCapacity, 10) : null,
        owner_id: currentOrgId,
      }])
      .select("*")
      .single();
    if (error || !newRow) {
      setAddError(error?.message ?? "Could not create venue.");
      setAdding(false);
      return;
    }
    await loadVenues();
    setAddName("");
    setAddCapacity("");
    setShowAdd(false);
    setAdding(false);
    // Drop the admin straight into the availability editor for the new venue.
    startEdit(newRow as Venue);
    onChanged?.();
  }

  function startEdit(venue: Venue) {
    setEditId(venue.id);
    setEditName(venue.name);
    setEditCapacity(venue.capacity ? String(venue.capacity) : "");
    setEditDraft(draftFromAvailability(parseAvailability(venue.availability)));
    setSaveError(null);
  }

  function cancelEdit() {
    setEditId(null);
    setSaveError(null);
  }

  function toggleDay(key: DayKey) {
    setEditDraft((prev) => ({
      ...prev,
      [key]: { ...prev[key], open: !prev[key].open },
    }));
  }

  function setDayTime(key: DayKey, field: "start" | "end", value: string) {
    setEditDraft((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  function copyMondayToWeekdays() {
    setEditDraft((prev) => {
      const mon = prev.Mo;
      const next = { ...prev };
      for (const key of ["Tu", "We", "Th", "Fr"] as DayKey[]) {
        next[key] = { open: mon.open, start: mon.start, end: mon.end };
      }
      return next;
    });
  }

  async function handleSave(venueId: string) {
    if (!editName.trim()) return;
    const availability = draftToAvailability(editDraft);
    const validationErrors = validateAvailability(availability);
    if (validationErrors.length > 0) {
      setSaveError(validationErrors.join(" · "));
      return;
    }
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("venues")
      .update({
        name: editName.trim(),
        capacity: editCapacity ? parseInt(editCapacity, 10) : null,
        availability: availability as never,
        availability_configured: hasAnyDayConfigured(availability),
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
    onChanged?.();
  }

  const unconfiguredCount = venues.filter((v) => !v.availability_configured).length;

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
          <input
            type="number"
            placeholder="Number of fields (optional)"
            value={addCapacity}
            onChange={(e) => setAddCapacity(e.target.value)}
            min="0"
            className="h-10 w-48 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
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
            onClick={() => { setShowAdd(false); setAddName(""); setAddCapacity(""); setAddError(null); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 transition-colors hover:text-gray-700"
          >
            Cancel
          </button>
          {addError && (
            <p className="w-full text-xs text-red-500">{addError}</p>
          )}
          <p className="w-full text-xs text-gray-400">
            You&rsquo;ll set the venue&rsquo;s open hours next. Number of
            fields is informational for now — conflict detection currently
            treats each venue as one field.
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
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {venues.map((venue) =>
            editId === venue.id ? (
              <EditCard
                key={venue.id}
                name={editName}
                capacity={editCapacity}
                draft={editDraft}
                saving={saving}
                error={saveError}
                onNameChange={setEditName}
                onCapacityChange={setEditCapacity}
                onToggleDay={toggleDay}
                onSetDayTime={setDayTime}
                onCopyMonToWeekdays={copyMondayToWeekdays}
                onSave={() => handleSave(venue.id)}
                onCancel={cancelEdit}
              />
            ) : (
              <DisplayCard
                key={venue.id}
                venue={venue}
                onEdit={() => startEdit(venue)}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

// ── Display card ───────────────────────────────────────────────────────────

function DisplayCard({ venue, onEdit }: { venue: Venue; onEdit: () => void }) {
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
        {venue.capacity != null && (
          <p className="text-xs text-gray-400">
            {venue.capacity} field{venue.capacity === 1 ? "" : "s"}
          </p>
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
      <button
        onClick={onEdit}
        className="ml-2 flex-shrink-0 rounded-lg p-1.5 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600"
        aria-label="Edit venue"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Edit card ──────────────────────────────────────────────────────────────

function EditCard({
  name,
  capacity,
  draft,
  saving,
  error,
  onNameChange,
  onCapacityChange,
  onToggleDay,
  onSetDayTime,
  onCopyMonToWeekdays,
  onSave,
  onCancel,
}: {
  name: string;
  capacity: string;
  draft: AvailabilityDraft;
  saving: boolean;
  error: string | null;
  onNameChange: (s: string) => void;
  onCapacityChange: (s: string) => void;
  onToggleDay: (k: DayKey) => void;
  onSetDayTime: (k: DayKey, field: "start" | "end", value: string) => void;
  onCopyMonToWeekdays: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[#22C55E]/40 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
          placeholder="Venue name"
          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
        <input
          type="number"
          placeholder="Number of fields (optional)"
          value={capacity}
          onChange={(e) => onCapacityChange(e.target.value)}
          min="0"
          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
        <p className="text-xs text-gray-400">
          Informational for now — conflict detection currently treats each
          venue as one field.
        </p>
      </div>

      {/* Availability section */}
      <div className="flex flex-col gap-2 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#0C1F3F]">
              Availability
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Set the hours this venue is open each week. Days you leave unchecked are closed.
            </p>
          </div>
          <button
            type="button"
            onClick={onCopyMonToWeekdays}
            className="text-xs text-[#22C55E] underline-offset-2 hover:underline"
          >
            Copy Mon to weekdays
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {DAY_KEYS.map((k) => {
            const d = draft[k];
            return (
              <div key={k} className="flex items-center gap-2">
                <label className="flex w-20 cursor-pointer items-center gap-2 text-xs font-medium text-[#0C1F3F]">
                  <input
                    type="checkbox"
                    checked={d.open}
                    onChange={() => onToggleDay(k)}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]/30"
                  />
                  {DAY_LABELS[k]}
                </label>
                <input
                  type="time"
                  value={d.start}
                  disabled={!d.open}
                  onChange={(e) => onSetDayTime(k, "start", e.target.value)}
                  className="h-8 rounded border border-gray-200 px-2 text-xs text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
                />
                <span className="text-xs text-gray-400">–</span>
                <input
                  type="time"
                  value={d.end}
                  disabled={!d.open}
                  onChange={(e) => onSetDayTime(k, "end", e.target.value)}
                  className="h-8 rounded border border-gray-200 px-2 text-xs text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving || !name.trim()}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#22C55E] py-2 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Save
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </div>
  );
}
