"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Filter,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FinishSetupLink } from "@/components/setup/finish-setup-link";
import { VenueEditModal } from "@/components/venues/venue-edit-form";
import type { Venue as VenueRecord } from "@/types/database";
import {
  deriveVenueGameDays,
  gameDaysForVenue,
  venuesWithAnyGame,
  type GameDayInput,
  type VenueGameDays,
} from "@/lib/venues/game-days";
import {
  PracticeSlotModal,
  type EditableSlot,
  type SlotTeam,
  type SlotTimeSlot,
  type SlotVenue,
} from "@/components/divisions/practice-slot-modal";
import { PracticeExportModal } from "@/components/practices/practice-export-modal";
import { autoAssignPractices } from "@/lib/practices/auto-assign";
import { qualifiedVenueLabel, byQualifiedVenueLabel } from "@/lib/venues/venue-label";

const DAY_OPTIONS: { key: string; label: string; short: string; full: string }[] = [
  { key: "Mo", label: "Mon", short: "M",  full: "Monday" },
  { key: "Tu", label: "Tue", short: "T",  full: "Tuesday" },
  { key: "We", label: "Wed", short: "W",  full: "Wednesday" },
  { key: "Th", label: "Thu", short: "Th", full: "Thursday" },
  { key: "Fr", label: "Fri", short: "F",  full: "Friday" },
  { key: "Sa", label: "Sat", short: "Sa", full: "Saturday" },
  { key: "Su", label: "Sun", short: "Su", full: "Sunday" },
];
const ALL_DAY_KEYS = DAY_OPTIONS.map((d) => d.key);

type Division = { id: string; name: string; league_id: string };
// Widened with the joined location so every chooser fed from allVenues (the
// Fields filter, the practice-slot modal, the per-team Preferred field select)
// can render the qualified "Complex — Field" label.
type Venue = { id: string; name: string; location: { name: string } | null };
type TimeSlot = {
  id: string;
  division_id: string;
  label: string;
  start_time: string;
  duration_minutes: number;
  sort_order: number;
  days_of_week: string[];
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
  placement_source: "manual" | "auto";
};
type AvailabilityBlock = {
  id: string;
  team_id: string;
  day_of_week: string;
  start_time: string | null;
  end_time: string | null;
};

type Feedback = {
  kind: "success" | "error";
  message: string;
  // Per-team reasons surfaced as a bulleted list under the headline. Empty
  // when no unassignments to report.
  unassigned?: { team_id: string; team_name: string; reason: string }[];
};

type Toast = { kind: "error" | "success"; message: string; id: number };
export type Notify = (kind: "error" | "success", message: string) => void;

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

interface Props {
  /** League ids owned by the currently-selected org. Used to scope the
   *  divisions + teams SELECTs. RLS would otherwise let a multi-org admin
   *  pull rows from every org they belong to. */
  orgLeagueIds: string[];
  /** Division ids in those leagues. Used to scope queries on tables that
   *  are division-scoped and have no league_id (division_venues,
   *  practice_time_slots). */
  orgDivisionIds: string[];
  /** Server-resolved /setup link gate (Chunk 4): own-org owner with setup
   *  incomplete. The client only decides WHEN (its empty state). */
  showSetupLink?: boolean;
}

export function PracticesPageClient({
  orgLeagueIds,
  orgDivisionIds,
  showSetupLink,
}: Props) {
  const [loading, setLoading] = useState(true);

  // Raw data
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [allTimeSlots, setAllTimeSlots] = useState<TimeSlot[]>([]);
  const [allVenues, setAllVenues] = useState<Venue[]>([]);
  const [divisionVenues, setDivisionVenues] = useState<DivisionVenue[]>([]);
  const [practiceSlots, setPracticeSlots] = useState<PracticeSlotRow[]>([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState<
    AvailabilityBlock[]
  >([]);

  // UI state
  const [filterDivisions, setFilterDivisions] = useState<Set<string>>(new Set());
  const [filterFields, setFilterFields] = useState<Set<string>>(new Set());
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // Venue editing straight from the grid. The page only holds {id, name} per
  // venue, so the pencil fetches the full row before opening the modal.
  const [venueEdit, setVenueEdit] = useState<VenueRecord | null>(null);
  const [venueEditLoading, setVenueEditLoading] = useState<string | null>(null);
  // Derived game days for the venue currently open in the edit modal (read-only
  // indicator). Fetched on modal open — one venue at a time, not per card.
  const [venueEditGameDays, setVenueEditGameDays] = useState<VenueGameDays>(new Map());
  const [venueEditHasGames, setVenueEditHasGames] = useState(false);
  const [openPrefDivisions, setOpenPrefDivisions] = useState<Set<string>>(new Set());
  const [openTimeSlotDivisions, setOpenTimeSlotDivisions] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback<Notify>((kind, message) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ kind, message, id: Date.now() });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, kind === "error" ? 8000 : 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const load = useCallback(async () => {
    const supabase = createClient();

    // Empty-org guard: if the user belongs to an org with no leagues yet,
    // skip the round-trip and seed empty state. .in("league_id", []) would
    // be a valid query but the four parallel calls + downstream block are
    // wasted work in that case.
    if (orgLeagueIds.length === 0) {
      setDivisions([]);
      setAllTeams([]);
      setAllTimeSlots([]);
      setDivisionVenues([]);
      setAllVenues([]);
      setPracticeSlots([]);
      setAvailabilityBlocks([]);
      return;
    }

    // Every fetch below narrows to the currently-selected org. RLS alone
    // would let a multi-org admin see divisions/venues/teams/time-slots
    // from every org they belong to. Time slots + division_venues key by
    // division_id (no league_id column); divisions + teams key by league_id.
    const [divQ, dvQ, tsQ, teamQ] = await Promise.all([
      supabase
        .from("divisions")
        .select("id, name, league_id")
        .in("league_id", orgLeagueIds)
        .order("name"),
      orgDivisionIds.length
        ? supabase
            .from("division_venues")
            .select(
              "division_id, venue_id, allow_practices, venue:venues!inner(id, name, availability_configured, location:locations(name))",
            )
            .in("division_id", orgDivisionIds)
            .eq("allow_practices", true)
            .eq("venue.availability_configured", true)
        : Promise.resolve({ data: [] as unknown[], error: null }),
      orgDivisionIds.length
        ? supabase
            .from("practice_time_slots")
            .select(
              "id, division_id, label, start_time, duration_minutes, sort_order, days_of_week",
            )
            .in("division_id", orgDivisionIds)
            .order("sort_order")
            .order("start_time")
        : Promise.resolve({ data: [] as unknown[], error: null }),
      supabase
        .from("teams")
        .select(
          "id, name, division_id, practices_per_week, preferred_days, preferred_time_id, preferred_field_id",
        )
        .in("league_id", orgLeagueIds)
        .order("name"),
    ]);

    const loadErr =
      divQ.error ?? dvQ.error ?? tsQ.error ?? teamQ.error ?? null;
    if (loadErr) {
      notify("error", `Couldn't load practice data: ${loadErr.message}`);
    }

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
    // Sort by the qualified label so a park's fields cluster together. This one
    // sort at the source clusters every downstream chooser (Fields filter, slot
    // modal via buildVenueList, per-team Preferred field) — all preserve this
    // order. Order-only; every selection is id-keyed.
    setAllVenues([...venueMap.values()].sort(byQualifiedVenueLabel));

    // practice_slots + team_availability_blocks key off team_id, where the
    // team_id set was just narrowed to this org's teams above. No extra
    // .in("league_id", ...) needed here; the upstream scope carries through.
    const ourTeamIds = teamsLoaded.map((t) => t.id);
    if (ourTeamIds.length === 0) {
      setPracticeSlots([]);
      setAvailabilityBlocks([]);
      return;
    }
    const [psQ, abQ] = await Promise.all([
      supabase
        .from("practice_slots")
        .select(
          "id, team_id, time_slot_id, field_id, practice_days, notes, type, placement_source",
        )
        .in("team_id", ourTeamIds)
        .eq("type", "recurring"),
      supabase
        .from("team_availability_blocks")
        .select("id, team_id, day_of_week, start_time, end_time")
        .in("team_id", ourTeamIds),
    ]);
    if (psQ.error) {
      notify("error", `Couldn't load practice placements: ${psQ.error.message}`);
    }
    if (abQ.error) {
      notify(
        "error",
        `Couldn't load availability blocks: ${abQ.error.message}`,
      );
    }
    setPracticeSlots((psQ.data as PracticeSlotRow[] | null) ?? []);
    setAvailabilityBlocks(
      (abQ.data as AvailabilityBlock[] | null) ?? [],
    );
  }, [notify, orgLeagueIds, orgDivisionIds]);

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

  const blocksByTeam = useMemo(() => {
    const m = new Map<string, AvailabilityBlock[]>();
    for (const b of availabilityBlocks) {
      const arr = m.get(b.team_id) ?? [];
      arr.push(b);
      m.set(b.team_id, arr);
    }
    return m;
  }, [availabilityBlocks]);

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

      // Pre-compute per-day wall-time presence + labels. A wall-time row only
      // shows up in a given day column when some relevant time slot covers
      // that day at that wall time.
      const wallTimesByDay = new Map<string, Map<string, string>>();
      for (const d of DAY_OPTIONS) {
        wallTimesByDay.set(d.key, new Map());
      }
      for (const ts of relevantSlots) {
        const wt = normalizeTime(ts.start_time);
        for (const day of ts.days_of_week) {
          const m = wallTimesByDay.get(day);
          if (!m) continue;
          if (!m.has(wt)) m.set(wt, ts.label);
        }
      }

      // Occupants at this venue.
      const venueOccupants = practiceSlots.filter(
        (ps) => ps.field_id === venue.id,
      );

      const days = new Map<string, CellRow[]>();
      for (const d of DAY_OPTIONS) {
        const wallTimeLabels = wallTimesByDay.get(d.key) ?? new Map();
        const sortedWallTimes = [...wallTimeLabels.keys()].sort();
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
      const headline =
        res.unassigned.length > 0
          ? `${divName}: placed ${res.placed} team${res.placed === 1 ? "" : "s"}, ${res.unassigned.length} couldn't be placed.`
          : `${divName}: placed ${res.placed} team${res.placed === 1 ? "" : "s"}.`;
      setFeedback({
        kind: res.unassigned.length > 0 ? "error" : "success",
        message: headline,
        unassigned: res.unassigned,
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
      .map((v) => ({ id: v.id, name: v.name, location: v.location }));
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

  async function openVenueEdit(venueId: string) {
    setVenueEditLoading(venueId);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .eq("id", venueId)
      .single();
    if (error || !data) {
      setVenueEditLoading(null);
      notify(
        "error",
        `Couldn't load venue: ${error?.message ?? "venue not found"}`,
      );
      return;
    }
    // Derived game days for this one venue (read-only indicator on the card).
    const { data: games } = await supabase
      .from("games")
      .select("venue_id, scheduled_at, status")
      .eq("venue_id", venueId);
    const rows = (games ?? []) as GameDayInput[];
    setVenueEditGameDays(gameDaysForVenue(deriveVenueGameDays(rows), venueId));
    setVenueEditHasGames(venuesWithAnyGame(rows).has(venueId));
    setVenueEditLoading(null);
    setVenueEdit(data as VenueRecord);
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
        placement_source: slot.placement_source,
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

      {toast && (
        <ToastBanner
          kind={toast.kind}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}

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
          <button
            onClick={() => setExportOpen(true)}
            disabled={practiceSlots.length === 0}
            title={
              practiceSlots.length === 0
                ? "Schedule at least one practice before exporting"
                : "Download a coach-ready schedule"
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0C1F3F] transition-colors hover:border-[#22C55E]/40 hover:text-[#22C55E] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export practices
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
            <div className="flex flex-col gap-1">
              <span>{feedback.message}</span>
              {feedback.unassigned && feedback.unassigned.length > 0 && (
                <ul className="ml-3 list-disc space-y-0.5">
                  {feedback.unassigned.map((u) => (
                    <li key={u.team_id}>
                      <span className="font-semibold">{u.team_name}</span>
                      {" — "}
                      {u.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
          items={allVenues.map((v) => ({ id: v.id, label: qualifiedVenueLabel(v) }))}
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
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-gray-500">
              No practice-eligible venues yet. In a division&apos;s venue setup,
              mark at least one venue as allowed for practices.
            </p>
            {showSetupLink && <FinishSetupLink />}
          </div>
        ) : venueRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            No fields match the current filters.
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
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
                    className="group border-b border-gray-100 align-top"
                  >
                    <td className="border-r border-gray-100 px-3 py-3">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 text-gray-300" />
                        <span className="font-semibold text-[#0C1F3F]">
                          {venue.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => openVenueEdit(venue.id)}
                          disabled={venueEditLoading === venue.id}
                          aria-label={`Edit ${venue.name}`}
                          title="Edit venue details"
                          className={`ml-auto flex-shrink-0 rounded p-1 text-gray-300 transition-all hover:bg-gray-100 hover:text-gray-600 ${
                            venueEditLoading === venue.id
                              ? "opacity-100"
                              : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          }`}
                        >
                          {venueEditLoading === venue.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                        </button>
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
            <MobileDayView
              venueRows={venueRows}
              teamById={teamById}
              divisionById={divisionById}
              onEmptyClick={openCreateSlot}
              onOccupantClick={openEditSlot}
            />
          </>
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
            notify={notify}
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
            blocksByTeam={blocksByTeam}
            onChange={load}
            notify={notify}
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

      {venueEdit && (
        <VenueEditModal
          venue={venueEdit}
          gameDays={venueEditGameDays}
          venueHasGames={venueEditHasGames}
          onSaved={load}
          onClose={() => setVenueEdit(null)}
        />
      )}

      {exportOpen && (
        <PracticeExportModal
          divisions={divisions}
          teams={allTeams}
          practiceSlots={practiceSlots}
          timeSlots={allTimeSlots}
          venues={allVenues}
          onClose={() => setExportOpen(false)}
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
          const isManual = slot.placement_source === "manual";
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => onOccupantClick(slot)}
              className="flex flex-col items-start text-left transition-colors hover:opacity-80"
            >
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#0C1F3F]">
                {isManual && (
                  <Lock
                    className="h-3 w-3 text-gray-500"
                    aria-label="Manually placed"
                  />
                )}
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

// ── Mobile day view ──────────────────────────────────────────────────────
// One day at a time, consuming the SAME venueRows the weekly grid renders —
// no recomputation or refetching. Taps call the same openCreateSlot /
// openEditSlot the grid cells use, so the one page-level PracticeSlotModal
// serves both views.

const JS_DAY_TO_KEY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function MobileDayView({
  venueRows,
  teamById,
  divisionById,
  onEmptyClick,
  onOccupantClick,
}: {
  venueRows: { venue: Venue; days: Map<string, CellRowLite[]> }[];
  teamById: Map<string, Team>;
  divisionById: Map<string, Division>;
  onEmptyClick: (venue: Venue, day: string, startTime: string) => void;
  onOccupantClick: (slot: PracticeSlotRow) => void;
}) {
  const [date, setDate] = useState(() => new Date());
  const dayKey = JS_DAY_TO_KEY[date.getDay()];

  function shiftDay(delta: number) {
    setDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + delta);
      return next;
    });
  }

  const entries = venueRows.flatMap(({ venue, days }) =>
    (days.get(dayKey) ?? []).map((row) => ({ venue, row })),
  );
  entries.sort(
    (a, b) =>
      a.row.start_time.localeCompare(b.row.start_time) ||
      a.venue.name.localeCompare(b.venue.name),
  );

  return (
    <div className="md:hidden">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <button
          type="button"
          onClick={() => shiftDay(-1)}
          aria-label="Previous day"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-[#22C55E]/40 hover:text-[#22C55E]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-[#0C1F3F]">
          {dayFull(dayKey)}, {MONTHS_FULL[date.getMonth()]} {date.getDate()}
        </span>
        <button
          type="button"
          onClick={() => shiftDay(1)}
          aria-label="Next day"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-[#22C55E]/40 hover:text-[#22C55E]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          No practices scheduled for this day
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-4">
          {entries.map(({ venue, row }) => (
            <MobileSlotRow
              key={`${venue.id}-${row.start_time}`}
              venue={venue}
              row={row}
              teamById={teamById}
              divisionById={divisionById}
              onEmptyClick={() => onEmptyClick(venue, dayKey, row.start_time)}
              onOccupantClick={onOccupantClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileSlotRow({
  venue,
  row,
  teamById,
  divisionById,
  onEmptyClick,
  onOccupantClick,
}: {
  venue: Venue;
  row: CellRowLite;
  teamById: Map<string, Team>;
  divisionById: Map<string, Division>;
  onEmptyClick: () => void;
  onOccupantClick: (slot: PracticeSlotRow) => void;
}) {
  // Open slot — same dashed/muted treatment as the grid's empty cells.
  if (row.occupants.length === 0) {
    return (
      <button
        type="button"
        onClick={onEmptyClick}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-left transition-colors hover:border-[#22C55E]/40 hover:bg-[#22C55E]/5"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-gray-500">{venue.name}</span>
          <span className="text-xs text-gray-400">{fmtTime(row.start_time)}</span>
        </span>
        <span className="text-xs text-gray-400">Open</span>
      </button>
    );
  }

  const occupantRows = row.occupants.map((slot) => {
    const team = teamById.get(slot.team_id);
    const div = team ? divisionById.get(team.division_id) : null;
    return { slot, team, div };
  });

  // Single assignment — the whole card is the tap target.
  if (occupantRows.length === 1) {
    const { slot, team, div } = occupantRows[0];
    return (
      <button
        type="button"
        onClick={() => onOccupantClick(slot)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-[#22C55E]/40"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-[#0C1F3F]">{venue.name}</span>
          <span className="text-xs text-gray-500">{fmtTime(row.start_time)}</span>
        </span>
        <span className="flex flex-col items-end">
          <span className="flex items-center gap-1 text-sm font-semibold text-[#0C1F3F]">
            {slot.placement_source === "manual" && (
              <Lock className="h-3 w-3 text-gray-500" aria-label="Manually placed" />
            )}
            {team?.name ?? "Unknown team"}
          </span>
          <span className="text-xs text-gray-500">{div?.name ?? "?"}</span>
        </span>
      </button>
    );
  }

  // Cross-division collision — amber, matching the grid's warning treatment,
  // with each claiming team tappable.
  return (
    <div className="rounded-lg border border-amber-300 border-l-4 border-l-amber-400 bg-amber-50">
      <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
        <span className="text-sm font-semibold text-[#0C1F3F]">{venue.name}</span>
        <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          {fmtTime(row.start_time)}
        </span>
      </div>
      <div className="flex flex-col divide-y divide-amber-100">
        {occupantRows.map(({ slot, team, div }) => (
          <button
            key={slot.id}
            type="button"
            onClick={() => onOccupantClick(slot)}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-amber-100/50"
          >
            <span className="flex items-center gap-1 text-sm font-semibold text-[#0C1F3F]">
              {slot.placement_source === "manual" && (
                <Lock className="h-3 w-3 text-gray-500" aria-label="Manually placed" />
              )}
              {team?.name ?? "Unknown team"}
            </span>
            <span className="text-xs text-gray-500">{div?.name ?? "?"}</span>
          </button>
        ))}
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
  notify,
}: {
  divisionId: string;
  timeSlots: TimeSlot[];
  onChange: () => Promise<void>;
  notify: Notify;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStart, setNewStart] = useState("17:00");
  const [newDuration, setNewDuration] = useState<number>(90);
  const [newDays, setNewDays] = useState<Set<string>>(
    () => new Set(ALL_DAY_KEYS),
  );
  const [newDaysError, setNewDaysError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const nextSortOrder = useMemo(
    () =>
      timeSlots.length === 0
        ? 0
        : timeSlots[timeSlots.length - 1].sort_order + 1,
    [timeSlots],
  );

  function toggleNewDay(key: string) {
    setNewDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function addSlot() {
    if (!newStart) return;
    if (newDays.size === 0) {
      setNewDaysError("Pick at least one day this slot applies to.");
      return;
    }
    setNewDaysError(null);
    const labelToUse = newLabel.trim() || fmtTime(newStart);
    const supabase = createClient();
    const { error } = await supabase
      .from("practice_time_slots")
      .insert([
        {
          division_id: divisionId,
          label: labelToUse,
          start_time: newStart,
          duration_minutes: Math.max(15, Math.floor(newDuration || 90)),
          sort_order: nextSortOrder,
          days_of_week: sortDays(newDays),
        },
      ] as never);
    if (error) {
      notify("error", `Couldn't add time slot: ${error.message}`);
      return;
    }
    setNewLabel("");
    setNewStart("17:00");
    setNewDuration(90);
    setNewDays(new Set(ALL_DAY_KEYS));
    setAdding(false);
    await onChange();
  }

  async function deleteSlot(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("practice_time_slots")
      .delete()
      .eq("id", id);
    if (error) {
      notify("error", `Couldn't delete time slot: ${error.message}`);
      return;
    }
    await onChange();
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Action row: lives at the top of the per-division section so it acts
          as the section header for the "Add slot" / "Copy slots" controls. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {copyNotice && (
          <span className="mr-auto inline-flex items-center gap-1.5 rounded-full bg-[#22C55E]/10 px-2.5 py-1 text-[11px] font-medium text-[#16a34a]">
            <CheckCircle2 className="h-3 w-3" />
            {copyNotice}
          </span>
        )}
        <button
          onClick={() => setCopyOpen(true)}
          disabled={timeSlots.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0C1F3F] transition-colors hover:border-[#22C55E]/40 hover:text-[#22C55E] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy slots between days
        </button>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
          >
            <Plus className="h-3.5 w-3.5" />
            Add slot
          </button>
        )}
      </div>

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
                notify={notify}
              />
            ))}
          </div>
        </div>
      )}

      {adding && (
        <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
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
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => {
                  setAdding(false);
                  setNewLabel("");
                  setNewDaysError(null);
                  setNewDays(new Set(ALL_DAY_KEYS));
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
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Days
            </label>
            <DayPills
              selected={newDays}
              onToggle={toggleNewDay}
              variant="short"
            />
            {newDaysError && (
              <p className="text-[11px] font-medium text-red-500">
                {newDaysError}
              </p>
            )}
          </div>
        </div>
      )}

      {copyOpen && (
        <CopySlotsModal
          timeSlots={timeSlots}
          onClose={() => setCopyOpen(false)}
          onDone={async (count, source, targets) => {
            setCopyOpen(false);
            await onChange();
            if (count === 0) {
              setCopyNotice(`No slots on ${dayFull(source)} to copy.`);
            } else {
              const targetLabels = targets.map((t) => dayLabel(t)).join(", ");
              setCopyNotice(
                `Copied ${count} slot${count === 1 ? "" : "s"} from ${dayFull(source)} to ${targetLabels}.`,
              );
            }
            window.setTimeout(() => setCopyNotice(null), 6000);
          }}
        />
      )}
    </div>
  );
}

function TimeSlotRow({
  slot,
  onDelete,
  onChange,
  notify,
}: {
  slot: TimeSlot;
  onDelete: () => void;
  onChange: () => Promise<void>;
  notify: Notify;
}) {
  const [label, setLabel] = useState(slot.label);
  const [startTime, setStartTime] = useState(slot.start_time);
  const [duration, setDuration] = useState(slot.duration_minutes);
  const [days, setDays] = useState<Set<string>>(
    () => new Set(slot.days_of_week),
  );
  const [daysError, setDaysError] = useState<string | null>(null);

  // Keep local day state in sync if the row is re-rendered with a fresh slot
  // (e.g. after a successful save reloads parent data).
  useEffect(() => {
    setDays(new Set(slot.days_of_week));
    setDaysError(null);
  }, [slot.days_of_week]);

  async function save(updates: Record<string, unknown>) {
    const supabase = createClient();
    const { error } = await supabase
      .from("practice_time_slots")
      .update(updates as never)
      .eq("id", slot.id);
    if (error) {
      notify("error", `Couldn't save time slot: ${error.message}`);
      return;
    }
    await onChange();
  }

  function toggleDay(key: string) {
    const next = new Set(days);
    if (next.has(key)) {
      if (next.size === 1) {
        setDaysError("At least one day is required.");
        window.setTimeout(() => setDaysError(null), 3000);
        return;
      }
      next.delete(key);
    } else {
      next.add(key);
    }
    setDays(next);
    setDaysError(null);
    save({ days_of_week: sortDays(next) });
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-3">
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
              // A cleared/uncommitted native input reports "" — never save it
              // (start_time is a NOT NULL time column). Seconds tolerated:
              // the prefilled DB value is HH:MM:SS.
              /^\d{2}:\d{2}(:\d{2})?$/.test(startTime) &&
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
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          Days
        </label>
        <DayPills selected={days} onToggle={toggleDay} variant="short" />
        {daysError && (
          <p className="text-[11px] font-medium text-red-500">{daysError}</p>
        )}
      </div>
    </div>
  );
}

// ── Day pills ────────────────────────────────────────────────────────────

function DayPills({
  selected,
  onToggle,
  variant = "short",
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
  variant?: "short" | "label";
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {DAY_OPTIONS.map((d) => {
        const isOn = selected.has(d.key);
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onToggle(d.key)}
            aria-pressed={isOn}
            title={d.full}
            className={`min-w-[28px] rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
              isOn
                ? "bg-[#22C55E] text-white"
                : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-[#0C1F3F]"
            }`}
          >
            {variant === "short" ? d.short : d.label}
          </button>
        );
      })}
    </div>
  );
}

function sortDays(set: Set<string>): string[] {
  return ALL_DAY_KEYS.filter((k) => set.has(k));
}

function dayLabel(key: string): string {
  return DAY_OPTIONS.find((d) => d.key === key)?.label ?? key;
}
function dayFull(key: string): string {
  return DAY_OPTIONS.find((d) => d.key === key)?.full ?? key;
}

// ── Copy slots modal ─────────────────────────────────────────────────────

function CopySlotsModal({
  timeSlots,
  onClose,
  onDone,
}: {
  timeSlots: TimeSlot[];
  onClose: () => void;
  onDone: (count: number, source: string, targets: string[]) => void | Promise<void>;
}) {
  const [source, setSource] = useState<string>("Mo");
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTarget(key: string) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function run() {
    setError(null);
    if (targets.size === 0) {
      setError("Pick at least one target day.");
      return;
    }
    setBusy(true);
    const matching = timeSlots.filter((s) => s.days_of_week.includes(source));
    const targetKeys = [...targets];
    const supabase = createClient();
    // Update each matching slot's days_of_week additively, deduped + sorted.
    let updated = 0;
    for (const slot of matching) {
      const merged = new Set(slot.days_of_week);
      let changed = false;
      for (const k of targetKeys) {
        if (!merged.has(k)) {
          merged.add(k);
          changed = true;
        }
      }
      // Even if nothing changed, count the slot as "copied" — the action
      // logically applied to it; idempotency is a feature, not silence.
      updated += 1;
      if (changed) {
        const { error: updErr } = await supabase
          .from("practice_time_slots")
          .update({ days_of_week: sortDays(merged) } as never)
          .eq("id", slot.id);
        if (updErr) {
          setBusy(false);
          setError(`Failed on "${slot.label}": ${updErr.message}`);
          return;
        }
      }
    }
    setBusy(false);
    await onDone(updated, source, targetKeys);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-[#0C1F3F]">
            Copy slots between days
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
        <div className="flex flex-col gap-4 px-6 py-5">
          <p className="text-xs text-gray-500">
            Add every selected target day to each time slot in this division
            that currently runs on the source day. Existing slots on target
            days are untouched.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              From day
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            >
              {DAY_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.full}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              To days
            </label>
            <DayPills
              selected={targets}
              onToggle={toggleTarget}
              variant="label"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
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
              onClick={run}
              disabled={busy || targets.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Copying…" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Team preferences body (per division) ─────────────────────────────────

function TeamPreferencesBody({
  teams,
  timeSlots,
  venues,
  blocksByTeam,
  onChange,
  notify,
}: {
  teams: Team[];
  timeSlots: TimeSlot[];
  venues: Venue[];
  blocksByTeam: Map<string, AvailabilityBlock[]>;
  onChange: () => Promise<void>;
  notify: Notify;
}) {
  if (teams.length === 0) {
    return (
      <p className="px-1 py-4 text-center text-xs text-gray-500">
        No teams in this division yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {teams.map((t) => (
        <TeamPreferenceCard
          key={t.id}
          team={t}
          timeSlots={timeSlots}
          venues={venues}
          blocks={blocksByTeam.get(t.id) ?? []}
          onSaved={onChange}
          notify={notify}
        />
      ))}
    </div>
  );
}

function TeamPreferenceCard({
  team,
  timeSlots,
  venues,
  blocks,
  onSaved,
  notify,
}: {
  team: Team;
  timeSlots: TimeSlot[];
  venues: Venue[];
  blocks: AvailabilityBlock[];
  onSaved: () => Promise<void>;
  notify: Notify;
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
    const { error } = await supabase
      .from("teams")
      .update(updates as never)
      .eq("id", team.id);
    setSaving(false);
    if (error) {
      notify("error", `Couldn't save ${team.name}: ${error.message}`);
      return;
    }
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
    <div className="rounded-lg border border-gray-100 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
        <p className="font-semibold text-[#0C1F3F]">{team.name}</p>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Practices / week
          </label>
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
          {saving && (
            <Loader2 className="h-3 w-3 animate-spin text-gray-300" />
          )}
        </div>
      </div>
      <div className="grid gap-4 px-4 py-3 sm:grid-cols-[2fr,1fr,1fr]">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Preferred days
          </label>
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
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Preferred time
          </label>
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
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Preferred field
          </label>
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
                {qualifiedVenueLabel(v)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <UnavailabilitySection
        teamId={team.id}
        teamName={team.name}
        blocks={blocks}
        onSaved={onSaved}
        notify={notify}
      />
    </div>
  );
}

// ── Unavailability subsection ────────────────────────────────────────────

function formatBlockLine(b: AvailabilityBlock): string {
  const dayName = dayFull(b.day_of_week);
  if (b.start_time === null || b.end_time === null) {
    return `${dayName}s — all day`;
  }
  return `${dayName}s — ${fmtTime(b.start_time)} to ${fmtTime(b.end_time)}`;
}

function UnavailabilitySection({
  teamId,
  teamName,
  blocks,
  onSaved,
  notify,
}: {
  teamId: string;
  teamName: string;
  blocks: AvailabilityBlock[];
  onSaved: () => Promise<void>;
  notify: Notify;
}) {
  const [adding, setAdding] = useState(false);
  const [newDay, setNewDay] = useState<string>("Mo");
  const [newStart, setNewStart] = useState<string>("");
  const [newEnd, setNewEnd] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sortedBlocks = useMemo(() => {
    return [...blocks].sort((a, b) => {
      const di =
        DAY_OPTIONS.findIndex((d) => d.key === a.day_of_week) -
        DAY_OPTIONS.findIndex((d) => d.key === b.day_of_week);
      if (di !== 0) return di;
      return (a.start_time ?? "").localeCompare(b.start_time ?? "");
    });
  }, [blocks]);

  function resetForm() {
    setNewDay("Mo");
    setNewStart("");
    setNewEnd("");
    setFormError(null);
  }

  async function addBlock() {
    setFormError(null);
    const hasStart = newStart.trim().length > 0;
    const hasEnd = newEnd.trim().length > 0;
    if (hasStart !== hasEnd) {
      setFormError(
        "Set both start and end times, or leave both blank for an all-day block.",
      );
      return;
    }
    if (hasStart && hasEnd && newEnd <= newStart) {
      setFormError("End time must be after start time.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const payload: {
      team_id: string;
      day_of_week: string;
      start_time: string | null;
      end_time: string | null;
    } = {
      team_id: teamId,
      day_of_week: newDay,
      start_time: hasStart ? newStart : null,
      end_time: hasEnd ? newEnd : null,
    };
    const { error } = await supabase
      .from("team_availability_blocks")
      .insert([payload] as never);
    setBusy(false);
    if (error) {
      notify(
        "error",
        `Couldn't add unavailability for ${teamName}: ${error.message}`,
      );
      return;
    }
    setAdding(false);
    resetForm();
    await onSaved();
  }

  async function deleteBlock(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("team_availability_blocks")
      .delete()
      .eq("id", id);
    if (error) {
      notify("error", `Couldn't delete block: ${error.message}`);
      return;
    }
    await onSaved();
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Unavailability
        </h4>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#0C1F3F] transition-colors hover:border-[#22C55E]/40 hover:text-[#22C55E]"
          >
            <Plus className="h-3 w-3" />
            Add block
          </button>
        )}
      </div>
      {sortedBlocks.length === 0 && !adding ? (
        <p className="mt-2 text-[11px] text-gray-400">
          No unavailability set — every day and time is fair game for
          auto-assign.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {sortedBlocks.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-md border border-gray-100 bg-white px-2.5 py-1.5 text-xs text-[#0C1F3F]"
            >
              <span>{formatBlockLine(b)}</span>
              <button
                type="button"
                onClick={() => deleteBlock(b.id)}
                aria-label="Delete block"
                className="text-gray-400 transition-colors hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-gray-100 bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Day
              </label>
              <select
                value={newDay}
                onChange={(e) => setNewDay(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.full}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Start{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="time"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                End <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="time"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  resetForm();
                }}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addBlock}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {formError && (
            <p className="text-[11px] font-medium text-red-500">{formError}</p>
          )}
          <p className="text-[10px] text-gray-400">
            Leave both times blank to block the whole day.
          </p>
        </div>
      )}
    </div>
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

// ── Toast banner ─────────────────────────────────────────────────────────

function ToastBanner({
  kind,
  message,
  onDismiss,
}: {
  kind: "error" | "success";
  message: string;
  onDismiss: () => void;
}) {
  const isError = kind === "error";
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-[#22C55E]/30 bg-[#22C55E]/5 text-[#16a34a]"
      }`}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
      )}
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 rounded-md p-1 text-current/60 hover:bg-black/5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
