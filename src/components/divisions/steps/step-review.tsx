"use client";

import { useState } from "react";
import {
  CheckCircle2, AlertTriangle, Edit2, Zap, Loader2,
  ExternalLink, X, Save,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { logActivity } from "@/lib/activity-log";
import Link from "next/link";
import type { WizardData } from "../wizard-types";
import { generateSchedule, type ScheduleConflict } from "@/lib/schedule/generate-schedule";

const FORMAT_LABELS = {
  round_robin: "Round robin",
  balanced: "Balanced",
  pool_play: "Pool play",
} as const;

interface Props {
  data: WizardData;
  originalData?: WizardData; // populated when editing; used for change analysis
  leagueId: string;
  onEdit: (step: number) => void;
  onComplete: () => void;
  divisionId?: string;
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
  gamesCreated: number;
  unscheduledCount: number;
  conflicts: ScheduleConflict[];
  savedDivisionId: string;
};

type SaveOnlyResult = {
  savedDivisionId: string;
  warnings: string[];
};

// ─── Component ─────────────────────────────────────────────────────────────────

export function StepReview({
  data, originalData, leagueId, onEdit, onComplete, divisionId,
}: Props) {
  const [savingOnly, setSavingOnly] = useState(false);
  const [savingRegen, setSavingRegen] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [error, setError] = useState("");
  const [regenResult, setRegenResult] = useState<RegenResult | null>(null);
  const [saveOnlyResult, setSaveOnlyResult] = useState<SaveOnlyResult | null>(null);
  const router = useRouter();

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
    practice_days: data.practice_days,
    practice_day_windows: data.practice_day_windows,
    use_league_schedule: data.use_league_schedule,
    // Backward-compat fields — schedule generator uses day_windows when present
    earliest_start: firstWin.start,
    latest_start: firstWin.end,
    game_duration: data.game_duration,
    buffer_minutes: data.buffer_minutes,
    max_games_per_field_per_day: data.max_games_per_field_per_day,
    bye_weeks: data.bye_weeks,
    format: data.format,
    include_playoffs: data.include_playoffs,
    auto_rotate: data.auto_rotate,
    track_standings: data.track_standings,
    teams: data.teams,
  };

  // ── Shared: persist division + venues + team names ─────────────────────────

  async function saveDivisionData(): Promise<{ divId: string } | { error: string }> {
    const supabase = createClient();
    let divId: string;

    if (isEditMode) {
      const { error: updateError } = await supabase
        .from("divisions")
        .update({
          name: data.name.trim(),
          team_count: data.team_count,
          start_date: data.start_date || null,
          end_date: data.end_date || null,
          practice_season_start: data.practice_season_start || null,
          practice_season_end: data.practice_season_end || null,
          settings: settingsPayload,
          activities_per_week: data.activities_per_week,
        } as never)
        .eq("id", divisionId);

      if (updateError) return { error: updateError.message };

      await supabase.from("division_venues").delete().eq("division_id", divisionId);
      if (data.venue_assignments.length > 0) {
        await supabase
          .from("division_venues")
          .insert(data.venue_assignments.map((a) => ({
            division_id: divisionId,
            venue_id: a.venue_id,
            allow_games: a.allow_games,
            allow_practices: a.allow_practices,
          })) as never[]);
      }

      divId = divisionId;
    } else {
      const { data: divData, error: divError } = await supabase
        .from("divisions")
        .insert([{
          league_id: leagueId,
          name: data.name.trim(),
          team_count: data.team_count,
          start_date: data.start_date || null,
          end_date: data.end_date || null,
          practice_season_start: data.practice_season_start || null,
          practice_season_end: data.practice_season_end || null,
          settings: settingsPayload,
          status: "active",
          activities_per_week: data.activities_per_week,
        } as never])
        .select("id")
        .single();

      if (divError || !divData) return { error: divError?.message ?? "Failed to save division." };

      divId = (divData as unknown as { id: string }).id;

      if (data.venue_assignments.length > 0) {
        await supabase
          .from("division_venues")
          .insert(data.venue_assignments.map((a) => ({
            division_id: divId,
            venue_id: a.venue_id,
            allow_games: a.allow_games,
            allow_practices: a.allow_practices,
          })) as never[]);
      }
    }

    // Upsert team names from wizard
    const nonBlankTeams = data.teams.filter((t) => t.name.trim() !== "");
    if (nonBlankTeams.length > 0) {
      if (isEditMode) {
        const { data: existing } = await supabase
          .from("teams").select("name").eq("division_id", divId);
        const existingNames = new Set(
          (existing ?? []).map((t: { name: string }) => t.name.toLowerCase().trim())
        );
        const newTeams = nonBlankTeams.filter(
          (t) => !existingNames.has(t.name.toLowerCase().trim())
        );
        if (newTeams.length > 0) {
          await supabase.from("teams").insert(
            newTeams.map((t) => ({ league_id: leagueId, division_id: divId, name: t.name.trim() })) as never[]
          );
        }
      } else {
        await supabase.from("teams").insert(
          nonBlankTeams.map((t) => ({ league_id: leagueId, division_id: divId, name: t.name.trim() })) as never[]
        );
      }
    }

    // When scoped to league, persist the schedule windows as league-wide defaults
    if (data.use_league_schedule) {
      await supabase
        .from("leagues")
        .update({
          schedule_settings: {
            playing_days: data.playing_days,
            day_windows: data.day_windows,
            practice_days: data.practice_days,
            practice_day_windows: data.practice_day_windows,
          },
        } as never)
        .eq("id", leagueId);
    }

    // Sync team practice slots
    const hasAnySlots = data.teams.some((t) =>
      (t.practice_slots ?? []).some((s) => s.day),
    );
    if (isEditMode || hasAnySlots) {
      const { data: teamRows } = await supabase
        .from("teams")
        .select("id, name")
        .eq("division_id", divId);

      const teamIdByName = new Map(
        (teamRows ?? []).map((t: { id: string; name: string }) => [
          t.name.toLowerCase().trim(),
          t.id,
        ]),
      );

      // In edit mode wipe first so removals are handled
      if (isEditMode) {
        await supabase
          .from("team_practice_slots")
          .delete()
          .eq("division_id", divId);
      }

      const slotsToInsert = data.teams.flatMap((t) => {
        const teamId = teamIdByName.get(t.name.toLowerCase().trim());
        if (!teamId) return [];
        return (t.practice_slots ?? [])
          .filter((s) => s.day)
          .map((s) => ({
            team_id: teamId,
            division_id: divId,
            day_of_week: s.day!,
            start_time: s.start ?? "09:00",
            venue_id: s.venue_id ?? null,
          }));
      });

      if (slotsToInsert.length > 0) {
        await supabase
          .from("team_practice_slots")
          .insert(slotsToInsert as never[]);
      }
    }

    return { divId };
  }

  // ── "Save changes" — no schedule touch ────────────────────────────────────

  async function handleSaveOnly() {
    setSavingOnly(true);
    setError("");

    const saved = await saveDivisionData();
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

  // ── "Save & regenerate" — wipes + rebuilds schedule ───────────────────────

  async function handleSaveAndRegen() {
    setSavingRegen(true);
    setError("");
    setShowRegenConfirm(false);

    const saved = await saveDivisionData();
    if ("error" in saved) { setError(saved.error); setSavingRegen(false); return; }
    const { divId } = saved;

    const scheduleResult = await generateSchedule(divId);
    if (!scheduleResult.success) {
      setError(`Division saved, but schedule regeneration failed: ${scheduleResult.error}`);
      setSavingRegen(false);
      return;
    }
    console.log("[logActivity] before call: schedule_generated (step-review)", { leagueId, divId });
    const _r = await logActivity(leagueId, divId, "schedule_generated",
      `${data.name} schedule generated — ${scheduleResult.gamesCreated} game${scheduleResult.gamesCreated === 1 ? "" : "s"} scheduled`);
    console.log("[logActivity] result (step-review):", _r);

    router.refresh();
    setSavingRegen(false);
    setRegenResult({
      gamesCreated: scheduleResult.gamesCreated,
      unscheduledCount: scheduleResult.unscheduledCount,
      conflicts: scheduleResult.conflicts,
      savedDivisionId: divId,
    });
  }

  // ── Post-regen result panel ────────────────────────────────────────────────

  if (regenResult) {
    const hasUnscheduled = regenResult.unscheduledCount > 0;
    const hasFieldConflicts = regenResult.conflicts.length > 0;
    const hasIssues = hasUnscheduled || hasFieldConflicts;

    return (
      <div className="flex flex-col gap-5">
        <div className={`flex items-start gap-3 rounded-xl px-4 py-4 ${hasIssues ? "bg-amber-50" : "bg-[#22C55E]/10"}`}>
          {hasIssues
            ? <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            : <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#22C55E]" />}
          <div className="min-w-0">
            <p className={`font-semibold ${hasIssues ? "text-amber-800" : "text-[#22C55E]"}`}>
              {hasIssues ? "Schedule regenerated with issues" : "Schedule regenerated"}
            </p>
            <p className={`mt-0.5 text-sm ${hasIssues ? "text-amber-700" : "text-[#22C55E]/80"}`}>
              {regenResult.gamesCreated} game{regenResult.gamesCreated !== 1 ? "s" : ""} scheduled
            </p>
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
                  Not enough slots. Try extending dates, adding venues, or reducing games per team.
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
                  onClick={onComplete}
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
          onClick={onComplete}
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
          onClick={onComplete}
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
          label="Season"
          value={data.start_date && data.end_date ? `${fmt(data.start_date)} → ${fmt(data.end_date)}` : "—"}
        />
      </Section>

      <Section title="Playing schedule" step={1} onEdit={onEdit}>
        <Row label="Schedule scope" value={data.use_league_schedule ? "League-wide" : "Per division"} />
        <Row label="Games per team" value={data.games_per_team} />
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
        <Row
          label="Practice days"
          value={
            data.practice_days.length > 0
              ? data.practice_days.map((d) => {
                  const w = data.practice_day_windows[d];
                  return w ? `${d} (${fmtTime(w.start)}–${fmtTime(w.end)})` : d;
                }).join(", ")
              : "—"
          }
        />
        <Row label="Game duration" value={`${data.game_duration} min`} />
        <Row label="Buffer" value={`${data.buffer_minutes} min`} />
        <Row label="Bye weeks" value={data.bye_weeks} />
        <Row label="Activities per week" value={data.activities_per_week} />
      </Section>

      <Section title="Practice schedule" step={2} onEdit={onEdit}>
        <Row
          label="Practice season"
          value={
            data.practice_season_start && data.practice_season_end
              ? `${fmt(data.practice_season_start)} → ${fmt(data.practice_season_end)}`
              : "Uses game season dates"
          }
        />
        {(() => {
          const totalSlots = data.teams.reduce(
            (sum, t) => sum + (t.practice_slots ?? []).filter((s) => s.day).length,
            0,
          );
          const teamsWithSlots = data.teams.filter((t) =>
            (t.practice_slots ?? []).some((s) => s.day),
          ).length;
          return (
            <Row
              label="Pinned slots"
              value={
                totalSlots > 0
                  ? `${totalSlots} slot${totalSlots !== 1 ? "s" : ""} across ${teamsWithSlots} team${teamsWithSlots !== 1 ? "s" : ""}`
                  : "None — auto-assign all"
              }
            />
          );
        })()}
      </Section>

      <Section title="Fields" step={3} onEdit={onEdit}>
        {data.venue_assignments.length === 0 ? (
          <Row label="Fields selected" value="None" />
        ) : (
          <>
            <Row label="Fields selected" value={`${data.venue_assignments.length} venue${data.venue_assignments.length > 1 ? "s" : ""}`} />
            <Row label="For games" value={`${data.venue_assignments.filter((a) => a.allow_games).length} venue${data.venue_assignments.filter((a) => a.allow_games).length !== 1 ? "s" : ""}`} />
            <Row label="For practices" value={`${data.venue_assignments.filter((a) => a.allow_practices).length} venue${data.venue_assignments.filter((a) => a.allow_practices).length !== 1 ? "s" : ""}`} />
          </>
        )}
      </Section>

      <Section title="Format" step={4} onEdit={onEdit}>
        <Row label="Format" value={FORMAT_LABELS[data.format]} />
        <Row label="Playoffs" value={data.include_playoffs ? "Yes" : "No"} />
        <Row label="Home/away rotation" value={data.auto_rotate ? "Yes" : "No"} />
        <Row label="Track standings" value={data.track_standings ? "Yes" : "No"} />
      </Section>

      <Section title="Coaches" step={5} onEdit={onEdit}>
        <Row label="Coach conflicts" value={conflictCount > 0 ? `${conflictCount} flagged` : "None"} />
      </Section>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* ── Buttons ── */}
      {isEditMode ? (
        <>
          {/* Primary: save without touching the schedule */}
          <button
            type="button"
            onClick={handleSaveOnly}
            disabled={isBusy || !canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0C1F3F] py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#0C1F3F]/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingOnly ? (
              <><Loader2 className="h-5 w-5 animate-spin" />Saving…</>
            ) : (
              <><Save className="h-5 w-5" />Save changes</>
            )}
          </button>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-100" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-xs text-gray-400">or</span>
            </div>
          </div>

          {/* Secondary: save & regenerate — with inline confirmation */}
          {showRegenConfirm ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2.5 mb-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <p className="text-sm text-amber-800">
                  This will delete all existing games and rebuild the schedule from scratch. Are you sure?
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveAndRegen}
                  disabled={savingRegen}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0C1F3F] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/80 disabled:opacity-60"
                >
                  {savingRegen ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Regenerating…</>
                  ) : (
                    <><Zap className="h-4 w-4" />Confirm & regenerate</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRegenConfirm(false)}
                  disabled={savingRegen}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowRegenConfirm(true)}
              disabled={isBusy || !canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Zap className="h-4 w-4" />
              Save &amp; regenerate schedule
            </button>
          )}
        </>
      ) : (
        /* Create mode: single generate button */
        <button
          type="button"
          onClick={handleSaveAndRegen}
          disabled={savingRegen || !canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#22C55E] py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {savingRegen ? (
            <><Loader2 className="h-5 w-5 animate-spin" />Saving division…</>
          ) : (
            <><Zap className="h-5 w-5" />Generate schedule</>
          )}
        </button>
      )}

      {!canSubmit && !isBusy && (
        <p className="text-center text-xs text-gray-400">
          Complete division name and dates in Step 1 to continue.
        </p>
      )}
    </div>
  );
}
