"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X, AlertTriangle, Loader2, CheckCircle2, ChevronDown, Zap, MapPin, Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectScheduleConflicts, type ScheduleConflict } from "@/lib/schedule/generate-schedule";
import { fmtGameDate } from "@/lib/utils/game-time";
import { logActivity } from "@/lib/activity-log";
import {
  DAY_LABELS,
  dayKeyFromIsoDate,
  dayKeyFromJsDate,
  fmtTime12,
  isVenueAvailable,
  parseAvailability,
  type VenueAvailability,
} from "@/lib/venues/availability";
import {
  CONFLICT_TYPE_LABELS,
  insertConflictOverrides,
  type DetectedConflict,
} from "@/lib/schedule/conflict-overrides";

// ─── Types ────────────────────────────────────────────────────────────────────

type GameRow = {
  id: string;
  scheduled_at: string;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  venue: { id: string; name: string } | null;
};

type Venue = { id: string; name: string; availability: VenueAvailability };

type DivSettings = {
  game_duration: number;
  buffer_minutes: number;
  playing_days: string[];
  earliest_start: string;
  latest_start: string;
};

// ─── DB helper (bypasses broken Supabase generic inference for games.update) ──

async function patchGame(
  id: string,
  data: { scheduled_at: string; venue_id: string },
): Promise<{ error: { message: string } | null }> {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.from("games") as any).update(data).eq("id", id);
}

// ─── Slot-finding helpers ─────────────────────────────────────────────────────

const DAY_ABBR_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};

function minsFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hhmmFromMins(mins: number): string {
  return `${Math.floor(mins / 60).toString().padStart(2, "0")}:${(mins % 60).toString().padStart(2, "0")}`;
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

/**
 * Finds the first open (venue, datetime) slot for a game that needs to move.
 * Excludes the game being moved from the occupied set so its current slot counts as free.
 * Venue hours are a hard filter — a slot the venue isn't open for is never
 * emitted (same "tighter of division + venue windows" rule as the generator).
 */
function findFreeSlot(
  excludeGameId: string,
  allVenueGames: GameRow[],
  venues: Venue[],
  settings: DivSettings,
  startDate: string,
  endDate: string,
): { scheduledAt: string; venueId: string } | null {
  const duration = Number(settings.game_duration);
  const buffer = Number(settings.buffer_minutes);
  const gap = Math.max(1, duration + buffer);
  const earliest = minsFromHHMM(settings.earliest_start);
  const latest = minsFromHHMM(settings.latest_start);
  const allowedDays = new Set(settings.playing_days.map((d) => DAY_ABBR_TO_JS[d] ?? -1));

  // Build occupied map: "venueId:YYYY-MM-DD" -> minutes[]
  const occupied = new Map<string, number[]>();
  for (const g of allVenueGames) {
    if (g.id === excludeGameId || !g.venue_id) continue;
    const key = `${g.venue_id}:${g.scheduled_at.substring(0, 10)}`;
    const mins = minsFromHHMM(g.scheduled_at.substring(11, 16));
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key)!.push(mins);
  }

  const rangeStart = new Date(startDate + "T00:00:00");
  const rangeEnd = new Date(endDate + "T00:00:00");
  const cur = new Date(rangeStart);

  while (cur <= rangeEnd) {
    if (allowedDays.has(cur.getDay())) {
      const date = localDateStr(cur);
      const dayKey = dayKeyFromJsDate(cur);
      for (const v of venues) {
        const occ = occupied.get(`${v.id}:${date}`) ?? [];
        let t = earliest;
        while (t <= latest) {
          if (
            isVenueAvailable(v.availability, dayKey, hhmmFromMins(t), duration) &&
            occ.every((o) => Math.abs(o - t) >= gap)
          ) {
            return { scheduledAt: `${date}T${hhmmFromMins(t)}:00`, venueId: v.id };
          }
          t += gap;
        }
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  leagueId: string;
  divisionId: string;
  divisionName: string;
  onClose: () => void;
  onResolved: () => void;
}

type MoveForm = { venueId: string; date: string; time: string };

export function ConflictResolverModal({ leagueId, divisionId, divisionName, onClose, onResolved }: Props) {
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [allVenueGames, setAllVenueGames] = useState<GameRow[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [settings, setSettings] = useState<DivSettings | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  // Per-game state
  const [expandedGame, setExpandedGame] = useState<string | null>(null);
  const [moveForms, setMoveForms] = useState<Record<string, MoveForm>>({});
  // null/absent = not checked; non-empty = conflicts shown and Save is
  // blocked until an override reason is entered (mirrors the Add Game modal).
  const [moveConflicts, setMoveConflicts] = useState<Record<string, DetectedConflict[] | null>>({});
  const [moveOverrideOpen, setMoveOverrideOpen] = useState<Record<string, boolean>>({});
  const [moveReasons, setMoveReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({}); // per conflict key
  const [autoResolvingAll, setAutoResolvingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    type DivRow = { settings: DivSettings; start_date: string | null; end_date: string | null };
    type TeamIdRow = { id: string };
    type VenueIdRow = { venue_id: string };

    const [divRes, teamRes, dvRes] = await Promise.all([
      supabase.from("divisions").select("settings, start_date, end_date").eq("id", divisionId).single(),
      supabase.from("teams").select("id").eq("division_id", divisionId),
      supabase.from("division_venues").select("venue_id").eq("division_id", divisionId),
    ]);

    const divData = divRes.data as unknown as DivRow | null;
    const s = divData?.settings as DivSettings | undefined;
    setSettings(s ?? null);
    if (divData?.start_date && divData?.end_date) {
      setDateRange({ start: divData.start_date, end: divData.end_date });
    }

    const divTeamIds = new Set(((teamRes.data ?? []) as unknown as TeamIdRow[]).map((t) => t.id));
    const venueIds = ((dvRes.data ?? []) as unknown as VenueIdRow[]).map((r) => r.venue_id);

    if (!venueIds.length) { setLoading(false); return; }

    const [venueRes, gamesRes] = await Promise.all([
      // Filter to availability-configured venues only — the engine can't place
      // games at unconfigured venues, so don't offer them as a move target.
      supabase
        .from("venues")
        .select("id, name, availability")
        .in("id", venueIds)
        .eq("availability_configured", true),
      supabase
        .from("games")
        .select(`
          id, scheduled_at, venue_id, home_team_id, away_team_id,
          home_team:teams!home_team_id(name),
          away_team:teams!away_team_id(name),
          venue:venues(id, name)
        `)
        .in("venue_id", venueIds)
        .order("scheduled_at"),
    ]);

    const rows = (gamesRes.data ?? []) as unknown as GameRow[];
    setAllVenueGames(rows);
    setVenues(
      (
        (venueRes.data ?? []) as { id: string; name: string; availability: unknown }[]
      ).map((v) => ({
        id: v.id,
        name: v.name,
        availability: parseAvailability(v.availability),
      })),
    );

    // Detect conflicts across all venue games, filter to those touching this division
    const flat = rows.map((g) => ({
      id: g.id,
      scheduled_at: g.scheduled_at,
      venue_id: g.venue_id,
      venue_name: (g.venue as { name: string } | null)?.name ?? "Unknown venue",
      home_team_name: (g.home_team as { name: string } | null)?.name ?? "TBD",
      away_team_name: (g.away_team as { name: string } | null)?.name ?? "TBD",
    }));

    const gameDuration = Number(s?.game_duration ?? 0);
    const bufferMins = Number(s?.buffer_minutes ?? 0);
    const all = detectScheduleConflicts(flat, gameDuration, bufferMins);
    const divIds = new Set(rows.filter((g) => divTeamIds.has(g.home_team_id)).map((g) => g.id));
    const divConflicts = all.filter((c) => c.games.some((g) => divIds.has(g.id)));
    setConflicts(divConflicts);
    setLoading(false);
  }, [divisionId]);

  useEffect(() => { load(); }, [load]);

  function openMoveForm(gameId: string) {
    const game = allVenueGames.find((g) => g.id === gameId);
    if (!game) return;
    setMoveForms((prev) => ({
      ...prev,
      [gameId]: {
        venueId: game.venue_id ?? venues[0]?.id ?? "",
        date: game.scheduled_at.substring(0, 10),
        time: game.scheduled_at.substring(11, 16),
      },
    }));
    setMoveConflicts((p) => ({ ...p, [gameId]: null }));
    setMoveOverrideOpen((p) => ({ ...p, [gameId]: false }));
    setMoveReasons((p) => ({ ...p, [gameId]: "" }));
    setExpandedGame(gameId);
  }

  // Field edits invalidate previously detected conflicts for that game — the
  // next save re-checks against the new values.
  function updateMoveForm(gameId: string, patch: Partial<MoveForm>) {
    setMoveForms((p) => ({ ...p, [gameId]: { ...p[gameId], ...patch } }));
    setMoveConflicts((p) => ({ ...p, [gameId]: null }));
  }

  // Same three checks as the Add Game modal, against the new slot. Venue
  // double-book is spacing-aware (duration + buffer) using the already-loaded
  // venue games; the team check queries exact-time matches like Add Game.
  async function detectMoveConflicts(
    game: GameRow,
    form: MoveForm,
  ): Promise<DetectedConflict[]> {
    const found: DetectedConflict[] = [];
    const iso = `${form.date}T${form.time}:00`;
    const targetVenue = venues.find((v) => v.id === form.venueId);
    const duration = Number(settings?.game_duration ?? 0);
    const buffer = Number(settings?.buffer_minutes ?? 0);
    const gap = Math.max(1, duration + buffer);

    if (targetVenue && duration > 0) {
      const dayKey = dayKeyFromIsoDate(iso);
      if (!isVenueAvailable(targetVenue.availability, dayKey, form.time, duration)) {
        const win = targetVenue.availability[dayKey];
        found.push({
          type: "venue_hours",
          message: `${targetVenue.name} isn't open at this time (${DAY_LABELS[dayKey]}: ${
            win ? `${fmtTime12(win.start)} – ${fmtTime12(win.end)}` : "closed"
          }).`,
        });
      }
    }

    const newMins = minsFromHHMM(form.time);
    const venueClash = allVenueGames.some(
      (g) =>
        g.id !== game.id &&
        g.venue_id === form.venueId &&
        g.scheduled_at.substring(0, 10) === form.date &&
        Math.abs(minsFromHHMM(g.scheduled_at.substring(11, 16)) - newMins) < gap,
    );
    if (venueClash) {
      found.push({
        type: "venue_double_book",
        message: `${targetVenue?.name ?? "This venue"} already has a game within ${gap} minutes of this time.`,
      });
    }

    const teamIds = [game.home_team_id, game.away_team_id].filter(
      (id): id is string => !!id,
    );
    if (teamIds.length > 0) {
      const supabase = createClient();
      const { data: teamRows } = await supabase
        .from("games")
        .select("id, home_team_id, away_team_id")
        .eq("scheduled_at", iso)
        .neq("status", "cancelled")
        .neq("id", game.id)
        .or(
          `home_team_id.in.(${teamIds.join(",")}),away_team_id.in.(${teamIds.join(",")})`,
        );
      if ((teamRows ?? []).length > 0) {
        found.push({
          type: "team_double_book",
          message: `${game.home_team?.name ?? "A team"} or ${game.away_team?.name ?? "their opponent"} already has a game at this time.`,
        });
      }
    }

    return found;
  }

  async function saveManualMove(gameId: string) {
    const form = moveForms[gameId];
    const game = allVenueGames.find((g) => g.id === gameId);
    if (!form || !game) return;
    setSaving((p) => ({ ...p, [gameId]: true }));
    setError(null);

    // First save click detects conflicts and blocks; the second (with a
    // required reason) writes the move + the override audit rows.
    const known = moveConflicts[gameId] ?? null;
    if (known === null) {
      const found = await detectMoveConflicts(game, form);
      if (found.length > 0) {
        setMoveConflicts((p) => ({ ...p, [gameId]: found }));
        setSaving((p) => ({ ...p, [gameId]: false }));
        return;
      }
    } else if (known.length > 0 && !moveReasons[gameId]?.trim()) {
      setSaving((p) => ({ ...p, [gameId]: false }));
      return;
    }

    const { error: err } = await patchGame(gameId, {
      scheduled_at: `${form.date}T${form.time}:00`,
      venue_id: form.venueId,
    });

    if (err) {
      setSaving((p) => ({ ...p, [gameId]: false }));
      setError(err.message);
      return;
    }

    if (known && known.length > 0) {
      const { error: overrideErr } = await insertConflictOverrides(
        createClient(),
        gameId,
        known,
        moveReasons[gameId]!.trim(),
      );
      if (overrideErr) {
        // The move IS saved — surface the audit failure without inviting a
        // retry that would re-apply the move.
        setError(`Game moved, but recording the override reason failed: ${overrideErr}`);
      }
    }

    setSaving((p) => ({ ...p, [gameId]: false }));

    const homeTeam = (game.home_team as { name: string } | null)?.name ?? "Home";
    const awayTeam = (game.away_team as { name: string } | null)?.name ?? "Away";
    console.log("[logActivity] before call: game_conflict_resolved (saveManualMove)", { leagueId, divisionId });
    const _r1 = await logActivity(leagueId, divisionId, "game_conflict_resolved",
      `${homeTeam} vs ${awayTeam} moved to ${form.date} at ${form.time} — double-booking resolved`);
    console.log("[logActivity] result (saveManualMove):", _r1);

    setExpandedGame(null);
    await load();
    onResolved();
  }

  async function autoResolveConflict(conflict: ScheduleConflict) {
    if (!settings || !dateRange) return;
    const key = conflict.venueId + conflict.date;
    setResolving((p) => ({ ...p, [key]: true }));
    setError(null);

    // Keep the first game; move the rest (prefer moving non-division games last)
    const gamesToMove = conflict.games.slice(1);
    let localGames = [...allVenueGames];

    for (const g of gamesToMove) {
      const slot = findFreeSlot(g.id, localGames, venues, settings, dateRange.start, dateRange.end);
      if (!slot) {
        setError(`No free slot found for ${g.homeTeam} vs ${g.awayTeam}. Try resolving manually.`);
        setResolving((p) => ({ ...p, [key]: false }));
        await load();
        onResolved();
        return;
      }
      const { error: err } = await patchGame(g.id, {
        scheduled_at: slot.scheduledAt,
        venue_id: slot.venueId,
      });
      if (err) { setError(err.message); setResolving((p) => ({ ...p, [key]: false })); return; }
      // Update local copy so subsequent games in same loop see the new slot as occupied
      localGames = localGames.map((r) =>
        r.id === g.id ? { ...r, scheduled_at: slot.scheduledAt, venue_id: slot.venueId } : r,
      );
    }

    const movedCount = gamesToMove.length;
    console.log("[logActivity] before call: game_conflict_resolved (autoResolveConflict)", { leagueId, divisionId });
    const _r2 = await logActivity(leagueId, divisionId, "game_conflict_resolved",
      `${movedCount} game${movedCount !== 1 ? "s" : ""} at ${conflict.venueName} moved — double-booking resolved`);
    console.log("[logActivity] result (autoResolveConflict):", _r2);

    setResolving((p) => ({ ...p, [key]: false }));
    await load();
    onResolved();
  }

  async function autoResolveAll() {
    if (!settings || !dateRange) return;
    setAutoResolvingAll(true);
    setError(null);

    let localGames = [...allVenueGames];

    for (const conflict of conflicts) {
      const gamesToMove = conflict.games.slice(1);
      for (const g of gamesToMove) {
        const slot = findFreeSlot(g.id, localGames, venues, settings, dateRange.start, dateRange.end);
        if (!slot) {
          setError(`No free slot found for ${g.homeTeam} vs ${g.awayTeam}. Remaining conflicts resolved manually.`);
          setAutoResolvingAll(false);
          await load();
          onResolved();
          return;
        }
        await patchGame(g.id, { scheduled_at: slot.scheduledAt, venue_id: slot.venueId });
        localGames = localGames.map((r) =>
          r.id === g.id ? { ...r, scheduled_at: slot.scheduledAt, venue_id: slot.venueId } : r,
        );
      }
    }

    const totalMoved = conflicts.reduce((sum, c) => sum + c.games.slice(1).length, 0);
    console.log("[logActivity] before call: game_conflict_resolved (autoResolveAll)", { leagueId, divisionId });
    const _r3 = await logActivity(leagueId, divisionId, "game_conflict_resolved",
      `${totalMoved} game${totalMoved !== 1 ? "s" : ""} auto-resolved — all double-bookings cleared`);
    console.log("[logActivity] result (autoResolveAll):", _r3);

    setAutoResolvingAll(false);
    await load();
    onResolved();
  }

  const canAutoResolve = !!settings && !!dateRange;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer — slides in from the right */}
      <div className="relative ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <h2 className="font-semibold text-[#0C1F3F]">Fix conflicts</h2>
            </div>
            <p className="mt-0.5 text-xs text-gray-400">{divisionName}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : conflicts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CheckCircle2 className="h-10 w-10 text-[#22C55E]" />
              <p className="mt-3 font-semibold text-[#0C1F3F]">No conflicts</p>
              <p className="mt-1 text-sm text-gray-400">This division&apos;s schedule looks clean.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-red-600">{conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}</span>
                {" "}found — two or more games are double-booked on the same field. Review each one and resolve it manually or let the scheduler find a free slot.
              </p>

              {conflicts.map((conflict, idx) => {
                const conflictKey = conflict.venueId + conflict.date;
                const isResolvingThis = resolving[conflictKey];

                return (
                  <div
                    key={conflictKey}
                    className="overflow-hidden rounded-xl border border-red-100"
                  >
                    {/* Conflict header */}
                    <div className="flex items-center gap-2.5 border-b border-red-100 bg-red-50 px-4 py-3">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                      <span className="text-xs font-bold uppercase tracking-wide text-red-600">
                        Conflict {idx + 1} of {conflicts.length}
                      </span>
                      <span className="h-3.5 border-l border-red-200" />
                      <span className="flex items-center gap-1 text-xs text-red-600">
                        <MapPin className="h-3 w-3" />
                        {conflict.venueName}
                      </span>
                      <span className="h-3.5 border-l border-red-200" />
                      <span className="flex items-center gap-1 text-xs text-red-600">
                        <Clock className="h-3 w-3" />
                        {fmtGameDate(conflict.date + "T12:00:00")}
                      </span>
                    </div>

                    {/* Games in this conflict */}
                    <div className="divide-y divide-gray-50 bg-white">
                      {conflict.games.map((g, gIdx) => {
                        const isFirst = gIdx === 0;
                        const isExpanded = expandedGame === g.id;
                        const form = moveForms[g.id];
                        const isSavingGame = saving[g.id];
                        return (
                          <div key={g.id}>
                            {/* Game row */}
                            <div className="flex items-center gap-3 px-4 py-3">
                              {/* Time chip */}
                              <span className={`flex-shrink-0 rounded px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                                isFirst
                                  ? "bg-gray-100 text-gray-500"
                                  : "bg-red-100 text-red-600"
                              }`}>
                                {g.timeLabel}
                              </span>

                              {/* Teams */}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-[#0C1F3F]">
                                  {g.homeTeam}{" "}
                                  <span className="font-normal text-gray-400">vs</span>{" "}
                                  {g.awayTeam}
                                </p>
                                {g.divisionName && (
                                  <p className="mt-0.5 text-xs text-gray-400">{g.divisionName}</p>
                                )}
                              </div>

                              {/* Keep badge on first / Move button on rest */}
                              {isFirst ? (
                                <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
                                  keep
                                </span>
                              ) : (
                                <button
                                  onClick={() =>
                                    isExpanded ? setExpandedGame(null) : openMoveForm(g.id)
                                  }
                                  disabled={isSavingGame}
                                  className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:opacity-50"
                                >
                                  {isSavingGame ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <>
                                      Move game
                                      <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                    </>
                                  )}
                                </button>
                              )}
                            </div>

                            {/* Manual move form */}
                            {isExpanded && form && (
                              <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-4">
                                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                  Reassign to a different field or time
                                </p>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
                                  {/* Field */}
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-gray-500">Field</label>
                                    <select
                                      value={form.venueId}
                                      onChange={(e) => updateMoveForm(g.id, { venueId: e.target.value })}
                                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#0C1F3F] focus:border-[#0C1F3F] focus:outline-none"
                                    >
                                      {venues.map((v) => (
                                        <option key={v.id} value={v.id}>{v.name}</option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Date */}
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-gray-500">Date</label>
                                    <input
                                      type="date"
                                      value={form.date}
                                      onChange={(e) => updateMoveForm(g.id, { date: e.target.value })}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#0C1F3F] focus:border-[#0C1F3F] focus:outline-none"
                                    />
                                  </div>

                                  {/* Time */}
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-gray-500">Time</label>
                                    <input
                                      type="time"
                                      value={form.time}
                                      onChange={(e) => updateMoveForm(g.id, { time: e.target.value })}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#0C1F3F] focus:border-[#0C1F3F] focus:outline-none"
                                    />
                                  </div>
                                </div>

                                {/* Conflict block + override-reason flow (mirrors Add Game) */}
                                {(moveConflicts[g.id]?.length ?? 0) > 0 && (
                                  <div className="mt-3 flex flex-col gap-2">
                                    {moveConflicts[g.id]!.map((c, ci) => (
                                      <div
                                        key={`${c.type}-${ci}`}
                                        className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5"
                                      >
                                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                                        <div className="flex flex-col gap-0.5 text-xs">
                                          <p className="font-semibold text-red-600">
                                            {CONFLICT_TYPE_LABELS[c.type]}
                                          </p>
                                          <p className="text-red-600">{c.message}</p>
                                        </div>
                                      </div>
                                    ))}
                                    {!moveOverrideOpen[g.id] ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setMoveOverrideOpen((p) => ({ ...p, [g.id]: true }))
                                        }
                                        className="inline-flex w-fit items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                                      >
                                        Override — add reason
                                      </button>
                                    ) : (
                                      <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-medium text-gray-600">
                                          Override reason
                                        </label>
                                        <textarea
                                          rows={2}
                                          required
                                          autoFocus
                                          value={moveReasons[g.id] ?? ""}
                                          onChange={(e) =>
                                            setMoveReasons((p) => ({ ...p, [g.id]: e.target.value }))
                                          }
                                          placeholder="Why is this conflict acceptable?"
                                          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                                        />
                                        <p className="text-xs text-gray-400">
                                          This reason will be visible to all admins in the game detail.
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="mt-3 flex items-center gap-2">
                                  <button
                                    onClick={() => saveManualMove(g.id)}
                                    disabled={
                                      isSavingGame ||
                                      ((moveConflicts[g.id]?.length ?? 0) > 0 &&
                                        !(moveReasons[g.id] ?? "").trim())
                                    }
                                    className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                      (moveConflicts[g.id]?.length ?? 0) > 0
                                        ? "bg-amber-500 hover:bg-amber-600"
                                        : "bg-[#0C1F3F] hover:bg-[#0C1F3F]/80"
                                    }`}
                                  >
                                    {isSavingGame && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    {(moveConflicts[g.id]?.length ?? 0) > 0
                                      ? "Save with override"
                                      : "Save change"}
                                  </button>
                                  <button
                                    onClick={() => setExpandedGame(null)}
                                    className="text-sm text-gray-400 hover:text-gray-600"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Auto-resolve this conflict */}
                    <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                      <p className="text-xs text-gray-400">
                        Or let the scheduler find a free slot automatically
                      </p>
                      <button
                        onClick={() => autoResolveConflict(conflict)}
                        disabled={!canAutoResolve || !!isResolvingThis}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0C1F3F] transition-colors hover:border-[#0C1F3F] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isResolvingThis ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Zap className="h-3.5 w-3.5" />
                        )}
                        Auto-resolve
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Error message */}
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer — auto-resolve all ────────────────────────────────────── */}
        {!loading && conflicts.length > 0 && (
          <div className="border-t border-gray-100 px-6 py-4">
            <button
              onClick={autoResolveAll}
              disabled={!canAutoResolve || autoResolvingAll}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0C1F3F] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {autoResolvingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Auto-resolve all {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""}
            </button>
            {!canAutoResolve && (
              <p className="mt-2 text-center text-xs text-gray-400">
                Auto-resolve requires division dates and settings to be configured.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
