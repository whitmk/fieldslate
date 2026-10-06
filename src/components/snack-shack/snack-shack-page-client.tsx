"use client";

// The Snack Shack page. Shifts are DERIVED from the game schedule by the pure
// library (src/lib/snack-shack/derive-shifts.ts); this page loads the inputs,
// shows the plan, and writes ONLY through the preview → confirm → RPC path.
// Nothing here decides a rule. Notices (staleness, legacy, closed days,
// assumed durations, stale leftover choices) render the library's output
// verbatim.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { closedDayLine, stalenessSummary, type DerivedDay } from "@/lib/snack-shack/derive-shifts";
import { legacyShiftsNotice, upcomingStaleness } from "@/lib/snack-shack/regenerate-plan";
import { commitRegenerate, regenerateLogMessage } from "@/lib/snack-shack/generate-shifts";
import { logActivity } from "@/lib/activity-log";
import { CashPeopleCard } from "./cash-people-card";
import { useShiftNoteEditor } from "./use-shift-note-editor";
import type { ShiftNoteFields, CashPerson } from "@/lib/snack-shack/shift-notes";

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

  // The derivation + plan. Fails loud into `planState.error`.
  const planState = useShiftPlan(settings, currentOrgId);
  const { inputs, plan } = planState;

  const derivedByDate = useMemo(() => {
    const m = new Map<string, DerivedDay>();
    for (const d of inputs?.derivation.days ?? []) m.set(d.date, d);
    return m;
  }, [inputs]);

  const staleness = inputs ? upcomingStaleness(inputs.derivation, inputs.stored, inputs.today) : null;
  const stalenessLine = staleness ? stalenessSummary(staleness) : null;
  const legacy = settings && inputs ? legacyShiftsNotice(settings.shifts_generated_at, inputs.stored) : null;
  const upcomingClosedDays = inputs ? inputs.derivation.closedDays.filter((c) => c.date >= inputs.today) : [];
  const hasDerived = blocks.some((b) => b.is_recurring);

  function notify(kind: Toast["kind"], message: string) {
    const id = Date.now();
    setToasts((t) => [...t, { kind, message, id }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }

  async function confirmRegenerate() {
    if (!settings || !plan) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await commitRegenerate(settings.id, plan.desired);
      const message = regenerateLogMessage(result, plan.frozenPast);
      await logActivity(settings.season_id, null, "snack_shack_shifts_regenerated", message);
      setPreviewOpen(false);
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

    function esc(s: string) {
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    const pages = teamsWithBlocks
      .map((team) => {
        const teamBlocks = blocks.filter((b) => b.assigned_team_id === team.id);
        const rows = teamBlocks
          .map(
            (b) =>
              `<tr><td>${esc(fmtDate(b.date))}</td><td>${esc(fmtTime(b.start_time))} – ${esc(fmtTime(b.end_time))}</td></tr>`,
          )
          .join("");
        return `<div class="team-page">
  <div class="header">
    <div class="wordmark">Field<span>Slate</span></div>
    <div class="league">Snack Shack — ${esc(team.name)}</div>
    <div class="meta">${esc(seasonLabel)}</div>
  </div>
  <table><thead><tr><th>Date</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
</div>`;
      })
      .join("\n");

    w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Snack Shack — All Team Schedules</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:0;color:#0c1f3f}
  .team-page{padding:.75in;page-break-before:always;break-before:page}
  .team-page:first-child{page-break-before:auto;break-before:auto}
  .header{border-bottom:2pt solid #000;padding-bottom:12pt;margin-bottom:16pt}
  .wordmark{font-size:20pt;font-weight:800;color:#0c1f3f;letter-spacing:-.3pt;line-height:1}
  .wordmark span{color:#16a34a}
  .league{font-size:13pt;font-weight:700;color:#000;margin-top:8pt}
  .meta{font-size:8.5pt;color:#666;margin-top:6pt}
  table{width:100%;border-collapse:collapse;font-size:9.5pt;color:#000;margin-top:12pt}
  th{border:1pt solid #999;padding:4pt 8pt;background:#ebebeb;font-weight:700;text-align:left}
  td{border:1pt solid #ccc;padding:3pt 8pt}
  tbody tr:nth-child(even) td{background:#f7f7f7}
  @page{margin:0;size:letter portrait}
</style>
</head>
<body>
${pages}
<script>
  window.onload=function(){
    window.print();
    window.onafterprint=function(){window.close()};
  };
</script>
</body>
</html>`);
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
          {(planState.error || planState.loading || legacy || stalenessLine || upcomingClosedDays.length > 0 ||
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
              {stalenessLine && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{stalenessLine}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => { setCommitError(null); setPreviewOpen(true); }}
                    disabled={!plan}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Regenerate
                  </button>
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
                    onClick={() => { setCommitError(null); setPreviewOpen(true); }}
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
                  <AddOneOffButton snackShackId={settings.id} teams={teams} />
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
                />
              ) : (
                <SnackShackCalendar
                  blocks={blocks}
                  teams={teams}
                  cashPeople={cashPeople}
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
      {previewOpen && plan && settings && (
        <RegeneratePreviewModal
          plan={plan}
          teamName={teamName}
          cashName={cashName}
          legacyNotice={legacy}
          busy={committing}
          error={commitError}
          onConfirm={confirmRegenerate}
          onCancel={() => { if (!committing) setPreviewOpen(false); }}
        />
      )}

      {/* Per-day add */}
      {addOnDate && settings && (
        <AddOneOffModal
          snackShackId={settings.id}
          teams={teams}
          fixedDate={addOnDate}
          onClose={() => setAddOnDate(null)}
          onSaved={() => {
            setAddOnDate(null);
            router.refresh();
          }}
        />
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

      {/* Full season schedule print region */}
      <div ref={fullPrintRef} className="fieldslate-snack-print-ready" aria-hidden>
        <div className="fieldslate-print-header">
          <div className="fieldslate-print-wordmark">
            Field<span>Slate</span>
          </div>
          <div className="fieldslate-print-league">
            Snack Shack Schedule — {seasonLabel}
          </div>
          <div className="fieldslate-print-meta">
            Full season · {blocks.length} shift{blocks.length !== 1 ? "s" : ""}
          </div>
        </div>
        {blocks.length === 0 ? (
          <p style={{ fontSize: "10pt", color: "#666" }}>No shifts scheduled.</p>
        ) : (
          <table className="fieldslate-print-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Assigned Team</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.id}>
                  <td>{fmtDate(b.date)}</td>
                  <td>
                    {fmtTime(b.start_time)} – {fmtTime(b.end_time)}
                  </td>
                  <td>{b.team_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </>
  );
}
