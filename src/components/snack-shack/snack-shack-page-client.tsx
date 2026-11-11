"use client";

// The Snack Shack page. Shifts are DERIVED from the game schedule by the pure
// library (src/lib/snack-shack/derive-shifts.ts); this page loads the inputs,
// shows the plan, and writes ONLY through the preview → confirm → RPC path.
// Nothing here decides a rule. Notices (staleness, legacy, closed days,
// assumed durations, stale leftover choices) render the library's output
// verbatim.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShoppingBag, Settings2, Plus, Printer, Mail, LayoutList, CalendarDays, RefreshCw, AlertTriangle, Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SnackShackWizard } from "./snack-shack-wizard";
import { SnackShackSchedule, AddOneOffButton, AddOneOffModal, type BlockRow, type TeamOption } from "./snack-shack-schedule";
import { SnackShackCalendar } from "./snack-shack-calendar";
import { SnackShackEmailModal } from "./snack-shack-email-modal";
import { RegeneratePreviewModal } from "./regenerate-preview-modal";
import { AbsorbChoiceControl } from "./absorb-choice-control";
import { useShiftPlan } from "./use-shift-plan";
import { fmtDuration } from "./steps/step-hours";
import type { SnackShackWizardData, DayCode, TimeBlock } from "./wizard-types";
import { closedDayLine, type DerivedDay } from "@/lib/snack-shack/derive-shifts";
import { legacyShiftsNotice, upcomingStaleness } from "@/lib/snack-shack/regenerate-plan";
import { commitRegenerate, planFromInputs, regenerateLogMessage } from "@/lib/snack-shack/generate-shifts";
import {
  EMAIL_PROMPT,
  EMAIL_PROMPT_DETAIL,
  dayNeedsRebuildLine,
  marksToClear,
  pageNoticeHeadline,
  playsDuringLines,
  teamAssignmentsChanged,
} from "@/lib/snack-shack/stale-days";
import { clearStaleMarks, readStaleState } from "@/lib/snack-shack/stale-marks";
import { logActivity } from "@/lib/activity-log";
import { CashPeopleCard } from "./cash-people-card";
import { useShiftNoteEditor } from "./use-shift-note-editor";
import type { ShiftNoteFields, CashPerson } from "@/lib/snack-shack/shift-notes";
import { blockFlagView, type BlockFlagView } from "@/lib/snack-shack/shift-flags";
import { teamSchedulesDocument } from "@/lib/snack-shack/print";
import { SnackShackPrintRegion } from "./snack-shack-print-region";
import { peopleLabel, seasonPeople } from "@/lib/snack-shack/headcount";

type ViewMode = "list" | "calendar";

type Season = { id: string; name: string; season: string };

type Settings = {
  id: string;
  season_id: string;
  start_date: string;
  end_date: string;
  days_of_week: unknown;
  time_blocks_by_day: unknown;
  home_venue_ids: unknown;
  scheduling_preference: string;
  updated_at: string;
  open_before_min: number;
  close_after_min: number;
  max_shift_min: number;
  people_per_shift: number;
  shifts_generated_at: string | null;
};

type BlockRaw = ShiftNoteFields & {
  id: string;
  snack_shack_id: string;
  date: string;
  start_time: string;
  end_time: string;
  assigned_team_id: string | null;
  is_recurring: boolean;
  people_needed: number | null;
  team: { name: string } | null;
};

type TeamRow = { id: string; name: string; league_id: string };

interface Props {
  seasons: Season[];
  allSettings: Settings[];
  allTeams: TeamRow[];
  allBlocks: BlockRaw[];
  allCashPeople: (CashPerson & { snack_shack_id: string })[];
  currentOrgId: string;
}

function settingsToWizardData(s: Settings): SnackShackWizardData {
  return {
    season_id: s.season_id,
    start_date: s.start_date,
    end_date: s.end_date,
    days_of_week: (s.days_of_week as DayCode[]) ?? [],
    time_blocks_by_day: (s.time_blocks_by_day as Partial<Record<DayCode, TimeBlock[]>>) ?? {},
    home_venue_ids: (s.home_venue_ids as string[]) ?? [],
    scheduling_preference:
      s.scheduling_preference === "prefer_off_days" ? "prefer_off_days" : "prefer_game_days",
    open_before_min: Number(s.open_before_min),
    close_after_min: Number(s.close_after_min),
    max_shift_min: Number(s.max_shift_min),
    people_per_shift: seasonPeople(s.people_per_shift),
  };
}

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function fmtSettingsDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtStamp(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Toast = { kind: "error" | "success"; message: string; id: number };

export function SnackShackPageClient({
  seasons,
  allSettings,
  allTeams,
  allBlocks,
  allCashPeople,
  currentOrgId,
}: Props) {
  const router = useRouter();
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasons[0]?.id ?? "");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<"full" | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [previewOpen, setPreviewOpen] = useState(false);
  // B3: the days the open preview rebuilds; null = the whole season.
  const [previewDates, setPreviewDates] = useState<string[] | null>(null);
  // After a rebuild that changed team assignments: offer the existing send.
  const [emailPrompt, setEmailPrompt] = useState(false);
  const searchParams = useSearchParams();
  const reviewParam = searchParams.get("review");
  const reviewHandled = useRef(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [addOnDate, setAddOnDate] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const fullPrintRef = useRef<HTMLDivElement>(null);

  const season = seasons.find((s) => s.id === selectedSeasonId);
  const settings = allSettings.find((s) => s.season_id === selectedSeasonId) ?? null;
  const teams: TeamOption[] = allTeams
    .filter((t) => t.league_id === selectedSeasonId)
    .map((t) => ({ id: t.id, name: t.name }));
  const teamName = (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? "a team" : "unassigned");

  const blocks: BlockRow[] = allBlocks
    .filter((b) => b.snack_shack_id === settings?.id)
    .map((b) => ({
      id: b.id,
      date: b.date,
      start_time: b.start_time,
      end_time: b.end_time,
      assigned_team_id: b.assigned_team_id,
      is_recurring: b.is_recurring,
      people_needed: b.people_needed ?? null,
      team_name: b.team?.name ?? null,
      notes: b.notes ?? null,
      notes_updated_at: b.notes_updated_at ?? null,
      notes_editor: b.notes_editor ?? null,
      cash_person_id: b.cash_person_id ?? null,
      cash_person: b.cash_person ?? null,
    }));
  const cashPeople: CashPerson[] = allCashPeople
    .filter((c) => c.snack_shack_id === settings?.id)
    .map((c) => ({ id: c.id, name: c.name }));
  const cashName = (id: string | null) => (id ? cashPeople.find((c) => c.id === id)?.name ?? "a removed name" : null);
  const noteEditor = useShiftNoteEditor({ leagueId: selectedSeasonId });

  const seasonLabel = season ? `${season.name} · ${season.season}` : "";
  // 0119: the season's people per shift (1 when unset); a shift may override it.
  const peoplePerShift = seasonPeople(settings?.people_per_shift);

  // The derivation + plan. Fails loud into `planState.error`.
  const planState = useShiftPlan(settings, currentOrgId);
  const { inputs, plan } = planState;
  // The plan the preview shows and Confirm writes: the whole season, or the
  // chosen day(s) only (B3).
  const previewPlan = useMemo(
    () => (inputs ? (previewDates ? planFromInputs(inputs, previewDates) : plan) : null),
    [inputs, plan, previewDates],
  );

  const derivedByDate = useMemo(() => {
    const m = new Map<string, DerivedDay>();
    for (const d of inputs?.derivation.days ?? []) m.set(d.date, d);
    return m;
  }, [inputs]);

  const staleness = inputs ? upcomingStaleness(inputs.derivation, inputs.stored, inputs.today) : null;
  // Per-row flags (shift-flags.ts). Absent until the game schedule has loaded;
  // past rows come back null from the library and are never flagged.
  const flags = useMemo(() => {
    if (!inputs) return undefined;
    const m = new Map<string, BlockFlagView | null>();
    for (const b of blocks) m.set(b.id, blockFlagView({ index: inputs.index, preference: inputs.preference, teams, today: inputs.today, block: b }));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- blocks/teams are rebuilt every render; inputs changes when the schedule does
  }, [inputs, allBlocks, allTeams, selectedSeasonId]);
  const staleDays = staleness?.differingDates ?? [];
  // Red, named: upcoming stored shifts whose team now plays during them.
  const playsDuring = flags
    ? playsDuringLines(blocks, (id) => { const v = flags.get(id); return !!v && v.red && !v.needsTeam; }, (id) => teamName(id))
    : [];

  function openPreview(dates: string[] | null) {
    setCommitError(null);
    setPreviewDates(dates);
    setPreviewOpen(true);
  }

  // A dashboard "Review Sat, Oct 17" link lands here with ?review=…: open
  // that day's preview once the schedule is read, then drop the parameter.
  useEffect(() => {
    if (!reviewParam || reviewHandled.current || !inputs || !settings) return;
    reviewHandled.current = true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(reviewParam) && reviewParam >= inputs.today) openPreview([reviewParam]);
    router.replace("/dashboard/snack-shack");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per landing
  }, [reviewParam, inputs, settings]);

  // 0131: marks on days the real calculation doesn't flag are cleared, timed
  // to this read (a game changed after it stays marked). Best effort — the
  // page itself always shows the calculation, never the marks.
  useEffect(() => {
    if (!inputs || !settings || !staleness) return;
    let cancelled = false;
    readStaleState(settings.season_id)
      .then((st) => {
        if (cancelled || !st.snackShackId) return;
        const clear = marksToClear(st.dates, staleness.differingDates);
        if (clear.length > 0) return clearStaleMarks(st.snackShackId, clear, inputs.readAt);
      })
      .catch((e: unknown) => console.error("[snack shack] stale-day marks:", e instanceof Error ? e.message : e));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per read of the schedule
  }, [inputs]);
  const legacy = settings && inputs ? legacyShiftsNotice(settings.shifts_generated_at, inputs.stored) : null;
  const upcomingClosedDays = inputs ? inputs.derivation.closedDays.filter((c) => c.date >= inputs.today) : [];
  const hasDerived = blocks.some((b) => b.is_recurring);

  function notify(kind: Toast["kind"], message: string) {
    const id = Date.now();
    setToasts((t) => [...t, { kind, message, id }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }

  async function confirmRegenerate() {
    if (!settings || !previewPlan || !inputs) return;
    const committed = previewPlan;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await commitRegenerate(settings.id, committed.desired);
      const message = regenerateLogMessage(result, committed.frozenPast);
      await logActivity(settings.season_id, null, "snack_shack_shifts_regenerated", message);
      // 0131: the rebuilt days' marks (every day for a full regenerate), only
      // those made before the schedule was read. Not fatal: the next load
      // clears whatever the calculation no longer flags.
      clearStaleMarks(settings.id, committed.onlyDates, inputs.readAt)
        .catch((e: unknown) => console.error("[snack shack] clear marks:", e instanceof Error ? e.message : e));
      setPreviewOpen(false);
      setPreviewDates(null);
      if (teamAssignmentsChanged(committed)) setEmailPrompt(true);
      notify("success", message);
      planState.reload();
      router.refresh();
    } catch (e: unknown) {
      setCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  // Teams that have at least one shift, for the bulk per-team print
  const teamsWithBlocks = teams.filter((t) =>
    blocks.some((b) => b.assigned_team_id === t.id),
  );

  function printFullSchedule() {
    const el = fullPrintRef.current;
    if (!el) return;
    el.classList.add("print-active");
    window.print();
    el.classList.remove("print-active");
  }

  function printAllTeamSchedules() {
    if (teamsWithBlocks.length === 0) return;
    const w = window.open("", "_blank");
    if (!w) return;
    // The document is built by teamSchedulesDocument (lib/snack-shack/print.ts):
    // Date and Time only — never a cash person, never a note.
    const teamPages = teamsWithBlocks.map((team) => ({
      id: team.id,
      name: team.name,
      blocks: blocks
        .filter((b) => b.assigned_team_id === team.id)
        .map((b) => ({ date: b.date, start_time: b.start_time, end_time: b.end_time })),
    }));
    w.document.write(teamSchedulesDocument(teamPages, seasonLabel));
    w.document.close();
  }

  async function sendFullEmail(email: string) {
    if (!settings) return;
    const res = await fetch(`/api/snack-shack/${settings.id}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to send.");
  }

  const dayHeader = (date: string) => {
    const day = derivedByDate.get(date);
    const windows = day?.windows ?? [];
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-gray-600">
            <span className="font-semibold text-[#0C1F3F]">{fmtDate(date)}</span>
            {day ? (
              <span className="ml-2">
                {day.gameCount} game{day.gameCount === 1 ? "" : "s"} ·{" "}
                {windows.map((w) => `open ${fmtTime(w.shifts[0]?.start ?? "00:00")}–${fmtTime(w.shifts[w.shifts.length - 1]?.end ?? "00:00")}`).join(", closed, then ")}
              </span>
            ) : inputs ? (
              <span className="ml-2 text-gray-400">no games at your fields this day</span>
            ) : null}
          </div>
          {settings && (
            <button
              type="button"
              onClick={() => setAddOnDate(date)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 text-xs font-medium text-gray-500 hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
            >
              <Plus className="h-3 w-3" />
              Add a shift on this day
            </button>
          )}
        </div>
        {settings && windows.map((w) => (
          <AbsorbChoiceControl key={w.windowStart} snackShackId={settings.id} date={date} window={w} onChanged={planState.reload} />
        ))}
      </div>
    );
  };

  return (
    <>
      {/* Season selector */}
      {seasons.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600">Season</label>
          <select
            value={selectedSeasonId}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.season}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* No setup state */}
      {!settings ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#0C1F3F]/6">
                <ShoppingBag className="h-8 w-8 text-[#0C1F3F]/30" />
              </div>
              <p className="text-lg font-semibold text-gray-900">
                No Snack Shack set up yet
              </p>
              <p className="mt-1 max-w-xs text-sm text-gray-500">
                Set the hours, the fields the shack serves, and how teams are picked.
                Shifts are then made from the game schedule.
              </p>
              <button
                onClick={() => setWizardOpen(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
              >
                <Plus className="h-4 w-4" />
                Set up Snack Shack
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Settings summary card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Snack Shack Settings</CardTitle>
                <button
                  onClick={() => setWizardOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Edit settings
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Season dates</p>
                  <p className="mt-0.5 text-gray-900">
                    {fmtSettingsDate(settings.start_date)} → {fmtSettingsDate(settings.end_date)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Hours</p>
                  <p className="mt-0.5 text-gray-900">
                    Opens {settings.open_before_min === 0 ? "at the first game" : `${settings.open_before_min} min before the first game`},
                    closes {settings.close_after_min === 0 ? "when the last game ends" : `${settings.close_after_min} min after the last game ends`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Longest shift</p>
                  <p className="mt-0.5 text-gray-900">{fmtDuration(Number(settings.max_shift_min))}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">People per shift</p>
                  <p className="mt-0.5 text-gray-900">{peopleLabel(seasonPeople(settings.people_per_shift))}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Days</p>
                  <p className="mt-0.5 text-gray-900">
                    {((settings.days_of_week as string[]) ?? []).join(", ") || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Preference</p>
                  <p className="mt-0.5 text-gray-900">
                    {settings.scheduling_preference === "prefer_off_days" ? "Prefer off days" : "Prefer game days"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Shifts made</p>
                  <p className="mt-0.5 text-gray-900">
                    {settings.shifts_generated_at
                      ? fmtStamp(settings.shifts_generated_at)
                      : hasDerived
                      ? "Before automatic shifts"
                      : "Not yet"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notices — rendered verbatim from the library */}
          {(planState.error || planState.loading || legacy || staleDays.length > 0 || playsDuring.length > 0 || upcomingClosedDays.length > 0 ||
            (inputs && (inputs.derivation.assumedDurationGameIds.length > 0 || inputs.derivation.staleChoices.length > 0 || inputs.derivation.clampedDates.length > 0))) && (
            <div className="flex flex-col gap-2">
              {planState.loading && (
                <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-500">Checking the game schedule…</p>
              )}
              {planState.error && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Couldn&rsquo;t read the game schedule, so shifts can&rsquo;t be checked or generated: {planState.error}
                </p>
              )}
              {legacy && (
                <p className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{legacy}</span>
                </p>
              )}
              {(staleDays.length > 0 || playsDuring.length > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {staleDays.length > 0 && (
                    <>
                      <p className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>{pageNoticeHeadline(staleDays.length)}</span>
                      </p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {staleDays.map((d) => (
                          <li key={d} className="flex flex-wrap items-center justify-between gap-2">
                            <span>{dayNeedsRebuildLine(d)}</span>
                            <button
                              type="button"
                              onClick={() => openPreview([d])}
                              disabled={!inputs}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Review this day
                            </button>
                          </li>
                        ))}
                        {staleDays.length > 1 && (
                          <li className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => openPreview(null)}
                              disabled={!plan}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            >
                              Regenerate all
                            </button>
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                  {playsDuring.length > 0 && (
                    <ul className={`${staleDays.length > 0 ? "mt-2 " : ""}flex flex-col gap-0.5 font-semibold text-red-700`}>
                      {playsDuring.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {upcomingClosedDays.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Games on days the shack is not open</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {upcomingClosedDays.map((c) => (
                      <li key={c.date}>{closedDayLine(c)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {inputs && inputs.derivation.assumedDurationGameIds.length > 0 && (
                <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {inputs.derivation.assumedDurationGameIds.length} game{inputs.derivation.assumedDurationGameIds.length === 1 ? "" : "s"} in a division with no game length set — assumed 90 minutes when working out when the shack closes.
                </p>
              )}
              {inputs && inputs.derivation.staleChoices.length > 0 && (
                <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  A remembered leftover choice no longer applies on {inputs.derivation.staleChoices.map((c) => fmtDate(c.date)).join(", ")} — the schedule changed that day&rsquo;s window, so the default (add to the last shift) is used there.
                </p>
              )}
              {inputs && inputs.derivation.clampedDates.length > 0 && (
                <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  On {inputs.derivation.clampedDates.map(fmtDate).join(", ")} the last game ends so late that the shack&rsquo;s closing time was cut off at midnight.
                </p>
              )}
            </div>
          )}

          {/* Schedule */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle>Shifts</CardTitle>
                  <div className="inline-flex rounded-lg bg-gray-100 p-1">
                    {(
                      [
                        { id: "list" as const, label: "List", icon: LayoutList },
                        { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
                      ]
                    ).map((o) => {
                      const Icon = o.icon;
                      const active = viewMode === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setViewMode(o.id)}
                          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                            active
                              ? "bg-white text-[#0C1F3F] shadow-sm"
                              : "text-gray-500 hover:text-gray-700"
                          }`}
                          aria-pressed={active}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openPreview(null)}
                    disabled={!plan}
                    title={plan ? undefined : planState.error ? "The game schedule couldn't be read" : "Checking the game schedule…"}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {hasDerived ? "Regenerate shifts" : "Generate shifts"}
                  </button>
                  {blocks.length > 0 && (
                    <>
                      <button
                        onClick={printFullSchedule}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Print full schedule
                      </button>
                      <button
                        onClick={() => setEmailTarget("full")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Email full schedule
                      </button>
                      {teamsWithBlocks.length > 0 && (
                        <button
                          onClick={printAllTeamSchedules}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Print all team schedules
                        </button>
                      )}
                    </>
                  )}
                  <AddOneOffButton snackShackId={settings.id} teams={teams} peoplePerShift={peoplePerShift} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === "list" ? (
                <SnackShackSchedule
                  snackShackId={settings.id}
                  blocks={blocks}
                  teams={teams}
                  dayHeader={dayHeader}
                  cashPeople={cashPeople}
                  onEditNote={noteEditor.open}
                  flags={flags}
                  peoplePerShift={peoplePerShift}
                />
              ) : (
                <SnackShackCalendar
                  blocks={blocks}
                  teams={teams}
                  cashPeople={cashPeople}
                  peoplePerShift={peoplePerShift}
                  startDate={settings.start_date}
                  endDate={settings.end_date}
                />
              )}
            </CardContent>
          </Card>

          <CashPeopleCard snackShackId={settings.id} people={cashPeople} />
          {noteEditor.modal}
        </>
      )}

      {/* Wizard */}
      {wizardOpen && season && (
        <SnackShackWizard
          seasonId={selectedSeasonId}
          seasonName={seasonLabel}
          leagueId={selectedSeasonId}
          currentOrgId={currentOrgId}
          existingData={settings ? settingsToWizardData(settings) : undefined}
          existingId={settings?.id}
          onClose={() => setWizardOpen(false)}
          onComplete={() => {
            setWizardOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Regenerate preview — nothing is written until Confirm */}
      {previewOpen && previewPlan && settings && inputs && (
        <RegeneratePreviewModal
          plan={previewPlan}
          seasonId={settings.season_id}
          stored={inputs.stored}
          preference={inputs?.preference ?? "prefer_game_days"}
          teamName={teamName}
          cashName={cashName}
          legacyNotice={legacy}
          busy={committing}
          error={commitError}
          onConfirm={confirmRegenerate}
          onCancel={() => { if (!committing) { setPreviewOpen(false); setPreviewDates(null); } }}
        />
      )}

      {/* Per-day add */}
      {addOnDate && settings && (
        <AddOneOffModal
          snackShackId={settings.id}
          teams={teams}
          fixedDate={addOnDate}
          peoplePerShift={peoplePerShift}
          onClose={() => setAddOnDate(null)}
          onSaved={() => {
            setAddOnDate(null);
            router.refresh();
          }}
        />
      )}

      {/* After a rebuild that changed team assignments: offer the existing send */}
      {emailPrompt && settings && (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-xl sm:left-auto">
          <p className="text-sm font-semibold text-[#0C1F3F]">{EMAIL_PROMPT}</p>
          <p className="text-xs text-gray-500">{EMAIL_PROMPT_DETAIL}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEmailPrompt(false)}
              className="h-9 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:border-gray-300">
              Not now
            </button>
            <button type="button" onClick={() => { setEmailPrompt(false); setEmailTarget("full"); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 text-xs font-semibold text-white hover:bg-[#16a34a]">
              <Mail className="h-3.5 w-3.5" />
              Send updated schedule
            </button>
          </div>
        </div>
      )}

      {/* Email modal */}
      {emailTarget === "full" && settings && (
        <SnackShackEmailModal
          title="Email full schedule"
          onSend={sendFullEmail}
          onClose={() => setEmailTarget(null)}
        />
      )}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((t) => (
            <div key={t.id} className={`rounded-lg px-4 py-2 text-sm shadow-lg ${t.kind === "error" ? "bg-red-600 text-white" : "bg-[#0C1F3F] text-white"}`}>
              {t.message}
            </div>
          ))}
        </div>
      )}

      {/* ── Hidden print regions ───────────────────────────────────────────── */}

      {/* Full season schedule print region (snack-shack-print-region.tsx) */}
      <SnackShackPrintRegion ref={fullPrintRef} seasonLabel={seasonLabel} blocks={blocks} peoplePerShift={peoplePerShift} />

    </>
  );
}
