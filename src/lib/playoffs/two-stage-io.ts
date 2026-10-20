"use client";

// Two-stage playoffs ("Round robin, then bracket") — the I/O half. Every rule
// and sentence lives in two-stage.ts (pure, `npm run sim:two-stage`); the
// database side is 0113 (replace_two_stage_games, seed_playoff_stage,
// acknowledge_stage_seeds). This file loads the inputs, runs the plan and
// calls those functions. A scheduling rule added here is one the harness
// cannot see — add it to two-stage.ts / bracket-plan.ts instead.

import { createClient } from "@/lib/supabase/client";
import type { PlayoffWizardData, SeededTeam } from "@/components/playoffs/playoff-wizard-types";
import { planSeeds } from "@/lib/playoffs/seeding";
import { planSettingsFromDivision } from "@/lib/playoffs/bracket-plan";
import { loadPlanVenues } from "@/lib/playoffs/generate-bracket";
import { bracketErrorMessage, gamesPayload } from "@/lib/playoffs/bracket-delete";
import { gameNumbering, type GameNumbering } from "@/lib/playoffs/bracket-labels";
import {
  parseTwoStageCounts,
  planTwoStage,
  seedOutcome,
  stage1SettingsPayload,
  stage2GamesPayload,
  stage2SettingsPayload,
  stage2Venues,
  twoStageBlockedMessage,
  twoStageErrorMessage,
  type SeedOutcome,
  type TwoStageCounts,
  type TwoStagePlan,
} from "@/lib/playoffs/two-stage";

const errorText = (raw: string) => twoStageErrorMessage(raw, bracketErrorMessage);

export type TwoStagePlanned =
  | {
      ok: true;
      plan: TwoStagePlan;
      teams: SeededTeam[];
      stage1Warnings: string[];
      stage2Warnings: string[];
      /** The chosen fields' names, for Review. */
      stage1Fields: string[];
      stage2Fields: string[];
    }
  | { ok: false; error: string };

/** Both stages planned from the wizard, with nothing written. */
export async function planTwoStageFromWizard(
  leagueId: string,
  data: PlayoffWizardData,
  ids: { stage1: string; stage2: string },
): Promise<TwoStagePlanned> {
  const supabase = createClient();
  let teams = planSeeds(data.seeding, data.excluded);
  if (!teams.length && !data.excluded.length) {
    const { data: rows, error } = await supabase
      .from("teams")
      .select("id, name")
      .eq("division_id", data.division_id)
      .order("name");
    if (error) return { ok: false, error: "Couldn't read this division's teams, so nothing was planned." };
    teams = ((rows ?? []) as { id: string; name: string }[]).map((t) => ({ team_id: t.id, team_name: t.name }));
  }

  const { data: div, error: divErr } = await supabase
    .from("divisions")
    .select("name, settings")
    .eq("id", data.division_id)
    .single();
  if (divErr || !div) {
    return { ok: false, error: "Couldn't read the division's game duration and buffer, so nothing was planned." };
  }
  const divRow = div as { name: string; settings: unknown };
  const settings = planSettingsFromDivision(divRow.settings);

  const v1 = await loadPlanVenues(supabase, data.venue_assignments.map((v) => v.venue_id));
  const v2 = data.stage2.same_fields
    ? v1
    : await loadPlanVenues(supabase, stage2Venues(data).map((v) => v.venue_id));

  const grid = (g: { start: string; end: string; days: string[]; windows: PlayoffWizardData["day_windows"] }, venues: typeof v1.venues) => ({
    startDate: g.start,
    endDate: g.end,
    playingDays: g.days,
    dayWindows: g.windows,
    venues,
    durationMin: settings.durationMin,
    bufferMin: settings.bufferMin,
  });
  const base = { leagueId, divisionId: data.division_id };
  const plan = planTwoStage({
    teams,
    advance: data.advance_count,
    ids: { stage1: { ...base, playoffId: ids.stage1 }, stage2: { ...base, playoffId: ids.stage2 } },
    stage1: {
      grid: grid({ start: data.start_date, end: data.end_date, days: data.playing_days, windows: data.day_windows }, v1.venues),
      gamesPerTeamPerDay: data.games_per_team_per_day,
    },
    stage2: {
      grid: grid(
        { start: data.stage2.start_date, end: data.stage2.end_date, days: data.stage2.playing_days, windows: data.stage2.day_windows },
        v2.venues,
      ),
      gamesPerTeamPerDay: data.stage2.games_per_team_per_day,
    },
    settings,
    divisionName: divRow.name || data.division_name,
  });
  return {
    ok: true,
    plan,
    teams,
    stage1Warnings: [...v1.warnings, ...plan.stage1.warnings],
    stage2Warnings: [...(data.stage2.same_fields ? [] : v2.warnings), ...plan.stage2.warnings],
    stage1Fields: v1.venues.map((v) => v.name),
    stage2Fields: v2.venues.map((v) => v.name),
  };
}

function rpcArgs(
  stage1Id: string,
  stage2Id: string,
  data: PlayoffWizardData,
  planned: Extract<TwoStagePlanned, { ok: true }>,
  stage2Only: boolean,
  commit: boolean,
) {
  return {
    p_stage1_id: stage1Id,
    p_settings1: stage2Only ? null : stage1SettingsPayload(data, planned.teams),
    p_games1: stage2Only ? null : gamesPayload(planned.plan.stage1.games),
    p_stage2_id: stage2Id,
    p_settings2: stage2SettingsPayload(data),
    p_games2: stage2GamesPayload(planned.plan.stage2.games),
    p_commit: commit,
  };
}

/** Stage 2's numbering, read only to word a refusal that names one of its
 *  games. A failed read names no game — never a stored position. */
async function stage2Numbering(
  supabase: ReturnType<typeof createClient>,
  stage2Id: string,
): Promise<GameNumbering | null> {
  const { data, error } = await supabase.from("playoff_games").select("game_number").eq("playoff_id", stage2Id);
  if (error || !data) return null;
  return gameNumbering(data as { game_number: number }[]);
}

export type TwoStagePreview =
  | { kind: "ok"; counts: TwoStageCounts }
  | { kind: "blocked"; reasons: string[]; message: string }
  | { kind: "unreadable"; message: string };

/** replace_two_stage_games's PREVIEW for an existing pair. Writes nothing. */
export async function previewTwoStage(
  stage1Id: string,
  stage2Id: string,
  data: PlayoffWizardData,
  planned: Extract<TwoStagePlanned, { ok: true }>,
  stage2Only: boolean,
): Promise<TwoStagePreview> {
  const supabase = createClient();
  const { data: reply, error } = await supabase.rpc(
    "replace_two_stage_games" as never,
    rpcArgs(stage1Id, stage2Id, data, planned, stage2Only, false) as never,
  );
  if (error) return { kind: "unreadable", message: errorText(error.message) };
  const r = (reply ?? null) as Record<string, unknown> | null;
  if (r && r.blocked === true) {
    return {
      kind: "blocked",
      reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
      message: twoStageBlockedMessage(r, await stage2Numbering(supabase, stage2Id)),
    };
  }
  const counts = parseTwoStageCounts(reply);
  if (!counts) {
    return {
      kind: "unreadable",
      message: "We couldn't check this setup's current games, so we can't tell you what generating will replace.",
    };
  }
  return { kind: "ok", counts };
}

export type TwoStageGenerated =
  | { ok: true; counts: TwoStageCounts }
  | { ok: false; error: string };

/**
 * Generate (or rebuild) both stages — or Stage 2 alone — in ONE call. A NEW
 * setup first inserts both rows as drafts (a plain INSERT each, never an
 * upsert — the unique (league, division, stage) refuses a second setup); if
 * the second insert or the call fails, the drafts are deleted again through
 * delete_playoff_bracket so nothing half-made is left behind.
 */
export async function generateTwoStage(input: {
  leagueId: string;
  data: PlayoffWizardData;
  planned: Extract<TwoStagePlanned, { ok: true }>;
  existing: { stage1Id: string; stage2Id: string } | null;
  stage2Only: boolean;
}): Promise<TwoStageGenerated> {
  const supabase = createClient();
  const { data, planned } = input;
  let ids = input.existing;
  let created = false;

  if (!ids) {
    const s1 = stage1SettingsPayload(data, planned.teams);
    const { data: row1, error: e1 } = await supabase
      .from("playoffs")
      .insert({
        league_id: input.leagueId,
        division_id: data.division_id,
        ...s1,
        stage: 1,
        status: "draft",
      } as never)
      .select("id")
      .single();
    if (e1 || !row1) {
      return { ok: false, error: e1?.code === "23505" ? "DUPLICATE" : `Nothing was saved. ${e1?.message ?? "The setup couldn't be created."}` };
    }
    const stage1Id = (row1 as { id: string }).id;
    const s2 = stage2SettingsPayload(data);
    const { data: row2, error: e2 } = await supabase
      .from("playoffs")
      .insert({
        league_id: input.leagueId,
        division_id: data.division_id,
        ...s2,
        stage: 2,
        parent_playoff_id: stage1Id,
        status: "draft",
      } as never)
      .select("id")
      .single();
    if (e2 || !row2) {
      await supabase.rpc("delete_playoff_bracket" as never, { p_playoff_id: stage1Id, p_commit: true } as never);
      return { ok: false, error: `Nothing was saved. ${e2?.message ?? "Stage 2 couldn't be created."}` };
    }
    ids = { stage1Id, stage2Id: (row2 as { id: string }).id };
    created = true;
  }

  const { data: reply, error } = await supabase.rpc(
    "replace_two_stage_games" as never,
    rpcArgs(ids.stage1Id, ids.stage2Id, data, planned, input.stage2Only, true) as never,
  );
  const r = (reply ?? null) as Record<string, unknown> | null;
  const counts = parseTwoStageCounts(reply);
  const message = error
    ? errorText(error.message)
    : r && r.blocked === true
      ? twoStageBlockedMessage(r, await stage2Numbering(supabase, ids.stage2Id))
      : !r || r.committed !== true || !counts
        ? "Nothing was saved. The save didn't confirm. Refresh the page to see what's there."
        : null;
  if (message) {
    if (created) {
      await supabase.rpc("delete_playoff_bracket" as never, { p_playoff_id: ids.stage1Id, p_commit: true } as never);
    }
    return { ok: false, error: message };
  }
  return { ok: true, counts: counts! };
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

/** seed_playoff_stage: `commit` false is the preview (writes nothing). */
export async function seedStage(
  stage2Id: string,
  orderIds: string[],
  commit: boolean,
  stage2Games: { game_number: number }[],
): Promise<SeedOutcome> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("seed_playoff_stage" as never, {
    p_stage2_id: stage2Id,
    p_order: orderIds,
    p_commit: commit,
  } as never);
  return seedOutcome(data, error, stage2Id, commit, errorText, gameNumbering(stage2Games));
}

/** "Seeds are still right": clears the re-check flag and logs it. */
export async function acknowledgeSeeds(stage2Id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("acknowledge_stage_seeds" as never, {
    p_stage2_id: stage2Id,
  } as never);
  if (error) return { ok: false, message: errorText(error.message) };
  const r = (data ?? null) as Record<string, unknown> | null;
  if (!r || r.stage2_id !== stage2Id) {
    return { ok: false, message: "Nothing was saved. The save didn't confirm. Refresh the page to see what's there." };
  }
  // cleared false = already cleared by someone else: the note is gone either way.
  return { ok: true };
}
