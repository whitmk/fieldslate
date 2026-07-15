"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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

interface VenueEditFormProps {
  venue: Venue;
  /** Runs after a successful save, before the saving flag clears. Hosts
   *  refetch their venue data here, then typically unmount the form. */
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
  /** Mirrors the internal saving flag so a wrapping modal can block
   *  overlay/X dismissal mid-save. */
  onBusyChange?: (busy: boolean) => void;
  /** Extra classes on the root card — the Venues page passes its inline
   *  card chrome; the modal wrapper passes nothing. */
  className?: string;
}

/** Venue editor (name, field count, weekly availability). State is
 *  initialized from `venue` on mount — key by venue.id when the target
 *  venue can change. Deliberately contains no <form> element: it is reused
 *  inside modals on other pages, and an implicit submit bubbling into a
 *  host form is exactly the official-profile-sections trap. */
export function VenueEditForm({
  venue,
  onSaved,
  onCancel,
  onBusyChange,
  className,
}: VenueEditFormProps) {
  const [name, setName] = useState(venue.name);
  const [capacity, setCapacity] = useState(
    venue.capacity ? String(venue.capacity) : "",
  );
  const [draft, setDraft] = useState<AvailabilityDraft>(() =>
    draftFromAvailability(parseAvailability(venue.availability)),
  );
  const [saving, setSavingState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setSaving(value: boolean) {
    setSavingState(value);
    onBusyChange?.(value);
  }

  function toggleDay(key: DayKey) {
    setDraft((prev) => ({
      ...prev,
      [key]: { ...prev[key], open: !prev[key].open },
    }));
  }

  function setDayTime(key: DayKey, field: "start" | "end", value: string) {
    setDraft((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  function copyMondayToWeekdays() {
    setDraft((prev) => {
      const mon = prev.Mo;
      const next = { ...prev };
      for (const key of ["Tu", "We", "Th", "Fr"] as DayKey[]) {
        next[key] = { open: mon.open, start: mon.start, end: mon.end };
      }
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) return;
    const availability = draftToAvailability(draft);
    const validationErrors = validateAvailability(availability);
    if (validationErrors.length > 0) {
      setError(validationErrors.join(" · "));
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: dbErr } = await supabase
      .from("venues")
      .update({
        name: name.trim(),
        capacity: capacity ? parseInt(capacity, 10) : null,
        availability: availability as never,
        availability_configured: hasAnyDayConfigured(availability),
      } as never)
      .eq("id", venue.id);
    if (dbErr) {
      setError(dbErr.message);
      setSaving(false);
      return;
    }
    await onSaved();
    setSaving(false);
  }

  return (
    <div className={`flex flex-col gap-4 ${className ?? ""}`}>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Venue name"
          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
        <input
          type="number"
          placeholder="Number of fields (optional)"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
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
            onClick={copyMondayToWeekdays}
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
                    onChange={() => toggleDay(k)}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-[#22C55E] focus:ring-[#22C55E]/30"
                  />
                  {DAY_LABELS[k]}
                </label>
                <input
                  type="time"
                  value={d.start}
                  disabled={!d.open}
                  onChange={(e) => setDayTime(k, "start", e.target.value)}
                  className="h-8 rounded border border-gray-200 px-2 text-xs text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
                />
                <span className="text-xs text-gray-400">–</span>
                <input
                  type="time"
                  value={d.end}
                  disabled={!d.open}
                  onChange={(e) => setDayTime(k, "end", e.target.value)}
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
          type="button"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#22C55E] py-2 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Save
        </button>
        <button
          type="button"
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

/** Modal wrapper around VenueEditForm for surfaces (the Practice tab) that
 *  don't render venue cards inline. Overlay and X dismissal are blocked
 *  while a save is in flight, matching PracticeSlotModal. */
export function VenueEditModal({
  venue,
  onSaved,
  onClose,
}: {
  venue: Venue;
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-[#0C1F3F]">Edit venue</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4">
          <VenueEditForm
            venue={venue}
            onBusyChange={setBusy}
            onSaved={async () => {
              await onSaved();
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
