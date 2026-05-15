"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, X, Loader2, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";

export type UmpireRow = {
  id: string;
  name: string;
  designation: string;
  season_id: string;
  season: { name: string } | null;
};

interface Props {
  umpires: UmpireRow[];
  showSeasonColumn: boolean;
}

export function UmpireList({ umpires, showSeasonColumn }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<UmpireRow | null>(null);
  const [deleting, setDeleting] = useState<UmpireRow | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function handleDelete(umpire: UmpireRow) {
    setPending(umpire.id);
    const supabase = createClient();
    const { error } = await supabase.from("umpires").delete().eq("id", umpire.id);
    setPending(null);
    if (error) {
      // Surface the error inline on the row by keeping the dialog open;
      // a simple alert is acceptable here since this is admin-only UI.
      alert(`Failed to delete umpire: ${error.message}`);
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  if (umpires.length === 0) {
    return null;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="pb-3 font-medium text-gray-500">Name</th>
              <th className="pb-3 font-medium text-gray-500">Designation</th>
              {showSeasonColumn && (
                <th className="pb-3 font-medium text-gray-500">Season</th>
              )}
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {umpires.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 last:border-0">
                <td className="py-3 font-medium text-gray-900">{u.name}</td>
                <td className="py-3">
                  <Badge variant={u.designation === "adult" ? "info" : "success"}>
                    {u.designation === "adult" ? "Adult" : "Youth"}
                  </Badge>
                </td>
                {showSeasonColumn && (
                  <td className="py-3 text-gray-600">{u.season?.name ?? "—"}</td>
                )}
                <td className="py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Link
                      href={`/dashboard/umpires/${u.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-[#22C55E] hover:text-[#22C55E]"
                    >
                      <CalendarDays className="h-3 w-3" />
                      View schedule
                    </Link>
                    <button
                      onClick={() => setEditing(u)}
                      disabled={pending === u.id}
                      aria-label={`Edit ${u.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#0C1F3F] disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleting(u)}
                      disabled={pending === u.id}
                      aria-label={`Delete ${u.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    >
                      {pending === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditUmpireModal
          umpire={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {deleting && (
        <DeleteUmpireDialog
          umpire={deleting}
          loading={pending === deleting.id}
          onCancel={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      )}
    </>
  );
}

// ── Edit modal ───────────────────────────────────────────────────────────────

function EditUmpireModal({
  umpire,
  onClose,
  onSaved,
}: {
  umpire: UmpireRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(umpire.name);
  const [designation, setDesignation] = useState<"youth" | "adult">(
    umpire.designation === "adult" ? "adult" : "youth",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("umpires")
      .update({ name: name.trim(), designation } as never)
      .eq("id", umpire.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
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
          <h2 className="font-semibold text-[#0C1F3F]">Edit umpire</h2>
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-gray-700">Designation</span>
            <div className="flex w-full rounded-lg border border-gray-200 bg-gray-50 p-1">
              {(["youth", "adult"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDesignation(d)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-all ${
                    designation === d
                      ? "bg-white text-[#0C1F3F] shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#22C55E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm dialog ────────────────────────────────────────────────────

function DeleteUmpireDialog({
  umpire,
  loading,
  onCancel,
  onConfirm,
}: {
  umpire: UmpireRow;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !loading && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-red-500" />
          <h3 className="text-base font-bold text-[#0C1F3F]">Delete umpire?</h3>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          <span className="font-semibold">{umpire.name}</span> will be permanently removed
          from this season. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {loading ? "Deleting…" : "Delete umpire"}
          </button>
        </div>
      </div>
    </div>
  );
}
