"use client";

// Set or change ONE playoff game's date, start time and field — from the
// bracket's list view and bracket cards. This is what the wizard's success
// screen means by "set it from the bracket's list view": a TBD game (no slot
// was left for it) gets a slot here, and a placed game can be moved.
//
// Decisions live in src/lib/playoffs/edit-game.ts; the conflict check is the
// reschedule picker's own manual-entry check (`manualMoveConflicts`): notices,
// never gates. This file only reads, renders and saves. The save chains
// `.select("id")` and treats zero rows as an error — the picker's rule.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { parseAvailability, type VenueAvailability } from "@/lib/venues/availability";
import { qualifiedVenueLabel, byQualifiedVenueLabel } from "@/lib/venues/venue-label";
import { durationFromSettings, occupancyWindow, toMins, minsToHHMM } from "@/lib/schedule/reschedule-slots";
import type { ManualBookedGame, ManualTeamGame } from "@/lib/schedule/manual-move";
import { planSettingsFromDivision } from "@/lib/playoffs/bracket-plan";
import {
  parseManualDateTime,
  playoffEditConflicts,
  playoffEditLogMessage,
  playoffEditOutcome,
  playoffEditSaveEnabled,
} from "@/lib/playoffs/edit-game";
import type { GameWithTeams } from "@/components/playoffs/bracket-view";

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
  durationMin: number;
  bufferMin: number;
  blackoutDates: Set<string>;
};

type SeasonGameRow = {
  id: string;
  scheduled_at: string;
  home_team_id: string;
  away_team_id: string | null;
  external_team_name: string | null;
  home_team: { name: string; division: { name: string; settings: unknown } | null } | null;
  away_team: { name: string } | null;
  venue: { name: string } | null;
};

const SEASON_GAME_SELECT =
  "id, scheduled_at, home_team_id, away_team_id, external_team_name, " +
  "home_team:teams!home_team_id(name, division:divisions(name, settings)), " +
  "away_team:teams!away_team_id(name), venue:venues(name)";

type PlayoffGameRow = {
  id: string;
  round: string;
  start_time: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home: { name: string } | null;
  away: { name: string } | null;
  venue: { name: string } | null;
  division: { name: string; settings: unknown } | null;
};

const PLAYOFF_GAME_SELECT =
  "id, round, start_time, home_team_id, away_team_id, " +
  "home:teams!playoff_games_home_team_id_fkey(name), " +
  "away:teams!playoff_games_away_team_id_fkey(name), " +
  "venue:venues(name), division:divisions(name, settings)";

function seasonSpan(g: SeasonGameRow) {
  return {
    startMin: toMins(g.scheduled_at.substring(11, 16)),
    durationMin: durationFromSettings(g.home_team?.division?.settings),
  };
}
function playoffSpan(g: PlayoffGameRow) {
  return {
    startMin: toMins((g.start_time ?? "00:00").substring(0, 5)),
    durationMin: planSettingsFromDivision(g.division?.settings).durationMin,
  };
}
function seasonLabel(g: SeasonGameRow) {
  const opp = g.away_team?.name ?? g.external_team_name ?? "TBD";
  return `${g.home_team?.division?.name ?? "Game"}: ${g.home_team?.name ?? "TBD"} vs ${opp}`;
}
function playoffLabel(g: PlayoffGameRow) {
  return `${g.division?.name ?? "Playoff"} playoffs: ${g.home?.name ?? "TBD"} vs ${g.away?.name ?? "TBD"}`;
}

const inputCls =
  "h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";

export function EditPlayoffGameModal({
  game,
  roundLabel,
  leagueId,
  divisionId,
  divisionName,
  playingDays,
  onClose,
  onSaved,
}: {
  game: GameWithTeams;
  roundLabel: string;
  leagueId: string;
  divisionId: string;
  divisionName: string;
  /** The playoff's playing days, for the "doesn't play on …" notice. */
  playingDays: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [date, setDate] = useState(game.scheduled_date ?? "");
  const [time, setTime] = useState(game.start_time?.substring(0, 5) ?? "");
  const [venueId, setVenueId] = useState(game.venue_id ?? "");

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
    const settings = planSettingsFromDivision((divQ.data as { settings: unknown }).settings);
    setCtx({
      venues,
      durationMin: settings.durationMin,
      bufferMin: settings.bufferMin,
      blackoutDates: new Set(((blackoutQ.data ?? []) as { date: string }[]).map((b) => b.date)),
    });
  }

  const when = useMemo(() => parseManualDateTime(date, time), [date, time]);
  const venue = ctx?.venues.find((v) => v.id === venueId) ?? null;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;

  const homeId = game.home_team_id;
  const awayId = game.away_team_id;
  const homeName = game.home_team_name;
  const awayName = game.away_team_name;

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
    const win = occupancyWindow(validDate, validDate);
    const teamIds = [homeId, awayId].filter((id): id is string => !!id);
    const teamOr = teamIds
      .flatMap((id) => [`home_team_id.eq.${id}`, `away_team_id.eq.${id}`])
      .join(",");

    void Promise.all([
      // Field occupancy: the season's games at this field that day…
      supabase
        .from("games")
        .select(SEASON_GAME_SELECT)
        .eq("venue_id", venueId)
        .neq("status", "cancelled")
        .gte("scheduled_at", win.fromIso)
        .lt("scheduled_at", win.toIsoExclusive),
      // …and every other playoff game there (any division's bracket).
      supabase
        .from("playoff_games")
        .select(PLAYOFF_GAME_SELECT)
        .eq("venue_id", venueId)
        .eq("scheduled_date", validDate)
        .neq("id", game.id)
        .neq("status", "cancelled"),
      // Team occupancy, both tables. A TBD game has no teams: nothing to read.
      teamIds.length
        ? supabase
            .from("games")
            .select(SEASON_GAME_SELECT)
            .or(teamOr)
            .neq("status", "cancelled")
            .gte("scheduled_at", win.fromIso)
            .lt("scheduled_at", win.toIsoExclusive)
        : Promise.resolve({ data: [], error: null }),
      teamIds.length
        ? supabase
            .from("playoff_games")
            .select(PLAYOFF_GAME_SELECT)
            .or(teamOr)
            .eq("scheduled_date", validDate)
            .neq("id", game.id)
            .neq("status", "cancelled")
        : Promise.resolve({ data: [], error: null }),
    ]).then(([vq, pq, tq, tpq]) => {
      if (stale) return;
      setVenueGames(
        vq.error || pq.error
          ? null
          : [
              ...((vq.data ?? []) as unknown as SeasonGameRow[]).map((g) => ({
                ...seasonSpan(g),
                label: seasonLabel(g),
              })),
              ...((pq.data ?? []) as unknown as PlayoffGameRow[])
                .filter((g) => g.start_time)
                .map((g) => ({ ...playoffSpan(g), label: playoffLabel(g) })),
            ],
      );
      const nameOf = (id: string) => (id === homeId ? homeName : awayName) ?? "Team";
      setTeamGames(
        tq.error || tpq.error
          ? null
          : [
              ...((tq.data ?? []) as unknown as SeasonGameRow[]).flatMap((g) =>
                teamIds
                  .filter((id) => id === g.home_team_id || id === g.away_team_id)
                  .map((id) => ({
                    ...seasonSpan(g),
                    teamName: nameOf(id),
                    label: `${g.home_team?.name ?? "TBD"} vs ${g.away_team?.name ?? g.external_team_name ?? "TBD"}${g.venue?.name ? ` at ${g.venue.name}` : ""}`,
                  })),
              ),
              ...((tpq.data ?? []) as unknown as PlayoffGameRow[])
                .filter((g) => g.start_time)
                .flatMap((g) =>
                  teamIds
                    .filter((id) => id === g.home_team_id || id === g.away_team_id)
                    .map((id) => ({
                      ...playoffSpan(g),
                      teamName: nameOf(id),
                      label: `${playoffLabel(g)}${g.venue?.name ? ` at ${g.venue.name}` : ""}`,
                    })),
                ),
            ],
      );
    });
    return () => {
      stale = true;
    };
  }, [validDate, venueId, game.id, homeId, awayId, homeName, awayName]);

  const conflicts = useMemo(() => {
    if (!ctx || !when || !venue || venueGames === undefined || teamGames === undefined) return null;
    return playoffEditConflicts({
      when,
      durationMin: ctx.durationMin,
      bufferMin: ctx.bufferMin,
      divisionName: `${divisionName} playoffs`,
      playingDays,
      blackoutDates: ctx.blackoutDates,
      venue,
      venueGames,
      teamGames,
    });
  }, [ctx, when, venue, venueGames, teamGames, divisionName, playingDays]);

  async function handleSave() {
    if (!ctx || !when || !venue) return;
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { data: saved, error } = await supabase
      .from("playoff_games")
      .update({
        scheduled_date: when.date,
        start_time: `${minsToHHMM(when.startMin)}:00`,
        venue_id: venue.id,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", game.id)
      .select("id");
    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }
    const outcome = playoffEditOutcome((saved ?? []).length);
    if (outcome) {
      setSaveError(outcome);
      setSaving(false);
      return;
    }
    await logActivity(
      leagueId,
      divisionId,
      "playoff_game_rescheduled",
      playoffEditLogMessage({
        divisionName, roundLabel, homeName, awayName, when, venueLabel: venue.label,
      }),
    );
    setSaving(false);
    onSaved();
  }

  const missing: string[] = [];
  if (!validDate) missing.push("date");
  if (!when && validDate) missing.push("time (check AM/PM)");
  if (!venue) missing.push("field");

  const matchup =
    homeName && awayName ? `${homeName} vs ${awayName}` : "TBD vs TBD";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0C1F3F]">Set date, time and field</p>
            <p className="truncate text-xs text-gray-400">
              {roundLabel} · {matchup}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <p className="text-sm font-medium text-gray-700">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadCtx()}
                className="text-sm text-[#22C55E] underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : !ctx ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              <p className="text-sm text-gray-400">Loading fields…</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-5 py-4">
              <p className="text-xs text-gray-500">
                Any date, time and field. Anything this steps on is listed below,
                and you can still save.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-gray-600">Date</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-gray-600">Start time</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-gray-600">Field</span>
                <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={inputCls}>
                  <option value="">Choose a field…</option>
                  {ctx.venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>

              {when && venue && (
                conflicts === null ? (
                  <p className="text-xs text-gray-400">Checking for conflicts…</p>
                ) : conflicts.length === 0 ? (
                  <p className="text-xs text-gray-400">No conflicts found.</p>
                ) : (
                  <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-800">Heads up — you can still save:</p>
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
            </div>
          )}
        </div>

        {ctx && !loadError && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 px-5 py-4">
            {missing.length > 0 && (
              <span className="text-[11px] text-gray-400">Still needed: {missing.join(", ")}</span>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!playoffEditSaveEnabled({ when, venueChosen: !!venue, saving, conflicts })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
