"use client";

// Admin: who signed up. Renders the page's data; every decision and word comes
// from src/lib/volunteers/signups-screen.ts and words.ts (verbatim). Writes
// are 0121 part 5's admin functions — assign, cancel, no-show — each reply
// checked before the screen says it worked.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  applyFilters,
  assignStatusLine,
  buildSpotRows,
  fmtWhen,
  lostDetail,
  lostGroups,
  lostTitle,
  signupsCsv,
  splitByTime,
  startedTag,
  volunteerName,
  type Filters,
  type ScreenGame,
  type ScreenRoleRow,
  type ScreenTeam,
  type SignupClaim,
  type SpotRow,
} from "@/lib/volunteers/signups-screen";
import * as W from "@/lib/volunteers/words";

export type SignupsScreenData = {
  seasonId: string;
  seasonName: string;
  /** The league's wall clock now, "YYYY-MM-DDTHH:MM" (from the database). */
  nowWall: string;
  divisions: { id: string; name: string }[];
  teams: ScreenTeam[];
  games: ScreenGame[];
  roles: ScreenRoleRow[];
  claims: SignupClaim[];
};

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
const SELECT = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm";

export function SignupsScreen({ data }: { data: SignupsScreenData }) {
  const divisionName = useMemo(() => new Map(data.divisions.map((d) => [d.id, d.name])), [data.divisions]);
  const teamById = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data.teams]);
  const rows = useMemo(
    () => buildSpotRows({ games: data.games, roles: data.roles, teams: data.teams, divisionName, claims: data.claims }),
    [data, divisionName],
  );
  const [filters, setFilters] = useState<Filters>({ roleId: null, divisionId: null, show: "all" });
  const { upcoming, past } = splitByTime(applyFilters(rows, filters), data.nowWall);
  const lost = lostGroups(data.claims, data.teams, divisionName);
  const [assignFor, setAssignFor] = useState<SpotRow | null>(null);
  const [changeFor, setChangeFor] = useState<SpotRow | null>(null);

  const teamLabel = (c: SignupClaim) => {
    const t = c.family_team_id ? teamById.get(c.family_team_id) : undefined;
    if (!t) return "—";
    return `${t.divisionId ? divisionName.get(t.divisionId) ?? "" : ""} ${t.name}`.trim();
  };

  function exportCsv() {
    const csv = signupsCsv(rows, data.teams, divisionName);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.seasonName} volunteer sign-ups.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard/volunteers" className="text-sm text-gray-500 hover:underline">
            {W.BACK_TO_ROLES}
          </Link>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">{W.SIGNUPS_TITLE}</h1>
        </div>
        <button type="button" onClick={exportCsv} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-[#0C1F3F] hover:bg-gray-50">
          {W.EXPORT_CSV}
        </button>
      </div>

      {lost.map((g) => (
        <LostBanner key={`${g.divisionName}|${g.day}`} group={g} />
      ))}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <select className={SELECT} value={filters.roleId ?? ""} onChange={(e) => setFilters({ ...filters, roleId: e.target.value || null })} aria-label="Role">
          <option value="">{W.FILTER_ALL_ROLES}</option>
          {data.roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select className={SELECT} value={filters.divisionId ?? ""} onChange={(e) => setFilters({ ...filters, divisionId: e.target.value || null })} aria-label="Division">
          <option value="">{W.FILTER_ALL_DIVISIONS}</option>
          {data.divisions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select className={SELECT} value={filters.show} onChange={(e) => setFilters({ ...filters, show: e.target.value as Filters["show"] })} aria-label="Show">
          <option value="all">{W.SHOW_ALL}</option>
          <option value="open">{W.SHOW_OPEN}</option>
          <option value="filled">{W.SHOW_FILLED}</option>
        </select>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="hidden w-full md:table">
          <thead className="border-b border-gray-100">
            <tr>
              <th className={TH}>{W.COL_WHEN}</th>
              <th className={TH}>{W.COL_SPOT}</th>
              <th className={TH}>{W.COL_VOLUNTEER}</th>
              <th className={TH}>{W.COL_TEAM}</th>
              <th className={TH}>{W.COL_EMAIL}</th>
              <th className={TH}>{W.COL_FILLED_BY}</th>
              <th className={TH}>{W.COL_ACTIONS}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {upcoming.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 text-gray-700">
                  {fmtWhen(r.start)}
                  <StartedChip row={r} nowWall={data.nowWall} />
                </td>
                <td className="px-3 py-3">
                  <div className="font-semibold text-[#0C1F3F]">{r.title}</div>
                  <div className="text-xs text-gray-500">{r.detail}</div>
                  {r.note && <div className="mt-1 text-xs text-amber-700">{r.note}</div>}
                </td>
                <td className="px-3 py-3 text-gray-800">{r.claim ? volunteerName(r.claim) : <span className="text-gray-500">{W.OPEN_SPOT}</span>}</td>
                <td className="px-3 py-3 text-gray-700">{r.claim ? teamLabel(r.claim) : "—"}</td>
                <td className="px-3 py-3 text-gray-700">
                  {r.claim?.email ?? ""}
                </td>
                <td className="px-3 py-3 text-gray-700">{r.claim ? (r.claim.created_by === "admin" ? W.BY_ADMIN : W.BY_VOLUNTEER) : ""}</td>
                <td className="px-3 py-3">
                  <RowAction row={r} onAssign={setAssignFor} onChange={setChangeFor} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="divide-y divide-gray-100 md:hidden">
          {upcoming.map((r) => (
            <li key={r.key} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-gray-500">
                    {fmtWhen(r.start)}
                    <StartedChip row={r} nowWall={data.nowWall} />
                  </div>
                  <div className="font-semibold text-[#0C1F3F]">{r.title}</div>
                  <div className="text-xs text-gray-500">{r.detail}</div>
                </div>
                <RowAction row={r} onAssign={setAssignFor} onChange={setChangeFor} />
              </div>
              {r.note && <div className="mt-1 text-xs text-amber-700">{r.note}</div>}
              <div className="mt-1 text-gray-800">
                {r.claim ? (
                  <>
                    {volunteerName(r.claim)} · {teamLabel(r.claim)}
                    <div className="break-all text-gray-600">{r.claim.email}</div>
                  </>
                ) : (
                  <span className="text-gray-500">{W.OPEN_SPOT}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {upcoming.length === 0 && <p className="px-4 py-3 text-sm text-gray-600">{W.NO_UPCOMING}</p>}
      </section>

      {past.length > 0 && <PastList rows={past} teamLabel={teamLabel} />}

      {assignFor && (
        <AssignModal seasonId={data.seasonId} row={assignFor} teams={data.teams} divisionName={divisionName} onClose={() => setAssignFor(null)} />
      )}
      {changeFor && changeFor.claim && (
        <ChangeModal
          row={changeFor}
          onClose={() => setChangeFor(null)}
          onReassign={() => {
            const r = { ...changeFor, claim: null };
            setChangeFor(null);
            setAssignFor(r);
          }}
        />
      )}
    </div>
  );
}

function StartedChip({ row, nowWall }: { row: SpotRow; nowWall: string }) {
  const tag = startedTag(row, nowWall);
  return tag ? <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{tag}</span> : null;
}

function RowAction({ row, onAssign, onChange }: { row: SpotRow; onAssign: (r: SpotRow) => void; onChange: (r: SpotRow) => void }) {
  const cls = "rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-[#0C1F3F] hover:bg-gray-50";
  return row.claim ? (
    <button type="button" className={cls} onClick={() => onChange(row)}>{W.CHANGE}</button>
  ) : (
    <button type="button" className={cls} onClick={() => onAssign(row)}>{W.ASSIGN}</button>
  );
}

function LostBanner({ group }: { group: ReturnType<typeof lostGroups>[number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{lostTitle(group)}</p>
          <p>{lostDetail(group.claims.length)}</p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} className="font-semibold underline">
          {open ? W.HIDE_WHO : W.SEE_WHO}
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1">
          {group.claims.map((c) => (
            <li key={c.claim_id}>
              {volunteerName(c)} · {c.email}
              {c.detached_from?.start ? ` · was ${fmtWhen(c.detached_from.start)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PastList({ rows, teamLabel }: { rows: SpotRow[]; teamLabel: (c: SignupClaim) => string }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle(c: SignupClaim, next: boolean) {
    setSaving(c.claim_id);
    setError(null);
    // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
    const r = await createClient().rpc("volunteer_set_no_show", { p_claim_id: c.claim_id, p_no_show: next });
    setSaving(null);
    if (r.error || (r.data as { status?: string } | null)?.status !== "saved") {
      setError(W.NO_SHOW_FAILED);
      return;
    }
    router.refresh();
  }
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-[#0C1F3F]">{W.PAST_TITLE}</h2>
      <p className="text-sm text-gray-600">{W.PAST_DETAIL}</p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <ul className="mt-3 divide-y divide-gray-100 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-gray-500">{fmtWhen(r.start)}</div>
              <div className="font-semibold text-[#0C1F3F]">{r.title}</div>
              <div className="text-gray-700">{r.claim && `${volunteerName(r.claim)} · ${teamLabel(r.claim)}`}</div>
            </div>
            {r.claim && (
              <label className="flex flex-shrink-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.claim.no_show}
                  disabled={saving === r.claim.claim_id}
                  onChange={(e) => void toggle(r.claim!, e.target.checked)}
                />
                {W.NO_SHOW}
              </label>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModalFrame({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-semibold text-[#0C1F3F]">{title}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">{children}</div>
      </div>
    </div>
  );
}

function SpotSummary({ row }: { row: SpotRow }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="font-semibold text-[#0C1F3F]">{row.title}</div>
      <div className="text-gray-600">{fmtWhen(row.start)} · {row.detail}</div>
    </div>
  );
}

function AssignModal({
  seasonId,
  row,
  teams,
  divisionName,
  onClose,
}: {
  seasonId: string;
  row: SpotRow;
  teams: ScreenTeam[];
  divisionName: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState("");
  const [initial, setInitial] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [adult, setAdult] = useState(false);
  const [overlap, setOverlap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...teams].sort(
    (a, b) => (divisionName.get(a.divisionId ?? "") ?? "").localeCompare(divisionName.get(b.divisionId ?? "") ?? "") || a.name.localeCompare(b.name),
  );

  async function submit(confirmOverlap: boolean) {
    setBusy(true);
    setError(null);
    // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
    const r = await createClient().rpc("volunteer_admin_assign", {
      p_season_id: seasonId,
      p_game_id: row.gameId,
      p_role_id: row.roleId,
      p_for_team_id: row.forTeamId,
      p_team_id: teamId || null,
      p_first_initial: initial,
      p_last_name: last,
      p_email: email,
      p_adult: adult,
      p_confirm_overlap: confirmOverlap,
    });
    setBusy(false);
    const status = r.error ? null : (r.data as { status?: string } | null)?.status;
    if (status === "assigned") {
      onClose();
      router.refresh();
      return;
    }
    setOverlap(status === "overlap_confirm_needed");
    setError(r.error ? W.settingsErrorLine(r.error.message) : assignStatusLine(status));
  }

  return (
    <ModalFrame title={W.ASSIGN_TITLE} onClose={onClose} busy={busy}>
      <SpotSummary row={row} />
      <label className="block">
        <span className="font-semibold text-[#0C1F3F]">{W.ASSIGN_FAMILY_TEAM}</span>
        <select className={`${SELECT} mt-1 w-full`} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">{W.ASSIGN_PICK_TEAM}</option>
          {sorted.map((t) => (
            <option key={t.id} value={t.id}>
              {`${t.divisionId ? divisionName.get(t.divisionId) ?? "" : ""} ${t.name}`.trim()}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-3">
        <label className="w-24">
          <span className="font-semibold text-[#0C1F3F]">{W.ASSIGN_FIRST_INITIAL}</span>
          <input value={initial} maxLength={1} onChange={(e) => setInitial(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
        </label>
        <label className="flex-1">
          <span className="font-semibold text-[#0C1F3F]">{W.ASSIGN_LAST_NAME}</span>
          <input value={last} maxLength={60} onChange={(e) => setLast(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
        </label>
      </div>
      <label className="block">
        <span className="font-semibold text-[#0C1F3F]">{W.ASSIGN_EMAIL}</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
        <span className="mt-1 block text-gray-500">{W.ASSIGN_EMAIL_NOTE}</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>{W.ASSIGN_ADULT}</span>
      </label>
      {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 font-medium text-gray-600">
          {W.CANCEL}
        </button>
        <button
          type="button"
          onClick={() => void submit(overlap)}
          disabled={busy || !teamId || !adult || !initial.trim() || !last.trim() || !email.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {overlap ? W.ASSIGN_ANYWAY : W.ASSIGN}
        </button>
      </div>
    </ModalFrame>
  );
}

function ChangeModal({ row, onClose, onReassign }: { row: SpotRow; onClose: () => void; onReassign: () => void }) {
  const router = useRouter();
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claim = row.claim!;

  async function cancel(then: "close" | "reassign") {
    setBusy(true);
    setError(null);
    // @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
    const r = await createClient().rpc("volunteer_admin_cancel", { p_claim_id: claim.claim_id, p_notify: notify });
    setBusy(false);
    if (r.error || (r.data as { status?: string } | null)?.status !== "canceled") {
      setError(W.CHANGE_FAILED);
      return;
    }
    router.refresh();
    if (then === "reassign") onReassign();
    else onClose();
  }

  return (
    <ModalFrame title={W.CHANGE_TITLE} onClose={onClose} busy={busy}>
      <SpotSummary row={row} />
      <p className="text-gray-800">
        {volunteerName(claim)} · {claim.email}
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span>{W.CHANGE_NOTIFY}</span>
      </label>
      {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => void cancel("reassign")} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 font-semibold text-[#0C1F3F]">
          {W.CHANGE_REASSIGN}
        </button>
        <button
          type="button"
          onClick={() => void cancel("close")}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {W.CHANGE_CANCEL}
        </button>
      </div>
    </ModalFrame>
  );
}
