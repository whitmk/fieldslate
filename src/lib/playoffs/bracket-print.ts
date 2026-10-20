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
import { playoffRoundLabel } from "@/lib/playoffs/playoff-result";

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

export function printHeader(leagueName: string, divisionName: string, subtitle: string, printedOn: string): string {
  return `
<div style="height:${HEADER_H - 12}px;padding-bottom:6px;border-bottom:2px solid #000;margin-bottom:12px;display:flex;align-items:flex-end;justify-content:space-between">
  <div>
    <div style="font-size:16pt;font-weight:800;color:#0c1f3f;letter-spacing:-0.3pt;line-height:1">Field<span style="color:#15803d">Slate</span></div>
    <div style="font-size:12pt;font-weight:700;color:#000;margin-top:6px">${escapeHtml(leagueName)} — ${escapeHtml(divisionName)} ${escapeHtml(subtitle)}</div>
  </div>
  <div style="font-size:9pt;color:${PRINT_COLORS.meta}">Printed ${escapeHtml(printedOn)}</div>
</div>`;
}

// ─── One game card ────────────────────────────────────────────────────────────

export function gameCardHtml(game: PrintGame, allGames: PrintGame[], format: string): string {
  const done = game.status === "completed";
  const row = (side: Side) => {
    const teamId = side === "home" ? game.home_team_id : game.away_team_id;
    const name = slotName(side === "home" ? game.home_team_name : game.away_team_name, game, side, allGames, format);
    const score = side === "home" ? game.home_score : game.away_score;
    const won = slotWon(game.winner_id, teamId);
    const nameSt = !teamId
      ? `color:${PRINT_COLORS.placeholder};font-style:italic`
      : won ? `color:${PRINT_COLORS.winText};font-weight:700` : `color:${PRINT_COLORS.text}`;
    const bg = side === "away" ? `background:${PRINT_COLORS.awayRowBg};${KEEP_BG}` : "background:white;";
    return `<div data-row="${side}" style="height:${CARD.rowH}px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;gap:6px;${bg}">
      <span style="font-size:10pt;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${nameSt}">${escapeHtml(name)}</span>
      <span style="display:flex;align-items:center;gap:4px;flex:none">${done && score != null ? `<span style="font-size:10pt;font-weight:700;color:${won ? PRINT_COLORS.winText : PRINT_COLORS.meta}">${score}</span>` : ""}${won ? TROPHY_SVG : ""}</span>
    </div>`;
  };
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

  // Fit the page; a small bracket (under 60% of the page's height — 8 teams
  // and fewer) is scaled UP to fill it, capped so 10pt team names stay ≤ 14pt.
  const fit = Math.min(PAGE.width / width, CANVAS_H / height);
  const scale = height < SCALE_UP_BELOW * CANVAS_H ? Math.min(fit, MAX_SCALE) : Math.min(1, fit);
  return { rounds, cards, connectors, width, height, scale };
}

export function buildBracketPrintHtml(
  games: PrintGame[],
  format: string,
  leagueName: string,
  divisionName: string,
  printedOn: string,
): string {
  const header = printHeader(leagueName, divisionName, "Playoff Bracket", printedOn);
  if (!games.length) return `${header}<p>No games yet.</p>`;
  if (format !== "single_elimination") return header + columnsHtml(games, format);

  const L = singleElimLayout(games);
  const heads = L.rounds.map((r, k) =>
    `<div style="position:absolute;top:0;left:${k * (CARD.width + GAP)}px;width:${CARD.width}px;text-align:center;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.6pt;color:${PRINT_COLORS.heading}">${escapeHtml(playoffRoundLabel(r))}</div>`,
  ).join("");
  const lines = L.connectors.map((c) =>
    `<polyline data-from="${c.from}" data-to="${c.to}" points="${c.points.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="${PRINT_COLORS.line}" stroke-width="1.5"/>`,
  ).join("");
  const cards = L.cards.map((c) =>
    `<div style="position:absolute;left:${c.x}px;top:${c.y}px">${gameCardHtml(c.game, games, format)}</div>`,
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
