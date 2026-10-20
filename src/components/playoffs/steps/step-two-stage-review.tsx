"use client";

// Two-stage Review: both stages' pre-flight, before Generate (approved
// mockup, screen 4). Both plans run with nothing written; their warnings
// render VERBATIM. An existing setup also gets replace_two_stage_games's
// preview; once the round robin has results only Stage 2 can be rebuilt.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { PlayoffWizardData } from "../playoff-wizard-types";
import { addBracketBlock, publicRebuildWarning } from "@/lib/playoffs/bracket-delete";
import { planSeeds } from "@/lib/playoffs/seeding";
import {
  advancingReviewLine,
  perDayLine,
  STAGE1_LOCKED_SETUP,
  STAGE2_PLACEHOLDER_NOTE,
  stage1FitLine,
  stage2FitLine,
  stageReviewLine,
  teamsReviewLine,
  twoStagePublicLine,
  twoStageReviewLines,
} from "@/lib/playoffs/two-stage";
import {
  generateTwoStage,
  planTwoStageFromWizard,
  previewTwoStage,
  type TwoStagePlanned,
  type TwoStagePreview,
} from "@/lib/playoffs/two-stage-io";
import { SeriesReview } from "./series-review";

interface Props {
  data: PlayoffWizardData;
  /** The setup as it was when Edit setup opened (null for a new one). */
  original: PlayoffWizardData | null;
  leagueId: string;
  existing: { stage1Id: string; stage2Id: string } | null;
  onEdit: (step: number) => void;
  onComplete: () => void;
}

const sameTeams = (a: { team_id: string }[], b: { team_id: string }[]) =>
  a.length === b.length && a.map((t) => t.team_id).sort().join() === b.map((t) => t.team_id).sort().join();

function Kv({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="w-24 flex-shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-gray-900">{value}</span>
      {onEdit && (
        <button type="button" onClick={onEdit} className="text-xs text-[#16a34a] hover:underline">
          Edit
        </button>
      )}
    </div>
  );
}

function StageNote({ stage, warnings, fit }: { stage: 1 | 2; warnings: string[]; fit: string }) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[#22C55E]/30 bg-[#22C55E]/5 px-4 py-3 text-xs text-gray-700">
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#22C55E]" />
        <p>
          <b>Stage {stage}:</b> {fit}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
      <div>
        <p className="font-semibold">Stage {stage}:</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function StepTwoStageReview({ data, original, leagueId, existing, onEdit, onComplete }: Props) {
  const [planned, setPlanned] = useState<TwoStagePlanned | null>(null);
  const [preview, setPreview] = useState<TwoStagePreview | undefined>(undefined);
  const [stage2Only, setStage2Only] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ games: number; publicLine: string | null; stage2Only: boolean } | null>(null);

  const ready = !!data.division_id && !!data.start_date && !!data.end_date && !!data.stage2.start_date && !!data.stage2.end_date;

  useEffect(() => {
    if (!ready) {
      setPlanned(null);
      return;
    }
    let stale = false;
    setPlanned(null);
    void planTwoStageFromWizard(leagueId, data, {
      stage1: existing?.stage1Id ?? "preflight-1",
      stage2: existing?.stage2Id ?? "preflight-2",
    }).then((p) => {
      if (!stale) setPlanned(p);
    });
    return () => {
      stale = true;
    };
  }, [ready, leagueId, data, existing]);

  // Existing setup: what Generate would replace; once the round robin has
  // results, the same preview for a Stage-2-only rebuild.
  useEffect(() => {
    if (!existing || !planned?.ok || planned.plan.problems.length) {
      setPreview(undefined);
      return;
    }
    let stale = false;
    setPreview(undefined);
    void (async () => {
      const full = await previewTwoStage(existing.stage1Id, existing.stage2Id, data, planned, false);
      if (stale) return;
      if (full.kind === "blocked" && full.reasons.includes("results_entered")) {
        const only = await previewTwoStage(existing.stage1Id, existing.stage2Id, data, planned, true);
        if (stale) return;
        setStage2Only(true);
        setPreview(only);
        return;
      }
      setStage2Only(false);
      setPreview(full);
    })();
    return () => {
      stale = true;
    };
  }, [existing, planned, data]);

  const lockedChange = useMemo(() => {
    if (!stage2Only || !original) return false;
    const was = planSeeds(original.seeding, original.excluded);
    const now = planSeeds(data.seeding, data.excluded);
    return !sameTeams(was, now) || original.advance_count !== data.advance_count;
  }, [stage2Only, original, data]);

  async function handleGenerate() {
    if (!planned?.ok) return;
    setSaving(true);
    setError(null);
    const res = await generateTwoStage({ leagueId, data, planned, existing, stage2Only });
    setSaving(false);
    if (!res.ok) {
      setError(res.error === "DUPLICATE" ? addBracketBlock(data.division_name || "This division", true) : res.error);
      return;
    }
    setDone({
      games: res.counts.newStage1Games + res.counts.newStage2Games,
      publicLine: twoStagePublicLine(res.counts.publicGamesAfter),
      stage2Only,
    });
  }

  if (done) {
    const warnings = planned?.ok ? [...(done.stage2Only ? [] : planned.stage1Warnings), ...planned.stage2Warnings] : [];
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <CheckCircle2 className="h-8 w-8 text-[#22C55E]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[#0C1F3F]">{done.stage2Only ? "Stage 2 rebuilt" : "Both stages generated"}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {done.games} game{done.games === 1 ? "" : "s"} for <strong>{data.division_name}</strong>{" "}
            {done.games === 1 ? "is" : "are"} set up. Seed Stage 2 from its card once the round robin is over.
          </p>
          {done.publicLine && <p className="mt-1 text-sm text-gray-500">{done.publicLine}</p>}
        </div>
        {warnings.length > 0 && (
          <div className="flex max-w-md items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <ul className="list-disc space-y-1 pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          onClick={onComplete}
          className="mt-2 rounded-lg bg-[#22C55E] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a]"
        >
          Done
        </button>
      </div>
    );
  }

  const teamsIn = planned?.ok ? planned.teams.length : data.seeding.length;
  const plan = planned?.ok ? planned.plan : null;
  const blockedMsg = preview?.kind === "blocked" ? preview.message : null;
  const unreadable = preview?.kind === "unreadable" ? preview.message : null;
  const counts = preview?.kind === "ok" ? preview.counts : null;
  const publicWarning = counts ? publicRebuildWarning(counts.publicGames, counts.publicGamesAfter) : null;
  const generateBlocked =
    !planned?.ok || !!plan?.problems.length || !!blockedMsg || lockedChange || (!!existing && preview === undefined);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">
          {data.division_name || "Division"} · Round robin, then bracket
        </h3>
        <p className="mt-0.5 text-sm text-gray-500">Check both stages before generating.</p>
      </div>

      <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 px-4">
        <Kv label="Teams" value={teamsReviewLine(teamsIn, data.excluded.map((t) => t.team_name))} onEdit={() => onEdit(2)} />
        <Kv
          label="Stage 1"
          value={[
            stageReviewLine(plan?.stage1.games.length ?? (teamsIn * (teamsIn - 1)) / 2, data.start_date, data.end_date, data.playing_days),
            ...(planned?.ok && planned.stage1Fields.length ? [planned.stage1Fields.join(", ")] : []),
            perDayLine(data.games_per_team_per_day),
          ].join(" · ")}
          onEdit={() => onEdit(3)}
        />
        <Kv label="Advancing" value={advancingReviewLine(data.advance_count)} onEdit={() => onEdit(2)} />
        <Kv
          label="Stage 2"
          value={[
            stageReviewLine(plan?.stage2.games.length ?? Math.max(data.advance_count - 1, 0), data.stage2.start_date, data.stage2.end_date, data.stage2.playing_days),
            ...(planned?.ok && planned.stage2Fields.length ? [planned.stage2Fields.join(", ")] : []),
            perDayLine(data.stage2.games_per_team_per_day),
          ].join(" · ")}
          onEdit={() => onEdit(3)}
        />
      </div>

      {!ready ? (
        <p className="text-xs text-gray-400">Set both stages&apos; dates to preview where the games will land.</p>
      ) : planned === null ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking dates, fields and hours…
        </div>
      ) : !planned.ok ? (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{planned.error}</div>
      ) : (
        <>
          {planned.plan.problems.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {planned.plan.problems.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
          {!stage2Only && (
            <StageNote
              stage={1}
              warnings={planned.stage1Warnings}
              fit={stage1FitLine(planned.plan.stage1.games.length, planned.plan.stage1.slots.length)}
            />
          )}
          <StageNote stage={2} warnings={planned.stage2Warnings} fit={stage2FitLine(planned.plan.stage2.games)} />
          <SeriesReview games={planned.plan.stage2.games} title="Stage 2" />
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-700">{STAGE2_PLACEHOLDER_NOTE}</div>
        </>
      )}

      {existing && planned?.ok && !planned.plan.problems.length && (
        preview === undefined ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking this setup&apos;s current games…
          </div>
        ) : blockedMsg ? (
          <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{blockedMsg}</div>
        ) : (
          <>
            {unreadable && <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-700">{unreadable}</div>}
            {counts &&
              twoStageReviewLines(counts).map((l, i) => (
                <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-700">{l}</div>
              ))}
            {lockedChange && (
              <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{STAGE1_LOCKED_SETUP}</div>
            )}
            {publicWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <p>{publicWarning}</p>
              </div>
            )}
          </>
        )
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <button
        onClick={handleGenerate}
        disabled={saving || generateBlocked}
        className="w-full rounded-xl bg-[#22C55E] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : stage2Only ? "Rebuild Stage 2" : "Generate both stages"}
      </button>
    </div>
  );
}
