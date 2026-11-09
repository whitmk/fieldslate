"use client";

// The official's page. Every decision and word comes from
// src/lib/officials-signup/page.ts and words.ts (verbatim). Shows only this
// official's games and the open spots; Take and Drop go through the token
// routes, and the page reloads after each so it never shows a stale state.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  claimOutcome,
  dropOutcome,
  gameWhat,
  gameWhen,
  mineAction,
  readSignupReply,
  splitOpen,
  type MineGame,
  type OpenSpot,
  type Outcome,
  type SignupPage,
} from "@/lib/officials-signup/page";
import * as W from "@/lib/officials-signup/words";

type Load = { kind: "loading" } | { kind: "unknown" } | { kind: "error" } | { kind: "ok"; page: SignupPage };
const CARD = "rounded-xl border border-gray-200 bg-white";
const BTN = "min-h-[40px] rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50";

function GameLines({ g }: { g: MineGame | OpenSpot }) {
  return (
    <>
      <div className="font-semibold text-[#0C1F3F]">{gameWhen(g)}</div>
      <div className="text-gray-700">
        <span className="font-medium">{g.role}</span>
        {gameWhat(g) && <span className="break-words"> · {gameWhat(g)}</span>}
      </div>
    </>
  );
}

export function SignupPageClient({ token }: { token: string | null }) {
  const [load, setLoad] = useState<Load>(token ? { kind: "loading" } : { kind: "unknown" });
  const [notice, setNotice] = useState<Outcome | null>(null);
  const [dropFor, setDropFor] = useState<MineGame | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/officials/signup/${token}`, { cache: "no-store" });
      const r = readSignupReply(res.ok ? await res.json() : null);
      setLoad(r.kind === "ok" ? { kind: "ok", page: r.page } : { kind: r.kind });
    } catch {
      setLoad({ kind: "error" });
    }
  }, [token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function post(path: "claim" | "drop", body: Record<string, string>): Promise<unknown> {
    try {
      const res = await fetch(`/api/officials/signup/${token}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch {
      return null;
    }
  }

  async function take(s: OpenSpot) {
    setBusy(true);
    const out = claimOutcome(await post("claim", { gameId: s.game_id, roleId: s.role_id }));
    setBusy(false);
    setNotice(out);
    await refresh();
  }

  async function drop(g: MineGame) {
    if (load.kind !== "ok") return;
    setBusy(true);
    const out = dropOutcome(await post("drop", { gameUmpireId: g.game_umpire_id }), load.page.contactEmail);
    setBusy(false);
    setDropFor(null);
    setNotice(out);
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
  if (load.kind === "unknown") return shell(<p className={`${CARD} p-4 text-sm text-gray-700`}>{W.PAGE_UNKNOWN}</p>);
  if (load.kind === "error") return shell(<p className={`${CARD} p-4 text-sm text-gray-700`}>{W.PAGE_LOAD_FAILED}</p>);

  const page = load.page;
  const { canTake, cannot } = splitOpen(page.open);
  return shell(
    <>
      <div>
        <h1 className="text-2xl font-bold text-[#0C1F3F]">{W.PAGE_TITLE}</h1>
        <p className="text-sm text-gray-600">
          {page.youth ? W.signingUpFor(page.officialName) : page.officialName}
          {page.seasonName ? ` · ${page.seasonName}` : ""}
        </p>
      </div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{W.PAGE_PRIVATE}</p>
      {notice && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${notice.ok ? "border border-green-200 bg-green-50 text-green-800" : "border border-red-100 bg-red-50 text-red-700"}`}
        >
          {notice.line}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#0C1F3F]">{W.MINE_HEADING}</h2>
        {page.mine.length === 0 && <p className={`${CARD} p-4 text-sm text-gray-700`}>{W.MINE_NONE}</p>}
        <ul className="space-y-3">
          {page.mine.map((g) => {
            const a = mineAction(g, page.contactEmail);
            return (
              <li key={g.game_umpire_id} className={`${CARD} space-y-2 p-4 text-sm`}>
                {g.self_claimed && (
                  <span className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">{W.SIGNED_UP_TAG}</span>
                )}
                <GameLines g={g} />
                {a.kind === "drop" ? (
                  <button type="button" disabled={busy} onClick={() => setDropFor(g)} className={`${BTN} border border-gray-200 text-[#0C1F3F]`}>
                    {W.DROP}
                  </button>
                ) : (
                  <p className="text-gray-600">{a.line}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#0C1F3F]">{W.OPEN_HEADING}</h2>
        {canTake.length === 0 && <p className={`${CARD} p-4 text-sm text-gray-700`}>{W.OPEN_NONE}</p>}
        <ul className="space-y-3">
          {canTake.map((s) => (
            <li key={`${s.game_id}:${s.role_id}`} className={`${CARD} space-y-2 p-4 text-sm`}>
              <GameLines g={s} />
              <button type="button" disabled={busy} onClick={() => void take(s)} className={`${BTN} bg-[#22C55E] text-white`}>
                {W.TAKE}
              </button>
            </li>
          ))}
        </ul>
        {cannot.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer py-2 font-medium text-gray-700">
              {W.OPEN_CANT_HEADING} ({cannot.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {cannot.map(({ spot, line }) => (
                <li key={`${spot.game_id}:${spot.role_id}`} className={`${CARD} space-y-1 p-3 text-gray-600`}>
                  <GameLines g={spot} />
                  <p>{line}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {dropFor && (
        <ConfirmDialog
          title={W.DROP_TITLE}
          detail={`${gameWhen(dropFor)} · ${dropFor.role}. ${W.DROP_DETAIL}`}
          confirmLabel={W.DROP_CONFIRM}
          tone="danger"
          busy={busy}
          onConfirm={() => void drop(dropFor)}
          onCancel={() => setDropFor(null)}
        />
      )}
    </>,
    page.leagueName,
  );
}
