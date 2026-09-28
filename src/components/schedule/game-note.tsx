// The three ways a game's note is SHOWN, shared by every surface so a note
// never looks different from one screen to the next — and so the harness
// renders exactly what the surfaces render (hook-free, like move-game-row).
//
//   GameNoteIcon  — the row's note icon: outline (hover-revealed, like the
//                   other row icons) when there is no note; filled and violet,
//                   always visible, when there is one. Opens the editor.
//   GameNoteLine  — one truncated grey line under the matchup, full text on
//                   hover (title). Clicking it opens the editor too.
//   GameNoteDot   — calendar pills and week-grid blocks have no room for text:
//                   a small violet dot, full text on hover.
//
// Notes are INTERNAL. None of these may be rendered inside a print region, an
// export, or a partner-facing page — src/lib/schedule/game-notes.ts.

import { StickyNote } from "lucide-react";
import { ROW_ICON_REVEAL } from "@/components/ui/row-icon-reveal";
import { hasNote, noteLineText, type GameNoteFields } from "@/lib/schedule/game-notes";

export function GameNoteIcon({
  game,
  onClick,
  size = "sm",
}: {
  game: GameNoteFields;
  onClick: () => void;
  size?: "sm" | "md";
}) {
  const present = hasNote(game);
  const title = present ? `Note: ${noteLineText(game)}` : "Add a note";
  const box = size === "md" ? "h-8 w-8" : "h-7 w-7";
  const glyph = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      aria-label={title}
      data-note={present ? "present" : "empty"}
      className={`flex ${box} items-center justify-center rounded-lg transition-all ${
        present
          ? "text-violet-600 hover:bg-violet-50"
          : `${ROW_ICON_REVEAL} hover:bg-violet-50 hover:text-violet-500`
      }`}
    >
      <StickyNote className={glyph} fill={present ? "currentColor" : "none"} fillOpacity={present ? 0.2 : 0} />
    </button>
  );
}

export function GameNoteLine({
  game,
  onClick,
  className = "",
}: {
  game: GameNoteFields;
  onClick?: () => void;
  className?: string;
}) {
  if (!hasNote(game)) return null;
  const text = noteLineText(game);
  const shared = `block max-w-full truncate text-left text-xs text-gray-500 ${className}`;
  if (!onClick) {
    return (
      <span title={game.notes ?? ""} data-note-line className={shared}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={game.notes ?? ""}
      data-note-line
      className={`${shared} hover:text-violet-600`}
    >
      {text}
    </button>
  );
}

export function GameNoteDot({ game }: { game: GameNoteFields }) {
  if (!hasNote(game)) return null;
  return (
    <span
      title={game.notes ?? ""}
      data-note-dot
      aria-label="Has a note"
      className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500"
    />
  );
}
