"use client";

// "Edit and confirm" for a counter-proposed interleague game.
//
// HOME game (the game has a field of ours): the modal OPENS ON A PICKER of real
// available times at that field, built by the same slot model as the rainout
// picker. A free-typed time survives only as a deliberate last resort behind
// "Enter a time manually" — secondary, below the list — for cases the picker
// cannot cover. Everything, picked or typed, still goes through the resolve
// route's hours + occupancy gates unchanged; the picker reduces rejections, it
// does not replace the server check.
//
// AWAY game (no field of ours — venue_id null): free-typed date, time and field
// IS the normal flow. We have neither the partner's hours nor their bookings, so
// there are no times we could honestly call available.
//
// This REVERSES, for this surface only, the July rule that manual surfaces stay
// free-typed as the human-override escape hatch (still true for Add game and
// the conflict resolver's manual move): an interleague game has another league
// on the other end, and a guessed time that bounces costs them too. See
// CLAUDE.md "Interleague counter-proposal picker".
//
// Assembly, fail-closed decisions and every empty-day sentence live in
// src/lib/schedule/interleague-resolve-picker.ts so the sim drives them.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays, ChevronRight, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { occupancyWindow, type SlotOption } from "@/lib/schedule/reschedule-slots";
import {
  NOT_ATTEMPTED,
  buildResolvePicker,
  resolveEditMode,
  type PickerBuild,
  type PickerDivisionRow,
  type PickerGameRow,
  type PickerReads,
  type PickerVenueRow,
  type ReadResult,
} from "@/lib/schedule/interleague-resolve-picker";
import type { TeamGameConstraintRow } from "@/lib/schedule/team-constraints";

export type ResolveEditGame = {
  id: string;
  league_id: string;
  home_team_id: string;
  venue_id: string | null;
  scheduled_at: string;
  proposed_scheduled_at: string | null;
  proposed_venue_name: string | null;
  external_team_name: string | null;
  is_away: boolean;
  home_team: {
    name: string;
    division: { id: string; name: string } | null;
  } | null;
  venue: { name: string } | null;
  interleague_org: { name: string } | null;
};

interface ResolveEditModalProps {
  game: ResolveEditGame;
  busy: boolean;
  /** The resolve route's refusal, shown INSIDE the modal so a gate rejection
   *  (which names what is in the way) is visible where the admin is looking. */
  error: string | null;
  onSave: (payload: { scheduled_at: string; venue_name?: string }) => void;
  onClose: () => void;
  /** Sim/scratch seam: supply the picker result instead of querying. */
  initialBuild?: PickerBuild;
}

// Wall-clock only (house convention): the substring, never the instant.
function isoToDatetimeLocal(iso: string): string {
  return iso.replace(" ", "T").substring(0, 16);
}

function datetimeLocalToWallClockIso(local: string): string {
  return local ? `${local}:00+00:00` : "";
}

const inputCls =
  "h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20";

async function loadPickerReads(game: ResolveEditGame): Promise<PickerReads> {
  const supabase = createClient();
  const divisionId = game.home_team?.division?.id ?? null;
  const venueId = game.venue_id!;

  const [divRes, venueRes] = await Promise.all([
    divisionId
      ? supabase
          .from("divisions")
          .select("name, start_date, end_date, settings")
          .eq("id", divisionId)
          .single()
      : Promise.resolve({ data: null, error: { message: "game has no division" } }),
    supabase
      .from("venues")
      .select("id, name, availability, availability_configured, location:locations(name)")
      .eq("id", venueId)
      .single(),
  ]);

  const division = divRes as unknown as ReadResult<PickerDivisionRow>;
  const venue = venueRes as unknown as ReadResult<PickerVenueRow>;
  const rest = {
    blackouts: NOT_ATTEMPTED,
    venueGames: NOT_ATTEMPTED,
    teamGames: NOT_ATTEMPTED,
    constraints: NOT_ATTEMPTED,
  };
  // The games reads are bounded by the division's dates, and nothing can be
  // picked at an unconfigured field — stop here and let assembly say why.
  if (
    division.error || !division.data?.start_date || !division.data?.end_date ||
    venue.error || !venue.data?.availability_configured
  ) {
    return { division, venue, ...rest };
  }

  const win = occupancyWindow(division.data.start_date, division.data.end_date);
  // Each game carries its OWN division's duration as a projected key — never
  // the `settings` blob, which also holds every team's coach metadata.
  const GAME_COLS =
    "scheduled_at, home_team:teams!home_team_id(division:divisions(game_duration:settings->game_duration))";

  const [blackoutsRes, venueGames, teamGamesRes, constraintsRes] = await Promise.all([
    supabase.from("blackout_dates").select("date").eq("league_id", game.league_id),
    // Same scope as the rainout picker and the occupancy RPC: DATE-bounded,
    // never league-bounded (a concurrent season's game at this field really
    // occupies it); this game excluded; cancelled games hold no field;
    // pending_interleague games do. Paginated + complete-or-throw — a row lost
    // to the 1000-row cap is a game the picker would offer a slot on top of.
    fetchAllRows<PickerGameRow>(
      "games already at this field",
      ({ from, to, exactCount }) =>
        supabase
          .from("games")
          .select(GAME_COLS, exactCount ? { count: "exact" } : undefined)
          .eq("venue_id", venueId)
          .neq("id", game.id)
          .neq("status", "cancelled")
          .gte("scheduled_at", win.fromIso)
          .lt("scheduled_at", win.toIsoExclusive)
          .order("scheduled_at")
          .order("id")
          .range(from, to) as unknown as PromiseLike<{
          data: PickerGameRow[] | null;
          error: { message: string } | null;
          count?: number | null;
        }>,
    ).then(
      (data): ReadResult<PickerGameRow[]> => ({ data, error: null }),
      (e: unknown): ReadResult<PickerGameRow[]> => ({
        data: null,
        error: { message: e instanceof Error ? e.message : String(e) },
      }),
    ),
    // Our team's other games. Unpaginated for the rainout picker's reason: a
    // team belongs to one season, so this is bounded by games-per-team.
    supabase
      .from("games")
      .select(GAME_COLS)
      .or(`home_team_id.eq.${game.home_team_id},away_team_id.eq.${game.home_team_id}`)
      .neq("id", game.id)
      .neq("status", "cancelled")
      .gte("scheduled_at", win.fromIso)
      .lt("scheduled_at", win.toIsoExclusive),
    supabase
      .from("team_game_constraints")
      .select("team_id, day_of_week, start_time, end_time, severity")
      .eq("team_id", game.home_team_id),
  ]);

  return {
    division,
    venue,
    blackouts: blackoutsRes as unknown as ReadResult<{ date: string }[]>,
    venueGames,
    teamGames: teamGamesRes as unknown as ReadResult<PickerGameRow[]>,
    constraints: constraintsRes as unknown as ReadResult<TeamGameConstraintRow[]>,
  };
}

export function ResolveEditModal({
  game,
  busy,
  error,
  onSave,
  onClose,
  initialBuild,
}: ResolveEditModalProps) {
  const mode = resolveEditMode(game);
  const orgName = game.interleague_org?.name ?? "the other league";
  const teamName = game.home_team?.name ?? "Your team";

  // Free-typed state, seeded from the proposal if there is one, else original.
  const [datetime, setDatetime] = useState<string>(
    isoToDatetimeLocal(game.proposed_scheduled_at ?? game.scheduled_at),
  );
  const [venueName, setVenueName] = useState<string>(
    game.proposed_venue_name ?? game.venue?.name ?? "",
  );

  // Picker state.
  const [build, setBuild] = useState<PickerBuild | null>(initialBuild ?? null);
  const [loading, setLoading] = useState(mode === "picker" && !initialBuild);
  const [manual, setManual] = useState(false);
  const [picked, setPicked] = useState<SlotOption | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const reads = await loadPickerReads(game);
      setBuild(
        buildResolvePicker(reads, {
          gameId: game.id,
          homeTeamId: game.home_team_id,
          homeTeamName: teamName,
        }),
      );
    } catch (e) {
      // Anything unexpected is a failed read, never an empty list.
      setBuild({
        ok: false,
        reason: "read_failed",
        message: `Couldn't load available times (${e instanceof Error ? e.message : "unknown error"}), so no times are shown. Try again.`,
      });
    } finally {
      setLoading(false);
    }
  }, [game, teamName]);

  useEffect(() => {
    if (mode === "picker" && !initialBuild) void load();
  }, [mode, initialBuild, load]);

  const isAway = game.is_away;
  const proposalKey = game.proposed_scheduled_at
    ? isoToDatetimeLocal(game.proposed_scheduled_at)
    : null;
  const showForm = mode !== "picker" || manual;
  const canSaveTyped = !!datetime && !busy && (!isAway || venueName.trim().length > 0);

  function submitTyped() {
    if (!canSaveTyped) return;
    onSave({
      scheduled_at: datetimeLocalToWallClockIso(datetime),
      venue_name: isAway ? venueName.trim() : undefined,
    });
  }

  const grouped = new Map<string, SlotOption[]>();
  if (build?.ok) {
    for (const s of build.slots) {
      if (!grouped.has(s.date)) grouped.set(s.date, []);
      grouped.get(s.date)!.push(s);
    }
  }

  const manualLink = (
    <button
      type="button"
      onClick={() => { setPicked(null); setManual(true); }}
      className="text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600"
    >
      Enter a time manually
    </button>
  );

  const errorBox = error && (
    <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
      <p className="text-sm text-red-600">{error}</p>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className={`flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl ${
          mode === "picker" && !manual && !picked ? "h-[85dvh]" : ""
        }`}
      >
        <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#0C1F3F]">Edit and confirm</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {teamName}{" "}
              <span className="mx-1 font-bold uppercase tracking-wider text-gray-400">
                {isAway ? "AT" : "vs"}
              </span>
              {orgName}
              {game.external_team_name ? ` (${game.external_team_name})` : ""}
            </p>
            {game.proposed_scheduled_at && (
              <p className="mt-1 text-xs text-amber-700">
                They proposed {fmtGameDate(game.proposed_scheduled_at)} at{" "}
                {fmtGameTime(game.proposed_scheduled_at)}
                {game.proposed_venue_name ? ` · ${game.proposed_venue_name}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {showForm ? (
          <form
            onSubmit={(e) => { e.preventDefault(); submitTyped(); }}
            className="flex flex-col gap-4 px-6 py-5"
          >
            {mode === "away_free_typed" && (
              <p className="text-sm text-gray-600">
                This game is at {orgName}&rsquo;s field. We don&rsquo;t have their
                hours or bookings, so enter the date, time and field you&rsquo;ve
                agreed with them.
              </p>
            )}
            {mode === "no_venue_free_typed" && (
              <p className="text-sm text-gray-600">
                This game has no field assigned, so there are no times to pick
                from. Enter the date and time.
              </p>
            )}
            {mode === "picker" && (
              <p className="text-xs text-gray-500">
                A time you type is still checked against{" "}
                {build?.ok ? build.fieldName : game.venue?.name ?? "the field"}
                &rsquo;s hours and bookings when you confirm.
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Date &amp; time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={datetime}
                onChange={(e) => setDatetime(e.target.value)}
                required
                className={inputCls}
              />
              <p className="text-[11px] text-gray-400">
                Use the time as it will appear on the schedule (no timezone conversion).
              </p>
            </div>

            {isAway && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">
                  Venue (host org) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  required
                  placeholder="e.g. Riverside Field A"
                  className={inputCls}
                />
              </div>
            )}

            {errorBox}

            <div className="flex items-center justify-between gap-2 pt-1">
              {mode === "picker" ? (
                <button
                  type="button"
                  onClick={() => setManual(false)}
                  disabled={busy}
                  className="text-xs text-[#22C55E] underline underline-offset-2 disabled:opacity-50"
                >
                  Back to available times
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSaveTyped}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {busy ? "Saving…" : "Confirm game"}
                </button>
              </div>
            </div>
          </form>
        ) : picked ? (
          <div className="flex flex-col gap-5 px-6 py-6">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Confirm this time
              </p>
              <p className="mt-2 text-base font-semibold text-[#0C1F3F]">
                {fmtGameDate(picked.isoString)} at {fmtGameTime(picked.isoString)}
              </p>
              <p className="mt-0.5 text-sm text-gray-500">{picked.venueName}</p>
            </div>
            {errorBox}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPicked(null)}
                disabled={busy}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => onSave({ scheduled_at: `${picked.isoString}+00:00` })}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#22C55E] py-2.5 text-sm font-semibold text-white hover:bg-[#16a34a] disabled:opacity-60"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : "Confirm game"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto">
              {loading || !build ? (
                <div className="flex flex-col items-center gap-3 py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  <p className="text-sm text-gray-400">Finding available times…</p>
                </div>
              ) : !build.ok ? (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <AlertTriangle className="h-6 w-6 text-amber-400" />
                  <p className="text-sm font-medium text-gray-700">
                    {build.reason === "read_failed"
                      ? build.message
                      : build.reason === "venue_unconfigured"
                        ? `${build.fieldName} has no hours set, so there are no times to pick from.`
                        : `${build.divisionName} has no season start or end date, so there are no times to pick from.`}
                  </p>
                  {build.reason === "read_failed" && (
                    <button
                      type="button"
                      onClick={() => void load()}
                      className="text-sm text-[#22C55E] underline underline-offset-2"
                    >
                      Retry
                    </button>
                  )}
                  {build.reason === "venue_unconfigured" && (
                    <Link
                      href="/dashboard/venues"
                      className="text-sm text-[#22C55E] underline underline-offset-2"
                    >
                      Set hours on the Venues page
                    </Link>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  <div className="px-6 py-3">
                    <p className="text-xs text-gray-400">
                      {build.seasonOver
                        ? `${build.divisionName}'s season has no dates left to schedule.`
                        : build.slots.length === 0
                        ? `No open times at ${build.fieldName} this season.`
                        : `${build.slots.length} open time${build.slots.length !== 1 ? "s" : ""} at ${build.fieldName} — pick one`}
                    </p>
                  </div>

                  {Array.from(grouped.entries()).map(([date, daySlots]) => (
                    <div key={date}>
                      <div className="bg-gray-50/70 px-6 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          {fmtGameDate(date)}
                        </p>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {daySlots.map((slot) => {
                          const isProposal = proposalKey === slot.isoString.substring(0, 16);
                          return (
                            <button
                              type="button"
                              key={`${slot.isoString}:${slot.venueId}`}
                              onClick={() => setPicked(slot)}
                              className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-gray-50"
                            >
                              <span className="flex items-center gap-3">
                                <span className="w-16 flex-shrink-0 text-sm tabular-nums text-gray-500">
                                  {fmtGameTime(slot.isoString)}
                                </span>
                                <span className="text-sm font-medium text-[#0C1F3F]">
                                  {slot.venueName}
                                </span>
                                {isProposal && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                                    Their proposal
                                  </span>
                                )}
                              </span>
                              <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {build.lines.length > 0 && (
                    <div className="bg-gray-50/40">
                      <div className="flex items-center gap-2 px-6 py-2">
                        {build.slots.length === 0 && <CalendarDays className="h-3.5 w-3.5 text-gray-300" />}
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          {build.slots.length === 0 ? "Why no times" : "Other days"}
                        </p>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {build.lines.map((line) => (
                          <div key={line.key} className="px-6 py-2.5">
                            <p className={`text-xs ${line.tone === "config" ? "text-amber-700" : "text-gray-400"}`}>
                              {line.dayLabel && (
                                <span className={`font-medium ${line.tone === "config" ? "" : "text-gray-500"}`}>
                                  {line.dayLabel} —{" "}
                                </span>
                              )}
                              {line.text}
                            </p>
                            {line.venuesLink && (
                              <Link
                                href="/dashboard/venues"
                                className="text-xs text-[#22C55E] underline underline-offset-2"
                              >
                                See the field&rsquo;s hours on the Venues page
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* The escape hatch: deliberate, secondary, below the list. */}
            <div className="flex flex-shrink-0 items-center justify-between border-t border-gray-100 px-6 py-3">
              <p className="text-[11px] text-gray-400">Need a time that isn&rsquo;t listed?</p>
              {manualLink}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
