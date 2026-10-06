"use client";

import { Fragment, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, X, Loader2, Pencil, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { GameNoteIcon, GameNoteLine } from "@/components/schedule/game-note";
import type { ShiftNoteFields, CashPerson } from "@/lib/snack-shack/shift-notes";
import { normalizeTime } from "@/lib/snack-shack/derive-shifts";
import { NEEDS_TEAM, fmtShiftRange, redBannerLine, redSummary, type BlockFlagView } from "@/lib/snack-shack/shift-flags";

export type BlockRow = ShiftNoteFields & {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  assigned_team_id: string | null;
  is_recurring: boolean;
  team_name: string | null;
};

export type TeamOption = {
  id: string;
  name: string;
};

interface Props {
  snackShackId: string;
  blocks: BlockRow[];
  teams: TeamOption[];
  /** Rendered once above each date's rows (window summary, leftover control,
   *  per-day add). The list stays a flat table of stored rows. */
  dayHeader?: (date: string) => ReactNode;
  /** 0104: the season's cash people and the note editor. Internal fields —
   *  never rendered by a print or email path. */
  cashPeople?: CashPerson[];
  onEditNote?: (block: BlockRow) => void;
  /** Per-row flag views (shift-flags.ts), keyed by block id. Absent while the
   *  game schedule is still loading or could not be read — then nothing is
   *  flagged and an empty row reads "Unassigned". Past rows are never here. */
  flags?: Map<string, BlockFlagView | null>;
}

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function SnackShackSchedule({ snackShackId, blocks, teams, dayHeader, cashPeople = [], onEditNote, flags }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<string>("");
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);

  async function saveCash(blockId: string, cashPersonId: string | null) {
    setSaving(blockId);
    setCashError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("snack_shack_blocks")
      .update({ cash_person_id: cashPersonId } as never)
      .eq("id", blockId)
      .select("id");
    setSaving(null);
    if (error || (data ?? []).length === 0) {
      setCashError(error?.message ?? "Nothing was saved — refresh and try again.");
      return;
    }
    router.refresh();
  }

  function startEdit(block: BlockRow) {
    setEditingId(block.id);
    setEditTeam(block.assigned_team_id ?? "");
  }

  async function saveEdit(blockId: string) {
    setSaving(blockId);
    const supabase = createClient();
    await supabase
      .from("snack_shack_blocks")
      .update({
        assigned_team_id: editTeam || null,
      } as never)
      .eq("id", blockId);
    setSaving(null);
    setEditingId(null);
    router.refresh();
  }

  if (blocks.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <p className="text-sm text-gray-500">No shifts yet.</p>
        <p className="mt-0.5 text-xs text-gray-400">
          Use &ldquo;Generate shifts&rdquo; to make them from the game schedule, or add one by hand.
        </p>
      </div>
    );
  }

  // Date order, manual shifts among the derived ones.
  const sorted = [...blocks].sort(
    (a, b) => a.date.localeCompare(b.date) || normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time)) || normalizeTime(a.end_time).localeCompare(normalizeTime(b.end_time)) || a.id.localeCompare(b.id),
  );
  const viewOf = (b: BlockRow): BlockFlagView | null => flags?.get(b.id) ?? null;
  const banner = redBannerLine(redSummary(sorted.map(viewOf)));

  const teamCell = (block: BlockRow, view: BlockFlagView | null) => {
    if (editingId === block.id) {
      return (
        <div className="flex items-center gap-2">
          <select
            value={editTeam}
            onChange={(e) => setEditTeam(e.target.value)}
            className="h-8 max-w-[12rem] rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none"
          >
            <option value="">Unassigned</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => saveEdit(block.id)}
            disabled={saving === block.id}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#22C55E] text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50 md:h-7 md:w-7"
            aria-label="Save"
          >
            {saving === block.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => setEditingId(null)}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 md:h-7 md:w-7"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }
    if (block.assigned_team_id) return <span className="font-medium text-gray-900">{block.team_name}</span>;
    if (view?.needsTeam) return <span className="font-medium text-red-700">{NEEDS_TEAM}</span>;
    return <span className="text-xs text-gray-400">Unassigned</span>;
  };

  const statusCell = (view: BlockFlagView | null) => {
    if (view?.chip) {
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-500" />
          {view.chip}
        </span>
      );
    }
    if (view?.soft) return <span className="text-xs text-gray-500">{view.soft}</span>;
    return <span className="text-xs text-gray-300">—</span>;
  };

  const manualTag = (block: BlockRow) =>
    block.is_recurring ? null : (
      <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Manual</span>
    );

  const cashCell = (block: BlockRow) =>
    cashPeople.length === 0 ? (
      <span className="text-xs text-gray-300">—</span>
    ) : (
      <select
        value={block.cash_person_id ?? ""}
        onChange={(e) => void saveCash(block.id, e.target.value || null)}
        disabled={saving === block.id}
        aria-label="In charge of cash"
        className="h-8 max-w-[10rem] rounded-lg border border-gray-200 px-2 text-xs text-gray-900 focus:border-[#22C55E] focus:outline-none disabled:opacity-50"
      >
        <option value="">No one</option>
        {cashPeople.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    );

  const actions = (block: BlockRow) => (
    <div className="flex items-center justify-end gap-0.5">
      {onEditNote && <GameNoteIcon game={block} onClick={() => onEditNote(block)} />}
      {editingId !== block.id && (
        <button
          onClick={() => startEdit(block)}
          aria-label="Edit assignment"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F] md:h-7 md:w-7"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <>
      {banner && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{banner}</span>
        </p>
      )}

      {/* Desktop: the table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="pb-3 font-semibold">Date</th>
              <th className="pb-3 font-semibold">Shift</th>
              <th className="pb-3 font-semibold">Assigned team</th>
              <th className="pb-3 font-semibold">Status</th>
              <th className="pb-3 font-semibold">Cash</th>
              <th className="pb-3" />
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((block, i) => {
              const view = viewOf(block);
              return (
                <Fragment key={block.id}>
                  {dayHeader && (i === 0 || sorted[i - 1].date !== block.date) && (
                    <tr className="bg-gray-50/70">
                      <td colSpan={7} className="px-2 py-2">{dayHeader(block.date)}</td>
                    </tr>
                  )}
                  <tr className="text-gray-700">
                    <td className="whitespace-nowrap py-3 pr-4 font-medium text-gray-900 tabular-nums">{fmtDate(block.date)}</td>
                    <td className="whitespace-nowrap py-3 pr-4 tabular-nums text-gray-600">
                      {fmtShiftRange(block.start_time, block.end_time)}
                      {onEditNote && (
                        <GameNoteLine game={block} onClick={() => onEditNote(block)} className="max-w-[16rem] whitespace-normal" />
                      )}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4">{teamCell(block, view)}</td>
                    <td className="py-3 pr-4">{statusCell(view)}</td>
                    <td className="py-3 pr-4">{cashCell(block)}</td>
                    <td className="py-3 pr-2">{manualTag(block)}</td>
                    <td className="py-3 text-right">{actions(block)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per shift. */}
      <div className="flex flex-col gap-2 md:hidden">
        {sorted.map((block, i) => {
          const view = viewOf(block);
          return (
            <Fragment key={block.id}>
              {dayHeader && (i === 0 || sorted[i - 1].date !== block.date) && (
                <div className="mt-2 rounded-lg bg-gray-50/70 px-2 py-2 first:mt-0">{dayHeader(block.date)}</div>
              )}
              <div className={`rounded-xl border px-3 py-2.5 ${view?.red ? "border-red-200" : "border-gray-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="whitespace-nowrap font-semibold text-[#0C1F3F] tabular-nums">{fmtShiftRange(block.start_time, block.end_time)}</span>
                  {manualTag(block)}
                </div>
                <div className="mt-0.5 text-sm">{teamCell(block, view)}</div>
                {onEditNote && <GameNoteLine game={block} onClick={() => onEditNote(block)} />}
                {(view?.chip || view?.soft) && <div className="mt-1.5">{statusCell(view)}</div>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">{cashPeople.length > 0 ? cashCell(block) : null}</div>
                  {actions(block)}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {cashError && (
        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">Couldn&rsquo;t save the cash person: {cashError}</p>
      )}

      {showAddModal && (
        <AddOneOffModal
          snackShackId={snackShackId}
          teams={teams}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ── Add one-off block modal ──────────────────────────────────────────────────

export function AddOneOffModal({
  snackShackId,
  teams,
  fixedDate,
  onClose,
  onSaved,
}: {
  snackShackId: string;
  teams: TeamOption[];
  /** Per-day control: the date is fixed and not editable. */
  fixedDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(fixedDate ?? "");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [teamId, setTeamId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !startTime || !endTime) return;
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { error: dbErr } = await supabase.from("snack_shack_blocks").insert({
      snack_shack_id: snackShackId,
      date,
      start_time: startTime,
      end_time: endTime,
      assigned_team_id: teamId || null,
      is_recurring: false,
    } as never);
    setSaving(false);
    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">{fixedDate ? `Add a shift on ${fmtDate(fixedDate)}` : "Add a shift by hand"}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-6">
          <p className="text-xs text-gray-500">
            {fixedDate
              ? "Added on top of whatever the schedule produces for this day."
              : "Any date, whether or not games are scheduled — a tournament, a work party, opening day."}{" "}
            Not tied to the schedule, so regenerating leaves it alone.
          </p>
          {!fixedDate && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">Start time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">End time</label>
              <input
                type="time"
                value={endTime}
                min={startTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Assigned team{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            >
              <option value="">Leave unassigned</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !date}
              className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Add shift"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit assignment modal ────────────────────────────────────────────────────
// Mirrors the inline edit in the table row (team select + save) for callers
// that don't have an inline row to edit (e.g. the calendar view). Same field,
// same backing update.

export function BlockEditModal({
  block,
  teams,
  cashPeople = [],
  onClose,
  onSaved,
}: {
  block: BlockRow;
  teams: TeamOption[];
  cashPeople?: CashPerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(block.assigned_team_id ?? "");
  const [cashId, setCashId] = useState(block.cash_person_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: dbErr } = await supabase
      .from("snack_shack_blocks")
      .update({ assigned_team_id: teamId || null, cash_person_id: cashId || null } as never)
      .eq("id", block.id);
    setSaving(false);
    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    onSaved();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">Edit assignment</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-sm text-gray-600">
            <p className="font-medium text-gray-900">{fmtDate(block.date)}</p>
            <p className="mt-0.5 tabular-nums">
              {fmtTime(block.start_time)} – {fmtTime(block.end_time)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {block.is_recurring ? "Made from the schedule" : "Added by hand"}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Assigned team
            </label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              autoFocus
              className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            >
              <option value="">Unassigned</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {cashPeople.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">In charge of cash</label>
              <select
                value={cashId}
                onChange={(e) => setCashId(e.target.value)}
                className="h-11 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              >
                <option value="">No one</option>
                {cashPeople.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Exported trigger component ───────────────────────────────────────────────
// Placed inline above the schedule on the page

export function AddOneOffButton({
  snackShackId,
  teams,
}: {
  snackShackId: string;
  teams: TeamOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
      >
        <Plus className="h-4 w-4" />
        Add a shift by hand
      </button>
      {open && (
        <AddOneOffModal
          snackShackId={snackShackId}
          teams={teams}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
