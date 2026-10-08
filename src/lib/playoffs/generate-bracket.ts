"use client";

// Playoff bracket generation — the I/O half. Every decision (bracket layout,
// byes, slot grid, spacing, round ordering, warnings) lives in bracket-plan.ts,
// which is pure and harness-driven (`npm run sim:playoff-bracket`). This file
// loads the inputs, runs the plan, and writes the rows. Keep it that way: a
// scheduling rule added here instead of in bracket-plan.ts is a rule the
// harness cannot see.

import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, SeededTeam } from "@/components/playoffs/playoff-wizard-types";
import { parseAvailability } from "@/lib/venues/availability";
import {
  DOUBLE_ELIM_SUPPORTED_COUNTS,
  planBracket,
  planSettingsFromDivision,
  type BracketPlan,
  type GameInsert,
  type PlanInput,
  type PlanVenue,
} from "@/lib/playoffs/bracket-plan";
import {
  commitOutcome,
  gamesPayload,
  parseRebuildCounts,
  settingsPayload,
  type RebuildCounts,
} from "@/lib/playoffs/bracket-delete";

export {
  buildSingleElimination,
  buildDoubleElimination,
  DOUBLE_ELIM_SUPPORTED_COUNTS,
} from "@/lib/playoffs/bracket-plan";

// ─── Result types ─────────────────────────────────────────────────────────────

export type BracketResult =
  | { success: true; gamesCreated: number; tbdCount: number; warnings: string[]; counts: RebuildCounts }
  | { success: false; error: string };

/** What the review step shows BEFORE the admin clicks Generate: the same plan
 *  the generate run would produce, with nothing written. `games` is the plan
 *  itself, so the review can ask replace_playoff_games for its preview. */
export type BracketPreflight =
  | { ok: true; gameCount: number; slotCount: number; tbdCount: number; warnings: string[]; games: GameInsert[] }
  | { ok: false; error: string };

// ─── Shared input loading ─────────────────────────────────────────────────────

type Supa = ReturnType<typeof createClient>;

type LoadedInputs =
  | { ok: true; input: PlanInput; extraWarnings: string[] }
  | { ok: false; error: string };

async function loadPlanInputs(
  supabase: Supa,
  playoffId: string,
  leagueId: string,
  data: PlayoffWizardData,
): Promise<LoadedInputs> {
  let seeds: SeededTeam[] = data.seeding;
  if (!seeds.length) {
    const { data: teams, error } = await supabase
      .from("teams")
      .select("id, name")
      .eq("division_id", data.division_id)
      .order("name");
    if (error) return { ok: false, error: error.message };
    seeds = (teams ?? []).map((t) => ({ team_id: t.id, team_name: t.name }));
  }

  if (seeds.length < 2) {
    return { ok: false, error: "Need at least 2 teams to generate a bracket." };
  }

  if (
    data.format === "double_elimination" &&
    !DOUBLE_ELIM_SUPPORTED_COUNTS.includes(seeds.length)
  ) {
    return {
      ok: false,
      error:
        `Double elimination needs exactly 2, 4, 8, 16, or 32 teams — this division has ${seeds.length}. ` +
        `Adjust the division's teams or pick a different format (bye rounds aren't supported for double elimination yet).`,
    };
  }

  // Spacing comes from the division: duration + buffer. A missing setting is
  // defaulted AND reported (bracket-plan's planSettingsFromDivision), never
  // assumed silently.
  const { data: div, error: divErr } = await supabase
    .from("divisions")
    .select("name, settings")
    .eq("id", data.division_id)
    .single();
  if (divErr || !div) {
    return { ok: false, error: "Couldn't read the division's game duration and buffer, so no bracket was generated." };
  }
  const divRow = div as { name: string; settings: unknown };
  const settings = planSettingsFromDivision(divRow.settings);

  const extraWarnings: string[] = [];
  const venueIds = data.venue_assignments.map((v) => v.venue_id);
  const venues: PlanVenue[] = [];
  if (venueIds.length > 0) {
    const { data: venueRows, error: venueErr } = await supabase
      .from("venues")
      .select("id, name, availability")
      .in("id", venueIds);
    const byId = new Map(
      ((venueRows ?? []) as { id: string; name: string; availability: unknown }[]).map((v) => [v.id, v]),
    );
    if (venueErr) {
      extraWarnings.push(
        "Couldn't read the fields' hours, so playoff times were not checked against them. Check each field's hours on the Venues page.",
      );
    }
    for (const id of venueIds) {
      const row = byId.get(id);
      venues.push({
        id,
        name: row?.name ?? "Field",
        // A venue missing from the read passes through unfiltered — the
        // wizard only offers configured venues, so missing means the fetch
        // failed, and blocking every slot would be worse.
        availability: row ? parseAvailability(row.availability) : null,
      });
    }
  }

  return {
    ok: true,
    extraWarnings,
    input: {
      format: data.format,
      seeds,
      ids: { playoffId, leagueId, divisionId: data.division_id },
      grid: {
        startDate: data.start_date,
        endDate: data.end_date,
        playingDays: data.playing_days,
        dayWindows: data.day_windows,
        venues,
        durationMin: settings.durationMin,
        bufferMin: settings.bufferMin,
      },
      settings,
      divisionName: divRow.name || data.division_name,
    },
  };
}

function runPlan(loaded: Extract<LoadedInputs, { ok: true }>): BracketPlan {
  const plan = planBracket(loaded.input);
  return { ...plan, warnings: [...loaded.extraWarnings, ...plan.warnings] };
}

// ─── Pre-flight (review step) ─────────────────────────────────────────────────

/** Runs the plan with a placeholder playoff id and writes nothing. */
export async function preflightBracket(
  leagueId: string,
  data: PlayoffWizardData,
): Promise<BracketPreflight> {
  const supabase = createClient();
  const loaded = await loadPlanInputs(supabase, "preflight", leagueId, data);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const plan = runPlan(loaded);
  return {
    ok: true,
    gameCount: plan.games.length,
    slotCount: plan.slots.length,
    tbdCount: plan.tbdCount,
    warnings: plan.warnings,
    games: plan.games,
  };
}

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generateBracket(
  playoffId: string,
  leagueId: string,
  data: PlayoffWizardData,
): Promise<BracketResult> {
  const supabase = createClient();

  // Every read and validation runs BEFORE anything is written, so an invalid
  // or unreadable plan never touches the bracket.
  const loaded = await loadPlanInputs(supabase, playoffId, leagueId, data);
  if (!loaded.ok) return { success: false, error: loaded.error };
  const plan = runPlan(loaded);

  if (!plan.games.length) {
    return { success: false, error: "No games could be generated." };
  }

  // THE ONLY WRITE: replace_playoff_games (0107) saves the settings, swaps the
  // games, marks the bracket active and logs it in ONE transaction, and
  // refuses while any game has a result. The old browser-side delete →
  // insert → status sequence is gone; never reintroduce a direct write to
  // playoff_games here.
  const { data: reply, error } = await supabase.rpc("replace_playoff_games" as never, {
    p_playoff_id: playoffId,
    p_settings: settingsPayload(data),
    p_games: gamesPayload(plan.games),
    p_commit: true,
  } as never);
  const outcome = commitOutcome(reply, error, parseRebuildCounts);
  if (!outcome.ok) return { success: false, error: outcome.message };

  return {
    success: true,
    gamesCreated: plan.games.length,
    tbdCount: plan.tbdCount,
    warnings: plan.warnings,
    counts: outcome.counts,
  };
}

/** replace_playoff_games's PREVIEW for the review step: what Generate would
 *  replace, whether results block it, and what is on the public schedule.
 *  Writes nothing. Null counts mean the preview could not be read — the
 *  review says "couldn't check", never zero. */
export async function previewRebuild(
  playoffId: string,
  data: PlayoffWizardData,
  games: GameInsert[],
): Promise<{ counts: RebuildCounts | null; error: string | null }> {
  const supabase = createClient();
  const { data: reply, error } = await supabase.rpc("replace_playoff_games" as never, {
    p_playoff_id: playoffId,
    p_settings: settingsPayload(data),
    p_games: gamesPayload(games),
    p_commit: false,
  } as never);
  if (error) return { counts: null, error: error.message };
  return { counts: parseRebuildCounts(reply), error: null };
}
