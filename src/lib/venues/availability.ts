// Shared venue-availability helpers.
//
// `venues.availability` (jsonb) mirrors `divisions.settings.day_windows`:
//
//   { Mo: { start: "17:00", end: "21:00" }, Sa: { start: "08:00", end: "19:00" }, … }
//
// A day key that is absent (or whose window fails validation) means the venue
// is closed that day. All times are HH:MM 24-hour wall-clock strings — the
// same convention used everywhere else in the schedule code (no Date objects,
// no timezone math). `availability_configured` is a separate boolean: a venue
// only becomes eligible for new scheduling once it's been explicitly set up,
// even if `availability` is non-empty (e.g. partially-edited drafts).

export type DayKey = "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su";

export const DAY_KEYS: DayKey[] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export const DAY_LABELS: Record<DayKey, string> = {
  Mo: "Mon",
  Tu: "Tue",
  We: "Wed",
  Th: "Thu",
  Fr: "Fri",
  Sa: "Sat",
  Su: "Sun",
};

// JS Date.getDay() ↔ our day key. Su=0, Mo=1, … Sa=6.
const JS_TO_DAY: Record<number, DayKey> = {
  0: "Su",
  1: "Mo",
  2: "Tu",
  3: "We",
  4: "Th",
  5: "Fr",
  6: "Sa",
};

export type DayWindow = { start: string; end: string };
export type VenueAvailability = Partial<Record<DayKey, DayWindow>>;

// Permissive: any unknown jsonb shape coerces to a clean availability map.
// Garbage entries (bad day keys, missing fields, start >= end) drop silently —
// the source of truth for "configured" is the dedicated boolean column, not
// whether parsing yielded a non-empty map.
export function parseAvailability(raw: unknown): VenueAvailability {
  const out: VenueAvailability = {};
  if (!raw || typeof raw !== "object") return out;
  const rec = raw as Record<string, unknown>;
  for (const key of DAY_KEYS) {
    const w = rec[key];
    if (!w || typeof w !== "object") continue;
    const wr = w as Record<string, unknown>;
    const start = typeof wr.start === "string" ? wr.start : null;
    const end = typeof wr.end === "string" ? wr.end : null;
    if (!start || !end) continue;
    if (!isValidHHMM(start) || !isValidHHMM(end)) continue;
    if (parseHHMM(start) >= parseHHMM(end)) continue;
    out[key] = { start, end };
  }
  return out;
}

export function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isValidHHMM(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s) && parseHHMM(s) <= 24 * 60;
}

export function dayKeyFromJsDate(d: Date): DayKey {
  return JS_TO_DAY[d.getDay()];
}

export function dayKeyFromIsoDate(iso: string): DayKey {
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS" — interpret as local time to match
  // the convention used by the scheduling engine.
  return dayKeyFromJsDate(new Date(iso.substring(0, 10) + "T00:00:00"));
}

// Sum of available hours across the venue's configured week. Returns 0 for a
// venue with no configured days (which is also the "unconfigured" case).
export function weeklyAvailableHours(av: VenueAvailability): number {
  let mins = 0;
  for (const key of DAY_KEYS) {
    const w = av[key];
    if (!w) continue;
    mins += parseHHMM(w.end) - parseHHMM(w.start);
  }
  return mins / 60;
}

// The single predicate the three scheduling paths share. `startTimeHHMM` is
// the event's start wall-time, `durationMin` is its run-length in minutes.
// Returns true when the event fits inside the venue's window for that day.
//
// Callers may pre-check `availability_configured` separately; this function
// just answers "do the hours allow it?" — an unconfigured venue's empty map
// will always return false, which is the right behavior for the engine.
export function isVenueAvailable(
  availability: VenueAvailability,
  day: DayKey,
  startTimeHHMM: string,
  durationMin: number,
): boolean {
  const w = availability[day];
  if (!w) return false;
  const startMin = parseHHMM(startTimeHHMM);
  const endMin = startMin + Math.max(0, durationMin);
  const winStart = parseHHMM(w.start);
  const winEnd = parseHHMM(w.end);
  return startMin >= winStart && endMin <= winEnd;
}

// Validate a user-edited availability map (returned from the venue form).
// Returns one human-readable error per problem day, or [] when clean. Empty
// input is also clean — we don't *require* any day to be set; "venue is
// closed every day" is just a different (still-unsaveable) state handled by
// the form, not by validation.
export function validateAvailability(av: VenueAvailability): string[] {
  const errors: string[] = [];
  for (const key of DAY_KEYS) {
    const w = av[key];
    if (!w) continue;
    if (!isValidHHMM(w.start) || !isValidHHMM(w.end)) {
      errors.push(`${DAY_LABELS[key]}: invalid time`);
      continue;
    }
    if (parseHHMM(w.start) >= parseHHMM(w.end)) {
      errors.push(`${DAY_LABELS[key]}: end time must be after start time`);
    }
  }
  return errors;
}

// "Are any days actually open?" — drives the availability_configured flag at
// save time. A venue is considered configured iff at least one day has a
// valid window after parsing.
export function hasAnyDayConfigured(av: VenueAvailability): boolean {
  for (const key of DAY_KEYS) {
    if (av[key]) return true;
  }
  return false;
}
