"use client";

// "Enter a time manually" — the move picker's escape hatch. Any date, any
// time, any venue in the org; conflicts are NOTICES, never gates. All the
// decisions live in src/lib/schedule/manual-move.ts (read its header — the
// divergence from Add Game's blocking override is deliberate). This file only
// reads, renders, and saves.
//
// Rendered ONLY by RainoutRescheduleModal's move variant
// (`manualEntryAvailable`) — that variant check is the interleague guard.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { parseAvailability, type VenueAvailability } from "@/lib/venues/availability";
import { qualifiedVenueLabel, byQualifiedVenueLabel } from "@/lib/venues/venue-label";
import {
  durationFromSettings,
  occupancyWindow,
  toMins,
} from "@/lib/schedule/reschedule-slots";
import {
  fetchDivisionLocks,
  formatLockError,
  isDivisionLockError,
} from "@/lib/schedule/division-lock";
import {
  manualMoveConflicts,
  manualSaveEnabled,
  manualSaveLockRefusal,
  parseManualDateTime,
  type LockRead,
  type ManualBookedGame,
  type ManualTeamGame,
} from "@/lib/schedule/manual-move";

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

type Ctx = {
  venues: Venue[];
  divisionName: string;
  playingDays: string[];
  durationMin: number;
  bufferMin: number;
  blackoutDates: Set<string>;
};

type DayGameRow = {
  id: string;
  scheduled_at: string;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string | null;
  external_team_name: string | null;
  home_team: { name: string; division: { name: string; settings: unknown } | null } | null;
  away_team: { name: string } | null;
  interleague_org: { name: string } | null;
  venue: { name: string } | null;
};

const DAY_GAME_SELECT =
  "id, scheduled_at, venue_id, home_team_id, away_team_id, external_team_name, " +
  "home_team:teams!home_team_id(name, division:divisions(name, settings)), " +
  "away_team:teams!away_team_id(name), " +
  "interleague_org:interleague_orgs!interleague_org_id(name), " +
  "venue:venues(name)";

function opponentOf(g: DayGameRow): string {
  return (
    g.away_team?.name ??
    g.external_team_name ??
    g.interleague_org?.name ??
    "TBD"
  );
}

function spanOf(g: DayGameRow) {
  return {
    startMin: toMins(g.scheduled_at.substring(11, 16)),
    durationMin: durationFromSettings(g.home_team?.division?.settings),
  };
}

const inputCls =
  "h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";

export function ManualMoveForm({
  gameId,
  divisionId,
  leagueId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  initialScheduledAt,
  initialVenueId,
  onBack,
  onSaved,
}: {
  gameId: string;
  divisionId: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  /** The game's current time/field, to prefill. Optional. */
  initialScheduledAt?: string;
  initialVenueId?: string | null;
  onBack: () => void;
  onSaved: (saved: { isoString: string; venueName: string }) => void;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [date, setDate] = useState(initialScheduledAt?.substring(0, 10) ?? "");
  const [time, setTime] = useState(initialScheduledAt?.substring(11, 16) ?? "");
  const [venueId, setVenueId] = useState(initialVenueId ?? "");

  // Games on the chosen date — null = that read FAILED (reported, not hidden);
  // undefined = not loaded yet for this (date, venue).
  const [venueGames, setVenueGames] = useState<ManualBookedGame[] | null | undefined>(undefined);
  const [teamGames, setTeamGames] = useState<ManualTeamGame[] | null | undefined>(undefined);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void loadCtx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCtx() {
    setLoadError(null);
    const supabase = createClient();
    // Venues are org-scoped — resolve the org from the season, then list every
    // org venue (the same query Add Game uses). No division-attachment filter.
    const { data: leagueRow, error: leagueErr } = await supabase
      .from("leagues")
      .select("owner_id")
      .eq("id", leagueId)
      .single();
    const ownerId = (leagueRow as { owner_id: string } | null)?.owner_id;
    if (leagueErr || !ownerId) {
      setLoadError("Couldn't load this season's fields.");
      return;
    }
    const [venuesQ, divQ, blackoutQ] = await Promise.all([
      supabase
        .from("venues")
        .select("id, name, availability, availability_configured, location:locations(name)")
        .eq("owner_id", ownerId),
      supabase.from("divisions").select("name, settings").eq("id", divisionId).single(),
      supabase.from("blackout_dates").select("date").eq("league_id", leagueId),
    ]);
    if (venuesQ.error || divQ.error || blackoutQ.error || !divQ.data) {
      setLoadError("Couldn't load the fields and division settings.");
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
    const div = divQ.data as { name: string; settings: Record<string, unknown> | null };
    const s = div.settings ?? {};
    const buffer = Number(s.buffer_minutes);
    setCtx({
      venues,
      divisionName: div.name || "This division",
      // Same fallback as the picker's own read (rainout-reschedule-modal).
      playingDays: Array.isArray(s.playing_days) ? (s.playing_days as string[]) : ["Sa", "Su"],
      durationMin: durationFromSettings(s),
      // Same fallback the picker's occupancy uses for a missing buffer.
      bufferMin: Number.isFinite(buffer) && buffer >= 0 ? buffer : 15,
      blackoutDates: new Set(
        ((blackoutQ.data ?? []) as { date: string }[]).map((b) => b.date),
      ),
    });
  }

  const when = useMemo(() => parseManualDateTime(date, time), [date, time]);
  const venue = ctx?.venues.find((v) => v.id === venueId) ?? null;

  // Day reads depend on (date, venue) only — a time change recomputes locally.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  useEffect(() => {
    if (!validDate || !venueId) {
      setVenueGames(undefined);
      setTeamGames(undefined);
      return;
    }
    let stale = false;
    setVenueGames(undefined);
    setTeamGames(undefined);
    const supabase = createClient();
    // DATE-bounded, never league-bounded: another season's game at the same
    // field on the same date genuinely occupies it (see occupancyWindow).
    // One field on one day, and two teams on one day — bounded far below
    // PostgREST's 1000-row cap, so a plain read (with its error checked).
    const win = occupancyWindow(validDate, validDate);
    void Promise.all([
      supabase
        .from("games")
        .select(DAY_GAME_SELECT)
        .eq("venue_id", venueId)
        .neq("id", gameId)
        .neq("status", "cancelled")
        .gte("scheduled_at", win.fromIso)
        .lt("scheduled_at", win.toIsoExclusive),
      supabase
        .from("games")
        .select(DAY_GAME_SELECT)
        .or(
          `home_team_id.eq.${homeTeamId},away_team_id.eq.${homeTeamId},` +
            `home_team_id.eq.${awayTeamId},away_team_id.eq.${awayTeamId}`,
        )
        .neq("id", gameId)
        .neq("status", "cancelled")
        .gte("scheduled_at", win.fromIso)
        .lt("scheduled_at", win.toIsoExclusive),
    ]).then(([vq, tq]) => {
      if (stale) return;
      setVenueGames(
        vq.error
          ? null
          : ((vq.data ?? []) as unknown as DayGameRow[]).map((g) => ({
              ...spanOf(g),
              label: `${g.home_team?.division?.name ?? "Game"}: ${g.home_team?.name ?? "TBD"} vs ${opponentOf(g)}`,
            })),
      );
      setTeamGames(
        tq.error
          ? null
          : ((tq.data ?? []) as unknown as DayGameRow[]).flatMap((g) => {
              const ours = [homeTeamId, awayTeamId].filter(
                (id) => id === g.home_team_id || id === g.away_team_id,
              );
              return ours.map((id) => ({
                ...spanOf(g),
                teamName: id === homeTeamId ? homeTeamName : awayTeamName,
                label: `${g.home_team?.name ?? "TBD"} vs ${opponentOf(g)}${g.venue?.name ? ` at ${g.venue.name}` : ""}`,
              }));
            }),
      );
    });
    return () => {
      stale = true;
    };
  }, [validDate, venueId, gameId, homeTeamId, awayTeamId, homeTeamName, awayTeamName]);

  const conflicts = useMemo(() => {
    if (!ctx || !when || !venue || venueGames === undefined || teamGames === undefined) {
      return null;
    }
    return manualMoveConflicts({
      when,
      durationMin: ctx.durationMin,
      bufferMin: ctx.bufferMin,
      divisionName: ctx.divisionName,
      playingDays: ctx.playingDays,
      blackoutDates: ctx.blackoutDates,
      venue,
      venueGames,
      teamGames,
    });
  }, [ctx, when, venue, venueGames, teamGames]);

  async function handleSave() {
    if (!ctx || !when || !venue) return;
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();

    // Re-read the lock AT SAVE: it can be switched on while this form is open,
    // and the trigger permits these columns on a locked division.
    let read: LockRead;
    try {
      const locks = await fetchDivisionLocks(supabase, [divisionId]);
      read = { ok: true, locked: locks.get(divisionId)?.locked === true };
    } catch (err) {
      read = { ok: false, message: err instanceof Error ? err.message : "" };
    }
    const refusal = manualSaveLockRefusal(read, ctx.divisionName);
    if (refusal) {
      setSaveError(refusal);
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("games")
      .update({ scheduled_at: when.isoString, venue_id: venue.id } as never)
      .eq("id", gameId);
    if (error) {
      setSaveError(isDivisionLockError(error.message) ? formatLockError(error.message) : error.message);
      setSaving(false);
      return;
    }
    await logActivity(
      leagueId,
      divisionId,
      "game_rescheduled",
      `${homeTeamName} vs ${awayTeamName} moved to ${fmtGameDate(when.isoString)} at ${fmtGameTime(when.isoString)} — ${venue.label} (entered manually)`,
    );
    router.refresh();
    setSaving(false);
    onSaved({ isoString: when.isoString, venueName: venue.label });
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-400" />
        <p className="text-sm font-medium text-gray-700">{loadError}</p>
        <button
          type="button"
          onClick={() => void loadCtx()}
          className="text-sm text-[#22C55E] underline underline-offset-2"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-400 underline underline-offset-2"
        >
          Back to available times
        </button>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
        <p className="text-sm text-gray-400">Loading fields…</p>
      </div>
    );
  }

  const missing: string[] = [];
  if (!validDate) missing.push("date");
  if (!when && validDate) missing.push("time (check AM/PM)");
  if (!venue) missing.push("field");

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <p className="text-xs text-gray-500">
        Any date, time and field. Nothing here is filtered — anything it steps on
        is listed below, and you can still save.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gray-600">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gray-600">Start time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-gray-600">Field</span>
        <select
          value={venueId}
          onChange={(e) => setVenueId(e.target.value)}
          className={inputCls}
        >
          <option value="">Choose a field…</option>
          {ctx.venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      {/* Conflicts: notices only, never a gate. */}
      {when && venue && (
        conflicts === null ? (
          <p className="text-xs text-gray-400">Checking for conflicts…</p>
        ) : conflicts.length === 0 ? (
          <p className="text-xs text-gray-400">No conflicts found.</p>
        ) : (
          <div
            role="status"
            className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5"
          >
            <p className="text-xs font-semibold text-amber-800">
              Heads up — you can still save:
            </p>
            <ul className="mt-1 list-disc pl-4 text-xs text-amber-700">
              {conflicts.map((c, i) => (
                <li key={`${c.kind}:${i}`}>{c.text}</li>
              ))}
            </ul>
          </div>
        )
      )}

      {saveError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-600">{saveError}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="text-xs text-[#22C55E] underline underline-offset-2 disabled:opacity-50"
        >
          Back to available times
        </button>
        <div className="flex items-center gap-3">
          {missing.length > 0 && (
            <span className="text-[11px] text-gray-400">Still needed: {missing.join(", ")}</span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!manualSaveEnabled({ when, venueChosen: !!venue, saving, conflicts })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
