"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MapPin, Send, Trophy } from "lucide-react";

export type PendingGame = {
  id: string;
  scheduled_at: string;
  is_away: boolean;
  external_team_name: string | null;
  proposed_scheduled_at: string | null;
  proposed_venue_name: string | null;
  home_team: { name: string };
  division: { id: string; name: string };
  venue: { name: string } | null;
};

type Action = "accept" | "counter";

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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Convert an ISO timestamp into the format <input type="datetime-local"> expects. */
function isoToLocalDatetime(iso: string): string {
  const d = new Date(iso);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/** Convert a local datetime-local value back to a full ISO string. */
function localDatetimeToIso(local: string): string {
  if (!local) return "";
  // datetime-local has no timezone — interpret as local
  const d = new Date(local);
  return d.toISOString();
}

export function InviteForm({
  token,
  senderName,
  seasonLabel,
  orgName,
  games,
}: Props) {
  const router = useRouter();

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
  const [success, setSuccess] = useState<{ accepted: number; countered: number } | null>(null);

  const { homeGames, awayGames } = useMemo(() => {
    const home: PendingGame[] = [];
    const away: PendingGame[] = [];
    for (const g of games) (g.is_away ? away : home).push(g);
    return { homeGames: home, awayGames: away };
  }, [games]);

  function patch(id: string, partial: Partial<GameState>) {
    setResponses((prev) => ({ ...prev, [id]: { ...prev[id], ...partial } }));
  }

  const allTeamsFilled = games.every((g) => responses[g.id]?.team_name.trim().length > 0);
  const allAwayVenuesFilled = awayGames.every(
    (g) => responses[g.id]?.venue_name.trim().length > 0,
  );
  // Counter-proposed games need an alternative time
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
        team_name: r.team_name.trim(),
        action: r.action,
        venue_name: g.is_away ? r.venue_name.trim() || undefined : undefined,
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
      setSuccess({
        accepted: Number(data.accepted ?? 0),
        countered: Number(data.countered ?? 0),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
      setSubmitting(false);
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
  const counterLabel = game.is_away ? "Suggest different date" : "Suggest different time";
  const acceptLabel = game.is_away ? "Accept this date" : "Accept";

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        isCounter
          ? "border-amber-200 bg-amber-50/40"
          : "border-gray-100 bg-gray-50/60"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0C1F3F]">
            {game.home_team.name}
            <span className="mx-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
              {game.is_away ? "AT" : "vs"}
            </span>
            <span className="text-gray-600">your team</span>
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {game.division.name} · {fmtDate(game.scheduled_at)}, {fmtTime(game.scheduled_at)}
            {game.venue?.name && !game.is_away && (
              <> · {game.venue.name}</>
            )}
            {game.is_away && (
              <> · at your venue</>
            )}
          </p>
        </div>
      </div>

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

      <div className="mt-3 flex flex-col gap-2">
        <div className="inline-flex w-full rounded-lg border border-gray-200 bg-white p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => onChange({ action: "accept" })}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
              !isCounter
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

