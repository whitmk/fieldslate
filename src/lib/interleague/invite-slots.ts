export type PlayingDay = "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su";
type DayWindow = { start: string; end: string }; // "HH:MM"
type DayWindowMap = Partial<Record<PlayingDay, DayWindow>>;

const DAY_INDEX_TO_KEY: PlayingDay[] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export type InviteSlot = {
  id: string;             // stable: `${venue_id}|${iso}`
  venue_id: string;
  venue_name: string;
  date: string;           // YYYY-MM-DD (local)
  time: string;           // HH:MM
  iso: string;            // ISO timestamp at the slot time
  suggested: boolean;     // reserved for future "pre-selected" support
};

type SeasonInput = {
  start_date: string | null;
  end_date: string | null;
  schedule_settings: unknown;
};

type VenueInput = { id: string; name: string };
type BlackoutInput = { date: string };
type ExistingGameInput = { venue_id: string | null; scheduled_at: string };

const DEFAULT_PLAYING_DAYS: PlayingDay[] = ["Sa", "Su"];
const DEFAULT_DAY_WINDOW: DayWindow = { start: "09:00", end: "17:00" };
const DEFAULT_GAME_DURATION_MIN = 90;
const DEFAULT_BUFFER_MIN = 15;
const WINDOW_DAYS = 56; // 8 weeks
const MAX_SLOTS = 200;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseSchedule(raw: unknown): {
  playing_days: PlayingDay[];
  day_windows: DayWindowMap;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      playing_days: DEFAULT_PLAYING_DAYS,
      day_windows: {
        Sa: { ...DEFAULT_DAY_WINDOW },
        Su: { ...DEFAULT_DAY_WINDOW },
      },
    };
  }
  const obj = raw as Record<string, unknown>;
  const pdRaw = obj.playing_days;
  const playing_days: PlayingDay[] = Array.isArray(pdRaw)
    ? (pdRaw.filter((d): d is PlayingDay =>
        ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].includes(d as string),
      ) as PlayingDay[])
    : DEFAULT_PLAYING_DAYS;

  const dwRaw = obj.day_windows;
  const day_windows: DayWindowMap = {};
  if (dwRaw && typeof dwRaw === "object" && !Array.isArray(dwRaw)) {
    for (const key of playing_days) {
      const v = (dwRaw as Record<string, unknown>)[key];
      if (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        typeof (v as Record<string, unknown>).start === "string" &&
        typeof (v as Record<string, unknown>).end === "string"
      ) {
        day_windows[key] = {
          start: (v as { start: string }).start,
          end: (v as { end: string }).end,
        };
      } else {
        day_windows[key] = { ...DEFAULT_DAY_WINDOW };
      }
    }
  } else {
    for (const key of playing_days) {
      day_windows[key] = { ...DEFAULT_DAY_WINDOW };
    }
  }

  return { playing_days, day_windows };
}

export function computeInviteSlots(input: {
  season: SeasonInput;
  venues: VenueInput[];
  blackouts: BlackoutInput[];
  existingGames: ExistingGameInput[];
}): InviteSlot[] {
  const { season, venues, blackouts, existingGames } = input;

  if (venues.length === 0) return [];

  const { playing_days, day_windows } = parseSchedule(season.schedule_settings);

  // Build window: today → today+56d, intersected with season bounds when present
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + WINDOW_DAYS);

  let rangeStart = today;
  let rangeEnd = horizon;
  if (season.start_date) {
    const s = new Date(`${season.start_date}T00:00:00`);
    if (s > rangeStart) rangeStart = s;
  }
  if (season.end_date) {
    const e = new Date(`${season.end_date}T00:00:00`);
    if (e < rangeEnd) rangeEnd = e;
  }
  if (rangeStart > rangeEnd) return [];

  const blackoutSet = new Set(blackouts.map((b) => b.date));

  // Index existing games by `${venue_id}|${isoMinute}` for conflict detection
  const conflictKeys = new Set<string>();
  for (const g of existingGames) {
    if (!g.venue_id) continue;
    const d = new Date(g.scheduled_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${g.venue_id}|${d.toISOString().slice(0, 16)}`;
    conflictKeys.add(key);
  }

  const slots: InviteSlot[] = [];
  const slotIntervalMin = DEFAULT_GAME_DURATION_MIN + DEFAULT_BUFFER_MIN;

  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd && slots.length < MAX_SLOTS) {
    const dayKey = DAY_INDEX_TO_KEY[cursor.getDay()];
    const isPlayingDay = playing_days.includes(dayKey);
    const dateStr = formatLocalDate(cursor);

    if (isPlayingDay && !blackoutSet.has(dateStr)) {
      const win = day_windows[dayKey] ?? DEFAULT_DAY_WINDOW;
      const startMin = toMinutes(win.start);
      const endMin = toMinutes(win.end);

      for (let mins = startMin; mins + DEFAULT_GAME_DURATION_MIN <= endMin; mins += slotIntervalMin) {
        const timeStr = fromMinutes(mins);
        for (const venue of venues) {
          // Build local ISO timestamp for conflict lookup
          const slotLocal = new Date(cursor);
          slotLocal.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
          const isoMinute = slotLocal.toISOString().slice(0, 16);
          if (conflictKeys.has(`${venue.id}|${isoMinute}`)) continue;

          slots.push({
            id: `${venue.id}|${slotLocal.toISOString()}`,
            venue_id: venue.id,
            venue_name: venue.name,
            date: dateStr,
            time: timeStr,
            iso: slotLocal.toISOString(),
            suggested: false,
          });
          if (slots.length >= MAX_SLOTS) break;
        }
        if (slots.length >= MAX_SLOTS) break;
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}
