"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Clock,
  Filter,
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
  type SlotTeam,
  type SlotTimeSlot,
  type SlotVenue,
} from "@/components/divisions/practice-slot-modal";
import { autoAssignPractices } from "@/lib/practices/auto-assign";

const DAY_OPTIONS: { key: string; label: string }[] = [
  { key: "Mo", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "We", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "Fr", label: "Fri" },
  { key: "Sa", label: "Sat" },
  { key: "Su", label: "Sun" },
];

type Division = { id: string; name: string; league_id: string };
type Venue = { id: string; name: string };
type TimeSlot = {
  id: string;
  division_id: string;
  label: string;
  start_time: string;
  duration_minutes: number;
  sort_order: number;
};
type Team = {
  id: string;
  name: string;
  division_id: string;
  practices_per_week: number;
  preferred_days: string[] | null;
  preferred_time_id: string | null;
  preferred_field_id: string | null;
};
type DivisionVenue = { division_id: string; venue_id: string };
type PracticeSlotRow = {
  id: string;
  team_id: string;
  time_slot_id: string | null;
  field_id: string | null;
  practice_days: string[];
  notes: string | null;
};

type Feedback =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type ModalState = {
  initial: EditableSlot;
  teams: SlotTeam[];
  timeSlots: SlotTimeSlot[];
  venues: SlotVenue[];
};

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function normalizeTime(t: string): string {
  return t.length >= 5 ? t.substring(0, 5) : t;
}

export function PracticesPageClient() {
  const [loading, setLoading] = useState(true);

  // Raw data
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [allTimeSlots, setAllTimeSlots] = useState<TimeSlot[]>([]);
  const [allVenues, setAllVenues] = useState<Venue[]>([]);
  const [divisionVenues, setDivisionVenues] = useState<DivisionVenue[]>([]);
  const [practiceSlots, setPracticeSlots] = useState<PracticeSlotRow[]>([]);

  // UI state
  const [filterDivisions, setFilterDivisions] = useState<Set<string>>(new Set());
  const [filterFields, setFilterFields] = useState<Set<string>>(new Set());
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [openPrefDivisions, setOpenPrefDivisions] = useState<Set<string>>(new Set());
  const [openTimeSlotDivisions, setOpenTimeSlotDivisions] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const supabase = createClient();
    const [divQ, dvQ, tsQ, teamQ] = await Promise.all([
      supabase.from("divisions").select("id, name, league_id").order("name"),
      supabase
        .from("division_venues")
        .select("division_id, venue_id, allow_practices, venue:venues(id, name)")
        .eq("allow_practices", true),
      supabase
        .from("practice_time_slots")
        .select("id, division_id, label, start_time, duration_minutes, sort_order")
        .order("sort_order")
        .order("start_time"),
      supabase
        .from("teams")
        .select(
          "id, name, division_id, practices_per_week, preferred_days, preferred_time_id, preferred_field_id",
        )
        .order("name"),
    ]);

    const divList = (divQ.data as Division[] | null) ?? [];
    setDivisions(divList);

    const teamsLoaded = ((teamQ.data as Team[] | null) ?? []).filter(
      (t): t is Team => !!t.division_id,
    );
    setAllTeams(teamsLoaded);

    setAllTimeSlots((tsQ.data as TimeSlot[] | null) ?? []);

    type DvJoinRow = {
      division_id: string;
      venue_id: string;
      venue: Venue | null;
    };
    const dvRows = ((dvQ.data ?? []) as DvJoinRow[]).filter((r) => !!r.venue);
    setDivisionVenues(
      dvRows.map((r) => ({ division_id: r.division_id, venue_id: r.venue_id })),
    );
    const venueMap = new Map<string, Venue>();
    for (const r of dvRows) {
      if (r.venue && !venueMap.has(r.venue.id)) venueMap.set(r.venue.id, r.venue);
    }
    setAllVenues(
      [...venueMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    );

    // Load all recurring practice_slots for teams in our divisions.
    const ourTeamIds = teamsLoaded.map((t) => t.id);
    if (ourTeamIds.length === 0) {
      setPracticeSlots([]);
      return;
    }
    const { data: psRows } = await supabase
      .from("practice_slots")
      .select("id, team_id, time_slot_id, field_id, practice_days, notes, type")
      .in("team_id", ourTeamIds)
      .eq("type", "recurring");
    setPracticeSlots((psRows as PracticeSlotRow[] | null) ?? []);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // ── Derived lookups ────────────────────────────────────────────────────
  const divisionById = useMemo(
    () => new Map(divisions.map((d) => [d.id, d])),
    [divisions],
  );
  const teamById = useMemo(
    () => new Map(allTeams.map((t) => [t.id, t])),
    [allTeams],
  );
  const timeSlotById = useMemo(
    () => new Map(allTimeSlots.map((t) => [t.id, t])),
    [allTimeSlots],
  );

  // venue_id → divisionIds with this venue eligible
  const divisionIdsByVenue = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const dv of divisionVenues) {
      const arr = m.get(dv.venue_id) ?? [];
      arr.push(dv.division_id);
      m.set(dv.venue_id, arr);
    }
    return m;
  }, [divisionVenues]);

  const teamsByDivision = useMemo(() => {
    const m = new Map<string, Team[]>();
    for (const t of allTeams) {
      const arr = m.get(t.division_id) ?? [];
      arr.push(t);
      m.set(t.division_id, arr);
    }
    return m;
  }, [allTeams]);

  const timeSlotsByDivision = useMemo(() => {
    const m = new Map<string, TimeSlot[]>();
    for (const ts of allTimeSlots) {
      const arr = m.get(ts.division_id) ?? [];
      arr.push(ts);
      m.set(ts.division_id, arr);
    }
    return m;
  }, [allTimeSlots]);

  // For each venue × day × wall-time row, list the practice_slots placed there.
  type CellOccupant = PracticeSlotRow & { start_time: string };
  type CellRow = {
    start_time: string;
    label: string;
    occupants: CellOccupant[];
  };
  type VenueRow = { venue: Venue; days: Map<string, CellRow[]> };

  const venueRows = useMemo<VenueRow[]>(() => {
    const filteredVenues = allVenues.filter(
      (v) => filterFields.size === 0 || filterFields.has(v.id),
    );
    return filteredVenues.map((venue) => {
      const eligibleDivIds = divisionIdsByVenue.get(venue.id) ?? [];
      const divIdSet = new Set(
        eligibleDivIds.filter(
          (id) => filterDivisions.size === 0 || filterDivisions.has(id),
        ),
      );
      // Time slots eligible for this venue, after division filter.
      const relevantSlots = allTimeSlots.filter((ts) =>
        divIdSet.has(ts.division_id),
      );

      // Unique wall times for this venue.
      const wallTimeLabels = new Map<string, string>();
      for (const ts of relevantSlots) {
        const wt = normalizeTime(ts.start_time);
        if (!wallTimeLabels.has(wt)) wallTimeLabels.set(wt, ts.label);
      }
      const sortedWallTimes = [...wallTimeLabels.keys()].sort();

      // Occupants at this venue.
      const venueOccupants = practiceSlots.filter(
        (ps) => ps.field_id === venue.id,
      );

      const days = new Map<string, CellRow[]>();
      for (const d of DAY_OPTIONS) {
        const rows: CellRow[] = sortedWallTimes.map((wt) => {
          const occupants: CellOccupant[] = [];
          for (const ps of venueOccupants) {
            if (!ps.practice_days.includes(d.key)) continue;
            const ts = ps.time_slot_id
              ? timeSlotById.get(ps.time_slot_id)
              : null;
            if (!ts) continue;
            if (normalizeTime(ts.start_time) !== wt) continue;
            // Apply division filter to occupants as well — a placement that
            // belongs to a hidden division shouldn't show on the grid.
            const teamDivId = teamById.get(ps.team_id)?.division_id;
            if (
              filterDivisions.size > 0 &&
              teamDivId &&
              !filterDivisions.has(teamDivId)
            ) {
              continue;
            }
            occupants.push({ ...ps, start_time: wt });
          }
          return {
            start_time: wt,
            label: wallTimeLabels.get(wt) ?? fmtTime(wt),
            occupants,
          };
        });
        days.set(d.key, rows);
      }
      return { venue, days };
    });
  }, [
    allVenues,
    allTimeSlots,
    practiceSlots,
    filterFields,
    filterDivisions,
    divisionIdsByVenue,
    timeSlotById,
    teamById,
  ]);

  // ── Auto-assign ─────────────────────────────────────────────────────────
  const selectedDivision = selectedDivisionId
    ? divisionById.get(selectedDivisionId)
    : null;

  const autoAssignDisabledReason = (() => {
    if (!selectedDivisionId) return "Pick a division to auto-assign.";
    const slots = timeSlotsByDivision.get(selectedDivisionId) ?? [];
    if (slots.length === 0) return "This division has no practice time slots yet.";
    const eligible = divisionVenues.filter(
      (dv) => dv.division_id === selectedDivisionId,
    );
    if (eligible.length === 0)
      return "This division has no practice-eligible venues yet.";
    const teams = teamsByDivision.get(selectedDivisionId) ?? [];
    if (teams.length === 0) return "This division has no teams yet.";
    return null;
  })();

  async function handleAutoAssign() {
    if (!selectedDivisionId) return;
    setRunning(true);
    setFeedback(null);
    const res = await autoAssignPractices(selectedDivisionId);
    setRunning(false);
    const divName = selectedDivision?.name ?? "division";
    if (!res.success) {
      setFeedback({ kind: "error", message: res.error });
      return;
    }
    if (res.placed === 0 && res.unassigned.length === 0) {
      setFeedback({
        kind: "success",
        message: `${divName}: every team is already on the grid or doesn't practice.`,
      });
    } else {
      const unassignedLabel =
        res.unassigned.length > 0
          ? `, ${res.unassigned.length} couldn't be placed: ${res.unassigned.map((u) => u.team_name).join(", ")}`
          : "";
      setFeedback({
        kind: res.unassigned.length > 0 ? "error" : "success",
        message: `${divName}: placed ${res.placed} team${res.placed === 1 ? "" : "s"}${unassignedLabel}.`,
      });
    }
    await load();
  }

  // ── Modal openers ───────────────────────────────────────────────────────
  function buildTeamList(divisionIds: string[]): SlotTeam[] {
    const set = new Set(divisionIds);
    return allTeams
      .filter((t) => set.has(t.division_id))
      .map((t) => ({
        id: t.id,
        name: t.name,
        division_id: t.division_id,
        division_name: divisionById.get(t.division_id)?.name,
      }))
      .sort((a, b) => {
        const dn = (a.division_name ?? "").localeCompare(b.division_name ?? "");
        return dn !== 0 ? dn : a.name.localeCompare(b.name);
      });
  }

  function buildTimeSlotList(divisionIds: string[]): SlotTimeSlot[] {
    const set = new Set(divisionIds);
    return allTimeSlots
      .filter((t) => set.has(t.division_id))
      .map((t) => ({
        id: t.id,
        label: t.label,
        start_time: t.start_time,
        division_id: t.division_id,
      }));
  }

  function buildVenueList(divisionIds: string[]): SlotVenue[] {
    const venueIds = new Set<string>();
    for (const dv of divisionVenues) {
      if (divisionIds.includes(dv.division_id)) venueIds.add(dv.venue_id);
    }
    return allVenues
      .filter((v) => venueIds.has(v.id))
      .map((v) => ({ id: v.id, name: v.name }));
  }

  function openCreateSlot(venue: Venue, day: string, startTime: string) {
    const eligibleDivIds = divisionIdsByVenue.get(venue.id) ?? [];
    setModalState({
      initial: {
        field_id: venue.id,
        practice_days: [day],
        preferred_start_time: startTime,
      },
      teams: buildTeamList(eligibleDivIds),
      timeSlots: buildTimeSlotList(eligibleDivIds),
      venues: buildVenueList(eligibleDivIds),
    });
  }

  function openEditSlot(slot: PracticeSlotRow) {
    const team = teamById.get(slot.team_id);
    if (!team) return;
    const divId = team.division_id;
    setModalState({
      initial: {
        id: slot.id,
        team_id: slot.team_id,
        time_slot_id: slot.time_slot_id ?? undefined,
        field_id: slot.field_id ?? undefined,
        practice_days: slot.practice_days,
        notes: slot.notes,
      },
      teams: buildTeamList([divId]),
      timeSlots: buildTimeSlotList([divId]),
      venues: buildVenueList([divId]),
    });
  }

  function togglePrefOpen(divId: string) {
    setOpenPrefDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(divId)) next.delete(divId);
      else next.add(divId);
      return next;
    });
  }
  function toggleTimeSlotOpen(divId: string) {
    setOpenTimeSlotDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(divId)) next.delete(divId);
      else next.add(divId);
      return next;
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  const hasAnyEligibleVenue = allVenues.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Practices</h1>
        <p className="mt-1 text-sm text-gray-500">
          Org-wide practice scheduling. Fields are shared across divisions, so
          assignments here keep every division&apos;s practices from stepping
          on each other.
        </p>
      </div>

      {/* Auto-assign bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Division
          </label>
          <select
            value={selectedDivisionId}
            onChange={(e) => setSelectedDivisionId(e.target.value)}
            className="h-9 min-w-[180px] rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          >
            <option value="">Select a division…</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleAutoAssign}
            disabled={running || !!autoAssignDisabledReason}
            title={
              autoAssignDisabledReason ??
              "Auto-fill empty practice slots honoring team preferences"
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {running ? "Assigning…" : "Auto-assign practices"}
          </button>
        </div>
        {feedback && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs sm:max-w-md ${
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
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
        <Filter className="h-4 w-4 text-gray-400" />
        <MultiSelectPopover
          label="Divisions"
          items={divisions.map((d) => ({ id: d.id, label: d.name }))}
          selected={filterDivisions}
          onChange={setFilterDivisions}
          allLabel="All divisions"
        />
        <MultiSelectPopover
          label="Fields"
          items={allVenues.map((v) => ({ id: v.id, label: v.name }))}
          selected={filterFields}
          onChange={setFilterFields}
          allLabel="All fields"
        />
        {(filterDivisions.size > 0 || filterFields.size > 0) && (
          <button
            onClick={() => {
              setFilterDivisions(new Set());
              setFilterFields(new Set());
            }}
            className="ml-auto text-xs font-medium text-gray-500 underline-offset-2 hover:text-[#0C1F3F] hover:underline"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-start gap-2 border-b border-gray-100 px-4 py-3">
          <CalendarRange className="mt-0.5 h-4 w-4 text-[#22C55E]" />
          <div>
            <h2 className="text-sm font-semibold text-[#0C1F3F]">
              Weekly practice grid
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Rows are fields, columns are days. Click any time-slot row to
              assign or edit a team. Amber rows mean two divisions are claiming
              the same field at the same time.
            </p>
          </div>
        </div>
        {!hasAnyEligibleVenue ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            No practice-eligible venues yet. In a division&apos;s venue setup,
            mark at least one venue as allowed for practices.
          </p>
        ) : venueRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            No fields match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  <th className="w-40 border-b border-gray-100 px-3 py-2 font-medium">
                    Field
                  </th>
                  {DAY_OPTIONS.map((d) => (
                    <th
                      key={d.key}
                      className="border-b border-l border-gray-100 px-2 py-2 font-medium"
                    >
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {venueRows.map(({ venue, days }) => (
                  <tr
                    key={venue.id}
                    className="border-b border-gray-100 align-top"
                  >
                    <td className="border-r border-gray-100 px-3 py-3">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 text-gray-300" />
                        <span className="font-semibold text-[#0C1F3F]">
                          {venue.name}
                        </span>
                      </div>
                    </td>
                    {DAY_OPTIONS.map((d) => {
                      const rows = days.get(d.key) ?? [];
                      return (
                        <td
                          key={d.key}
                          className="border-l border-gray-100 px-1.5 py-2 align-top"
                        >
                          <DayCell
                            rows={rows}
                            teamById={teamById}
                            divisionById={divisionById}
                            onEmptyClick={(startTime) =>
                              openCreateSlot(venue, d.key, startTime)
                            }
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
      </div>

      {/* Time slot presets */}
      <CollapsibleByDivisionCard
        icon={<Clock className="h-4 w-4 text-[#22C55E]" />}
        title="Practice time slots"
        subtitle="Time presets your auto-assigned practices fit into. Add the slots your fields are typically free."
        divisions={divisions}
        openSet={openTimeSlotDivisions}
        onToggle={toggleTimeSlotOpen}
        emptyMessage="Add a division before creating time slots."
        renderBody={(div) => (
          <TimeSlotsCardBody
            divisionId={div.id}
            timeSlots={timeSlotsByDivision.get(div.id) ?? []}
            onChange={load}
          />
        )}
      />

      {/* Team preferences */}
      <CollapsibleByDivisionCard
        icon={<Users className="h-4 w-4 text-[#22C55E]" />}
        title="Team preferences"
        subtitle="Coach-editable. Leave any field blank for &apos;any&apos;."
        divisions={divisions}
        openSet={openPrefDivisions}
        onToggle={togglePrefOpen}
        emptyMessage="Add a division before setting team preferences."
        renderBody={(div) => (
          <TeamPreferencesBody
            teams={teamsByDivision.get(div.id) ?? []}
            timeSlots={timeSlotsByDivision.get(div.id) ?? []}
            venues={allVenues.filter((v) =>
              divisionVenues.some(
                (dv) => dv.division_id === div.id && dv.venue_id === v.id,
              ),
            )}
            onChange={load}
          />
        )}
      />

      {modalState && (
        <PracticeSlotModal
          initial={modalState.initial}
          teams={modalState.teams}
          timeSlots={modalState.timeSlots}
          venues={modalState.venues}
          onSaved={load}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}

// ── Day cell ─────────────────────────────────────────────────────────────

type CellOccupantLite = PracticeSlotRow & { start_time: string };
type CellRowLite = {
  start_time: string;
  label: string;
  occupants: CellOccupantLite[];
};

function DayCell({
  rows,
  teamById,
  divisionById,
  onEmptyClick,
  onOccupantClick,
}: {
  rows: CellRowLite[];
  teamById: Map<string, Team>;
  divisionById: Map<string, Division>;
  onEmptyClick: (startTime: string) => void;
  onOccupantClick: (slot: PracticeSlotRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-4 text-center text-[10px] text-gray-300">—</div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <SlotRow
          key={row.start_time}
          row={row}
          teamById={teamById}
          divisionById={divisionById}
          onEmptyClick={() => onEmptyClick(row.start_time)}
          onOccupantClick={onOccupantClick}
        />
      ))}
    </div>
  );
}

function SlotRow({
  row,
  teamById,
  divisionById,
  onEmptyClick,
  onOccupantClick,
}: {
  row: CellRowLite;
  teamById: Map<string, Team>;
  divisionById: Map<string, Division>;
  onEmptyClick: () => void;
  onOccupantClick: (slot: PracticeSlotRow) => void;
}) {
  if (row.occupants.length === 0) {
    return (
      <button
        type="button"
        onClick={onEmptyClick}
        className="flex w-full items-center justify-between rounded-md border border-dashed border-gray-200 px-2 py-1.5 text-left text-[10px] text-gray-400 transition-colors hover:border-[#22C55E]/40 hover:bg-[#22C55E]/5 hover:text-[#22C55E]"
      >
        <span className="font-medium">{fmtTime(row.start_time)}</span>
        <span className="text-gray-300">Open</span>
      </button>
    );
  }
  const collides = row.occupants.length > 1;
  const tooltip = collides
    ? `Cross-division collision: ${row.occupants
        .map((o) => {
          const team = teamById.get(o.team_id);
          const div = team ? divisionById.get(team.division_id) : null;
          return `${team?.name ?? "Unknown"} (${div?.name ?? "?"})`;
        })
        .join(", ")}`
    : undefined;
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border px-2 py-1.5 ${
        collides
          ? "border-amber-300 bg-amber-50"
          : "border-[#22C55E]/30 bg-[#22C55E]/5"
      }`}
      title={tooltip}
    >
      <div className="flex items-center justify-between text-[10px] font-medium text-gray-500">
        <span>{fmtTime(row.start_time)}</span>
        {collides && (
          <span className="inline-flex items-center gap-0.5 text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            {row.occupants.length}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {row.occupants.map((slot) => {
          const team = teamById.get(slot.team_id);
          const div = team ? divisionById.get(team.division_id) : null;
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => onOccupantClick(slot)}
              className="flex flex-col items-start text-left transition-colors hover:opacity-80"
            >
              <span className="text-[11px] font-semibold text-[#0C1F3F]">
                {team?.name ?? "Unknown team"}
              </span>
              <span className="text-[10px] text-gray-500">
                {div?.name ?? "?"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Collapsible-by-division card ─────────────────────────────────────────

function CollapsibleByDivisionCard({
  icon,
  title,
  subtitle,
  divisions,
  openSet,
  onToggle,
  emptyMessage,
  renderBody,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  divisions: Division[];
  openSet: Set<string>;
  onToggle: (id: string) => void;
  emptyMessage: string;
  renderBody: (div: Division) => React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start gap-2 border-b border-gray-100 px-4 py-3">
        {icon}
        <div>
          <h2 className="text-sm font-semibold text-[#0C1F3F]">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
      </div>
      {divisions.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="divide-y divide-gray-50">
          {divisions.map((div) => {
            const isOpen = openSet.has(div.id);
            return (
              <div key={div.id}>
                <button
                  onClick={() => onToggle(div.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50/60"
                >
                  <span className="text-sm font-semibold text-[#0C1F3F]">
                    {div.name}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-gray-50 bg-gray-50/30 px-3 py-3">
                    {renderBody(div)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Time slots body (per division) ───────────────────────────────────────

function TimeSlotsCardBody({
  divisionId,
  timeSlots,
  onChange,
}: {
  divisionId: string;
  timeSlots: TimeSlot[];
  onChange: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStart, setNewStart] = useState("17:00");
  const [newDuration, setNewDuration] = useState<number>(90);

  const nextSortOrder = useMemo(
    () =>
      timeSlots.length === 0
        ? 0
        : timeSlots[timeSlots.length - 1].sort_order + 1,
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
    <div className="flex flex-col gap-2">
      {timeSlots.length === 0 && !adding ? (
        <p className="px-1 py-4 text-center text-xs text-gray-500">
          No time slots in this division yet.
        </p>
      ) : (
        <div className="rounded-lg border border-gray-100 bg-white">
          <div className="divide-y divide-gray-50">
            {timeSlots.map((slot) => (
              <TimeSlotRow
                key={slot.id}
                slot={slot}
                onDelete={() => deleteSlot(slot.id)}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      )}

      {adding ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-3">
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
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex w-fit items-center gap-1.5 self-end rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
        >
          <Plus className="h-3.5 w-3.5" />
          Add slot
        </button>
      )}
    </div>
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
    <div className="flex flex-wrap items-end gap-3 px-3 py-2.5">
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
            duration !== slot.duration_minutes &&
            save({ duration_minutes: duration })
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

// ── Team preferences body (per division) ─────────────────────────────────

function TeamPreferencesBody({
  teams,
  timeSlots,
  venues,
  onChange,
}: {
  teams: Team[];
  timeSlots: TimeSlot[];
  venues: Venue[];
  onChange: () => Promise<void>;
}) {
  if (teams.length === 0) {
    return (
      <p className="px-1 py-4 text-center text-xs text-gray-500">
        No teams in this division yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white">
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
  );
}

function TeamPreferenceRow({
  team,
  timeSlots,
  venues,
  onSaved,
}: {
  team: Team;
  timeSlots: TimeSlot[];
  venues: Venue[];
  onSaved: () => Promise<void>;
}) {
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
        {saving && (
          <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-gray-300" />
        )}
      </td>
    </tr>
  );
}

// ── Multi-select popover ─────────────────────────────────────────────────

function MultiSelectPopover({
  label,
  items,
  selected,
  onChange,
  allLabel,
}: {
  label: string;
  items: { id: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.size === 0
      ? allLabel
      : selected.size === 1
        ? items.find((i) => selected.has(i.id))?.label ?? `1 selected`
        : `${selected.size} selected`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-[#0C1F3F] transition-colors hover:border-gray-300"
      >
        <span className="text-gray-400">{label}:</span>
        <span>{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
            {items.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">Nothing here.</p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onChange(new Set())}
                  className={`flex w-full items-center justify-between rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    selected.size === 0
                      ? "bg-[#22C55E]/10 text-[#16a34a]"
                      : "text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  {allLabel}
                </button>
                <div className="my-1 border-t border-gray-100" />
                {items.map((item) => {
                  const checked = selected.has(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        const next = new Set(selected);
                        if (checked) next.delete(item.id);
                        else next.add(item.id);
                        onChange(next);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs font-medium text-[#0C1F3F] hover:bg-gray-50"
                    >
                      <span
                        className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                          checked
                            ? "border-[#22C55E] bg-[#22C55E] text-white"
                            : "border-gray-300 bg-white"
                        }`}
                      >
                        {checked && (
                          <CheckCircle2 className="h-2.5 w-2.5" />
                        )}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
