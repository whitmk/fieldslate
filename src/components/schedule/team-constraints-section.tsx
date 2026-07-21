"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatConstraintRule, type TeamConstraintRule } from "@/lib/schedule/team-constraints";
import type { DayKey } from "@/lib/venues/availability";

// Elite-gated CRUD for team_game_constraints (0076), rendered on the
// Schedule page (the gate itself lives in the server page — this component
// assumes entitlement). Clones the practices page's UnavailabilitySection
// interaction pattern: per-team cards grouped by division, inline add form,
// row delete. Constraints stay live on downgrade by design — the generator
// honors rows tier-blind (see CLAUDE.md "Team game constraints").
//
// House rule: NO <form> element anywhere in reusable form-ish components —
// React submit events bubble through nested forms. Every button is an
// explicit type="button".

type DivisionOpt = { id: string; name: string };
type TeamOpt = { id: string; name: string; division_id: string };

type ConstraintRow = {
  id: string;
  team_id: string;
  day_of_week: string;
  start_time: string | null; // "HH:MM:SS" from Postgres
  end_time: string | null;
  severity: string; // 'block' | 'prefer'
  notes: string | null;
};

const DAY_OPTIONS: Array<{ key: DayKey; full: string }> = [
  { key: "Mo", full: "Monday" },
  { key: "Tu", full: "Tuesday" },
  { key: "We", full: "Wednesday" },
  { key: "Th", full: "Thursday" },
  { key: "Fr", full: "Friday" },
  { key: "Sa", full: "Saturday" },
  { key: "Su", full: "Sunday" },
];

function ruleFromRow(r: ConstraintRow): TeamConstraintRule {
  return {
    teamId: r.team_id,
    dayOfWeek: r.day_of_week as DayKey,
    startTime: r.start_time ? r.start_time.slice(0, 5) : null,
    endTime: r.end_time ? r.end_time.slice(0, 5) : null,
    severity: r.severity === "prefer" ? "prefer" : "block",
  };
}

export function TeamConstraintsSection({
  divisions,
  teams,
}: {
  divisions: DivisionOpt[];
  teams: TeamOpt[];
}) {
  const [rows, setRows] = useState<ConstraintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openDivisionId, setOpenDivisionId] = useState<string | null>(null);

  const teamIdsKey = useMemo(
    () => teams.map((t) => t.id).sort().join(","),
    [teams],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    const ids = teamIdsKey ? teamIdsKey.split(",") : [];
    if (ids.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("team_game_constraints")
      .select("id, team_id, day_of_week, start_time, end_time, severity, notes")
      .in("team_id", ids);
    if (error) {
      setLoadError(`Couldn't load constraints: ${error.message}`);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as unknown as ConstraintRow[]);
    setLoading(false);
  }, [teamIdsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const rowsByTeam = useMemo(() => {
    const m = new Map<string, ConstraintRow[]>();
    for (const r of rows) {
      const list = m.get(r.team_id) ?? [];
      list.push(r);
      m.set(r.team_id, list);
    }
    return m;
  }, [rows]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Days and times a team can&apos;t (or would rather not) play.{" "}
        <span className="font-medium text-gray-600">
          Constraints apply to game start times
        </span>{" "}
        — to keep games from running past noon, block starting times from
        11:00&nbsp;AM on. <span className="font-semibold">Block</span>: the
        schedule generator will never place a game here, and manual moves warn
        before overriding. <span className="font-semibold">Prefer</span>: the
        generator will try to honor this (takes effect in an upcoming update —
        entered preferences are saved now and shown as heads-up notices on
        manual scheduling).
      </p>

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-600">{loadError}</p>
        </div>
      )}

      {divisions.length === 0 ? (
        <p className="text-sm text-gray-400">
          No divisions in this season yet.
        </p>
      ) : (
        divisions.map((d) => {
          const divTeams = teams.filter((t) => t.division_id === d.id);
          const divCount = divTeams.reduce(
            (n, t) => n + (rowsByTeam.get(t.id)?.length ?? 0),
            0,
          );
          const isOpen = openDivisionId === d.id;
          return (
            <div key={d.id} className="overflow-hidden rounded-xl border border-gray-100">
              <button
                type="button"
                onClick={() => setOpenDivisionId(isOpen ? null : d.id)}
                className="flex w-full items-center justify-between bg-gray-50/60 px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold text-[#0C1F3F]">
                  {d.name}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {divCount} constraint{divCount !== 1 ? "s" : ""}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="divide-y divide-gray-50">
                  {divTeams.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">
                      No teams in this division.
                    </p>
                  ) : (
                    divTeams.map((t) => (
                      <TeamConstraintCard
                        key={t.id}
                        team={t}
                        rows={rowsByTeam.get(t.id) ?? []}
                        onSaved={load}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function TeamConstraintCard({
  team,
  rows,
  onSaved,
}: {
  team: TeamOpt;
  rows: ConstraintRow[];
  onSaved: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newDay, setNewDay] = useState<string>("Sa");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newSeverity, setNewSeverity] = useState<"block" | "prefer">("block");
  const [newNote, setNewNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const di =
          DAY_OPTIONS.findIndex((d) => d.key === a.day_of_week) -
          DAY_OPTIONS.findIndex((d) => d.key === b.day_of_week);
        if (di !== 0) return di;
        return (a.start_time ?? "").localeCompare(b.start_time ?? "");
      }),
    [rows],
  );

  function resetForm() {
    setNewDay("Sa");
    setNewStart("");
    setNewEnd("");
    setNewSeverity("block");
    setNewNote("");
    setFormError(null);
  }

  async function addConstraint() {
    setFormError(null);
    const hasStart = newStart.trim().length > 0;
    const hasEnd = newEnd.trim().length > 0;
    if (hasStart !== hasEnd) {
      setFormError(
        "Set both start and end times, or leave both blank for an all-day rule.",
      );
      return;
    }
    if (hasStart && hasEnd && newEnd <= newStart) {
      setFormError("End time must be after start time.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("team_game_constraints").insert([
      {
        team_id: team.id,
        day_of_week: newDay,
        start_time: hasStart ? newStart : null,
        end_time: hasEnd ? newEnd : null,
        severity: newSeverity,
        notes: newNote.trim() || null,
      },
    ] as never[]);
    setBusy(false);
    if (error) {
      setFormError(`Couldn't add the constraint: ${error.message}`);
      return;
    }
    setAdding(false);
    resetForm();
    await onSaved();
  }

  async function deleteConstraint(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("team_game_constraints")
      .delete()
      .eq("id", id);
    if (error) {
      setFormError(`Couldn't delete the constraint: ${error.message}`);
      return;
    }
    await onSaved();
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-[#0C1F3F]">{team.name}</h4>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#0C1F3F] transition-colors hover:border-[#22C55E]/40 hover:text-[#22C55E]"
          >
            <Plus className="h-3 w-3" />
            Add constraint
          </button>
        )}
      </div>

      {sorted.length === 0 && !adding ? (
        <p className="mt-2 text-[11px] text-gray-400">
          No constraints — every day and start time is fair game for the
          schedule generator.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {sorted.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-2.5 py-1.5 text-xs text-[#0C1F3F]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    r.severity === "block"
                      ? "bg-red-50 text-red-600"
                      : "bg-amber-50 text-amber-600"
                  }`}
                >
                  {r.severity === "block" ? "Block" : "Prefer"}
                </span>
                <span className="truncate">
                  {formatConstraintRule(ruleFromRow(r))}
                  {r.notes ? (
                    <span className="text-gray-400"> — {r.notes}</span>
                  ) : null}
                </span>
              </span>
              <button
                type="button"
                onClick={() => deleteConstraint(r.id)}
                aria-label="Delete constraint"
                className="flex-shrink-0 text-gray-400 transition-colors hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-gray-100 bg-gray-50/40 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Day
              </label>
              <select
                value={newDay}
                onChange={(e) => setNewDay(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.full}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Start <span className="font-normal">(optional)</span>
              </label>
              <input
                type="time"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                End <span className="font-normal">(optional)</span>
              </label>
              <input
                type="time"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Kind
              </label>
              <div className="flex gap-1">
                {(["block", "prefer"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setNewSeverity(s)}
                    aria-pressed={newSeverity === s}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                      newSeverity === s
                        ? s === "block"
                          ? "bg-red-500 text-white"
                          : "bg-amber-500 text-white"
                        : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-[#0C1F3F]"
                    }`}
                  >
                    {s === "block" ? "Block" : "Prefer"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-w-[140px] flex-1 flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                Note <span className="font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                maxLength={200}
                placeholder="e.g. coach works Saturday mornings"
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  resetForm();
                }}
                disabled={busy}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addConstraint}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {formError && (
            <p className="text-[11px] font-medium text-red-500">{formError}</p>
          )}
          <p className="text-[10px] text-gray-400">
            Leave both times blank to cover the whole day. Times are game
            START times — a game that starts inside the window matches, one
            that merely runs into it doesn&apos;t. On iPhone or iPad,
            double-check the AM/PM segment — a time without it counts as
            blank.
          </p>
        </div>
      )}
      {!adding && formError && (
        <p className="mt-2 text-[11px] font-medium text-red-500">{formError}</p>
      )}
    </div>
  );
}
