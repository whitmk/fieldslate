"use client";

// Field requests — the plans list (step 5a; mockup
// docs/mockups/practice-planner.html, screens 1–2). Every sentence comes from
// src/lib/practice-plans/words.ts; every reply is read by list.ts. Writes go
// only through the 0117 functions — the table has no write grant.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Copy, MoreHorizontal, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { INPUT_LIMITS, PLAN_INPUT_VERSION } from "@/lib/practice-plans/plan-input";
import type { PlanInput } from "@/lib/practice-plans/load";
import { newPlanInput, prefillAdjustmentQuery, type Prefill } from "@/lib/practice-plans/prefill";
import { saveOutcome, writeOutcome } from "@/lib/practice-plans/list";
import type { SpreadMode } from "@/lib/practice-planner/types";
import {
  CANCEL_BUTTON,
  COPY_BUTTON,
  COPY_PLAN_BUTTON,
  COPY_PLAN_BUTTON_SHORT,
  COPY_PLAN_NOTE,
  COPY_PLAN_TITLE,
  CREATE_BUTTON,
  DELETE_BUTTON,
  MENU_COPY,
  MENU_DELETE,
  MENU_OPEN,
  MENU_RENAME,
  MODE_NAMES,
  NEW_PLAN_BUTTON,
  NEW_PLAN_NAME_LABEL,
  NEW_PLAN_TITLE,
  PLAN_CANT_OPEN_TAG,
  PLAN_NAME_HELP,
  PLAN_NAME_LABEL,
  PLANS_EMPTY_BODY,
  PLANS_EMPTY_TITLE,
  PLANS_INTRO,
  PLANS_TITLE,
  RENAME_BUTTON,
  RENAME_PLAN_TITLE,
  copyChoiceDetail,
  copyName,
  deletePlanConfirm,
  newPlanSource,
  staleSaveLine,
} from "@/lib/practice-plans/words";

export type PlanListItem = {
  id: string;
  name: string;
  /** Pass back to save_practice_plan exactly as read. */
  updatedAt: string;
  /** Already formatted on the server in the league's timezone. */
  edited: string;
  readable: boolean;
  input: PlanInput | null;
  mode: SpreadMode | null;
  dates: string | null;
  summary: string | null;
};

const PRIMARY =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-[#0C1F3F] transition-colors hover:border-gray-300 disabled:opacity-60";
const INPUT =
  "h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#16a34a] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/30";

type Dialog =
  | { kind: "new" }
  | { kind: "copy"; sourceId: string | null }
  | { kind: "rename"; item: PlanListItem }
  | { kind: "delete"; item: PlanListItem }
  | null;

function staleWhen(iso: string): string {
  // Event-time text (after a save comes back), never a render-path clock read.
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function PlansListClient({ orgId, plans, prefill }: { orgId: string; plans: PlanListItem[]; prefill: Prefill }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setDialog(null);
    setError(null);
  };

  async function create(name: string) {
    setBusy(true);
    setError(null);
    const { input, adjustments } = newPlanInput(prefill);
    const { data, error: rpcError } = await createClient().rpc(
      // @ts-expect-error — database.ts keeps an empty Functions map on purpose.
      "create_practice_plan",
      { p_org_id: orgId, p_name: name, p_input: input, p_input_version: PLAN_INPUT_VERSION, p_mode: "spread" },
    );
    const out = writeOutcome(data, rpcError);
    setBusy(false);
    if (!out.ok) return setError(out.message);
    router.push(`/dashboard/field-requests/${out.id}${prefillAdjustmentQuery(prefill.season?.name ?? null, adjustments)}`);
  }

  async function copy(sourceId: string, name: string) {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createClient().rpc(
      // @ts-expect-error — database.ts keeps an empty Functions map on purpose.
      "copy_practice_plan",
      { p_plan_id: sourceId, p_name: name },
    );
    const out = writeOutcome(data, rpcError);
    setBusy(false);
    if (!out.ok) return setError(out.message);
    router.push(`/dashboard/field-requests/${out.id}`);
  }

  async function rename(item: PlanListItem, name: string) {
    if (!item.input || !item.mode) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createClient().rpc(
      // @ts-expect-error — database.ts keeps an empty Functions map on purpose.
      "save_practice_plan",
      { p_plan_id: item.id, p_expected_updated_at: item.updatedAt, p_name: name, p_input: item.input, p_input_version: PLAN_INPUT_VERSION, p_mode: item.mode },
    );
    const out = saveOutcome(data, rpcError);
    setBusy(false);
    if (out.kind === "error") return setError(out.message);
    if (out.kind === "stale") return setError(staleSaveLine(out.byName, staleWhen(out.updatedAt)));
    setDialog(null);
    router.refresh();
  }

  async function remove(item: PlanListItem) {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createClient().rpc(
      // @ts-expect-error — database.ts keeps an empty Functions map on purpose.
      "delete_practice_plan",
      { p_plan_id: item.id },
    );
    const out = writeOutcome(data, rpcError);
    setBusy(false);
    if (!out.ok) return setError(out.message);
    setDialog(null);
    router.refresh();
  }

  const menu = (item: PlanListItem) =>
    menuFor === item.id && (
      <div role="menu" className="absolute right-0 top-10 z-20 w-44 rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-lg">
        <Link role="menuitem" href={`/dashboard/field-requests/${item.id}`} className="block rounded-lg px-3 py-2 hover:bg-gray-50">
          {MENU_OPEN}
        </Link>
        <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50"
          onClick={() => { setMenuFor(null); setDialog({ kind: "copy", sourceId: item.id }); }}>
          {MENU_COPY}
        </button>
        <button role="menuitem" type="button" disabled={!item.readable} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 disabled:text-gray-400"
          onClick={() => { setMenuFor(null); setDialog({ kind: "rename", item }); }}>
          {MENU_RENAME}
        </button>
        <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2 text-left text-red-700 hover:bg-red-50"
          onClick={() => { setMenuFor(null); setDialog({ kind: "delete", item }); }}>
          {MENU_DELETE}
        </button>
      </div>
    );

  const dots = (item: PlanListItem) => (
    <div className="relative">
      <button type="button" aria-label={`Actions for ${item.name}`} aria-haspopup="menu" aria-expanded={menuFor === item.id}
        className="grid h-10 w-10 place-items-center rounded-lg text-gray-500 hover:bg-gray-100"
        onClick={() => setMenuFor(menuFor === item.id ? null : item.id)}>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {menu(item)}
    </div>
  );

  return (
    <div className="flex flex-col gap-5" onClick={(e) => { if (!(e.target as HTMLElement).closest("[aria-haspopup],[role=menu]")) setMenuFor(null); }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{PLANS_TITLE}</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{PLANS_INTRO}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {plans.length > 0 && (
            <button type="button" className={`${SECONDARY} flex-1 sm:flex-none`} onClick={() => setDialog({ kind: "copy", sourceId: null })}>
              <Copy className="h-4 w-4" />
              <span className="sm:hidden">{COPY_PLAN_BUTTON_SHORT}</span>
              <span className="hidden sm:inline">{COPY_PLAN_BUTTON}</span>
            </button>
          )}
          <button type="button" className={`${PRIMARY} flex-1 sm:flex-none`} onClick={() => setDialog({ kind: "new" })}>
            <Plus className="h-4 w-4" />
            {NEW_PLAN_BUTTON}
          </button>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-[#22C55E]/10 text-[#16a34a]">
            <ClipboardList className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-[#0C1F3F]">{PLANS_EMPTY_TITLE}</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-gray-600">{PLANS_EMPTY_BODY}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">{newPlanSource(prefill.season?.name ?? null)}</p>
        </div>
      ) : (
        <>
          {/* md and up: a table */}
          <div className="hidden overflow-visible rounded-2xl border border-gray-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr><th className="px-4 py-2.5">Plan</th><th className="px-4 py-2.5">Practices</th><th className="px-4 py-2.5">Fields to request</th><th className="px-4 py-2.5">Edited</th><th className="w-14" /></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plans.map((p) => (
                  <tr key={p.id} data-plan-row>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/field-requests/${p.id}`} className="font-semibold text-[#0C1F3F] hover:underline">{p.name}</Link>
                      <div className="text-xs text-gray-500">
                        {p.readable && p.input && p.mode
                          ? `${p.input.divisions.length} ${p.input.divisions.length === 1 ? "division" : "divisions"} · ${MODE_NAMES[p.mode]}`
                          : <span className="font-semibold text-amber-700">{PLAN_CANT_OPEN_TAG}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{p.dates ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{p.summary ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{p.edited}</td>
                    <td className="px-2 py-2">{dots(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* below md: one card per plan */}
          <div className="flex flex-col gap-2.5 md:hidden">
            {plans.map((p) => (
              <div key={p.id} data-plan-card className="flex items-start justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-3.5">
                <Link href={`/dashboard/field-requests/${p.id}`} className="min-w-0 flex-1">
                  <div className="font-semibold text-[#0C1F3F]">{p.name}</div>
                  <div className="text-xs text-gray-500">{p.dates ?? PLAN_CANT_OPEN_TAG} · edited {p.edited}</div>
                  {p.summary && <div className="mt-1 text-sm text-gray-700">{p.summary}</div>}
                </Link>
                {dots(p)}
              </div>
            ))}
          </div>
        </>
      )}

      {dialog?.kind === "new" && (
        <NameDialog title={NEW_PLAN_TITLE} sub={newPlanSource(prefill.season?.name ?? null)} label={PLAN_NAME_LABEL} help={PLAN_NAME_HELP}
          initial="" submitLabel={CREATE_BUTTON} busy={busy} error={error} onCancel={close} onSubmit={(n) => void create(n)} />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog title={RENAME_PLAN_TITLE} label={PLAN_NAME_LABEL} initial={dialog.item.name} submitLabel={RENAME_BUTTON}
          busy={busy} error={error} onCancel={close} onSubmit={(n) => void rename(dialog.item, n)} />
      )}
      {dialog?.kind === "copy" && (
        <CopyDialog plans={plans} initialId={dialog.sourceId ?? plans[0]?.id ?? null} busy={busy} error={error} onCancel={close}
          onSubmit={(id, n) => void copy(id, n)} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog title={deletePlanConfirm(dialog.item.name).title} detail={deletePlanConfirm(dialog.item.name).body}
          confirmLabel={DELETE_BUTTON} tone="danger" busy={busy} error={error} onCancel={close} onConfirm={() => void remove(dialog.item)} />
      )}
    </div>
  );
}

function Sheet({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-[#0C1F3F]">{title}</h2>
          <button type="button" aria-label={CANCEL_BUTTON} className="grid h-9 w-9 place-items-center rounded-lg text-gray-500 hover:bg-gray-100" onClick={onCancel}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Actions({ busy, submitLabel, disabled, onCancel }: { busy: boolean; submitLabel: string; disabled: boolean; onCancel: () => void }) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" className={SECONDARY} disabled={busy} onClick={onCancel}>{CANCEL_BUTTON}</button>
      <button type="submit" className={PRIMARY} disabled={busy || disabled}>{submitLabel}</button>
    </div>
  );
}

function NameDialog(props: {
  title: string; sub?: string; label: string; help?: string; initial: string; submitLabel: string;
  busy: boolean; error: string | null; onCancel: () => void; onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(props.initial);
  const trimmed = name.trim();
  const tooLong = Array.from(trimmed).length > INPUT_LIMITS.planName.maxChars;
  return (
    <Sheet title={props.title} onCancel={props.onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); if (trimmed && !tooLong) props.onSubmit(trimmed); }}>
        {props.sub && <p className="mt-1.5 text-sm text-gray-600">{props.sub}</p>}
        <label htmlFor="plan-name" className="mt-4 block text-xs font-semibold text-gray-600">{props.label}</label>
        <input id="plan-name" autoFocus className={`${INPUT} mt-1`} value={name} maxLength={INPUT_LIMITS.planName.maxChars + 10}
          onChange={(e) => setName(e.target.value)} />
        {props.help && <p className="mt-1 text-xs text-gray-500">{props.help}</p>}
        {props.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{props.error}</p>}
        <Actions busy={props.busy} submitLabel={props.submitLabel} disabled={!trimmed || tooLong} onCancel={props.onCancel} />
      </form>
    </Sheet>
  );
}

function CopyDialog({ plans, initialId, busy, error, onCancel, onSubmit }: {
  plans: PlanListItem[]; initialId: string | null; busy: boolean; error: string | null;
  onCancel: () => void; onSubmit: (id: string, name: string) => void;
}) {
  const [pick, setPick] = useState<string | null>(initialId);
  const source = plans.find((p) => p.id === pick) ?? null;
  const [name, setName] = useState(source ? copyName(source.name, INPUT_LIMITS.planName.maxChars) : "");
  const choose = (p: PlanListItem) => { setPick(p.id); setName(copyName(p.name, INPUT_LIMITS.planName.maxChars)); };
  const trimmed = name.trim();
  return (
    <Sheet title={COPY_PLAN_TITLE} onCancel={onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); if (pick && trimmed) onSubmit(pick, trimmed); }}>
        <p className="mt-1.5 text-sm text-gray-600">{COPY_PLAN_NOTE}</p>
        <div role="radiogroup" className="mt-3 flex flex-col gap-2">
          {plans.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} onClick={() => choose(p)}
              className={`flex items-start gap-3 rounded-xl border-[1.5px] px-3 py-2.5 text-left ${pick === p.id ? "border-[#16a34a] ring-2 ring-[#22C55E]/20" : "border-gray-200"}`}>
              <span className={`mt-1 h-4 w-4 flex-none rounded-full border-2 ${pick === p.id ? "border-[#16a34a] bg-[radial-gradient(#16a34a_45%,transparent_50%)]" : "border-gray-300"}`} />
              <span>
                <span className="block text-sm font-semibold text-[#0C1F3F]">{p.name}</span>
                <span className="block text-xs text-gray-500">
                  {p.readable && p.input ? copyChoiceDetail(p.dates ?? "", p.input.divisions.length, p.edited) : PLAN_CANT_OPEN_TAG}
                </span>
              </span>
            </button>
          ))}
        </div>
        <label htmlFor="copy-name" className="mt-4 block text-xs font-semibold text-gray-600">{NEW_PLAN_NAME_LABEL}</label>
        <input id="copy-name" className={`${INPUT} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <Actions busy={busy} submitLabel={COPY_BUTTON} disabled={!pick || !trimmed} onCancel={onCancel} />
      </form>
    </Sheet>
  );
}
