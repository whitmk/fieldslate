"use client";

import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, SeededTeam, PlayoffFormat } from "@/components/playoffs/playoff-wizard-types";
import {
  dayKeyFromJsDate,
  isVenueAvailable,
  parseAvailability,
  type VenueAvailability,
} from "@/lib/venues/availability";

// ─── Result type ──────────────────────────────────────────────────────────────

export type BracketResult =
  | { success: true; gamesCreated: number; tbdCount: number }
  | { success: false; error: string };

// ─── Game row shape ───────────────────────────────────────────────────────────

interface GameInsert {
  playoff_id: string;
  league_id: string;
  division_id: string;
  round: string;
  game_number: number;
  home_team_id: string | null;
  away_team_id: string | null;
  venue_id: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  status: "scheduled";
}

// ─── Slot helpers ─────────────────────────────────────────────────────────────

const DAY_TO_JS: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function localDateStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTimeStr(mins: number) {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

interface Slot {
  date: string;
  time: string;
  venueId: string;
}

// Matches the hardcoded 105-min spacing below (90-min game + 15-min buffer).
// If slot spacing ever switches to division settings, change both together.
const PLAYOFF_GAME_DURATION_MIN = 90;

/**
 * Returns all available (venue × time) pairs for each valid playoff date,
 * grouped so index 0 = first date, index 1 = second date, etc.
 * Within each date, slots are ordered by time then venue so that multiple
 * games on the same venue within a round are staggered across time windows.
 *
 * Venue hours are a hard filter — a slot the venue isn't open for is never
 * emitted (same rule as the main schedule generator and findFreeSlot).
 */
function buildSlotsByDate(
  data: PlayoffWizardData,
  venueAvailability: Map<string, VenueAvailability>,
): Slot[][] {
  if (!data.start_date || !data.end_date) return [];

  const venueIds = data.venue_assignments.map((v) => v.venue_id);
  if (!venueIds.length) return [];

  const allowedDays = new Set(
    data.playing_days.map((d) => DAY_TO_JS[d]).filter((n) => n !== undefined),
  );
  if (!allowedDays.size) return [];

  const byDate = new Map<string, Slot[]>();
  const cur = new Date(data.start_date + "T00:00:00");
  const end = new Date(data.end_date + "T00:00:00");

  // 90-min game + 15-min buffer = 105-min spacing between start times
  const interval = 105;

  while (cur <= end) {
    const dayJS = cur.getDay();
    const iso = localDateStr(cur);

    if (allowedDays.has(dayJS)) {
      const dayKey = Object.entries(DAY_TO_JS).find(([, v]) => v === dayJS)?.[0];
      const win = dayKey ? data.day_windows[dayKey as keyof typeof data.day_windows] : undefined;
      const earliest = timeToMinutes(win?.start ?? "09:00");
      const latest = timeToMinutes(win?.end ?? "21:00");
      const availabilityDay = dayKeyFromJsDate(cur);

      const dateSlots: Slot[] = [];
      let t = earliest;
      while (t <= latest) {
        const time = minutesToTimeStr(t);
        for (const venueId of venueIds) {
          // A venue missing from the map passes through — the wizard already
          // filters to configured venues, so missing means the availability
          // fetch failed, and blocking every slot would be worse.
          const av = venueAvailability.get(venueId);
          if (
            av &&
            !isVenueAvailable(av, availabilityDay, time, PLAYOFF_GAME_DURATION_MIN)
          ) {
            continue;
          }
          dateSlots.push({ date: iso, time, venueId });
        }
        t += interval;
      }

      if (dateSlots.length > 0) byDate.set(iso, dateSlots);
    }

    cur.setDate(cur.getDate() + 1);
  }

  // Map insertion order is chronological since we iterate dates in order
  return [...byDate.values()];
}

// ─── Round-robin matchup generation (circle method) ──────────────────────────

function roundRobinRounds(ids: string[]): [string, string][][] {
  const arr = ids.length % 2 === 0 ? [...ids] : [...ids, "__bye__"];
  const n = arr.length;
  const rounds: [string, string][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__bye__" && b !== "__bye__") round.push([a, b]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop()!);
  }

  return rounds;
}

// ─── Slot picker — one date bucket per round ──────────────────────────────────

function makeSlotPicker(slotsByDate: Slot[][]) {
  // Each call to nextRound() advances to the next date bucket.
  // Within a round, slots are consumed sequentially (venue-staggered within
  // each time window, so same-venue games are at different times).
  let dateIdx = 0;
  let slotInDate = 0;
  let lastRound = "";

  return function pickSlot(round: string): Slot | null {
    if (round !== lastRound) {
      if (lastRound !== "") dateIdx++;
      lastRound = round;
      slotInDate = 0;
    }
    const bucket = slotsByDate[Math.min(dateIdx, slotsByDate.length - 1)] ?? [];
    return bucket[slotInDate++] ?? null;
  };
}

// ─── Single elimination ────────────────────────────────────────────────────────

function buildSingleElimination(
  seeds: SeededTeam[],
  playoffId: string,
  leagueId: string,
  divisionId: string,
  slotsByDate: Slot[][],
): GameInsert[] {
  const n = seeds.length;
  if (n < 2) return [];

  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const teamSlots: (SeededTeam | null)[] = seeds.slice();
  while (teamSlots.length < bracketSize) teamSlots.push(null);

  const games: GameInsert[] = [];
  let gameNumber = 1;
  const pick = makeSlotPicker(slotsByDate);

  // Round 1: pair seed 1 vs N, 2 vs N-1, etc. Skip bye pairs.
  const r1Label = "R1";
  for (let i = 0; i < bracketSize / 2; i++) {
    const home = teamSlots[i];
    const away = teamSlots[bracketSize - 1 - i];
    if (home && away) {
      const slot = pick(r1Label);
      games.push({
        playoff_id: playoffId, league_id: leagueId, division_id: divisionId,
        round: r1Label, game_number: gameNumber++,
        home_team_id: home.team_id, away_team_id: away.team_id,
        venue_id: slot?.venueId ?? null,
        scheduled_date: slot?.date ?? null,
        start_time: slot?.time ?? null,
        status: "scheduled",
      });
    }
  }

  // Subsequent rounds — TBD placeholders, each on the next date
  let round = 2;
  let roundSize = bracketSize / 4;
  while (roundSize >= 1) {
    const label = roundSize === 1 ? "F" : roundSize === 2 ? "SF" : `R${round}`;
    for (let i = 0; i < roundSize; i++) {
      const slot = pick(label);
      games.push({
        playoff_id: playoffId, league_id: leagueId, division_id: divisionId,
        round: label, game_number: gameNumber++,
        home_team_id: null, away_team_id: null,
        venue_id: slot?.venueId ?? null,
        scheduled_date: slot?.date ?? null,
        start_time: slot?.time ?? null,
        status: "scheduled",
      });
    }
    round++;
    roundSize = roundSize / 2;
  }

  return games;
}

// ─── Double elimination ────────────────────────────────────────────────────────

function buildDoubleElimination(
  seeds: SeededTeam[],
  playoffId: string,
  leagueId: string,
  divisionId: string,
  slotsByDate: Slot[][],
): GameInsert[] {
  const n = seeds.length;
  if (n < 2) return [];

  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const games: GameInsert[] = [];
  let gameNumber = 1;
  const pick = makeSlotPicker(slotsByDate);

  function mkGame(round: string, homeId: string | null, awayId: string | null): GameInsert {
    const slot = pick(round);
    return {
      playoff_id: playoffId, league_id: leagueId, division_id: divisionId,
      round, game_number: gameNumber++,
      home_team_id: homeId, away_team_id: awayId,
      venue_id: slot?.venueId ?? null,
      scheduled_date: slot?.date ?? null,
      start_time: slot?.time ?? null,
      status: "scheduled",
    };
  }

  // WB Round 1 (known matchups)
  const wbR1Count = bracketSize / 2;
  for (let i = 0; i < wbR1Count; i++) {
    const home = seeds[i] ?? null;
    const away = seeds[bracketSize - 1 - i] ?? null;
    if (home && away) games.push(mkGame("WB-R1", home.team_id, away.team_id));
  }

  // WB subsequent rounds
  let wbRound = 2;
  let wbSize = wbR1Count / 2;
  while (wbSize >= 1) {
    const label = wbSize === 1 ? "WB-F" : `WB-R${wbRound}`;
    for (let i = 0; i < wbSize; i++) games.push(mkGame(label, null, null));
    wbRound++;
    wbSize = wbSize / 2;
  }

  // LB rounds
  const totalWbRounds = Math.log2(bracketSize);
  let lbSize = bracketSize / 4;
  for (let lbR = 1; lbR <= (totalWbRounds - 1) * 2; lbR++) {
    const count = Math.max(1, Math.ceil(lbSize));
    const label = lbR === (totalWbRounds - 1) * 2 ? "LB-F" : `LB-R${lbR}`;
    for (let i = 0; i < count; i++) games.push(mkGame(label, null, null));
    if (lbR % 2 === 0) lbSize = Math.max(1, lbSize / 2);
  }

  games.push(mkGame("GF", null, null));
  games.push(mkGame("GF-R", null, null));

  return games;
}

// ─── Round robin ─────────────────────────────────────────────────────────────

function buildRoundRobin(
  seeds: SeededTeam[],
  playoffId: string,
  leagueId: string,
  divisionId: string,
  slotsByDate: Slot[][],
): GameInsert[] {
  const ids = seeds.map((s) => s.team_id);
  if (ids.length < 2) return [];

  const rounds = roundRobinRounds(ids);
  const games: GameInsert[] = [];
  let gameNumber = 1;
  const pick = makeSlotPicker(slotsByDate);

  rounds.forEach((round, rIdx) => {
    const label = `RR${rIdx + 1}`;
    round.forEach(([homeId, awayId]) => {
      const slot = pick(label);
      games.push({
        playoff_id: playoffId, league_id: leagueId, division_id: divisionId,
        round: label, game_number: gameNumber++,
        home_team_id: homeId, away_team_id: awayId,
        venue_id: slot?.venueId ?? null,
        scheduled_date: slot?.date ?? null,
        start_time: slot?.time ?? null,
        status: "scheduled",
      });
    });
  });

  return games;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateBracket(
  playoffId: string,
  leagueId: string,
  data: PlayoffWizardData,
): Promise<BracketResult> {
  const supabase = createClient();

  let seeds: SeededTeam[] = data.seeding;
  if (!seeds.length) {
    const { data: teams, error } = await supabase
      .from("teams")
      .select("id, name")
      .eq("division_id", data.division_id)
      .order("name");
    if (error) return { success: false, error: error.message };
    seeds = (teams ?? []).map((t) => ({ team_id: t.id, team_name: t.name }));
  }

  if (seeds.length < 2) {
    return { success: false, error: "Need at least 2 teams to generate a bracket." };
  }

  // Venue hours for the slot filter — the wizard only carries venue ids.
  // A failed fetch leaves the map empty, which passes slots through
  // unfiltered (see buildSlotsByDate) rather than blocking the bracket.
  const venueIds = data.venue_assignments.map((v) => v.venue_id);
  const venueAvailability = new Map<string, VenueAvailability>();
  if (venueIds.length > 0) {
    const { data: venueRows } = await supabase
      .from("venues")
      .select("id, availability")
      .in("id", venueIds);
    for (const v of (venueRows ?? []) as { id: string; availability: unknown }[]) {
      venueAvailability.set(v.id, parseAvailability(v.availability));
    }
  }

  const slotsByDate = buildSlotsByDate(data, venueAvailability);

  const { error: delErr } = await supabase
    .from("playoff_games")
    .delete()
    .eq("playoff_id", playoffId);
  if (delErr) return { success: false, error: delErr.message };

  let games: GameInsert[];
  const fmt: PlayoffFormat = data.format;

  if (fmt === "single_elimination") {
    games = buildSingleElimination(seeds, playoffId, leagueId, data.division_id, slotsByDate);
  } else if (fmt === "double_elimination") {
    games = buildDoubleElimination(seeds, playoffId, leagueId, data.division_id, slotsByDate);
  } else {
    games = buildRoundRobin(seeds, playoffId, leagueId, data.division_id, slotsByDate);
  }

  if (!games.length) {
    return { success: false, error: "No games could be generated." };
  }

  const { error: insErr } = await supabase.from("playoff_games").insert(games as never[]);
  if (insErr) return { success: false, error: insErr.message };

  await supabase
    .from("playoffs")
    .update({ status: "active", updated_at: new Date().toISOString() } as never)
    .eq("id", playoffId);

  // Games whose slot fell through to null (slots exhausted, or every
  // candidate filtered out by venue hours) — surfaced by the wizard so the
  // commissioner knows to place them manually.
  const tbdCount = games.filter((g) => g.scheduled_date === null).length;

  return { success: true, gamesCreated: games.length, tbdCount };
}
