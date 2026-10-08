"use client";

// The public league schedule page (/s/<token>) — and, with ?embed=1, the same
// page inside a league's website. Every decision (rows, Home/Away, filters,
// the default season, card lines, labels) is in src/lib/public-schedule/; this
// file only lays them out.
//
// NEVER AN EMPTY SCHEDULE THAT LOOKS REAL: a failed read renders "couldn't
// load" with a retry; a turned-off or downgraded league renders "turned off";
// an empty filter result says so in words.
//
// COLOR IS NEVER THE ONLY SIGNAL: Home is a solid green tag, Away an outlined
// blue one, a rained-out game is struck through with its own tag; the month
// grid prefixes H / A / ✕.
//
// NO CLOCK: "today" comes from the data (the org's date, computed by the
// database), so nothing here depends on the viewer's machine.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import { findOrgTimezone } from "@/lib/calendar/timezones";
import { SITE_TAG, type Site } from "@/lib/public-schedule/classify";
import { publicScheduleFeedUrls, publicScheduleUrl } from "@/lib/public-schedule/links";
import type { PublicScheduleOk, PublicScheduleResponse } from "@/lib/public-schedule/types";
import {
  buildRows,
  cardLines,
  defaultSeasonId,
  filterRows,
  filterSummary,
  fmtTime,
  groupByDate,
  initialMonth,
  longDayLabel,
  mapsUrl,
  monthGrid,
  monthLabel,
  shiftMonth,
  shortDayLabel,
  type ScheduleRow,
} from "@/lib/public-schedule/view";

const NAVY = "#0C1F3F";

type Load = { phase: "loading" } | { phase: "done"; data: PublicScheduleResponse };

export function PublicScheduleClient({ token, embed }: { token: string | null; embed: boolean }) {
  const [load, setLoad] = useState<Load>(token ? { phase: "loading" } : { phase: "done", data: { status: "unknown" } });

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoad({ phase: "loading" });
    try {
      const res = await fetch(`/s/${token}/data`);
      const body = (await res.json().catch(() => null)) as PublicScheduleResponse | null;
      if (!res.ok || !body || typeof body.status !== "string") {
        setLoad({ phase: "done", data: { status: "error" } });
        return;
      }
      setLoad({ phase: "done", data: body });
    } catch {
      setLoad({ phase: "done", data: { status: "error" } });
    }
  }, [token]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className={`min-h-screen ${embed ? "bg-white" : "bg-gray-100 print:bg-white"}`}>
      <div className={embed ? "" : "mx-auto max-w-5xl px-4 py-6 sm:py-8 print:p-0"}>
        {load.phase === "loading" ? (
          <StateCard title="Loading the schedule…" body="" embed={embed} />
        ) : load.data.status === "ok" ? (
          <PublicScheduleView data={load.data} token={token!} embed={embed} />
        ) : load.data.status === "error" ? (
          <StateCard
            title="We couldn't load the schedule right now"
            body="This is a problem on our side, not a change to your games. Try again in a few minutes."
            action={{ label: "Try again", onClick: () => void fetchData() }}
            embed={embed}
          />
        ) : load.data.status === "unknown" ? (
          <StateCard
            title="This schedule link isn't recognized"
            body="Check the link with your league — it may have been replaced."
            embed={embed}
          />
        ) : (
          <StateCard
            title="This schedule isn't available"
            body="This league has turned off its public schedule. Check the league's website or ask your coach."
            embed={embed}
          />
        )}
      </div>
    </div>
  );
}

function StateCard({
  title,
  body,
  action,
  embed,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
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
    </div>
  );
}

/** The loaded schedule. Exported so a fixture page can render it without a
 *  database (the verification route used during development). */
export function PublicScheduleView({ data, token, embed }: { data: PublicScheduleOk; token: string; embed: boolean }) {
  const [seasonId, setSeasonId] = useState<string | null>(() => defaultSeasonId(data.seasons, data.today));
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [range, setRange] = useState<"upcoming" | "all">("upcoming");
  const [view, setView] = useState<"list" | "month">("list");

  const season = data.seasons.find((s) => s.id === seasonId) ?? null;
  const allRows = useMemo(() => (season ? buildRows(season) : []), [season]);
  const [month, setMonth] = useState(() => initialMonth(allRows, data.today));

  const orgName = data.org.name?.trim() || "League";
  const tzLabel = (findOrgTimezone(data.org.timezone)?.label ?? "local").split(" (")[0];
  const feed = publicScheduleFeedUrls(token);

  if (!season) {
    return (
      <StateCard
        title="No schedule is published right now"
        body={`${orgName} hasn't published a current season yet. Check back soon.`}
        embed={embed}
      />
    );
  }

  const teams = season.teams.filter((t) => divisionId === null || t.division_id === divisionId);
  const divisionName = season.divisions.find((d) => d.id === divisionId)?.name ?? null;
  const teamName = season.teams.find((t) => t.id === teamId)?.name ?? null;
  const filtered = filterRows(allRows, { divisionId, teamId, range: "all", today: data.today });
  const listRows = range === "all" ? filtered : filterRows(filtered, { divisionId: null, teamId: null, range, today: data.today });
  const groups = groupByDate(listRows);
  const summary = filterSummary(divisionName, teamName);

  function changeSeason(id: string) {
    setSeasonId(id);
    setDivisionId(null);
    setTeamId(null);
    const s = data.seasons.find((x) => x.id === id);
    setMonth(initialMonth(s ? buildRows(s) : [], data.today));
  }

  return (
    <div className={`overflow-hidden bg-white ${embed ? "" : "rounded-xl border border-gray-200 shadow-sm print:border-0 print:shadow-none"}`}>
      {/* Header — the full page only. */}
      {!embed && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-white sm:px-6 print:text-black" style={{ backgroundColor: NAVY }}>
          <div className="min-w-0">
            <h1 className="text-lg font-bold sm:text-xl">{orgName} — Games</h1>
            <p className="mt-0.5 text-sm opacity-80">
              {season.name} · Times are {tzLabel} time
            </p>
          </div>
          <a
            href={feed.webcal}
            className="hidden items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20 sm:inline-flex print:hidden"
          >
            <CalendarPlus className="h-4 w-4" /> Add to calendar
          </a>
        </div>
      )}
      {embed && <p className="px-3 pt-3 text-sm font-bold" style={{ color: NAVY }}>{season.name} games</p>}

      {/* What a printed page shows instead of the controls. */}
      <p className="hidden px-6 py-2 text-sm text-gray-700 print:block">
        {season.name} · {summary} · {range === "upcoming" ? `Upcoming games from ${shortDayLabel(data.today)}` : "Whole season"}
      </p>

      {/* Controls */}
      <div className={`flex flex-wrap items-center gap-2 border-b border-gray-200 print:hidden ${embed ? "px-3 py-2" : "px-5 py-3 sm:px-6"}`}>
        {data.seasons.length > 1 && (
          <Select
            label="Season"
            value={season.id}
            onChange={(v) => changeSeason(v)}
            options={data.seasons.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        <div className={`grid w-full grid-cols-2 gap-2 ${embed ? "" : "sm:flex sm:w-auto"}`}>
          <Select
            label="Division"
            value={divisionId ?? ""}
            onChange={(v) => {
              setDivisionId(v || null);
              setTeamId(null);
            }}
            options={[{ value: "", label: "All divisions" }, ...season.divisions.map((d) => ({ value: d.id, label: d.name }))]}
          />
          <Select
            label="Team"
            value={teamId ?? ""}
            onChange={(v) => setTeamId(v || null)}
            options={[{ value: "", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
          />
        </div>
        {!embed && (
          <>
            <Segmented
              className="hidden md:inline-flex"
              value={view}
              onChange={(v) => setView(v as "list" | "month")}
              options={[{ value: "list", label: "List" }, { value: "month", label: "Month" }]}
            />
            <Segmented
              value={range}
              onChange={(v) => setRange(v as "upcoming" | "all")}
              options={[{ value: "upcoming", label: "Upcoming" }, { value: "all", label: "Whole season" }]}
            />
            <span className="hidden flex-1 md:block" />
            <button
              type="button"
              onClick={() => window.print()}
              className="hidden items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 md:inline-flex"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
          </>
        )}
      </div>

      <Legend orgName={orgName} compact={embed} />

      {/* Month view — wide screens only; the list stays below md. */}
      {view === "month" && !embed && (
        <div className="hidden md:block print:hidden">
          <MonthView rows={filtered} month={month} setMonth={setMonth} />
        </div>
      )}

      <div className={view === "month" && !embed ? "md:hidden print:block" : ""}>
        {groups.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500">
            {range === "upcoming" && filtered.length > 0 ? (
              <>
                No upcoming games{divisionName || teamName ? ` for ${summary.replace(/ only$/, "")}` : ""}.{" "}
                <button type="button" className="font-medium underline" style={{ color: NAVY }} onClick={() => setRange("all")}>
                  Show the whole season
                </button>
              </>
            ) : divisionName || teamName ? (
              `No games for ${summary.replace(/ only$/, "")}.`
            ) : (
              "No games are published for this season yet."
            )}
          </div>
        ) : (
          <div className={embed ? "px-3 pb-2" : "px-4 pb-3 sm:px-6"}>
            {groups.map((g) => (
              <section key={g.date}>
                <h2 className="mb-2 mt-4 flex items-baseline gap-2 text-sm font-semibold" style={{ color: NAVY }}>
                  <span className={embed ? "" : "hidden sm:inline"}>{embed ? shortDayLabel(g.date) : longDayLabel(g.date)}</span>
                  {!embed && <span className="sm:hidden">{shortDayLabel(g.date)}</span>}
                  {!embed && (
                    <span className="text-xs font-normal text-gray-500">
                      {g.rows.length} {g.rows.length === 1 ? "game" : "games"}
                    </span>
                  )}
                </h2>
                {g.rows.map((r) => (
                  <div key={r.key}>
                    {!embed && <DesktopRow row={r} />}
                    <Card row={r} embed={embed} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>

      {!embed && (
        <div className="px-4 pb-4 md:hidden print:hidden">
          <a
            href={feed.webcal}
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: NAVY }}
          >
            <CalendarPlus className="h-4 w-4" /> Add all games to my calendar
          </a>
        </div>
      )}

      {/* Footer */}
      <div className={`flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 ${embed ? "px-3 py-2" : "px-5 py-3 sm:px-6"}`}>
        {embed ? (
          <a href={publicScheduleUrl(token)} target="_blank" rel="noopener" className="font-medium underline" style={{ color: NAVY }}>
            Open full schedule ↗
          </a>
        ) : (
          <span>
            Showing {listRows.length} {listRows.length === 1 ? "game" : "games"}
            {season.unpublished.length > 0 && ` · ${joinNames(season.unpublished)} ${season.unpublished.length === 1 ? "isn't" : "aren't"} published yet`}
          </span>
        )}
        <a href={SITE_URL} target="_blank" rel="noopener" className="hover:underline">
          Schedule by <b style={{ color: NAVY }}>FieldSlate</b>
        </a>
      </div>
    </div>
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-800 sm:w-auto"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Segmented({
  value,
  onChange,
  options,
  className = "inline-flex",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={`${className} overflow-hidden rounded-lg border border-gray-300`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-3 py-1.5 text-sm ${value === o.value ? "text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          style={value === o.value ? { backgroundColor: NAVY } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SiteTag({ site }: { site: Site }) {
  const cls =
    site === "home"
      ? "border-[#15803d] bg-[#15803d] text-white"
      : site === "away"
        ? "border-[#1d4ed8] bg-white text-[#1d4ed8]"
        : "border-dashed border-gray-400 bg-white text-gray-500";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border-[1.5px] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${cls}`}>
      {SITE_TAG[site]}
    </span>
  );
}

function PlainTag({ children, tone = "grey" }: { children: React.ReactNode; tone?: "grey" | "navy" | "struck" }) {
  const cls =
    tone === "navy"
      ? "border-[#0C1F3F] bg-[#0C1F3F] text-white"
      : tone === "struck"
        ? "border-gray-300 bg-gray-100 text-gray-600 uppercase tracking-wide font-bold text-[10.5px]"
        : "border-gray-300 bg-white text-[#0C1F3F]";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function Tags({ row }: { row: ScheduleRow }) {
  return (
    <>
      {row.playoffLabel && <PlainTag tone="navy">{row.playoffLabel}</PlainTag>}
      {row.interleague && !row.struck && <PlainTag>Interleague</PlainTag>}
      {row.statusLabel && row.statusIsNote && <PlainTag>{row.statusLabel}</PlainTag>}
      {row.struck ? <PlainTag tone="struck">{row.statusLabel}</PlainTag> : <SiteTag site={row.site} />}
    </>
  );
}

const ROW_TONE: Record<Site, string> = {
  home: "border-l-[#15803d] bg-[#f0fdf4]",
  away: "border-l-[#1d4ed8] bg-[#eff6ff]",
  tbd: "border-l-gray-400 bg-gray-50",
};

function rowTone(row: ScheduleRow): string {
  return row.struck ? "border-l-gray-300 bg-gray-50 text-gray-400" : ROW_TONE[row.site];
}

function Address({ address, small = false }: { address: string; small?: boolean }) {
  return (
    <a
      href={mapsUrl(address)}
      target="_blank"
      rel="noopener"
      className={`underline decoration-gray-300 underline-offset-2 hover:decoration-current print:no-underline ${small ? "text-xs" : ""}`}
      style={{ color: NAVY }}
    >
      {address}
    </a>
  );
}

/** Wide screens: one line per game. */
function DesktopRow({ row }: { row: ScheduleRow }) {
  return (
    <div
      className={`mb-1.5 hidden grid-cols-[110px_1fr_1.2fr_auto] items-center gap-4 rounded-lg border border-l-[5px] border-gray-200 px-3 py-2.5 md:grid ${rowTone(row)}`}
    >
      <div className={row.struck ? "line-through" : ""}>
        <div className="font-bold" style={{ color: row.struck ? undefined : NAVY }}>{fmtTime(row.time)}</div>
        {row.endTime && <div className="text-xs text-gray-500">until {fmtTime(row.endTime)}</div>}
      </div>
      <div className="min-w-0">
        <div className={`font-semibold ${row.struck ? "line-through" : "text-gray-900"}`}>{row.matchup}</div>
        <div className="text-xs text-gray-500">{row.divisionName}</div>
      </div>
      <div className="min-w-0 text-sm">
        <div className={row.struck ? "" : "text-gray-800"}>{row.fieldLabel}</div>
        {row.struck ? (
          <div className="text-xs">New date to be announced</div>
        ) : (
          row.address && <div className="text-xs"><Address address={row.address} small /></div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        <Tags row={row} />
      </div>
    </div>
  );
}

/** Narrow screens and the embed: a card with a FIXED line order — field,
 *  address if known, "division · until time" (cardLines). */
function Card({ row, embed }: { row: ScheduleRow; embed: boolean }) {
  const lines = cardLines(row);
  const hasAddress = row.address !== null;
  return (
    <div
      className={`mb-2 rounded-lg border border-l-[5px] border-gray-200 ${embed ? "px-2.5 py-2" : "px-3 py-2.5 md:hidden"} ${rowTone(row)}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-bold ${row.struck ? "line-through" : ""}`} style={{ color: row.struck ? undefined : NAVY }}>
          {fmtTime(row.time)}
        </span>
        <span className="flex flex-wrap justify-end gap-1">
          <Tags row={row} />
        </span>
      </div>
      <div className={`mt-1 font-semibold ${row.struck ? "line-through" : "text-gray-900"}`}>{row.matchup}</div>
      <div className={`text-[13px] ${row.struck ? "" : "text-gray-600"}`}>{lines[0]}</div>
      {hasAddress && !row.struck && (
        <div className="text-xs"><Address address={row.address!} small /></div>
      )}
      <div className="text-xs text-gray-500">
        {row.struck ? `${row.divisionName} · new date to be announced` : lines[hasAddress ? 2 : 1]}
      </div>
    </div>
  );
}

function Legend({ orgName, compact }: { orgName: string; compact: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-200 text-xs text-gray-500 ${compact ? "px-3 py-1.5" : "px-5 py-2 sm:px-6"}`}>
      <span className="flex items-center gap-1.5">
        <SiteTag site="home" />
        <span className={compact ? "hidden" : "hidden sm:inline"}>at a {orgName} park</span>
      </span>
      <span className="flex items-center gap-1.5">
        <SiteTag site="away" />
        <span className={compact ? "hidden" : "hidden sm:inline"}>at another league&apos;s field</span>
      </span>
      <span className="flex items-center gap-1.5">
        <PlainTag tone="struck">Rained out</PlainTag>
        <span className={compact ? "hidden" : "hidden sm:inline"}>not being played on this date</span>
      </span>
    </div>
  );
}

function MonthView({
  rows,
  month,
  setMonth,
}: {
  rows: ScheduleRow[];
  month: string;
  setMonth: (m: string) => void;
}) {
  const byDate = new Map<string, ScheduleRow[]>();
  for (const r of rows) {
    if (!r.date.startsWith(month)) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const cells = monthGrid(month);
  return (
    <div>
      <div className="flex items-center justify-between px-6 py-3">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-gray-300 p-1.5 hover:bg-gray-50">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <b style={{ color: NAVY }}>{monthLabel(month)}</b>
        <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-gray-300 p-1.5 hover:bg-gray-50">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 border-t border-gray-200">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="border-b border-gray-200 px-2 py-1.5 text-[11px] font-bold uppercase text-gray-500">{d}</div>
        ))}
        {cells.map((date, i) => {
          const dayRows = date ? byDate.get(date) ?? [] : [];
          return (
            <div key={date ?? `blank-${i}`} className={`min-h-[96px] border-b border-gray-200 p-1.5 text-[11px] ${i % 7 !== 6 ? "border-r" : ""} ${date ? "" : "bg-gray-50"}`}>
              {date && <div className="mb-1 font-bold text-gray-500">{Number(date.slice(8))}</div>}
              {dayRows.slice(0, 4).map((r) => (
                <div
                  key={r.key}
                  title={`${fmtTime(r.time)} ${r.matchup} — ${r.fieldLabel}${r.struck ? ` (${r.statusLabel})` : ""}`}
                  className={`mb-0.5 truncate rounded px-1 py-0.5 ${
                    r.struck
                      ? "bg-gray-100 text-gray-400 line-through"
                      : r.site === "home"
                        ? "bg-[#15803d] text-white"
                        : r.site === "away"
                          ? "border border-[#1d4ed8] bg-white text-[#1d4ed8]"
                          : "border border-dashed border-gray-400 text-gray-500"
                  }`}
                >
                  <b className="mr-1">{r.struck ? "✕" : r.site === "home" ? "H" : r.site === "away" ? "A" : "?"}</b>
                  {fmtTime(r.time).replace(" AM", "").replace(" PM", "")} {r.matchup}
                </div>
              ))}
              {dayRows.length > 4 && <div className="text-gray-500">+{dayRows.length - 4} more</div>}
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 px-6 py-2 text-xs text-gray-500">
        <span><b>H</b> Home</span><span><b>A</b> Away</span><span><b>✕</b> Rained out</span>
        <span>Hover a game for its field.</span>
      </div>
    </div>
  );
}
