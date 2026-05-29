"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MoreHorizontal,
  Trash2,
  X,
  UserPlus,
  Mail,
  RotateCw,
} from "lucide-react";
import { PLAN_LIMITS, type Plan } from "@/lib/plan/limits";
import { planLabel } from "@/lib/plan/labels";
import { UpgradeModal } from "@/components/plan/upgrade-cta";

export type TeamMember = {
  user_id: string;
  role: "owner" | "admin";
  added_at: string;
  full_name: string | null;
  email: string;
};

export type PendingInvite = {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
};

interface Props {
  members: TeamMember[];
  pendingInvites: PendingInvite[];
  /** The signed-in user. Reserved for future role-derived UI flourishes
   *  (e.g. highlighting "(you)"); currently the owner-vs-admin gating is
   *  resolved server-side and passed as callerIsOwner. */
  callerUserId: string;
  callerIsOwner: boolean;
  plan: Plan;
}

function initials(name: string | null, email: string): string {
  const source = (name && name.trim()) || email;
  const parts = source.split(/[\s@]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function TeamMembersClient({
  members,
  pendingInvites,
  callerUserId,
  callerIsOwner,
  plan,
}: Props) {
  // Reserved; see Props.callerUserId.
  void callerUserId;
  const router = useRouter();
  const cap = PLAN_LIMITS[plan].admins;
  const seatsUsed = members.length + pendingInvites.length;
  const atCap = seatsUsed >= cap;

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);

  return (
    <div className="flex flex-col gap-5">
      {/* Header row: seat usage + invite button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {seatsUsed} of {cap} {cap === 1 ? "seat" : "seats"} used ·{" "}
          <span className="font-medium text-gray-700">{planLabel(plan)} plan</span>
        </p>
        {callerIsOwner ? (
          <button
            type="button"
            onClick={() =>
              atCap ? setUpgradeModalOpen(true) : setInviteModalOpen(true)
            }
            aria-disabled={atCap || undefined}
            className={
              atCap
                ? "inline-flex cursor-default items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500"
                : "inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a]"
            }
            title={
              atCap
                ? `You've reached your ${planLabel(plan)} plan's admin limit of ${cap}.`
                : undefined
            }
          >
            <UserPlus className="h-3.5 w-3.5" />
            Invite admin
          </button>
        ) : null}
      </div>

      {/* Active members */}
      <ul className="flex flex-col divide-y divide-gray-100">
        {members.map((m) => (
          <li
            key={m.user_id}
            className="flex items-center justify-between gap-3 py-3 first:pt-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#22C55E]/15 ring-1 ring-[#22C55E]/30">
                <span className="text-xs font-semibold text-[#16a34a]">
                  {initials(m.full_name, m.email)}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {m.full_name?.trim() || m.email || "Unknown"}
                </p>
                {m.full_name && m.email ? (
                  <p className="truncate text-xs text-gray-500">{m.email}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span
                className={
                  m.role === "owner"
                    ? "inline-flex items-center rounded-full bg-[#0C1F3F] px-2.5 py-0.5 text-xs font-medium text-white"
                    : "inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                }
              >
                {m.role === "owner" ? "Owner" : "Admin"}
              </span>
              {callerIsOwner && m.role !== "owner" ? (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(m)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  title="Remove admin"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {/* Pending invitations */}
      {pendingInvites.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Pending invitations
          </p>
          <ul className="flex flex-col divide-y divide-gray-100">
            {pendingInvites.map((inv) => (
              <PendingInviteRow
                key={inv.id}
                invite={inv}
                showActions={callerIsOwner}
                onChanged={() => router.refresh()}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {inviteModalOpen ? (
        <InviteAdminModal
          onClose={() => setInviteModalOpen(false)}
          onInvited={() => {
            setInviteModalOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {confirmRemove ? (
        <RemoveMemberModal
          member={confirmRemove}
          onClose={() => setConfirmRemove(null)}
          onRemoved={() => {
            setConfirmRemove(null);
            router.refresh();
          }}
        />
      ) : null}

      {upgradeModalOpen ? (
        <UpgradeModal
          cap="admins"
          limit={cap}
          currentPlan={plan}
          onClose={() => setUpgradeModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function PendingInviteRow({
  invite,
  showActions,
  onChanged,
}: {
  invite: PendingInvite;
  showActions: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"revoke" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, action: "revoke" | "resend") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitation_id: invite.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Action failed.");
        setBusy(null);
        return;
      }
      onChanged();
    } catch {
      setError("Network error.");
      setBusy(null);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-200">
          <Mail className="h-4 w-4 text-amber-700" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {invite.email}
          </p>
          <p className="truncate text-xs text-gray-500">
            Sent {formatRelativeDate(invite.created_at)} · expires{" "}
            {formatRelativeDate(invite.expires_at)}
            {error ? <span className="ml-2 text-red-600">{error}</span> : null}
          </p>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Pending
        </span>
        {showActions ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => call("/api/orgs/invitations/resend", "resend")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60"
              title="Resend"
            >
              {busy === "resend" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCw className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => call("/api/orgs/invitations/revoke", "revoke")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
              title="Revoke"
            >
              {busy === "revoke" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function InviteAdminModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/orgs/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        setError(typeof json.error === "string" ? json.error : "Invite failed.");
        setSubmitting(false);
        return;
      }
      // Brief success message before closing — confirms whether it was a
      // direct add or an email invite.
      const kind = json.kind as string | undefined;
      setSuccessMsg(
        kind === "direct_add"
          ? `Added ${json.email} as an admin.`
          : `Invitation sent to ${json.email}.`,
      );
      setTimeout(() => onInvited(), 700);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Invite admin</h2>
            <p className="mt-1 text-xs text-gray-500">
              They&rsquo;ll have full operational access — managing seasons,
              venues, and schedules — but only the owner can manage admins.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-700">
              Email address
            </span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-[#22C55E] focus:outline-none focus:ring-1 focus:ring-[#22C55E]"
            />
          </label>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
          {successMsg ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {successMsg}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || successMsg !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Send invite
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RemoveMemberModal({
  member,
  onClose,
  onRemoved,
}: {
  member: TeamMember;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs/members/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: member.user_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Action failed.");
        setBusy(false);
        return;
      }
      onRemoved();
    } catch {
      setError("Network error.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Remove admin?</h2>
        <p className="mt-2 text-sm text-gray-600">
          <strong>
            {member.full_name?.trim() || member.email || "This admin"}
          </strong>{" "}
          will lose access to this organization immediately. Their own
          organization and personal data are not affected.
        </p>
        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Remove admin
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-export the icon name to keep the import surface tidy.
export { MoreHorizontal };
