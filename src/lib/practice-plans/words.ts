// Every app-only sentence the in-app practice planner shows — rendered
// VERBATIM by the screens. The calculator module (src/lib/practice-planner/)
// keeps its own sentences (warnings, request text); nothing here is used by
// the public calculator.
//
// FENCE: no daylight-flag module, no sunset math here (sim:daylight-leaks S1).
// Sunset numbers come from computePlan's result; this file only words them.

import { fmtDate, fmtTime } from "@/lib/practice-planner/format";
import type { UsCity } from "@/lib/sun/us-cities";

/** A saved plan that fails the input check or has an unknown version. */
export const CANT_OPEN_PLAN = "We can't open this plan. It may have been saved by a newer version of FieldSlate.";

export const PLANS_EMPTY_TITLE = "No field requests yet";
export const PLANS_EMPTY_BODY =
  "Enter your divisions and practice nights, and FieldSlate works out how many fields of each kind to ask the city for — night by night, with sunset times for your city.";

/** Under the New plan name field. */
export function newPlanSource(seasonName: string | null): string {
  return seasonName
    ? `Starts with your divisions and team counts from ${seasonName}, your most recent season with teams. You can change anything.`
    : "No season has teams yet, so the plan starts empty. Add your divisions.";
}

export const COPY_PLAN_NOTE =
  "Copies everything — dates, divisions, team counts, field types, lit fields. Team counts are not refreshed from your latest season.";

/** The small line under a division's Teams box: "6 in Fall 2026". */
export function teamHintLine(count: number, seasonName: string): string {
  return `${count} in ${seasonName}`;
}

/** A division with no team count to copy. */
export function noTeamsLine(name: string, seasonName: string | null): string {
  const who = name.trim() || "This division";
  return seasonName
    ? `No ${who} in ${seasonName}. Not counted until you enter teams.`
    : "Not counted until you enter teams.";
}

/**
 * The planner's one-line note when New plan had to change the prefill to fit
 * a plan's limits; null when it changed nothing.
 */
export function prefillAdjustedLine(
  seasonName: string,
  a: { dropped: number; shortened: number; capped: number },
  limits: { divisions: number; nameChars: number; teams: number },
): string | null {
  const parts: string[] = [];
  if (a.dropped) parts.push(`${a.dropped} ${a.dropped === 1 ? "division" : "divisions"} left out (a plan holds ${limits.divisions})`);
  if (a.shortened) parts.push(`${a.shortened} ${a.shortened === 1 ? "name" : "names"} shortened to ${limits.nameChars} characters`);
  if (a.capped) parts.push(`${a.capped} team ${a.capped === 1 ? "count" : "counts"} lowered to ${limits.teams}`);
  return parts.length ? `From ${seasonName}: ${parts.join("; ")}.` : null;
}

/** Beside a division switched to lit fields. */
export function litDivisionNote(name: string): string {
  return `No daylight warnings for ${name.trim() || "this division"}.`;
}

/** The line above the warnings when a city is set. */
export function earliestSunsetLine(city: UsCity, earliest: { date: number; minutes: number }, litNames: string[]): string {
  const base = `Earliest sunset in ${city.name} this season: ${fmtTime(earliest.minutes)} on ${fmtDate(earliest.date)}.`;
  if (!litNames.length) return base;
  return `${base} ${joinNames(litNames)} ${litNames.length === 1 ? "is" : "are"} on lit fields and ${litNames.length === 1 ? "isn't" : "aren't"} checked.`;
}

/** "Sunset times for" when the league has no city (or an unknown one). */
export const NO_CITY_TITLE = "No daylight check yet.";
export const NO_CITY_BODY = "Set your league city to see which practices run past dark.";
export const NO_CITY_LINK = "Set your league city";
export const CITY_SOURCE_NOTE = "Your league city, from Settings → Daylight flags. Every plan uses it.";

/** A save that found someone else's newer save. `when` is already formatted for the viewer. */
export function staleSaveLine(who: string | null, when: string): string {
  return `${who?.trim() || "Someone else"} saved this plan at ${when}. Reload to see their changes, or keep yours.`;
}
export const STALE_RELOAD = "Reload";
export const STALE_KEEP_MINE = "Keep mine";

export const COPIED_TOAST = "Copied — paste it into your request to the city";
export const COPY_FALLBACK = "Your browser didn't allow copying. The text is selected — press ⌘C (Ctrl+C) to copy it.";

/** The delete confirm. */
export function deletePlanConfirm(name: string): { title: string; body: string } {
  return {
    title: `Delete "${name}"?`,
    body: "The plan and its settings are deleted. Nothing else changes — no season, schedule or practice is touched. This can't be undone.",
  };
}

/** The app-side line after the module's request text, and on the print. Null when nothing is lit. */
export function litFieldsLine(names: string[]): string | null {
  return names.length ? `On lit fields: ${names.join(", ")}.` : null;
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ── Plans list (step 5a) ─────────────────────────────────────────────────
export const PLANS_TITLE = "Field requests";
export const PLANS_INTRO = "Work out how many practice fields to ask the city for, night by night. Plans belong to the league, not a season.";
export const NEW_PLAN_BUTTON = "New plan";
export const COPY_PLAN_BUTTON = "Copy from a previous plan";
export const COPY_PLAN_BUTTON_SHORT = "Copy a plan";
export const NEW_PLAN_TITLE = "New field request";
export const COPY_PLAN_TITLE = "Copy a plan";
export const RENAME_PLAN_TITLE = "Rename plan";
export const PLAN_NAME_LABEL = "Plan name";
export const NEW_PLAN_NAME_LABEL = "New plan name";
export const PLAN_NAME_HELP = "Any name — “Spring 2027”, “Spring 2027 — two new fields”.";
export const MENU_OPEN = "Open";
export const MENU_COPY = "Copy";
export const MENU_RENAME = "Rename";
export const MENU_DELETE = "Delete…";
export const CREATE_BUTTON = "Create plan";
export const COPY_BUTTON = "Copy plan";
export const RENAME_BUTTON = "Save name";
export const CANCEL_BUTTON = "Cancel";
export const DELETE_BUTTON = "Delete plan";
export const PLAN_CANT_OPEN_TAG = "Can't open";
export const PLAN_NO_DATES = "No dates yet";
export const PLAN_NO_FIELDS = "No practices yet";
export const PLANS_FREE_CALCULATOR = "Use the free calculator";

export const MODE_NAMES = { spread: "Spread across the week", sameNights: "Everyone wants the same nights" } as const;

/** The default name in the Copy modal: "Copy of Spring 2027", kept to the 80-character limit. */
export function copyName(name: string, maxChars: number): string {
  return Array.from(`Copy of ${name}`).slice(0, maxChars).join("");
}

/** A choice row in the Copy modal. */
export function copyChoiceDetail(dates: string, divisions: number, edited: string): string {
  return `${dates} · ${divisions} ${divisions === 1 ? "division" : "divisions"} · edited ${edited}`;
}

/** A refusal from one of the plan functions (0117), in words. */
export function planErrorMessage(key: string): string {
  switch (key) {
    case "not_authorized":
      return "You're not a member of this league, so you can't change its plans.";
    case "plan_required":
      return "Field requests are on Pro and Elite. Upgrade to create or change plans.";
    case "invalid_name":
      return "Give the plan a name (up to 80 characters).";
    case "plan_not_found":
      return "This plan no longer exists. It may have been deleted.";
    case "invalid_input":
    case "input_version":
    case "invalid_mode":
      return "This plan couldn't be saved — something in it is outside what a plan can hold. Nothing was saved.";
    default:
      return "Something went wrong and nothing was saved. Try again.";
  }
}
