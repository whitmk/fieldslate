"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, Settings2, Plus, Printer, Mail, LayoutList, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SnackShackWizard } from "./snack-shack-wizard";
import { SnackShackSchedule, AddOneOffBlockButton, type BlockRow, type TeamOption } from "./snack-shack-schedule";
import { SnackShackCalendar } from "./snack-shack-calendar";
import { SnackShackEmailModal } from "./snack-shack-email-modal";
import type { SnackShackWizardData, DayCode, TimeBlock } from "./wizard-types";

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
};

type BlockRaw = {
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

export function SnackShackPageClient({
  seasons,
  allSettings,
  allTeams,
  allBlocks,
  currentOrgId,
}: Props) {
  const router = useRouter();
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasons[0]?.id ?? "");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<"full" | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const fullPrintRef = useRef<HTMLDivElement>(null);

  const season = seasons.find((s) => s.id === selectedSeasonId);
  const settings = allSettings.find((s) => s.season_id === selectedSeasonId) ?? null;
  const teams: TeamOption[] = allTeams
    .filter((t) => t.league_id === selectedSeasonId)
    .map((t) => ({ id: t.id, name: t.name }));

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
    }));

  const seasonLabel = season ? `${season.name} · ${season.season}` : "";

  // Teams that have at least one block, for the bulk per-team print
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
                Run the setup wizard to configure dates, time blocks, home venues, and
                auto-assign teams.
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
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Open
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {fmtSettingsDate(settings.start_date)} → {fmtSettingsDate(settings.end_date)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Days
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {((settings.days_of_week as string[]) ?? []).join(", ") || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Preference
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {settings.scheduling_preference === "prefer_off_days"
                      ? "Prefer off days"
                      : "Prefer game days"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Blocks
                  </p>
                  <p className="mt-0.5 text-gray-900">
                    {blocks.length} total
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Schedule */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle>Schedule</CardTitle>
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
                  <AddOneOffBlockButton
                    snackShackId={settings.id}
                    teams={teams}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === "list" ? (
                <SnackShackSchedule
                  snackShackId={settings.id}
                  blocks={blocks}
                  teams={teams}
                />
              ) : (
                <SnackShackCalendar
                  blocks={blocks}
                  teams={teams}
                  startDate={settings.start_date}
                  endDate={settings.end_date}
                />
              )}
            </CardContent>
          </Card>
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

      {/* Email modal */}
      {emailTarget === "full" && settings && (
        <SnackShackEmailModal
          title="Email full schedule"
          onSend={sendFullEmail}
          onClose={() => setEmailTarget(null)}
        />
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
            Full season · {blocks.length} block{blocks.length !== 1 ? "s" : ""}
          </div>
        </div>
        {blocks.length === 0 ? (
          <p style={{ fontSize: "10pt", color: "#666" }}>No blocks scheduled.</p>
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
