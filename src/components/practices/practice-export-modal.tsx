"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Shared types (mirror the shape used by practices-page-client) ────────────

type Division = { id: string; name: string; league_id: string };
type Team = { id: string; name: string; division_id: string };
type Venue = { id: string; name: string };
type TimeSlot = {
  id: string;
  division_id: string;
  label: string;
  start_time: string;
  duration_minutes: number;
};
type PracticeSlotRow = {
  id: string;
  team_id: string;
  time_slot_id: string | null;
  field_id: string | null;
  practice_days: string[];
  notes: string | null;
};

interface Props {
  divisions: Division[];
  teams: Team[];
  practiceSlots: PracticeSlotRow[];
  timeSlots: TimeSlot[];
  venues: Venue[];
  onClose: () => void;
}

// ── Day helpers ──────────────────────────────────────────────────────────────

const DAY_ORDER: { key: string; full: string; plural: string }[] = [
  { key: "Mo", full: "Monday",    plural: "Mondays" },
  { key: "Tu", full: "Tuesday",   plural: "Tuesdays" },
  { key: "We", full: "Wednesday", plural: "Wednesdays" },
  { key: "Th", full: "Thursday",  plural: "Thursdays" },
  { key: "Fr", full: "Friday",    plural: "Fridays" },
  { key: "Sa", full: "Saturday",  plural: "Saturdays" },
  { key: "Su", full: "Sunday",    plural: "Sundays" },
];
const DAY_INDEX = new Map(DAY_ORDER.map((d, i) => [d.key, i]));

function dayFull(key: string): string {
  return DAY_ORDER.find((d) => d.key === key)?.full ?? key;
}
function dayPlural(key: string): string {
  return DAY_ORDER.find((d) => d.key === key)?.plural ?? key;
}
function sortDayKeys(keys: string[]): string[] {
  return [...keys].sort(
    (a, b) => (DAY_INDEX.get(a) ?? 99) - (DAY_INDEX.get(b) ?? 99),
  );
}
// "Mondays & Wednesdays"  | "Mondays, Wednesdays & Fridays" | "Mondays"
function daysPhrase(keys: string[]): string {
  const sorted = sortDayKeys(keys);
  const labels = sorted.map(dayPlural);
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}
// "Monday, Wednesday"
function daysCommaList(keys: string[]): string {
  return sortDayKeys(keys).map(dayFull).join(", ");
}

// ── Date / time helpers (mirrors playoff-export-modal style) ────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fmtTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDurationMin(min: number): string {
  return `${min} min`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayLong(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ── CSV / HTML helpers ──────────────────────────────────────────────────────

function csvEscape(val: string): string {
  return `"${val.replace(/"/g, '""')}"`;
}

function slugify(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Download primitives ─────────────────────────────────────────────────────

function triggerCsvDownload(csv: string, filename: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// FieldSlate's "PDF" path is the browser print dialog ("Save as PDF…") rather
// than a generated PDF file. No PDF library (jspdf, pdf-lib, react-pdf, etc.)
// is installed — see package.json. Every other "PDF/print" surface in the app
// takes the same window.print() approach:
//   • src/components/playoffs/playoff-export-modal.tsx  (bracket export)
//   • src/components/umpires/manual-print-button.tsx    (umpire schedule)
//   • src/components/umpires/auto-print-on-load.tsx     (print-all view)
//   • src/components/umpires/pay-report-modal.tsx       (umpire pay report)
// The games schedule exports (the league page's export picker modal and the
// /dashboard/export page, both driven by the shared builder in
// src/lib/schedule/sports-connect-export.ts) are CSV-only — there's no
// authoritative true-PDF baseline to align against.
//
// If a future dev wants real PDF file generation, do NOT switch just this one
// export — that'd reintroduce the inconsistency this comment exists to prevent.
// The correct path: install a library (react-pdf for layout-heavy needs,
// pdf-lib for simpler/programmatic output), then refactor every print path
// above as one coordinated change so users get the same output everywhere.
function openPrintWindow(body: string, title: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0.75in;
      font-family: Arial, Helvetica, sans-serif;
      background: white;
      color: #000;
    }
    .page-break { page-break-before: always; }
    .footer {
      margin-top: 24pt;
      padding-top: 8pt;
      border-top: 1pt solid #e5e7eb;
      font-size: 8.5pt;
      color: #666;
    }
    @media print {
      @page { margin: 0.75in; size: letter portrait; }
    }
  </style>
</head>
<body>${body}</body>
</html>`);
  win.document.close();
  setTimeout(() => {
    win.print();
  }, 300);
}

// ── Internal row shape ──────────────────────────────────────────────────────

type SlotRecord = {
  slotId: string;
  teamId: string;
  teamName: string;
  divisionId: string;
  divisionName: string;
  startTime: string;        // "HH:MM[:SS]"
  durationMinutes: number;
  timeSlotLabel: string;
  fieldName: string;
  practiceDays: string[];
  notes: string | null;
};

type CsvRow = SlotRecord & { day: string };

// ── Component ───────────────────────────────────────────────────────────────

type Format = "pdf" | "csv";
type Scope = "team" | "division" | "org";

export function PracticeExportModal({
  divisions,
  teams,
  practiceSlots,
  timeSlots,
  venues,
  onClose,
}: Props) {
  const [format, setFormat] = useState<Format | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [leagueNameById, setLeagueNameById] = useState<Map<string, string>>(
    new Map(),
  );

  // Lookups
  const divisionById = useMemo(
    () => new Map(divisions.map((d) => [d.id, d])),
    [divisions],
  );
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const timeSlotById = useMemo(
    () => new Map(timeSlots.map((t) => [t.id, t])),
    [timeSlots],
  );
  const venueById = useMemo(
    () => new Map(venues.map((v) => [v.id, v])),
    [venues],
  );

  // Build all slot records (filter out anything missing critical relations —
  // exports should never emit half-rendered rows). One record per practice
  // slot, regardless of how many days it covers.
  const allRecords = useMemo<SlotRecord[]>(() => {
    const out: SlotRecord[] = [];
    for (const ps of practiceSlots) {
      const team = teamById.get(ps.team_id);
      if (!team) continue;
      const division = divisionById.get(team.division_id);
      if (!division) continue;
      const ts = ps.time_slot_id ? timeSlotById.get(ps.time_slot_id) : null;
      if (!ts) continue;
      const field = ps.field_id ? venueById.get(ps.field_id) : null;
      if (!field) continue;
      if (ps.practice_days.length === 0) continue;
      out.push({
        slotId: ps.id,
        teamId: team.id,
        teamName: team.name,
        divisionId: division.id,
        divisionName: division.name,
        startTime: ts.start_time,
        durationMinutes: ts.duration_minutes,
        timeSlotLabel: ts.label,
        fieldName: field.name,
        practiceDays: ps.practice_days,
        notes: ps.notes,
      });
    }
    return out;
  }, [practiceSlots, teamById, divisionById, timeSlotById, venueById]);

  // Teams that have at least one practice slot — the modal never offers
  // teams the admin couldn't possibly export anything for.
  const teamsWithSlots = useMemo(() => {
    const ids = new Set(allRecords.map((r) => r.teamId));
    return teams
      .filter((t) => ids.has(t.id))
      .sort((a, b) => {
        const da = divisionById.get(a.division_id)?.name ?? "";
        const db = divisionById.get(b.division_id)?.name ?? "";
        const cmp = da.localeCompare(db);
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      });
  }, [allRecords, teams, divisionById]);

  // Divisions that have at least one practice slot — same reasoning.
  const divisionsWithSlots = useMemo(() => {
    const ids = new Set(allRecords.map((r) => r.divisionId));
    return divisions
      .filter((d) => ids.has(d.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRecords, divisions]);

  // Default selections when the user first picks a scope. Once they've
  // chosen scope, we pre-fill so "all" is the obvious starting point.
  useEffect(() => {
    if (scope === "team" && selectedTeamIds.size === 0) {
      setSelectedTeamIds(new Set(teamsWithSlots.map((t) => t.id)));
    }
    if (scope === "division" && selectedDivisionIds.size === 0) {
      setSelectedDivisionIds(new Set(divisionsWithSlots.map((d) => d.id)));
    }
  }, [
    scope,
    teamsWithSlots,
    divisionsWithSlots,
    selectedTeamIds.size,
    selectedDivisionIds.size,
  ]);

  // Load league names so the printed header can read "Spring 2026" instead
  // of a UUID. Cheap query — only fires when the modal opens.
  useEffect(() => {
    let cancelled = false;
    const leagueIds = [...new Set(divisions.map((d) => d.league_id))];
    if (leagueIds.length === 0) return;
    const supabase = createClient();
    supabase
      .from("leagues")
      .select("id, name")
      .in("id", leagueIds)
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map<string, string>();
        for (const row of (data ?? []) as { id: string; name: string }[]) {
          m.set(row.id, row.name);
        }
        setLeagueNameById(m);
      });
    return () => {
      cancelled = true;
    };
  }, [divisions]);

  // ── Selection actions ─────────────────────────────────────────────────────
  function toggleTeam(id: string) {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleDivision(id: string) {
    setSelectedDivisionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Derived: records in the current scope ─────────────────────────────────
  const scopedRecords = useMemo<SlotRecord[]>(() => {
    if (scope === "team") {
      return allRecords.filter((r) => selectedTeamIds.has(r.teamId));
    }
    if (scope === "division") {
      return allRecords.filter((r) => selectedDivisionIds.has(r.divisionId));
    }
    if (scope === "org") {
      return allRecords;
    }
    return [];
  }, [scope, allRecords, selectedTeamIds, selectedDivisionIds]);

  // ── Org-name resolution for printed headers/footers ──────────────────────
  // If every scoped record belongs to the same league, use that league's
  // name. Otherwise fall back to a generic brand label — we don't have a
  // true "org" concept, leagues are the closest thing.
  const orgName = useMemo(() => {
    const leagueIds = new Set<string>();
    for (const r of scopedRecords) {
      const div = divisionById.get(r.divisionId);
      if (div) leagueIds.add(div.league_id);
    }
    if (leagueIds.size === 1) {
      const only = [...leagueIds][0];
      return leagueNameById.get(only) ?? "FieldSlate Practices";
    }
    return "FieldSlate Practices";
  }, [scopedRecords, divisionById, leagueNameById]);

  // ── Filename ─────────────────────────────────────────────────────────────
  function buildScopeSlug(): string {
    if (scope === "team") {
      if (selectedTeamIds.size === 1) {
        const t = teamById.get([...selectedTeamIds][0]);
        return `team-${slugify(t?.name ?? "team")}`;
      }
      return "teams";
    }
    if (scope === "division") {
      if (selectedDivisionIds.size === 1) {
        const d = divisionById.get([...selectedDivisionIds][0]);
        return `division-${slugify(d?.name ?? "division")}`;
      }
      return "divisions";
    }
    return "org-wide";
  }

  // ── CSV ──────────────────────────────────────────────────────────────────
  function buildCsv(): string {
    const header = ["Division", "Team", "Day", "Time", "Duration", "Field", "Notes"]
      .map(csvEscape)
      .join(",");

    // One row per (team, day_of_week) pair. A slot with practice_days=[Mo,We]
    // expands to two rows — that's the contract documented to coaches.
    const rows: CsvRow[] = [];
    for (const r of scopedRecords) {
      for (const d of sortDayKeys(r.practiceDays)) {
        rows.push({ ...r, day: d });
      }
    }

    rows.sort((a, b) => {
      const cd = a.divisionName.localeCompare(b.divisionName);
      if (cd !== 0) return cd;
      const ct = a.teamName.localeCompare(b.teamName);
      if (ct !== 0) return ct;
      const dd = (DAY_INDEX.get(a.day) ?? 99) - (DAY_INDEX.get(b.day) ?? 99);
      if (dd !== 0) return dd;
      return a.startTime.localeCompare(b.startTime);
    });

    const body = rows
      .map((r) =>
        [
          r.divisionName,
          r.teamName,
          dayFull(r.day),
          fmtTime12(r.startTime),
          fmtDurationMin(r.durationMinutes),
          r.fieldName,
          r.notes ?? "",
        ]
          .map(csvEscape)
          .join(","),
      )
      .join("\r\n");

    return [header, body].filter(Boolean).join("\r\n");
  }

  // ── PDF builders ─────────────────────────────────────────────────────────
  function pdfFooter(): string {
    return `<div class="footer">
      Generated ${escapeHtml(todayLong())} · ${escapeHtml(orgName)}
    </div>`;
  }

  function buildPdfPerTeam(): string {
    const teamsInScope = teamsWithSlots.filter((t) => selectedTeamIds.has(t.id));
    if (teamsInScope.length === 0) {
      return `<p>No teams selected.</p>`;
    }

    return teamsInScope
      .map((team, i) => {
        const recs = scopedRecords
          .filter((r) => r.teamId === team.id)
          .sort((a, b) => {
            const dd =
              (DAY_INDEX.get(sortDayKeys(a.practiceDays)[0] ?? "") ?? 99) -
              (DAY_INDEX.get(sortDayKeys(b.practiceDays)[0] ?? "") ?? 99);
            return dd !== 0 ? dd : a.startTime.localeCompare(b.startTime);
          });

        const divName = divisionById.get(team.division_id)?.name ?? "";

        const slotLines = recs
          .map((r) => {
            const lead = `${daysPhrase(r.practiceDays)} — ${fmtTime12(
              r.startTime,
            )} (${fmtDurationMin(r.durationMinutes)}) @ ${r.fieldName}`;
            const note = r.notes
              ? `<div style="margin-left:14pt;color:#444;font-size:10pt">${escapeHtml(
                  r.notes,
                )}</div>`
              : "";
            return `<li style="margin-bottom:8pt">
              <div style="font-size:11pt;color:#0c1f3f">${escapeHtml(lead)}</div>
              ${note}
            </li>`;
          })
          .join("");

        const header = `
<div style="padding-bottom:10pt;border-bottom:2pt solid #000;margin-bottom:14pt">
  <div style="font-size:18pt;font-weight:800;color:#0c1f3f;letter-spacing:-0.3pt;line-height:1.1">
    ${escapeHtml(team.name)}
  </div>
  <div style="font-size:11pt;color:#444;margin-top:4pt">
    ${escapeHtml(divName)} · ${escapeHtml(orgName)}
  </div>
  <div style="font-size:9pt;color:#777;margin-top:6pt">Practice schedule · ${escapeHtml(
    todayLong(),
  )}</div>
</div>`;

        const body = recs.length
          ? `<ul style="list-style:disc;padding-left:18pt;margin:0">${slotLines}</ul>`
          : `<p style="font-size:11pt;color:#666">No practices scheduled.</p>`;

        return `${i > 0 ? '<div class="page-break"></div>' : ""}
${header}
${body}
${pdfFooter()}`;
      })
      .join("");
  }

  function buildDivisionSection(divisionId: string): string {
    const div = divisionById.get(divisionId);
    if (!div) return "";
    const recs = scopedRecords.filter((r) => r.divisionId === divisionId);
    if (recs.length === 0) return ""; // skip empty divisions silently

    // Sort by team then time for readability.
    recs.sort((a, b) => {
      const t = a.teamName.localeCompare(b.teamName);
      return t !== 0 ? t : a.startTime.localeCompare(b.startTime);
    });

    const header = `
<div style="padding-bottom:10pt;border-bottom:2pt solid #000;margin-bottom:14pt">
  <div style="font-size:18pt;font-weight:800;color:#0c1f3f;letter-spacing:-0.3pt;line-height:1.1">
    ${escapeHtml(div.name)}
  </div>
  <div style="font-size:11pt;color:#444;margin-top:4pt">${escapeHtml(orgName)}</div>
  <div style="font-size:9pt;color:#777;margin-top:6pt">Practice schedule · ${escapeHtml(
    todayLong(),
  )}</div>
</div>`;

    const rows = recs
      .map(
        (r, i) => `<tr style="${i % 2 === 1 ? "background:#f7f7f7" : ""}">
        <td style="border:1pt solid #ccc;padding:4pt 8pt">${escapeHtml(r.teamName)}</td>
        <td style="border:1pt solid #ccc;padding:4pt 8pt">${escapeHtml(daysCommaList(r.practiceDays))}</td>
        <td style="border:1pt solid #ccc;padding:4pt 8pt;white-space:nowrap">${fmtTime12(r.startTime)} (${fmtDurationMin(r.durationMinutes)})</td>
        <td style="border:1pt solid #ccc;padding:4pt 8pt">${escapeHtml(r.fieldName)}</td>
        <td style="border:1pt solid #ccc;padding:4pt 8pt">${escapeHtml(r.notes ?? "")}</td>
      </tr>`,
      )
      .join("");

    const table = `<table style="width:100%;border-collapse:collapse;font-size:10pt">
      <thead>
        <tr style="background:#ebebeb">
          <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Team</th>
          <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Days</th>
          <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Time</th>
          <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Field</th>
          <th style="border:1pt solid #999;padding:4pt 8pt;text-align:left">Notes</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

    return `${header}${table}${pdfFooter()}`;
  }

  function buildPdfPerDivision(divisionIds: string[]): string {
    const sections = divisionIds
      .map((id) => buildDivisionSection(id))
      .filter(Boolean);
    if (sections.length === 0) {
      return `<p>No divisions with practices to export.</p>`;
    }
    return sections
      .map((sec, i) => (i === 0 ? sec : `<div class="page-break"></div>${sec}`))
      .join("");
  }

  // ── Download handler ─────────────────────────────────────────────────────
  async function handleDownload() {
    if (!format || !scope) return;
    setBusy(true);
    try {
      const baseName = `Practice-Schedule-${buildScopeSlug()}-${todayIso()}`;

      if (format === "csv") {
        const csv = buildCsv();
        triggerCsvDownload(csv, `${baseName}.csv`);
      } else {
        let body = "";
        let title = baseName;
        if (scope === "team") {
          body = buildPdfPerTeam();
          title = "Practice Schedule";
        } else if (scope === "division") {
          const ids = divisionsWithSlots
            .filter((d) => selectedDivisionIds.has(d.id))
            .map((d) => d.id);
          body = buildPdfPerDivision(ids);
          title = "Practice Schedule";
        } else {
          // Org-wide: every division with slots, alphabetical, one per page.
          const ids = divisionsWithSlots.map((d) => d.id);
          body = buildPdfPerDivision(ids);
          title = "Practice Schedule";
        }
        openPrintWindow(body, title);
      }
    } finally {
      setBusy(false);
    }
  }

  // ── UI state guards ──────────────────────────────────────────────────────
  const scopeSelectionValid =
    scope === "org" ||
    (scope === "team" && selectedTeamIds.size > 0) ||
    (scope === "division" && selectedDivisionIds.size > 0);

  const canDownload =
    !!format && !!scope && scopeSelectionValid && scopedRecords.length > 0;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-[#0C1F3F]">Export practices</h3>
            <p className="mt-0.5 text-xs text-gray-400">
              Hand a coach-ready schedule to any team, division, or the whole
              org.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Section title="Format">
            <div className="flex flex-col gap-2">
              <RadioRow
                checked={format === "pdf"}
                onChange={() => setFormat("pdf")}
                Icon={FileText}
                label="PDF (print)"
                description="Opens a print dialog — save as PDF or send to a printer."
              />
              <RadioRow
                checked={format === "csv"}
                onChange={() => setFormat("csv")}
                Icon={FileSpreadsheet}
                label="CSV"
                description="One row per (team, day) pair — opens in any spreadsheet."
              />
            </div>
          </Section>

          <Section title="Scope">
            <div className="flex flex-col gap-2">
              <RadioRow
                checked={scope === "team"}
                onChange={() => setScope("team")}
                label="Per team"
                description="Pick one or more teams."
              />
              <RadioRow
                checked={scope === "division"}
                onChange={() => setScope("division")}
                label="Per division"
                description="Pick one or more divisions."
              />
              <RadioRow
                checked={scope === "org"}
                onChange={() => setScope("org")}
                label="Org-wide"
                description="Every division with a practice scheduled."
              />
            </div>
          </Section>

          {scope === "team" && (
            <Section title="Teams">
              {teamsWithSlots.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No teams have practice slots yet.
                </p>
              ) : (
                <CheckboxList
                  items={teamsWithSlots.map((t) => ({
                    id: t.id,
                    label: t.name,
                    sublabel: divisionById.get(t.division_id)?.name ?? "",
                  }))}
                  selected={selectedTeamIds}
                  onToggle={toggleTeam}
                  onAll={() =>
                    setSelectedTeamIds(
                      new Set(teamsWithSlots.map((t) => t.id)),
                    )
                  }
                  onClear={() => setSelectedTeamIds(new Set())}
                />
              )}
            </Section>
          )}

          {scope === "division" && (
            <Section title="Divisions">
              {divisionsWithSlots.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No divisions have practice slots yet.
                </p>
              ) : (
                <CheckboxList
                  items={divisionsWithSlots.map((d) => ({
                    id: d.id,
                    label: d.name,
                  }))}
                  selected={selectedDivisionIds}
                  onToggle={toggleDivision}
                  onAll={() =>
                    setSelectedDivisionIds(
                      new Set(divisionsWithSlots.map((d) => d.id)),
                    )
                  }
                  onClear={() => setSelectedDivisionIds(new Set())}
                />
              )}
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:text-[#0C1F3F] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h4>
      {children}
    </div>
  );
}

function RadioRow({
  checked,
  onChange,
  Icon,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  Icon?: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        checked
          ? "border-[#22C55E] bg-[#22C55E]/5"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <span
        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? "border-[#22C55E]" : "border-gray-300"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#22C55E]" />}
      </span>
      {Icon && (
        <Icon
          className={`h-4 w-4 flex-shrink-0 ${
            checked ? "text-[#16a34a]" : "text-gray-400"
          }`}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#0C1F3F]">
          {label}
        </span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </button>
  );
}

function CheckboxList({
  items,
  selected,
  onToggle,
  onAll,
  onClear,
}: {
  items: { id: string; label: string; sublabel?: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
        <span>
          {selected.size} of {items.length} selected
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onAll}
            className="font-medium text-[#16a34a] hover:underline"
          >
            All
          </button>
          <button
            type="button"
            onClick={onClear}
            className="font-medium text-gray-500 hover:text-[#0C1F3F] hover:underline"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-44 overflow-y-auto py-1">
        {items.map((it) => {
          const checked = selected.has(it.id);
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onToggle(it.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50"
            >
              <span
                className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border ${
                  checked
                    ? "border-[#22C55E] bg-[#22C55E]"
                    : "border-gray-300 bg-white"
                }`}
              >
                {checked && (
                  <svg
                    viewBox="0 0 16 16"
                    className="h-2.5 w-2.5 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <path d="M3 8 L7 12 L13 4" />
                  </svg>
                )}
              </span>
              <span className="font-medium text-[#0C1F3F]">{it.label}</span>
              {it.sublabel && (
                <span className="ml-auto text-[11px] text-gray-400">
                  {it.sublabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
