// The ONLY daylight render pieces. Every surface that shows a daylight flag,
// a lit-field tag, a slot dot, an explanation or a status line renders one of
// these, and every word comes from src/lib/daylight/flags.ts VERBATIM.
// (Same rule as the game-note pieces: one component per shape, no
// hand-written chips at call sites.)
//
// ADMIN-ONLY. No print region, export, email, feed or token page may import
// this file — `npm run sim:daylight-leaks` fences them off.
//
// Colours: After = amber (a warning in this codebase), Near = a lighter
// amber. Class strings stay complete literals here (Tailwind scans
// src/components, not src/lib).

import Link from "next/link";
import { Lightbulb, Sunset } from "lucide-react";
import {
  daylightBracketChipText,
  daylightChipText,
  daylightDotTitle,
  daylightExplanation,
  daylightPickNotice,
  daylightStatusLine,
  type DaylightFlag,
  type DaylightState,
} from "@/lib/daylight/flags";

const CHIP_AFTER = "border-amber-300 bg-amber-100 text-amber-900";
const CHIP_NEAR = "border-amber-200 bg-amber-50 text-amber-800";

/** The chip on a row, card, popover or panel row (daylightChipText); the
 *  bracket variant adds "Ends" (daylightBracketChipText). */
export function DaylightChip({ flag, variant = "row" }: { flag: DaylightFlag; variant?: "row" | "bracket" }) {
  const text = variant === "bracket" ? daylightBracketChipText(flag) : daylightChipText(flag);
  // The bracket card's band is a fixed 16px line (SCREEN_TREE): no border, no
  // vertical padding there.
  const shape =
    variant === "bracket"
      ? "rounded px-1 leading-4"
      : "rounded-full border px-1.5 py-0.5";
  return (
    <span
      data-daylight-chip={flag.kind}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-semibold ${shape} ${
        flag.kind === "after" ? CHIP_AFTER : CHIP_NEAR
      }`}
    >
      <Sunset className="h-3 w-3" aria-hidden />
      {text}
    </span>
  );
}

/** "Lights" — a field that has lights (never flagged). */
export function LightsTag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
      <Lightbulb className="h-2.5 w-2.5" aria-hidden />
      Lights
    </span>
  );
}

/** A dot on a picker slot that would end after or near sunset. */
export function SlotDaylightDot({ flag }: { flag: DaylightFlag }) {
  return (
    <span
      data-daylight-dot={flag.kind}
      title={daylightDotTitle(flag)}
      aria-label={daylightDotTitle(flag)}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${flag.kind === "after" ? "bg-amber-500" : "bg-amber-300"}`}
    />
  );
}

/** The game-details explanation: why, and the start-by time that fixes it. */
export function DaylightExplanation({ flag, fieldLabel }: { flag: DaylightFlag; fieldLabel: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <Sunset className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{daylightExplanation(flag, fieldLabel)}</span>
    </p>
  );
}

/** The notice under a picker / form once a flagged time is chosen. Never
 *  disables anything. */
export function DaylightPickNotice({ flag, fieldLabel }: { flag: DaylightFlag; fieldLabel: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <Sunset className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{daylightPickNotice(flag, fieldLabel)}</span>
    </p>
  );
}

/** One line when flags can't run (no city, unknown city, unreadable). Null
 *  when flags are on or switched off. Links to Settings. */
export function DaylightStatusLine({ state }: { state: DaylightState }) {
  const line = daylightStatusLine(state);
  if (!line) return null;
  return (
    <p className="flex items-center gap-2 text-xs text-gray-500">
      <Sunset className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
      <span>
        {line}{" "}
        {state.kind !== "error" && (
          <Link href="/dashboard/settings" className="font-medium text-[#16a34a] underline-offset-2 hover:underline">
            Settings
          </Link>
        )}
      </span>
    </p>
  );
}
