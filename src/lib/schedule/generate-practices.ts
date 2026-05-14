"use client";

import { createClient } from "@/lib/supabase/client";

// ─── Public types ──────────────────────────────────────────────────────────────

export type PracticeResult =
  | { success: true; practicesCreated: number; droppedCount: number }
  | { success: false; error: string };

// ─── Pure helpers ──────────────────────────────────────────────────────────────

const DAY_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};

const AUTO_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const AUTO_TIME = "17:00";
const PRACTICE_DURATION_MINS = 90;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** ISO week key (Thursday-anchored, matches generate-schedule.ts). */
function weekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const thu = new Date(d);
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const wk = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
  return `${thu.getFullYear()}-W${pad2(wk)}`;
}

/** Returns the Monday of the week containing dateStr. */
function mondayOf(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon;
}

/** Offset from Monday for a 2-char day code. Mo=0, Tu=1, ... Su=6. */
function dayOffset(dayCode: string): number {
  return (DAY_TO_JS[dayCode] - 1 + 7) % 7;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function generatePractices(divisionId: string): Promise<PracticeResult> {
  const supabase = createClient();

  // ── 1. Load division ─────────────────────────────────────────────────────────

  type DivRow = {
    id: string; league_id: string; name: string;
    start_date: string | null; end_date: string | null;
    practice_season_start: string | null; practice_season_end: string | null;
    activities_per_week: number; practice_venue_id: string | null;
  };

  const { data: divRaw, error: divErr } = await supabase
    .from("divisions")
    .select("id, league_id, name, start_date, end_date, practice_season_start, practice_season_end, activities_per_week, practice_venue_id")
    .eq("id", divisionId)
    .single();

  if (divErr || !divRaw) {
    return { success: false, error: divErr?.message ?? "Division not found." };
  }

  const div = divRaw as unknown as DivRow;

  // Use practice-specific dates when set, fall back to game season dates
  const practiceStart = div.practice_season_start ?? div.start_date;
  const practiceEnd   = div.practice_season_end   ?? div.end_date;

  if (!practiceStart || !practiceEnd) {
    return { success: false, error: "Division must have a start and end date." };
  }

  if (!div.activities_per_week || div.activities_per_week < 1) {
    return { success: true, practicesCreated: 0, droppedCount: 0 };
  }

  if (!div.practice_venue_id) {
    return {
      success: false,
      error: "No practice venue set for this division. Add a practice venue in the division settings before generating practices.",
    };
  }

  // ── 2. Load teams ────────────────────────────────────────────────────────────

  const { data: teamsData, error: teamsErr } = await supabase
    .from("teams")
    .select("id, name")
    .eq("division_id", divisionId)
    .order("name");

  if (teamsErr) return { success: false, error: teamsErr.message };
  const teams = (teamsData ?? []) as { id: string; name: string }[];
  if (!teams.length) return { success: true, practicesCreated: 0, droppedCount: 0 };

  const teamIds = teams.map((t) => t.id);

  // ── 3. Load team practice slots (pinned recurring slots) ─────────────────────

  type SlotRow = { team_id: string; day_of_week: string; start_time: string; venue_id: string | null };

  const { data: slotsData } = await supabase
    .from("team_practice_slots")
    .select("team_id, day_of_week, start_time, venue_id")
    .eq("division_id", divisionId);

  const slotsByTeam = new Map<string, SlotRow[]>();
  for (const s of (slotsData ?? []) as SlotRow[]) {
    if (!slotsByTeam.has(s.team_id)) slotsByTeam.set(s.team_id, []);
    slotsByTeam.get(s.team_id)!.push(s);
  }

  // ── 4. Load blackout dates ───────────────────────────────────────────────────

  const { data: blackoutRaw } = await supabase
    .from("blackout_dates")
    .select("date")
    .eq("league_id", div.league_id);

  const blackoutDates = new Set(
    ((blackoutRaw ?? []) as { date: string }[]).map((b) => b.date),
  );

  // ── 5. Delete existing practices for this division ───────────────────────────

  await supabase.from("practices").delete().eq("division_id", divisionId);

  // ── 6. Load all games for division teams ─────────────────────────────────────

  type GameRow = { home_team_id: string; away_team_id: string; scheduled_at: string };

  const { data: gamesRaw } = await supabase
    .from("games")
    .select("home_team_id, away_team_id, scheduled_at")
    .in("home_team_id", teamIds);

  const games = (gamesRaw ?? []) as GameRow[];

  // teamId → Set of game dates ("YYYY-MM-DD")
  const teamGameDates = new Map<string, Set<string>>();
  // teamId → weekKey → game count
  const teamGamesByWeek = new Map<string, Map<string, number>>();

  for (const t of teams) {
    teamGameDates.set(t.id, new Set());
    teamGamesByWeek.set(t.id, new Map());
  }

  for (const g of games) {
    const date = g.scheduled_at.substring(0, 10);
    const wk = weekKey(date);

    teamGameDates.get(g.home_team_id)?.add(date);
    teamGameDates.get(g.away_team_id)?.add(date);

    const hwm = teamGamesByWeek.get(g.home_team_id);
    if (hwm) hwm.set(wk, (hwm.get(wk) ?? 0) + 1);
    const awm = teamGamesByWeek.get(g.away_team_id);
    if (awm) awm.set(wk, (awm.get(wk) ?? 0) + 1);
  }

  // ── 7. Pre-load venue bookings (from games) at practice venues ───────────────

  const practiceVenueIds = new Set<string>();
  if (div.practice_venue_id) practiceVenueIds.add(div.practice_venue_id);
  for (const slots of slotsByTeam.values()) {
    for (const s of slots) {
      if (s.venue_id) practiceVenueIds.add(s.venue_id);
    }
  }

  // venueId:YYYY-MM-DD → list of start times (minutes from midnight) already booked
  const venueBookings = new Map<string, number[]>();

  if (practiceVenueIds.size > 0) {
    const { data: venueGamesRaw } = await supabase
      .from("games")
      .select("venue_id, scheduled_at")
      .in("venue_id", [...practiceVenueIds]);

    for (const g of (venueGamesRaw ?? []) as { venue_id: string; scheduled_at: string }[]) {
      const date = g.scheduled_at.substring(0, 10);
      const vKey = `${g.venue_id}:${date}`;
      const mins = timeToMinutes(g.scheduled_at.substring(11, 16));
      if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
      venueBookings.get(vKey)!.push(mins);
    }
  }

  // ── 8. Assign consistent auto-slots to teams with no pinned slot ─────────────
  // Teams are sorted alphabetically; each gets the next available day in round-robin.

  type EffectiveSlot = { day_of_week: string; start_time: string; venue_id: string | null };
  const autoSlots = new Map<string, EffectiveSlot>();
  let autoDayIdx = 0;

  for (const team of teams) {
    if (slotsByTeam.has(team.id) && slotsByTeam.get(team.id)!.length > 0) continue;
    autoSlots.set(team.id, {
      day_of_week: AUTO_DAYS[autoDayIdx % AUTO_DAYS.length],
      start_time: AUTO_TIME,
      venue_id: div.practice_venue_id,
    });
    autoDayIdx++;
  }

  // ── 9. Walk every week of the season ─────────────────────────────────────────

  type PracticeInsert = {
    league_id: string;
    division_id: string;
    team_id: string;
    venue_id: string | null;
    scheduled_date: string;
    start_time: string;
    status: "scheduled";
  };

  type DroppedLog = { league_id: string; division_id: string; event_type: string; message: string };

  const practices: PracticeInsert[] = [];
  const droppedLogs: DroppedLog[] = [];

  const seasonStart = new Date(practiceStart + "T00:00:00");
  const seasonEnd = new Date(practiceEnd + "T00:00:00");

  let weekMon = mondayOf(practiceStart);

  while (weekMon <= seasonEnd) {
    const thu = new Date(weekMon);
    thu.setDate(weekMon.getDate() + 3);
    const jan4 = new Date(thu.getFullYear(), 0, 4);
    const wkNum = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
    const wk = `${thu.getFullYear()}-W${pad2(wkNum)}`;

    for (const team of teams) {
      const pinnedSlots = slotsByTeam.get(team.id) ?? [];
      const effectiveSlots: EffectiveSlot[] =
        pinnedSlots.length > 0 ? pinnedSlots : autoSlots.has(team.id) ? [autoSlots.get(team.id)!] : [];

      if (!effectiveSlots.length) continue;

      const gamesThisWeek = teamGamesByWeek.get(team.id)?.get(wk) ?? 0;
      let practicesNeeded = Math.max(0, div.activities_per_week - gamesThisWeek);

      for (const slot of effectiveSlots) {
        if (practicesNeeded <= 0) break;

        const targetJs = DAY_TO_JS[slot.day_of_week];
        if (targetJs === undefined) continue;

        const practiceDate = new Date(weekMon);
        practiceDate.setDate(weekMon.getDate() + dayOffset(slot.day_of_week));
        const dateStr = localDateStr(practiceDate);

        if (practiceDate < seasonStart || practiceDate > seasonEnd) continue;
        if (blackoutDates.has(dateStr)) continue;

        if (teamGameDates.get(team.id)?.has(dateStr)) {
          // Format date for the log message
          const [yr, mo, dy] = dateStr.split("-").map(Number);
          const fmtDate = new Date(yr, mo - 1, dy, 12).toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "numeric",
          });
          droppedLogs.push({
            league_id: div.league_id,
            division_id: divisionId,
            event_type: "practice_dropped",
            message: `${team.name} practice dropped on ${fmtDate} — game scheduled that day`,
          });
          continue;
        }

        const venueId = slot.venue_id ?? div.practice_venue_id ?? null;
        if (venueId) {
          const vKey = `${venueId}:${dateStr}`;
          const bookedMins = venueBookings.get(vKey) ?? [];
          const slotMins = timeToMinutes(slot.start_time);
          if (bookedMins.some((t) => Math.abs(t - slotMins) < PRACTICE_DURATION_MINS)) {
            continue; // venue double-booked
          }
          if (!venueBookings.has(vKey)) venueBookings.set(vKey, []);
          venueBookings.get(vKey)!.push(slotMins);
        }

        practices.push({
          league_id: div.league_id,
          division_id: divisionId,
          team_id: team.id,
          venue_id: venueId,
          scheduled_date: dateStr,
          start_time: slot.start_time,
          status: "scheduled",
        });

        practicesNeeded--;
      }
    }

    weekMon = new Date(weekMon);
    weekMon.setDate(weekMon.getDate() + 7);
  }

  // ── 10. Bulk-insert practices ────────────────────────────────────────────────

  const BATCH = 500;
  for (let i = 0; i < practices.length; i += BATCH) {
    const { error: insertErr } = await supabase
      .from("practices")
      .insert(practices.slice(i, i + BATCH) as never[]);
    if (insertErr) return { success: false, error: insertErr.message };
  }

  // ── 11. Batch-insert activity log entries for dropped practices ──────────────

  if (droppedLogs.length > 0) {
    await supabase.from("activity_log").insert(droppedLogs as never[]);
  }

  return {
    success: true,
    practicesCreated: practices.length,
    droppedCount: droppedLogs.length,
  };
}
