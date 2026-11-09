"use client";

// Admin: the volunteer tracker (0123). Renders the page's data; every
// decision and word comes from src/lib/volunteers/tracker.ts and words.ts
// (verbatim). Writes are 0123's admin functions, each reply checked before
// the screen says it worked; after a write the page reloads its numbers from
// the database (router.refresh) — the screen never adjusts counts itself.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  familyName,
  familyRows,
  familyStatus,
  memberLabel,
  mergeOutcome,
  nudgeable,
  nudgedLine,
  nudgeOutcome,
  nudgeVolunteerIds,
  officialRows,
  parseFamilyCount,
  parseGoal,
  progressLine,
  savedOutcome,
  separateOutcome,
  statusLabel,
  teamRows,
  teamsLabel,
  tiles,
  trackerCsv,
  whatCounts,
  type FamilyFilter,
  type TrackerData,
  type TrackerFamily,
  type TrackerMember,
  type TrackerTeam,
} from "@/lib/volunteers/tracker";
import * as W from "@/lib/volunteers/words";

export type TrackerScreenData = {
  seasonId: string;
  seasonName: string;
  officialTitle: string;
  officialsTitle: string;
  /** "Majors Expos" — division + team. */
  teams: TrackerTeam[];
  tracker: TrackerData;
};

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
const CARD = "rounded-xl border border-gray-100 bg-white p-4 sm:p-5";
const BTN = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-[#0C1F3F] hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

// @ts-expect-error — RPCs aren't in the hand-maintained Functions map.
const rpc = (name: string, args: Record<string, unknown>) => createClient().rpc(name, args);

export function TrackerScreen({ data }: { data: TrackerScreenData }) {
  const t = data.tracker;
  const teamName = useMemo(() => new Map(data.teams.map((x) => [x.id, x.name])), [data.teams]);
  const goal = t.goal.shifts_per_family;
  const [filter, setFilter] = useState<FamilyFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editGoal, setEditGoal] = useState(false);
  const [confirm, setConfirm] = useState<null | "nudge" | "merge">(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = familyRows(t, filter);
  const tile = tiles(t, data.teams);
  const chosen = t.families.filter((f) => selected.has(f.key));
  const nudgeTargets = chosen.filter(nudgeable);

  function exportCsv() {
    const csv = trackerCsv(t, teamName);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.seasonName} volunteer tracker.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard/volunteers/signups" className="text-sm text-gray-500 hover:underline">
            {W.TRACKER_BACK}
          </Link>
          <h1 className="text-2xl font-bold text-[#0C1F3F]">{W.TRACKER_TITLE}</h1>
        </div>
        <button type="button" onClick={exportCsv} className={BTN}>
          {W.TRACKER_EXPORT}
        </button>
      </div>

      {notice && (
        <p className={`rounded-lg px-4 py-3 text-sm ${notice.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{notice.text}</p>
      )}

      {/* Goal */}
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{W.GOAL_TITLE}</p>
            <p className="text-lg font-bold text-[#0C1F3F]">{goal === null ? W.GOAL_NONE : W.GOAL_LINE(goal)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span>{W.GOAL_WHAT_COUNTS}</span>
              {whatCounts(t, data.officialTitle).length === 0 ? (
                <span>{W.GOAL_NOTHING_COUNTS}</span>
              ) : (
                whatCounts(t, data.officialTitle).map((n) => (
                  <span key={n} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{n}</span>
                ))
              )}
            </div>
            <p className="mt-2 text-sm text-gray-500">{goal === null ? W.GOAL_NO_GOAL_NOTE : W.GOAL_RULE}</p>
          </div>
          <button type="button" onClick={() => setEditGoal(true)} className={BTN}>
            {goal === null ? W.GOAL_SET : W.GOAL_EDIT}
          </button>
        </div>
      </section>

      {/* Families per team */}
      <section className={CARD}>
        <p className="font-semibold text-[#0C1F3F]">{W.COUNTS_TITLE}</p>
        <p className="mt-1 text-sm text-gray-600">{W.COUNTS_DETAIL}</p>
      </section>

      {/* Tiles */}
      {goal !== null && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile n={String(tile.met)} label={W.TILE_MET} tone="green" />
          <Tile n={String(tile.onTrack)} label={W.TILE_ON_TRACK} tone="blue" />
          <Tile n={String(tile.short)} label={W.TILE_SHORT} tone="amber" />
          <Tile
            n={tile.notSignedUp === null ? "—" : String(tile.notSignedUp)}
            label={W.TILE_NOT_SIGNED_UP}
            sub={tile.notSignedUp === null ? W.TILE_NO_COUNTS : W.TILE_NOT_SIGNED_UP_NOTE}
            tone="gray"
          />
        </div>
      )}

      {/* By team */}
      <section className={CARD}>
        <p className="font-semibold text-[#0C1F3F]">{W.BY_TEAM_TITLE}</p>
        <p className="mt-1 text-sm text-gray-600">{W.BY_TEAM_DETAIL}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className={TH}>{W.COL_TEAM}</th>
                <th className={TH}>{W.COL_FAMILIES}</th>
                <th className={TH}>{W.COL_SIGNED_UP}</th>
                <th className={TH}>{W.COL_PROGRESS}</th>
                <th className={TH}>{W.COL_SHORT}</th>
                <th className={TH}>{W.COL_NOT_SIGNED_UP}</th>
              </tr>
            </thead>
            <tbody>
              {teamRows(t, data.teams).map((r) => (
                <tr key={r.teamId} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                  <td className="px-3 py-2">
                    <FamilyCountField seasonId={data.seasonId} teamId={r.teamId} value={r.families} />
                  </td>
                  <td className="px-3 py-2 text-gray-700">{r.signedUp}</td>
                  <td className="px-3 py-2">
                    <ProgressBar met={r.met} onTrack={r.onTrack} of={r.families ?? r.signedUp} />
                    <span className="text-xs text-gray-600">{progressLine(r, goal !== null)}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{goal === null ? "—" : r.short}</td>
                  <td className="px-3 py-2 text-gray-700">{r.notSignedUp === null ? <span className="text-gray-400">{W.NO_COUNT_SET}</span> : r.notSignedUp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-600" />{W.LEGEND_MET}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-400" />{W.LEGEND_ON_TRACK}</span>
        </div>
      </section>

      {/* Families */}
      <section className={CARD}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
            {(["all", "met", "short"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 font-medium ${filter === f ? "bg-[#0C1F3F] text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {f === "all" ? W.FILTER_ALL : f === "met" ? W.FILTER_MET : W.FILTER_SHORT}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={chosen.length !== 2} onClick={() => setConfirm("merge")} className={BTN}>
              {W.MERGE_BUTTON}
            </button>
            <button type="button" disabled={nudgeTargets.length === 0} onClick={() => setConfirm("nudge")} className={BTN_PRIMARY}>
              {W.NUDGE_BUTTON(nudgeTargets.length)}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">{t.families.length === 0 ? W.NO_FAMILIES : W.NO_FAMILIES_FILTER}</p>
        ) : (
          <>
            {/* Table at md and up */}
            <div className="mt-4 hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className={TH}><span className="sr-only">{W.COL_SELECT}</span></th>
                    <th className={TH}>{W.COL_FAMILY}</th>
                    <th className={TH}>{W.COL_TEAMS}</th>
                    <th className={TH}>{W.COL_WORKED}</th>
                    <th className={TH}>{W.COL_UPCOMING}</th>
                    <th className={TH}>{W.COL_NO_SHOWS}</th>
                    <th className={TH}>{W.COL_STATUS}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.key} className="border-b border-gray-50 align-top last:border-0">
                      <td className="px-3 py-3">
                        <input type="checkbox" className="h-4 w-4" checked={selected.has(f.key)} onChange={() => toggle(f.key)} aria-label={familyName(f)} />
                      </td>
                      <td className="px-3 py-3">
                        <FamilyCell seasonId={data.seasonId} f={f} nudged={t.nudged} />
                      </td>
                      <td className="px-3 py-3 text-gray-700">{teamsLabel(f, teamName) || "—"}</td>
                      <td className="px-3 py-3 text-gray-900">{f.worked}</td>
                      <td className="px-3 py-3 text-gray-900">{f.upcoming}</td>
                      <td className="px-3 py-3 text-gray-900">{f.no_shows}</td>
                      <td className="px-3 py-3"><StatusChip f={f} goal={goal} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Cards below md */}
            <ul className="mt-4 space-y-3 md:hidden">
              {rows.map((f) => (
                <li key={f.key} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-5 w-5" checked={selected.has(f.key)} onChange={() => toggle(f.key)} aria-label={familyName(f)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <FamilyCell seasonId={data.seasonId} f={f} nudged={t.nudged} />
                        <StatusChip f={f} goal={goal} />
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{teamsLabel(f, teamName) || "—"}</p>
                      <p className="mt-1 text-sm text-gray-700">
                        {W.COL_WORKED} {f.worked} · {W.COL_UPCOMING} {f.upcoming} · {W.COL_NO_SHOWS} {f.no_shows}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-xs text-gray-500">{W.NUDGE_NOTE}</p>
        {chosen.length > 0 && nudgeTargets.length < chosen.length && <p className="mt-1 text-xs text-gray-500">{W.NUDGE_OFFICIAL_ONLY(data.officialsTitle)}</p>}
      </section>

      <OfficialsPanel data={data} teamName={teamName} />

      {editGoal && <GoalDialog data={data} onClose={() => setEditGoal(false)} />}
      {confirm === "nudge" && (
        <NudgeConfirm
          seasonId={data.seasonId}
          families={nudgeTargets}
          onDone={(out) => {
            setConfirm(null);
            setNotice(out);
            if (out.ok) setSelected(new Set());
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "merge" && chosen.length === 2 && (
        <MergeConfirm
          seasonId={data.seasonId}
          a={chosen[0]}
          b={chosen[1]}
          onDone={(out) => {
            setConfirm(null);
            setNotice(out);
            if (out.ok) setSelected(new Set());
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function Tile({ n, label, sub, tone }: { n: string; label: string; sub?: string; tone: "green" | "blue" | "amber" | "gray" }) {
  const color = { green: "text-green-700", blue: "text-blue-700", amber: "text-amber-700", gray: "text-gray-700" }[tone];
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className={`text-2xl font-bold ${color}`}>{n}</p>
      <p className="text-sm font-medium text-gray-700">{label}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function ProgressBar({ met, onTrack, of }: { met: number; onTrack: number; of: number }) {
  const pct = (n: number) => (of > 0 ? `${Math.min(100, (n / of) * 100)}%` : "0%");
  return (
    <div className="mb-1 flex h-2 w-40 max-w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-full bg-green-600" style={{ width: pct(met) }} />
      <div className="h-full bg-blue-400" style={{ width: pct(onTrack) }} />
    </div>
  );
}

function StatusChip({ f, goal }: { f: TrackerFamily; goal: number | null }) {
  const s = familyStatus(goal, f);
  const cls = !s
    ? "bg-gray-100 text-gray-600"
    : s.bucket === "met"
      ? "bg-green-50 text-green-800"
      : s.bucket === "on_track"
        ? "bg-blue-50 text-blue-800"
        : "bg-amber-50 text-amber-800";
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{statusLabel(s)}</span>;
}

function FamilyCell({ seasonId, f, nudged }: { seasonId: string; f: TrackerFamily; nudged: TrackerData["nudged"] }) {
  const [separate, setSeparate] = useState<TrackerMember | null>(null);
  const nudge = nudgedLine(f, nudged);
  return (
    <div className="min-w-0">
      <p className="font-semibold text-gray-900">{familyName(f)}</p>
      <ul className="mt-0.5 space-y-0.5 text-sm text-gray-600">
        {f.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-2">
            <span>{memberLabel(m)}</span>
            {m.kind === "official" && m.by_email && <span className="text-xs text-gray-400">{W.FAMILY_BY_EMAIL}</span>}
            {f.members.length > 1 && (
              <button type="button" onClick={() => setSeparate(m)} className="text-xs font-medium text-gray-500 underline hover:text-gray-700">
                {W.SEPARATE}
              </button>
            )}
          </li>
        ))}
      </ul>
      {f.held > 0 && <p className="mt-1 text-xs text-gray-500">{W.FAMILY_HELD(f.held)}</p>}
      {nudge && <p className="mt-1 text-xs text-gray-500">{nudge}</p>}
      {separate && <SeparateConfirm seasonId={seasonId} member={separate} onClose={() => setSeparate(null)} />}
    </div>
  );
}

function SeparateConfirm({ seasonId, member, onClose }: { seasonId: string; member: TrackerMember; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title={W.SEPARATE_CONFIRM_TITLE(memberLabel(member))}
      detail={W.SEPARATE_CONFIRM_DETAIL}
      confirmLabel={W.SEPARATE_CONFIRM_LABEL}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={async () => {
        setBusy(true);
        const r = await rpc("separate_volunteer_family_member", { p_season_id: seasonId, p_member: member.id });
        const out = r.error ? separateOutcome(null) : separateOutcome(r.data);
        setBusy(false);
        if (!out.ok) return setError(out.text);
        onClose();
        router.refresh();
      }}
    />
  );
}

function NudgeConfirm({
  seasonId,
  families,
  onDone,
  onCancel,
}: {
  seasonId: string;
  families: TrackerFamily[];
  onDone: (out: { ok: boolean; text: string }) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = nudgeVolunteerIds(families);
  return (
    <ConfirmDialog
      title={W.NUDGE_CONFIRM_TITLE(families.length)}
      detail={W.NUDGE_CONFIRM_DETAIL(ids.length)}
      confirmLabel={W.NUDGE_CONFIRM_LABEL}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        const r = await rpc("volunteer_admin_nudge", { p_season_id: seasonId, p_volunteer_ids: ids });
        const out = r.error ? nudgeOutcome(null) : nudgeOutcome(r.data);
        setBusy(false);
        if (!out.ok) return setError(out.text);
        onDone(out);
        router.refresh();
      }}
    />
  );
}

function MergeConfirm({
  seasonId,
  a,
  b,
  onDone,
  onCancel,
}: {
  seasonId: string;
  a: TrackerFamily;
  b: TrackerFamily;
  onDone: (out: { ok: boolean; text: string }) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const args = { p_season_id: seasonId, p_keep_member: a.members[0].id, p_merge_member: b.members[0].id };
  return (
    <ConfirmDialog
      title={W.MERGE_CONFIRM_TITLE}
      detail={W.MERGE_CONFIRM_DETAIL(familyName(a), familyName(b))}
      confirmLabel={W.MERGE_CONFIRM_LABEL}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        // The database checks first (p_commit false writes nothing), then commits.
        const pre = await rpc("merge_volunteer_families", { ...args, p_commit: false });
        const preOut = pre.error ? mergeOutcome(null, false) : mergeOutcome(pre.data, false);
        if (!preOut.ok) {
          setBusy(false);
          return setError(preOut.text);
        }
        const r = await rpc("merge_volunteer_families", { ...args, p_commit: true });
        const out = r.error ? mergeOutcome(null, true) : mergeOutcome(r.data, true);
        setBusy(false);
        if (!out.ok) return setError(out.text);
        onDone(out);
        router.refresh();
      }}
    />
  );
}

function FamilyCountField({ seasonId, teamId, value }: { seasonId: string; teamId: string; value: number | null }) {
  const router = useRouter();
  const [text, setText] = useState(value === null ? "" : String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseFamilyCount(text);
  async function save() {
    if (parsed === "invalid") return setError(W.COUNTS_INVALID);
    if (parsed === value) return setError(null);
    setBusy(true);
    const r = await rpc("set_team_family_count", { p_season_id: seasonId, p_team_id: teamId, p_families: parsed });
    const out = r.error ? savedOutcome(null, W.COUNTS_SAVE_FAILED) : savedOutcome(r.data, W.COUNTS_SAVE_FAILED);
    setBusy(false);
    if (!out.ok) return setError(out.text);
    setError(null);
    router.refresh();
  }
  return (
    <div>
      <input
        inputMode="numeric"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={W.COL_FAMILIES}
        className={`w-16 rounded-lg border px-2 py-1 text-sm ${parsed === "invalid" || error ? "border-red-300" : "border-gray-200"}`}
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function GoalDialog({ data, onClose }: { data: TrackerScreenData; onClose: () => void }) {
  const router = useRouter();
  const t = data.tracker;
  const [text, setText] = useState(t.goal.shifts_per_family === null ? "" : String(t.goal.shifts_per_family));
  const [counting, setCounting] = useState<Set<string>>(new Set(t.roles.filter((r) => r.counts_toward_goal).map((r) => r.id)));
  const [officials, setOfficials] = useState(t.goal.officials_count);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseGoal(text);
  async function save() {
    if (parsed === "invalid") return setError(W.GOAL_SHIFTS_INVALID);
    setBusy(true);
    const r = await rpc("set_volunteer_goal", {
      p_season_id: data.seasonId,
      p_shifts: parsed,
      p_officials_count: officials,
      p_counting_role_ids: [...counting],
    });
    const out = r.error ? savedOutcome(null, W.GOAL_SAVE_FAILED) : savedOutcome(r.data, W.GOAL_SAVE_FAILED);
    setBusy(false);
    if (!out.ok) return setError(out.text);
    onClose();
    router.refresh();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="goal-title" className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 id="goal-title" className="text-lg font-bold text-[#0C1F3F]">{W.GOAL_DIALOG_TITLE}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={W.GOAL_CANCEL} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="mt-4 block text-sm font-semibold text-gray-800" htmlFor="goal-shifts">{W.GOAL_SHIFTS_LABEL}</label>
        <input
          id="goal-shifts"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`mt-1 w-24 rounded-lg border px-3 py-2 text-sm ${parsed === "invalid" ? "border-red-300" : "border-gray-200"}`}
        />
        <p className="mt-1 text-xs text-gray-500">{parsed === "invalid" ? W.GOAL_SHIFTS_INVALID : W.GOAL_SHIFTS_HELP}</p>
        <p className="mt-4 text-sm font-semibold text-gray-800">{W.GOAL_COUNTS_LABEL}</p>
        <ul className="mt-2 space-y-2">
          {t.roles.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={counting.has(r.id)}
                  onChange={() =>
                    setCounting((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                />
                {r.name}
              </label>
            </li>
          ))}
          <li>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" className="h-4 w-4" checked={officials} onChange={() => setOfficials((v) => !v)} />
              {W.GOAL_OFFICIALS_COUNT(data.officialsTitle)}
            </label>
          </li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">{W.GOAL_RULE}</p>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN}>{W.GOAL_CANCEL}</button>
          <button type="button" onClick={save} disabled={busy || parsed === "invalid"} className={BTN_PRIMARY}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {W.GOAL_SAVE}
          </button>
        </div>
      </div>
    </div>
  );
}

function OfficialsPanel({ data, teamName }: { data: TrackerScreenData; teamName: ReadonlyMap<string, string> }) {
  const t = data.tracker;
  const rows = officialRows(t, teamName);
  return (
    <section className={CARD}>
      <p className="font-semibold text-[#0C1F3F]">{data.officialsTitle}</p>
      <p className="mt-1 text-sm text-gray-600">{W.OFFICIALS_DETAIL(data.officialsTitle, data.officialTitle)}</p>
      {!t.goal.officials_count && <p className="mt-2 text-sm text-amber-700">{W.OFFICIALS_OFF(data.officialsTitle)}</p>}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{W.OFFICIALS_NONE(data.officialsTitle)}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {rows.map((o) => (
            <li key={o.umpireId} className="py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{o.name}</p>
                  {o.matchedLine && <p className="text-xs text-gray-500">{o.matchedLine}</p>}
                </div>
                <CountsForSelect seasonId={data.seasonId} umpireId={o.umpireId} name={o.name} value={o.countsForTeamId} teams={data.teams} />
              </div>
              {o.countsForTeamId && (
                <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {W.OFFICIAL_PAST_GAMES} · {W.OFFICIAL_UPCOMING(o.upcoming)}
                  </p>
                  {o.past.length === 0 ? (
                    <p className="mt-1 text-gray-500">{W.OFFICIAL_NO_PAST}</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {o.past.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className={g.played ? "text-gray-800" : "text-gray-400 line-through"}>
                            {g.when}
                            {g.matchup ? ` · ${g.matchup}` : ""}
                          </span>
                          {g.played && <OfficialNoShow gameUmpireId={g.id} label={`${W.OFFICIAL_NO_SHOW}: ${o.name}, ${g.when}`} value={g.noShow} />}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-xs text-gray-500">{W.OFFICIAL_NO_SHOW_NOTE}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CountsForSelect({
  seasonId,
  umpireId,
  name,
  value,
  teams,
}: {
  seasonId: string;
  umpireId: string;
  name: string;
  value: string | null;
  teams: TrackerTeam[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col sm:items-end">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <span>{W.OFFICIAL_COUNTS_FOR}</span>
        <select
          value={value ?? ""}
          disabled={busy}
          aria-label={`${W.OFFICIAL_COUNTS_FOR}: ${name}`}
          onChange={async (e) => {
            setBusy(true);
            const r = await rpc("set_official_counts_for", { p_season_id: seasonId, p_umpire_id: umpireId, p_team_id: e.target.value || null });
            const out = r.error ? savedOutcome(null, W.OFFICIAL_SAVE_FAILED) : savedOutcome(r.data, W.OFFICIAL_SAVE_FAILED);
            setBusy(false);
            if (!out.ok) return setError(out.text);
            setError(null);
            router.refresh();
          }}
          className="max-w-[14rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">{W.OFFICIAL_NOT_COUNTED}</option>
          {teams.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </label>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function OfficialNoShow({ gameUmpireId, label, value }: { gameUmpireId: string; label: string; value: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={value}
          disabled={busy}
          aria-label={label}
          onChange={async () => {
            setBusy(true);
            const r = await rpc("set_official_no_show", { p_game_umpire_id: gameUmpireId, p_no_show: !value });
            const out = r.error ? savedOutcome(null, W.OFFICIAL_SAVE_FAILED) : savedOutcome(r.data, W.OFFICIAL_SAVE_FAILED);
            setBusy(false);
            if (!out.ok) return setError(out.text);
            setError(null);
            router.refresh();
          }}
        />
        {W.OFFICIAL_NO_SHOW}
      </label>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
