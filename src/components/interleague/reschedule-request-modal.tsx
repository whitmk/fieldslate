"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";

export type RescheduleModalGame = {
  scheduled_at: string;
  is_away: boolean;
  external_team_name?: string | null;
  proposed_venue_name?: string | null;
  home_team?: { name: string } | null;
  venue?: { name: string } | null;
  interleague_org?: { name: string } | null;
  division?: { name: string } | null;
};

interface Props {
  title?: string;
  submitLabel?: string;
  game: RescheduleModalGame;
  /** Pre-populate from an existing proposal (e.g. when admin counters). */
  initial?: {
    scheduled_at?: string;
    venue_name?: string;
    note?: string;
  };
  busy: boolean;
  error: string | null;
  onSubmit: (payload: {
    scheduled_at: string; // wall-clock ISO
    venue_name?: string;
    note?: string;
  }) => void;
  onClose: () => void;
}

function isoToLocal(iso: string): string {
  return iso.substring(0, 16);
}
function localToWallClockIso(local: string): string {
  if (!local) return "";
  return `${local}:00+00:00`;
}

export function RescheduleRequestModal({
  title = "Request reschedule",
  submitLabel = "Send reschedule request",
  game,
  initial,
  busy,
  error,
  onSubmit,
  onClose,
}: Props) {
  const seedIso = initial?.scheduled_at ?? game.scheduled_at;
  const [datetime, setDatetime] = useState<string>(isoToLocal(seedIso));
  const [venue, setVenue] = useState<string>(
    initial?.venue_name ??
      game.proposed_venue_name ??
      game.venue?.name ??
      "",
  );
  const [note, setNote] = useState<string>(initial?.note ?? "");

  const orgName = game.interleague_org?.name ?? "the other org";
  const homeTeam = game.home_team?.name ?? "Home";
  const externalTeam = game.external_team_name ?? "TBD";
  const matchup = game.is_away
    ? `${homeTeam} AT ${orgName}${game.external_team_name ? ` (${game.external_team_name})` : ""}`
    : `${homeTeam} vs ${externalTeam}`;

  // Away games: venue text input (it's the other org's venue, free-form).
  // Home games: venue text input too — admin can override the home venue if needed.
  const venueLabel = game.is_away
    ? "Proposed venue (host org)"
    : "Venue (optional override)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#0C1F3F]">{title}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{matchup}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!datetime) return;
            onSubmit({
              scheduled_at: localToWallClockIso(datetime),
              venue_name: venue.trim() || undefined,
              note: note.trim() || undefined,
            });
          }}
          className="flex flex-col gap-4 px-6 py-5"
        >
          <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Currently
            </p>
            <p className="mt-1 text-sm text-[#0C1F3F]">
              {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
              {(game.venue?.name || game.proposed_venue_name) && (
                <>
                  {" "}·{" "}
                  <span className="text-gray-500">
                    {game.venue?.name ?? game.proposed_venue_name}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Proposed date &amp; time <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              required
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">{venueLabel}</label>
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={
                game.is_away
                  ? "e.g. Riverside Field A"
                  : game.venue?.name ?? "Same as current"
              }
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Note <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Why are you proposing this change?"
              className="resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!datetime || busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Sending…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
