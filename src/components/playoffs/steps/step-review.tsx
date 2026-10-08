"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ORDERED_DAYS } from "@/components/divisions/wizard-types";
import {
  generateBracket,
  preflightBracket,
  previewRebuild,
  type BracketPreflight,
} from "@/lib/playoffs/generate-bracket";
import {
  addBracketBlock,
  generatedPublicLine,
  rebuildReview,
  settingsPayload,
  type RebuildCounts,
} from "@/lib/playoffs/bracket-delete";
import type { PlayoffWizardData, PlayoffFormat } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  leagueId: string;
  /** The bracket being rebuilt; null when generating a new one. */
  playoffId: string | null;
  onEdit: (step: number) => void;
  onComplete: () => void;
}

const FORMAT_LABELS: Record<PlayoffFormat, string> = {
  single_elimination: "Single elimination",
  double_elimination: "Double elimination",
  round_robin: "Round robin",
};

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {title}
        </p>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-[#22C55E] hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-50 px-4">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-4 py-2.5">
      <span className="w-28 flex-shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="flex-1 text-sm text-gray-900">{value}</span>
    </div>
  );
}

export function StepReview({ data, leagueId, playoffId, onEdit, onComplete }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // What the generate run reported: games it could not place (saved as TBD)
  // and every warning, each with its reason — rendered VERBATIM from
  // bracket-plan's planWarnings.
  const [tbdCount, setTbdCount] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedCounts, setSavedCounts] = useState<RebuildCounts | null>(null);

  // PRE-FLIGHT: the same plan the Generate button will run, with nothing
  // written, so a closed day or a too-small date range is shown BEFORE the
  // bracket exists rather than discovered on the bracket page.
  const [preflight, setPreflight] = useState<BracketPreflight | null>(null);
  const canPreflight =
    !!data.division_id && !!data.start_date && !!data.end_date && data.venue_assignments.length > 0;
  useEffect(() => {
    if (!canPreflight) {
      setPreflight(null);
      return;
    }
    let stale = false;
    setPreflight(null);
    void preflightBracket(leagueId, data).then((r) => {
      if (!stale) setPreflight(r);
    });
    return () => {
      stale = true;
    };
    // The wizard data object is replaced on every edit; re-run on any change.
  }, [canPreflight, leagueId, data]);

  // REBUILD PREVIEW (existing bracket only): replace_playoff_games with
  // p_commit=false — what Generate would replace, whether results block it,
  // and what is on the public schedule. Writes nothing. `undefined` while
  // loading; counts null = couldn't check (never zero).
  const [rebuild, setRebuild] = useState<{ counts: RebuildCounts | null } | undefined>(undefined);
  const plannedGames = preflight?.ok ? preflight.games : null;
  useEffect(() => {
    if (!playoffId || !plannedGames) {
      setRebuild(undefined);
      return;
    }
    let stale = false;
    setRebuild(undefined);
    void previewRebuild(playoffId, data, plannedGames).then((r) => {
      if (!stale) setRebuild({ counts: r.counts });
    });
    return () => {
      stale = true;
    };
  }, [playoffId, plannedGames, data]);
  const review = playoffId && rebuild ? rebuildReview(rebuild.counts) : null;

  const activeDays = data.playing_days
    .map((day) => {
      const found = ORDERED_DAYS.find((d) => d.key === day);
      const win = data.day_windows[day];
      return found
        ? `${found.label}${win ? ` (${win.start}–${win.end})` : ""}`
        : day;
    })
    .join(", ");

  async function handleSave() {
    setSaving(true);
    setError(null);

    let id = playoffId;
    if (!id) {
      // A NEW bracket: nothing is written until the plan is known to be good.
      if (!preflight?.ok) {
        setError(preflight && !preflight.ok ? preflight.error : "The bracket couldn't be planned yet. Check the steps above.");
        setSaving(false);
        return;
      }
      // Its setup row is inserted as a draft, then filled by the same
      // replace_playoff_games every rebuild uses. A plain INSERT, never an
      // upsert: a division that already has a bracket is refused (the unique
      // (league, division) constraint), never overwritten.
      const supabase = createClient();
      const { data: inserted, error: dbError } = await supabase
        .from("playoffs")
        .insert({
          league_id: leagueId,
          division_id: data.division_id,
          ...settingsPayload(data),
          status: "draft" as const,
        } as never)
        .select("id")
        .single();
      if (dbError || !inserted) {
        setError(
          dbError?.code === "23505"
            ? addBracketBlock(data.division_name || "This division", true)
            : `Nothing was saved. ${dbError?.message ?? "The bracket couldn't be created."}`,
        );
        setSaving(false);
        return;
      }
      id = (inserted as { id: string }).id;
    }

    const result = await generateBracket(id, leagueId, data);
    if (!result.success) {
      setError(
        playoffId
          ? result.error
          : `${result.error} The bracket's setup was kept as a draft — open it with Edit setup to try again, or delete it.`,
      );
      setSaving(false);
      return;
    }
    setTbdCount(result.tbdCount);
    setWarnings(result.warnings);
    setSavedCounts(result.counts);
    setSaved(true);
    setSaving(false);
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <CheckCircle2 className="h-8 w-8 text-[#22C55E]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[#0C1F3F]">
            Playoff bracket generated
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {savedCounts ? `${savedCounts.newGames} game${savedCounts.newGames !== 1 ? "s" : ""}` : "The games"} for{" "}
            <strong>{data.division_name}</strong> {savedCounts && savedCounts.newGames === 1 ? "is" : "are"} on the bracket.
          </p>
          {generatedPublicLine(savedCounts) && (
            <p className="mt-1 text-sm text-gray-500">{generatedPublicLine(savedCounts)}</p>
          )}
        </div>
        {warnings.length > 0 && (
          <div className="flex max-w-md items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="text-xs text-amber-800">
              <p className="font-semibold">
                {tbdCount > 0
                  ? `${tbdCount} game${tbdCount !== 1 ? "s" : ""} saved without a date, time or field.`
                  : "Heads up:"}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              {tbdCount > 0 && (
                <p className="mt-1.5">
                  To place {tbdCount !== 1 ? "them" : "it"}: open the bracket, switch to the list view,
                  and use the calendar button on the game to set its date, time and field.
                </p>
              )}
            </div>
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

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-lg font-semibold text-[#0C1F3F]">Review</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Confirm your playoff settings before generating the bracket.
        </p>
      </div>

      <ReviewSection title="Setup" onEdit={() => onEdit(0)}>
        <Row label="Division" value={data.division_name || "—"} />
        <Row
          label="Format"
          value={FORMAT_LABELS[data.format] ?? data.format}
        />
        <Row
          label="Teams seeded"
          value={
            data.seeding.length > 0
              ? `${data.seeding.length} team${data.seeding.length !== 1 ? "s" : ""}`
              : "None (will use team order)"
          }
        />
      </ReviewSection>

      <ReviewSection title="Schedule" onEdit={() => onEdit(3)}>
        <Row
          label="Dates"
          value={
            data.start_date && data.end_date
              ? `${data.start_date} → ${data.end_date}`
              : "Not set"
          }
        />
        <Row
          label="Days & times"
          value={activeDays || "None selected"}
        />
        <Row
          label="Venues"
          value={
            data.venue_assignments.length > 0
              ? `${data.venue_assignments.length} venue${data.venue_assignments.length !== 1 ? "s" : ""}`
              : "None"
          }
        />
      </ReviewSection>

      {data.cross_division_enabled && (
        <ReviewSection title="Championship" onEdit={() => onEdit(5)}>
          <Row
            label="vs. division"
            value={data.cross_division_opponent_name || "Not selected"}
          />
        </ReviewSection>
      )}

      {/* Seeding preview */}
      {data.seeding.length > 0 && (
        <ReviewSection title="Seed order" onEdit={() => onEdit(2)}>
          {data.seeding.slice(0, 8).map((team, i) => (
            <div
              key={team.team_id}
              className="flex items-center gap-3 py-2"
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600">
                {i + 1}
              </span>
              <span className="text-sm text-gray-900">{team.team_name}</span>
            </div>
          ))}
          {data.seeding.length > 8 && (
            <p className="pb-2 text-xs text-gray-400">
              + {data.seeding.length - 8} more
            </p>
          )}
        </ReviewSection>
      )}

      {/* Pre-flight: what Generate will do, before it does it. */}
      {canPreflight && (
        preflight === null ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking dates, fields and hours…
          </div>
        ) : !preflight.ok ? (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{preflight.error}</div>
        ) : preflight.warnings.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-[#22C55E]/30 bg-[#22C55E]/5 px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#22C55E]" />
            <p className="text-xs text-gray-700">
              {preflight.gameCount} game{preflight.gameCount !== 1 ? "s" : ""} will be placed in the{" "}
              {preflight.slotCount} available slot{preflight.slotCount !== 1 ? "s" : ""}.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="text-xs text-amber-800">
              <p className="font-semibold">
                {preflight.tbdCount > 0
                  ? `${preflight.tbdCount} of ${preflight.gameCount} games will have no date, time or field.`
                  : "Before you generate:"}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {preflight.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className="mt-1.5">You can still generate; unplaced games can be set from the bracket afterwards.</p>
            </div>
          </div>
        )
      )}
      {!canPreflight && (
        <p className="text-xs text-gray-400">
          Set a date range and at least one field to preview where the games will land.
        </p>
      )}

      {/* Rebuild (existing bracket): what Generate replaces, the result
          block, and the public schedule — all from the database's preview. */}
      {playoffId && plannedGames && (
        rebuild === undefined ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking this bracket&apos;s current games…
          </div>
        ) : review?.blocked ? (
          <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {review.refusal}
          </div>
        ) : review ? (
          <>
            {review.lines.length > 0 && (
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-700">
                {review.lines.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            )}
            {review.publicWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <p className="text-xs text-amber-800">{review.publicWarning}</p>
              </div>
            )}
          </>
        ) : null
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !data.division_id || !!review?.blocked}
        className="w-full rounded-xl bg-[#22C55E] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Generate playoff bracket"}
      </button>
    </div>
  );
}
