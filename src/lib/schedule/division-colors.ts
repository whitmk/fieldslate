// Deterministic per-division colors for the week-by-field Schedule view.
//
// ── DERIVED, NEVER STORED ────────────────────────────────────────────────────
// A division's color is computed from its id every time it is needed. Nothing
// is written anywhere. Storing one in `divisions.settings` would be the obvious
// alternative and it is the wrong call: that jsonb has MANY readers and several
// writers (the wizard save writes it WHOLESALE from form state rather than
// merging the stored row — see the schedule-lock notes in CLAUDE.md), so the
// one-parser-one-writer discipline that makes jsonb extension safe does not
// hold there. A stored color would be silently dropped by the next wizard save.
// Deriving costs nothing and cannot drift.
//
// ── ASSIGNMENT ───────────────────────────────────────────────────────────────
// Hash-with-linear-probe over the SEASON's divisions:
//
//   1. Sort the season's division ids ascending — a fixed, input-order-
//      independent sequence, so the caller cannot change the result by handing
//      them over in a different order.
//   2. For each in turn, preferred slot = fnv1a(id) % PALETTE.length.
//   3. If that slot is already claimed by an earlier division, walk FORWARD
//      (wrapping) to the first free slot.
//   4. Once every slot is claimed — i.e. more divisions than colors — later
//      divisions take their preferred slot directly and COLORS REPEAT. That is
//      accepted, not an error: the division NAME is on every block, so color is
//      reinforcement and never the sole carrier. Never throw, never grey out.
//
// Plain hash-modulo without the probe collides constantly — five ids into nine
// slots collide more than half the time by the birthday bound — which is why
// the probe exists rather than being an optimisation.
//
// ── THE STABILITY GUARANTEE, STATED PLAINLY ──────────────────────────────────
// * DETERMINISTIC: the same SET of division ids always produces the same
//   assignment — across reloads, sessions, users, weeks and servers. There is
//   no randomness, no clock, no ordering dependency, no stored state. Paging to
//   a different week cannot change a color, because assignment runs over the
//   season's divisions and never over the week's.
// * ZERO COLLISIONS while `count <= PALETTE.length`: linear probing only ever
//   returns a free slot while one exists, so every division gets a distinct
//   color.
// * ADDING a division is stable for every division whose id sorts BEFORE it —
//   they are assigned before the newcomer is even considered, so nothing about
//   them can move. A division sorting AFTER the newcomer keeps its color unless
//   the newcomer claims the exact slot it was occupying, in which case it
//   shifts to the next free one. Division ids are uuids, so a new division has
//   roughly an even chance of sorting before any given existing one; with 5
//   divisions in 10 slots the contention needed to shift anything is uncommon
//   but real.
// * REMOVING a division has the mirror property: it frees a slot, which can
//   move a division that sorts after it.
// This is inherent to any collision resolution over a shared slot space, not a
// defect in this one. It is documented rather than designed away because the
// cost of a color changing is that an admin re-learns one stripe, while the
// division name — which never moves — still carries the meaning.

/**
 * Ten colors, sized with headroom over real data. A full Little League ladder
 * (Tee Ball, Farm, Minors AA, Minors AAA, Majors, 50/70, Juniors, Seniors) is
 * eight; the largest live season has FIVE divisions and none has more
 * (verified 2026-08-21).
 *
 * Mid-tone hues chosen so a 3px edge reads against BOTH a white and a dark
 * surface. NOTE: this app currently has no dark mode at all — no `darkMode` key
 * in the Tailwind config, zero `dark:` variants in `src`, no
 * `prefers-color-scheme` anywhere — so nothing exercises the dark case today.
 * The palette is picked to survive one arriving; no `dark:` variants were added
 * here, because a single component carrying them while the rest of the app has
 * none would be inconsistent and untestable.
 *
 * Literal hex, applied via inline `borderLeftColor`, NOT Tailwind class names:
 * Tailwind's JIT only emits classes it can see as complete literal strings, so
 * a computed `border-l-${color}` would compile to nothing at all — a silent
 * failure that looks exactly like "the feature didn't render".
 */
export const DIVISION_COLORS: readonly string[] = [
  "#2563EB", // blue
  "#059669", // emerald
  "#D97706", // amber
  "#E11D48", // rose
  "#7C3AED", // violet
  "#0891B2", // cyan
  "#65A30D", // lime
  "#C026D3", // fuchsia
  "#EA580C", // orange
  "#4F46E5", // indigo
];

/** The edge a CANCELLED block carries, whatever its division.
 *
 *  CANCELLED WINS. A greyed, struck-through block with a bright division stripe
 *  sends two signals at once — "this is off" and "this is Majors" — competing
 *  for the same glance. The neutral edge keeps the cancelled treatment the only
 *  thing the block is saying. */
export const CANCELLED_EDGE_COLOR = "#D1D5DB"; // gray-300

/**
 * FNV-1a, 32-bit. Chosen because it is tiny, dependency-free, and — the point —
 * FIXED: the same string yields the same number on every engine, forever. Do
 * not swap it for anything environment-dependent, and do not "improve" it: the
 * output IS the persisted assignment, so changing the hash reshuffles every
 * league's colors at once.
 */
export function hashDivisionId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    // 32-bit FNV prime multiply, via shifts to stay inside int32.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Reported by `assignDivisionColors` so a harness can prove the probe branch
 *  actually fired rather than assuming it. */
export type DivisionColorAssignment = {
  /** division id → hex color. */
  colorById: Map<string, string>;
  /** How many divisions did NOT get their preferred slot. Zero means every
   *  hash landed somewhere free and the probe was never exercised. */
  probedCount: number;
  /** How many were assigned after every slot was claimed, i.e. deliberately
   *  repeat an already-used color. Only reachable when count > palette size. */
  repeatedCount: number;
};

/**
 * Assign a color to every division in a SEASON. Pass the season's full division
 * id list — never just the ones visible in the current week, or a division's
 * color would change as the user pages.
 */
export function assignDivisionColors(
  divisionIds: readonly string[],
  palette: readonly string[] = DIVISION_COLORS,
): DivisionColorAssignment {
  const colorById = new Map<string, string>();
  let probedCount = 0;
  let repeatedCount = 0;
  if (palette.length === 0) return { colorById, probedCount, repeatedCount };

  const n = palette.length;
  const takenBySlot = new Array<boolean>(n).fill(false);
  let claimed = 0;

  // Deduped and sorted: a fixed sequence, so the caller's array order cannot
  // change the outcome.
  const ids = [...new Set(divisionIds)].sort();

  for (const id of ids) {
    const preferred = hashDivisionId(id) % n;
    if (claimed >= n) {
      // Every slot is spoken for — colors repeat by design.
      colorById.set(id, palette[preferred]);
      repeatedCount++;
      continue;
    }
    let slot = preferred;
    let probes = 0;
    while (takenBySlot[slot]) {
      slot = (slot + 1) % n;
      probes++;
    }
    if (probes > 0) probedCount++;
    takenBySlot[slot] = true;
    claimed++;
    colorById.set(id, palette[slot]);
  }

  return { colorById, probedCount, repeatedCount };
}

/** The edge color a block should render: the division's color, or the neutral
 *  cancelled edge. Single place the cancelled-wins rule is applied. */
export function blockEdgeColor(
  divisionId: string | null | undefined,
  cancelled: boolean,
  colorById: Map<string, string>,
): string {
  if (cancelled) return CANCELLED_EDGE_COLOR;
  if (!divisionId) return CANCELLED_EDGE_COLOR;
  return colorById.get(divisionId) ?? CANCELLED_EDGE_COLOR;
}
