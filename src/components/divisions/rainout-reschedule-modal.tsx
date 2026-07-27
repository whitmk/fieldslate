"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, CloudRain, CalendarDays, Loader2, CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { logActivity } from "@/lib/activity-log";
import {
  isVenueAvailable,
  parseAvailability,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  constraintsFromRows,
  violatesHardConstraint,
  type TeamConstraintRule,
  type TeamGameConstraintRow,
} from "@/lib/schedule/team-constraints";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  divisionId: string;
  leagueId: string;
  onClose: () => void;
  onRescheduled: () => void;
  /** Override the activity-log message. Receives the chosen slot; return the full message string. */
  buildLogMessage?: (p: { newScheduledAt: string; newVenueName: string }) => string;
}

interface SlotOption {
  isoString: string;   // "YYYY-MM-DDTHH:MM:SS"
  venueId: string;
  venueName: string;
  date: string;        // "YYYY-MM-DD"
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minsToHHMM(mins: number): string {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

const DAY_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};
const JS_TO_DAY: Record<number, string> = {
  0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa",
};

// ─── Slot builder ──────────────────────────────────────────────────────────────

function buildAvailableSlots(params: {
  startDate: string;
  endDate: string;
  playingDays: string[];
  dayWindows: Record<string, { start: string; end: string }>;
  earliestStart: string;
  latestStart: string;
  gameDuration: number;
  bufferMinutes: number;
  maxPerTeamDay: number;
  venueIds: string[];
  venueNames: Record<string, string>;
  venueAvailability: Record<string, VenueAvailability>;
  blackoutDates: Set<string>;
  // existing game bookings (excluding the cancelled game)
  venueBookings: Map<string, number[]>;    // "venueId:YYYY-MM-DD" → booked start mins
  homeTeamTimes: Set<string>;              // isoStrings when home team plays
  awayTeamTimes: Set<string>;             // isoStrings when away team plays
  homeTeamDayCounts: Map<string, number>; // "YYYY-MM-DD" → count
  awayTeamDayCounts: Map<string, number>; // "YYYY-MM-DD" → count
  // team_game_constraints (0076) for both teams. This surface is
  // pick-from-valid by design (no override path), so severity-'block' slots
  // are simply never offered. Both teams are always local here — the
  // reschedule action is gated on away_team_id being non-null.
  homeTeamId: string;
  awayTeamId: string;
  constraintRules: Map<string, TeamConstraintRule[]>;
}): SlotOption[] {
  const {
    startDate, endDate, playingDays, dayWindows,
    earliestStart, latestStart, gameDuration, bufferMinutes,
    maxPerTeamDay, venueIds, venueNames, venueAvailability, blackoutDates,
    venueBookings, homeTeamTimes, awayTeamTimes,
    homeTeamDayCounts, awayTeamDayCounts,
    homeTeamId, awayTeamId, constraintRules,
  } = params;

  const allowedDays = new Set(playingDays.map((d) => DAY_TO_JS[d]));
  const interval = Math.max(1, Number(gameDuration) + Number(bufferMinutes));
  const minGap = interval;
  const duration = Number(gameDuration);

  // Start from today (no point scheduling in the past)
  const today = localDateStr(new Date());
  const effectiveStart = startDate < today ? today : startDate;

  const slots: SlotOption[] = [];
  const cur = new Date(effectiveStart + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (cur <= end) {
    const date = localDateStr(cur);

    if (allowedDays.has(cur.getDay()) && !blackoutDates.has(date)) {
      const dayKey = JS_TO_DAY[cur.getDay()] as DayKey;
      const win = dayWindows[dayKey];
      const earliest = toMins(win?.start ?? earliestStart ?? "09:00");
      const latest   = toMins(win?.end   ?? latestStart  ?? "17:00");

      const homeDayCount = homeTeamDayCounts.get(date) ?? 0;
      const awayDayCount = awayTeamDayCounts.get(date) ?? 0;

      if (homeDayCount < maxPerTeamDay && awayDayCount < maxPerTeamDay) {
        for (let timeMin = earliest; timeMin <= latest; timeMin += interval) {
          const isoString = `${date}T${minsToHHMM(timeMin)}:00`;
          const wallTime = minsToHHMM(timeMin);

          // Both teams must be free at this exact datetime
          if (homeTeamTimes.has(isoString)) continue;
          if (awayTeamTimes.has(isoString)) continue;

          // Neither team may have a severity-'block' constraint window
          // covering this start time (0076).
          if (violatesHardConstraint(constraintRules, homeTeamId, isoString)) continue;
          if (violatesHardConstraint(constraintRules, awayTeamId, isoString)) continue;

          // Each venue: must be open (per venue.availability), within hours,
          // and free of existing bookings at this wall time.
          for (const venueId of venueIds) {
            const av = venueAvailability[venueId];
            if (!av) continue;
            if (!isVenueAvailable(av, dayKey, wallTime, duration)) continue;

            const vKey = `${venueId}:${date}`;
            const booked = venueBookings.get(vKey) ?? [];
            const conflict = booked.some((t) => Math.abs(t - timeMin) < minGap);
            if (!conflict) {
              slots.push({ isoString, venueId, venueName: venueNames[venueId] ?? venueId, date });
            }
          }
        }
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  // Chronological, then venue name
  slots.sort((a, b) => a.isoString.localeCompare(b.isoString) || a.venueName.localeCompare(b.venueName));
  return slots;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function RainoutRescheduleModal({
  gameId, homeTeamId, awayTeamId, homeTeamName, awayTeamName,
  divisionId, leagueId, onClose, onRescheduled, buildLogMessage,
}: Props) {
  const router = useRouter();
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SlotOption | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSlots() {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();

    // 1. Division settings + dates
    const { data: divRaw, error: divErr } = await supabase
      .from("divisions")
      .select("start_date, end_date, settings")
      .eq("id", divisionId)
      .single();

    if (divErr || !divRaw) {
      setLoadError("Could not load division settings.");
      setLoading(false);
      return;
    }

    const div = divRaw as { start_date: string; end_date: string; settings: Record<string, unknown> };
    if (!div.start_date || !div.end_date) {
      setLoadError("Division is missing start or end date.");
      setLoading(false);
      return;
    }

    const s = div.settings ?? {};
    const playingDays = (Array.isArray(s.playing_days) ? s.playing_days : ["Sa", "Su"]) as string[];
    const dayWindows = (typeof s.day_windows === "object" && s.day_windows
      ? s.day_windows
      : {}) as Record<string, { start: string; end: string }>;
    const earliestStart = (s.earliest_start as string | undefined) ?? "09:00";
    const latestStart   = (s.latest_start   as string | undefined) ?? "17:00";
    const gameDuration  = Number(s.game_duration  ?? 90);
    const bufferMinutes = Number(s.buffer_minutes ?? 15);
    const maxPerTeamDay = Math.max(1, Number(s.max_games_per_team_per_day ?? 1));

    // 2. Division venues — only configured ones; engine validates hours below.
    const { data: dvRows } = await supabase
      .from("division_venues")
      .select(
        "venue_id, venue:venues!inner(name, availability, availability_configured, location:locations(name))",
      )
      .eq("division_id", divisionId)
      .eq("venue.availability_configured", true);

    type DVRow = {
      venue_id: string;
      venue: {
        name: string;
        availability: unknown;
        availability_configured: boolean;
        location: { name: string } | null;
      } | null;
    };
    const venueRows = (dvRows ?? []) as unknown as DVRow[];
    const venueIds = venueRows.map((r) => r.venue_id);
    // Slots are chosen here (rainout closes a PARK), so the venue is shown as
    // the qualified "Complex — Field" label. Slot ORDER is time-based and left
    // untouched; the venue is an attribute of each slot, not the option key.
    const venueNames: Record<string, string> = {};
    const venueAvailability: Record<string, unknown> = {};
    for (const r of venueRows) {
      venueNames[r.venue_id] = r.venue
        ? qualifiedVenueLabel({ name: r.venue.name, location: r.venue.location })
        : r.venue_id;
      venueAvailability[r.venue_id] = r.venue?.availability ?? {};
    }

    if (!venueIds.length) {
      setLoadError(
        "No venues with availability set. Configure venue hours first.",
      );
      setLoading(false);
      return;
    }

    // 3. Blackout dates
    const { data: blackoutRaw } = await supabase
      .from("blackout_dates")
      .select("date")
      .eq("league_id", leagueId);
    const blackoutDates = new Set(((blackoutRaw ?? []) as { date: string }[]).map((b) => b.date));

    // 4a. All games at these venues (for venue conflict detection), excluding the cancelled game
    const { data: venueGamesRaw } = await supabase
      .from("games")
      .select("venue_id, scheduled_at")
      .in("venue_id", venueIds)
      .neq("id", gameId)
      .neq("status", "cancelled");

    const venueBookings = new Map<string, number[]>();
    for (const g of (venueGamesRaw ?? []) as { venue_id: string; scheduled_at: string }[]) {
      const date = g.scheduled_at.substring(0, 10);
      const vKey = `${g.venue_id}:${date}`;
      const mins = toMins(g.scheduled_at.substring(11, 16));
      if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
      venueBookings.get(vKey)!.push(mins);
    }

    // 4b. All games for both teams (to check team availability), excluding the cancelled game
    const { data: teamGamesRaw } = await supabase
      .from("games")
      .select("home_team_id, away_team_id, scheduled_at")
      .or(
        `home_team_id.eq.${homeTeamId},away_team_id.eq.${homeTeamId},` +
        `home_team_id.eq.${awayTeamId},away_team_id.eq.${awayTeamId}`,
      )
      .neq("id", gameId)
      .neq("status", "cancelled");

    const homeTeamTimes = new Set<string>();
    const awayTeamTimes = new Set<string>();
    const homeTeamDayCounts = new Map<string, number>();
    const awayTeamDayCounts = new Map<string, number>();

    for (const g of (teamGamesRaw ?? []) as { home_team_id: string; away_team_id: string; scheduled_at: string }[]) {
      const iso = g.scheduled_at.substring(0, 19);
      const date = g.scheduled_at.substring(0, 10);
      const playsHome = g.home_team_id === homeTeamId || g.away_team_id === homeTeamId;
      const playsAway = g.home_team_id === awayTeamId || g.away_team_id === awayTeamId;
      if (playsHome) {
        homeTeamTimes.add(iso);
        homeTeamDayCounts.set(date, (homeTeamDayCounts.get(date) ?? 0) + 1);
      }
      if (playsAway) {
        awayTeamTimes.add(iso);
        awayTeamDayCounts.set(date, (awayTeamDayCounts.get(date) ?? 0) + 1);
      }
    }

    const venueAvailabilityParsed: Record<string, VenueAvailability> = {};
    for (const vid of venueIds) {
      venueAvailabilityParsed[vid] = parseAvailability(venueAvailability[vid]);
    }

    // 4c. Team game constraints (0076) for both teams. Fail CLOSED on a read
    // error — offering slots without the rules could reschedule a game into
    // a promised hard-block window.
    const { data: rulesRaw, error: rulesErr } = await supabase
      .from("team_game_constraints")
      .select("team_id, day_of_week, start_time, end_time, severity")
      .in("team_id", [homeTeamId, awayTeamId]);
    if (rulesErr) {
      setLoadError("Couldn't load team scheduling constraints. Try again.");
      setLoading(false);
      return;
    }
    const constraintRules = constraintsFromRows(
      (rulesRaw ?? []) as TeamGameConstraintRow[],
    );

    const available = buildAvailableSlots({
      startDate: div.start_date,
      endDate: div.end_date,
      playingDays,
      dayWindows,
      earliestStart,
      latestStart,
      gameDuration,
      bufferMinutes,
      maxPerTeamDay,
      venueIds,
      venueNames,
      venueAvailability: venueAvailabilityParsed,
      blackoutDates,
      venueBookings,
      homeTeamTimes,
      awayTeamTimes,
      homeTeamDayCounts,
      awayTeamDayCounts,
      homeTeamId,
      awayTeamId,
      constraintRules,
    });

    setSlots(available);
    setLoading(false);
  }

  async function handleConfirm() {
    if (!picked) return;
    setConfirming(true);
    setConfirmError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("games")
      .update({
        scheduled_at: picked.isoString,
        venue_id: picked.venueId,
        status: "scheduled",
      } as never)
      .eq("id", gameId);

    if (error) {
      setConfirmError(error.message);
      setConfirming(false);
      return;
    }
    const logMsg = buildLogMessage
      ? buildLogMessage({ newScheduledAt: picked.isoString, newVenueName: picked.venueName })
      : `${homeTeamName} vs ${awayTeamName} rescheduled to ${fmtGameDate(picked.isoString)} at ${fmtGameTime(picked.isoString)} — ${picked.venueName}`;
    console.log("[logActivity] before call: game_rescheduled (rainout-reschedule-modal)", { leagueId, divisionId });
    const _r = await logActivity(leagueId, divisionId, "game_rescheduled", logMsg);
    console.log("[logActivity] result (rainout-reschedule-modal):", _r);
    router.refresh();
    setDone(true);
    setConfirming(false);
  }

  // Group slots by date for display
  const grouped = new Map<string, SlotOption[]>();
  for (const s of slots) {
    if (!grouped.has(s.date)) grouped.set(s.date, []);
    grouped.get(s.date)!.push(s);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[85dvh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <CloudRain className="h-4 w-4 text-blue-400" />
              <h2 className="font-semibold text-[#0C1F3F]">Reschedule game</h2>
            </div>
            <p className="mt-0.5 text-sm text-gray-500">
              {homeTeamName} vs {awayTeamName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {done ? (
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#22C55E]/10">
                <CheckCircle2 className="h-6 w-6 text-[#22C55E]" />
              </div>
              <div>
                <p className="font-semibold text-[#0C1F3F]">Game rescheduled</p>
                <p className="mt-1 text-sm text-gray-500">
                  {homeTeamName} vs {awayTeamName}
                  <br />
                  {picked && `${fmtGameDate(picked.isoString)} at ${fmtGameTime(picked.isoString)} — ${picked.venueName}`}
                </p>
              </div>
              <button
                onClick={() => { onRescheduled(); onClose(); }}
                className="mt-2 rounded-lg bg-[#0C1F3F] px-6 py-2 text-sm font-semibold text-white hover:bg-[#0C1F3F]/80"
              >
                Done
              </button>
            </div>
          ) : picked ? (
            /* Confirmation view */
            <div className="flex flex-col gap-5 px-6 py-6">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">New date &amp; time</p>
                <p className="mt-2 text-base font-semibold text-[#0C1F3F]">
                  {fmtGameDate(picked.isoString)} at {fmtGameTime(picked.isoString)}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">{picked.venueName}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Matchup</p>
                <p className="mt-2 text-sm font-semibold text-[#0C1F3F]">
                  {homeTeamName} <span className="font-normal text-gray-400">vs</span> {awayTeamName}
                </p>
              </div>
              {confirmError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                  <p className="text-sm text-red-600">{confirmError}</p>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setPicked(null); setConfirmError(null); }}
                  disabled={confirming}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#22C55E] py-2.5 text-sm font-semibold text-white hover:bg-[#16a34a] disabled:opacity-60"
                >
                  {confirming ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                  ) : (
                    "Confirm reschedule"
                  )}
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              <p className="text-sm text-gray-400">Finding available slots…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <p className="text-sm font-medium text-gray-700">{loadError}</p>
              <button
                onClick={() => void loadSlots()}
                className="text-sm text-[#22C55E] underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : slots.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <CalendarDays className="h-6 w-6 text-gray-200" />
              <p className="text-sm font-medium text-[#0C1F3F]">No open slots found</p>
              <p className="text-xs text-gray-400">
                All remaining dates are fully booked, blacked out, or outside the season window.
                Try adding venues or extending the season end date.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {/* Slot count header */}
              <div className="px-6 py-3">
                <p className="text-xs text-gray-400">
                  {slots.length} open slot{slots.length !== 1 ? "s" : ""} — pick one to reschedule
                </p>
              </div>

              {/* Grouped by date */}
              {Array.from(grouped.entries()).map(([date, daySlots]) => (
                <div key={date}>
                  <div className="bg-gray-50/70 px-6 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {fmtGameDate(date)}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {daySlots.map((slot) => (
                      <button
                        key={`${slot.isoString}:${slot.venueId}`}
                        onClick={() => setPicked(slot)}
                        className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-16 flex-shrink-0 text-sm tabular-nums text-gray-500">
                            {fmtGameTime(slot.isoString)}
                          </span>
                          <span className="text-sm font-medium text-[#0C1F3F]">{slot.venueName}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
