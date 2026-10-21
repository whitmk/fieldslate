"use client";

// The public bracket page (/s/<token>/bracket/<division>) — and, with
// ?embed=1, the same page inside a league's website. Every decision and
// sentence is in src/lib/public-bracket/; the cards, rows, tree and series
// groups are the Playoffs page's own PRESENTATION pieces (bracket-pieces.tsx,
// series-card.tsx) rendered with no callbacks (no buttons, no action row) and
// no daylight. Never import bracket-view.tsx or anything admin here —
// sim:bracket-pieces and sim:public-bracket walk this file's imports.
//
// NEVER AN EMPTY BRACKET THAT LOOKS REAL: a failed first load renders
// "couldn't load" with a retry; a failed background refresh keeps the last
// bracket and says how old it is.
//
// FRESHNESS: refetch every 60 seconds while the tab is visible, and on coming
// back to the tab when the last load is older than that. The data route is
// edge-cached for 60 seconds, so a result shows within about two minutes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, Trophy } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import { findOrgTimezone } from "@/lib/calendar/timezones";
import { publicScheduleUrl } from "@/lib/public-schedule/links";
import { gameNumbering } from "@/lib/playoffs/bracket-labels";
import { playoffRoundTitle } from "@/lib/playoffs/playoff-result";
import { PUBLIC_GROUP, PUBLIC_TREE } from "@/lib/playoffs/bracket-print";
import { championshipRoundOf, sortedRounds } from "@/lib/playoffs/bracket-rounds";
import { BracketTree, ColumnView, ListGameRow, seriesListInfo } from "@/components/playoffs/bracket-pieces";
import type { PublicBracketOk, PublicBracketResponse } from "@/lib/public-bracket/types";
import {
  LOADING_TITLE,
  REFRESH_MS,
  SEEDING_PENDING,
  UNDATED_PUBLIC,
  advanceLine,
  clockLabel,
  defaultStage,
  formatLine,
  isTwoStage,
  openingMode,
  pageTitle,
  roundHeading,
  shown,
  sitOutLine,
  sitOuts,
  slotText,
  staleLine,
  stateCopy,
  toRows,
  type PublicRow,
} from "@/lib/public-bracket/view";

const NAVY = "#0C1F3F";

type Load =
  | { phase: "loading" }
  | { phase: "done"; data: PublicBracketResponse; asOf: string | null; stale: boolean };

export function PublicBracketClient({
  token,
  divisionId,
  embed,
}: {
  token: string | null;
  divisionId: string | null;
  embed: boolean;
}) {
  const [load, setLoad] = useState<Load>(
    !token ? { phase: "done", data: { status: "unknown" }, asOf: null, stale: false }
      : !divisionId ? { phase: "done", data: { status: "unavailable" }, asOf: null, stale: false }
        : { phase: "loading" },
  );
  const lastLoad = useRef(0);

  const fetchData = useCallback(
    async (background: boolean) => {
      if (!token || !divisionId) return;
      if (!background) setLoad({ phase: "loading" });
      let data: PublicBracketResponse = { status: "error" };
      try {
        const res = await fetch(`/s/${token}/bracket/${divisionId}/data`);
        const body = (await res.json().catch(() => null)) as PublicBracketResponse | null;
        if (res.ok && body && typeof body.status === "string") data = body;
      } catch {
        // stays "error"
      }
      lastLoad.current = Date.now();
      setLoad((prev) => {
        // A failed BACKGROUND refresh keeps what the page showed, marked stale.
        if (data.status === "error" && background && prev.phase === "done" && prev.data.status === "ok") {
          return { ...prev, stale: true };
        }
        return { phase: "done", data, asOf: data.status === "ok" ? clockLabel(new Date()) : null, stale: false };
      });
    },
    [token, divisionId],
  );

  useEffect(() => {
    void fetchData(false);
    const tick = () => {
      if (document.visibilityState === "visible") void fetchData(true);
    };
    const id = window.setInterval(tick, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= REFRESH_MS) void fetchData(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchData]);

  return (
    <div className={`min-h-screen ${embed ? "bg-white" : "bg-gray-100"}`}>
      <div className={embed ? "" : "mx-auto max-w-6xl px-4 py-6 sm:py-8"}>
        {load.phase === "loading" ? (
          <StateCard title={LOADING_TITLE} body="" embed={embed} />
        ) : load.data.status === "ok" ? (
          <PublicBracketView
            data={load.data}
            token={token!}
            embed={embed}
            staleNote={load.stale && load.asOf ? staleLine(load.asOf) : null}
          />
        ) : (
          (() => {
            const c = stateCopy(load.data);
            return (
              <StateCard
                title={c.title}
                body={c.body}
                embed={embed}
                action={c.retry ? { label: "Try again", onClick: () => void fetchData(false) } : undefined}
                link={c.allGames && token ? { label: "See all games", href: publicScheduleUrl(token) } : undefined}
              />
            );
          })()
        )}
      </div>
    </div>
  );
}

/** The loaded bracket. Exported so a fixture page can render it without a
 *  database (the verification route used during development). */
export function PublicBracketView({
  data,
  token,
  embed,
  staleNote,
  initialMode,
}: {
  data: PublicBracketOk;
  token: string;
  embed: boolean;
  staleNote: string | null;
  initialMode?: "bracket" | "list";
}) {
  const twoStage = isTwoStage(data);
  const [stage, setStage] = useState<1 | 2>(() => defaultStage(data));
  // The opening view depends on the viewport, which is read AFTER mount —
  // never during render (a render-path window read is a hydration mismatch).
  // Until then the body is not drawn. `initialMode` is for fixture renders.
  const [mode, setMode] = useState<"bracket" | "list" | null>(initialMode ?? null);
  useEffect(() => {
    if (initialMode) return;
    setMode(openingMode(window.innerWidth));
  }, [initialMode]);

  const bracket = (twoStage ? data.brackets.find((b) => b.stage === stage) : data.brackets[0]) ?? data.brackets[0];
  const rows = useMemo(() => (bracket ? toRows(bracket) : []), [bracket]);
  const orgName = data.org.name?.trim() || "League";
  const tzLabel = (findOrgTimezone(data.org.timezone)?.label ?? "local").split(" (")[0];
  const scheduleHref = publicScheduleUrl(token) + (embed ? "?embed=1" : "");

  if (!bracket) {
    return <StateCard title={`No bracket for ${data.division.name} yet`} body="" embed={embed} />;
  }

  const format = bracket.format;
  const isStage1 = twoStage && bracket.stage === 1;
  const isStage2 = twoStage && bracket.stage === 2;
  const roundRobin = format === "round_robin";
  // Stage 1 of a pair reads as rounds of games (the mockup), in both views.
  const showList = mode === "list" || isStage1;
  const s2 = data.brackets.find((b) => b.stage === 2);
  const seeded = !!s2 && s2.games.some((g) => g.home_team || g.away_team);

  const numbering = gameNumbering(rows);
  const numberOf = (g: PublicRow) => numbering(g.game_number);
  const names = new Map<string, string>();
  for (const g of rows) {
    if (g.home_team_id && g.home_team_name) names.set(g.home_team_id, g.home_team_name);
    if (g.away_team_id && g.away_team_name) names.set(g.away_team_id, g.away_team_name);
  }
  const teamName = (id: string) => names.get(id) ?? "TBD";
  const labelOf = (g: PublicRow, side: "home" | "away") => slotText(g, side, rows, format, isStage2);
  const rounds = sortedRounds(rows);
  const championshipRound = roundRobin ? null : championshipRoundOf(rounds, rows);
  const outs = roundRobin ? sitOuts(rows) : null;

  return (
    <div className={`overflow-hidden bg-white ${embed ? "" : "rounded-xl border border-gray-200 shadow-sm"}`}>
      {/* Header */}
      <div className={`border-b border-gray-200 ${embed ? "px-3 py-3" : "px-5 py-4 sm:px-6"}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{orgName}</p>
        <h1 className="mt-0.5 text-lg font-extrabold sm:text-xl" style={{ color: NAVY }}>{pageTitle(data.division.name)}</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {data.season.name} · {formatLine(data)} ·{" "}
          <a href={scheduleHref} target={embed ? "_blank" : undefined} rel={embed ? "noopener" : undefined} className="font-semibold text-[#16a34a] hover:underline">
            See all games →
          </a>
        </p>
      </div>

      {/* Bar: stage tabs (two-stage), Bracket / List */}
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 ${embed ? "px-3 py-2" : "px-5 py-2.5 sm:px-6"}`}>
        <div className="flex flex-wrap items-center gap-2">
          {twoStage && (
            <Segmented
              value={String(stage)}
              onChange={(v) => setStage(v === "2" ? 2 : 1)}
              options={[
                { value: "1", label: "Stage 1 · Round robin" },
                { value: "2", label: "Stage 2 · Bracket" },
              ]}
            />
          )}
          {!isStage1 && mode && (
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as "bracket" | "list")}
              options={[
                { value: "bracket", label: "Bracket", icon: <Trophy className="h-3 w-3" /> },
                { value: "list", label: "List", icon: <List className="h-3 w-3" /> },
              ]}
            />
          )}
        </div>
        <span className="text-xs text-gray-500">
          {isStage1 && s2 ? advanceLine(s2.advance_count) : "Updates on its own every minute"}
        </span>
      </div>

      {staleNote && (
        <p className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:mx-6">{staleNote}</p>
      )}

      <div className={`bg-gray-50 ${embed ? "p-3" : "p-4 sm:p-6"}`}>
        {isStage2 && !seeded && <p className="mb-3 text-sm text-gray-500">{SEEDING_PENDING}</p>}

        {mode === null && !isStage1 ? null : showList ? (
          <div className="flex flex-col gap-4">
            {rounds.map(([round, games]) => {
              const out = outs ? sitOutLine(outs.get(round) ?? []) : null;
              return (
                <section key={round}>
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{roundHeading(round, rows)}</h2>
                  <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                    {games.filter(shown).map((g) => (
                      <ListGameRow
                        key={g.id}
                        game={g}
                        isChampionship={g.round === championshipRound}
                        labelOf={labelOf}
                        numberOf={numberOf}
                        series={seriesListInfo(g, rows, teamName)}
                        roundName={playoffRoundTitle(g.round, rows)}
                        undatedText={UNDATED_PUBLIC}
                      />
                    ))}
                    {out && <p className="px-4 py-2 text-xs text-gray-500">{out}</p>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {format === "single_elimination" ? (
              <BracketTree
                games={rows}
                championshipRound={championshipRound}
                labelOf={labelOf}
                numberOf={numberOf}
                teamName={teamName}
                tree={PUBLIC_TREE}
                group={PUBLIC_GROUP}
                undatedText={UNDATED_PUBLIC}
                hideNotNeeded
              />
            ) : (
              <ColumnView
                rounds={rounds}
                championshipRound={championshipRound}
                labelOf={labelOf}
                numberOf={numberOf}
                cardH={PUBLIC_TREE.cardH}
                undatedText={UNDATED_PUBLIC}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white text-xs text-gray-500 ${embed ? "px-3 py-2" : "px-5 py-3 sm:px-6"}`}>
        <span>Times are {tzLabel} time</span>
        <a href={SITE_URL} target="_blank" rel="noopener" className="hover:underline">
          Bracket by <b style={{ color: NAVY }}>FieldSlate</b>
        </a>
      </div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value ? "bg-[#0C1F3F] text-white" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StateCard({
  title,
  body,
  action,
  link,
  embed,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  link?: { label: string; href: string };
  embed: boolean;
}) {
  return (
    <div className={`bg-white px-6 py-10 text-center ${embed ? "" : "rounded-xl border border-gray-200"}`}>
      <h1 className="text-base font-semibold" style={{ color: NAVY }}>{title}</h1>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{body}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {action.label}
        </button>
      )}
      {link && (
        <a
          href={link.href + (embed ? "?embed=1" : "")}
          className="mt-4 inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {link.label}
        </a>
      )}
    </div>
  );
}
