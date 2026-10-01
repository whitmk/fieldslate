// Homepage "How FieldSlate compares" — the ONE source of the rows, the
// columns and every yes/partial/no value. The section component renders this
// and holds no copy of it.
//
// EVERY VALUE IS POSITIONAL: a column lists exactly one value per row, in row
// order. `validate()` below runs when this module is first imported — during
// `next build`'s static prerender of the homepage — and THROWS on a column
// whose length does not match the row count or a value outside the three
// allowed strings, so a mis-edited column fails the build instead of silently
// shifting every mark below the edit. Same fail-loud rule as the blog FAQ
// frontmatter (src/lib/blog.ts).
//
// NO PRICES for competitors live here or anywhere in the section: those
// figures came from third-party review sites and are not verified. Only
// FieldSlate's own price line is shown, and it is written in the component.
//
// This file holds STRINGS AND VALUES ONLY — no class names. Tailwind's
// content globs do not scan src/lib, so a class written here would compile to
// nothing.

export type CompareValue = "yes" | "partial" | "no";

export const COMPARE_VALUES: readonly CompareValue[] = ["yes", "partial", "no"];

/** Feature rows, in display order. Rows from PAIRS_WITH_PLATFORM_FROM on sit
 *  under the "Pairs with your registration platform" divider. */
export const COMPARE_ROWS = [
  "Interleague agreement workflow",
  "Rainout and reschedule workflow",
  "Field conflict detection",
  "Game schedule generation",
  "Umpire assignments",
  "Umpire pay tracking and report",
  "Snack shack rotation across teams",
  "Playoff brackets",
  "Parent calendar feed or app",
  "Paying umpires (direct deposit, 1099)",
  "Registration and payments",
  "League website",
  "Background checks",
] as const;

/** 0-based index of the first row under the divider (row 10 of 13). */
export const PAIRS_WITH_PLATFORM_FROM = 9;

export type CompareColumn = {
  name: string;
  /** One value per COMPARE_ROWS entry, in row order. */
  values: readonly CompareValue[];
};

export const FIELDSLATE: CompareColumn = {
  name: "FieldSlate",
  values: [
    "yes", "yes", "yes", "yes", "yes",
    "yes", "yes", "yes", "yes", "no",
    "no", "no", "no",
  ],
};

/** The competitor dropdown's options, in display order. */
export const COMPETITORS: readonly CompareColumn[] = [
  {
    name: "PlayMetrics",
    values: [
      "no", "partial", "yes", "yes", "no",
      "no", "partial", "yes", "yes", "no",
      "yes", "yes", "yes",
    ],
  },
  {
    name: "SportsEngine",
    values: [
      "no", "partial", "partial", "yes", "no",
      "no", "partial", "yes", "yes", "no",
      "yes", "yes", "yes",
    ],
  },
  {
    name: "TeamSnap",
    values: [
      "no", "partial", "no", "partial", "no",
      "no", "partial", "no", "yes", "no",
      "yes", "partial", "no",
    ],
  },
  {
    name: "LeagueApps",
    values: [
      "no", "partial", "partial", "yes", "no",
      "no", "no", "no", "yes", "no",
      "yes", "yes", "no",
    ],
  },
  {
    name: "TeamLinkt",
    values: [
      "no", "no", "no", "yes", "yes",
      "yes", "no", "yes", "yes", "no",
      "yes", "yes", "no",
    ],
  },
  {
    name: "Jersey Watch",
    values: [
      "no", "no", "no", "partial", "no",
      "no", "no", "no", "no", "no",
      "yes", "yes", "yes",
    ],
  },
  {
    name: "TeamSideline",
    values: [
      "no", "no", "partial", "yes", "no",
      "no", "no", "no", "partial", "no",
      "yes", "yes", "yes",
    ],
  },
  {
    name: "Diamond Scheduler",
    values: [
      "partial", "partial", "yes", "yes", "no",
      "no", "no", "yes", "partial", "no",
      "partial", "partial", "no",
    ],
  },
  {
    name: "LeagueLobster",
    values: [
      "no", "no", "partial", "yes", "partial",
      "no", "no", "yes", "partial", "no",
      "yes", "no", "no",
    ],
  },
  {
    name: "Assignr",
    values: [
      "no", "no", "no", "no", "yes",
      "yes", "no", "no", "no", "yes",
      "no", "no", "no",
    ],
  },
];

export const DEFAULT_COMPETITOR = "PlayMetrics";

/** Fails the build on a shape error. Runs on import — see the header. */
function validate(): void {
  const names = new Set<string>();
  for (const col of [FIELDSLATE, ...COMPETITORS]) {
    if (col.values.length !== COMPARE_ROWS.length) {
      throw new Error(
        `compare-data: "${col.name}" lists ${col.values.length} values but there are ${COMPARE_ROWS.length} rows — ` +
          `every column must give exactly one value per row, in row order (a short column shifts every mark below the gap).`,
      );
    }
    col.values.forEach((v, i) => {
      if (!COMPARE_VALUES.includes(v)) {
        throw new Error(
          `compare-data: "${col.name}" row ${i + 1} ("${COMPARE_ROWS[i]}") has value ${JSON.stringify(v)} — allowed: yes, partial, no.`,
        );
      }
    });
    if (names.has(col.name)) {
      throw new Error(`compare-data: column "${col.name}" appears twice.`);
    }
    names.add(col.name);
  }
  if (!COMPETITORS.some((c) => c.name === DEFAULT_COMPETITOR)) {
    throw new Error(`compare-data: DEFAULT_COMPETITOR "${DEFAULT_COMPETITOR}" is not a competitor column.`);
  }
  if (PAIRS_WITH_PLATFORM_FROM <= 0 || PAIRS_WITH_PLATFORM_FROM >= COMPARE_ROWS.length) {
    throw new Error(`compare-data: PAIRS_WITH_PLATFORM_FROM (${PAIRS_WITH_PLATFORM_FROM}) must be inside the row list.`);
  }
}
validate();
