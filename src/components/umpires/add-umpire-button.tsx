"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, ChevronDown, Clock, Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getOfficialTitleLower } from "@/lib/utils/official-title";
import {
  coachTeamLabel,
  fetchCoachTeamOptions,
  type CoachTeamOption,
} from "@/lib/umpires/team-options";
import {
  DAY_OPTIONS,
  dayFull,
  fmtClock,
  fmtDateOnly,
} from "@/components/umpires/official-profile-sections";

// Staged availability rows, written to official_availability /
// official_blackouts after the umpire insert returns the new id.
type StagedWindow = { day: string; start: string; end: string };
type StagedBlackout = { date: string; note: string };

export type SeasonOption = { id: string; name: string; sport?: string | null };

interface Props {
  seasons: SeasonOption[];
}

export function AddUmpireButton({ seasons }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [designation, setDesignation] = useState<"youth" | "adult">("youth");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [maxGames, setMaxGames] = useState("");
  const [notes, setNotes] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<CoachTeamOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Optional availability block — collapsed by default so the common
  // add-many-officials flow stays one screen. Zero staged rows means the
  // official is available anytime (eligibility.ts convention).
  const [showAvailability, setShowAvailability] = useState(false);
  const [windows, setWindows] = useState<StagedWindow[]>([]);
  const [blackouts, setBlackouts] = useState<StagedBlackout[]>([]);
  const [winDay, setWinDay] = useState("Mo");
  const [winStart, setWinStart] = useState("17:00");
  const [winEnd, setWinEnd] = useState("20:00");
  const [winError, setWinError] = useState("");
  const [boDate, setBoDate] = useState("");
  const [boNote, setBoNote] = useState("");
  const [boError, setBoError] = useState("");
  // Set when the official was inserted but a detail insert failed — the modal
  // switches to a close-only notice; resubmitting would duplicate the official.
  const [detailFailure, setDetailFailure] = useState("");

  // Coached-team options follow the selected season (coach conflict link,
  // migration 0063). Season change resets the pick — teams don't carry over.
  useEffect(() => {
    if (!open || !seasonId) {
      setTeams([]);
      setTeamId("");
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    fetchCoachTeamOptions(supabase, seasonId).then((options) => {
      if (cancelled) return;
      setTeams(options);
      setTeamId("");
    });
    return () => {
      cancelled = true;
    };
  }, [open, seasonId]);

  function openModal() {
    if (seasons.length === 0) return;
    setName("");
    setSeasonId(seasons.length === 1 ? seasons[0].id : "");
    setDesignation("youth");
    setEmail("");
    setPhone("");
    setMaxGames("");
    setNotes("");
    setTeamId("");
    setError("");
    setShowAvailability(false);
    setWindows([]);
    setBlackouts([]);
    setWinDay("Mo");
    setWinStart("17:00");
    setWinEnd("20:00");
    setWinError("");
    setBoDate("");
    setBoNote("");
    setBoError("");
    setDetailFailure("");
    setOpen(true);
  }

  function addWindow() {
    setWinError("");
    if (!winStart || !winEnd) return;
    if (winEnd <= winStart) {
      setWinError("End time must be after start time.");
      return;
    }
    setWindows((prev) => [...prev, { day: winDay, start: winStart, end: winEnd }]);
  }

  function addBlackout() {
    setBoError("");
    if (!boDate) return;
    // official_blackouts is UNIQUE(umpire_id, date) — block the dup here so
    // it can't fail the whole batch insert on save.
    if (blackouts.some((b) => b.date === boDate)) {
      setBoError(`${fmtDateOnly(boDate)} is already listed.`);
      return;
    }
    setBlackouts((prev) => [...prev, { date: boDate, note: boNote }]);
    setBoDate("");
    setBoNote("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (detailFailure) return;
    if (!name.trim() || !seasonId) return;
    setSaving(true);
    setError("");

    const supabase = createClient();
    const { data: inserted, error: insertError } = await supabase
      .from("umpires")
      .insert([{
        season_id: seasonId,
        name: name.trim(),
        designation,
        email: email.trim() || null,
        phone: phone.trim() || null,
        max_games_per_week:
          maxGames !== "" ? Math.max(1, parseInt(maxGames, 10) || 1) : null,
        notes: notes.trim() || null,
        team_id: teamId || null,
      }] as never)
      .select("id")
      .single();

    if (insertError || !inserted) {
      setError(insertError?.message ?? "Failed to add — please try again.");
      setSaving(false);
      return;
    }

    // Staged availability/blackout rows, keyed to the new id. The official
    // exists once we're past the insert — a failure below must surface as
    // "added, but details failed" (close-only notice), never look like the
    // whole save failed: resubmitting would duplicate the official.
    const newId = (inserted as { id: string }).id;
    const detailErrors: string[] = [];
    if (windows.length > 0) {
      const { error: availErr } = await supabase
        .from("official_availability")
        .insert(
          windows.map((w) => ({
            umpire_id: newId,
            day_of_week: w.day,
            start_time: w.start,
            end_time: w.end,
          })) as never[],
        );
      if (availErr) detailErrors.push(`availability windows (${availErr.message})`);
    }
    if (blackouts.length > 0) {
      const { error: boErr } = await supabase
        .from("official_blackouts")
        .insert(
          blackouts.map((b) => ({
            umpire_id: newId,
            date: b.date,
            note: b.note.trim() || null,
          })) as never[],
        );
      if (boErr) detailErrors.push(`blackout dates (${boErr.message})`);
    }

    setSaving(false);
    if (detailErrors.length > 0) {
      router.refresh();
      setDetailFailure(
        `${name.trim()} was added, but these details couldn't be saved: ${detailErrors.join(
          "; ",
        )}. You can add them from the official's schedule page.`,
      );
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const disabled = seasons.length === 0;

  const selectedSeason = seasons.find((s) => s.id === seasonId);
  const uniqueSports = Array.from(new Set(seasons.map((s) => s.sport ?? "")));
  // Use the selected season's sport if one is chosen; otherwise the only sport
  // across all seasons; otherwise fall back to neutral "official".
  const contextSport = selectedSeason?.sport ?? (uniqueSports.length === 1 ? uniqueSports[0] : "");
  const titleLower = getOfficialTitleLower(contextSport);

  return (
    <>
      <Button
        size="sm"
        onClick={openModal}
        disabled={disabled}
        title={disabled ? "Create a season first" : undefined}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add {titleLower}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="font-semibold text-[#0C1F3F]">Add {titleLower}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-5 overflow-y-auto px-6 py-6"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jamie Rivera"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              {seasons.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">Season</label>
                  <select
                    value={seasonId}
                    onChange={(e) => setSeasonId(e.target.value)}
                    required
                    className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
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
                <span className="text-sm font-medium text-gray-700">Designation</span>
                <div className="flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1">
                  {(["youth", "adult"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDesignation(d)}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-all ${
                        designation === d
                          ? "bg-white text-[#0C1F3F] shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Email <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="ump@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Phone <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="tel"
                  placeholder="(555) 555-5555"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Max games per week{" "}
                  <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="No limit"
                  value={maxGames}
                  onChange={(e) => setMaxGames(e.target.value)}
                  className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              {seasonId && teams.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    Coaches team{" "}
                    <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <select
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                  >
                    <option value="">— None —</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {coachTeamLabel(t.name, t.division?.name)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400">
                    Auto-assign skips games involving this team; manual
                    assignments show a warning.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Notes <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Prefers weekend games…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>

              <div className="rounded-lg border border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowAvailability((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-gray-50/60"
                >
                  <span className="text-sm font-medium text-gray-700">
                    Set availability{" "}
                    <span className="font-normal text-gray-400">(optional)</span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ${
                      showAvailability ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {showAvailability && (
                  <div className="flex flex-col gap-4 border-t border-gray-100 px-3 py-3">
                    <p className="text-xs text-gray-400">
                      Leave empty to treat this {titleLower} as available anytime.
                    </p>

                    <div className="flex flex-col gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                        <Clock className="h-3.5 w-3.5 text-[#22C55E]" />
                        Weekly windows
                      </span>
                      {windows.map((w, i) => (
                        <div
                          key={`${w.day}-${w.start}-${w.end}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-1.5"
                        >
                          <span className="text-sm text-gray-700">
                            <span className="font-medium text-[#0C1F3F]">{dayFull(w.day)}</span>{" "}
                            · {fmtClock(w.start)} – {fmtClock(w.end)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setWindows((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            aria-label="Remove availability window"
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <select
                          value={winDay}
                          onChange={(e) => setWinDay(e.target.value)}
                          aria-label="Day of week"
                          className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        >
                          {DAY_OPTIONS.map((d) => (
                            <option key={d.key} value={d.key}>
                              {d.full}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={winStart}
                          onChange={(e) => setWinStart(e.target.value)}
                          aria-label="Start time"
                          className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        />
                        <input
                          type="time"
                          value={winEnd}
                          onChange={(e) => setWinEnd(e.target.value)}
                          aria-label="End time"
                          className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        />
                        <button
                          type="button"
                          onClick={addWindow}
                          className="inline-flex h-11 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-500 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                        >
                          <Plus className="h-4 w-4" />
                          Add
                        </button>
                      </div>
                      {winError && <p className="text-xs text-red-600">{winError}</p>}
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                        <CalendarOff className="h-3.5 w-3.5 text-[#22C55E]" />
                        Blackout dates
                      </span>
                      {blackouts.map((b, i) => (
                        <div
                          key={b.date}
                          className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-1.5"
                        >
                          <span className="min-w-0 text-sm text-gray-700">
                            <span className="font-medium text-[#0C1F3F]">
                              {fmtDateOnly(b.date)}
                            </span>
                            {b.note.trim() && (
                              <span className="text-gray-500"> — {b.note.trim()}</span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setBlackouts((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            aria-label="Remove blackout date"
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          type="date"
                          value={boDate}
                          onChange={(e) => setBoDate(e.target.value)}
                          aria-label="Blackout date"
                          className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        />
                        <input
                          type="text"
                          value={boNote}
                          onChange={(e) => setBoNote(e.target.value)}
                          placeholder="Note (optional)"
                          className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                        />
                        <button
                          type="button"
                          onClick={addBlackout}
                          className="inline-flex h-11 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-500 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                        >
                          <Plus className="h-4 w-4" />
                          Add
                        </button>
                      </div>
                      {boError && <p className="text-xs text-red-600">{boError}</p>}
                    </div>
                  </div>
                )}
              </div>

              {detailFailure ? (
                <>
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                    {detailFailure}
                  </p>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
                    >
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {error && (
                    <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600">
                      {error}
                    </p>
                  )}

                  <div className="flex justify-end gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      disabled={saving}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !name.trim() || !seasonId}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        `Add ${titleLower}`
                      )}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
