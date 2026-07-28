"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Ban, Check, Loader2, MapPin, Send, Trophy, X } from "lucide-react";
import { fmtGameDate, fmtGameTime } from "@/lib/utils/game-time";
import { qualifiedVenueLabel } from "@/lib/venues/venue-label";

export type PendingGame = {
  id: string;
  scheduled_at: string;
  is_away: boolean;
  external_team_name: string | null;
  proposed_scheduled_at: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string };
  division: { id: string; name: string };
  venue: { name: string; location: { name: string } | null } | null;
};

type Action = "accept" | "counter" | "decline";

type GameState = {
  team_name: string;
  venue_name: string;          // away only
  action: Action;
  proposed_iso: string;        // datetime-local value when countering
};

interface Props {
  token: string;
  senderName: string;
  seasonLabel: string;
  orgName: string;
  games: PendingGame[];
}

/**
 * Times in the DB use the codebase's wall-clock UTC convention: a value like
 * "2026-05-23T09:00:00+00:00" means 9:00 AM in the season's local time, with
 * the +00:00 acting as a literal marker (no timezone conversion intended).
 * So every formatter / picker round-trip here must avoid `new Date()`-driven
 * UTC shifts and operate on the raw substring instead.
 */

/** Strip the time half off and convert to the format <input type="datetime-local"> expects. */
function isoToLocalDatetime(iso: string): string {
  // "2026-05-23T09:00:00+00:00" → "2026-05-23T09:00"
  return iso.substring(0, 16);
}

/** Convert a datetime-local value back to a wall-clock-UTC ISO string. */
function localDatetimeToIso(local: string): string {
  if (!local) return "";
  // Append ":00+00:00" so Postgres reads the literal wall clock without applying
  // the user's browser timezone offset. Treating the +00:00 as a literal keeps
  // the value symmetric with how the generator stores schedule_at.
  return `${local}:00+00:00`;
}

export function InviteForm({
  token,
  senderName,
  seasonLabel,
  orgName,
  games,
}: Props) {
  const [responses, setResponses] = useState<Record<string, GameState>>(() => {
    const init: Record<string, GameState> = {};
    for (const g of games) {
      init[g.id] = {
        team_name: g.external_team_name ?? "",
        venue_name: g.proposed_venue_name ?? "",
        action: "accept",
        proposed_iso: isoToLocalDatetime(g.proposed_scheduled_at ?? g.scheduled_at),
      };
    }
    return init;
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    | { kind: "submitted"; accepted: number; countered: number; declined: number }
    | { kind: "declined_all" }
    | null
  >(null);

  // Decline-entire-invite modal state
  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [decliningAll, setDecliningAll] = useState(false);

  const { homeGames, awayGames } = useMemo(() => {
    const home: PendingGame[] = [];
    const away: PendingGame[] = [];
    for (const g of games) (g.is_away ? away : home).push(g);
    return { homeGames: home, awayGames: away };
  }, [games]);

  function patch(id: string, partial: Partial<GameState>) {
    setResponses((prev) => ({ ...prev, [id]: { ...prev[id], ...partial } }));
  }

  // Per-action validation: declined games skip the team/venue/time requirements.
  const allTeamsFilled = games.every((g) => {
    const r = responses[g.id];
    if (!r || r.action === "decline") return true;
    return r.team_name.trim().length > 0;
  });
  const allAwayVenuesFilled = awayGames.every((g) => {
    const r = responses[g.id];
    if (!r || r.action === "decline") return true;
    return r.venue_name.trim().length > 0;
  });
  const allCountersHaveTime = games.every((g) => {
    const r = responses[g.id];
    if (!r) return true;
    if (r.action !== "counter") return true;
    return !!r.proposed_iso;
  });

  const canSubmit =
    games.length > 0 &&
    allTeamsFilled &&
    allAwayVenuesFilled &&
    allCountersHaveTime &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const payload = games.map((g) => {
      const r = responses[g.id];
      return {
        game_id: g.id,
        team_name: r.action === "decline" ? "" : r.team_name.trim(),
        action: r.action,
        venue_name:
          r.action === "decline"
            ? undefined
            : g.is_away
              ? r.venue_name.trim() || undefined
              : undefined,
        proposed_scheduled_at:
          r.action === "counter" && r.proposed_iso
            ? localDatetimeToIso(r.proposed_iso)
            : undefined,
      };
    });

    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      // Don't call router.refresh() here — the invite is now flipped to
      // 'accepted', so a server re-fetch would render the InviteNotFound
      // screen on top of the success state.
      setSuccess({
        kind: "submitted",
        accepted: Number(data.accepted ?? 0),
        countered: Number(data.countered ?? 0),
        declined: Number(data.declined ?? 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleDeclineAll() {
    setDecliningAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setDecliningAll(false);
        return;
      }
      setDeclineModalOpen(false);
      setSuccess({ kind: "declined_all" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
      setDecliningAll(false);
    }
  }

  if (games.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <h2 className="text-base font-semibold text-[#0C1F3F]">
          No games proposed yet
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {senderName} hasn&apos;t generated the season schedule yet. They&apos;ll
          re-send the invite once games are ready.
        </p>
      </div>
    );
  }

  if (success) {
    if (success.kind === "declined_all") {
      return (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
            <Ban className="h-7 w-7 text-gray-500" />
          </div>
          <h2 className="text-xl font-semibold text-[#0C1F3F]">
            Thanks for letting us know.
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {senderName} has been notified that {orgName} is declining the invite.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-[#22C55E]/30 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <Check className="h-7 w-7 text-[#22C55E]" />
        </div>
        <h2 className="text-xl font-semibold text-[#0C1F3F]">Thanks!</h2>
        <p className="mt-2 text-sm text-gray-600">
          {senderName} will be notified and games will be added to the schedule.
        </p>
        {success.countered > 0 && (
          <p className="mt-2 text-xs text-amber-600">
            {success.countered} game{success.countered === 1 ? "" : "s"} you suggested a different time for
            will stay tentative until {senderName} reviews them.
          </p>
        )}
        {success.declined > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {success.declined} game{success.declined === 1 ? "" : "s"} you declined will be removed from the schedule.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <p className="text-sm text-gray-500">
        {senderName} pre-scheduled the games below against {orgName} for{" "}
        {seasonLabel}. For each one, enter your team and either accept the
        proposed slot or suggest a different time. Counter-proposals stay
        tentative until {senderName} reviews them.
      </p>

      {homeGames.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[#22C55E]" />
            <h2 className="text-base font-semibold text-[#0C1F3F]">
              Games hosted by {senderName}
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            You&apos;ll travel to play these games at {senderName}&apos;s venues.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            {homeGames.map((g) => (
              <GameRow
                key={g.id}
                game={g}
                state={responses[g.id]}
                onChange={(partial) => patch(g.id, partial)}
              />
            ))}
          </div>
        </section>
      )}

      {awayGames.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#22C55E]" />
            <h2 className="text-base font-semibold text-[#0C1F3F]">
              Games hosted by {orgName}
            </h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {senderName}&apos;s teams will travel to your venue. Enter the venue you&apos;ll host at and adjust the date/time if needed.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            {awayGames.map((g) => (
              <GameRow
                key={g.id}
                game={g}
                state={responses[g.id]}
                onChange={(partial) => patch(g.id, partial)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        {!allTeamsFilled && (
          <p className="text-xs text-amber-600">
            Fill in a team name for every game before submitting.
          </p>
        )}
        {allTeamsFilled && !allAwayVenuesFilled && (
          <p className="text-xs text-amber-600">
            Provide a venue for every away game (where {orgName} hosts).
          </p>
        )}
        {allTeamsFilled && allAwayVenuesFilled && !allCountersHaveTime && (
          <p className="text-xs text-amber-600">
            Pick a date/time for every game where you chose &ldquo;Suggest different&rdquo;.
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#22C55E] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {submitting ? "Submitting…" : "Submit response"}
        </button>
        <p className="text-center text-[11px] text-gray-400">
          You can only submit a response once. Counter-proposed games stay
          tentative until {senderName} confirms.
        </p>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setDeclineReason("");
            setDeclineModalOpen(true);
          }}
          className="text-xs font-medium text-gray-400 underline-offset-2 hover:text-red-500 hover:underline"
        >
          Decline this invite
        </button>
      </div>

      {declineModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) =>
            e.target === e.currentTarget && !decliningAll && setDeclineModalOpen(false)
          }
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <h2 className="text-base font-semibold text-[#0C1F3F]">
                  Decline this invite?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDeclineModalOpen(false)}
                disabled={decliningAll}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4 px-6 py-5">
              <p className="text-sm text-gray-600">
                Are you sure you want to decline this interleague invitation?
                This will cancel all proposed games.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">
                  Reason for declining{" "}
                  <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="A short note to share with the league admin…"
                  rows={3}
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
                  onClick={() => setDeclineModalOpen(false)}
                  disabled={decliningAll}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeclineAll}
                  disabled={decliningAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  {decliningAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Ban className="h-3.5 w-3.5" />
                  )}
                  {decliningAll ? "Declining…" : "Decline invite"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

interface GameRowProps {
  game: PendingGame;
  state: GameState;
  onChange: (partial: Partial<GameState>) => void;
}

function GameRow({ game, state, onChange }: GameRowProps) {
  const isCounter = state.action === "counter";
  const isDeclined = state.action === "decline";
  const counterLabel = game.is_away ? "Suggest different date" : "Suggest different time";
  const acceptLabel = game.is_away ? "Accept this date" : "Accept";

  const containerClass = isDeclined
    ? "rounded-xl border p-4 transition-colors border-gray-200 bg-gray-100/60"
    : isCounter
      ? "rounded-xl border p-4 transition-colors border-amber-200 bg-amber-50/40"
      : "rounded-xl border p-4 transition-colors border-gray-100 bg-gray-50/60";

  return (
    <div className={containerClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-sm font-semibold ${
              isDeclined ? "text-gray-400 line-through" : "text-[#0C1F3F]"
            }`}
          >
            {game.home_team.name}
            <span className="mx-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
              {game.is_away ? "AT" : "vs"}
            </span>
            <span className={isDeclined ? "text-gray-400" : "text-gray-600"}>
              your team
            </span>
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {game.division.name} · {fmtGameDate(game.scheduled_at)}, {fmtGameTime(game.scheduled_at)}
            {game.venue && !game.is_away && (
              <> · {qualifiedVenueLabel(game.venue)}</>
            )}
            {game.is_away && (
              <> · at your venue</>
            )}
          </p>
        </div>
        {isDeclined && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-600">
            <Ban className="h-3 w-3" />
            Declining
          </span>
        )}
      </div>

      {!isDeclined && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Your team
            </label>
            <input
              type="text"
              value={state.team_name}
              onChange={(e) => onChange({ team_name: e.target.value })}
              required
              placeholder="e.g. Wildcats"
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          {game.is_away && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Your venue
              </label>
              <input
                type="text"
                value={state.venue_name}
                onChange={(e) => onChange({ venue_name: e.target.value })}
                required
                placeholder="e.g. Riverside Field A"
                className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <div className="inline-flex w-full flex-wrap rounded-lg border border-gray-200 bg-white p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => onChange({ action: "accept" })}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
              state.action === "accept"
                ? "bg-[#22C55E] text-white"
                : "text-gray-500 hover:text-[#0C1F3F]"
            }`}
          >
            {acceptLabel}
          </button>
          <button
            type="button"
            onClick={() => onChange({ action: "counter" })}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
              isCounter
                ? "bg-amber-500 text-white"
                : "text-gray-500 hover:text-[#0C1F3F]"
            }`}
          >
            {counterLabel}
          </button>
          <button
            type="button"
            onClick={() => onChange({ action: "decline" })}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
              isDeclined
                ? "bg-red-500 text-white"
                : "text-gray-500 hover:text-red-500"
            }`}
          >
            Decline this game
          </button>
        </div>

        {isCounter && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Your proposed {game.is_away ? "date and time" : "time"}
            </label>
            <input
              type="datetime-local"
              value={state.proposed_iso}
              onChange={(e) => onChange({ proposed_iso: e.target.value })}
              required
              className="h-9 max-w-xs rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
        )}
      </div>
    </div>
  );
}

