// The officials' availability-window and blackout-date writes (tables from
// migration 0062), shared by the add-official modal, the edit-official modal
// and the official's detail page. Every write here FAILS LOUD (2026-11-09,
// fix/official-availability-save):
//
//   - an insert error comes back as a sentence, never swallowed;
//   - the insert asks for the new rows back (`.select("id")`), and a reply
//     that doesn't carry exactly the rows sent is "Nothing was saved", never
//     success — a refused or skipped write must not read as saved;
//   - a draft the admin typed but never added is a refusal in the add modal
//     (`unaddedDraftLine`), not a silent drop.
//
// Why this exists: the edit modal rendered the availability and blackout
// sections, each with its own <form>, INSIDE the modal's <form>. With nested
// forms, the bundled React never ran either onSubmit, and the browser fell
// back to a native submit that reloaded the page — no insert sent, no error
// shown. From 794577e (2026-07-14) until this fix the edit modal never saved
// a single window or blackout date. The sections now contain no <form> at all
// (sim:official-profile-writes [N1]).

import type { createClient } from "@/lib/supabase/client";

type Client = ReturnType<typeof createClient>;

export type WriteOutcome = { ok: true } | { ok: false; message: string };

export type WindowDraft = { day: string; start: string; end: string };
export type BlackoutDraft = { date: string; note: string };

export const NOTHING_SAVED = "Nothing was saved. Try again.";
export const TIMES_REQUIRED = "Pick a start and an end time.";
export const END_AFTER_START = "End time must be after start time.";
export const DATE_REQUIRED = "Pick a date.";
export const UNADDED_WINDOW =
  "You filled in a weekly window but didn't click Add next to it. Click Add to include it, or clear it.";
export const UNADDED_BLACKOUT =
  "You picked a blackout date but didn't click Add next to it. Click Add to include it, or clear the date.";

const DAY_CODES = new Set(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
const TIME = /^\d{2}:\d{2}(:\d{2})?$/; // the house guard for native time values
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function minutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Why this window can't be saved, or null. */
export function windowDraftProblem(d: WindowDraft): string | null {
  if (!DAY_CODES.has(d.day)) return "Pick a day.";
  if (!TIME.test(d.start) || !TIME.test(d.end)) return TIMES_REQUIRED;
  if (minutes(d.end) <= minutes(d.start)) return END_AFTER_START;
  return null;
}

/** The add modal's refusal when a draft was typed but never added, or null. */
export function unaddedDraftLine(opts: {
  windowDraftTouched: boolean;
  blackoutDraftDate: string;
}): string | null {
  if (opts.windowDraftTouched) return UNADDED_WINDOW;
  if (opts.blackoutDraftDate.trim() !== "") return UNADDED_BLACKOUT;
  return null;
}

type InsertError = { code?: string; message: string } | null;

async function insertCounted(
  client: Client,
  table: "official_availability" | "official_blackouts",
  rows: Record<string, unknown>[],
  word: (err: NonNullable<InsertError>) => string,
): Promise<WriteOutcome> {
  if (rows.length === 0) return { ok: true };
  const { data, error } = (await client
    .from(table)
    .insert(rows as never[])
    .select("id")) as { data: { id: string }[] | null; error: InsertError };
  if (error) return { ok: false, message: word(error) };
  if (!Array.isArray(data) || data.length !== rows.length) {
    return { ok: false, message: NOTHING_SAVED };
  }
  return { ok: true };
}

/** Save weekly windows for one official. All or nothing: one statement. */
export async function addAvailabilityWindows(
  client: Client,
  umpireId: string,
  drafts: WindowDraft[],
): Promise<WriteOutcome> {
  for (const d of drafts) {
    const problem = windowDraftProblem(d);
    if (problem) return { ok: false, message: problem };
  }
  return insertCounted(
    client,
    "official_availability",
    drafts.map((d) => ({
      umpire_id: umpireId,
      day_of_week: d.day,
      start_time: d.start,
      end_time: d.end,
    })),
    (err) => err.message,
  );
}

/** Save blackout dates for one official. `duplicateLine` words the
 *  UNIQUE(umpire_id, date) refusal for the date that collided. */
export async function addBlackouts(
  client: Client,
  umpireId: string,
  drafts: BlackoutDraft[],
  duplicateLine: (date: string) => string,
): Promise<WriteOutcome> {
  for (const d of drafts) {
    if (!DATE.test(d.date)) return { ok: false, message: DATE_REQUIRED };
  }
  return insertCounted(
    client,
    "official_blackouts",
    drafts.map((d) => ({ umpire_id: umpireId, date: d.date, note: d.note.trim() || null })),
    (err) =>
      err.code === "23505" || /duplicate key|unique/i.test(err.message)
        ? duplicateLine(drafts.length === 1 ? drafts[0].date : drafts.map((d) => d.date).join(", "))
        : err.message,
  );
}
