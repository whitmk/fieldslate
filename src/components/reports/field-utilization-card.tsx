"use client";

// Client wrapper for the Reports → Field utilization card.
//
// The server component (overview-reports.tsx) does ALL the math — games vs.
// placeable slots, per (division, field), via the generator's own buildSlots.
// This file only owns two bits of browser state: (a) one expandable division
// row at a time, and (b) the "View list" modal for games scheduled outside
// their venue's configured hours.
//
// UPPER BOUNDS ARE MARKED, NOT HIDDEN. A field shared by two divisions has its
// slot count overstated for each of them (buildSlots ignores the other
// division's games), so any figure derived from a shared field is an UPPER
// bound on supply and therefore a FLOOR on utilization. Those render with "up
// to"/"≥" and an explicit chip so an admin can tell a fact from a bound — the
// two must never look equally trustworthy.

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Clock, MapPin, X } from "lucide-react";
import { type DayKey } from "@/lib/venues/availability";

// ── Types passed from the server component ───────────────────────────────────

export interface FieldSupply {
  venueId: string;
  name: string;
  games: number; // demand: this division's counting games here
  slots: number | null; // supply (placeable starts); null = unknown
  pct: number | null; // games/slots; null when slots unknown or 0
  overBy: number; // max(0, games - slots); 0 when slots unknown
  // Supply is an UPPER bound because another division also has games on this
  // field, so its slots aren't all available to this one.
  approx: boolean;
  unconfigured: boolean; // venue has no configured hours
}

export interface DivisionUtilization {
  divisionId: string;
  name: string;
  teams: number;
  practices: number;
  games: number; // demand summed over known-supply fields
  slots: number; // supply summed over known-supply fields
  pct: number | null; // games/slots over known fields; null when slots 0
  overBy: number; // max(0, games - slots)
  approx: boolean; // any known field is shared ⇒ pct is a floor
  unknownGames: number; // games on fields whose supply couldn't be computed
  noSeasonDates: boolean;
  fields: FieldSupply[];
}

export interface OutsideHoursGame {
  id: string;
  scheduledAtIso: string; // raw ISO with TZ from supabase
  dateLabel: string; // pre-formatted "Sat, Aug 22"
  timeLabel: string; // pre-formatted "9:00 AM"
  dayKey: DayKey;
  venueName: string;
  venueHoursLabel: string; // "Sat: 10:00 AM – 7:00 PM" or "Closed"
  homeTeam: string;
  awayTeam: string;
  divisionName: string;
}

interface Props {
  divisions: DivisionUtilization[];
  outsideHoursGames: OutsideHoursGame[];
  outsideHoursTruncated: boolean;
  // When true, render without the outer card + title header — the host
  // (a CollapsiblePanel) supplies both.
  embedded?: boolean;
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function FieldUtilizationCard({
  divisions,
  outsideHoursGames,
  outsideHoursTruncated,
  embedded = false,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const outsideHoursCount = outsideHoursGames.length;

  const body = (
    <>
      {outsideHoursCount > 0 && (
        <div className="flex items-start gap-2.5 border-b border-amber-100 bg-amber-50/70 px-6 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            {outsideHoursCount}{" "}
            {outsideHoursCount === 1 ? "game is" : "games are"} scheduled outside
            configured venue hours.{" "}
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

      {divisions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <MapPin className="h-5 w-5 text-gray-300" />
          <p className="text-sm font-medium text-[#0b1c39]">
            No field activity yet
          </p>
          <p className="text-xs text-gray-400">
            Once games are scheduled, utilization rolls up here by division.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                  <th className="px-6 py-3">Division</th>
                  <th className="px-6 py-3 text-right">Teams</th>
                  <th className="px-6 py-3 text-right">Games</th>
                  <th className="px-6 py-3 text-right">Slots</th>
                  <th className="px-6 py-3 w-[32%]">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {divisions.map((d) => (
                  <DivisionRowView
                    key={d.divisionId}
                    d={d}
                    expanded={expandedId === d.divisionId}
                    onToggle={() =>
                      setExpandedId((cur) =>
                        cur === d.divisionId ? null : d.divisionId,
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

  if (embedded) return body;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
        <h3 className="font-semibold text-[#0b1c39]">Field utilization</h3>
        <p className="text-xs text-gray-400">
          games scheduled vs. placeable field slots
        </p>
      </div>
      {body}
    </div>
  );
}

// ── Division row + expand panel ──────────────────────────────────────────────

function DivisionRowView({
  d,
  expanded,
  onToggle,
}: {
  d: DivisionUtilization;
  expanded: boolean;
  onToggle: () => void;
}) {
  const over = d.overBy > 0;
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
            {d.name}
            {over && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600"
                title={
                  d.approx
                    ? `More games than placeable slots on the fields it uses — over by at least ${d.overBy}.`
                    : `More games than placeable slots on the fields it uses — over by ${d.overBy}.`
                }
              >
                {d.approx ? `Over by ≥${d.overBy}` : `Over by ${d.overBy}`}
              </span>
            )}
          </span>
        </td>
        <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
          {d.teams}
        </td>
        <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
          {d.games}
        </td>
        <td className="px-6 py-3.5 text-right tabular-nums text-gray-700">
          <SlotsValue d={d} />
        </td>
        <td className="px-6 py-3.5">
          <DivisionUtilizationCell d={d} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/40">
          <td colSpan={5} className="px-6 py-4">
            <FieldBreakdown d={d} />
          </td>
        </tr>
      )}
    </>
  );
}

function SlotsValue({ d }: { d: DivisionUtilization }) {
  if (d.pct === null) return <span className="text-gray-400">—</span>;
  // Upper bound — prefix "≤" so it never reads as an exact capacity.
  return (
    <span title={d.approx ? "Includes shared fields — upper bound" : undefined}>
      {d.approx ? "≤" : ""}
      {d.slots}
    </span>
  );
}

function DivisionUtilizationCell({ d }: { d: DivisionUtilization }) {
  if (d.noSeasonDates) {
    return (
      <span className="text-xs text-gray-400">
        Set season dates to measure capacity.
      </span>
    );
  }
  if (d.pct === null) {
    // No known supply — every field this division uses lacks configured hours.
    return (
      <div
        className="flex items-center justify-between gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-gray-400">
          Field hours not set — capacity unknown
        </span>
        <Link
          href="/dashboard/venues"
          className="inline-flex flex-shrink-0 items-center gap-1 text-xs text-[#22C55E] underline-offset-2 hover:underline"
        >
          <Clock className="h-3 w-3" />
          Configure hours
        </Link>
      </div>
    );
  }
  return <UtilizationBar pct={d.pct} approx={d.approx} overBy={d.overBy} free={d.slots - d.games} />;
}

// Renders the read-only per-field breakdown a division's number is built from.
function FieldBreakdown({ d }: { d: DivisionUtilization }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          By field
        </p>
        <Link
          href="/dashboard/venues"
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-[#0b1c39] transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
          onClick={(e) => e.stopPropagation()}
        >
          <Clock className="h-3 w-3" />
          Edit venue hours →
        </Link>
      </div>

      <ul className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
        {d.fields.map((f) => (
          <li
            key={f.venueId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
          >
            <span className="flex items-center gap-2 font-medium text-[#0b1c39]">
              {f.name}
              {f.approx && (
                <span
                  className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-600"
                  title="Another division also has games on this field, so these slots aren't all available here. The count is an upper bound and the % is a floor (actual utilization is higher)."
                >
                  shared — upper bound
                </span>
              )}
            </span>
            <span className="tabular-nums text-gray-600">
              {f.unconfigured ? (
                <span className="inline-flex items-center gap-1 text-gray-400">
                  {f.games} {f.games === 1 ? "game" : "games"} · hours not set
                </span>
              ) : f.slots === null ? (
                <span className="text-gray-400">
                  {f.games} {f.games === 1 ? "game" : "games"} · no season dates
                </span>
              ) : (
                <>
                  {f.games} / {f.approx ? "≤" : ""}
                  {f.slots} slots
                  {f.pct !== null && (
                    <span
                      className={`ml-2 font-medium ${
                        f.overBy > 0 ? "text-red-600" : "text-gray-500"
                      }`}
                    >
                      {f.approx ? "≥" : ""}
                      {f.pct}%
                    </span>
                  )}
                  {f.overBy > 0 && (
                    <span className="ml-2 text-red-600">
                      {f.approx ? `≥${f.overBy}` : f.overBy} over
                    </span>
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {d.unknownGames > 0 && (
        <p className="text-xs text-gray-400">
          {d.unknownGames} more{" "}
          {d.unknownGames === 1 ? "game is" : "games are"} on fields without
          configured hours and aren&rsquo;t counted in the % above.
        </p>
      )}

      <p className="text-xs text-gray-400">
        {d.practices} practice{" "}
        {d.practices === 1 ? "definition" : "definitions"} on these fields —
        shown for reference; practices don&rsquo;t consume game slots.
      </p>
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
                      {g.homeTeam} <span className="text-gray-400">vs</span>{" "}
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

function UtilizationLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-gray-100 bg-gray-50/40 px-6 py-3 text-[11px] text-gray-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#EF9F27]" />
        Under 40% — room to spare
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#639922]" />
        40–85% — healthy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-[#E24B4A]" />
        Over 85% — at capacity
      </span>
      <span className="inline-flex items-center gap-1.5 text-gray-400">
        <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
        Shared field — slots are an upper bound, % a floor
      </span>
    </div>
  );
}

function UtilizationBar({
  pct,
  approx,
  overBy,
  free,
}: {
  pct: number;
  approx: boolean;
  overBy: number;
  free: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = utilizationColor(pct);
  const delta =
    overBy > 0
      ? `${approx ? "≥" : ""}${overBy} over`
      : `${approx ? "up to " : ""}${free} free`;
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
      <span className="min-w-[54px] text-right text-xs tabular-nums text-gray-500">
        {approx ? "≥" : ""}
        {pct}%
      </span>
      <span className="hidden min-w-[64px] text-right text-[11px] tabular-nums text-gray-400 sm:inline">
        {delta}
      </span>
    </div>
  );
}

function utilizationColor(pct: number): string {
  if (pct < 40) return "#EF9F27";
  if (pct <= 85) return "#639922";
  return "#E24B4A";
}
