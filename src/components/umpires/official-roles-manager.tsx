"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getOfficialTitle } from "@/lib/utils/official-title";

export type SeasonRole = { id: string; name: string; sort_order: number };

interface Props {
  seasonId: string;
  /** Optional — rendered as a subheading so multiple seasons can stack. */
  seasonName?: string;
  /** Sport for this season — drives "Umpire" vs "Referee" copy. */
  sport?: string | null;
  initialRoles: SeasonRole[];
}

function humanizeRoleError(msg: string): string {
  if (/duplicate key|unique/i.test(msg)) {
    return "That role already exists for this season.";
  }
  return msg;
}

function bySort(a: SeasonRole, b: SeasonRole): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

export function OfficialRolesManager({
  seasonId,
  seasonName,
  sport,
  initialRoles,
}: Props) {
  const router = useRouter();
  const [roles, setRoles] = useState<SeasonRole[]>([...initialRoles].sort(bySort));
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [movingId, setMovingId] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<SeasonRole | null>(null);
  const [deleteRefCount, setDeleteRefCount] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const titleLower = getOfficialTitle(sport).toLowerCase();

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    if (roles.some((r) => r.name === name)) {
      setError("That role already exists for this season.");
      return;
    }
    setAdding(true);
    setError(null);
    const supabase = createClient();
    const nextSort = roles.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;
    const { data, error: insertErr } = await supabase
      .from("official_roles")
      .insert([{ season_id: seasonId, name, sort_order: nextSort }] as never[])
      .select("id, name, sort_order")
      .single();
    setAdding(false);
    if (insertErr) {
      setError(humanizeRoleError(insertErr.message));
      return;
    }
    setRoles((prev) => [...prev, data as unknown as SeasonRole].sort(bySort));
    setNewName("");
    router.refresh();
  }

  function startRename(role: SeasonRole) {
    setEditingId(role.id);
    setEditingName(role.name);
    setError(null);
  }

  async function handleRenameSave() {
    if (!editingId) return;
    const name = editingName.trim();
    const current = roles.find((r) => r.id === editingId);
    if (!current || !name || name === current.name) {
      setEditingId(null);
      return;
    }
    if (roles.some((r) => r.id !== editingId && r.name === name)) {
      setError("That role already exists for this season.");
      return;
    }
    setRenaming(true);
    setError(null);
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("official_roles")
      .update({ name } as never)
      .eq("id", editingId);
    setRenaming(false);
    if (updateErr) {
      setError(humanizeRoleError(updateErr.message));
      return;
    }
    setRoles((prev) =>
      prev.map((r) => (r.id === editingId ? { ...r, name } : r)).sort(bySort),
    );
    setEditingId(null);
    router.refresh();
  }

  async function handleMove(role: SeasonRole, dir: -1 | 1) {
    const sorted = [...roles].sort(bySort);
    const idx = sorted.findIndex((r) => r.id === role.id);
    const neighbor = sorted[idx + dir];
    if (!neighbor) return;
    setMovingId(role.id);
    setError(null);
    const supabase = createClient();
    // Swap the two sort_order values; on partial failure the refresh below
    // re-reads server truth either way.
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase
        .from("official_roles")
        .update({ sort_order: neighbor.sort_order } as never)
        .eq("id", role.id),
      supabase
        .from("official_roles")
        .update({ sort_order: role.sort_order } as never)
        .eq("id", neighbor.id),
    ]);
    setMovingId(null);
    if (e1 || e2) {
      setError((e1 ?? e2)!.message);
      router.refresh();
      return;
    }
    setRoles((prev) =>
      prev
        .map((r) => {
          if (r.id === role.id) return { ...r, sort_order: neighbor.sort_order };
          if (r.id === neighbor.id) return { ...r, sort_order: role.sort_order };
          return r;
        })
        .sort(bySort),
    );
    router.refresh();
  }

  async function requestDelete(role: SeasonRole) {
    setDeleting(role);
    setDeleteRefCount(null);
    setError(null);
    const supabase = createClient();
    // Plain single-table count — the head+count PostgREST pitfall only bites
    // with !inner joins.
    const { count } = await supabase
      .from("game_umpires")
      .select("id", { count: "exact", head: true })
      .eq("role_id", role.id);
    setDeleteRefCount(count ?? 0);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("official_roles")
      .delete()
      .eq("id", deleting.id);
    setDeleteBusy(false);
    if (delErr) {
      setError(delErr.message);
      setDeleting(null);
      return;
    }
    setRoles((prev) => prev.filter((r) => r.id !== deleting.id));
    setDeleting(null);
    router.refresh();
  }

  const sorted = [...roles].sort(bySort);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-gray-400" />
        <div className="flex flex-col">
          <h3 className="font-semibold text-[#0C1F3F]">Official roles</h3>
          {seasonName && <p className="text-xs text-gray-400">{seasonName}</p>}
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        The {titleLower} roles available for this season&apos;s game slots,
        auto-assign, and per-role pay rates. Renaming a role doesn&apos;t
        relabel past game assignments.
      </p>

      {sorted.length === 0 ? (
        <p className="text-xs text-gray-400">
          No roles yet — add one below to get started.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-50">
          {sorted.map((role, idx) => {
            const isEditing = editingId === role.id;
            const isMoving = movingId === role.id;
            return (
              <li key={role.id} className="flex items-center gap-2 py-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => handleMove(role, -1)}
                    disabled={idx === 0 || movingId !== null}
                    aria-label={`Move ${role.name} up`}
                    className="flex h-4 w-5 items-center justify-center rounded text-gray-300 transition-colors hover:text-[#0C1F3F] disabled:cursor-default disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(role, 1)}
                    disabled={idx === sorted.length - 1 || movingId !== null}
                    aria-label={`Move ${role.name} down`}
                    className="flex h-4 w-5 items-center justify-center rounded text-gray-300 transition-colors hover:text-[#0C1F3F] disabled:cursor-default disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {isEditing ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      autoFocus
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRenameSave();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRenameSave()}
                      disabled={renaming}
                      aria-label="Save role name"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[#22C55E] transition-colors hover:bg-[#22C55E]/10 disabled:opacity-50"
                    >
                      {renaming ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={renaming}
                      aria-label="Cancel rename"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-gray-700">
                      {role.name}
                      {isMoving && (
                        <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-gray-300" />
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => startRename(role)}
                      aria-label={`Rename ${role.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void requestDelete(role)}
                      aria-label={`Delete ${role.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-gray-50 pt-3">
        <input
          type="text"
          value={newName}
          placeholder="New role name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          className="h-9 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding || newName.trim() === ""}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {adding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </button>
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleteBusy && setDeleting(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-red-500" />
                <h2 className="font-semibold text-[#0C1F3F]">Delete role?</h2>
              </div>
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4 text-sm text-gray-700">
              <p>
                <span className="font-semibold">{deleting.name}</span> will be
                removed from this season&apos;s role list. This can&apos;t be
                undone.
              </p>
              {deleteRefCount === null ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking game assignments…
                </div>
              ) : deleteRefCount > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <p className="text-xs">
                    {deleteRefCount} game assignment
                    {deleteRefCount !== 1 ? "s" : ""} reference
                    {deleteRefCount === 1 ? "s" : ""} this role. They&apos;ll
                    keep their text label but lose the role link.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  No game assignments reference this role.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleteBusy || deleteRefCount === null}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  "Delete role"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
