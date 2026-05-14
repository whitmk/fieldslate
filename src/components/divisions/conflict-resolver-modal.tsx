"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X, AlertTriangle, Loader2, CheckCircle2, ChevronDown, Zap, MapPin, Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectScheduleConflicts, type ScheduleConflict } from "@/lib/schedule/generate-schedule";
import { fmtGameDate } from "@/lib/utils/game-time";
import { logActivity } from "@/lib/activity-log";

// ─── Types ────────────────────────────────────────────────────────────────────

type GameRow = {
  id: string;
  scheduled_at: string;
  venue_id: string | null;
  home_team_id: string;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  venue: { id: string; name: string } | null;
};

type Venue = { id: string; name: string };

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
 */
function findFreeSlot(
  excludeGameId: string,
  allVenueGames: GameRow[],
  venueIds: string[],
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
      for (const venueId of venueIds) {
        const occ = occupied.get(`${venueId}:${date}`) ?? [];
        let t = earliest;
        while (t <= latest) {
          if (occ.every((o) => Math.abs(o - t) >= gap)) {
            return { scheduledAt: `${date}T${hhmmFromMins(t)}:00`, venueId };
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
      supabase.from("venues").select("id, name").in("id", venueIds),
      supabase
        .from("games")
        .select(`
          id, scheduled_at, venue_id, home_team_id,
          home_team:teams!home_team_id(name),
          away_team:teams!away_team_id(name),
          venue:venues(id, name)
        `)
        .in("venue_id", venueIds)
        .order("scheduled_at"),
    ]);

    const rows = (gamesRes.data ?? []) as unknown as GameRow[];
    setAllVenueGames(rows);
    setVenues((venueRes.data ?? []) as Venue[]);

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
    setExpandedGame(gameId);
  }

  async function saveManualMove(gameId: string) {
    const form = moveForms[gameId];
    if (!form) return;
    setSaving((p) => ({ ...p, [gameId]: true }));
    setError(null);

    const { error: err } = await patchGame(gameId, {
      scheduled_at: `${form.date}T${form.time}:00`,
      venue_id: form.venueId,
    });

    setSaving((p) => ({ ...p, [gameId]: false }));
    if (err) { setError(err.message); return; }

    const game = allVenueGames.find((g) => g.id === gameId);
    const homeTeam = (game?.home_team as { name: string } | null)?.name ?? "Home";
    const awayTeam = (game?.away_team as { name: string } | null)?.name ?? "Away";
    await logActivity(leagueId, divisionId, "game_conflict_resolved",
      `${homeTeam} vs ${awayTeam} moved to ${form.date} at ${form.time} — double-booking resolved`);

    setExpandedGame(null);
    await load();
    onResolved();
  }

  async function autoResolveConflict(conflict: ScheduleConflict) {
    if (!settings || !dateRange) return;
    const key = conflict.venueId + conflict.date;
    setResolving((p) => ({ ...p, [key]: true }));
    setError(null);

    const venueIds = venues.map((v) => v.id);
    // Keep the first game; move the rest (prefer moving non-division games last)
    const gamesToMove = conflict.games.slice(1);
    let localGames = [...allVenueGames];

    for (const g of gamesToMove) {
      const slot = findFreeSlot(g.id, localGames, venueIds, settings, dateRange.start, dateRange.end);
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
    await logActivity(leagueId, divisionId, "game_conflict_resolved",
      `${movedCount} game${movedCount !== 1 ? "s" : ""} at ${conflict.venueName} moved — double-booking resolved`);

    setResolving((p) => ({ ...p, [key]: false }));
    await load();
    onResolved();
  }

  async function autoResolveAll() {
    if (!settings || !dateRange) return;
    setAutoResolvingAll(true);
    setError(null);

    const venueIds = venues.map((v) => v.id);
    let localGames = [...allVenueGames];

    for (const conflict of conflicts) {
      const gamesToMove = conflict.games.slice(1);
      for (const g of gamesToMove) {
        const slot = findFreeSlot(g.id, localGames, venueIds, settings, dateRange.start, dateRange.end);
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
    await logActivity(leagueId, divisionId, "game_conflict_resolved",
      `${totalMoved} game${totalMoved !== 1 ? "s" : ""} auto-resolved — all double-bookings cleared`);

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
                                      onChange={(e) =>
                                        setMoveForms((p) => ({
                                          ...p,
                                          [g.id]: { ...p[g.id], venueId: e.target.value },
                                        }))
                                      }
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
                                      onChange={(e) =>
                                        setMoveForms((p) => ({
                                          ...p,
                                          [g.id]: { ...p[g.id], date: e.target.value },
                                        }))
                                      }
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#0C1F3F] focus:border-[#0C1F3F] focus:outline-none"
                                    />
                                  </div>

                                  {/* Time */}
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-gray-500">Time</label>
                                    <input
                                      type="time"
                                      value={form.time}
                                      onChange={(e) =>
                                        setMoveForms((p) => ({
                                          ...p,
                                          [g.id]: { ...p[g.id], time: e.target.value },
                                        }))
                                      }
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#0C1F3F] focus:border-[#0C1F3F] focus:outline-none"
                                    />
                                  </div>
                                </div>

                                <div className="mt-3 flex items-center gap-2">
                                  <button
                                    onClick={() => saveManualMove(g.id)}
                                    disabled={isSavingGame}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:opacity-50"
                                  >
                                    {isSavingGame && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    Save change
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
