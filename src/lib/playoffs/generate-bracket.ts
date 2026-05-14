"use client";

import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, SeededTeam, PlayoffFormat } from "@/components/playoffs/playoff-wizard-types";

// ─── Result type ──────────────────────────────────────────────────────────────

export type BracketResult =
  | { success: true; gamesCreated: number }
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

// ─── Slot helpers (mirrors generate-schedule.ts) ──────────────────────────────

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

function buildPlayoffSlots(data: PlayoffWizardData): Slot[] {
  if (!data.start_date || !data.end_date) return [];

  const venueIds = data.venue_assignments.map((v) => v.venue_id);
  if (!venueIds.length) return [];

  const allowedDays = new Set(
    data.playing_days.map((d) => DAY_TO_JS[d]).filter((n) => n !== undefined),
  );
  if (!allowedDays.size) return [];

  const slots: Slot[] = [];
  const cur = new Date(data.start_date + "T00:00:00");
  const end = new Date(data.end_date + "T00:00:00");

  while (cur <= end) {
    const dayJS = cur.getDay();
    const iso = localDateStr(cur);

    if (allowedDays.has(dayJS)) {
      // derive the 2-letter day key from DAY_TO_JS (reverse lookup)
      const dayKey = Object.entries(DAY_TO_JS).find(([, v]) => v === dayJS)?.[0];
      const win = dayKey ? data.day_windows[dayKey as keyof typeof data.day_windows] : undefined;
      const earliest = timeToMinutes(win?.start ?? "09:00");
      const latest = timeToMinutes(win?.end ?? "21:00");

      // 90 min slots (game) + 15 min buffer = 105 min spacing
      const interval = 105;
      let t = earliest;
      while (t <= latest) {
        for (const venueId of venueIds) {
          slots.push({ date: iso, time: minutesToTimeStr(t), venueId });
        }
        t += interval;
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  return slots;
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

// ─── Single elimination ────────────────────────────────────────────────────────

function buildSingleElimination(
  seeds: SeededTeam[],
  playoffId: string,
  leagueId: string,
  divisionId: string,
  slots: Slot[],
): GameInsert[] {
  const n = seeds.length;
  if (n < 2) return [];

  // Round up to next power of 2
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));

  // Top seeds get byes (seed 1 = index 0 gets bye if any)
  // Seeded positions: pair 1 vs bracketSize, 2 vs bracketSize-1, etc.
  // Teams with index >= (bracketSize - byeCount) get a bye in round 1
  const teamSlots: (SeededTeam | null)[] = [];
  for (let i = 0; i < bracketSize; i++) {
    teamSlots.push(seeds[i] ?? null); // null = bye
  }

  const games: GameInsert[] = [];
  let slotIdx = 0;
  let gameNumber = 1;
  let round = 1;
  let roundSize = bracketSize / 2;

  // Build all rounds as placeholder games; fill round 1 with actual teams
  // We only insert round-1 games (with known matchups) and placeholder games
  // for subsequent rounds (home/away null = TBD).

  // Round 1 — pair top seed vs bottom, etc. (1 vs N, 2 vs N-1)
  const r1Matchups: Array<{ home: SeededTeam | null; away: SeededTeam | null }> = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const home = teamSlots[i];
    const away = teamSlots[bracketSize - 1 - i];
    r1Matchups.push({ home, away });
  }

  // Filter out pure bye matchups (both null won't happen; one null = bye = auto-advance)
  const r1Games = r1Matchups.filter(
    (m) => !(m.home === null && m.away === null),
  );

  for (const m of r1Games) {
    const slot = slots[slotIdx++] ?? null;
    if (m.home !== null && m.away !== null) {
      // Real game
      games.push({
        playoff_id: playoffId,
        league_id: leagueId,
        division_id: divisionId,
        round: `R${round}`,
        game_number: gameNumber++,
        home_team_id: m.home.team_id,
        away_team_id: m.away.team_id,
        venue_id: slot?.venueId ?? null,
        scheduled_date: slot?.date ?? null,
        start_time: slot?.time ?? null,
        status: "scheduled",
      });
    }
    // If one is null (bye), the non-null team auto-advances — no game record needed
  }

  // Subsequent rounds — TBD placeholders
  round++;
  roundSize = roundSize / 2;
  while (roundSize >= 1) {
    const label =
      roundSize === 1 ? "F" : roundSize === 2 ? "SF" : `R${round}`;
    const count = roundSize;
    for (let i = 0; i < count; i++) {
      const slot = slots[slotIdx++] ?? null;
      games.push({
        playoff_id: playoffId,
        league_id: leagueId,
        division_id: divisionId,
        round: label,
        game_number: gameNumber++,
        home_team_id: null,
        away_team_id: null,
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
  slots: Slot[],
): GameInsert[] {
  const n = seeds.length;
  if (n < 2) return [];

  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const games: GameInsert[] = [];
  let slotIdx = 0;
  let gameNumber = 1;

  function mkGame(round: string, homeId: string | null, awayId: string | null): GameInsert {
    const slot = slots[slotIdx++] ?? null;
    return {
      playoff_id: playoffId,
      league_id: leagueId,
      division_id: divisionId,
      round,
      game_number: gameNumber++,
      home_team_id: homeId,
      away_team_id: awayId,
      venue_id: slot?.venueId ?? null,
      scheduled_date: slot?.date ?? null,
      start_time: slot?.time ?? null,
      status: "scheduled",
    };
  }

  // Winners bracket round 1 (known matchups)
  const wbR1Count = bracketSize / 2;
  for (let i = 0; i < wbR1Count; i++) {
    const home = seeds[i] ?? null;
    const away = seeds[bracketSize - 1 - i] ?? null;
    if (home && away) {
      games.push(mkGame("WB-R1", home.team_id, away.team_id));
    }
  }

  // Winners bracket remaining rounds (TBD)
  let wbRound = 2;
  let wbSize = wbR1Count / 2;
  while (wbSize >= 1) {
    const label = wbSize === 1 ? "WB-F" : `WB-R${wbRound}`;
    for (let i = 0; i < wbSize; i++) {
      games.push(mkGame(label, null, null));
    }
    wbRound++;
    wbSize = wbSize / 2;
  }

  // Losers bracket — number of rounds is 2*(log2(bracketSize) - 1)
  const totalWbRounds = Math.log2(bracketSize);
  let lbSize = bracketSize / 4; // LB starts with half of R1 losers per matchup
  for (let lbR = 1; lbR <= (totalWbRounds - 1) * 2; lbR++) {
    const count = Math.max(1, Math.ceil(lbSize));
    const label = lbR === (totalWbRounds - 1) * 2 ? "LB-F" : `LB-R${lbR}`;
    for (let i = 0; i < count; i++) {
      games.push(mkGame(label, null, null));
    }
    if (lbR % 2 === 0) lbSize = Math.max(1, lbSize / 2);
  }

  // Grand final (WB winner vs LB winner)
  games.push(mkGame("GF", null, null));
  // Optional reset game
  games.push(mkGame("GF-R", null, null));

  return games;
}

// ─── Round robin ─────────────────────────────────────────────────────────────

function buildRoundRobin(
  seeds: SeededTeam[],
  playoffId: string,
  leagueId: string,
  divisionId: string,
  slots: Slot[],
): GameInsert[] {
  const ids = seeds.map((s) => s.team_id);
  if (ids.length < 2) return [];

  const rounds = roundRobinRounds(ids);
  const games: GameInsert[] = [];
  let slotIdx = 0;
  let gameNumber = 1;

  rounds.forEach((round, rIdx) => {
    round.forEach(([homeId, awayId]) => {
      const slot = slots[slotIdx++] ?? null;
      games.push({
        playoff_id: playoffId,
        league_id: leagueId,
        division_id: divisionId,
        round: `RR${rIdx + 1}`,
        game_number: gameNumber++,
        home_team_id: homeId,
        away_team_id: awayId,
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

  // Load teams from division if no seeding provided
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

  const slots = buildPlayoffSlots(data);

  // Delete existing games for this playoff (idempotent re-generation)
  const { error: delErr } = await supabase
    .from("playoff_games")
    .delete()
    .eq("playoff_id", playoffId);
  if (delErr) return { success: false, error: delErr.message };

  let games: GameInsert[];
  const fmt: PlayoffFormat = data.format;

  if (fmt === "single_elimination") {
    games = buildSingleElimination(seeds, playoffId, leagueId, data.division_id, slots);
  } else if (fmt === "double_elimination") {
    games = buildDoubleElimination(seeds, playoffId, leagueId, data.division_id, slots);
  } else {
    games = buildRoundRobin(seeds, playoffId, leagueId, data.division_id, slots);
  }

  if (!games.length) {
    return { success: false, error: "No games could be generated." };
  }

  const { error: insErr } = await supabase.from("playoff_games").insert(games as never[]);
  if (insErr) return { success: false, error: insErr.message };

  // Update playoff status to active
  await supabase
    .from("playoffs")
    .update({ status: "active", updated_at: new Date().toISOString() } as never)
    .eq("id", playoffId);

  return { success: true, gamesCreated: games.length };
}
