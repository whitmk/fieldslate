"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
    setTeams((teamRows as TeamRow[]) ?? []);
    const venues = ((dvRows ?? []) as Array<{ venue: Venue | null }>)
      .map((r) => r.venue)
      .filter((v): v is Venue => !!v)
      .sort((a, b) => a.name.localeCompare(b.name));
    setPracticeVenues(venues);
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
      <Placeholder title="Weekly slot grid (Phase 2)" />
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
