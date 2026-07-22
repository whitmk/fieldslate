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

// `practice` marks the day as admin-set practice-usable. It is OPTIONAL and
// defaults to true when absent, so pre-existing venues (whose jsonb has no
// `practice` key) stay practice-usable exactly as before — no migration and no
// behavior change until an admin unchecks a day. Only the venue path reads or
// writes it; the game generator and interleague gate read start/end only.
export type DayWindow = { start: string; end: string; practice?: boolean };
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
    // Absent/non-boolean `practice` defaults to true — pre-existing venues have
    // no key and must stay practice-usable (backward compatible, no migration).
    const practice = typeof wr.practice === "boolean" ? wr.practice : true;
    out[key] = { start, end, practice };
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

// Admin-set: may practices be scheduled on this day? A day defaults to
// practice-usable (see DayWindow.practice) and a closed day (no window) is not
// usable for anything. This is ONE half of practice-eligibility — the generator
// also excludes derived game days (see lib/venues/game-days.ts); both must hold.
export function isPracticeUsable(av: VenueAvailability, day: DayKey): boolean {
  const w = av[day];
  return !!w && w.practice !== false;
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

// "9:00 AM" formatting for HH:MM wall-clocks. Shared so the interleague
// gate error payloads stay byte-identical across endpoints.
export function fmtTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// ── Shared venue-hours gate (used by every interleague reschedule API) ──────
//
// One predicate, one error-payload shape. Callers do the venue lookup
// themselves (the I/O patterns differ — sender-side resolves a free-text
// `venue_name` against owned venues; receiver-side often re-validates an
// already-assigned `venue_id`) and hand the venue row + new wall-time +
// duration to this function.
//
// Returns { ok: true } when it's safe to write. On failure, returns the
// `{ status, body }` to put straight into `NextResponse.json(body, { status })`.
// Callers should bail out of the request on `ok: false` BEFORE writing
// anything to the DB — that's what makes `/resolve` partial-update safe.
//
// `scheduledAtIso` accepts any ISO with a TZ offset; we substring [11..16]
// for the wall time (matches every other read of `scheduled_at` in the app —
// the user-intended local time, ignoring TZ).

export interface VenueGateRow {
  name: string;
  availability: unknown;
  availability_configured: boolean;
}

export type VenueGateResult =
  | { ok: true }
  | {
      ok: false;
      status: 400;
      body: { error: string; venue?: string; day?: string; proposed_time?: string; venue_hours?: string };
    };

export function gateVenueProposal(
  venue: VenueGateRow,
  scheduledAtIso: string,
  durationMin: number,
): VenueGateResult {
  if (!venue.availability_configured) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Cannot reschedule to an unconfigured venue. Set venue hours first.",
        venue: venue.name,
      },
    };
  }

  // Duration === 0 means the home team's division didn't configure
  // game_duration — skip the window check (we can't determine an end time).
  // The availability_configured check above still protects against the
  // worst of the two failure modes.
  if (durationMin <= 0) return { ok: true };

  const av = parseAvailability(venue.availability);
  const day = dayKeyFromIsoDate(scheduledAtIso);
  const wallTime = scheduledAtIso.substring(11, 16);
  if (isVenueAvailable(av, day, wallTime, durationMin)) return { ok: true };

  const win = av[day];
  return {
    ok: false,
    status: 400,
    body: {
      error: "Venue is not open at the proposed time.",
      venue: venue.name,
      day: DAY_LABELS[day],
      proposed_time: fmtTime12(wallTime),
      venue_hours: win
        ? `${fmtTime12(win.start)} – ${fmtTime12(win.end)}`
        : "Closed",
    },
  };
}
