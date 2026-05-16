"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check, Loader2, Send, Users } from "lucide-react";
import type { InviteSlot } from "@/lib/interleague/invite-slots";

type Division = {
  id: string;
  name: string;
  game_count: number;
  team_names: string[];
};

interface Props {
  token: string;
  senderName: string;
  seasonLabel: string;
  orgName: string;
  divisions: Division[];
  slots: InviteSlot[];
  totalGames: number;
}

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function InviteForm({
  token,
  senderName,
  seasonLabel,
  orgName,
  divisions,
  slots,
  totalGames,
}: Props) {
  const router = useRouter();

  // teamNames[divisionId] = string[] of length game_count
  const [teamNames, setTeamNames] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const d of divisions) {
      init[d.id] = Array.from({ length: d.game_count }, () => "");
    }
    return init;
  });

  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const suggested = useMemo(() => slots.filter((s) => s.suggested), [slots]);
  const other = useMemo(() => slots.filter((s) => !s.suggested), [slots]);

  function setTeamNameAt(divisionId: string, idx: number, value: string) {
    setTeamNames((prev) => {
      const next = { ...prev };
      const arr = [...(next[divisionId] ?? [])];
      arr[idx] = value;
      next[divisionId] = arr;
      return next;
    });
  }

  function toggleSlot(id: string) {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allTeamsFilled = divisions.every((d) =>
    (teamNames[d.id] ?? []).every((n) => n.trim().length > 0),
  );
  const enoughSlots =
    slots.length === 0 ? true : selectedSlotIds.size >= totalGames;
  const canSubmit = totalGames > 0 && allTeamsFilled && enoughSlots && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const teamPayload = divisions.map((d) => ({
      division_id: d.id,
      division_name: d.name,
      teams: (teamNames[d.id] ?? []).map((n) => n.trim()),
    }));
    const slotPayload = slots
      .filter((s) => selectedSlotIds.has(s.id))
      .map((s) => ({
        venue_id: s.venue_id,
        venue_name: s.venue_name,
        iso: s.iso,
        date: s.date,
        time: s.time,
      }));

    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_names: teamPayload,
          selected_slots: slotPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
      setSubmitting(false);
    }
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
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Proposed games */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[#22C55E]" />
          <h2 className="text-base font-semibold text-[#0C1F3F]">Proposed games</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {senderName} is proposing {totalGames}{" "}
          {totalGames === 1 ? "game" : "games"} across{" "}
          {divisions.length} {divisions.length === 1 ? "division" : "divisions"} for{" "}
          {seasonLabel}. Enter the names of your teams from {orgName} that will
          play.
        </p>

        <div className="mt-5 flex flex-col gap-5">
          {divisions.length === 0 ? (
            <p className="text-sm text-gray-500">
              No divisions are configured for this invite yet. Reach out to{" "}
              {senderName} for details.
            </p>
          ) : (
            divisions.map((d) => (
              <div
                key={d.id}
                className="rounded-xl border border-gray-100 bg-gray-50/60 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#0C1F3F]">
                    {d.name}
                  </h3>
                  <span className="text-xs font-medium text-gray-500">
                    {d.game_count} {d.game_count === 1 ? "game" : "games"}
                  </span>
                </div>
                {d.team_names.length > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {senderName}&apos;s {d.name} teams:{" "}
                    <span className="text-[#0C1F3F]">
                      {d.team_names.join(", ")}
                    </span>
                  </p>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {Array.from({ length: d.game_count }).map((_, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                        Your team for game {idx + 1}
                      </label>
                      <input
                        type="text"
                        value={teamNames[d.id]?.[idx] ?? ""}
                        onChange={(e) =>
                          setTeamNameAt(d.id, idx, e.target.value)
                        }
                        required
                        placeholder="e.g. Wildcats"
                        className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Suggested dates */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-[#22C55E]" />
          <h2 className="text-base font-semibold text-[#0C1F3F]">
            Suggested dates
          </h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Pick slots that work for you. Select at least {totalGames}{" "}
          {totalGames === 1 ? "slot" : "slots"} — one per proposed game.{" "}
          <span className="font-medium text-[#0C1F3F]">
            {selectedSlotIds.size}
          </span>{" "}
          selected.
        </p>

        {slots.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            {senderName} hasn&apos;t finalized their availability yet — submit
            with your team names and they&apos;ll reach out with dates.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {suggested.length > 0 && (
              <SlotGroup
                title="Suggested first"
                slots={suggested}
                selectedIds={selectedSlotIds}
                onToggle={toggleSlot}
              />
            )}
            <SlotGroup
              title={suggested.length > 0 ? "Other available slots" : "Available slots"}
              slots={other}
              selectedIds={selectedSlotIds}
              onToggle={toggleSlot}
            />
          </div>
        )}
      </section>

      {/* Accept */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        {!allTeamsFilled && totalGames > 0 && (
          <p className="text-xs text-amber-600">
            Fill in all team name fields before accepting.
          </p>
        )}
        {allTeamsFilled && !enoughSlots && totalGames > 0 && slots.length > 0 && (
          <p className="text-xs text-amber-600">
            Select at least {totalGames}{" "}
            {totalGames === 1 ? "slot" : "slots"} to cover the proposed games.
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
          {submitting ? "Submitting…" : "Accept invite"}
        </button>
        <p className="text-center text-[11px] text-gray-400">
          Accepting confirms your team names and slot preferences for{" "}
          {senderName} to review.
        </p>
      </div>
    </form>
  );
}

function SlotGroup({
  title,
  slots,
  selectedIds,
  onToggle,
}: {
  title: string;
  slots: InviteSlot[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (slots.length === 0) return null;

  // Group by date
  const byDate = new Map<string, InviteSlot[]>();
  for (const s of slots) {
    const arr = byDate.get(s.date) ?? [];
    arr.push(s);
    byDate.set(s.date, arr);
  }
  const dates = Array.from(byDate.keys()).sort();

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      <div className="mt-2 flex flex-col gap-2">
        {dates.map((date) => (
          <div
            key={date}
            className="rounded-lg border border-gray-100 bg-gray-50/60 p-3"
          >
            <p className="text-xs font-semibold text-[#0C1F3F]">
              {fmtDate(date)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {byDate.get(date)!.map((slot) => {
                const checked = selectedIds.has(slot.id);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onToggle(slot.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      checked
                        ? "border-[#22C55E] bg-[#22C55E]/10 text-[#16a34a]"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-[#0C1F3F]"
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" />}
                    {fmtTime(slot.time)} · {slot.venue_name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
