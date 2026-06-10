"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import {
  DAY_LABELS,
  dayKeyFromIsoDate,
  fmtTime12,
  isVenueAvailable,
  parseAvailability,
} from "@/lib/venues/availability";
import {
  CONFLICT_TYPE_LABELS,
  insertConflictOverrides,
  type DetectedConflict,
} from "@/lib/schedule/conflict-overrides";

// Manually add a single game. Inserts directly into games using the same
// column shape the schedule generator writes (see generate-schedule.ts §9),
// so finishSchedule counts it toward per-team totals and avoids its
// venue/time. Note that "Regenerate full schedule" wipes a division's games
// (preserving accepted interleague) — manual games included, by design.
//
// Conflicts (venue double-book, venue hours, team double-book) BLOCK the
// save; the admin can override only by supplying a required reason, which is
// recorded per conflict type in conflict_overrides (0064) and surfaced in
// the game detail modal. Override reasons are deliberately separate from
// games.notes.

export type AddGameSeason = { id: string; name: string };
export type AddGameDivision = { id: string; name: string; league_id: string };
export type AddGameTeam = { id: string; name: string; division_id: string };

type VenueOption = { id: string; name: string };

const inputClasses =
  "h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-600">{children}</label>;
}

interface AddGameModalProps {
  /** Active (non-archived) seasons. The Season field only renders when there
   *  is more than one and the division isn't locked; otherwise it's implied. */
  seasons: AddGameSeason[];
  /** Selectable divisions (exactly one when opened from a division panel). */
  divisions: AddGameDivision[];
  /** Teams across those divisions; filtered by the selected division. */
  teams: AddGameTeam[];
  /** Pre-select and disable the Division field (division-panel entry point). */
  lockedDivisionId?: string;
  onClose: () => void;
  /** Fires after a successful insert with a human-readable summary. The
   *  modal has already called router.refresh(); callers close + confirm. */
  onAdded: (summary: string) => void;
}

export function AddGameModal({
  seasons,
  divisions,
  teams,
  lockedDivisionId,
  onClose,
  onAdded,
}: AddGameModalProps) {
  const router = useRouter();
  const [seasonId, setSeasonId] = useState(() => {
    if (lockedDivisionId) {
      return divisions.find((d) => d.id === lockedDivisionId)?.league_id ?? "";
    }
    return seasons.length === 1 ? seasons[0].id : "";
  });
  const [divisionId, setDivisionId] = useState(
    lockedDivisionId ?? (divisions.length === 1 ? divisions[0].id : ""),
  );
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [venueId, setVenueId] = useState("");

  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = not checked yet; non-empty = conflicts shown and Save is BLOCKED
  // until an override reason is entered. A check that finds nothing inserts
  // in the same click (never set to []).
  const [conflicts, setConflicts] = useState<DetectedConflict[] | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Venues are org-scoped (owner_id), not season-scoped — resolve the org
  // from the first division's league, then list org venues (same query the
  // venues page uses). Every selectable division belongs to the same org.
  const firstLeagueId = divisions[0]?.league_id;
  useEffect(() => {
    let cancelled = false;
    async function loadVenues() {
      if (!firstLeagueId) {
        setVenuesLoading(false);
        return;
      }
      const supabase = createClient();
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("owner_id")
        .eq("id", firstLeagueId)
        .single();
      const ownerId = (leagueRow as { owner_id: string } | null)?.owner_id;
      if (!ownerId) {
        if (!cancelled) {
          setError("Couldn't load venues for this season.");
          setVenuesLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("venues")
        .select("id, name")
        .eq("owner_id", ownerId)
        .order("name");
      if (!cancelled) {
        setVenues((data as VenueOption[] | null) ?? []);
        setVenuesLoading(false);
      }
    }
    void loadVenues();
    return () => {
      cancelled = true;
    };
  }, [firstLeagueId]);

  const showSeasonField = !lockedDivisionId && seasons.length > 1;
  const seasonDivisions = divisions.filter((d) => d.league_id === seasonId);
  const divisionTeams = teams.filter((t) => t.division_id === divisionId);
  const homeTeam = divisionTeams.find((t) => t.id === homeTeamId);
  const awayTeam = divisionTeams.find((t) => t.id === awayTeamId);
  const venue = venues.find((v) => v.id === venueId);
  const complete =
    !!divisionId && !!homeTeamId && !!awayTeamId && !!date && !!time && !!venueId;

  // Any field change invalidates previously detected conflicts (and any
  // in-progress override) — the next save re-checks against the new values.
  function setField<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setConflicts(null);
      setOverrideOpen(false);
      setOverrideReason("");
      setError(null);
    };
  }
  const updateSeason = setField<string>((v) => {
    setSeasonId(v);
    setDivisionId("");
    setHomeTeamId("");
    setAwayTeamId("");
  });
  const updateDivision = setField<string>((v) => {
    setDivisionId(v);
    setHomeTeamId("");
    setAwayTeamId("");
  });
  const updateHome = setField<string>((v) => {
    setHomeTeamId(v);
    if (v && v === awayTeamId) setAwayTeamId("");
  });
  const updateAway = setField(setAwayTeamId);
  const updateDate = setField(setDate);
  const updateTime = setField(setTime);
  const updateVenue = setField(setVenueId);

  // Double-book checks are same date + time, exact match (the generator's
  // duration+buffer spacing is not enforced here). Venue hours mirror
  // gateVenueProposal: unconfigured venue is a conflict; a division without
  // game_duration skips the window check (no end time to test).
  async function checkConflicts(iso: string): Promise<DetectedConflict[]> {
    const supabase = createClient();
    const [venueQ, teamQ, venueRowQ, divQ] = await Promise.all([
      supabase
        .from("games")
        .select("id")
        .eq("venue_id", venueId)
        .eq("scheduled_at", iso)
        .neq("status", "cancelled"),
      supabase
        .from("games")
        .select("id, home_team_id, away_team_id")
        .eq("scheduled_at", iso)
        .neq("status", "cancelled")
        .or(
          `home_team_id.in.(${homeTeamId},${awayTeamId}),away_team_id.in.(${homeTeamId},${awayTeamId})`,
        ),
      supabase
        .from("venues")
        .select("name, availability, availability_configured")
        .eq("id", venueId)
        .single(),
      supabase
        .from("divisions")
        .select("settings")
        .eq("id", divisionId)
        .single(),
    ]);
    if (venueQ.error ?? teamQ.error) {
      throw new Error((venueQ.error ?? teamQ.error)!.message);
    }
    const found: DetectedConflict[] = [];
    if ((venueQ.data ?? []).length > 0) {
      found.push({
        type: "venue_double_book",
        message: `${venue?.name ?? "This venue"} is already booked at this time.`,
      });
    }

    const venueRow = venueRowQ.data as unknown as {
      name: string;
      availability: unknown;
      availability_configured: boolean;
    } | null;
    const divSettings = ((divQ.data as unknown as { settings: unknown } | null)
      ?.settings ?? {}) as { game_duration?: number };
    const duration =
      typeof divSettings.game_duration === "number" ? divSettings.game_duration : 0;
    if (venueRow) {
      if (!venueRow.availability_configured) {
        found.push({
          type: "venue_hours",
          message: `${venueRow.name} doesn't have venue hours configured yet.`,
        });
      } else if (duration > 0) {
        const av = parseAvailability(venueRow.availability);
        const day = dayKeyFromIsoDate(iso);
        if (!isVenueAvailable(av, day, iso.substring(11, 16), duration)) {
          const win = av[day];
          found.push({
            type: "venue_hours",
            message: `${venueRow.name} isn't open at this time (${DAY_LABELS[day]}: ${
              win ? `${fmtTime12(win.start)} – ${fmtTime12(win.end)}` : "closed"
            }).`,
          });
        }
      }
    }

    const rows = (teamQ.data ?? []) as {
      home_team_id: string;
      away_team_id: string | null;
    }[];
    const busy = (teamId: string) =>
      rows.some((g) => g.home_team_id === teamId || g.away_team_id === teamId);
    if (busy(homeTeamId)) {
      found.push({
        type: "team_double_book",
        message: `${homeTeam?.name ?? "The home team"} already has a game at this time.`,
      });
    }
    if (busy(awayTeamId)) {
      found.push({
        type: "team_double_book",
        message: `${awayTeam?.name ?? "The away team"} already has a game at this time.`,
      });
    }
    return found;
  }

  const isOverriding = (conflicts?.length ?? 0) > 0;
  const overrideReady = overrideReason.trim().length > 0;

  async function handleSave() {
    if (!complete || saving) return;
    if (isOverriding && !overrideReady) return;
    setError(null);
    const iso = `${date}T${time}:00`;
    setSaving(true);

    if (conflicts === null) {
      try {
        const found = await checkConflicts(iso);
        if (found.length > 0) {
          setConflicts(found);
          setSaving(false);
          return;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Conflict check failed.");
        setSaving(false);
        return;
      }
    }

    const division = divisions.find((d) => d.id === divisionId);
    const supabase = createClient();
    const { data: inserted, error: insertErr } = await supabase
      .from("games")
      .insert([
        {
          league_id: division!.league_id,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          interleague_org_id: null,
          venue_id: venueId,
          scheduled_at: iso,
          status: "scheduled",
          is_away: false,
        },
      ] as never[])
      .select("id")
      .single();
    if (insertErr) {
      setError(insertErr.message);
      setSaving(false);
      return;
    }

    if (isOverriding && conflicts) {
      const newGameId = (inserted as unknown as { id: string }).id;
      const { error: overrideErr } = await insertConflictOverrides(
        supabase,
        newGameId,
        conflicts,
        overrideReason.trim(),
      );
      if (overrideErr) {
        // The game IS saved at this point — say so, don't invite a retry
        // that would double-insert it.
        setError(
          `The game was added, but recording the override reason failed: ${overrideErr}`,
        );
        setSaving(false);
        return;
      }
    }

    router.refresh();
    onAdded(
      `${homeTeam?.name ?? "Home"} vs ${awayTeam?.name ?? "Away"} added — ${fmtGameDate(iso)} at ${fmtGameTime(iso)}`,
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-[#0C1F3F]">Add game</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          {showSeasonField && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Season</FieldLabel>
              <select
                value={seasonId}
                onChange={(e) => updateSeason(e.target.value)}
                className={inputClasses}
              >
                <option value="">Select a season…</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Division</FieldLabel>
            <select
              value={divisionId}
              onChange={(e) => updateDivision(e.target.value)}
              disabled={!!lockedDivisionId || !seasonId}
              className={inputClasses}
            >
              <option value="">Select a division…</option>
              {seasonDivisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Home team</FieldLabel>
            <select
              value={homeTeamId}
              onChange={(e) => updateHome(e.target.value)}
              disabled={!divisionId}
              className={inputClasses}
            >
              <option value="">Select home team…</option>
              {divisionTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Away team</FieldLabel>
            <select
              value={awayTeamId}
              onChange={(e) => updateAway(e.target.value)}
              disabled={!homeTeamId}
              className={inputClasses}
            >
              <option value="">Select away team…</option>
              {divisionTeams
                .filter((t) => t.id !== homeTeamId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Date</FieldLabel>
              <input
                type="date"
                value={date}
                onChange={(e) => updateDate(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Time</FieldLabel>
              <input
                type="time"
                value={time}
                onChange={(e) => updateTime(e.target.value)}
                className={inputClasses}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Venue</FieldLabel>
            <select
              value={venueId}
              onChange={(e) => updateVenue(e.target.value)}
              disabled={venuesLoading}
              className={inputClasses}
            >
              <option value="">
                {venuesLoading ? "Loading venues…" : "Select a venue…"}
              </option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          {conflicts && conflicts.length > 0 && (
            <div className="flex flex-col gap-2">
              {conflicts.map((c, i) => (
                <div
                  key={`${c.type}-${i}`}
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

              {!overrideOpen ? (
                <button
                  type="button"
                  onClick={() => setOverrideOpen(true)}
                  className="inline-flex w-fit items-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                >
                  Override — add reason
                </button>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Override reason</FieldLabel>
                  <textarea
                    rows={2}
                    required
                    autoFocus
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Why is this conflict acceptable?"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                  />
                  <p className="text-xs text-gray-400">
                    This reason will be visible to all admins in the game detail.
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-11 flex-1 rounded-lg border border-gray-200 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!complete || saving || (isOverriding && !overrideReady)}
            className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isOverriding
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-[#22C55E] hover:bg-[#16a34a]"
            }`}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving
              ? "Saving…"
              : isOverriding
                ? "Save with override"
                : "Save game"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Schedule-page trigger: the header "+ Add game" button plus the modal and
 *  a brief success toast. Lives client-side so the server page stays a
 *  server component. */
export function AddGameButton({
  seasons,
  divisions,
  teams,
}: {
  seasons: AddGameSeason[];
  divisions: AddGameDivision[];
  teams: AddGameTeam[];
}) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4000);
  }

  return (
    <>
      <Button
        size="sm"
        className="h-11 flex-1 whitespace-nowrap md:h-8 md:flex-none"
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add game
      </Button>

      {open && (
        <AddGameModal
          seasons={seasons}
          divisions={divisions}
          teams={teams}
          onClose={() => setOpen(false)}
          onAdded={(summary) => {
            setOpen(false);
            showToast(summary);
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl border border-[#22C55E]/30 bg-white px-4 py-3 shadow-lg">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-[#22C55E]" />
            <p className="text-sm font-medium text-[#0C1F3F]">{toast}</p>
          </div>
        </div>
      )}
    </>
  );
}
