"use client";

// Client wrapper for the Reports → Field utilization card.
//
// Lives separately from overview-reports.tsx because two interactions need
// browser state: (a) one expandable row at a time, and (b) the "View list"
// modal that surfaces games scheduled outside their venue's configured hours.
// The server component still does all the math; this file just owns the
// open/close UI.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  MapPin,
  X,
} from "lucide-react";
import {
  DAY_KEYS,
  DAY_LABELS,
  type DayKey,
  type VenueAvailability,
} from "@/lib/venues/availability";

// ── Types passed from the server component ───────────────────────────────────

export interface UtilizationRow {
  venueId: string;
  name: string;
  games: number;
  practices: number;
  pct: number | null;       // null when unconfigured
  rawPct: number | null;    // pre-cap (for the over-capacity tooltip)
  overCapacity: boolean;
  unconfigured: boolean;
  availability: VenueAvailability;
}

export interface OutsideHoursGame {
  id: string;
  scheduledAtIso: string; // raw ISO with TZ from supabase
  dateLabel: string;       // pre-formatted "Sat, Aug 22"
  timeLabel: string;       // pre-formatted "9:00 AM"
  dayKey: DayKey;
  venueName: string;
  venueHoursLabel: string; // "Sat: 10:00 AM – 7:00 PM" or "Closed"
  homeTeam: string;
  awayTeam: string;
  divisionName: string;
}

interface Props {
  rows: UtilizationRow[];
  weeksLabel: string;       // pre-formatted ("10 weeks in season" or "season dates not set")
  outsideHoursGames: OutsideHoursGame[];
  outsideHoursTruncated: boolean;
  // When true, render without the outer card + title header — the host
  // (a CollapsiblePanel) supplies both. All interactive behavior (row expand,
  // out-of-hours modal) is identical either way.
  embedded?: boolean;
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function FieldUtilizationCard({
  rows,
  weeksLabel,
  outsideHoursGames,
  outsideHoursTruncated,
  embedded = false,
}: Props) {
  const [expandedVenueId, setExpandedVenueId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const outsideHoursCount = outsideHoursGames.length;

  const body = (
    <>
      {/* Out-of-hours warning row */}
      {outsideHoursCount > 0 && (
        <div className="flex items-start gap-2.5 border-b border-amber-100 bg-amber-50/70 px-6 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            {outsideHoursCount}{" "}
            {outsideHoursCount === 1 ? "game is" : "games are"} scheduled
            outside configured venue hours.{" "}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="text-amber-900 underline underline-offset-2 hover:text-amber-950"
            >
              View list
            </button>
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <MapPin className="h-5 w-5 text-gray-300" />
          <p className="text-sm font-medium text-[#0b1c39]">
            No field activity yet
          </p>
          <p className="text-xs text-gray-400">
            Once games and practices are scheduled, utilization rolls up here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                  <th className="px-6 py-3">Field</th>
                  <th className="px-6 py-3 text-right">Games</th>
                  <th className="px-6 py-3 text-right">Practices</th>
                  <th className="px-6 py-3 w-[35%]">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row) => (
                  <UtilizationRowView
                    key={row.venueId}
                    row={row}
                    expanded={expandedVenueId === row.venueId}
                    onToggle={() =>
                      setExpandedVenueId((cur) =>
                        cur === row.venueId ? null : row.venueId,
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <UtilizationLegend />
        </>
      )}

      {modalOpen && (
        <OutsideHoursModal
          games={outsideHoursGames}
          truncated={outsideHoursTruncated}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );

  // Embedded: the CollapsiblePanel host owns the card chrome + title.
  if (embedded) return body;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
        <h3 className="font-semibold text-[#0b1c39]">Field utilization</h3>
        <p className="text-xs text-gray-400">
          % of game capacity in use · {weeksLabel}
        </p>
      </div>
      {body}
    </div>
  );
}

// ── Row + expand panel ───────────────────────────────────────────────────────

function UtilizationRowView({
  row,
  expanded,
  onToggle,
}: {
  row: UtilizationRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer transition-colors hover:bg-gray-50/40"
        aria-expanded={expanded}
      >
        <td className="px-6 py-3.5 font-medium text-[#0b1c39]">
          <span className="inline-flex items-center gap-2">
            <ChevronDown
              className={`h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            {row.name}
            {row.overCapacity && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600"
                title={`Used hours exceed capacity (${row.rawPct}%).`}
              >
                Over capacity
              </span>
            )}
          </span>
        </td>
        <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
          {row.games}
        </td>
        <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
          {row.practices}
        </td>
        <td className="px-6 py-3.5">
          {row.unconfigured ? (
            <ConfigureHoursCell />
          ) : (
            <ProgressBarWithLabel pct={row.pct ?? 0} />
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/40">
          <td colSpan={4} className="px-6 py-4">
            <ExpandedHoursPanel row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedHoursPanel({ row }: { row: UtilizationRow }) {
  const openDays = DAY_KEYS.filter((k) => row.availability[k]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Configured hours
        </p>
        {openDays.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No hours configured yet.
          </p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {DAY_KEYS.map((k) => {
              const w = row.availability[k];
              return (
                <li
                  key={k}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="font-medium text-[#0b1c39]">
                    {DAY_LABELS[k]}
                  </span>
                  <span className={w ? "text-gray-600" : "text-gray-300"}>
                    {w ? `${fmt12(w.start)} – ${fmt12(w.end)}` : "Closed"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Link
        href="/dashboard/venues"
        className="inline-flex flex-shrink-0 items-center gap-1.5 self-start rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-[#0b1c39] transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
        onClick={(e) => e.stopPropagation()}
      >
        <Clock className="h-3 w-3" />
        Edit hours →
      </Link>
    </div>
  );
}

// ── Outside-hours modal ──────────────────────────────────────────────────────

function OutsideHoursModal({
  games,
  truncated,
  onClose,
}: {
  games: OutsideHoursGame[];
  truncated: boolean;
  onClose: () => void;
}) {
  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="font-semibold text-[#0b1c39]">
                Events scheduled outside venue hours
              </h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              These games are scheduled at times their venue isn&rsquo;t
              configured to be open. Move the game or widen the venue&rsquo;s
              hours to clear the warning.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {games.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-400">
              No games to show.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                  <th className="px-6 py-3">Game</th>
                  <th className="px-6 py-3">Division</th>
                  <th className="px-6 py-3">Venue</th>
                  <th className="px-6 py-3">Scheduled</th>
                  <th className="px-6 py-3">Venue hours that day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {games.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50/40">
                    <td className="px-6 py-3 font-medium text-[#0b1c39]">
                      {g.homeTeam}{" "}
                      <span className="text-gray-400">vs</span>{" "}
                      {g.awayTeam}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {g.divisionName || "—"}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{g.venueName}</td>
                    <td className="px-6 py-3 text-gray-600 tabular-nums">
                      {g.dateLabel} · {g.timeLabel}
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {g.venueHoursLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {truncated && (
          <div className="flex-shrink-0 border-t border-gray-100 bg-gray-50/70 px-6 py-3 text-xs text-gray-500">
            Showing first {games.length} entries — additional games exist but
            were truncated.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfigureHoursCell() {
  return (
    <div
      className="flex items-center justify-between gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-sm text-gray-400">—</span>
      <Link
        href="/dashboard/venues"
        className="inline-flex items-center gap-1 text-xs text-[#22C55E] underline-offset-2 hover:underline"
      >
        <Clock className="h-3 w-3" />
        Configure hours
      </Link>
    </div>
  );
}

function UtilizationLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-gray-100 bg-gray-50/40 px-6 py-3 text-[11px] text-gray-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#EF9F27]" />
        Under 40% — underused
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#639922]" />
        40–85% — healthy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#E24B4A]" />
        Over 85% — at capacity
      </span>
    </div>
  );
}

function ProgressBarWithLabel({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = utilizationColor(pct);
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-gray-100"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-[3px]"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className="min-w-[36px] text-right text-xs tabular-nums text-gray-500">
        {pct}%
      </span>
    </div>
  );
}

function utilizationColor(pct: number): string {
  if (pct < 40) return "#EF9F27";
  if (pct <= 85) return "#639922";
  return "#E24B4A";
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
