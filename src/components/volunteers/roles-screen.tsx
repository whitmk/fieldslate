"use client";

// Admin: volunteer roles. Renders the page's data; every decision and word
// comes from src/lib/volunteers/roles-screen.ts and words.ts (verbatim). Role
// writes go through save_volunteer_role / delete_volunteer_role (0121), each
// its own preview first: a change that cancels sign-ups is confirmed before
// it commits. Approved plan 2026-11-08 — see roles-screen.ts's header for how
// it differs from the AdminRoles board.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  commitOk,
  createsLine,
  deleteLine,
  divisionsLabel,
  draftProblem,
  filledLabel,
  kindLocked,
  previewOutcome,
  slotCount,
  slotsLabel,
  type RoleDraft,
  type ScreenDivision,
  type ScreenRole,
} from "@/lib/volunteers/roles-screen";
import { MAX_LEAD_MIN, MAX_SPOTS, type SlotGame } from "@/lib/volunteers/slots";
import { snackTotalSpots, type ShiftRow } from "@/lib/volunteers/shifts";
import * as W from "@/lib/volunteers/words";

export type RolesScreenData = {
  seasonId: string;
  seasonName: string;
  divisions: ScreenDivision[];
  teamDivision: [string, string][];
  games: SlotGame[];
  roles: (ScreenRole & { countsTowardGoal: boolean })[];
  /** Active sign-ups per role id, or null when they couldn't be counted. */
  active: [string, number][] | null;
  /** The public sign-up URL when the link is on, else null. */
  link: string | null;
  /** The season's snack shack (0122): its shifts are the snack shack role's
   *  spots. `role` is null until the league adds snack shack sign-ups. */
  snack: {
    setUp: boolean;
    peoplePerShift: number;
    shifts: ShiftRow[];
    role: { id: string; name: string; signupsOpen: boolean; countsTowardGoal: boolean } | null;
  };
};

const ROLES_TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";

export function RolesScreen({ data }: { data: RolesScreenData }) {
  const teamDivision = useMemo(() => new Map(data.teamDivision), [data.teamDivision]);
  const active = useMemo(() => (data.active ? new Map(data.active) : null), [data.active]);
  const [editing, setEditing] = useState<RoleDraft | null>(null);

  function rowFor(role: RolesScreenData["roles"][number]) {
    const total = slotCount(role, data.games, teamDivision).spots;
    return {
      role,
      slots: slotsLabel(role.kind, role.spots),
      divisions: divisionsLabel(role, data.divisions),
      signups: role.signupsOpen ? W.SIGNUPS_ON : W.SIGNUPS_OFF,
      filled: filledLabel(active ? active.get(role.id) ?? 0 : null, total) ?? W.FILLED_UNKNOWN,
    };
  }
  const rows = data.roles.map(rowFor);

  // 0122: the snack shack row.
  const snackRole = data.snack.role;
  const snack = {
    spots: W.SNACK_SPOTS,
    signups: snackRole ? (snackRole.signupsOpen ? W.SIGNUPS_ON : W.SIGNUPS_OFF) : "",
    filled: snackRole
      ? filledLabel(active ? active.get(snackRole.id) ?? 0 : null, snackTotalSpots(data.snack.shifts)) ?? W.FILLED_UNKNOWN
      : "",
  };
  const openSnack = () =>
    setEditing({
      id: snackRole?.id ?? null,
      name: snackRole?.name ?? W.SNACK_ROLE_DEFAULT_NAME,
      kind: "snack_shack",
      spots: 1,
      leadMinutes: 0,
      divisionIds: [],
      signupsOpen: snackRole?.signupsOpen ?? true,
      countsTowardGoal: snackRole?.countsTowardGoal ?? true,
    });
  const snackAction = !data.snack.setUp ? (
    <span className="text-sm text-gray-600">
      {W.SNACK_NOT_SET_UP}{" "}
      <Link href="/dashboard/snack-shack" className="font-semibold text-[#0C1F3F] hover:underline">{W.SNACK_SETUP_LINK}</Link>
    </span>
  ) : !snackRole ? (
    <button type="button" onClick={openSnack} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-[#0C1F3F] hover:bg-gray-50">
      {W.SNACK_ADD}
    </button>
  ) : null;

  const openNew = () =>
    setEditing({
      id: null,
      name: "",
      kind: "per_game",
      spots: 1,
      leadMinutes: 0,
      divisionIds: data.divisions.map((d) => d.id),
      signupsOpen: true,
      countsTowardGoal: true,
    });
  const openEdit = (r: RolesScreenData["roles"][number]) =>
    setEditing({
      id: r.id,
      name: r.name,
      kind: r.kind,
      spots: r.spots,
      leadMinutes: r.leadMinutes ?? 0,
      divisionIds: [...r.divisionIds],
      signupsOpen: r.signupsOpen,
      countsTowardGoal: r.countsTowardGoal,
    });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">{data.seasonName} · {W.NAV_LABEL}</p>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">{W.ROLES_TITLE}</h1>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href="/dashboard/volunteers/signups" className="text-sm font-semibold text-[#0C1F3F] hover:underline">
            {W.WHO_SIGNED_UP_LINK}
          </Link>
          <Link href="/dashboard/volunteers/tracker" className="text-sm font-semibold text-[#0C1F3F] hover:underline">
            {W.TRACKER_LINK}
          </Link>
        </div>
      </div>

      <LinkStrip link={data.link} />

      <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h2 className="font-semibold text-[#0C1F3F]">{W.ROLES_TABLE_TITLE}</h2>
          <button
            type="button"
            onClick={openNew}
            className="rounded-lg bg-[#0C1F3F] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0C1F3F]/85"
          >
            {W.ADD_ROLE}
          </button>
        </div>

        {/* Table at md and up */}
        <table className="hidden w-full md:table">
          <thead className="border-b border-gray-100">
            <tr>
              <th className={ROLES_TH}>{W.COL_ROLE}</th>
              <th className={ROLES_TH}>{W.COL_SLOTS}</th>
              <th className={ROLES_TH}>{W.COL_DIVISIONS}</th>
              <th className={ROLES_TH}>{W.COL_SIGNUPS}</th>
              <th className={ROLES_TH}>{W.COL_FILLED}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {rows.map((r) => (
              <tr key={r.role.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openEdit(r.role)}>
                <td className="px-3 py-3 font-semibold text-[#0C1F3F]">
                  <button type="button" className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); openEdit(r.role); }}>
                    {r.role.name}
                  </button>
                </td>
                <td className="px-3 py-3 text-gray-700">{r.slots}</td>
                <td className="px-3 py-3 text-gray-700">{r.divisions}</td>
                <td className="px-3 py-3 text-gray-700">{r.signups}</td>
                <td className="px-3 py-3 text-gray-700">{r.filled}</td>
              </tr>
            ))}
            <tr className={snackRole ? "cursor-pointer hover:bg-gray-50" : ""} onClick={snackRole ? openSnack : undefined}>
              <td className="px-3 py-3">
                <div className="font-semibold text-[#0C1F3F]">{snackRole?.name ?? W.SNACK_ROLE_DEFAULT_NAME}</div>
                <div className="text-xs text-gray-500">{W.SNACK_SOURCE}</div>
              </td>
              {snackAction ? (
                <td className="px-3 py-3" colSpan={4}>{snackAction}</td>
              ) : (
                <>
                  <td className="px-3 py-3 text-gray-700">{snack.spots}</td>
                  <td className="px-3 py-3 text-gray-700">{W.SNACK_DIVISIONS}</td>
                  <td className="px-3 py-3 text-gray-700">{snack.signups}</td>
                  <td className="px-3 py-3 text-gray-700">{snack.filled}</td>
                </>
              )}
            </tr>
            <tr className="bg-gray-50/60">
              <td className="px-3 py-3">
                <div className="font-semibold text-[#0C1F3F]">{W.UMPIRES_ROLE}</div>
                <div className="text-xs text-gray-500">{W.UMPIRES_SOURCE}</div>
              </td>
              <td className="px-3 py-3 text-gray-700">{W.UMPIRES_SLOTS}</td>
              <td className="px-3 py-3 text-gray-700">All</td>
              <td className="px-3 py-3 text-gray-700">{W.UMPIRES_SIGNUPS}</td>
              <td className="px-3 py-3">
                <Link href="/dashboard/umpires" className="text-sm font-semibold text-[#0C1F3F] hover:underline">
                  {W.UMPIRES_LINK}
                </Link>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Cards below md */}
        <ul className="divide-y divide-gray-100 md:hidden">
          {rows.map((r) => (
            <li key={r.role.id}>
              <button type="button" onClick={() => openEdit(r.role)} className="w-full px-4 py-3 text-left">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[#0C1F3F]">{r.role.name}</span>
                  <span className="text-sm text-gray-600">{r.filled}</span>
                </div>
                <div className="mt-0.5 text-sm text-gray-600">{r.slots}</div>
                <div className="text-sm text-gray-500">
                  {r.divisions} · {W.COL_SIGNUPS} {r.signups.toLowerCase()}
                </div>
              </button>
            </li>
          ))}
          <li>
            {snackAction ? (
              <div className="px-4 py-3">
                <div className="font-semibold text-[#0C1F3F]">{W.SNACK_ROLE_DEFAULT_NAME}</div>
                <div className="mb-2 text-sm text-gray-600">{W.SNACK_SOURCE}</div>
                {snackAction}
              </div>
            ) : (
              <button type="button" onClick={openSnack} className="w-full px-4 py-3 text-left">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[#0C1F3F]">{snackRole?.name}</span>
                  <span className="text-sm text-gray-600">{snack.filled}</span>
                </div>
                <div className="mt-0.5 text-sm text-gray-600">{snack.spots}</div>
                <div className="text-sm text-gray-500">
                  {W.SNACK_SOURCE} · {W.COL_SIGNUPS} {snack.signups.toLowerCase()}
                </div>
              </button>
            )}
          </li>
          <li className="bg-gray-50/60 px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-[#0C1F3F]">{W.UMPIRES_ROLE}</span>
              <Link href="/dashboard/umpires" className="text-sm font-semibold text-[#0C1F3F] hover:underline">
                {W.UMPIRES_LINK}
              </Link>
            </div>
            <div className="text-sm text-gray-600">{W.UMPIRES_SOURCE}</div>
            <div className="text-sm text-gray-500">{W.UMPIRES_SIGNUPS}</div>
          </li>
        </ul>

        {rows.length === 0 && <p className="px-4 py-3 text-sm text-gray-600">{W.NO_ROLES}</p>}
        <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">{W.UMPIRES_FOOTNOTE}</p>
      </section>

      {editing && (
        <RoleEditor
          key={editing.id ?? "new"}
          seasonId={data.seasonId}
          initial={editing}
          divisions={data.divisions}
          games={data.games}
          teamDivision={teamDivision}
          kindIsLocked={kindLocked(editing.id, active)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function LinkStrip({ link }: { link: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h2 className="font-semibold text-[#0C1F3F]">{W.STRIP_TITLE}</h2>
        <p className="text-sm text-gray-600">{W.STRIP_DETAIL}</p>
        {!link && <p className="mt-1 text-sm text-gray-600">{W.STRIP_NO_LINK}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${link ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}
        >
          {link ? W.STRIP_ON : W.STRIP_OFF}
        </span>
        {link && (
          <>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
              }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-[#0C1F3F] hover:bg-gray-50"
            >
              {copied ? W.STRIP_COPIED : W.STRIP_COPY}
            </button>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-[#0C1F3F] hover:bg-gray-50"
            >
              {W.STRIP_OPEN}
            </a>
          </>
        )}
        <Link href="/dashboard/settings" className="px-1 text-sm font-semibold text-[#0C1F3F] hover:underline">
          {W.STRIP_SETTINGS}
        </Link>
      </div>
    </section>
  );
}

type Pending =
  | { what: "save"; line: string }
  | { what: "delete"; line: string | null };

function RoleEditor({
  seasonId,
  initial,
  divisions,
  games,
  teamDivision,
  kindIsLocked,
  onClose,
}: {
  seasonId: string;
  initial: RoleDraft;
  divisions: ScreenDivision[];
  games: SlotGame[];
  teamDivision: ReadonlyMap<string, string>;
  kindIsLocked: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<RoleDraft>(initial);
  const [leadText, setLeadText] = useState(String(initial.leadMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const leadValid = /^\d{1,3}$/.test(leadText) && Number(leadText) <= MAX_LEAD_MIN;
  const draft: RoleDraft = { ...d, leadMinutes: leadValid ? Number(leadText) : -1 };
  const problem = draftProblem(draft);
  // 0122: the snack shack role's spots are the shifts' — no count, no kind,
  // spots, divisions or lead to set.
  const isSnack = d.kind === "snack_shack";
  const count = d.kind === "snack_shack" ? null : slotCount({ ...draft, kind: d.kind }, games, teamDivision);

  async function call(fn: "save_volunteer_role" | "delete_volunteer_role", commit: boolean) {
    const supabase = createClient();
    const args =
      fn === "save_volunteer_role"
        ? {
            p_role_id: draft.id,
            p_season_id: seasonId,
            p_name: draft.name.trim(),
            p_kind: draft.kind,
            p_spots: draft.spots,
            p_lead_minutes: draft.leadMinutes,
            p_signups_open: draft.signupsOpen,
            p_counts: draft.countsTowardGoal,
            p_division_ids: draft.divisionIds,
            p_commit: commit,
          }
        : { p_role_id: draft.id, p_commit: commit };
    // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
    return (await supabase.rpc(fn, args)) as { data: unknown; error: { message: string } | null };
  }

  async function commit(fn: "save_volunteer_role" | "delete_volunteer_role") {
    setBusy(true);
    setError(null);
    const r = await call(fn, true);
    setBusy(false);
    if (r.error || !commitOk(r.data)) {
      setError(W.roleErrorLine(r.error?.message));
      return;
    }
    setPending(null);
    onClose();
    router.refresh();
  }

  async function start(fn: "save_volunteer_role" | "delete_volunteer_role") {
    if (fn === "save_volunteer_role" && problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await call(fn, false);
    setBusy(false);
    if (r.error) {
      setError(W.roleErrorLine(r.error.message));
      return;
    }
    const p = previewOutcome(r.data);
    if (p.kind === "error") {
      setError(W.roleErrorLine(null));
      return;
    }
    if (fn === "delete_volunteer_role") {
      setPending({ what: "delete", line: p.kind === "confirm" ? p.line : null });
      return;
    }
    if (p.kind === "confirm") {
      setPending({ what: "save", line: p.line });
      return;
    }
    await commit(fn);
  }

  const toggleDivision = (id: string) =>
    setD((x) => ({ ...x, divisionIds: x.divisionIds.includes(id) ? x.divisionIds.filter((y) => y !== id) : [...x.divisionIds, id] }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">
            {isSnack ? W.SNACK_EDIT_TITLE : initial.id ? W.EDIT_ROLE_TITLE(initial.name) : W.NEW_ROLE_TITLE}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          <label className="block">
            <span className="font-semibold text-[#0C1F3F]">{W.FIELD_NAME}</span>
            <input
              value={d.name}
              maxLength={60}
              onChange={(e) => setD({ ...d, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
            />
          </label>

          {isSnack && <p className="rounded-lg bg-gray-50 px-3 py-2 text-gray-600">{W.SNACK_EDIT_DETAIL}</p>}

          {!isSnack && (
          <>
          <fieldset>
            <legend className="font-semibold text-[#0C1F3F]">{W.FIELD_KIND}</legend>
            {(["per_game", "per_team"] as const).map((k) => (
              <label key={k} className={`mt-2 flex items-start gap-2 ${kindIsLocked ? "opacity-60" : ""}`}>
                <input
                  type="radio"
                  name="kind"
                  className="mt-1"
                  checked={d.kind === k}
                  disabled={kindIsLocked}
                  onChange={() => setD({ ...d, kind: k })}
                />
                <span>
                  <span className="font-medium text-[#0C1F3F]">{k === "per_game" ? W.KIND_PER_GAME : W.KIND_PER_TEAM}</span>
                  <span className="block text-gray-500">{k === "per_game" ? W.KIND_PER_GAME_DETAIL : W.KIND_PER_TEAM_DETAIL}</span>
                </span>
              </label>
            ))}
            {kindIsLocked && <p className="mt-2 text-gray-500">{W.KIND_LOCKED}</p>}
          </fieldset>

          <div>
            <span className="font-semibold text-[#0C1F3F]">{W.FIELD_SPOTS}</span>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                aria-label="Fewer"
                disabled={d.spots <= 1}
                onClick={() => setD({ ...d, spots: d.spots - 1 })}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-base font-semibold text-[#0C1F3F]">{d.spots}</span>
              <button
                type="button"
                aria-label="More"
                disabled={d.spots >= MAX_SPOTS}
                onClick={() => setD({ ...d, spots: d.spots + 1 })}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <fieldset>
            <legend className="font-semibold text-[#0C1F3F]">{W.FIELD_DIVISIONS}</legend>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {divisions.map((div) => (
                <label key={div.id} className="flex items-center gap-2 py-1">
                  <input type="checkbox" checked={d.divisionIds.includes(div.id)} onChange={() => toggleDivision(div.id)} />
                  <span>{div.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="font-semibold text-[#0C1F3F]">{W.FIELD_LEAD}</span>
            <span className="block text-gray-500">{W.LEAD_DETAIL}</span>
            <span className="mt-1 flex items-center gap-2">
              <input
                inputMode="numeric"
                value={leadText}
                onChange={(e) => setLeadText(e.target.value)}
                className={`w-24 rounded-lg border px-3 py-2 ${leadValid ? "border-gray-200" : "border-red-300"}`}
              />
              <span className="text-gray-600">min</span>
            </span>
          </label>
          </>
          )}

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.signupsOpen} onChange={(e) => setD({ ...d, signupsOpen: e.target.checked })} />
            <span className="font-medium text-[#0C1F3F]">{W.FIELD_OPEN}</span>
          </label>

          {count && (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-gray-600">
              {createsLine(count)} {W.PARTNER_NOTE}
            </p>
          )}

          {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
          {initial.id ? (
            <button
              type="button"
              onClick={() => void start("delete_volunteer_role")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {W.DELETE_ROLE}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600">
              {W.CANCEL}
            </button>
            <button
              type="button"
              onClick={() => void start("save_volunteer_role")}
              disabled={busy || problem !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {W.SAVE_ROLE}
            </button>
          </div>
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.what === "delete" ? deleteLine(initial.name) : W.SAVE_ROLE}
          detail={pending.line ?? undefined}
          confirmLabel={pending.what === "delete" ? W.DELETE_ROLE : W.SAVE_ROLE}
          tone={pending.what === "delete" || pending.line ? "danger" : "default"}
          busy={busy}
          error={error}
          onConfirm={() => void commit(pending.what === "delete" ? "delete_volunteer_role" : "save_volunteer_role")}
          onCancel={() => {
            setPending(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
