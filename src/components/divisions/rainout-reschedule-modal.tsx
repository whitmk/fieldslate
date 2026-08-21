"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, CloudRain, CalendarDays, Loader2, CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { logActivity } from "@/lib/activity-log";
import {
  DAY_KEYS,
  DAY_LABELS,
  dayKeyFromIsoDate,
  parseAvailability,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  constraintsFromRows,
  type TeamGameConstraintRow,
} from "@/lib/schedule/team-constraints";
import {
  buildSlotsAndDiagnostics,
  durationFromSettings,
  occupancyWindow,
  toMins,
  type DayDiagnostic,
  type DayDiagnostics,
  type OccupiedSpan,
  type SlotOption,
} from "@/lib/schedule/reschedule-slots";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

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

// Slot construction (the 15-minute grid + real-span occupancy test) lives in
// @/lib/schedule/reschedule-slots so the sim can drive the real function —
// this file is "use client" and imports the browser Supabase client at module
// scope. See that module's header for the model and why it diverges from the
// generator's lattice.

// ─── Component ─────────────────────────────────────────────────────────────────


// ── Empty-state explanation ───────────────────────────────────────────────────
//
// Diagnostics arrive PER DATE, which is the honest granularity — a blackout or a
// team cap belongs to one date. But a season holds ~10 Sundays that all fail for
// the identical reason, and ten identical rows is noise, so the rendering rolls
// them up by DAY OF WEEK. A weekday appears only when EVERY one of its dates in
// range produced nothing; the reason shown is the one that occurred most often.
type DaySummary = {
  day: DayKey;
  diagnostic: DayDiagnostic;
  dateCount: number;
};

function summarizeByWeekday(
  diagnostics: DayDiagnostics,
  slots: SlotOption[],
): DaySummary[] {
  const datesWithSlots = new Set(slots.map((s) => s.date));
  const byDay = new Map<DayKey, DayDiagnostic[]>();
  const dayHasSlots = new Set<DayKey>();

  for (const date of datesWithSlots) dayHasSlots.add(dayKeyFromIsoDate(date));
  for (const [date, d] of diagnostics) {
    const day = dayKeyFromIsoDate(date);
    const list = byDay.get(day);
    if (list) list.push(d);
    else byDay.set(day, [d]);
  }

  const out: DaySummary[] = [];
  for (const day of DAY_KEYS) {
    // A weekday that produced ANY slot is not an empty day — say nothing.
    if (dayHasSlots.has(day)) continue;
    const list = byDay.get(day);
    if (!list || list.length === 0) continue;
    const counts = new Map<string, number>();
    for (const d of list) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
    let topKind = list[0].kind;
    let topN = 0;
    for (const [kind, n] of counts) {
      if (n > topN) { topN = n; topKind = kind as DayDiagnostic["kind"]; }
    }
    const representative = list.find((d) => d.kind === topKind) ?? list[0];
    out.push({ day, diagnostic: representative, dateCount: list.length });
  }
  return out;
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}


/** One weekday's explanation. Case (a) and (b) are actionable and link to the
 *  Venues page; case (c) is informational, quieter, and deliberately has NO
 *  link — nothing is misconfigured, the day is simply full. */
function DiagnosticRow({ summary }: { summary: DaySummary }) {
  const { day, diagnostic, dateCount } = summary;
  const label = DAY_LABELS[day];
  const dates = `${dateCount} ${dateCount === 1 ? "date" : "dates"}`;

  if (diagnostic.kind === "occupied") {
    // CASE (c). A field could have hosted the game; every candidate was taken.
    const mostlyTeams =
      diagnostic.teamRejections > diagnostic.venueBookingRejections;
    return (
      <div className="px-6 py-2.5">
        <p className="text-xs text-gray-400">
          <span className="font-medium text-gray-500">{label}</span> — no open
          time on {dates}.{" "}
          {mostlyTeams
            ? "These teams are already playing at the times the fields are free."
            : "The fields are open but already booked."}
        </p>
      </div>
    );
  }

  if (diagnostic.kind === "window_too_short") {
    // CASE (b). THE ONE THAT MATTERS MOST: the field IS open — sending the
    // admin to "add hours" here would be a confidently wrong instruction.
    const named = diagnostic.venues
      .map((v) => `${v.venueName} is open ${fmt12(v.start)}–${fmt12(v.end)}`)
      .join("; ");
    return (
      <div className="px-6 py-2.5">
        <p className="text-xs text-amber-700">
          <span className="font-medium">{label}</span> — {named}, which
          isn&rsquo;t long enough for this game.
        </p>
        <Link
          href="/dashboard/venues"
          className="text-xs text-[#22C55E] underline underline-offset-2"
        >
          Widen the hours on the Venues page
        </Link>
      </div>
    );
  }

  if (diagnostic.kind === "blackout") {
    return (
      <div className="px-6 py-2.5">
        <p className="text-xs text-gray-400">
          <span className="font-medium text-gray-500">{label}</span> — blacked
          out ({dates}).
        </p>
      </div>
    );
  }

  if (diagnostic.kind === "team_cap") {
    return (
      <div className="px-6 py-2.5">
        <p className="text-xs text-gray-400">
          <span className="font-medium text-gray-500">{label}</span> — one of
          these teams already has a game that day ({dates}).
        </p>
      </div>
    );
  }

  // CASE (a). Nothing open and flagged for makeups that day.
  return (
    <div className="px-6 py-2.5">
      <p className="text-xs text-amber-700">
        <span className="font-medium">{label}</span> — no field is open and
        marked for makeups.
      </p>
      <Link
        href="/dashboard/venues"
        className="text-xs text-[#22C55E] underline underline-offset-2"
      >
        Mark a field &ldquo;Makeup&rdquo; on the Venues page
      </Link>
    </div>
  );
}

export function RainoutRescheduleModal({
  gameId, homeTeamId, awayTeamId, homeTeamName, awayTeamName,
  divisionId, leagueId, onClose, onRescheduled, buildLogMessage,
}: Props) {
  const router = useRouter();
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [diagnostics, setDiagnostics] = useState<DayDiagnostics>(new Map());

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

    // 4a. All games at these venues (for venue conflict detection), excluding
    // the cancelled game. Each row carries its OWN division's settings so its
    // real span can be computed — an existing Majors game is 120 minutes long
    // whether or not the division being placed is 105. Embedding the division
    // via home_team mirrors the umpire booking feed's shape; `games` always
    // stores our team as home_team_id (interleague `is_away` rows carry a null
    // venue_id and so never appear in this venue-keyed read).
    // Bounded to the division's own date window — the only dates the slot
    // builder ever consults. NOT scoped by league: a concurrent season's game
    // at the same field on the same date genuinely occupies it, so a
    // league filter here would hide real occupancy. See occupancyWindow's
    // header for why the upper bound rolls to the following day.
    const win = occupancyWindow(div.start_date, div.end_date);

    type OccupancyRow = {
      scheduled_at: string;
      home_team: { division: { settings: unknown } | null } | null;
    };

    // PAGINATED + FAIL-LOUD. This read is load-bearing for correctness now that
    // occupancy is tested by real span: a row lost to PostgREST's silent
    // 1000-row cap is a game the picker cannot see, so it would offer a slot
    // directly on top of it. fetchAllRows returns every row or throws — it
    // never returns a short array. The `.order("id")` tiebreak is REQUIRED:
    // range paging over a non-unique sort key drops rows at page boundaries,
    // and games tie on scheduled_at constantly.
    let venueGamesRaw: (OccupancyRow & { venue_id: string })[];
    try {
      venueGamesRaw = await fetchAllRows<OccupancyRow & { venue_id: string }>(
        "existing games at these venues",
        ({ from, to, exactCount }) =>
          supabase
            .from("games")
            .select(
              "venue_id, scheduled_at, home_team:teams!home_team_id(division:divisions(settings))",
              exactCount ? { count: "exact" } : undefined,
            )
            .in("venue_id", venueIds)
            .neq("id", gameId)
            .neq("status", "cancelled")
            .gte("scheduled_at", win.fromIso)
            .lt("scheduled_at", win.toIsoExclusive)
            .order("scheduled_at")
            .order("id")
            .range(from, to) as unknown as PromiseLike<{
            data: (OccupancyRow & { venue_id: string })[] | null;
            error: { message: string } | null;
            count?: number | null;
          }>,
      );
    } catch {
      // Fail CLOSED: without a COMPLETE occupancy set we would offer slots on
      // top of real games. A partial list is worse than no list.
      setLoadError("Couldn't load existing games for these venues. Try again.");
      setLoading(false);
      return;
    }

    const venueBookings = new Map<string, OccupiedSpan[]>();
    for (const g of venueGamesRaw) {
      const date = g.scheduled_at.substring(0, 10);
      const vKey = `${g.venue_id}:${date}`;
      const span: OccupiedSpan = {
        startMin: toMins(g.scheduled_at.substring(11, 16)),
        durationMin: durationFromSettings(g.home_team?.division?.settings),
      };
      if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
      venueBookings.get(vKey)!.push(span);
    }

    // 4b. All games for both teams (to check team availability), excluding the
    // cancelled game. Durations come along for the same reason as 4a: team
    // occupancy is now tested by real span, so on a 15-minute grid a team's
    // 10:00 game correctly blocks 10:15. The old exact-timestamp check only
    // blocked 10:00 — safe under the coarse lattice, unsafe on a fine grid.
    const { data: teamGamesRaw, error: teamGamesErr } = await supabase
      .from("games")
      .select(
        "home_team_id, away_team_id, scheduled_at, home_team:teams!home_team_id(division:divisions(settings))",
      )
      .or(
        `home_team_id.eq.${homeTeamId},away_team_id.eq.${homeTeamId},` +
        `home_team_id.eq.${awayTeamId},away_team_id.eq.${awayTeamId}`,
      )
      .neq("id", gameId)
      .neq("status", "cancelled")
      // Same date window as the venue read. Left unpaginated deliberately: a
      // `teams` row belongs to exactly one season, so this is bounded by
      // games-per-team (max 22 observed either side, ~44 for the pair) and
      // cannot approach the 1000-row cap.
      .gte("scheduled_at", win.fromIso)
      .lt("scheduled_at", win.toIsoExclusive);

    if (teamGamesErr) {
      setLoadError("Couldn't load existing games for these teams. Try again.");
      setLoading(false);
      return;
    }

    const homeTeamSpans = new Map<string, OccupiedSpan[]>();
    const awayTeamSpans = new Map<string, OccupiedSpan[]>();
    const homeTeamDayCounts = new Map<string, number>();
    const awayTeamDayCounts = new Map<string, number>();

    const pushSpan = (m: Map<string, OccupiedSpan[]>, date: string, s: OccupiedSpan) => {
      if (!m.has(date)) m.set(date, []);
      m.get(date)!.push(s);
    };

    for (const g of (teamGamesRaw ?? []) as unknown as (OccupancyRow & {
      home_team_id: string;
      away_team_id: string;
    })[]) {
      const date = g.scheduled_at.substring(0, 10);
      const span: OccupiedSpan = {
        startMin: toMins(g.scheduled_at.substring(11, 16)),
        durationMin: durationFromSettings(g.home_team?.division?.settings),
      };
      const playsHome = g.home_team_id === homeTeamId || g.away_team_id === homeTeamId;
      const playsAway = g.home_team_id === awayTeamId || g.away_team_id === awayTeamId;
      if (playsHome) {
        pushSpan(homeTeamSpans, date, span);
        homeTeamDayCounts.set(date, (homeTeamDayCounts.get(date) ?? 0) + 1);
      }
      if (playsAway) {
        pushSpan(awayTeamSpans, date, span);
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

    const { slots: available, diagnostics: dayDiagnostics } = buildSlotsAndDiagnostics({
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
      homeTeamSpans,
      awayTeamSpans,
      homeTeamDayCounts,
      awayTeamDayCounts,
      homeTeamId,
      awayTeamId,
      constraintRules,
    });

    setSlots(available);
    setDiagnostics(dayDiagnostics);
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
  const daySummaries = summarizeByWeekday(diagnostics, slots);
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
            /* Replaces a single global sentence that guessed at the cause and
               offered lever advice ("try adding venues or extending the season
               end date") for a picker that had no rejection tally behind it.
               Every line below is the reason recorded where it happened. */
            <div>
              <div className="flex flex-col items-center gap-2 px-6 pb-4 pt-10 text-center">
                <CalendarDays className="h-6 w-6 text-gray-200" />
                <p className="text-sm font-medium text-[#0C1F3F]">No open slots found</p>
                <p className="text-xs text-gray-400">Here&rsquo;s what closed each day.</p>
              </div>
              <div className="divide-y divide-gray-50 border-t border-gray-50">
                {daySummaries.map((sm) => (
                  <DiagnosticRow key={sm.day} summary={sm} />
                ))}
              </div>
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

              {/* Days that produced nothing still get their reason — a list
                  with Saturdays in it must still explain the empty Fridays. */}
              {daySummaries.length > 0 && (
                <div className="bg-gray-50/40">
                  <div className="px-6 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Other days
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {daySummaries.map((sm) => (
                      <DiagnosticRow key={sm.day} summary={sm} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
