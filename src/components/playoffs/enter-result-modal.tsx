"use client";

import { useState } from "react";
import { X, Trophy, Eraser } from "lucide-react";
import { enterGameResult } from "@/lib/playoffs/enter-result";
import { clearResult, previewClearResult } from "@/lib/playoffs/clear-result";
import { clearConfirm, clearOffered, saveBlockedReason, type ClearPreview, type ResultNumbering } from "@/lib/playoffs/playoff-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { gameLabel, gameNumbering, slotName } from "@/lib/playoffs/bracket-labels";
import type { GameWithTeams } from "@/components/playoffs/bracket-view";
import { TONE_CHIP } from "@/components/playoffs/series-card";
import {
  bestOfLine,
  gameHasResult,
  seriesClearLines,
  seriesEnterLine,
  seriesEnterRefusal,
  seriesGameTag,
  seriesGameWhen,
  seriesGamesOf,
  seriesHeadline,
  seriesHomeNote,
  seriesResultText,
} from "@/lib/playoffs/series";
import { isSeriesGame, seriesLengthOf, seriesNameInSentence } from "@/lib/playoffs/series-names";

const CHAMPIONSHIP_ROUNDS = new Set(["F", "GF"]);

interface Props {
  game: GameWithTeams;
  allGames: GameWithTeams[];
  format: string;
  onClose: () => void;
  onSaved: () => void;
  /** Replaces "Enter Result" (two-stage round-robin games: "RR Game 19 · Mets vs Royals"). */
  title?: string;
  /** An amber note above the scores (two-stage: Stage 2 is already seeded). */
  notice?: string | null;
  /** A two-stage round-robin game: the bracket that follows, so a refusal
   *  naming its first played game shows that game's shown number. */
  nextStageGames?: { game_number: number }[];
}

export function EnterResultModal({ game, allGames, format, onClose, onSaved, title, notice, nextStageGames }: Props) {
  const [homeScore, setHomeScore] = useState(
    game.home_score != null ? String(game.home_score) : "",
  );
  const [awayScore, setAwayScore] = useState(
    game.away_score != null ? String(game.away_score) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isChampionship = CHAMPIONSHIP_ROUNDS.has(game.round);
  const isDone = game.status === "completed";
  const saveBlocked = saveBlockedReason(game.home_team_id, game.away_team_id);
  const homeLabel = slotName(game.home_team_name, game, "home", allGames, format);
  const awayLabel = slotName(game.away_team_name, game, "away", allGames, format);
  // 0114: a game of a series names its series ("Semifinal 1 · Game 2 of 3"),
  // shows where the series stands, and says what saving will do.
  const isSeries = isSeriesGame(game, allGames);
  const seriesGames = isSeries ? seriesGamesOf(game, allGames) : [];
  const names = new Map<string, string>();
  for (const g of allGames) {
    if (g.home_team_id && g.home_team_name) names.set(g.home_team_id, g.home_team_name);
    if (g.away_team_id && g.away_team_name) names.set(g.away_team_id, g.away_team_name);
  }
  const teamName = (id: string) => names.get(id) ?? "TBD";
  const venueName = (id: string | null) => allGames.find((g) => g.venue_id === id && id)?.venue_name ?? null;
  const refusal = isSeries ? seriesEnterRefusal(game, allGames, teamName) : null;

  const numbering: ResultNumbering = {
    own: gameNumbering(allGames),
    nextStage: nextStageGames ? gameNumbering(nextStageGames) : null,
    seriesOf: (round, stored) => {
      const row = allGames.find((g) => g.round === round && g.game_number === stored);
      return row && isSeriesGame(row, allGames) ? { inSentence: seriesNameInSentence(row, allGames) } : null;
    },
  };

  // Clear result: preview first (clear_playoff_result writes nothing), then
  // the shared confirm. A refusal or failure keeps the confirm open with the
  // reason; success closes everything and reloads the bracket.
  const [checkingClear, setCheckingClear] = useState(false);
  const [clearPreview, setClearPreview] = useState<ClearPreview | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  async function handleClearClick() {
    setCheckingClear(true);
    setError(null);
    const outcome = await previewClearResult(game.id, numbering);
    setCheckingClear(false);
    if (!outcome.ok) { setError(outcome.message); return; }
    setClearError(null);
    setClearPreview(outcome.preview);
  }

  async function handleClearConfirm() {
    setClearing(true);
    setClearError(null);
    const outcome = await clearResult(game.id, numbering);
    setClearing(false);
    if (!outcome.ok) { setClearError(outcome.message); return; }
    setClearPreview(null);
    onSaved();
  }

  async function handleSave() {
    if (saveBlocked) { setError(saveBlocked); return; }
    // A blank field defaults to 0 so the admin can enter just the winner's score.
    const h = homeScore.trim() === "" ? 0 : parseInt(homeScore, 10);
    const a = awayScore.trim() === "" ? 0 : parseInt(awayScore, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      setError("Enter valid scores for both teams.");
      return;
    }
    if (h === a) {
      setError("Scores cannot be tied — one team must win.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await enterGameResult({ gameId: game.id, homeScore: h, awayScore: a }, allGames, format, numbering);
    setSaving(false);
    if (!result.success) { setError(result.error); return; }
    onSaved();
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="w-full max-w-sm rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-[#0C1F3F]">{title ?? (isSeries ? gameLabel(game, allGames) : "Enter Result")}</p>
              {isChampionship && (
                <p className="text-xs font-medium text-amber-500">Championship Game</p>
              )}
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Score inputs */}
          <div className="space-y-3 px-5 py-5">
            {notice && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice}</p>
            )}
            {isSeries && <SeriesBox game={game} games={seriesGames} teamName={teamName} />}
            {refusal ? (
              <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{refusal}</p>
            ) : (
              <>
                <ScoreRow label={homeLabel} home={isSeries} value={homeScore} onChange={setHomeScore} />
                <ScoreRow label={awayLabel} value={awayScore} onChange={setAwayScore} />
                {(() => {
                  if (!isSeries || homeScore.trim() === "" || awayScore.trim() === "") return null;
                  const h = parseInt(homeScore, 10);
                  const a = parseInt(awayScore, 10);
                  if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return null;
                  const line = seriesEnterLine(game, allGames, h, a, teamName);
                  return line ? (
                    <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">{line}</p>
                  ) : null;
                })()}
              </>
            )}
            {title && isDone && game.home_score != null && game.away_score != null && (
              <p className="text-xs text-gray-500">
                Was {homeLabel} {game.home_score}, {awayLabel} {game.away_score}.
                Every game needs a winner — a tied score can&apos;t be saved.
              </p>
            )}
            {!refusal && saveBlocked && <p className="text-xs text-gray-500">{saveBlocked}</p>}
            {error && <p className="text-xs text-red-500">{error}</p>}
            {isDone && clearOffered(format) && !refusal && (
              <button
                type="button"
                onClick={handleClearClick}
                disabled={checkingClear || saving}
                className="flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                <Eraser className="h-3.5 w-3.5" />
                {checkingClear ? "Checking…" : "Clear result"}
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              {refusal ? "Close" : "Cancel"}
            </button>
            {!refusal && <button
              onClick={handleSave}
              disabled={saving || !!saveBlocked}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0C1F3F] py-2 text-sm font-medium text-white hover:bg-[#0C1F3F]/90 disabled:opacity-50"
            >
              {isChampionship && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
              {saving ? "Saving…" : "Save Result"}
            </button>}
          </div>
        </div>
      </div>
      {/* Outside the backdrop: its onClick closes the modal. */}
      {clearPreview && (() => {
        const confirm = clearConfirm(
          clearPreview,
          isSeries
            ? { gameTitle: gameLabel(game, allGames), lines: seriesClearLines(game, allGames, teamName, venueName) }
            : undefined,
        );
        return (
          <ConfirmDialog
            title={confirm.title}
            detail={confirm.lines.map((line, i) => (
              <span key={i} className={i === 0 ? "block" : "mt-1 block"}>{line}</span>
            ))}
            confirmLabel="Clear result"
            tone="danger"
            icon={<Eraser className="h-5 w-5" />}
            busy={clearing}
            error={clearError}
            onConfirm={handleClearConfirm}
            onCancel={() => { setClearPreview(null); setClearError(null); }}
          />
        );
      })()}
    </>
  );
}

/** Where the series stands and every game of it (approved mockup screen 4). */
function SeriesBox({
  game,
  games,
  teamName,
}: {
  game: GameWithTeams;
  games: GameWithTeams[];
  teamName: (id: string) => string;
}) {
  const headline = seriesHeadline(games, teamName);
  const length = seriesLengthOf(game, games);
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CHIP[headline.tone]}`}>{headline.text}</span>
        <span className="text-xs text-gray-500">{bestOfLine(length)}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {games.map((g) => {
          const tag = seriesGameTag(g, games);
          const current = g.id === game.id;
          const result = gameHasResult(g) ? seriesResultText(g, teamName) : null;
          const home = tag === "not_needed" ? null : seriesHomeNote(g, teamName);
          return (
            <li
              key={g.id}
              className={`flex gap-2 text-xs ${current ? "font-semibold text-[#0C1F3F]" : tag === "not_needed" ? "text-gray-400 line-through" : "text-gray-600"}`}
            >
              <span className="w-14 flex-none">Game {g.series_game ?? 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {[seriesGameWhen(g), ...(home ? [home] : [])].join(" · ")}
              </span>
              <span className="flex-none">
                {current ? "this game" : result ?? (tag === "if_needed" ? "if needed" : tag === "not_needed" ? "not needed" : "")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScoreRow({
  label,
  home,
  value,
  onChange,
}: {
  label: string;
  /** A series game names its home team (games alternate). */
  home?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
        {label}
        {home && <span className="ml-1 text-xs text-gray-400">(home)</span>}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-center text-sm font-semibold text-[#0C1F3F] focus:border-[#0C1F3F] focus:outline-none"
        placeholder="0"
      />
    </div>
  );
}
