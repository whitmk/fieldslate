"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";

// Manually add a single game. Inserts directly into games using the same
// column shape the schedule generator writes (see generate-schedule.ts §9),
// so finishSchedule counts it toward per-team totals and avoids its
// venue/time. Note that "Regenerate full schedule" wipes a division's games
// (preserving accepted interleague) — manual games included, by design.

export type AddGameDivision = { id: string; name: string; league_id: string };
export type AddGameTeam = { id: string; name: string; division_id: string };

type VenueOption = { id: string; name: string };

const inputClasses =
  "h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-600">{children}</label>;
}

interface AddGameModalProps {
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
  divisions,
  teams,
  lockedDivisionId,
  onClose,
  onAdded,
}: AddGameModalProps) {
  const router = useRouter();
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
  // null = not checked yet; non-empty = warnings shown, next save overrides.
  // A check that finds nothing inserts in the same click (never set to []).
  const [conflicts, setConflicts] = useState<string[] | null>(null);

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

  const divisionTeams = teams.filter((t) => t.division_id === divisionId);
  const homeTeam = divisionTeams.find((t) => t.id === homeTeamId);
  const awayTeam = divisionTeams.find((t) => t.id === awayTeamId);
  const venue = venues.find((v) => v.id === venueId);
  const complete =
    !!divisionId && !!homeTeamId && !!awayTeamId && !!date && !!time && !!venueId;

  // Any field change invalidates a previously shown conflict warning — the
  // next save re-checks against the new values.
  function setField<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setConflicts(null);
      setError(null);
    };
  }
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

  // Same date + time, exact match (the warning is advisory; the generator's
  // duration+buffer spacing is not enforced here).
  async function checkConflicts(iso: string): Promise<string[]> {
    const supabase = createClient();
    const [venueQ, teamQ] = await Promise.all([
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
    ]);
    if (venueQ.error ?? teamQ.error) {
      throw new Error((venueQ.error ?? teamQ.error)!.message);
    }
    const msgs: string[] = [];
    if ((venueQ.data ?? []).length > 0) {
      msgs.push(`${venue?.name ?? "This venue"} is already booked at this time.`);
    }
    const rows = (teamQ.data ?? []) as {
      home_team_id: string;
      away_team_id: string | null;
    }[];
    const busy = (teamId: string) =>
      rows.some((g) => g.home_team_id === teamId || g.away_team_id === teamId);
    if (busy(homeTeamId)) {
      msgs.push(`${homeTeam?.name ?? "The home team"} already has a game at this time.`);
    }
    if (busy(awayTeamId)) {
      msgs.push(`${awayTeam?.name ?? "The away team"} already has a game at this time.`);
    }
    return msgs;
  }

  async function handleSave() {
    if (!complete || saving) return;
    setError(null);
    const iso = `${date}T${time}:00`;
    setSaving(true);

    if (conflicts === null) {
      try {
        const msgs = await checkConflicts(iso);
        if (msgs.length > 0) {
          setConflicts(msgs);
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
    const { error: insertErr } = await supabase.from("games").insert([
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
    ] as never[]);
    if (insertErr) {
      setError(insertErr.message);
      setSaving(false);
      return;
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
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Division</FieldLabel>
            <select
              value={divisionId}
              onChange={(e) => updateDivision(e.target.value)}
              disabled={!!lockedDivisionId}
              className={inputClasses}
            >
              <option value="">Select a division…</option>
              {divisions.map((d) => (
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
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
              <div className="flex flex-col gap-1 text-xs text-amber-700">
                {conflicts.map((c) => (
                  <p key={c} className="font-medium">
                    {c}
                  </p>
                ))}
                <p className="text-amber-600">
                  You can save anyway — the game will be double-booked.
                </p>
              </div>
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
            disabled={!complete || saving}
            className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              conflicts && conflicts.length > 0
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-[#22C55E] hover:bg-[#16a34a]"
            }`}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving
              ? "Saving…"
              : conflicts && conflicts.length > 0
                ? "Save anyway"
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
  divisions,
  teams,
}: {
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
