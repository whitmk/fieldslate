"use client";

// One card per two-stage setup ("Round robin, then bracket"): Stage 1's games
// by round with the Records box (admin only, A–Z, never a ranking), and Stage
// 2's bracket with its seed placeholders, the Seed / Change seeds button, and
// the re-check note. Approved mockup screens 5–11. Every rule and sentence is
// in two-stage.ts; this file reads, renders and calls.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardEdit,
  FileDown,
  Loader2,
  Pencil,
  Trash2,
  Trophy,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { todayInTimezone } from "@/lib/utils/org-today";
import { BracketView, type GameWithTeams } from "@/components/playoffs/bracket-view";
import { EnterResultModal } from "@/components/playoffs/enter-result-modal";
import { EditPlayoffGameModal } from "@/components/playoffs/edit-playoff-game-modal";
import { SeedStage2Modal } from "@/components/playoffs/seed-stage2-modal";
import { slotWon, shortTime, shortDate } from "@/lib/playoffs/bracket-labels";
import { playoffRoundLabel } from "@/lib/playoffs/playoff-result";
import { acknowledgeSeeds } from "@/lib/playoffs/two-stage-io";
import {
  hasResult,
  initialSeedOrder,
  neverPlayedLine,
  RECHECK_KEPT,
  recordText,
  roundRobinRecords,
  rrGameLabel,
  seededLine,
  stage1HeaderPill,
  stage1LockedLine,
  stage1RecheckNote,
  stage1Status,
  STAGE1_EDIT_AFTER_SEEDING,
  stage2Button,
  stage2HeaderPill,
  stage2Line,
  stageRange,
  twoStageCardLine,
  type Pill,
  type Stage2Game,
} from "@/lib/playoffs/two-stage";
import type { PlayingDay, SeededTeam } from "@/components/playoffs/playoff-wizard-types";

export type StageRow = {
  id: string;
  league_id: string;
  division_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  seeding: SeededTeam[];
  playing_days: PlayingDay[];
  advance_count: number | null;
  seeded_at: string | null;
  seeded_by: string | null;
  stage1_changed_at: string | null;
  division: { id: string; name: string } | null;
};

interface Props {
  stage1: StageRow;
  stage2: StageRow;
  counting: boolean;
  onEdit: (stage1HasResults: boolean) => void;
  onDelete: () => void;
  onExport: () => void;
}

const PILL: Record<Pill["tone"], string> = {
  gray: "bg-gray-100 text-gray-600",
  green: "bg-[#22C55E]/10 text-[#16a34a]",
  amber: "bg-amber-50 text-amber-700",
};

function PillChip({ pill }: { pill: Pill }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[pill.tone]}`}>{pill.text}</span>;
}

function StageNum({ n }: { n: 1 | 2 }) {
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#0C1F3F] text-xs font-bold text-white">
      {n}
    </span>
  );
}

function rowsToGames(data: unknown[]): GameWithTeams[] {
  return (data as Record<string, unknown>[]).map((g) => ({
    ...(g as unknown as GameWithTeams),
    home_team_name: (g.home as { name?: string } | null)?.name ?? null,
    away_team_name: (g.away as { name?: string } | null)?.name ?? null,
    venue_name: (g.venue as { name?: string } | null)?.name ?? null,
    venue_has_lights: (g.venue as { has_lights?: boolean } | null)?.has_lights ?? null,
    winner_name: (g.winner as { name?: string } | null)?.name ?? null,
    home_score: (g.home_score as number | null) ?? null,
    away_score: (g.away_score as number | null) ?? null,
  }));
}

export function TwoStageCard({ stage1, stage2, counting, onEdit, onDelete, onExport }: Props) {
  const [s1Games, setS1Games] = useState<GameWithTeams[]>([]);
  const [s2Games, setS2Games] = useState<GameWithTeams[]>([]);
  const [today, setToday] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [seededByName, setSeededByName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState({ stage1, stage2 });

  const [showGames, setShowGames] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showRecords, setShowRecords] = useState<boolean | null>(null);
  const [resultGame, setResultGame] = useState<GameWithTeams | null>(null);
  const [timeGame, setTimeGame] = useState<GameWithTeams | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [stage2Key, setStage2Key] = useState(0);

  const divisionName = stage1.division?.name ?? "";

  const load = useCallback(async () => {
    const supabase = createClient();
    const [games, r1, r2] = await Promise.all([
      supabase
        .from("playoff_games")
        .select(
          `*, home:teams!playoff_games_home_team_id_fkey(name),
           away:teams!playoff_games_away_team_id_fkey(name),
           venue:venues(name, has_lights),
           winner:teams!playoff_games_winner_id_fkey(name)`,
        )
        .in("playoff_id", [stage1.id, stage2.id])
        .order("game_number"),
      supabase.from("playoffs").select("seeding, status, start_date, end_date").eq("id", stage1.id).maybeSingle(),
      supabase
        .from("playoffs")
        .select("seeding, status, start_date, end_date, advance_count, seeded_at, seeded_by, stage1_changed_at")
        .eq("id", stage2.id)
        .maybeSingle(),
    ]);
    if (games.error || r1.error || r2.error || !r1.data || !r2.data) {
      setLoadError("Couldn't load this setup's games. Refresh the page to try again.");
      setLoading(false);
      return;
    }
    const all = rowsToGames(games.data ?? []);
    setS1Games(all.filter((g) => g.playoff_id === stage1.id));
    setS2Games(all.filter((g) => g.playoff_id === stage2.id));
    setRows((prev) => ({
      stage1: { ...prev.stage1, ...(r1.data as Partial<StageRow>) },
      stage2: { ...prev.stage2, ...(r2.data as Partial<StageRow>) },
    }));
    setLoadError(null);
    setLoading(false);
  }, [stage1.id, stage2.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Today" in the league's timezone, read after mount (never in render).
  useEffect(() => {
    let stale = false;
    const supabase = createClient();
    void (async () => {
      const { data: league } = await supabase.from("leagues").select("owner_id").eq("id", stage1.league_id).maybeSingle();
      const owner = (league as { owner_id: string } | null)?.owner_id;
      if (!owner) return;
      const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", owner).maybeSingle();
      const zone = (profile as { timezone: string } | null)?.timezone;
      if (!zone || stale) return;
      try {
        setToday(todayInTimezone(zone));
        setTz(zone);
      } catch {
        // An unreadable timezone leaves the Seed button off rather than guessing a day.
      }
    })();
    return () => {
      stale = true;
    };
  }, [stage1.league_id]);

  const seededBy = rows.stage2.seeded_by;
  useEffect(() => {
    if (!seededBy) {
      setSeededByName(null);
      return;
    }
    void createClient()
      .from("profiles")
      .select("full_name")
      .eq("id", seededBy)
      .maybeSingle()
      .then(({ data }) => setSeededByName((data as { full_name: string | null } | null)?.full_name ?? null));
  }, [seededBy]);

  const teams = useMemo(() => rows.stage1.seeding ?? [], [rows.stage1.seeding]);
  const advance = rows.stage2.advance_count ?? 2;
  const nameById = useMemo(() => new Map(teams.map((t) => [t.team_id, t.team_name])), [teams]);
  const teamName = useCallback(
    (id: string | null) => (id ? nameById.get(id) ?? "Removed team" : "TBD"),
    [nameById],
  );

  const status = useMemo(() => (today ? stage1Status(s1Games, today) : null), [s1Games, today]);
  const records = useMemo(() => roundRobinRecords(teams, s1Games), [teams, s1Games]);
  const firstResult = useMemo(() => {
    const done = s2Games.filter(hasResult).map((g) => g.game_number);
    return done.length ? Math.min(...done) : null;
  }, [s2Games]);
  const seeded = !!rows.stage2.seeded_at;
  const recheck = seeded && !!rows.stage2.stage1_changed_at;
  const s2State = status ? { seeded, recheck, firstResultGame: firstResult, status } : null;

  const locked = firstResult !== null;
  const gamesOpen = showGames ?? (status?.kind === "in_progress" && !locked);
  const recordsOpen = showRecords ?? (status?.kind === "in_progress" && !locked);

  // Stage 1 by round, oldest first.
  const rounds = useMemo(() => {
    const byRound = new Map<string, GameWithTeams[]>();
    for (const g of [...s1Games].sort((a, b) => a.game_number - b.game_number)) {
      if (!byRound.has(g.round)) byRound.set(g.round, []);
      byRound.get(g.round)!.push(g);
    }
    return [...byRound.entries()].sort(
      ([a], [b]) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")),
    );
  }, [s1Games]);
  const lastPlayedIdx = rounds.reduce((acc, [, gs], i) => (gs.every(hasResult) ? i : acc), -1);
  const visibleRounds = showAll
    ? rounds
    : rounds.filter(([, gs], i) => gs.some((g) => !hasResult(g)) || i === lastPlayedIdx);
  const hiddenRounds = rounds.length - visibleRounds.length;

  async function keepSeeds() {
    setAckBusy(true);
    setAckError(null);
    const res = await acknowledgeSeeds(stage2.id);
    setAckBusy(false);
    if (!res.ok) {
      setAckError(res.message);
      return;
    }
    await load();
  }

  const seedOrder: SeededTeam[] =
    seeded && rows.stage2.seeding?.length ? rows.stage2.seeding : initialSeedOrder(teams);
  const seededOn = rows.stage2.seeded_at && tz ? todayInTimezone(tz, new Date(rows.stage2.seeded_at)) : null;
  const changedOn = rows.stage2.stage1_changed_at && tz ? todayInTimezone(tz, new Date(rows.stage2.stage1_changed_at)) : null;
  const notAdvancing = (rows.stage2.seeding ?? []).slice(advance).map((t) => t.team_name);
  const btn = s2State ? stage2Button(s2State) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
          <Trophy className="h-4 w-4 text-gray-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[#0C1F3F]">{divisionName || "—"}</p>
          <p className="text-xs text-gray-400">{twoStageCardLine(teams.length, advance)}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            rows.stage1.status === "draft" ? "bg-gray-100 text-gray-500" : "bg-[#22C55E]/10 text-[#22C55E]"
          }`}
        >
          {rows.stage1.status === "draft" ? "Draft" : "Active"}
        </span>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <button
            onClick={() => onEdit(s1Games.some(hasResult))}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-800"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit setup
          </button>
          <button
            onClick={onExport}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-800"
          >
            <FileDown className="h-3.5 w-3.5" />
            Print
          </button>
          <button
            onClick={onDelete}
            disabled={counting}
            aria-label={`Delete the ${divisionName} playoffs (both stages)`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-red-200 hover:text-red-600 disabled:opacity-50"
          >
            {counting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center border-t border-gray-50 py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
        </div>
      ) : loadError ? (
        <p role="alert" className="border-t border-gray-50 px-4 py-4 text-sm text-red-700">{loadError}</p>
      ) : (
        <>
          {/* ── Stage 1 ── */}
          <section className="border-t border-gray-100">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <StageNum n={1} />
              <b className="text-sm text-[#0C1F3F]">Round robin</b>
              {stageRange(rows.stage1.start_date, rows.stage1.end_date) && (
                <span className="text-xs text-gray-400">{stageRange(rows.stage1.start_date, rows.stage1.end_date)}</span>
              )}
              {status && <PillChip pill={stage1HeaderPill(status, locked)} />}
              {status?.kind === "in_progress" && !locked && (
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                  <span
                    className="block h-full bg-[#22C55E]"
                    style={{ width: `${status.total ? Math.round((status.played / status.total) * 100) : 0}%` }}
                  />
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => setShowGames(!gamesOpen)}
                className="min-h-9 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                {gamesOpen ? "Hide games" : "Show games"}
              </button>
              <button
                onClick={() => setShowRecords(!recordsOpen)}
                className="min-h-9 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                {recordsOpen ? "Hide records" : "Records"}
              </button>
            </div>

            <div className="flex flex-col gap-3 px-4 pb-4">
              {locked && firstResult !== null && <p className="text-xs text-gray-500">{stage1LockedLine(firstResult)}</p>}
              {!locked && status?.kind === "seed_anyway" && (
                <p className="text-xs text-gray-500">{neverPlayedLine(status.neverPlayed, teamName)}</p>
              )}

              {gamesOpen && (
                <div className="flex flex-col gap-1">
                  {visibleRounds.map(([round, games]) => {
                    const dates = games.map((g) => g.scheduled_date).filter((d): d is string => !!d).sort();
                    const playing = new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]));
                    const sitting = teams.filter((t) => !playing.has(t.team_id)).map((t) => t.team_name);
                    return (
                      <div key={round}>
                        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                          {playoffRoundLabel(round)}
                          {dates[0] ? ` · ${shortDate(dates[0])}` : ""}
                          {sitting.length ? ` · ${sitting.join(", ")} sit out` : ""}
                        </p>
                        {games.map((g) => {
                          const done = hasResult(g);
                          const homeWon = slotWon(g.winner_id, g.home_team_id);
                          const awayWon = slotWon(g.winner_id, g.away_team_id);
                          const when = [
                            rrGameLabel(g.game_number),
                            g.start_time ? shortTime(g.start_time) : g.scheduled_date ? null : "No date yet",
                            g.venue_name,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <div
                              key={g.id}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-50 py-2 last:border-0"
                            >
                              <span className="w-full text-xs text-gray-500 sm:w-56 sm:flex-shrink-0 sm:truncate">{when}</span>
                              <span className="min-w-0 flex-1 text-sm text-gray-900">
                                {g.status === "cancelled" && !done ? (
                                  <span className="text-gray-400 line-through">
                                    {teamName(g.home_team_id)} vs {teamName(g.away_team_id)}
                                  </span>
                                ) : done && g.home_score != null && g.away_score != null ? (
                                  <>
                                    <span className={homeWon ? "font-semibold text-[#0C1F3F]" : "text-gray-500"}>
                                      {teamName(g.home_team_id)} {g.home_score}
                                    </span>
                                    <span className="text-gray-300"> · </span>
                                    <span className={awayWon ? "font-semibold text-[#0C1F3F]" : "text-gray-500"}>
                                      {teamName(g.away_team_id)} {g.away_score}
                                    </span>
                                  </>
                                ) : (
                                  `${teamName(g.home_team_id)} vs ${teamName(g.away_team_id)}`
                                )}
                                {g.status === "cancelled" && !done && (
                                  <span className="ml-2 text-xs text-gray-400">Rained out</span>
                                )}
                              </span>
                              {!done && (
                                <button
                                  onClick={() => setTimeGame(g)}
                                  aria-label="Set date, time and field"
                                  title="Set date, time and field"
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                                >
                                  <CalendarClock className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {!locked && g.home_team_id && g.away_team_id && (
                                <button
                                  onClick={() => setResultGame(g)}
                                  className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-xs font-medium ${
                                    done
                                      ? "border border-gray-200 text-gray-600 hover:bg-gray-50"
                                      : "bg-[#0C1F3F] text-white hover:bg-[#0C1F3F]/90"
                                  }`}
                                >
                                  <ClipboardEdit className="h-3 w-3" />
                                  {done ? "Edit result" : "Enter result"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {(hiddenRounds > 0 || showAll) && rounds.length > 1 && (
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="mt-1 self-start text-xs font-medium text-[#16a34a] underline"
                    >
                      {showAll ? "Show fewer rounds" : `Show all ${s1Games.length} games`}
                    </button>
                  )}
                </div>
              )}

              {recordsOpen && (
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <b className="text-sm text-[#0C1F3F]">Records</b>
                    <span className="rounded-full bg-[#0C1F3F]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0C1F3F]">
                      Admins only
                    </span>
                    <span className="flex-1" />
                    <span className="text-xs text-gray-400">A–Z · not a ranking</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                        <th className="py-1 font-semibold">Team</th>
                        <th className="py-1 text-right font-semibold">W-L</th>
                        <th className="py-1 text-right font-semibold">Runs for</th>
                        <th className="py-1 text-right font-semibold">Runs against</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.teamId} className="border-t border-gray-100">
                          <td className="py-1.5 text-gray-900">{r.teamName}</td>
                          <td className="py-1.5 text-right tabular-nums">{recordText(r)}</td>
                          <td className="py-1.5 text-right tabular-nums text-gray-600">{r.runsFor}</td>
                          <td className="py-1.5 text-right tabular-nums text-gray-600">{r.runsAgainst}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* ── Stage 2 ── */}
          <section className="border-t border-gray-100">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <StageNum n={2} />
              <b className="text-sm text-[#0C1F3F]">Bracket</b>
              {stageRange(rows.stage2.start_date, rows.stage2.end_date) && (
                <span className="text-xs text-gray-400">{stageRange(rows.stage2.start_date, rows.stage2.end_date)}</span>
              )}
              {s2State && <PillChip pill={stage2HeaderPill(s2State)} />}
              <span className="flex-1" />
              {btn && (
                <button
                  onClick={() => setSeeding(true)}
                  disabled={!!btn.disabledReason}
                  title={btn.disabledReason ?? undefined}
                  className={`min-h-9 rounded-lg px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                    seeded
                      ? "border border-gray-200 text-gray-600 hover:bg-gray-50"
                      : "bg-[#22C55E] text-white hover:bg-[#16a34a]"
                  }`}
                >
                  {btn.label}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-3 px-4 pb-4">
              {!today && <p className="text-xs text-gray-400">Checking where the round robin stands…</p>}
              {status && !seeded && <p className="text-xs text-gray-500">{stage2Line(status, advance)}</p>}
              {seeded && seededOn && (
                <p className="text-xs text-gray-500">{seededLine(seededOn, seededByName, notAdvancing)}</p>
              )}
              {recheck && !locked && changedOn && (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    {stage1RecheckNote(changedOn)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSeeding(true)}
                      className="min-h-9 rounded-lg bg-[#22C55E] px-3 font-semibold text-white hover:bg-[#16a34a]"
                    >
                      Change seeds
                    </button>
                    <button
                      onClick={keepSeeds}
                      disabled={ackBusy}
                      className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {RECHECK_KEPT}
                    </button>
                  </div>
                  {ackError && <p role="alert" className="text-red-700">{ackError}</p>}
                </div>
              )}
              <BracketView
                key={stage2Key}
                playoffId={stage2.id}
                leagueId={stage2.league_id}
                divisionId={stage2.division_id}
                divisionName={divisionName}
                format="single_elimination"
                playingDays={rows.stage2.playing_days ?? []}
                showSeeds
                onChanged={() => void load()}
              />
            </div>
          </section>
        </>
      )}

      {resultGame && (
        <EnterResultModal
          game={resultGame}
          allGames={s1Games}
          format="round_robin"
          title={`${rrGameLabel(resultGame.game_number)} · ${teamName(resultGame.home_team_id)} vs ${teamName(resultGame.away_team_id)}`}
          notice={seeded ? STAGE1_EDIT_AFTER_SEEDING : null}
          onClose={() => setResultGame(null)}
          onSaved={async () => {
            setResultGame(null);
            await load();
          }}
        />
      )}
      {timeGame && (
        <EditPlayoffGameModal
          game={timeGame}
          roundLabel={`${playoffRoundLabel(timeGame.round)} · ${rrGameLabel(timeGame.game_number)}`}
          leagueId={stage1.league_id}
          divisionId={stage1.division_id}
          divisionName={divisionName}
          playingDays={rows.stage1.playing_days ?? []}
          onClose={() => setTimeGame(null)}
          onSaved={async () => {
            setTimeGame(null);
            await load();
          }}
        />
      )}
      {seeding && status && (
        <SeedStage2Modal
          divisionName={divisionName}
          stage2Id={stage2.id}
          order={seedOrder}
          records={records}
          advance={advance}
          status={status}
          stage2Games={s2Games as unknown as Stage2Game[]}
          teamName={teamName}
          onClose={() => setSeeding(false)}
          onSeeded={async () => {
            setSeeding(false);
            await load();
            setStage2Key((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
