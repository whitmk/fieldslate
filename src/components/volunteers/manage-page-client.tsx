"use client";

// The volunteer's own page. Every decision and word comes from
// src/lib/volunteers/manage-page.ts and words.ts (verbatim). Shows only this
// volunteer's spots; Cancel and Keep it go through the token routes, and the
// page reloads its list after each so it never shows a stale state.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { emailWhen, signupUrl } from "@/lib/volunteers/email-templates";
import {
  cancelOutcome,
  claimTitle,
  claimView,
  claimWhere,
  keepOutcome,
  readManageReply,
  type MyClaim,
  type MyPage,
} from "@/lib/volunteers/manage-page";
import * as W from "@/lib/volunteers/words";

type Load = { kind: "loading" } | { kind: "unknown" } | { kind: "error" } | { kind: "ok"; page: MyPage };
const CARD = "rounded-xl border border-gray-200 bg-white";

export function ManagePageClient({ token }: { token: string | null }) {
  const [load, setLoad] = useState<Load>(token ? { kind: "loading" } : { kind: "unknown" });
  const [notice, setNotice] = useState<{ ok: boolean; line: string } | null>(null);
  const [cancelFor, setCancelFor] = useState<MyClaim | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/volunteers/manage/${token}`, { cache: "no-store" });
      const r = readManageReply(res.ok ? await res.json() : null);
      setLoad(r.kind === "ok" ? { kind: "ok", page: r.page } : { kind: r.kind });
    } catch {
      setLoad({ kind: "error" });
    }
  }, [token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(path: "cancel" | "keep", claim: MyClaim) {
    if (!token || load.kind !== "ok") return;
    setBusy(true);
    let raw: unknown = null;
    try {
      const res = await fetch(`/api/volunteers/manage/${token}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimId: claim.claim_id }),
      });
      raw = await res.json();
    } catch {
      raw = null;
    }
    setBusy(false);
    setCancelFor(null);
    const out = path === "cancel" ? cancelOutcome(raw, load.page.contactEmail) : keepOutcome(raw);
    setNotice({ ok: out.kind === "ok", line: out.line });
    await refresh();
  }

  const shell = (children: React.ReactNode, league?: string) => (
    <main className="min-h-dvh bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        {league && <p className="text-sm font-semibold text-gray-500">{league}</p>}
        {children}
      </div>
    </main>
  );
  if (load.kind === "loading") return shell(<p className="text-sm text-gray-600"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />…</p>);
  if (load.kind === "unknown") return shell(<p className={`${CARD} p-4 text-sm text-gray-700`}>{W.MY_UNKNOWN}</p>);
  if (load.kind === "error") return shell(<p className={`${CARD} p-4 text-sm text-gray-700`}>{W.MY_LOAD_FAILED}</p>);

  const page = load.page;
  return shell(
    <>
      <div>
        <h1 className="text-2xl font-bold text-[#0C1F3F]">{W.MY_TITLE}</h1>
        <p className="text-sm text-gray-600">{page.who}</p>
      </div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{W.MY_PRIVATE}</p>
      {notice && (
        <p className={`rounded-lg px-3 py-2 text-sm ${notice.ok ? "border border-green-200 bg-green-50 text-green-800" : "border border-red-100 bg-red-50 text-red-700"}`}>
          {notice.line}
        </p>
      )}
      {page.claims.length === 0 && <p className={`${CARD} p-4 text-sm text-gray-700`}>{W.MY_NONE}</p>}
      <ul className="space-y-3">
        {page.claims.map((c) => {
          const v = claimView(c, page.contactEmail);
          const btn = "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50";
          const tag = v.kind === "moved" ? W.MY_MOVED_TAG : v.kind === "rained_out" ? W.MY_RAINED_TAG : v.tag;
          return (
            <li key={c.claim_id} className={`${CARD} space-y-2 p-4 text-sm`}>
              {tag && (
                <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{tag}</span>
              )}
              <div className="font-semibold text-[#0C1F3F]">{claimTitle(c)}</div>
              {v.kind === "moved" ? (
                <>
                  <div className="text-gray-800">{v.now}</div>
                  <div className="text-gray-500 line-through">{v.was}</div>
                  <p className="text-gray-700">{W.MY_MOVED_STILL}</p>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void act("keep", c)} className={`${btn} bg-[#0C1F3F] text-white`}>
                      {W.MY_KEEP}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setCancelFor(c)} className={`${btn} border border-gray-200 text-[#0C1F3F]`}>
                      {W.MY_CANCEL}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-gray-700">{emailWhen(c.start)} · {claimWhere(c)}</div>
                  {v.kind === "rained_out" && <p className="text-gray-700">{W.MY_RAINED_HELD}</p>}
                  {v.kind === "closed" ? (
                    <p className="text-gray-600">{v.line}</p>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setCancelFor(c)} className={`${btn} border border-gray-200 text-[#0C1F3F]`}>
                      {W.MY_CANCEL}
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {page.signupToken && (
        <a href={signupUrl(page.signupToken)} rel="noreferrer" className="inline-block rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white">
          {W.MY_MORE}
        </a>
      )}
      <p className="text-sm text-gray-700">{W.MY_TOTAL(page.claims.length)}</p>
      <p className="text-xs text-gray-500">{W.MY_QUESTIONS}</p>
      {cancelFor && (
        <ConfirmDialog
          title={W.MY_CANCEL_TITLE}
          detail={`${claimTitle(cancelFor)} · ${emailWhen(cancelFor.start) ?? ""}. ${W.MY_CANCEL_DETAIL}`}
          confirmLabel={W.MY_CANCEL_CONFIRM}
          tone="danger"
          busy={busy}
          onConfirm={() => void act("cancel", cancelFor)}
          onCancel={() => setCancelFor(null)}
        />
      )}
    </>,
    page.leagueName,
  );
}
