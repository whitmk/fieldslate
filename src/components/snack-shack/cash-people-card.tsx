"use client";

// The per-season "in charge of cash" list: add, rename inline, remove with a
// count-and-confirm. Names are ROWS in snack_shack_cash_people (0104); a
// shift references one by id, so a rename propagates and a removal makes its
// shifts "no cash person" by the FK's SET NULL in the same statement. The
// count on the confirm is a pre-flight read — it can drift in the seconds
// before the delete, but SET NULL is the outcome either way.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cashNameDraft, cashRemovalDetail, type CashPerson } from "@/lib/snack-shack/shift-notes";

interface Props {
  snackShackId: string;
  people: CashPerson[];
}

function friendly(message: string): string {
  return /duplicate key|23505/.test(message) ? "That name is already on the list." : message;
}

export function CashPeopleCard({ snackShackId, people }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ person: CashPerson; count: number | null } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function add() {
    const d = cashNameDraft(draft);
    if (!d.ok) {
      setError(d.reason === "empty" ? "Type a name first." : "Keep the name under 80 characters.");
      return;
    }
    setAdding(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("snack_shack_cash_people")
      .insert({ snack_shack_id: snackShackId, name: d.value } as never);
    setAdding(false);
    if (err) {
      setError(friendly(err.message));
      return;
    }
    setDraft("");
    router.refresh();
  }

  async function rename(id: string) {
    const d = cashNameDraft(editDraft);
    if (!d.ok) {
      setError(d.reason === "empty" ? "A name can't be blank." : "Keep the name under 80 characters.");
      return;
    }
    setBusyId(id);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("snack_shack_cash_people")
      .update({ name: d.value } as never)
      .eq("id", id)
      .select("id");
    setBusyId(null);
    if (err) {
      setError(friendly(err.message));
      return;
    }
    if ((data ?? []).length === 0) {
      setError("Nothing was saved — the name may have been removed. Refresh and try again.");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function askRemove(person: CashPerson) {
    setRemoveError(null);
    setRemoving({ person, count: null });
    const supabase = createClient();
    const { count, error: err } = await supabase
      .from("snack_shack_blocks")
      .select("id", { count: "exact", head: true })
      .eq("cash_person_id", person.id);
    if (err) {
      // A failed count renders as "couldn't count", never a silent 0.
      setRemoving({ person, count: null });
      setRemoveError(`Couldn't count the shifts using ${person.name}: ${err.message}`);
      return;
    }
    setRemoving({ person, count: count ?? 0 });
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusyId(removing.person.id);
    setRemoveError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("snack_shack_cash_people")
      .delete()
      .eq("id", removing.person.id)
      .select("id");
    setBusyId(null);
    if (err) {
      setRemoveError(err.message);
      return;
    }
    if ((data ?? []).length === 0) {
      setRemoveError("Nothing was removed — the name may already be gone. Refresh and try again.");
      return;
    }
    setRemoving(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>In charge of cash</CardTitle>
        <p className="text-sm text-gray-500">
          Names you can put on a shift as the person handling the cash box. Internal only — never printed, emailed or shown to teams.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {people.length === 0 ? (
            <p className="text-sm text-gray-400">No names yet.</p>
          ) : (
            <ul className="divide-y divide-gray-50 rounded-lg border border-gray-100">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {editingId === p.id ? (
                    <>
                      <input
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void rename(p.id); if (e.key === "Escape") setEditingId(null); }}
                        autoFocus
                        maxLength={80}
                        className="h-9 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none"
                      />
                      <button type="button" onClick={() => void rename(p.id)} disabled={busyId === p.id} aria-label="Save name"
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#22C55E] text-white disabled:opacity-50 md:h-8 md:w-8">
                        {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel"
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 md:h-8 md:w-8">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-gray-900">{p.name}</span>
                      <button type="button" onClick={() => { setEditingId(p.id); setEditDraft(p.name); setError(null); }} aria-label={`Rename ${p.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F] md:h-8 md:w-8">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => void askRemove(p)} aria-label={`Remove ${p.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 md:h-8 md:w-8">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              placeholder="Add a name"
              maxLength={80}
              className="h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
            <button type="button" onClick={() => void add()} disabled={adding}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-600 hover:border-[#0C1F3F] hover:text-[#0C1F3F] disabled:opacity-50">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </button>
          </div>
          {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>
      </CardContent>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.person.name}?`}
          detail={removing.count === null && !removeError
            ? "Counting the shifts that use this name…"
            : removing.count === null
            ? "Couldn't count the shifts that use this name."
            : cashRemovalDetail(removing.person.name, removing.count)}
          confirmLabel="Remove"
          tone="danger"
          icon={<Trash2 className="h-5 w-5" />}
          busy={busyId === removing.person.id}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onCancel={() => { if (busyId !== removing.person.id) setRemoving(null); }}
        />
      )}
    </Card>
  );
}
