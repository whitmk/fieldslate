"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import { RescheduleRequestModal } from "./reschedule-request-modal";

interface GameForAction {
  id: string;
  scheduled_at: string;
  is_away: boolean;
  external_team_name: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string };
  division: { name: string };
  venue: { name: string } | null;
  interleague_org: { name: string } | null;
}

interface Props {
  scheduleToken: string;
  game: GameForAction;
}

export function ScheduleGameActions({ scheduleToken, game }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(payload: {
    scheduled_at: string;
    venue_name?: string;
    note?: string;
  }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/schedule/${encodeURIComponent(scheduleToken)}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game_id: game.id, ...payload }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send request.");
        setBusy(false);
        return;
      }
      setDone(true);
      setOpen(false);
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
        Reschedule requested
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-[#22C55E]/40 hover:text-[#22C55E]"
      >
        <Repeat className="h-3 w-3" />
        Request reschedule
      </button>
      {open && (
        <RescheduleRequestModal
          game={game}
          busy={busy}
          error={error}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
