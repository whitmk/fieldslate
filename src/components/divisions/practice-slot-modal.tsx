"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const DAY_OPTIONS: { key: string; label: string }[] = [
  { key: "Mo", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "We", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "Fr", label: "Fri" },
  { key: "Sa", label: "Sat" },
  { key: "Su", label: "Sun" },
];

export type SlotTimeSlot = {
  id: string;
  label: string;
  start_time: string;
  division_id: string;
};

export type SlotVenue = { id: string; name: string };

export type SlotTeam = {
  id: string;
  name: string;
  division_id: string;
  division_name?: string;
};

export type EditableSlot = {
  id?: string;
  team_id?: string;
  time_slot_id?: string;
  field_id?: string;
  practice_days?: string[];
  notes?: string | null;
  // For new slots opened from a (field, day, wall_time) cell. When the user
  // picks a team, the modal prefers the time slot in that team's division
  // whose start_time matches this hint.
  preferred_start_time?: string;
};

interface Props {
  initial: EditableSlot;
  teams: SlotTeam[];
  timeSlots: SlotTimeSlot[];
  venues: SlotVenue[];
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}

export function PracticeSlotModal({
  initial,
  teams,
  timeSlots,
  venues,
  onSaved,
  onClose,
}: Props) {
  const [teamId, setTeamId] = useState<string>(initial.team_id ?? "");
  const [timeSlotId, setTimeSlotId] = useState<string>(initial.time_slot_id ?? "");
  const [fieldId, setFieldId] = useState<string>(initial.field_id ?? "");
  const [days, setDays] = useState<Set<string>>(
    new Set(initial.practice_days ?? []),
  );
  const [notes, setNotes] = useState<string>(initial.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamDivisionId = useMemo(
    () => teams.find((t) => t.id === teamId)?.division_id ?? null,
    [teamId, teams],
  );

  const availableTimeSlots = useMemo(() => {
    if (!teamDivisionId) return [] as SlotTimeSlot[];
    return timeSlots
      .filter((t) => t.division_id === teamDivisionId)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [teamDivisionId, timeSlots]);

  // When team changes, reconcile the selected time slot. If a preferred wall
  // time is set, prefer that match in the new division; otherwise drop the
  // selection if it no longer belongs to the team's division.
  useEffect(() => {
    if (!teamDivisionId) return;
    if (timeSlotId && availableTimeSlots.some((t) => t.id === timeSlotId)) {
      return;
    }
    const preferred = initial.preferred_start_time
      ? initial.preferred_start_time.substring(0, 5)
      : null;
    const match = preferred
      ? availableTimeSlots.find(
          (t) => t.start_time.substring(0, 5) === preferred,
        )
      : null;
    setTimeSlotId(match ? match.id : "");
  }, [teamDivisionId, availableTimeSlots, timeSlotId, initial.preferred_start_time]);

  useEffect(() => {
    if (teamId && !teams.some((t) => t.id === teamId)) {
      setError("This slot's team is no longer available.");
    }
  }, [teamId, teams]);

  const isEdit = !!initial.id;
  const canSave =
    !!teamId &&
    !!timeSlotId &&
    !!fieldId &&
    days.size > 0 &&
    !busy;

  function toggleDay(d: string) {
    const next = new Set(days);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setDays(next);
  }

  function sortedDays(): string[] {
    return DAY_OPTIONS.map((d) => d.key).filter((k) => days.has(k));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      team_id: teamId,
      time_slot_id: timeSlotId,
      field_id: fieldId,
      practice_days: sortedDays(),
      type: "recurring",
      notes: notes.trim() || null,
    };
    const op = isEdit
      ? supabase.from("practice_slots").update(payload as never).eq("id", initial.id!)
      : supabase.from("practice_slots").insert([payload] as never[]);
    const { error: dbErr } = await op;
    if (dbErr) {
      setError(dbErr.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    await onSaved();
    onClose();
  }

  async function remove() {
    if (!initial.id) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: dbErr } = await supabase
      .from("practice_slots")
      .delete()
      .eq("id", initial.id);
    if (dbErr) {
      setError(dbErr.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    await onSaved();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-[#0C1F3F]">
            {isEdit ? "Edit practice slot" : "Add practice slot"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save();
          }}
          className="flex flex-col gap-4 px-6 py-5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Team <span className="text-red-500">*</span>
            </label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              required
              disabled={isEdit}
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:bg-gray-50 disabled:text-gray-500"
            >
              <option value="">Select a team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.division_name ? `${t.name} · ${t.division_name}` : t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Time slot <span className="text-red-500">*</span>
              </label>
              <select
                value={timeSlotId}
                onChange={(e) => setTimeSlotId(e.target.value)}
                required
                disabled={!teamId}
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="">
                  {teamId
                    ? availableTimeSlots.length === 0
                      ? "No time slots in this division"
                      : "Pick one…"
                    : "Pick a team first"}
                </option>
                {availableTimeSlots.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Field <span className="text-red-500">*</span>
              </label>
              <select
                value={fieldId}
                onChange={(e) => setFieldId(e.target.value)}
                required
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              >
                <option value="">Pick one…</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Days <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_OPTIONS.map((d) => (
                <button
                  type="button"
                  key={d.key}
                  onClick={() => toggleDay(d.key)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    days.has(d.key)
                      ? "bg-[#22C55E] text-white"
                      : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-[#0C1F3F]"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything coaches should know about this slot…"
              className="resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            <div>
              {isEdit && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Saving…" : isEdit ? "Save" : "Add slot"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
