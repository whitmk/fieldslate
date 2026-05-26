"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2, Pencil, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type BlockRow = {
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

export function SnackShackSchedule({ snackShackId, blocks, teams }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<string>("");
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

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
        <p className="text-sm text-gray-500">No blocks scheduled yet.</p>
        <p className="mt-0.5 text-xs text-gray-400">
          Use &ldquo;Generate schedule&rdquo; in the wizard, or add one-off blocks above.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="pb-3 font-semibold">Date</th>
              <th className="pb-3 font-semibold">Time block</th>
              <th className="pb-3 font-semibold">Assigned team</th>
              <th className="pb-3 font-semibold">Type</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {blocks.map((block) => (
              <tr key={block.id} className="text-gray-700">
                <td className="py-3 font-medium text-gray-900 tabular-nums">
                  {fmtDate(block.date)}
                </td>
                <td className="py-3 tabular-nums text-gray-600">
                  {fmtTime(block.start_time)} – {fmtTime(block.end_time)}
                </td>
                <td className="py-3">
                  {editingId === block.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={editTeam}
                        onChange={(e) => setEditTeam(e.target.value)}
                        className="h-8 rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none"
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
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#22C55E] text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
                        aria-label="Save"
                      >
                        {saving === block.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100"
                        aria-label="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : block.assigned_team_id ? (
                    <span className="font-medium text-gray-900">
                      {block.team_name}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600">Unassigned</span>
                  )}
                </td>
                <td className="py-3">
                  {block.is_recurring ? (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Recurring
                    </span>
                  ) : (
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
                      One-off
                    </span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {editingId !== block.id && (
                    <button
                      onClick={() => startEdit(block)}
                      aria-label="Edit assignment"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

function AddOneOffModal({
  snackShackId,
  teams,
  onClose,
  onSaved,
}: {
  snackShackId: string;
  teams: TeamOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState("");
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
          <h2 className="font-semibold text-[#0C1F3F]">Add one-off block</h2>
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
                "Add block"
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
  onClose,
  onSaved,
}: {
  block: BlockRow;
  teams: TeamOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(block.assigned_team_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: dbErr } = await supabase
      .from("snack_shack_blocks")
      .update({ assigned_team_id: teamId || null } as never)
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
              {block.is_recurring ? "Recurring block" : "One-off block"}
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

export function AddOneOffBlockButton({
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
        Add one-off block
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
