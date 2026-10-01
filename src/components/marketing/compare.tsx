"use client";

// Homepage "How FieldSlate compares": a feature grid of FieldSlate against one
// competitor at a time, picked from a native <select>. Every row, column and
// value comes from src/lib/compare-data.ts (validated at build time); this
// file holds the presentation only.
//
// Client component because the dropdown is state. Same pattern as
// hero-video.tsx: a "use client" leaf imported by the server-rendered page.
//
// Every value cell shows an icon with an aria-label AND a visible word, so the
// three states are never told apart by color alone (and the shapes differ:
// check, dashed circle, cross). The state color is on the ICON ONLY; the word
// is always the table's body color — small green text on white fails
// contrast. Colors match the homepage's existing hex literals rather than
// the fs-* tokens, so this section matches its neighbors; icons are
// lucide's, as in Pricing.
//
// The grid is a table inside an overflow-x-auto wrapper. At 375px it fits
// without scrolling (min-w 20rem); if it ever cannot, the wrapper scrolls and
// the page body never scrolls sideways.

import { Fragment, useState } from "react";
import Link from "next/link";
import { Check, CircleDashed, X } from "lucide-react";
import {
  COMPARE_ROWS,
  COMPETITORS,
  DEFAULT_COMPETITOR,
  FIELDSLATE,
  PAIRS_WITH_PLATFORM_FROM,
  type CompareValue,
} from "@/lib/compare-data";

const CELL: Record<
  CompareValue,
  { Icon: typeof Check; word: string; label: string; iconClassName: string }
> = {
  yes: { Icon: Check, word: "Yes", label: "Yes", iconClassName: "text-[#16a34a]" },
  partial: { Icon: CircleDashed, word: "Partial", label: "Partial", iconClassName: "text-[#0C1F3F]/70" },
  no: { Icon: X, word: "No", label: "Not offered", iconClassName: "text-gray-400" },
};

function ValueCell({ value }: { value: CompareValue }) {
  const { Icon, word, label, iconClassName } = CELL[value];
  return (
    <span className="inline-flex items-center gap-1.5 text-[#0C1F3F]">
      <Icon className={`h-4 w-4 flex-shrink-0 ${iconClassName}`} role="img" aria-label={label} />
      <span className="text-xs font-medium">{word}</span>
    </span>
  );
}

export function Compare() {
  const [competitorName, setCompetitorName] = useState<string>(DEFAULT_COMPETITOR);
  const competitor = COMPETITORS.find((c) => c.name === competitorName) ?? COMPETITORS[0];

  return (
    <section id="compare" className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#0C1F3F] sm:text-4xl">
            How FieldSlate compares
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Built for the season, not just the schedule — and designed to sit alongside
            whatever registration platform your league uses.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <label htmlFor="compare-with" className="text-sm font-medium text-[#0C1F3F]">
              Compare with
            </label>
            <select
              id="compare-with"
              value={competitorName}
              onChange={(e) => setCompetitorName(e.target.value)}
              className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-[#0C1F3F] focus:border-[#22C55E] focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 sm:w-56"
            >
              {COMPETITORS.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-100">
            <table className="w-full min-w-[20rem] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[46%]" />
                <col className="w-[27%]" />
                <col className="w-[27%]" />
              </colgroup>
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    Feature
                  </th>
                  <th scope="col" className="px-3 py-3 text-[#0C1F3F] sm:px-4">
                    {FIELDSLATE.name}
                  </th>
                  <th scope="col" className="px-3 py-3 sm:px-4">
                    {competitor.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row, i) => (
                  <Fragment key={row}>
                    {i === PAIRS_WITH_PLATFORM_FROM && (
                      <tr>
                        <td
                          colSpan={3}
                          className="border-t border-gray-100 bg-gray-50/60 px-3 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-gray-400 sm:px-4"
                        >
                          Pairs with your registration platform
                        </td>
                      </tr>
                    )}
                    <tr className="border-t border-gray-100">
                      <th scope="row" className="px-3 py-3 text-left font-medium leading-snug text-[#0C1F3F] sm:px-4">
                        {row}
                      </th>
                      <td className="px-3 py-3 sm:px-4">
                        <ValueCell value={FIELDSLATE.values[i]} />
                      </td>
                      <td className="px-3 py-3 sm:px-4">
                        <ValueCell value={competitor.values[i]} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-sm font-medium text-[#0C1F3F]">
            FieldSlate: free for one division, then $249 or $349 per season.
          </p>

          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500" aria-label="Legend">
            {(["yes", "partial", "no"] as const).map((v) => (
              <li key={v} className="inline-flex items-center gap-1.5">
                <ValueCell value={v} />
                {v === "no" && <span>(not offered)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Partial = available in a limited form, such as team-level only or via a separate
            integration.
          </p>

          <p className="mt-6 text-xs text-gray-400">
            Based on each vendor&apos;s publicly available information as of September 2026. See
            something out of date?{" "}
            <Link href="/contact" className="font-medium text-gray-500 underline underline-offset-2 hover:text-[#0C1F3F]">
              Let us know
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
