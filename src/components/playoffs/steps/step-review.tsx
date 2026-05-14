"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ORDERED_DAYS } from "@/components/divisions/wizard-types";
import { generateBracket } from "@/lib/playoffs/generate-bracket";
import type { PlayoffWizardData, PlayoffFormat } from "../playoff-wizard-types";

interface Props {
  data: PlayoffWizardData;
  leagueId: string;
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

export function StepReview({ data, leagueId, onEdit, onComplete }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const supabase = createClient();

    const payload = {
      league_id: leagueId,
      division_id: data.division_id,
      format: data.format,
      seeding: data.seeding,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      playing_days: data.playing_days,
      day_windows: data.day_windows,
      venue_assignments: data.venue_assignments,
      cross_division_enabled: data.cross_division_enabled,
      cross_division_opponent_id:
        data.cross_division_enabled && data.cross_division_opponent_id
          ? data.cross_division_opponent_id
          : null,
      status: "draft" as const,
      updated_at: new Date().toISOString(),
    };

    const { data: upserted, error: dbError } = await supabase
      .from("playoffs")
      .upsert(payload, { onConflict: "league_id,division_id" })
      .select("id")
      .single();

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    const playoffId = upserted?.id;
    if (playoffId) {
      const result = await generateBracket(playoffId, leagueId, data);
      if (!result.success) {
        setError(result.error);
        setSaving(false);
        return;
      }
    }

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
            Playoff bracket saved!
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Your playoff setup for{" "}
            <strong>{data.division_name}</strong> has been saved as a draft.
          </p>
        </div>
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

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !data.division_id}
        className="w-full rounded-xl bg-[#22C55E] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Generate playoff bracket"}
      </button>
    </div>
  );
}
