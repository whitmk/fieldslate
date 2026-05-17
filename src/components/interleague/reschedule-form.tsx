"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, MapPin, X } from "lucide-react";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";

export type RescheduleRequestPayload = {
  request: {
    id: string;
    status: string;
    proposed_scheduled_at: string;
    proposed_venue_name: string | null;
    note: string | null;
    requested_by_side: "fieldslate" | "external";
  };
  sender: { full_name: string | null; email: string | null } | null;
  game: {
    id: string;
    scheduled_at: string;
    is_away: boolean;
    external_team_name: string | null;
    proposed_venue_name: string | null;
    home_team: { name: string };
    division: { name: string };
    venue: { name: string } | null;
    interleague_org: { name: string } | null;
  };
  season: { name: string; season: string | null };
};

interface Props {
  token: string;
  payload: RescheduleRequestPayload;
}

function isoToLocal(iso: string): string {
  return iso.substring(0, 16);
}
function localToWallClockIso(local: string): string {
  if (!local) return "";
  return `${local}:00+00:00`;
}

export function RescheduleForm({ token, payload }: Props) {
  const { request, sender, game } = payload;
  const orgName = game.interleague_org?.name ?? "the other league";
  const senderName =
    sender?.full_name?.trim() || sender?.email || "The FieldSlate admin";

  // Recipient sees the matchup from their perspective. is_away on our side
  // means they're hosting (HOME for them).
  const recipientIsHome = game.is_away;
  const matchup = `${game.external_team_name ?? "Your team"} vs ${game.home_team.name}`;

  const currentVenue =
    game.venue?.name ?? game.proposed_venue_name ?? (game.is_away ? "Your venue" : "TBD");
  const proposedVenue = request.proposed_venue_name ?? currentVenue;

  const [busy, setBusy] = useState<"accept" | "decline" | "counter" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"accept" | "decline" | "counter" | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterDate, setCounterDate] = useState<string>(
    isoToLocal(request.proposed_scheduled_at),
  );
  const [counterVenue, setCounterVenue] = useState<string>(proposedVenue ?? "");
  const [counterNote, setCounterNote] = useState<string>("");

  async function postAction(payload: {
    action: "accept" | "decline" | "counter";
    scheduled_at?: string;
    venue_name?: string;
    note?: string;
  }) {
    setError(null);
    setBusy(payload.action);
    try {
      const res = await fetch(`/api/reschedule/${encodeURIComponent(token)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setBusy(null);
        return;
      }
      setDone(payload.action);
      setCounterOpen(false);
      setBusy(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setBusy(null);
    }
  }

  if (done) {
    const titles = {
      accept: "Change accepted",
      decline: "Change declined",
      counter: "Counter-proposal sent",
    };
    const messages = {
      accept: `${senderName} has been notified. The game has been moved to the new time.`,
      decline: `${senderName} has been notified. The game stays at its original time.`,
      counter: `${senderName} will review your proposal and confirm.`,
    };
    return (
      <div className="rounded-2xl border border-[#22C55E]/30 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <Check className="h-7 w-7 text-[#22C55E]" />
        </div>
        <h2 className="text-xl font-semibold text-[#0C1F3F]">{titles[done]}</h2>
        <p className="mt-2 text-sm text-gray-600">{messages[done]}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-[#0C1F3F]">{matchup}</h2>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              recipientIsHome ? "bg-[#22C55E]/10 text-[#16a34a]" : "bg-blue-50 text-blue-600"
            }`}
          >
            {recipientIsHome ? "Home" : "Away"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          {game.division.name} · {orgName}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Current
            </p>
            <p className="mt-1 text-sm font-semibold text-[#0C1F3F]">
              {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="h-3 w-3" />
              {currentVenue}
            </p>
          </div>
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Proposed
            </p>
            <p className="mt-1 text-sm font-semibold text-[#0C1F3F]">
              {fmtGameDate(request.proposed_scheduled_at)},{" "}
              {fmtGameTime(request.proposed_scheduled_at)}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="h-3 w-3" />
              {request.proposed_venue_name ?? currentVenue}
            </p>
          </div>
        </div>

        {request.note && (
          <div className="mt-4 rounded-lg border-l-4 border-[#22C55E] bg-gray-50/80 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Note from {senderName}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[#0C1F3F]">
              {request.note}
            </p>
          </div>
        )}
      </section>

      {error && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => postAction({ action: "accept" })}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
        >
          {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Accept change
        </button>
        <button
          type="button"
          onClick={() => setCounterOpen(true)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
        >
          <ArrowRight className="h-4 w-4" />
          Counter-propose
        </button>
        <button
          type="button"
          onClick={() => postAction({ action: "decline" })}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:border-red-300 hover:text-red-500 disabled:opacity-50"
        >
          {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          Decline change
        </button>
      </div>

      {counterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) =>
            e.target === e.currentTarget && busy !== "counter" && setCounterOpen(false)
          }
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-base font-semibold text-[#0C1F3F]">
                Suggest a different time
              </h3>
              <button
                onClick={() => setCounterOpen(false)}
                disabled={busy === "counter"}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!counterDate) return;
                void postAction({
                  action: "counter",
                  scheduled_at: localToWallClockIso(counterDate),
                  venue_name: counterVenue.trim() || undefined,
                  note: counterNote.trim() || undefined,
                });
              }}
              className="flex flex-col gap-4 px-6 py-5"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">
                  Proposed date &amp; time <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={counterDate}
                  onChange={(e) => setCounterDate(e.target.value)}
                  required
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">
                  Venue <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={counterVenue}
                  onChange={(e) => setCounterVenue(e.target.value)}
                  placeholder={
                    request.proposed_venue_name ?? currentVenue ?? "e.g. Riverside Field A"
                  }
                  className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">
                  Note <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={counterNote}
                  onChange={(e) => setCounterNote(e.target.value)}
                  rows={3}
                  placeholder="Anything you want them to know…"
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
                  onClick={() => setCounterOpen(false)}
                  disabled={busy === "counter"}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!counterDate || busy === "counter"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
                >
                  {busy === "counter" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Send counter-proposal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function RescheduleNotFound({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-50">
        <AlertTriangle className="h-5 w-5 text-yellow-500" />
      </div>
      <h1 className="text-lg font-semibold text-[#0C1F3F]">
        Reschedule request not available
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {message ??
          "This link may have expired or already been resolved. Reach out to the league admin who shared it for a fresh link."}
      </p>
    </div>
  );
}
