// The printable playoff bracket — pure HTML builders, no React, no DOM, no
// clock (the "Printed …" date is passed in). The export modal opens the result
// in a print window; scripts/sim/bracket-print-render.ts writes the same
// documents to files for proof and for the Safari check.
//
// SINGLE ELIMINATION is drawn as a tree, laid out by BRACKET POSITION
// (singleElimPosition — the numbering advancement uses), never by a game's
// index in its round's list of rows. With byes, round 1 is short: its games
// keep their positions, so each sits beside the round-2 slot it feeds and a
// bye leaves a gap. Every connector comes from singleElimTarget — the same
// rule that moves the winner — into the exact slot (home or away) it fills.
//
// PAGE: US Letter LANDSCAPE, 0.35in margins. The tree is drawn at a natural
// size and scaled to the page: 9–16 teams print at full size (scale 1); 8
// teams and fewer use under 60% of the height, so they are scaled UP to fill
// the page, capped at 1.4× (10pt team names → at most 14pt); 17–32 teams
// scale DOWN to about 57% on ONE page (team names ~5–6pt). Above 32 it keeps
// shrinking; that size is not supported for printing. All asserted by
// sim:bracket-print [P4].
//
// CARD: a two-tone card — the home row white, the away row a light field
// green kept in print by print-color-adjust (no "Print backgrounds" needed in
// Safari). Row colour NEVER marks a winner; the winner is bold text + a
// trophy.
//
// SERIES (0114, approved sketch 2026-10-20): each series is a GROUP — a light
// dashed outline with a header line ("Semifinal 1 · best of 3" left, where the
// series stands right) holding one full game card per game, stacked: the
// single game's card with "Game 2 of 3 · date · time" over the field, both
// team rows with the score, trophy + bold on the winner, the green second
// row. If-needed games say so in their header; not-needed games are greyed
// and struck through. A header never truncates: it wraps. Heights are
// ESTIMATED from the text (groupHeight, conservative) to size the slots; each
// group is placed by its true vertical middle (top: centre;
// translateY(-50%)), which is where its connectors leave and enter, so a
// header that wraps further than estimated can't misplace a line. Single-game
// rounds keep their card; a bracket with no series prints exactly as before.
//
// ROUND ROBIN and DOUBLE ELIMINATION print as columns per round (cards in
// normal flow, columns wrap onto further rows and pages). Double elimination
// has no tree drawing — reported, not redesigned (2026-10-13).
//
// COLOURS are chosen for a home printer and checked against white by the sim
// (WCAG ratio): text and labels ≥ 7:1, lines and borders ≥ 4.5:1.

import {
  getRoundOrder,
  singleElimPosition,
  singleElimTarget,
} from "@/lib/playoffs/advancement";
import { gameWhen, slotName, slotWon, type Side } from "@/lib/playoffs/bracket-labels";
import { playoffRoundLabel, playoffRoundTitle } from "@/lib/playoffs/playoff-result";
import {
  oneRowPerSeries,
  SERIES_TAG_TEXT,
  seriesGameHeader,
  seriesGamesOf,
  seriesGroupTitle,
  seriesHeadline,
  seriesPrintLine,
  seriesRoundHeader,
} from "@/lib/playoffs/series";
import { isSeriesGame, seriesName } from "@/lib/playoffs/series-names";

export interface PrintGame {
  id: string;
  round: string;
  game_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  winner_id: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  scheduled_date: string | null;
  start_time: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  venue_name: string | null;
  /** 0114: which game of its series (1..length); absent or 1 for a single game. */
  series_game?: number;
}

export const PRINT_COLORS = {
  text: "#111827",
  heading: "#1f2937",
  meta: "#374151",
  placeholder: "#374151",
  line: "#4b5563",
  border: "#6b7280",
  winText: "#0c1f3f",
  /** The AWAY (second) row's background — a two-tone card, nothing more. It
   *  never marks a winner: the winner is bold text + a trophy, in any row. */
  awayRowBg: "#e6f4ea",
  /** A series game's "If needed" in its header (0114). */
  ifNeeded: "#92400e",
};

/** Keeps a background in print without "Print backgrounds" (Safari). */
const KEEP_BG = "-webkit-print-color-adjust:exact;print-color-adjust:exact;";

/** A small trophy for the winner's row (inline SVG — prints in every engine,
 *  unlike an emoji). */
const TROPHY_SVG = `<svg data-trophy width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${"#0c1f3f"}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`;

// Page box in CSS px (96/in): 11in × 8.5in less 0.35in margins.
export const PAGE = { width: Math.floor(10.3 * 96), height: Math.floor(7.8 * 96) };
const HEADER_H = 76;   // the print header's height incl. its bottom margin
const CANVAS_H = PAGE.height - HEADER_H;
export const SCALE_UP_BELOW = 0.6;   // of the canvas height
export const MAX_SCALE = 14 / 10;    // team names are 10pt; never above 14pt

export const CARD = { width: 210, metaH: 26, rowH: 22 };
export const CARD_H = 1 + CARD.metaH + CARD.rowH + 1 + CARD.rowH + 1;
const GAP = 44;          // between columns
const SLOT_H = 81;       // vertical room per round-1 position
const ROUND_HDR = 20;    // column heading row

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The whole print document. The bracket prints landscape; the schedule
 *  table keeps portrait. */
export function printDocument(body: string, title: string, orientation: "landscape" | "portrait"): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: white; color: ${PRINT_COLORS.text}; }
    @media screen { body { margin: 0.35in; } }
    @page { margin: 0.35in; size: letter ${orientation}; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function printHeader(
  leagueName: string,
  divisionName: string,
  subtitle: string,
  printedOn: string,
  note: string | null = null,
): string {
  return `
<div style="height:${HEADER_H - 12}px;padding-bottom:6px;border-bottom:2px solid #000;margin-bottom:12px;display:flex;align-items:flex-end;justify-content:space-between">
  <div>
    <div style="font-size:16pt;font-weight:800;color:#0c1f3f;letter-spacing:-0.3pt;line-height:1">Field<span style="color:#15803d">Slate</span></div>
    <div style="font-size:12pt;font-weight:700;color:#000;margin-top:6px">${escapeHtml(leagueName)} — ${escapeHtml(divisionName)} ${escapeHtml(subtitle)}</div>
  </div>
  ${note
    ? `<div style="font-size:9pt;color:${PRINT_COLORS.meta};text-align:right"><div data-series-line style="font-weight:700;margin-bottom:4px">${escapeHtml(note)}</div>Printed ${escapeHtml(printedOn)}</div>`
    : `<div style="font-size:9pt;color:${PRINT_COLORS.meta}">Printed ${escapeHtml(printedOn)}</div>`}
</div>`;
}

// ─── One game card ────────────────────────────────────────────────────────────

/** One team row of a game card — the single card's and a series game card's.
 *  `struck` (a not-needed series game) strikes the name through. */
function teamRowHtml(game: PrintGame, side: Side, allGames: PrintGame[], format: string, struck = false): string {
  const done = game.status === "completed";
  const teamId = side === "home" ? game.home_team_id : game.away_team_id;
  const name = slotName(side === "home" ? game.home_team_name : game.away_team_name, game, side, allGames, format);
  const score = side === "home" ? game.home_score : game.away_score;
  const won = slotWon(game.winner_id, teamId);
  const nameSt = (!teamId
    ? `color:${PRINT_COLORS.placeholder};font-style:italic`
    : won ? `color:${PRINT_COLORS.winText};font-weight:700` : `color:${PRINT_COLORS.text}`) + (struck ? ";text-decoration:line-through" : "");
  const bg = side === "away" ? `background:${PRINT_COLORS.awayRowBg};${KEEP_BG}` : "background:white;";
  return `<div data-row="${side}" style="height:${CARD.rowH}px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;gap:6px;${bg}">
      <span style="font-size:10pt;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${nameSt}">${escapeHtml(name)}</span>
      <span style="display:flex;align-items:center;gap:4px;flex:none">${done && score != null ? `<span style="font-size:10pt;font-weight:700;color:${won ? PRINT_COLORS.winText : PRINT_COLORS.meta}">${score}</span>` : ""}${won ? TROPHY_SVG : ""}</span>
    </div>`;
}

export function gameCardHtml(game: PrintGame, allGames: PrintGame[], format: string): string {
  const row = (side: Side) => teamRowHtml(game, side, allGames, format);
  const when = gameWhen(game, allGames, game.scheduled_date, game.start_time);
  const field = game.scheduled_date && game.venue_name ? game.venue_name : "";
  return `<div data-game="${game.game_number}" style="width:${CARD.width}px;height:${CARD_H}px;border:1px solid ${PRINT_COLORS.border};border-radius:5px;overflow:hidden;background:white">
    <div style="height:${CARD.metaH}px;padding:1px 7px 0;font-size:7.5pt;line-height:12px;color:${PRINT_COLORS.meta};border-bottom:1px solid ${PRINT_COLORS.border}">
      <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700">${escapeHtml(when)}</div>
      <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(field)}</div>
    </div>
    ${row("home")}
    <div style="height:1px;background:${PRINT_COLORS.border}"></div>
    ${row("away")}
  </div>`;
}

// ─── One series group (0114) ──────────────────────────────────────────────────

/** One game of a series: the single game's card, with "Game 2 of 3 · date ·
 *  time" (and "If needed") over the field — both lines WRAP, never truncate. */
function seriesGameCardHtml(g: PrintGame, series: PrintGame[], allGames: PrintGame[]): string {
  const h = seriesGameHeader(g, series);
  const struck = h.notNeeded ? "text-decoration:line-through;" : "";
  const field = g.scheduled_date && g.venue_name ? g.venue_name : "";
  return `<div data-series-game="${g.series_game ?? 1}" data-tag="${h.tag}" style="border:1px solid ${PRINT_COLORS.border};border-radius:5px;overflow:hidden;background:white;${h.notNeeded ? "opacity:0.5;" : ""}">
      <div style="min-height:${CARD.metaH}px;padding:1px 7px 2px;font-size:7.5pt;line-height:12px;color:${PRINT_COLORS.meta};border-bottom:1px solid ${PRINT_COLORS.border}">
        <div style="font-weight:700;overflow-wrap:anywhere;${struck}">${escapeHtml(h.when)}${h.ifNeeded ? ` · <span data-if-needed style="color:${PRINT_COLORS.ifNeeded};white-space:nowrap">${escapeHtml(SERIES_TAG_TEXT.if_needed)}</span>` : ""}</div>
        <div style="overflow-wrap:anywhere;${struck}">${escapeHtml(field)}</div>
      </div>
      ${teamRowHtml(g, "home", allGames, "single_elimination", h.notNeeded)}
      <div style="height:1px;background:${PRINT_COLORS.border}"></div>
      ${teamRowHtml(g, "away", allGames, "single_elimination", h.notNeeded)}
    </div>`;
}

/** A series group: the dashed outline, its header line, one card per game. */
export function seriesGroupHtml(first: PrintGame, allGames: PrintGame[]): string {
  const games = seriesGamesOf(first, allGames);
  const names = teamNames(allGames);
  const head = seriesHeadline(games, (id) => names.get(id) ?? "TBD");
  const cards = games.map((g, i) =>
    `<div style="${i ? `margin-top:${PRINT_GROUP.cardGap}px` : ""}">${seriesGameCardHtml(g, games, allGames)}</div>`).join("");
  return `<div data-series="${escapeHtml(seriesName(first, allGames))}" style="width:${CARD.width}px;border:${PRINT_GROUP.border}px dashed ${PRINT_COLORS.border};border-radius:7px;padding:${PRINT_GROUP.pad}px;background:white">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;column-gap:6px;font-size:7.5pt;line-height:${PRINT_GROUP.headerLineH}px;color:${PRINT_COLORS.meta};margin-bottom:${PRINT_GROUP.headerGap}px">
      <span style="font-weight:700;color:${PRINT_COLORS.text}">${escapeHtml(seriesGroupTitle(first, allGames))}</span>
      <span data-series-state>${escapeHtml(head.text)}</span>
    </div>
    ${cards}
  </div>`;
}

function teamNames(games: PrintGame[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const g of games) {
    if (g.home_team_id && g.home_team_name) names.set(g.home_team_id, g.home_team_name);
    if (g.away_team_id && g.away_team_name) names.set(g.away_team_id, g.away_team_name);
  }
  return names;
}

// ─── Series group geometry (print and screen) ─────────────────────────────────

/** The numbers a series group is ESTIMATED with. Text width comes from
 *  `textWidth` (Arial advance widths, bold widened) times `safety`; a line
 *  wraps past `textW` (the card's text width) or `headerW` (the group's header
 *  line). Over-estimating a wrap only adds room — the group is centred on its
 *  true middle either way; under-estimating eats into GROUP_MARGIN. Measured
 *  in Chrome against the real heights (sim log). */
export type GroupDims = {
  border: number;
  pad: number;
  headerLineH: number;
  headerGap: number;
  cardGap: number;
  /** Font size (px) of a card's header text and of the group's header line. */
  fontPx: number;
  headerFontPx: number;
  /** Text width (px) inside a card, and across the group's header line (its
   *  right side's chip padding included in `headerExtra`). */
  textW: number;
  headerW: number;
  headerExtra: number;
  safety: number;
  /** A game card: borders + header band (min, line height, padding) + rows. */
  cardBorders: number;
  metaMinH: number;
  metaLineH: number;
  metaPadY: number;
  rowsH: number;
  /** Screen only: the action row, the daylight chip below a card, the Final's banner. */
  footH: number;
  flagH: number;
  bannerH: number;
};

/** The printed group (seriesGroupHtml). Cards are 210 − 2×6 = 198px wide. */
export const PRINT_GROUP: GroupDims = {
  border: 1, pad: 5, headerLineH: 11, headerGap: 4, cardGap: 6,
  fontPx: 10, headerFontPx: 10, textW: 198 - 2 - 14, headerW: 198, headerExtra: 6, safety: 1.08,
  cardBorders: 2, metaMinH: CARD.metaH, metaLineH: 12, metaPadY: 4, rowsH: 2 * CARD.rowH + 1,
  footH: 0, flagH: 0, bannerH: 0,
};

/** The on-screen group (series-card.tsx SeriesGroup). Cards are 200 − 2×7 =
 *  186px wide: header band min h-10 (16px lines, py-1 + border), rows h-8 +
 *  h-px + h-8, action row h-8; a daylight chip below a card (mt-1 + chip); the
 *  Final's banner (mt-1.5 + py-1). */
export const SCREEN_GROUP: GroupDims = {
  border: 1, pad: 6, headerLineH: 18, headerGap: 6, cardGap: 8,
  fontPx: 10, headerFontPx: 11, textW: 186 - 2 - 20, headerW: 186, headerExtra: 8 + 12, safety: 1.15,
  cardBorders: 2, metaMinH: 40, metaLineH: 16, metaPadY: 9, rowsH: 65,
  footH: 32, flagH: 26, bannerH: 30,
};

// Arial advance widths in 1/1000 em (regular). Anything not listed counts as
// a wide letter. Bold is taken as 1.08× regular.
const ADVANCE: Record<string, number> = { " ": 278, "·": 278, ".": 278, ",": 278, ":": 278, "/": 278, "-": 333, "–": 556,
  "—": 1000, "(": 333, ")": 333, "@": 1015, "&": 667, "'": 191, "#": 556, i: 222, j: 222, l: 222, f: 278, t: 278, r: 333,
  I: 278, J: 500, m: 833, w: 722, M: 833, W: 944, c: 500, k: 500, s: 500, v: 500, x: 500, y: 500, z: 500 };
const LOWER = 556;
const UPPER = 722;

/** A text's width in px at `fontPx` (an Arial estimate). */
export function textWidth(text: string, fontPx: number, bold = false): number {
  let units = 0;
  for (const ch of text) {
    units += ADVANCE[ch] ?? (/[a-z0-9]/.test(ch) ? LOWER : /[A-Z]/.test(ch) ? (ch === "T" || ch === "F" || ch === "L" ? 611 : UPPER) : UPPER);
  }
  return (units / 1000) * fontPx * (bold ? 1.08 : 1);
}

/** Lines a text takes in `widthPx` (at least one): its words laid out greedily. */
export function lineCount(text: string, fontPx: number, widthPx: number, bold = false, safety = 1): number {
  const space = textWidth(" ", fontPx, bold) * safety;
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ").filter(Boolean)) {
    const w = textWidth(word, fontPx, bold) * safety;
    if (used > 0 && used + space + w > widthPx) {
      lines++;
      used = 0;
    }
    if (w > widthPx) {
      // A word longer than the line breaks anywhere (overflow-wrap: anywhere).
      lines += Math.ceil(w / widthPx) - 1;
      used = w % widthPx;
    } else {
      used += (used > 0 ? space : 0) + w;
    }
  }
  return lines;
}

export type GroupCardText = { when: string; field: string; flagged?: boolean };

/** One game card's estimated height. */
export function groupCardHeight(D: GroupDims, c: GroupCardText): number {
  const meta = Math.max(
    D.metaMinH,
    (lineCount(c.when, D.fontPx, D.textW, true, D.safety) + lineCount(c.field || " ", D.fontPx, D.textW, false, D.safety)) * D.metaLineH
      + D.metaPadY,
  );
  return D.cardBorders + meta + D.rowsH + D.footH + (c.flagged ? D.flagH : 0);
}

/** A series group's estimated height: outline, padding, the header line (it
 *  wraps when the name and the state don't fit), the cards and their gaps,
 *  and the Final's banner on screen. */
export function groupHeight(D: GroupDims, title: string, state: string, cards: GroupCardText[], banner = false): number {
  const one = (textWidth(title, D.headerFontPx, true) + textWidth(state, D.headerFontPx - 1, true)) * D.safety + D.headerExtra <= D.headerW;
  const header = (one ? 1 : lineCount(title, D.headerFontPx, D.headerW, true, D.safety) + 1) * D.headerLineH;
  const body = cards.reduce((sum, c) => sum + groupCardHeight(D, c), 0) + Math.max(0, cards.length - 1) * D.cardGap;
  return 2 * D.border + 2 * D.pad + header + D.headerGap + body + (banner ? D.bannerH : 0);
}

/** The texts of a series' cards, as both groups render them. */
export function groupCardTexts<G extends PrintGame>(series: G[]): GroupCardText[] {
  return series.map((g) => {
    const h = seriesGameHeader(g, series);
    return {
      when: h.ifNeeded ? `${h.when} · ${SERIES_TAG_TEXT.if_needed}` : h.when,
      field: g.scheduled_date && g.venue_name ? g.venue_name : "",
    };
  });
}

// ─── Single-elimination tree layout ───────────────────────────────────────────

export type PlacedCard<G extends PrintGame = PrintGame> = { game: G; round: number; pos: number; x: number; y: number };
export type Connector = { from: number; to: number; side: "home_team_id" | "away_team_id"; points: [number, number][] };
export type TreeLayout<G extends PrintGame = PrintGame> = {
  rounds: string[];
  cards: PlacedCard<G>[];
  connectors: Connector[];
  width: number;
  height: number;
  /** Print only: the page-fit scale. The screen ignores it (it scrolls). */
  scale: number;
};

/** The geometry a tree is laid out with. The SAME layout serves the print and
 *  the on-screen bracket; only these numbers differ. `rowTop` is where the
 *  home row starts inside a card, `sourceY` where a card's outgoing line
 *  leaves it — both measured from the card's top edge. */
export type TreeDims = {
  cardW: number;
  cardH: number;
  gap: number;
  slotH: number;
  roundHdr: number;
  rowTop: number;
  rowH: number;
  divider: number;
  sourceY: number;
};

export const PRINT_TREE: TreeDims = {
  cardW: CARD.width, cardH: CARD_H, gap: GAP, slotH: SLOT_H, roundHdr: ROUND_HDR,
  rowTop: 1 + CARD.metaH, rowH: CARD.rowH, divider: 1, sourceY: CARD_H / 2,
};

/** The on-screen card (bracket-view.tsx GameCard). These numbers ARE its
 *  Tailwind heights — keep them in step: 1px border + h-10 when/where band
 *  (40) → rows h-8 (32) + h-px divider + h-8 (32) → h-8 action row (32) +
 *  1px border = 139. Lines leave at the divider between the two rows. */
export const SCREEN_TREE: TreeDims = {
  cardW: 200, cardH: 139, gap: 56, slotH: 156, roundHdr: 22,
  rowTop: 41, rowH: 32, divider: 1, sourceY: 41 + 32 + 0.5,
};

/** The public bracket page's card (bracket-pieces GameCard with no callbacks):
 *  SCREEN_TREE without the h-8 action row — the rows and their lines sit
 *  exactly where they do on the admin card, and the 17px gap below a card is
 *  kept (slotH − cardH). */
export const PUBLIC_TREE: TreeDims = {
  ...SCREEN_TREE,
  cardH: SCREEN_TREE.cardH - 32,
  slotH: SCREEN_TREE.slotH - 32,
};

/** The public page's series group: no action row under a card and no
 *  daylight chip. */
export const PUBLIC_GROUP: GroupDims = { ...SCREEN_GROUP, footH: 0, flagH: 0 };

/** Room kept between two series groups (or a group and a card) in a column. */
export const GROUP_MARGIN = 10;

export type PlacedItem<G extends PrintGame = PrintGame> = PlacedCard<G> & {
  /** A series group (true) or a single game card. */
  group: boolean;
  /** Estimated height; a group's real height may differ — it is placed by its middle. */
  h: number;
  /** The slot's centre: a group's middle sits here, and its lines leave and enter here. */
  centre: number;
};

/** The tree for a bracket with a series round: one item per series (a group)
 *  or single game (a card). Every slot grows only as far as some round's
 *  tallest item needs — round k has 2^k round-1 slots of room per item. A
 *  group's lines leave and enter at its vertical middle; a single card's leave
 *  at `D.sourceY` and enter at the team row it fills, as in every tree. */
export function groupedTreeLayout<G extends PrintGame>(
  games: G[],
  D: TreeDims,
  groupH: (first: G, series: G[]) => number,
): TreeLayout<G> & { items: PlacedItem<G>[] } {
  const rows = oneRowPerSeries(games);
  const rounds = sortedRounds(rows);
  const n = rounds.length;
  const size = Math.pow(2, n);
  const isGroup = (g: G) => isSeriesGame(g, games);
  const heightOf = (g: G) => (isGroup(g) ? groupH(g, seriesGamesOf(g, games)) : D.cardH);
  const tallest = rounds.map((r) => Math.max(...rows.filter((g) => g.round === r).map(heightOf)));
  const slotH = Math.max(D.slotH, ...tallest.map((h, k) => (h + GROUP_MARGIN) / Math.pow(2, k)));
  const width = n * D.cardW + Math.max(0, n - 1) * D.gap;
  const height = D.roundHdr + (size / 2) * slotH;

  const items: PlacedItem<G>[] = [];
  const byId = new Map<string, PlacedItem<G>>();
  rounds.forEach((round, k) => {
    const inRound = rows.filter((g) => g.round === round).sort((a, b) => a.game_number - b.game_number);
    for (const g of inRound) {
      const pos = singleElimPosition(g, k, size, inRound);
      const centre = D.roundHdr + (pos + 0.5) * slotH * Math.pow(2, k);
      const h = heightOf(g);
      const item = { game: g, round: k, pos, x: k * (D.cardW + D.gap), y: centre - h / 2, group: isGroup(g), h, centre };
      items.push(item);
      byId.set(g.id, item);
    }
  });

  const entryY = (to: PlacedItem<G>, side: "home_team_id" | "away_team_id") =>
    to.group ? to.centre : to.y + D.rowTop + (side === "home_team_id" ? D.rowH / 2 : D.rowH + D.divider + D.rowH / 2);

  const connectors: Connector[] = [];
  for (const c of items) {
    const t = singleElimTarget(c.game, rows);
    if (!t) continue;
    const to = byId.get(t.target.id);
    if (!to) continue;
    const x1 = c.x + D.cardW;
    const y1 = c.group ? c.centre : c.y + D.sourceY;
    const xm = x1 + D.gap / 2;
    const y2 = entryY(to, t.field);
    connectors.push({ from: c.game.game_number, to: to.game.game_number, side: t.field, points: [[x1, y1], [xm, y1], [xm, y2], [to.x, y2]] });
  }

  return { rounds, cards: items, items, connectors, width, height, scale: pageScale(width, height) };
}

/** The printed tree's item heights: a group by groupHeight(PRINT_GROUP). */
export function printGroupHeight<G extends PrintGame>(first: G, series: G[], bracket: G[]): number {
  const names = teamNames(bracket);
  return groupHeight(PRINT_GROUP, seriesGroupTitle(first, bracket), seriesHeadline(series, (id) => names.get(id) ?? "TBD").text, groupCardTexts(series));
}

/** The printed tree for a bracket with a series round. Single cards are the
 *  print's own (CARD_H), their lines leaving at the divider between the rows. */
export const PRINT_SERIES_TREE: TreeDims = { ...PRINT_TREE, sourceY: 1 + CARD.metaH + CARD.rowH + 0.5 };

function sortedRounds(games: PrintGame[]): string[] {
  return [...new Set(games.map((g) => g.round))].sort((a, b) => getRoundOrder(a) - getRoundOrder(b));
}

/** Where every card and line goes, in natural (unscaled) px. */
export function singleElimLayout<G extends PrintGame>(games: G[], dims: TreeDims = PRINT_TREE): TreeLayout<G> {
  const D = dims;
  const rounds = sortedRounds(games);
  const n = rounds.length;
  const size = Math.pow(2, n);
  const width = n * D.cardW + Math.max(0, n - 1) * D.gap;
  const height = D.roundHdr + (size / 2) * D.slotH;

  const cards: PlacedCard<G>[] = [];
  const byId = new Map<string, PlacedCard<G>>();
  rounds.forEach((round, k) => {
    const inRound = games.filter((g) => g.round === round).sort((a, b) => a.game_number - b.game_number);
    for (const g of inRound) {
      const pos = singleElimPosition(g, k, size, inRound);
      const centre = D.roundHdr + (pos + 0.5) * D.slotH * Math.pow(2, k);
      const card = { game: g, round: k, pos, x: k * (D.cardW + D.gap), y: centre - D.cardH / 2 };
      cards.push(card);
      byId.set(g.id, card);
    }
  });

  const rowCentre = (c: PlacedCard<G>, side: "home_team_id" | "away_team_id") =>
    c.y + D.rowTop + (side === "home_team_id" ? D.rowH / 2 : D.rowH + D.divider + D.rowH / 2);

  const connectors: Connector[] = [];
  for (const c of cards) {
    const t = singleElimTarget(c.game, games);
    if (!t) continue;
    const to = byId.get(t.target.id);
    if (!to) continue;
    const x1 = c.x + D.cardW;
    const y1 = c.y + D.sourceY;
    const xm = x1 + D.gap / 2;
    const y2 = rowCentre(to, t.field);
    connectors.push({
      from: c.game.game_number,
      to: to.game.game_number,
      side: t.field,
      points: [[x1, y1], [xm, y1], [xm, y2], [to.x, y2]],
    });
  }

  return { rounds, cards, connectors, width, height, scale: pageScale(width, height) };
}

/** Fit the page; a small bracket (under 60% of the page's height — 8 teams
 *  and fewer) is scaled UP to fill it, capped so 10pt team names stay ≤ 14pt.
 *  One rule for every tree, with or without a series. */
export function pageScale(width: number, height: number): number {
  const fit = Math.min(PAGE.width / width, CANVAS_H / height);
  const scale = height < SCALE_UP_BELOW * CANVAS_H ? Math.min(fit, MAX_SCALE) : Math.min(1, fit);
  return scale;
}

export function buildBracketPrintHtml(
  games: PrintGame[],
  format: string,
  leagueName: string,
  divisionName: string,
  printedOn: string,
): string {
  const seriesLine = format === "single_elimination" ? seriesPrintLine(games) : null;
  const header = printHeader(leagueName, divisionName, "Playoff Bracket", printedOn, seriesLine);
  if (!games.length) return `${header}<p>No games yet.</p>`;
  if (format !== "single_elimination") return header + columnsHtml(games, format);

  // A bracket with a series lays out one item per series — a group of stacked
  // game cards, placed by its middle (groupedTreeLayout).
  const withSeries = seriesLine !== null;
  const L = withSeries
    ? groupedTreeLayout(games, PRINT_SERIES_TREE, (first, series) => printGroupHeight(first, series, games))
    : singleElimLayout(games);
  const heads = L.rounds.map((r, k) =>
    `<div style="position:absolute;top:0;left:${k * (CARD.width + GAP)}px;width:${CARD.width}px;text-align:center;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.6pt;color:${PRINT_COLORS.heading}">${escapeHtml(withSeries ? seriesRoundHeader(r, games) : playoffRoundTitle(r, games))}</div>`,
  ).join("");
  const lines = L.connectors.map((c) =>
    `<polyline data-from="${c.from}" data-to="${c.to}" points="${c.points.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="${PRINT_COLORS.line}" stroke-width="1.5"/>`,
  ).join("");
  const cards = L.cards.map((c) =>
    withSeries && isSeriesGame(c.game, games)
      ? `<div style="position:absolute;left:${c.x}px;top:${(c as PlacedItem).centre}px;transform:translateY(-50%)">${seriesGroupHtml(c.game, games)}</div>`
      : `<div style="position:absolute;left:${c.x}px;top:${c.y}px">${gameCardHtml(c.game, games, format)}</div>`,
  ).join("");
  return `${header}
<div style="width:${Math.ceil(L.width * L.scale)}px;height:${Math.ceil(L.height * L.scale)}px;overflow:hidden">
  <div data-scale="${L.scale.toFixed(3)}" style="position:relative;width:${L.width}px;height:${L.height}px;transform:scale(${L.scale});transform-origin:top left">
    <svg width="${L.width}" height="${L.height}" style="position:absolute;top:0;left:0">${lines}</svg>
    ${heads}
    ${cards}
  </div>
</div>`;
}

// ─── Columns (round robin, double elimination) ────────────────────────────────

function columnsHtml(games: PrintGame[], format: string): string {
  const cols = sortedRounds(games).map((round) => {
    const cards = games
      .filter((g) => g.round === round)
      .sort((a, b) => a.game_number - b.game_number)
      .map((g) => `<div style="margin-bottom:10px;break-inside:avoid">${gameCardHtml(g, games, format)}</div>`)
      .join("");
    return `<div style="width:${CARD.width}px">
      <div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.6pt;color:${PRINT_COLORS.heading};text-align:center;margin-bottom:8px">${escapeHtml(playoffRoundLabel(round))}</div>
      ${cards}
    </div>`;
  }).join("");
  return `<div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">${cols}</div>`;
}
