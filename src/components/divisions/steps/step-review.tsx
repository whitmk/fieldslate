"use client";

import { useState } from "react";
import {
  CheckCircle2, AlertTriangle, Edit2, Zap, Loader2,
  ExternalLink, X, Save, CalendarDays,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { logActivity } from "@/lib/activity-log";
import Link from "next/link";
import type { WizardData } from "../wizard-types";
import {
  generateSchedule,
  planScheduleForNewDivision,
  type NewDivisionPlannedGame,
  type ScheduleConflict,
} from "@/lib/schedule/generate-schedule";
import { getOfficialTitlePlural } from "@/lib/utils/official-title";
import { ensureSeasonRoleIds } from "@/lib/umpires/roles";
import { UpgradeModal, type CapName } from "@/components/plan/upgrade-cta";
import type { Plan } from "@/lib/plan/limits";

type GenerateKind = "games";

const FORMAT_LABELS = {
  round_robin: "Round robin",
  balanced: "Balanced",
  pool_play: "Pool play",
} as const;

interface Props {
  data: WizardData;
  originalData?: WizardData; // populated when editing; used for change analysis
  leagueId: string;
  /** Resolved by the wizard's parent — used by the new-division atomic flow
   *  to scope the venue-availability lookup. */
  currentOrgId: string;
  sport?: string | null;
  onEdit: (step: number) => void;
  /** Fires from the result panels' Close/View actions. Carries the saved
   *  division's id so embedders (the /setup loop) can name their follow-up
   *  screen — optional arg, so existing no-arg handlers stay valid. */
  onComplete: (savedDivisionId?: string) => void;
  divisionId?: string;
  /** Org-wide team count + cap as of wizard mount. Used for the upfront
   *  cap check inside saveDivisionData so a Free user with the team cap
   *  in range doesn't get a partially-saved division. The per-team RPC
   *  remains the authoritative server-side enforcement; this is UX. */
  teamCount: number;
  teamLimit: number;
  plan: Plan;
}

function Section({
  title, step, onEdit, children,
}: {
  title: string; step: number; onEdit: (s: number) => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#0C1F3F]">{title}</p>
        <button
          type="button"
          onClick={() => onEdit(step)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#22C55E] hover:underline"
        >
          <Edit2 className="h-3 w-3" />
          Edit
        </button>
      </div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-medium text-[#0C1F3F]">{value || "—"}</span>
    </div>
  );
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmt(date: string) {
  if (!date) return "—";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtConflictDate(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}

// ─── Result types ──────────────────────────────────────────────────────────────

type RegenResult = {
  kind: GenerateKind;
  gamesCreated?: number;
  unscheduledCount?: number;
  // Subset of unscheduledCount blocked by team_game_constraints (0076).
  // Undefined on the new-division plan path, which is exempt by design.
  constraintBlockedCount?: number;
  // Games placed outside team preferences (pass 2). Informational only.
  preferMissCount?: number;
  conflicts: ScheduleConflict[];
  savedDivisionId: string;
};

type SaveOnlyResult = {
  savedDivisionId: string;
  warnings: string[];
};

// ─── Component ─────────────────────────────────────────────────────────────────

export function StepReview({
  data, originalData, leagueId, currentOrgId, sport, onEdit, onComplete, divisionId,
  teamCount, teamLimit, plan,
}: Props) {
  const officialsPlural = getOfficialTitlePlural(sport);
  const [savingOnly, setSavingOnly] = useState(false);
  const [savingRegen, setSavingRegen] = useState(false);
  const [regenKind, setRegenKind] = useState<GenerateKind | null>(null);
  const [confirmingKind, setConfirmingKind] = useState<GenerateKind | null>(null);
  const [error, setError] = useState("");
  const [regenResult, setRegenResult] = useState<RegenResult | null>(null);
  const [saveOnlyResult, setSaveOnlyResult] = useState<SaveOnlyResult | null>(null);
  const [capHit, setCapHit] = useState<
    | { cap: CapName; limit: number; plan: Plan }
    | null
  >(null);
  const router = useRouter();

  // Edit mode = wizard was opened via the Edit menu (divisionId prop set).
  // New mode = wizard creates a brand-new division. New mode now writes the
  // division, teams, venues, interleague configs, and games in ONE atomic
  // create_division_atomic RPC, so there is no intermediate partially-saved
  // state to track. (Previously we kept a `createdDivId` to switch into
  // edit-mode-on-retry, but the atomic path makes that unnecessary.)
  const isEditMode = !!divisionId;
  const conflictCount = data.teams.filter((t) => t.has_coach_conflict).length;
  const hasConflicts = conflictCount > 0;
  const canSubmit = !!data.name.trim() && !!data.start_date && !!data.end_date;
  const isBusy = savingOnly || savingRegen;

  // Derive legacy earliest/latest from first enabled day for backward compat
  const firstDay = data.playing_days[0];
  const firstWin = firstDay ? (data.day_windows[firstDay] ?? { start: "09:00", end: "17:00" }) : { start: "09:00", end: "17:00" };

  const settingsPayload = {
    games_per_team: data.games_per_team,
    max_games_per_week: data.max_games_per_week,
    max_games_per_team_per_day: data.max_games_per_team_per_day,
    playing_days: data.playing_days,
    day_windows: data.day_windows,
    use_league_schedule: data.use_league_schedule,
    // Backward-compat fields — schedule generator uses day_windows when present
    earliest_start: firstWin.start,
    latest_start: firstWin.end,
    game_duration: data.game_duration,
    buffer_minutes: data.buffer_minutes,
    max_games_per_field_per_day: data.max_games_per_field_per_day,
    bye_weeks: data.bye_weeks,
    format: data.format,
    auto_rotate: data.auto_rotate,
    teams: data.teams,
  };

  // ── Persistence ────────────────────────────────────────────────────────────
  //
  // Two paths share one return shape. Callers branch on isEditMode.
  //
  // Edit mode (saveEditDivisionData): UPDATE division + wipe/replace venues
  // + per-team RPC for net-new names + wipe/replace interleague configs +
  // optional league schedule update. Multi-step but idempotent on retry.
  //
  // New mode (createNewDivisionAtomic): a single create_division_atomic RPC
  // that wraps the division row, teams, venues, interleague configs, AND
  // (optionally) the planned game schedule in ONE transaction. If any step
  // fails — including schedule planning being infeasible — nothing persists.

  type SaveResult =
    | { divId: string }
    | { error: string }
    | { capHit: { cap: CapName; limit: number; plan: Plan } };

  const nonBlankTeams = data.teams.filter((t) => t.name.trim() !== "");

  async function saveEditDivisionData(): Promise<SaveResult> {
    const supabase = createClient();
    // Narrow the optional prop locally — this function is only called when
    // isEditMode is true, which guarantees divisionId is set.
    const divId = divisionId as string;

    // Upfront team-cap check — net-new teams only (existing names dedupe).
    if (teamLimit !== -1 && nonBlankTeams.length > 0) {
      const { data: existing } = await supabase
        .from("teams").select("name").eq("division_id", divId);
      const existingNames = new Set(
        (existing ?? []).map((t: { name: string }) => t.name.toLowerCase().trim())
      );
      const newTeamCount = nonBlankTeams.filter(
        (t) => !existingNames.has(t.name.toLowerCase().trim())
      ).length;
      if (teamCount + newTeamCount > teamLimit) {
        return { capHit: { cap: "teamsPerOrg", limit: teamLimit, plan } };
      }
    }

    const { error: updateError } = await supabase
      .from("divisions")
      .update({
        name: data.name.trim(),
        team_count: data.team_count,
        start_date: data.start_date || null,
        end_date: data.end_date || null,
        settings: settingsPayload,
        umpires_per_game: data.umpires_per_game,
        umpire_roles: data.umpire_roles,
        plays_interleague: data.plays_interleague,
        intra_division_games_per_team: data.games_per_team,
      } as never)
      .eq("id", divId);

    if (updateError) return { error: updateError.message };

    await supabase.from("division_venues").delete().eq("division_id", divId);
    if (data.venue_assignments.length > 0) {
      await supabase
        .from("division_venues")
        .insert(data.venue_assignments.map((a) => ({
          division_id: divId,
          venue_id: a.venue_id,
          allow_games: a.allow_games,
        })) as never[]);
    }

    // Insert net-new teams via the per-team RPC (server-side cap check).
    if (nonBlankTeams.length > 0) {
      const { data: existing } = await supabase
        .from("teams").select("name").eq("division_id", divId);
      const existingNames = new Set(
        (existing ?? []).map((t: { name: string }) => t.name.toLowerCase().trim())
      );
      const teamsToCreate = nonBlankTeams.filter(
        (t) => !existingNames.has(t.name.toLowerCase().trim())
      );
      for (const t of teamsToCreate) {
        const { data: teamRpc, error: teamErr } = await supabase.rpc(
          "create_team" as never,
          { p_league_id: leagueId, p_division_id: divId, p_name: t.name.trim() } as never,
        );
        if (teamErr) return { error: teamErr.message };
        const teamPayload = teamRpc as
          | { row: { id: string } }
          | { error: "cap_reached"; cap: CapName; limit: number; plan: Plan };
        if ("error" in teamPayload && teamPayload.error === "cap_reached") {
          return {
            capHit: {
              cap: teamPayload.cap,
              limit: teamPayload.limit,
              plan: teamPayload.plan,
            },
          };
        }
      }
    }

    if (data.use_league_schedule) {
      await supabase
        .from("leagues")
        .update({
          schedule_settings: {
            playing_days: data.playing_days,
            day_windows: data.day_windows,
          },
        } as never)
        .eq("id", leagueId);
    }

    // Sync interleague game counts — wipe+replace so removals are handled.
    await supabase.from("division_interleague_games").delete().eq("division_id", divId);
    const nonZeroGames = data.interleague_games.filter((g) => g.game_count > 0);
    if (nonZeroGames.length > 0) {
      await supabase.from("division_interleague_games").insert(
        nonZeroGames.map((g) => ({
          division_id: divId,
          interleague_org_id: g.interleague_org_id,
          game_count: g.game_count,
          home_games_per_team: Math.max(
            0,
            Math.min(g.game_count, g.home_games_per_team ?? g.game_count),
          ),
        })) as never[]
      );
    }

    // Keep the season's normalized role list (official_roles, 0062) a
    // superset of this division's slot labels. Best-effort: assignment
    // writes re-resolve ids anyway, so this must never fail the save.
    await ensureSeasonRoleIds(supabase, leagueId, data.umpire_roles);

    return { divId };
  }

  async function createNewDivisionAtomic(
    plannedGames: NewDivisionPlannedGame[],
  ): Promise<SaveResult> {
    const supabase = createClient();

    // Upfront team-cap check — atomic RPC will reject too, but failing fast
    // before the planner runs is a slightly nicer UX.
    if (teamLimit !== -1 && nonBlankTeams.length > 0) {
      if (teamCount + nonBlankTeams.length > teamLimit) {
        return { capHit: { cap: "teamsPerOrg", limit: teamLimit, plan } };
      }
    }

    const nonZeroInterleague = data.interleague_games.filter((g) => g.game_count > 0);

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "create_division_atomic" as never,
      {
        p_league_id: leagueId,
        p_division: {
          name: data.name.trim(),
          team_count: data.team_count,
          start_date: data.start_date || "",
          end_date: data.end_date || "",
          settings: settingsPayload,
          umpires_per_game: data.umpires_per_game,
          umpire_roles: data.umpire_roles,
          plays_interleague: data.plays_interleague,
          intra_division_games_per_team: data.games_per_team,
        },
        p_team_names: nonBlankTeams.map((t) => t.name.trim()),
        p_venue_assignments: data.venue_assignments.map((a) => ({
          venue_id: a.venue_id,
          allow_games: a.allow_games,
        })),
        p_interleague_games: nonZeroInterleague.map((g) => ({
          interleague_org_id: g.interleague_org_id,
          game_count: g.game_count,
          home_games_per_team: Math.max(
            0,
            Math.min(g.game_count, g.home_games_per_team ?? g.game_count),
          ),
        })),
        p_games: plannedGames.map((g) => ({
          home_team_name: g.home_team_name,
          away_team_name: g.away_team_name,
          interleague_org_id: g.interleague_org_id,
          venue_id: g.venue_id,
          scheduled_at: g.scheduled_at,
          status: g.status,
          is_away: g.is_away,
        })),
        p_use_league_schedule_settings: data.use_league_schedule
          ? {
              playing_days: data.playing_days,
              day_windows: data.day_windows,
            }
          : null,
      } as never,
    );

    if (rpcError) return { error: rpcError.message };

    const payload = rpcData as
      | { row: { id: string } }
      | { error: "cap_reached"; cap: CapName; limit: number; plan: Plan };

    if ("error" in payload && payload.error === "cap_reached") {
      return {
        capHit: { cap: payload.cap, limit: payload.limit, plan: payload.plan },
      };
    }

    // Same official_roles sync as the edit path — see saveEditDivisionData.
    await ensureSeasonRoleIds(supabase, leagueId, data.umpire_roles);

    return { divId: (payload as { row: { id: string } }).row.id };
  }

  // ── "Save changes" — no schedule touch ────────────────────────────────────

  async function handleSaveOnly() {
    setSavingOnly(true);
    setError("");

    // Edit: UPDATE-flavored save (no games touched). New: atomic create with
    // an empty game schedule (user can generate later from the division view).
    const saved = isEditMode
      ? await saveEditDivisionData()
      : await createNewDivisionAtomic([]);
    if ("capHit" in saved) {
      setCapHit(saved.capHit);
      setSavingOnly(false);
      return;
    }
    if ("error" in saved) { setError(saved.error); setSavingOnly(false); return; }
    const { divId } = saved;

    // Load existing games and analyze against new params
    const supabase = createClient();
    const warnings: string[] = [];

    const { data: teamRows } = await supabase
      .from("teams").select("id").eq("division_id", divId);
    const teamIds = (teamRows ?? []).map((t: { id: string }) => t.id);

    if (teamIds.length > 0) {
      type ExGame = {
        id: string; scheduled_at: string;
        venue_id: string | null; home_team_id: string; away_team_id: string;
      };

      const { data: gamesRaw } = await supabase
        .from("games")
        .select("id, scheduled_at, venue_id, home_team_id, away_team_id")
        .in("home_team_id", teamIds);
      const games = (gamesRaw ?? []) as unknown as ExGame[];

      if (games.length > 0) {
        // Per-team game counts
        const countByTeam: Record<string, number> = {};
        for (const g of games) {
          countByTeam[g.home_team_id] = (countByTeam[g.home_team_id] ?? 0) + 1;
          countByTeam[g.away_team_id] = (countByTeam[g.away_team_id] ?? 0) + 1;
        }

        // Games-per-team target changed
        if (originalData && data.games_per_team !== originalData.games_per_team) {
          const delta = data.games_per_team - originalData.games_per_team;
          if (delta > 0) {
            const totalDeficit = teamIds.reduce(
              (s, id) => s + Math.max(0, data.games_per_team - (countByTeam[id] ?? 0)), 0
            );
            const needed = Math.round(totalDeficit / 2);
            if (needed > 0) {
              warnings.push(
                `Games per team increased from ${originalData.games_per_team} to ${data.games_per_team} — ` +
                `${needed} game${needed !== 1 ? "s" : ""} still need to be scheduled.`
              );
            }
          } else {
            const teamsOver = teamIds.filter(
              (id) => (countByTeam[id] ?? 0) > data.games_per_team
            ).length;
            if (teamsOver > 0) {
              warnings.push(
                `Games per team reduced to ${data.games_per_team} — ` +
                `${teamsOver} team${teamsOver !== 1 ? "s have" : " has"} more games than the new target.`
              );
            }
          }
        }

        // Games outside the new date range
        const gamesBeforeStart = data.start_date
          ? games.filter((g) => g.scheduled_at.substring(0, 10) < data.start_date).length
          : 0;
        const gamesAfterEnd = data.end_date
          ? games.filter((g) => g.scheduled_at.substring(0, 10) > data.end_date).length
          : 0;
        if (gamesAfterEnd > 0) {
          warnings.push(
            `Season end date shortened — ${gamesAfterEnd} game${gamesAfterEnd !== 1 ? "s" : ""} fall after the new end date.`
          );
        }
        if (gamesBeforeStart > 0) {
          warnings.push(
            `Season start date moved later — ${gamesBeforeStart} game${gamesBeforeStart !== 1 ? "s" : ""} fall before the new start date.`
          );
        }

        // Venue changes
        if (originalData) {
          const oldVenueSet = new Set(originalData.venue_assignments.map((a) => a.venue_id));
          const newVenueSet = new Set(data.venue_assignments.map((a) => a.venue_id));
          const addedVenues = data.venue_assignments.filter((a) => !oldVenueSet.has(a.venue_id)).map((a) => a.venue_id);
          const removedVenues = originalData.venue_assignments.filter((a) => !newVenueSet.has(a.venue_id)).map((a) => a.venue_id);

          if (addedVenues.length > 0) {
            warnings.push(
              `${addedVenues.length} new field${addedVenues.length !== 1 ? "s" : ""} added — ` +
              `regenerate the schedule to include ${addedVenues.length !== 1 ? "them" : "it"}.`
            );
          }
          if (removedVenues.length > 0) {
            const affected = games.filter(
              (g) => g.venue_id && removedVenues.includes(g.venue_id)
            ).length;
            if (affected > 0) {
              warnings.push(
                `${affected} game${affected !== 1 ? "s are" : " is"} assigned to ` +
                `${removedVenues.length !== 1 ? "fields" : "a field"} that ${removedVenues.length !== 1 ? "were" : "was"} removed.`
              );
            }
          }
        }

        // Playing days changed — games on days no longer in schedule
        if (originalData) {
          const oldDays = [...originalData.playing_days].sort().join(",");
          const newDays = [...data.playing_days].sort().join(",");
          if (oldDays !== newDays) {
            const DAY_ABBR_TO_JS: Record<string, number> = {
              Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
            };
            const allowedDays = new Set(data.playing_days.map((d) => DAY_ABBR_TO_JS[d]));
            const wrongDay = games.filter((g) => {
              const jsDay = new Date(g.scheduled_at.substring(0, 10) + "T00:00:00").getDay();
              return !allowedDays.has(jsDay);
            }).length;
            if (wrongDay > 0) {
              warnings.push(
                `${wrongDay} game${wrongDay !== 1 ? "s are" : " is"} scheduled on ` +
                `day${wrongDay !== 1 ? "s" : ""} no longer in the playing schedule.`
              );
            }
          }
        }
      }
    }

    router.refresh();
    setSavingOnly(false);
    setSaveOnlyResult({ savedDivisionId: divId, warnings });
  }

  // ── "Save & generate" — wipes + rebuilds schedule for the chosen kind ─────

  async function handleSaveAndGenerate(kind: GenerateKind) {
    setSavingRegen(true);
    setRegenKind(kind);
    setError("");
    setConfirmingKind(null);

    if (isEditMode) {
      // Edit-mode flow stays as before: persist the wizard changes, then
      // wipe+rebuild the schedule against the now-updated division row.
      const saved = await saveEditDivisionData();
      if ("capHit" in saved) {
        setCapHit(saved.capHit);
        setSavingRegen(false);
        setRegenKind(null);
        return;
      }
      if ("error" in saved) {
        setError(saved.error);
        setSavingRegen(false);
        setRegenKind(null);
        return;
      }
      const { divId } = saved;
      const result: RegenResult = { kind, conflicts: [], savedDivisionId: divId };

      const gameRes = await generateSchedule(divId);
      if (!gameRes.success) {
        setError(`Division saved, but game schedule generation failed: ${gameRes.error}`);
        setSavingRegen(false);
        setRegenKind(null);
        return;
      }
      result.gamesCreated = gameRes.gamesCreated;
      result.unscheduledCount = gameRes.unscheduledCount;
      result.constraintBlockedCount = gameRes.constraintBlockedCount;
      result.preferMissCount = gameRes.preferMissCount;
      result.conflicts = gameRes.conflicts;
      await logActivity(
        leagueId,
        divId,
        "schedule_generated",
        `${data.name} schedule generated — ${gameRes.gamesCreated} game${gameRes.gamesCreated === 1 ? "" : "s"} scheduled`,
      );

      router.refresh();
      setSavingRegen(false);
      setRegenKind(null);
      setRegenResult(result);
      return;
    }

    // New-division atomic flow: plan client-side, then ONE RPC writes the
    // division, teams, venues, interleague configs, AND games in a single
    // transaction. If planning is infeasible OR the RPC fails for any
    // reason, nothing is written — no orphan divisions, no duplicate
    // divisions on retry.
    const planResult = await planScheduleForNewDivision({
      leagueId,
      currentOrgId,
      startDate: data.start_date,
      endDate: data.end_date,
      settings: settingsPayload as never,
      intraDivisionGamesPerTeam: data.games_per_team,
      teamNames: nonBlankTeams.map((t) => t.name.trim()),
      venueAssignments: data.venue_assignments.map((a) => ({
        venue_id: a.venue_id,
        allow_games: a.allow_games,
      })),
      interleagueGames: data.interleague_games
        .filter((g) => g.game_count > 0)
        .map((g) => ({
          interleague_org_id: g.interleague_org_id,
          game_count: g.game_count,
          home_games_per_team: Math.max(
            0,
            Math.min(g.game_count, g.home_games_per_team ?? g.game_count),
          ),
        })),
    });

    if (!planResult.success) {
      setError(`Could not generate game schedule: ${planResult.error}`);
      setSavingRegen(false);
      setRegenKind(null);
      return;
    }

    const saved = await createNewDivisionAtomic(planResult.games);
    if ("capHit" in saved) {
      setCapHit(saved.capHit);
      setSavingRegen(false);
      setRegenKind(null);
      return;
    }
    if ("error" in saved) {
      setError(saved.error);
      setSavingRegen(false);
      setRegenKind(null);
      return;
    }
    const { divId } = saved;

    const result: RegenResult = {
      kind,
      conflicts: [],
      savedDivisionId: divId,
      gamesCreated: planResult.games.length,
      unscheduledCount: planResult.unscheduledCount,
    };

    await logActivity(
      leagueId,
      divId,
      "schedule_generated",
      `${data.name} schedule generated — ${result.gamesCreated} game${result.gamesCreated === 1 ? "" : "s"} scheduled`,
    );

    router.refresh();
    setSavingRegen(false);
    setRegenKind(null);
    setRegenResult(result);
  }

  // ── Post-regen result panel ────────────────────────────────────────────────

  if (regenResult) {
    const hasUnscheduled = (regenResult.unscheduledCount ?? 0) > 0;
    const hasFieldConflicts = regenResult.conflicts.length > 0;
    const hasIssues = hasUnscheduled || hasFieldConflicts;

    const headerTitle = hasIssues
      ? "Game schedule generated with issues"
      : "Game schedule generated";

    return (
      <div className="flex flex-col gap-5">
        <div className={`flex items-start gap-3 rounded-xl px-4 py-4 ${hasIssues ? "bg-amber-50" : "bg-[#22C55E]/10"}`}>
          {hasIssues
            ? <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            : <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#22C55E]" />}
          <div className="min-w-0">
            <p className={`font-semibold ${hasIssues ? "text-amber-800" : "text-[#22C55E]"}`}>
              {headerTitle}
            </p>
            <p className={`mt-0.5 text-sm ${hasIssues ? "text-amber-700" : "text-[#22C55E]/80"}`}>
              {regenResult.gamesCreated !== undefined && (
                <>
                  {regenResult.gamesCreated} game{regenResult.gamesCreated !== 1 ? "s" : ""} scheduled
                </>
              )}
            </p>
            {/* Informational, not a warning — preferences are best-effort. */}
            {(regenResult.preferMissCount ?? 0) > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {regenResult.preferMissCount} game{regenResult.preferMissCount !== 1 ? "s" : ""} placed
                outside team preferences — the schedule was too tight to avoid
                those windows, and every hard rule was still honored.
              </p>
            )}
          </div>
        </div>

        {hasUnscheduled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {regenResult.unscheduledCount} matchup{regenResult.unscheduledCount !== 1 ? "s" : ""} could not be scheduled
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  {(regenResult.constraintBlockedCount ?? 0) > 0
                    ? `${regenResult.constraintBlockedCount} of these were blocked by team scheduling constraints — review those teams' constraint windows or place the games manually. Any others ran out of slots: try extending dates, adding venues, or reducing games per team.`
                    : "Not enough slots. Try extending dates, adding venues, or reducing games per team."}
                </p>
              </div>
            </div>
          </div>
        )}

        {hasFieldConflicts && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-800">
                  {regenResult.conflicts.reduce((n, c) => n + c.games.length, 0)} field conflicts detected
                </p>
                <ul className="mt-2 space-y-2">
                  {regenResult.conflicts.map((conflict, ci) => (
                    <li key={ci} className="text-xs text-red-700">
                      <span className="font-semibold">{conflict.venueName}</span>
                      {" — "}
                      {fmtConflictDate(conflict.date)}
                      <ul className="mt-1 ml-3 space-y-0.5">
                        {conflict.games.map((g) => (
                          <li key={g.id}>
                            {g.timeLabel}{" · "}{g.homeTeam} vs {g.awayTeam}
                            {g.divisionName && <span className="ml-1 text-red-500">({g.divisionName})</span>}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/dashboard/schedule?division=${regenResult.savedDivisionId}`}
                  onClick={() => onComplete(regenResult.savedDivisionId)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-900"
                >
                  View schedule <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => onComplete(regenResult.savedDivisionId)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0C1F3F] py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#0C1F3F]/80"
        >
          <X className="h-5 w-5" />
          Close
        </button>
      </div>
    );
  }

  // ── Post-save-only result panel ────────────────────────────────────────────

  if (saveOnlyResult) {
    const { warnings } = saveOnlyResult;

    return (
      <div className="flex flex-col gap-5">
        <div className={`flex items-start gap-3 rounded-xl px-4 py-4 ${warnings.length > 0 ? "bg-amber-50" : "bg-[#22C55E]/10"}`}>
          {warnings.length > 0
            ? <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            : <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#22C55E]" />}
          <div>
            <p className={`font-semibold ${warnings.length > 0 ? "text-amber-800" : "text-[#22C55E]"}`}>
              {warnings.length > 0 ? "Changes saved — review warnings below" : "Changes saved"}
            </p>
            <p className={`mt-0.5 text-sm ${warnings.length > 0 ? "text-amber-700" : "text-[#22C55E]/80"}`}>
              Division parameters updated. The existing schedule was not modified.
            </p>
          </div>
        </div>

        {warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <p className="text-sm text-amber-800">{w}</p>
          </div>
        ))}

        <button
          type="button"
          onClick={() => onComplete(saveOnlyResult.savedDivisionId)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0C1F3F] py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#0C1F3F]/80"
        >
          <X className="h-5 w-5" />
          Close
        </button>
      </div>
    );
  }

  // ── Review form ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">
          {isEditMode ? "Review & update" : "Review & generate"}
        </h3>
        <p className="mt-0.5 text-sm text-gray-500">
          {isEditMode
            ? "Confirm your changes. Save without touching the schedule, or regenerate from scratch."
            : "Confirm your settings, then generate the schedule."}
        </p>
      </div>

      {/* Coach-conflict status */}
      <div className={`flex items-start gap-3 rounded-xl px-4 py-3 ${hasConflicts ? "bg-amber-50" : "bg-[#22C55E]/10"}`}>
        {hasConflicts
          ? <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#22C55E]" />}
        <p className={`text-sm font-medium ${hasConflicts ? "text-amber-700" : "text-[#22C55E]"}`}>
          {hasConflicts
            ? `${conflictCount} coach conflict${conflictCount > 1 ? "s" : ""} flagged — scheduler will avoid same-day matchups`
            : "No conflicts detected — ready to generate"}
        </p>
      </div>

      <Section title="Basics" step={0} onEdit={onEdit}>
        <Row label="Division name" value={data.name} />
        <Row label="Teams" value={data.team_count} />
        <Row
          label="Dates"
          value={data.start_date && data.end_date ? `${fmt(data.start_date)} → ${fmt(data.end_date)}` : "—"}
        />
      </Section>

      <Section title="Playing schedule" step={1} onEdit={onEdit}>
        <Row label="Schedule scope" value={data.use_league_schedule ? "Season-wide" : "Per division"} />
        <Row label="Max per week" value={data.max_games_per_week} />
        <Row label="Max per day" value={data.max_games_per_team_per_day} />
        <Row
          label="Game days"
          value={
            data.playing_days.length > 0
              ? data.playing_days.map((d) => {
                  const w = data.day_windows[d];
                  return w ? `${d} (${fmtTime(w.start)}–${fmtTime(w.end)})` : d;
                }).join(", ")
              : "—"
          }
        />
        <Row label="Game duration" value={`${data.game_duration} min`} />
        <Row label="Buffer" value={`${data.buffer_minutes} min`} />
        <Row label="Bye weeks" value={data.bye_weeks} />
      </Section>

      <Section title="Fields" step={2} onEdit={onEdit}>
        {data.venue_assignments.length === 0 ? (
          <Row label="Fields selected" value="None" />
        ) : (
          <Row label="Fields selected" value={`${data.venue_assignments.length} venue${data.venue_assignments.length > 1 ? "s" : ""}`} />
        )}
      </Section>

      <Section title={officialsPlural} step={5} onEdit={onEdit}>
        <Row
          label={`${officialsPlural} per game`}
          value={
            data.umpires_per_game === 0
              ? "Not required"
              : data.umpires_per_game
          }
        />
        {data.umpires_per_game > 0 && (
          <Row
            label="Roles"
            value={data.umpire_roles.filter((r) => r.trim() !== "").join(", ") || "—"}
          />
        )}
      </Section>

      <Section title="Format" step={3} onEdit={onEdit}>
        {(() => {
          const interleagueGames = data.plays_interleague
            ? data.interleague_games.reduce((s, g) => s + g.game_count, 0)
            : 0;
          const totalPerTeam = data.games_per_team + interleagueGames;
          return (
            <div className="mb-1 rounded-lg bg-[#0C1F3F]/5 px-3 py-2.5">
              <p className="text-xs text-gray-500">
                Each team plays{" "}
                <span className="font-semibold text-[#0C1F3F]">{data.games_per_team}</span> intra-division game{data.games_per_team !== 1 ? "s" : ""}
                {data.plays_interleague && interleagueGames > 0 && (
                  <>
                    {" "}+{" "}
                    <span className="font-semibold text-[#0C1F3F]">{interleagueGames}</span> interleague game{interleagueGames !== 1 ? "s" : ""}
                  </>
                )}
                {" "}={" "}
                <span className="font-semibold text-[#0C1F3F]">{totalPerTeam}</span> total game{totalPerTeam !== 1 ? "s" : ""} per team
              </p>
            </div>
          );
        })()}
        <Row label="Format" value={FORMAT_LABELS[data.format]} />
        <Row label="Home/away rotation" value={data.auto_rotate ? "Yes" : "No"} />
      </Section>

      {data.plays_interleague && (
        <Section title="Interleague" step={6} onEdit={onEdit}>
          {data.interleague_games.filter((g) => g.game_count > 0).length === 0 ? (
            <Row label="Games configured" value="None" />
          ) : (
            <>
              {data.interleague_games
                .filter((g) => g.game_count > 0)
                .map((g) => {
                  const home = Math.max(0, Math.min(g.game_count, g.home_games_per_team ?? g.game_count));
                  const away = g.game_count - home;
                  return (
                    <Row
                      key={g.interleague_org_id}
                      label={g.org_name}
                      value={`${g.game_count} per team (${home} home / ${away} away)`}
                    />
                  );
                })}
              <Row
                label="Total per team"
                value={`${data.interleague_games.reduce((s, g) => s + g.game_count, 0)} games`}
              />
            </>
          )}
        </Section>
      )}

      <Section title="Coaches" step={4} onEdit={onEdit}>
        <Row label="Coach conflicts" value={conflictCount > 0 ? `${conflictCount} flagged` : "None"} />
      </Section>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* ── Buttons ── */}
      {confirmingKind ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2.5 mb-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <p className="text-sm text-amber-800">
              This will delete all existing games and rebuild the game schedule from scratch. Are you sure?
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleSaveAndGenerate(confirmingKind)}
              disabled={savingRegen}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#22C55E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:opacity-60"
            >
              {savingRegen ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
              ) : (
                <><Zap className="h-4 w-4" />Confirm &amp; generate</>
              )}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingKind(null)}
              disabled={savingRegen}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => (isEditMode ? setConfirmingKind("games") : handleSaveAndGenerate("games"))}
            disabled={isBusy || !canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C55E] py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingRegen && regenKind === "games" ? (
              <><Loader2 className="h-5 w-5 animate-spin" />Generating…</>
            ) : (
              <><CalendarDays className="h-5 w-5" />Generate game schedule</>
            )}
          </button>

          <button
            type="button"
            onClick={handleSaveOnly}
            disabled={isBusy || !canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingOnly ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
            ) : (
              <><Save className="h-4 w-4" />Save (don&apos;t generate)</>
            )}
          </button>
        </div>
      )}

      {!canSubmit && !isBusy && (
        <p className="text-center text-xs text-gray-400">
          Complete division name and dates in Step 1 to continue.
        </p>
      )}

      {capHit ? (
        <UpgradeModal
          cap={capHit.cap}
          limit={capHit.limit}
          currentPlan={capHit.plan}
          onClose={() => setCapHit(null)}
        />
      ) : null}
    </div>
  );
}
