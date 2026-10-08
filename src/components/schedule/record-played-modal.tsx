"use client";

// "Record where it was played" — the correction form. Every decision lives in
// src/lib/schedule/record-played.ts (read its header); the save is ONE call to
// record_game_played (0106), which re-checks everything, writes the game, keeps
// "Sent to parents", and writes the activity-log entry in the same transaction.
// This file only reads, renders and calls.
//
// RENDERED ONLY BY useRecordPlayed (use-record-played.tsx). Every entry point
// calls that hook; none renders this modal itself (sim:record-played [S1]).
//
// THE GUARD IS HERE, NOT ONLY IN THE ROUTER. When it opens, the modal reads the
// game fresh and refuses an interleague game, an ineligible status, or a game
// it cannot read — before any other read. At save, the database refuses the
// same things again, and a reply that doesn't confirm the game is reported as
// "Nothing was saved", never as success.
//
// NO LOCK CHECK, deliberately — a correction is allowed on a locked division.
// The played-date rule (today or earlier in the league's timezone, on or after
// the season start) is the fence, and the database enforces it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Info, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { todayInTimezone } from "@/lib/utils/org-today";
import { parseAvailability, type VenueAvailability } from "@/lib/venues/availability";
import { qualifiedVenueLabel, byQualifiedVenueLabel } from "@/lib/venues/venue-label";
import { durationFromSettings } from "@/lib/schedule/reschedule-slots";
import { parseManualDateTime } from "@/lib/schedule/manual-move";
import { bookingsFromRows, type UmpireBookingRow } from "@/lib/umpires/conflicts";
import { useDayOccupancy } from "@/components/divisions/use-day-occupancy";
import {
  DATE_HELP,
  ENTRY_LABEL,
  RECORD_PLAYED_RPC,
  STILL_SAVE,
  playedDateRefusal,
  recordPlayedArgs,
  recordPlayedConflicts,
  recordPlayedInfoLine,
  recordPlayedRefusal,
  recordPlayedSaveEnabled,
  recordPlayedSaveOutcome,
  type AssignedOfficial,
} from "@/lib/schedule/record-played";

type GameRow = {
  id: string;
  status: string;
  interleague_org_id: string | null;
  scheduled_at: string;
  venue_id: string | null;
  league_id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_team: { name: string; division: { name: string; settings: unknown } | null } | null;
  away_team: { name: string } | null;
  venue: { name: string; location: { name: string } | null } | null;
};

const GAME_SELECT =
  "id, status, interleague_org_id, scheduled_at, venue_id, league_id, home_team_id, away_team_id, " +
  "home_team:teams!home_team_id(name, division:divisions(name, settings)), " +
  "away_team:teams!away_team_id(name), " +
  "venue:venues(name, location:locations(name))";

type VenueRow = {
  id: string;
  name: string;
  availability: unknown;
  availability_configured: boolean | null;
  location: { name: string } | null;
};

type Venue = {
  id: string;
  label: string;
  availabilityConfigured: boolean;
  availability: VenueAvailability;
};

type OfficialRow = {
  umpire: { name: string; booking_rows: UmpireBookingRow[] } | null;
};

type Ctx = {
  game: GameRow;
  today: string;
  seasonStart: string | null;
  venues: Venue[];
  divisionName: string;
  playingDays: string[];
  durationMin: number;
  bufferMin: number;
  blackoutDates: Set<string>;
  officials: AssignedOfficial[];
};

const inputCls =
  "h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#0C1F3F] focus:outline-none focus:ring-2 focus:ring-[#0C1F3F]/15";

export function RecordPlayedModal({
  gameId,
  onClose,
  onSaved,
}: {
  gameId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [venueId, setVenueId] = useState("");
  const [reason, setReason] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoadError(null);
    setRefusal(null);
    const supabase = createClient();

    // THE GUARD: the game, fresh, before anything else.
    const { data: gameData, error: gameErr } = await supabase
      .from("games")
      .select(GAME_SELECT)
      .eq("id", gameId)
      .maybeSingle();
    const game = gameErr ? null : ((gameData as unknown as GameRow | null) ?? null);
    const refused = recordPlayedRefusal(game);
    if (refused || !game) {
      setRefusal(refused ?? recordPlayedRefusal(null));
      return;
    }

    const { data: leagueRow, error: leagueErr } = await supabase
      .from("leagues")
      .select("owner_id, start_date")
      .eq("id", game.league_id)
      .single();
    const league = leagueRow as { owner_id: string; start_date: string | null } | null;
    if (leagueErr || !league) {
      setLoadError("Couldn't load this season.");
      return;
    }

    const divisionSettings = (game.home_team?.division?.settings ?? {}) as Record<string, unknown>;
    const [profileQ, venuesQ, blackoutQ, officialsQ] = await Promise.all([
      // The league's timezone lives on the org owner's row (the Settings page
      // reads it the same way). "Today" is computed from it — never the
      // browser's date.
      supabase.from("profiles").select("timezone").eq("id", league.owner_id).maybeSingle(),
      supabase
        .from("venues")
        .select("id, name, availability, availability_configured, location:locations(name)")
        .eq("owner_id", league.owner_id),
      supabase.from("blackout_dates").select("date").eq("league_id", game.league_id),
      supabase
        .from("game_umpires")
        .select(
          `umpire:umpires(name,
             booking_rows:game_umpires(game:games(id, scheduled_at,
               home_team:teams!home_team_id(name, division:divisions(settings)),
               away_team:teams!away_team_id(name))))`,
        )
        .eq("game_id", gameId),
    ]);
    const tz = (profileQ.data as { timezone: string } | null)?.timezone;
    if (profileQ.error || !tz || venuesQ.error || blackoutQ.error) {
      setLoadError("Couldn't load the fields and your league's settings.");
      return;
    }
    let today: string;
    try {
      today = todayInTimezone(tz);
    } catch {
      setLoadError("Couldn't work out today's date in your league's timezone.");
      return;
    }

    const venues = ((venuesQ.data ?? []) as unknown as VenueRow[])
      .map((v) => ({
        id: v.id,
        name: v.name,
        location: v.location,
        label: qualifiedVenueLabel({ name: v.name, location: v.location }),
        availabilityConfigured: v.availability_configured === true,
        availability: parseAvailability(v.availability),
      }))
      .sort(byQualifiedVenueLabel)
      .map(({ id, label, availabilityConfigured, availability }) => ({
        id, label, availabilityConfigured, availability,
      }));

    // A failed officials read is a "couldn't check" notice, never all-clear.
    const officials: AssignedOfficial[] = officialsQ.error
      ? [{ name: "the assigned officials", bookings: null }]
      : ((officialsQ.data ?? []) as unknown as OfficialRow[])
          .filter((r) => r.umpire)
          .map((r) => ({ name: r.umpire!.name, bookings: bookingsFromRows(r.umpire!.booking_rows ?? []) }));

    const buffer = Number(divisionSettings.buffer_minutes);
    setCtx({
      game,
      today,
      seasonStart: league.start_date,
      venues,
      divisionName: game.home_team?.division?.name || "This division",
      // Same fallbacks as the manual form.
      playingDays: Array.isArray(divisionSettings.playing_days)
        ? (divisionSettings.playing_days as string[])
        : ["Sa", "Su"],
      durationMin: durationFromSettings(divisionSettings),
      bufferMin: Number.isFinite(buffer) && buffer >= 0 ? buffer : 15,
      blackoutDates: new Set(((blackoutQ.data ?? []) as { date: string }[]).map((b) => b.date)),
      officials,
    });
    // Default to the original date and field (the admin changes what moved).
    setDate(game.scheduled_at.substring(0, 10));
    setTime(game.scheduled_at.substring(11, 16));
    setVenueId(game.venue_id ?? "");
  }

  const when = useMemo(() => parseManualDateTime(date, time), [date, time]);
  const venue = ctx?.venues.find((v) => v.id === venueId) ?? null;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const dateRefusal =
    ctx && validDate ? playedDateRefusal(validDate, ctx.today, ctx.seasonStart) : null;

  const teams = ctx
    ? [
        { id: ctx.game.home_team_id, name: ctx.game.home_team?.name ?? "Home" },
        ...(ctx.game.away_team_id
          ? [{ id: ctx.game.away_team_id, name: ctx.game.away_team?.name ?? "Away" }]
          : []),
      ]
    : [];
  const { venueGames, teamGames } = useDayOccupancy({
    gameId,
    date: ctx ? validDate : null,
    venueId,
    teams,
  });

  const conflicts = useMemo(() => {
    if (!ctx || !when || !venue || venueGames === undefined || teamGames === undefined) return null;
    return recordPlayedConflicts({
      when,
      durationMin: ctx.durationMin,
      bufferMin: ctx.bufferMin,
      divisionName: ctx.divisionName,
      playingDays: ctx.playingDays,
      blackoutDates: ctx.blackoutDates,
      venue,
      venueGames,
      teamGames,
      gameId,
      officials: ctx.officials,
    });
  }, [ctx, when, venue, venueGames, teamGames, gameId]);

  async function handleSave() {
    if (!ctx || !when || !venue) return;
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    // Functions map in database.ts is kept empty on purpose (CLAUDE.md), so
    // the RPC is called untyped, like the other SECURITY DEFINER RPCs.
    const { data, error } = await supabase.rpc(
      RECORD_PLAYED_RPC as never,
      recordPlayedArgs({ gameId, when, venueId: venue.id, reason }) as never,
    );
    const outcome = recordPlayedSaveOutcome(data, error, gameId);
    setSaving(false);
    if (!outcome.ok) {
      setSaveError(outcome.message);
      return;
    }
    onSaved();
  }

  const title = ctx
    ? `${ctx.game.home_team?.name ?? "TBD"} vs ${ctx.game.away_team?.name ?? "TBD"}`
    : "";

  let body: ReactNode;
  if (refusal) {
    body = (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800">{refusal}</p>
      </div>
    );
  } else if (loadError) {
    body = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-400" />
        <p className="text-sm font-medium text-gray-700">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-10 text-sm text-[#0C1F3F] underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  } else if (!ctx) {
    body = (
      <div className="flex flex-col items-center gap-3 py-12">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  } else {
    const g = ctx.game;
    const was = [
      fmtGameDate(g.scheduled_at),
      fmtGameTime(g.scheduled_at),
      g.venue ? qualifiedVenueLabel(g.venue) : "No field",
    ].join(" · ");
    const missing: string[] = [];
    if (!validDate) missing.push("date");
    if (!when && validDate) missing.push("time (check AM/PM)");
    if (!venue) missing.push("field");

    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-lg bg-[#f4f5f0] px-3.5 py-3">
          <span className="text-xs font-medium text-gray-600">Was scheduled</span>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#14213d]">
            <span>{was}</span>
            {g.status === "cancelled" && (
              <span className="rounded-md bg-[#fde7c7] px-2 py-0.5 text-xs font-medium text-[#7a4205]">
                Rained out
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-gray-700">Date played</span>
              <input
                type="date"
                value={date}
                max={ctx.today}
                min={ctx.seasonStart ?? undefined}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-gray-700">Start time</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          {dateRefusal ? (
            <p role="alert" className="text-xs text-red-600">{dateRefusal}</p>
          ) : (
            <p className="text-xs text-gray-600">{DATE_HELP}</p>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-gray-700">Field</span>
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={inputCls}>
            <option value="">Choose a field…</option>
            {ctx.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-gray-700">Reason (optional)</span>
          <input
            type="text"
            value={reason}
            maxLength={500}
            placeholder="Coaches moved it to Monday after the rain"
            onChange={(e) => setReason(e.target.value)}
            className={inputCls}
          />
        </label>

        {/* Conflicts: the manual edit's sentences, notices only — never a gate. */}
        {when && venue && !dateRefusal && (
          conflicts === null ? (
            <p className="text-xs text-gray-500">Checking for conflicts…</p>
          ) : conflicts.length > 0 ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-[#f2c27a] bg-[#fff4e0] px-3.5 py-2.5 text-sm text-[#6b3a05]"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="flex flex-col gap-1">
                <ul className="flex flex-col gap-1">
                  {conflicts.map((c, i) => (
                    <li key={`${c.kind}:${i}`}>{c.text}</li>
                  ))}
                </ul>
                <p className="font-medium">{STILL_SAVE}</p>
              </div>
            </div>
          ) : null
        )}

        <div className="flex items-start gap-2 text-sm text-gray-700">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{recordPlayedInfoLine(g.status)}</span>
        </div>

        {saveError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <p className="text-sm text-red-600">{saveError}</p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2.5">
          {missing.length > 0 && (
            <span className="text-xs text-gray-500 sm:mr-auto">Still needed: {missing.join(", ")}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="hidden h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-[#0C1F3F] hover:bg-gray-50 disabled:opacity-50 sm:inline-flex sm:items-center"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={
              !recordPlayedSaveEnabled({ when, venueChosen: !!venue, dateRefusal, saving, conflicts })
            }
            className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg bg-[#0C1F3F] px-4 text-base font-medium text-white hover:bg-[#0C1F3F]/90 disabled:opacity-50 sm:h-11 sm:text-sm"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : "Save correction"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0C1F3F]/55 sm:items-center sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-played-title"
        className="flex max-h-[90dvh] w-full flex-col overflow-y-auto rounded-t-2xl bg-white px-[18px] pb-6 pt-5 shadow-2xl sm:max-w-[520px] sm:rounded-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="record-played-title" className="text-xl font-bold text-[#0C1F3F] sm:text-[22px]">
              {ENTRY_LABEL}
            </h2>
            {title && <p className="mt-0.5 truncate text-sm text-gray-600">{title}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
