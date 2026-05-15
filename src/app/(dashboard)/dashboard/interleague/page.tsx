"use client";

import { useState, useEffect } from "react";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { InterleagueOrg } from "@/types/database";

// ── Modal ─────────────────────────────────────────────────────────────────────

interface OrgModalProps {
  initial?: InterleagueOrg | null;
  onSave: () => void;
  onClose: () => void;
}

function OrgModal({ initial, onSave, onClose }: OrgModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [adminEmail, setAdminEmail] = useState(initial?.admin_email ?? "");
  const [contactName, setContactName] = useState(initial?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contact_phone ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !adminEmail.trim()) return;
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated.");
      setSaving(false);
      return;
    }

    const payload = {
      name: name.trim(),
      admin_email: adminEmail.trim(),
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      notes: notes.trim() || null,
    };

    const { error: dbError } = isEdit
      ? await supabase
          .from("interleague_orgs")
          .update(payload)
          .eq("id", initial.id)
      : await supabase
          .from("interleague_orgs")
          .insert([{ ...payload, owner_id: user.id }]);

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    onSave();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-[#0C1F3F]">
            {isEdit ? "Edit org" : "Add interleague org"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Org name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riverside Youth Baseball"
              autoFocus
              required
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Admin email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@otherleague.org"
              required
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Contact name
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Optional"
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Contact phone
              </label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Optional"
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this org…"
              rows={3}
              className="resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-[#0C1F3F] placeholder:text-gray-400 focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !adminEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add org"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirmation dialog ─────────────────────────────────────────────────

interface DeleteDialogProps {
  orgName: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

function DeleteDialog({ orgName, onConfirm, onCancel, deleting }: DeleteDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-[#0C1F3F]">Delete org?</h3>
            <p className="mt-1 text-sm text-gray-500">
              <span className="font-medium text-[#0C1F3F]">{orgName}</span> will be
              permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-2 px-6 py-5">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InterleaguePage() {
  const [orgs, setOrgs] = useState<InterleagueOrg[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<InterleagueOrg | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<InterleagueOrg | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadOrgs() {
    const supabase = createClient();
    const { data } = await supabase
      .from("interleague_orgs")
      .select("*")
      .order("name");
    setOrgs((data as InterleagueOrg[]) ?? []);
  }

  useEffect(() => {
    loadOrgs().then(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() {
    setEditOrg(null);
    setModalOpen(true);
  }

  function openEdit(org: InterleagueOrg) {
    setEditOrg(org);
    setModalOpen(true);
  }

  function handleSaved() {
    setModalOpen(false);
    setEditOrg(null);
    loadOrgs();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("interleague_orgs").delete().eq("id", deleteTarget.id);
    await loadOrgs();
    setDeleteTarget(null);
    setDeleting(false);
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#0C1F3F]">Interleague</h1>
            <p className="mt-1 text-sm text-gray-500">
              External orgs you schedule interleague games against.
            </p>
          </div>
          {!loading && orgs.length > 0 && (
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
            >
              <Plus className="h-4 w-4" />
              Add org
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
            <Building2 className="mb-3 h-8 w-8 text-gray-300" />
            <p className="font-medium text-[#0C1F3F]">No interleague orgs yet</p>
            <p className="mt-1 text-sm text-gray-400">
              Add an org to schedule games against other leagues.
            </p>
            <button
              onClick={openAdd}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80"
            >
              <Plus className="h-4 w-4" />
              Add org
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-3">Org name</th>
                  <th className="px-5 py-3">Admin email</th>
                  <th className="px-5 py-3">Contact</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orgs.map((org) => (
                  <tr key={org.id} className="group hover:bg-gray-50/60">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-[#0C1F3F]">{org.name}</p>
                      {org.notes && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">
                          {org.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">{org.admin_email}</td>
                    <td className="px-5 py-3.5">
                      {org.contact_name || org.contact_phone ? (
                        <div className="flex flex-col gap-0.5">
                          {org.contact_name && (
                            <span className="text-gray-700">{org.contact_name}</span>
                          )}
                          {org.contact_phone && (
                            <span className="text-xs text-gray-400">{org.contact_phone}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => openEdit(org)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#0C1F3F]"
                          aria-label="Edit org"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(org)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                          aria-label="Delete org"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <OrgModal
          initial={editOrg}
          onSave={handleSaved}
          onClose={() => { setModalOpen(false); setEditOrg(null); }}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          orgName={deleteTarget.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </>
  );
}
