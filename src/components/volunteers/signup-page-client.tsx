"use client";

// The public volunteer sign-up page. Every decision and word comes from
// src/lib/volunteers/signup-page.ts and words.ts (verbatim). The page never
// sees a name or an email but the one being typed; a filled spot reads
// "Taken". Turnstile guards the claim; its token is single-use, so the
// widget resets after every attempt.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  claimOutcome,
  fmtDay,
  formProblem,
  groupSpots,
  readPageReply,
  spotAction,
  spotDetail,
  spotKey,
  spotTag,
  spotTitle,
  type Chips,
  type PageData,
  type PageSpot,
} from "@/lib/volunteers/signup-page";
import * as W from "@/lib/volunteers/words";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "unknown" } | { kind: "plan" } | { kind: "ok"; data: PageData };

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback"?: () => void }) => string;
      reset: (id?: string) => void;
    };
  }
}

const CARD = "rounded-xl border border-gray-200 bg-white";

export function SignupPageClient({ token, siteKey }: { token: string | null; siteKey: string | null }) {
  const [load, setLoad] = useState<Load>(token ? { kind: "loading" } : { kind: "unknown" });
  const [season, setSeason] = useState<string | null>(null);
  const [chips, setChips] = useState<Chips>({ roleId: null, divisionId: null });
  const [picked, setPicked] = useState<PageSpot | null>(null);
  const [done, setDone] = useState<{ spot: PageSpot; email: string } | null>(null);

  const fetchPage = useCallback(
    async (seasonId: string | null) => {
      if (!token) return;
      setLoad({ kind: "loading" });
      try {
        const res = await fetch(`/api/volunteers/signup/${token}${seasonId ? `?season=${seasonId}` : ""}`, { cache: "no-store" });
        const reply = readPageReply(res.ok ? await res.json() : null);
        setLoad(reply.kind === "ok" ? { kind: "ok", data: reply.data } : { kind: reply.kind });
        if (reply.kind === "ok") setSeason(reply.data.seasonId);
      } catch {
        setLoad({ kind: "error" });
      }
    },
    [token],
  );
  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  const shell = (children: React.ReactNode, league?: string) => (
    <main className="min-h-dvh bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        {league && <p className="text-sm font-semibold text-gray-500">{league}</p>}
        {children}
        <p className="pt-4 text-center text-xs text-gray-500">{W.PUB_FOOTER}</p>
      </div>
    </main>
  );

  if (load.kind === "loading") return shell(<p className="text-sm text-gray-600"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />…</p>);
  if (load.kind === "unknown" || load.kind === "plan") return shell(<p className={`${CARD} p-4 text-sm text-gray-700`}>{W.PUB_UNKNOWN}</p>);
  if (load.kind === "error") return shell(<p className={`${CARD} p-4 text-sm text-gray-700`}>{W.PUB_LOAD_FAILED}</p>);

  const data = load.data;
  const seasonName = data.seasons.find((s) => s.id === data.seasonId)?.name ?? "";

  if (done) {
    return shell(
      <div className={`${CARD} space-y-3 p-5`}>
        <h1 className="text-xl font-bold text-[#0C1F3F]">{W.PUB_DONE_TITLE}</h1>
        <SpotSummary spot={done.spot} data={data} />
        <p className="text-sm text-gray-700">{W.PUB_DONE_EMAILED(done.email)}</p>
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setPicked(null);
            void fetchPage(season);
          }}
          className="rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white"
        >
          {W.PUB_ANOTHER}
        </button>
      </div>,
      data.leagueName,
    );
  }

  if (picked) {
    return shell(
      <SignupForm
        token={token!}
        siteKey={siteKey}
        spot={picked}
        data={data}
        onBack={() => setPicked(null)}
        onDone={(email) => setDone({ spot: picked, email })}
        onGone={() => {
          setPicked(null);
          void fetchPage(season);
        }}
      />,
      data.leagueName,
    );
  }

  const groups = groupSpots(data.spots, chips);
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${active ? "border-[#0C1F3F] bg-[#0C1F3F] text-white" : "border-gray-200 bg-white text-gray-700"}`;

  return shell(
    <>
      <div>
        <h1 className="text-2xl font-bold text-[#0C1F3F]">{W.PUB_TITLE}</h1>
        <p className="text-sm text-gray-600">{W.PUB_SUBTITLE(seasonName)}</p>
      </div>
      {data.seasons.length > 1 && (
        <label className="block text-sm">
          <span className="font-semibold text-[#0C1F3F]">{W.PUB_SEASON}</span>
          <select
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2"
            value={data.seasonId ?? ""}
            onChange={(e) => {
              setChips({ roleId: null, divisionId: null });
              void fetchPage(e.target.value);
            }}
          >
            {data.seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      )}
      {data.roles.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(chips.roleId === null)} onClick={() => setChips({ ...chips, roleId: null })}>{W.PUB_ALL}</button>
          {data.roles.map((r) => (
            <button key={r.id} type="button" className={chip(chips.roleId === r.id)} onClick={() => setChips({ ...chips, roleId: r.id })}>{r.name}</button>
          ))}
        </div>
      )}
      {data.divisions.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(chips.divisionId === null)} onClick={() => setChips({ ...chips, divisionId: null })}>{W.PUB_ALL}</button>
          {data.divisions.map((d) => (
            <button key={d.id} type="button" className={chip(chips.divisionId === d.id)} onClick={() => setChips({ ...chips, divisionId: d.id })}>{d.name}</button>
          ))}
        </div>
      )}
      {data.spots.length === 0 && <p className={`${CARD} p-4 text-sm text-gray-700`}>{W.PUB_NO_SPOTS}</p>}
      {data.spots.length > 0 && groups.length === 0 && <p className={`${CARD} p-4 text-sm text-gray-700`}>{W.PUB_NO_MATCH}</p>}
      {groups.map((g) => (
        <section key={g.date}>
          <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-gray-500">{fmtDay(g.date)}</h2>
          <ul className="space-y-2">
            {g.spots.map((s) => {
              const action = spotAction(s);
              const tag = spotTag(s);
              return (
                <li key={spotKey(s)} className={`${CARD} flex items-center justify-between gap-3 p-4`}>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#0C1F3F]">{spotTitle(s, data.roles)}</div>
                    <div className="text-sm text-gray-600">{spotDetail(s)}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {s.division_name && <span className="text-gray-500">{s.division_name}</span>}
                      {action.kind === "sign_up" && <span className="text-green-700">{action.openLine}</span>}
                      {tag && <span className="rounded-full bg-amber-50 px-2 text-amber-800">{tag}</span>}
                    </div>
                  </div>
                  {action.kind === "sign_up" ? (
                    <button type="button" onClick={() => setPicked(s)} className="flex-shrink-0 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white">
                      {W.PUB_SIGN_UP}
                    </button>
                  ) : action.kind === "taken" ? (
                    <span className="flex-shrink-0 text-sm text-gray-500">{W.PUB_TAKEN}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>,
    data.leagueName,
  );
}

function SpotSummary({ spot, data }: { spot: PageSpot; data: PageData }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
      <div className="font-semibold text-[#0C1F3F]">{spotTitle(spot, data.roles)}</div>
      <div className="text-gray-600">{fmtDay(spot.start)} · {spotDetail(spot)}</div>
    </div>
  );
}

function SignupForm({
  token,
  siteKey,
  spot,
  data,
  onBack,
  onDone,
  onGone,
}: {
  token: string;
  siteKey: string | null;
  spot: PageSpot;
  data: PageData;
  onBack: () => void;
  onDone: (email: string) => void;
  onGone: () => void;
}) {
  const [divisionId, setDivisionId] = useState(data.divisions.length === 1 ? data.divisions[0].id : "");
  const [teamId, setTeamId] = useState("");
  const [firstInitial, setFirstInitial] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [adult, setAdult] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !widgetRef.current) return;
    const mount = () => {
      if (window.turnstile && widgetRef.current && widgetId.current === null) {
        widgetId.current = window.turnstile.render(widgetRef.current, {
          sitekey: siteKey,
          callback: (t) => setCaptcha(t),
          "expired-callback": () => setCaptcha(null),
        });
      }
    };
    if (window.turnstile) {
      mount();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = mount;
    document.head.appendChild(s);
  }, [siteKey]);

  const teams = data.divisions.find((d) => d.id === divisionId)?.teams ?? [];
  const input = { divisionId, teamId, firstInitial, lastName, email, adult };
  const problem = formProblem(input);

  async function submit(confirmOverlap: boolean) {
    if (problem) {
      setError(problem);
      return;
    }
    if (!captcha) {
      setError(W.PUB_CAPTCHA);
      return;
    }
    setBusy(true);
    setError(null);
    let raw: unknown = null;
    try {
      const res = await fetch(`/api/volunteers/signup/${token}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId: spot.kind === "shift" ? null : spot.game_id,
          blockId: spot.kind === "shift" ? spot.block_id : null,
          roleId: spot.role_id,
          forTeamId: spot.for_team_id,
          divisionId,
          teamId,
          firstInitial: firstInitial.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          adult,
          confirmOverlap,
          turnstileToken: captcha,
        }),
      });
      raw = res.status === 503 ? { status: "unavailable" } : await res.json();
    } catch {
      raw = null;
    }
    setBusy(false);
    setCaptcha(null);
    if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current);
    const out = claimOutcome(raw);
    if (out.kind === "done") return onDone(email.trim());
    if (out.kind === "overlap") return setOverlap(true);
    setOverlap(false);
    setError((raw as { status?: string } | null)?.status === "unavailable" ? W.PUB_UNAVAILABLE : out.line);
    if (out.reload && out.line === W.PUB_SPOT_GONE) setTimeout(onGone, 2500);
  }

  const field = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2";
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-[#0C1F3F]">{W.PUB_BACK}</button>
      <div className={`${CARD} space-y-4 p-5 text-sm`}>
        <div>
          <p className="text-gray-500">{W.PUB_YOURE_SIGNING_UP}</p>
          <SpotSummary spot={spot} data={data} />
        </div>
        <label className="block">
          <span className="font-semibold text-[#0C1F3F]">{W.PUB_DIVISION}</span>
          <select className={field} value={divisionId} onChange={(e) => { setDivisionId(e.target.value); setTeamId(""); }}>
            <option value="">{W.PUB_CHOOSE_DIVISION}</option>
            {data.divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-semibold text-[#0C1F3F]">{W.PUB_TEAM}</span>
          <select className={field} value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!divisionId}>
            <option value="">{W.PUB_CHOOSE_TEAM}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <label className="w-28">
            <span className="font-semibold text-[#0C1F3F]">{W.PUB_FIRST_INITIAL}</span>
            <input className={field} maxLength={1} autoComplete="given-name" value={firstInitial} onChange={(e) => setFirstInitial(e.target.value)} />
          </label>
          <label className="flex-1">
            <span className="font-semibold text-[#0C1F3F]">{W.PUB_LAST_NAME}</span>
            <input className={field} maxLength={60} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="font-semibold text-[#0C1F3F]">{W.PUB_EMAIL}</span>
          <input className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="mt-1 block text-gray-500">{W.PUB_EMAIL_NOTE}</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>{W.PUB_ADULT}</span>
        </label>
        <div ref={widgetRef} />
        {overlap && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <p className="font-semibold">{W.PUB_OVERLAP_TITLE}</p>
            <p>{W.PUB_OVERLAP_DETAIL}</p>
          </div>
        )}
        {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <button
          type="button"
          onClick={() => void submit(overlap)}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {overlap ? W.PUB_OVERLAP_YES : W.PUB_CONFIRM}
        </button>
        <p className="text-xs text-gray-500">{W.PUB_PRIVACY}</p>
      </div>
    </div>
  );
}
