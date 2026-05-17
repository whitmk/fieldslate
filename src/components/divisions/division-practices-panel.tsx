"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  PracticeSlotModal,
  type EditableSlot,
} from "./practice-slot-modal";
import { autoAssignPractices } from "@/lib/practices/auto-assign";

const DAY_OPTIONS: { key: string; label: string }[] = [
  { key: "Mo", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "We", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "Fr", label: "Fri" },
  { key: "Sa", label: "Sat" },
];

type Venue = { id: string; name: string };
type TimeSlot = {
  id: string;
  division_id: string;
  label: string;
  start_time: string;
  duration_minutes: number;
  sort_order: number;
};
type TeamRow = {
  id: string;
  name: string;
  practices_per_week: number;
  preferred_days: string[] | null;
  preferred_time_id: string | null;
  preferred_field_id: string | null;
};
type PracticeSlotRow = {
  id: string;
  team_id: string;
  time_slot_id: string | null;
  field_id: string | null;
  practice_days: string[];
  notes: string | null;
};

interface Props {
  divisionId: string;
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function DivisionPracticesPanel({ divisionId }: Props) {
  const [loading, setLoading] = useState(true);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [practiceVenues, setPracticeVenues] = useState<Venue[]>([]);
  const [practiceSlots, setPracticeSlots] = useState<PracticeSlotRow[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: slotRows }, { data: teamRows }, { data: dvRows }] =
      await Promise.all([
        supabase
          .from("practice_time_slots")
          .select("id, division_id, label, start_time, duration_minutes, sort_order")
          .eq("division_id", divisionId)
          .order("sort_order", { ascending: true })
          .order("start_time", { ascending: true }),
        supabase
          .from("teams")
          .select(
            "id, name, practices_per_week, preferred_days, preferred_time_id, preferred_field_id",
          )
          .eq("division_id", divisionId)
          .order("name", { ascending: true }),
        supabase
          .from("division_venues")
          .select("venue_id, allow_practices, venue:venues(id, name)")
          .eq("division_id", divisionId)
          .eq("allow_practices", true),
      ]);

    setTimeSlots((slotRows as TimeSlot[]) ?? []);
    const teamsLoaded = (teamRows as TeamRow[]) ?? [];
    setTeams(teamsLoaded);
    const venues = ((dvRows ?? []) as Array<{ venue: Venue | null }>)
      .map((r) => r.venue)
      .filter((v): v is Venue => !!v)
      .sort((a, b) => a.name.localeCompare(b.name));
    setPracticeVenues(venues);

    // Practice slots: filter to this division's teams (RLS allows any of our
    // teams, but we only want this division's grid).
    const teamIds = teamsLoaded.map((t) => t.id);
    if (teamIds.length === 0) {
      setPracticeSlots([]);
      return;
    }
    const { data: slotsForTeams } = await supabase
      .from("practice_slots")
      .select("id, team_id, time_slot_id, field_id, practice_days, notes, type")
      .in("team_id", teamIds)
      .eq("type", "recurring");
    setPracticeSlots((slotsForTeams as PracticeSlotRow[]) ?? []);
  }, [divisionId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <TeamPreferencesCard
        divisionId={divisionId}
        teams={teams}
        timeSlots={timeSlots}
        venues={practiceVenues}
        onChange={load}
      />
      <TimeSlotsCard
        divisionId={divisionId}
        timeSlots={timeSlots}
        onChange={load}
      />
      <WeeklySlotGrid
        divisionId={divisionId}
        timeSlots={timeSlots}
        teams={teams}
        venues={practiceVenues}
        practiceSlots={practiceSlots}
        onChange={load}
      />
      <Placeholder title="Custom practices (Phase 3)" />
    </div>
  );
}

// ── Team preferences ──────────────────────────────────────────────────────────

interface TeamPreferencesCardProps {
  divisionId: string;
  teams: TeamRow[];
  timeSlots: TimeSlot[];
  venues: Venue[];
  onChange: () => Promise<void>;
}

function TeamPreferencesCard({
  teams,
  timeSlots,
  venues,
  onChange,
}: TeamPreferencesCardProps) {
  if (teams.length === 0) {
    return (
      <Card title="Team preferences" icon={<Users className="h-4 w-4 text-[#22C55E]" />}>
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          Add teams to this division to set practice preferences.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Team preferences"
      icon={<Users className="h-4 w-4 text-[#22C55E]" />}
      subtitle="Coach-editable. Leave any field blank for 'any'."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-[11px] font-medium uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5">Team</th>
              <th className="px-4 py-2.5">Per week</th>
              <th className="px-4 py-2.5">Preferred days</th>
              <th className="px-4 py-2.5">Preferred time</th>
              <th className="px-4 py-2.5">Preferred field</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {teams.map((t) => (
              <TeamPreferenceRow
                key={t.id}
                team={t}
                timeSlots={timeSlots}
                venues={venues}
                onSaved={onChange}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface TeamPreferenceRowProps {
  team: TeamRow;
  timeSlots: TimeSlot[];
  venues: Venue[];
  onSaved: () => Promise<void>;
}

function TeamPreferenceRow({
  team,
  timeSlots,
  venues,
  onSaved,
}: TeamPreferenceRowProps) {
  const [perWeek, setPerWeek] = useState<number>(team.practices_per_week);
  const [days, setDays] = useState<Set<string>>(
    new Set(team.preferred_days ?? []),
  );
  const [timeId, setTimeId] = useState<string>(team.preferred_time_id ?? "");
  const [fieldId, setFieldId] = useState<string>(team.preferred_field_id ?? "");
  const [saving, setSaving] = useState(false);

  async function patch(updates: Record<string, unknown>) {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("teams")
      .update(updates as never)
      .eq("id", team.id);
    setSaving(false);
    onSaved();
  }

  function toggleDay(d: string) {
    const next = new Set(days);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setDays(next);
    const arr = Array.from(next).sort(
      (a, b) =>
        DAY_OPTIONS.findIndex((x) => x.key === a) -
        DAY_OPTIONS.findIndex((x) => x.key === b),
    );
    patch({ preferred_days: arr.length === 0 ? null : arr });
  }

  return (
    <tr className="hover:bg-gray-50/40">
      <td className="px-4 py-2.5">
        <p className="font-medium text-[#0C1F3F]">{team.name}</p>
      </td>
      <td className="px-4 py-2.5">
        <input
          type="number"
          min={0}
          max={4}
          value={perWeek}
          onChange={(e) => setPerWeek(Number(e.target.value))}
          onBlur={() => {
            const v = Math.max(0, Math.min(4, Number(perWeek) || 0));
            if (v !== team.practices_per_week) patch({ practices_per_week: v });
          }}
          className="h-8 w-14 rounded-lg border border-gray-200 px-2 text-center text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => toggleDay(d.key)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                days.has(d.key)
                  ? "bg-[#22C55E] text-white"
                  : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-[#0C1F3F]"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <select
          value={timeId}
          onChange={(e) => {
            setTimeId(e.target.value);
            patch({ preferred_time_id: e.target.value || null });
          }}
          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        >
          <option value="">Any</option>
          {timeSlots.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({fmtTime(t.start_time)})
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <select
          value={fieldId}
          onChange={(e) => {
            setFieldId(e.target.value);
            patch({ preferred_field_id: e.target.value || null });
          }}
          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        >
          <option value="">Any</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {saving && <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-gray-300" />}
      </td>
    </tr>
  );
}

// ── Time-slot presets ─────────────────────────────────────────────────────────

interface TimeSlotsCardProps {
  divisionId: string;
  timeSlots: TimeSlot[];
  onChange: () => Promise<void>;
}

function TimeSlotsCard({ divisionId, timeSlots, onChange }: TimeSlotsCardProps) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStart, setNewStart] = useState("17:00");
  const [newDuration, setNewDuration] = useState<number>(90);

  const nextSortOrder = useMemo(
    () => (timeSlots.length === 0 ? 0 : timeSlots[timeSlots.length - 1].sort_order + 1),
    [timeSlots],
  );

  async function addSlot() {
    if (!newStart) return;
    const labelToUse = newLabel.trim() || fmtTime(newStart);
    const supabase = createClient();
    await supabase
      .from("practice_time_slots")
      .insert([
        {
          division_id: divisionId,
          label: labelToUse,
          start_time: newStart,
          duration_minutes: Math.max(15, Math.floor(newDuration || 90)),
          sort_order: nextSortOrder,
        },
      ] as never);
    setNewLabel("");
    setNewStart("17:00");
    setNewDuration(90);
    setAdding(false);
    await onChange();
  }

  async function deleteSlot(id: string) {
    const supabase = createClient();
    await supabase.from("practice_time_slots").delete().eq("id", id);
    await onChange();
  }

  return (
    <Card
      title="Practice time slots"
      icon={<Clock className="h-4 w-4 text-[#22C55E]" />}
      subtitle="Time presets your auto-assigned practices will fit into. Add the slots your fields are typically free."
      action={
        !adding ? (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
          >
            <Plus className="h-3.5 w-3.5" />
            Add slot
          </button>
        ) : null
      }
    >
      {timeSlots.length === 0 && !adding ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          No time slots yet. Add one to start setting practice preferences.
        </p>
      ) : (
        <div className="divide-y divide-gray-50">
          {timeSlots.map((slot) => (
            <TimeSlotRow key={slot.id} slot={slot} onDelete={() => deleteSlot(slot.id)} onChange={onChange} />
          ))}
          {adding && (
            <div className="flex flex-wrap items-end gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Label
                </label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={fmtTime(newStart)}
                  autoFocus
                  className="h-9 w-32 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Start
                </label>
                <input
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="h-9 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Duration (min)
                </label>
                <input
                  type="number"
                  min={15}
                  max={300}
                  step={15}
                  value={newDuration}
                  onChange={(e) => setNewDuration(Number(e.target.value))}
                  className="h-9 w-20 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setAdding(false);
                    setNewLabel("");
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={addSlot}
                  className="rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a]"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function TimeSlotRow({
  slot,
  onDelete,
  onChange,
}: {
  slot: TimeSlot;
  onDelete: () => void;
  onChange: () => Promise<void>;
}) {
  const [label, setLabel] = useState(slot.label);
  const [startTime, setStartTime] = useState(slot.start_time);
  const [duration, setDuration] = useState(slot.duration_minutes);

  async function save(updates: Record<string, unknown>) {
    const supabase = createClient();
    await supabase
      .from("practice_time_slots")
      .update(updates as never)
      .eq("id", slot.id);
    await onChange();
  }

  return (
    <div className="flex flex-wrap items-end gap-3 px-4 py-3">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          Label
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== slot.label && save({ label })}
          className="h-9 w-32 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          Start
        </label>
        <input
          type="time"
          value={startTime.substring(0, 5)}
          onChange={(e) => setStartTime(e.target.value)}
          onBlur={() =>
            startTime.substring(0, 5) !== slot.start_time.substring(0, 5) &&
            save({ start_time: startTime })
          }
          className="h-9 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          Duration (min)
        </label>
        <input
          type="number"
          min={15}
          max={300}
          step={15}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          onBlur={() =>
            duration !== slot.duration_minutes && save({ duration_minutes: duration })
          }
          className="h-9 w-20 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
      </div>
      <button
        onClick={onDelete}
        aria-label="Delete time slot"
        className="ml-auto inline-flex h-9 items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Weekly slot grid ──────────────────────────────────────────────────────────

interface WeeklySlotGridProps {
  divisionId: string;
  timeSlots: TimeSlot[];
  teams: TeamRow[];
  venues: Venue[];
  practiceSlots: PracticeSlotRow[];
  onChange: () => Promise<void>;
}

function WeeklySlotGrid({
  divisionId: _divisionId,
  timeSlots,
  teams,
  venues,
  practiceSlots,
  onChange,
}: WeeklySlotGridProps) {
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [modalSlot, setModalSlot] = useState<EditableSlot | null>(null);

  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );
  const venueById = useMemo(
    () => new Map(venues.map((v) => [v.id, v])),
    [venues],
  );

  // Index slots by `${day}|${time_slot_id}` so each cell can pull its occupants.
  type CellSlot = PracticeSlotRow & { collides: boolean };
  const cells = useMemo(() => {
    const map = new Map<string, CellSlot[]>();
    for (const s of practiceSlots) {
      if (!s.time_slot_id) continue;
      for (const day of s.practice_days) {
        const key = `${day}|${s.time_slot_id}`;
        const arr = map.get(key) ?? [];
        arr.push({ ...s, collides: false });
        map.set(key, arr);
      }
    }
    // Mark collisions: 2+ slots in the same cell that share field_id.
    for (const arr of map.values()) {
      const byField = new Map<string, CellSlot[]>();
      for (const s of arr) {
        const fid = s.field_id ?? "_none";
        const g = byField.get(fid) ?? [];
        g.push(s);
        byField.set(fid, g);
      }
      for (const g of byField.values()) {
        if (g.length >= 2) g.forEach((s) => (s.collides = true));
      }
    }
    return map;
  }, [practiceSlots]);

  async function handleAutoAssign() {
    setRunning(true);
    setFeedback(null);
    const res = await autoAssignPractices(_divisionId);
    setRunning(false);
    if (!res.success) {
      setFeedback({ kind: "error", message: res.error });
      return;
    }
    if (res.placed === 0 && res.unassigned.length === 0) {
      setFeedback({
        kind: "success",
        message:
          "No teams needed assignment — every team is already on the grid or doesn't practice.",
      });
    } else {
      const unassignedLabel =
        res.unassigned.length > 0
          ? `, ${res.unassigned.length} couldn't be placed: ${res.unassigned.map((u) => u.team_name).join(", ")}`
          : "";
      setFeedback({
        kind: res.unassigned.length > 0 ? "error" : "success",
        message: `Placed ${res.placed} team${res.placed === 1 ? "" : "s"}${unassignedLabel}.`,
      });
    }
    await onChange();
  }

  function openNewSlot(timeSlotId: string, day: string) {
    setModalSlot({
      time_slot_id: timeSlotId,
      practice_days: [day],
    });
  }

  function openEditSlot(slot: PracticeSlotRow) {
    setModalSlot({
      id: slot.id,
      team_id: slot.team_id,
      time_slot_id: slot.time_slot_id ?? undefined,
      field_id: slot.field_id ?? undefined,
      practice_days: slot.practice_days,
      notes: slot.notes,
    });
  }

  const disabledReason =
    timeSlots.length === 0
      ? "Add at least one practice time slot first."
      : venues.length === 0
        ? "Assign a practice-eligible venue to this division first."
        : teams.length === 0
          ? "Add teams to this division first."
          : null;

  return (
    <Card
      title="Weekly slot grid"
      icon={<CalendarRange className="h-4 w-4 text-[#22C55E]" />}
      subtitle="Click any cell to add or edit a practice. Colored cells mean two recurring slots are sharing the same field at the same time."
      action={
        <button
          onClick={handleAutoAssign}
          disabled={running || !!disabledReason}
          title={disabledReason ?? "Auto-fill empty cells honoring team preferences"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          {running ? "Assigning…" : "Auto-assign practices"}
        </button>
      }
    >
      {disabledReason && (
        <p className="px-4 pt-3 text-xs text-gray-500">{disabledReason}</p>
      )}
      {feedback && (
        <div
          className={`mx-4 mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            feedback.kind === "success"
              ? "border-[#22C55E]/30 bg-[#22C55E]/5 text-[#16a34a]"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {feedback.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {timeSlots.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          The grid will appear here once you add a practice time slot above.
        </p>
      ) : (
        <div className="overflow-x-auto px-4 py-3">
          <table className="w-full min-w-[680px] text-xs">
            <thead>
              <tr className="text-left text-[10px] font-medium uppercase tracking-wide text-gray-400">
                <th className="w-28 py-2 pr-2 font-medium">Time</th>
                {DAY_OPTIONS.map((d) => (
                  <th key={d.key} className="w-1/6 py-2 pr-2 font-medium">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map((slot) => (
                <tr key={slot.id} className="border-t border-gray-100 align-top">
                  <td className="py-2 pr-2">
                    <div className="font-semibold text-[#0C1F3F]">{slot.label}</div>
                    <div className="text-[10px] text-gray-400">
                      {fmtTime(slot.start_time)} · {slot.duration_minutes}m
                    </div>
                  </td>
                  {DAY_OPTIONS.map((d) => {
                    const occupants = cells.get(`${d.key}|${slot.id}`) ?? [];
                    return (
                      <td key={d.key} className="py-2 pr-2 align-top">
                        <GridCell
                          occupants={occupants}
                          teamById={teamById}
                          venueById={venueById}
                          onEmptyClick={() => openNewSlot(slot.id, d.key)}
                          onOccupantClick={openEditSlot}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalSlot && (
        <PracticeSlotModal
          initial={modalSlot}
          teams={teams.map((t) => ({ id: t.id, name: t.name }))}
          timeSlots={timeSlots.map((s) => ({
            id: s.id,
            label: s.label,
            start_time: s.start_time,
          }))}
          venues={venues}
          onSaved={onChange}
          onClose={() => setModalSlot(null)}
        />
      )}
    </Card>
  );
}

function GridCell({
  occupants,
  teamById,
  venueById,
  onEmptyClick,
  onOccupantClick,
}: {
  occupants: (PracticeSlotRow & { collides: boolean })[];
  teamById: Map<string, TeamRow>;
  venueById: Map<string, Venue>;
  onEmptyClick: () => void;
  onOccupantClick: (slot: PracticeSlotRow) => void;
}) {
  if (occupants.length === 0) {
    return (
      <button
        type="button"
        onClick={onEmptyClick}
        className="flex h-14 w-full items-center justify-center rounded-md border border-dashed border-gray-200 text-[10px] text-gray-300 transition-colors hover:border-[#22C55E]/40 hover:bg-[#22C55E]/5 hover:text-[#22C55E]"
      >
        +
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {occupants.map((slot) => {
        const team = teamById.get(slot.team_id);
        const venue = slot.field_id ? venueById.get(slot.field_id) : null;
        return (
          <button
            key={slot.id}
            type="button"
            onClick={() => onOccupantClick(slot)}
            className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors hover:ring-2 hover:ring-[#22C55E]/30 ${
              slot.collides
                ? "border-amber-300 bg-amber-50"
                : "border-[#22C55E]/30 bg-[#22C55E]/5"
            }`}
            title={slot.collides ? "Field collision on this day/time" : undefined}
          >
            <span className="font-semibold text-[#0C1F3F]">
              {team?.name ?? "Unknown team"}
            </span>
            <span className="text-[10px] text-gray-500">
              {venue?.name ?? "TBD field"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Shared shell ──────────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-start gap-2">
          {icon}
          <div>
            <h3 className="text-sm font-semibold text-[#0C1F3F]">{title}</h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/30 p-6 text-center text-xs text-gray-400">
      <MapPin className="mx-auto mb-2 h-4 w-4 text-gray-300" />
      {title}
    </div>
  );
}
