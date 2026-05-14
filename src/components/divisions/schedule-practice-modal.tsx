"use client";

import { useState, useEffect } from "react";
import { X, CalendarDays, Loader2, CheckCircle2, AlertTriangle, Dumbbell, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity-log";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Props {
  teamId: string;
  teamName: string;
  /** ISO Monday of the week to fill, e.g. "2025-06-02" */
  weekMonday: string;
  /** Human-readable week label, e.g. "Jun 2" */
  weekLabel: string;
  divisionId: string;
  leagueId: string;
  onClose: () => void;
  onScheduled: () => void;
}

interface SlotOption {
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:MM
  venueId: string;
  venueName: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function p2(n: number) { return String(n).padStart(2, "0"); }
function localDate(d: Date) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function toMins(hhmm: string) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function minsToHHMM(m: number) { return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`; }

function fmtDate(dateStr: string) {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  return new Date(yr, mo - 1, dy, 12).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${p2(m)} ${h >= 12 ? "PM" : "AM"}`;
}

const PRACTICE_DURATION = 90; // minutes — same as generate-practices.ts
const SLOT_INTERVAL    = 60; // 1-hour grid
const DAY_START        = 6 * 60;  // 6 am
const DAY_END          = 21 * 60; // 9 pm (last start)

function buildSlots(params: {
  weekMonday: string;
  practiceSeasonStart: string;
  practiceSeasonEnd: string;
  venueIds: string[];
  venueNames: Record<string, string>;
  blackoutDates: Set<string>;
  teamGameDates: Set<string>;
  venueBookings: Map<string, number[]>;
}): SlotOption[] {
  const { weekMonday, practiceSeasonStart, practiceSeasonEnd,
          venueIds, venueNames, blackoutDates, teamGameDates, venueBookings } = params;

  const wkStart = new Date(weekMonday + "T00:00:00");
  const wkEnd   = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6);
  const seaStart = new Date(practiceSeasonStart + "T00:00:00");
  const seaEnd   = new Date(practiceSeasonEnd   + "T00:00:00");

  const cur = new Date(Math.max(wkStart.getTime(), seaStart.getTime()));
  const end = new Date(Math.min(wkEnd.getTime(),   seaEnd.getTime()));

  const slots: SlotOption[] = [];

  while (cur <= end) {
    const dateStr = localDate(cur);

    if (!blackoutDates.has(dateStr) && !teamGameDates.has(dateStr)) {
      for (const venueId of venueIds) {
        const booked = venueBookings.get(`${venueId}:${dateStr}`) ?? [];
        for (let mins = DAY_START; mins <= DAY_END; mins += SLOT_INTERVAL) {
          if (!booked.some((t) => Math.abs(t - mins) < PRACTICE_DURATION)) {
            slots.push({ date: dateStr, startTime: minsToHHMM(mins), venueId, venueName: venueNames[venueId] ?? venueId });
          }
        }
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  slots.sort((a, b) =>
    a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.venueName.localeCompare(b.venueName),
  );
  return slots;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function SchedulePracticeModal({
  teamId, teamName, weekMonday, weekLabel, divisionId, leagueId, onClose, onScheduled,
}: Props) {
  const [slots, setSlots]         = useState<SlotOption[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked]       = useState<SlotOption | null>(null);
  const [confirming, setConfirming]   = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { void loadSlots(); }, []);

  async function loadSlots() {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();

    // 1. Practice season bounds
    const { data: divRaw, error: divErr } = await supabase
      .from("divisions")
      .select("practice_season_start, practice_season_end, start_date, end_date")
      .eq("id", divisionId)
      .single();

    if (divErr || !divRaw) { setLoadError("Could not load division."); setLoading(false); return; }

    type DivRow = { practice_season_start: string | null; practice_season_end: string | null; start_date: string | null; end_date: string | null };
    const div = divRaw as unknown as DivRow;
    const practiceSeasonStart = div.practice_season_start ?? div.start_date;
    const practiceSeasonEnd   = div.practice_season_end   ?? div.end_date;

    if (!practiceSeasonStart || !practiceSeasonEnd) {
      setLoadError("Division is missing season dates.");
      setLoading(false);
      return;
    }

    // 2. Practice venues
    const { data: dvRows } = await supabase
      .from("division_venues")
      .select("venue_id, venue:venues(name)")
      .eq("division_id", divisionId)
      .eq("allow_practices", true);

    type DVRow = { venue_id: string; venue: { name: string } | null };
    const venueRows = (dvRows ?? []) as unknown as DVRow[];
    const venueIds  = venueRows.map((r) => r.venue_id);
    const venueNames: Record<string, string> = {};
    for (const r of venueRows) venueNames[r.venue_id] = r.venue?.name ?? r.venue_id;

    if (!venueIds.length) {
      setLoadError("No practice venues assigned to this division.");
      setLoading(false);
      return;
    }

    // 3. Blackout dates
    const { data: blackoutRaw } = await supabase
      .from("blackout_dates").select("date").eq("league_id", leagueId);
    const blackoutDates = new Set(((blackoutRaw ?? []) as { date: string }[]).map((b) => b.date));

    // 4. This team's game dates (any game day blocks the practice)
    const { data: teamGamesRaw } = await supabase
      .from("games")
      .select("scheduled_at")
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .neq("status", "cancelled");

    const teamGameDates = new Set(
      ((teamGamesRaw ?? []) as { scheduled_at: string }[]).map((g) => g.scheduled_at.substring(0, 10)),
    );

    // 5. Venue bookings — games + existing practices
    const venueBookings = new Map<string, number[]>();

    const { data: venueGamesRaw } = await supabase
      .from("games")
      .select("venue_id, scheduled_at")
      .in("venue_id", venueIds)
      .neq("status", "cancelled");

    for (const g of (venueGamesRaw ?? []) as { venue_id: string; scheduled_at: string }[]) {
      const vKey = `${g.venue_id}:${g.scheduled_at.substring(0, 10)}`;
      const mins = toMins(g.scheduled_at.substring(11, 16));
      if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
      venueBookings.get(vKey)!.push(mins);
    }

    const { data: existingPractices } = await supabase
      .from("practices")
      .select("venue_id, scheduled_date, start_time")
      .in("venue_id", venueIds)
      .neq("status", "cancelled");

    for (const p of (existingPractices ?? []) as { venue_id: string | null; scheduled_date: string; start_time: string }[]) {
      if (!p.venue_id) continue;
      const vKey = `${p.venue_id}:${p.scheduled_date}`;
      const mins = toMins(p.start_time);
      if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
      venueBookings.get(vKey)!.push(mins);
    }

    setSlots(buildSlots({ weekMonday, practiceSeasonStart, practiceSeasonEnd, venueIds, venueNames, blackoutDates, teamGameDates, venueBookings }));
    setLoading(false);
  }

  async function handleConfirm() {
    if (!picked) return;
    setConfirming(true);
    setConfirmError(null);
    const supabase = createClient();

    const { error } = await supabase.from("practices").insert({
      league_id:      leagueId,
      division_id:    divisionId,
      team_id:        teamId,
      venue_id:       picked.venueId,
      scheduled_date: picked.date,
      start_time:     picked.startTime,
      status:         "scheduled",
    } as never);

    if (error) { setConfirmError(error.message); setConfirming(false); return; }

    await logActivity(
      leagueId, divisionId, "practice_scheduled",
      `${teamName} practice manually scheduled for ${fmtDate(picked.date)} at ${fmtTime(picked.startTime)} — ${picked.venueName}`,
    );

    setDone(true);
    setConfirming(false);
  }

  // Group by date for display
  const grouped = new Map<string, SlotOption[]>();
  for (const s of slots) {
    if (!grouped.has(s.date)) grouped.set(s.date, []);
    grouped.get(s.date)!.push(s);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[85dvh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4 text-indigo-400" />
              <h2 className="font-semibold text-[#0C1F3F]">Schedule practice</h2>
            </div>
            <p className="mt-0.5 text-sm text-gray-500">{teamName} — week of {weekLabel}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {done ? (
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#22C55E]/10">
                <CheckCircle2 className="h-6 w-6 text-[#22C55E]" />
              </div>
              <div>
                <p className="font-semibold text-[#0C1F3F]">Practice scheduled</p>
                <p className="mt-1 text-sm text-gray-500">
                  {teamName}<br />
                  {picked && `${fmtDate(picked.date)} at ${fmtTime(picked.startTime)} — ${picked.venueName}`}
                </p>
              </div>
              <button
                onClick={() => { onScheduled(); onClose(); }}
                className="mt-2 rounded-lg bg-[#0C1F3F] px-6 py-2 text-sm font-semibold text-white hover:bg-[#0C1F3F]/80"
              >
                Done
              </button>
            </div>

          ) : picked ? (
            <div className="flex flex-col gap-5 px-6 py-6">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Date &amp; time</p>
                <p className="mt-2 text-base font-semibold text-[#0C1F3F]">
                  {fmtDate(picked.date)} at {fmtTime(picked.startTime)}
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Venue</p>
                <p className="mt-2 text-sm font-semibold text-[#0C1F3F]">{picked.venueName}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Team</p>
                <p className="mt-2 text-sm font-semibold text-[#0C1F3F]">{teamName}</p>
              </div>
              {confirmError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                  <p className="text-sm text-red-600">{confirmError}</p>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setPicked(null); setConfirmError(null); }}
                  disabled={confirming}
                  className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#22C55E] py-2.5 text-sm font-semibold text-white hover:bg-[#16a34a] disabled:opacity-60"
                >
                  {confirming ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : "Confirm"}
                </button>
              </div>
            </div>

          ) : loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              <p className="text-sm text-gray-400">Finding available slots…</p>
            </div>

          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <p className="text-sm font-medium text-gray-700">{loadError}</p>
              <button onClick={() => void loadSlots()} className="text-sm text-[#22C55E] underline underline-offset-2">
                Retry
              </button>
            </div>

          ) : slots.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <CalendarDays className="h-6 w-6 text-gray-200" />
              <p className="text-sm font-medium text-[#0C1F3F]">No open slots this week</p>
              <p className="text-xs text-gray-400">
                All practice venues are booked, or the team has games every eligible day this week.
              </p>
            </div>

          ) : (
            <div className="divide-y divide-gray-50">
              <div className="px-6 py-3">
                <p className="text-xs text-gray-400">
                  {slots.length} open slot{slots.length !== 1 ? "s" : ""} — pick one
                </p>
              </div>
              {Array.from(grouped.entries()).map(([date, daySlots]) => (
                <div key={date}>
                  <div className="bg-gray-50/70 px-6 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {fmtDate(date)}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {daySlots.map((slot) => (
                      <button
                        key={`${slot.date}:${slot.startTime}:${slot.venueId}`}
                        onClick={() => setPicked(slot)}
                        className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-16 flex-shrink-0 text-sm tabular-nums text-gray-500">
                            {fmtTime(slot.startTime)}
                          </span>
                          <span className="text-sm font-medium text-[#0C1F3F]">{slot.venueName}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
