"use client";

import { useState } from "react";
import { X, Trophy } from "lucide-react";
import { enterGameResult } from "@/lib/playoffs/enter-result";
import type { GameWithTeams } from "@/components/playoffs/bracket-view";

const CHAMPIONSHIP_ROUNDS = new Set(["F", "GF"]);

interface Props {
  game: GameWithTeams;
  allGames: GameWithTeams[];
  format: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EnterResultModal({ game, allGames, format, onClose, onSaved }: Props) {
  const [homeScore, setHomeScore] = useState(
    game.home_score != null ? String(game.home_score) : "",
  );
  const [awayScore, setAwayScore] = useState(
    game.away_score != null ? String(game.away_score) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isChampionship = CHAMPIONSHIP_ROUNDS.has(game.round);

  async function handleSave() {
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
    const result = await enterGameResult({ gameId: game.id, homeScore: h, awayScore: a }, allGames, format);
    setSaving(false);
    if (!result.success) { setError(result.error); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[#0C1F3F]">Enter Result</p>
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
          <ScoreRow label={game.home_team_name ?? "Home"} value={homeScore} onChange={setHomeScore} />
          <ScoreRow label={game.away_team_name ?? "Away"} value={awayScore} onChange={setAwayScore} />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0C1F3F] py-2 text-sm font-medium text-white hover:bg-[#0C1F3F]/90 disabled:opacity-50"
          >
            {isChampionship && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
            {saving ? "Saving…" : "Save Result"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{label}</span>
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
