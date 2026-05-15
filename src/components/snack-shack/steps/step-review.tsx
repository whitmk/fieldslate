"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ORDERED_DAYS } from "@/components/divisions/wizard-types";
import { generateSnackShackSchedule } from "@/lib/snack-shack/generate-schedule";
import type { SnackShackWizardData, DayCode } from "../wizard-types";

interface Props {
  data: SnackShackWizardData;
  leagueId: string;
  existingId?: string;
  isEditMode: boolean;
  onEdit: (step: number) => void;
  onComplete: () => void;
}

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

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(t: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function StepReview({
  data,
  leagueId,
  existingId,
  isEditMode,
  onEdit,
  onComplete,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocksCreated, setBlocksCreated] = useState(0);

  async function upsertSettings(): Promise<string | null> {
    const supabase = createClient();
    const payload = {
      season_id: data.season_id,
      start_date: data.start_date,
      end_date: data.end_date,
      days_of_week: data.days_of_week,
      time_blocks_by_day: data.time_blocks_by_day,
      home_venue_ids: data.home_venue_ids,
      scheduling_preference: data.scheduling_preference,
      updated_at: new Date().toISOString(),
    };

    const { data: upserted, error: dbError } = await supabase
      .from("snack_shack_settings")
      .upsert(payload as never, { onConflict: "season_id" })
      .select("id")
      .single();

    if (dbError) {
      setError(dbError.message);
      return null;
    }
    return upserted?.id ?? existingId ?? null;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const id = await upsertSettings();
    setSaving(false);
    if (id) {
      setDone(true);
      setGenerated(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const id = await upsertSettings();
    if (!id) {
      setGenerating(false);
      return;
    }

    // Clear existing recurring blocks before regenerating
    const supabase = createClient();
    await supabase
      .from("snack_shack_blocks")
      .delete()
      .eq("snack_shack_id", id)
      .eq("is_recurring", true);

    const result = await generateSnackShackSchedule(id, leagueId, data);
    setGenerating(false);
    if (!result.success) {
      setError(result.error ?? "Generation failed");
      return;
    }
    setBlocksCreated(result.blocksCreated);
    setDone(true);
    setGenerated(true);
  }

  const activeDayLabels = ORDERED_DAYS.filter((d) =>
    data.days_of_week.includes(d.key as DayCode),
  )
    .map((d) => d.label)
    .join(", ");

  const totalBlocks = data.days_of_week.reduce((sum, day) => {
    const blocks = data.time_blocks_by_day[day as DayCode] ?? [];
    return sum + blocks.length;
  }, 0);

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <CheckCircle2 className="h-8 w-8 text-[#22C55E]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[#0C1F3F]">
            {generated ? "Schedule generated!" : "Settings saved!"}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {generated
              ? `${blocksCreated} block${blocksCreated !== 1 ? "s" : ""} created for your Snack Shack schedule.`
              : "Your Snack Shack settings have been saved. Generate the schedule from the Snack Shack page."}
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
          Confirm your Snack Shack settings before saving or generating the schedule.
        </p>
      </div>

      <ReviewSection title="Date range" onEdit={() => onEdit(0)}>
        <Row label="Open" value={fmtDate(data.start_date)} />
        <Row label="Close" value={fmtDate(data.end_date)} />
      </ReviewSection>

      <ReviewSection title="Schedule" onEdit={() => onEdit(1)}>
        <Row
          label="Days open"
          value={activeDayLabels || "None selected"}
        />
        <Row
          label="Blocks/day"
          value={
            totalBlocks > 0
              ? `${totalBlocks} block${totalBlocks !== 1 ? "s" : ""} across ${data.days_of_week.length} day${data.days_of_week.length !== 1 ? "s" : ""}`
              : "No blocks defined"
          }
        />
      </ReviewSection>

      {/* Per-day block summary */}
      {data.days_of_week.length > 0 && (
        <ReviewSection title="Time blocks" onEdit={() => onEdit(2)}>
          {ORDERED_DAYS.filter((d) =>
            data.days_of_week.includes(d.key as DayCode),
          ).map(({ key, label }) => {
            const blocks = data.time_blocks_by_day[key as DayCode] ?? [];
            return (
              <div key={key} className="flex items-start gap-4 py-2.5">
                <span className="w-28 flex-shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">
                  {label}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {blocks.length === 0 ? (
                    <span className="text-sm text-gray-300">No blocks</span>
                  ) : (
                    blocks.map((b) => (
                      <span
                        key={b.id}
                        className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                      >
                        {fmtTime(b.start)}–{fmtTime(b.end)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </ReviewSection>
      )}

      <ReviewSection title="Venues & preference" onEdit={() => onEdit(3)}>
        <Row
          label="Home venues"
          value={
            data.home_venue_ids.length > 0
              ? `${data.home_venue_ids.length} venue${data.home_venue_ids.length !== 1 ? "s" : ""} selected`
              : "None selected"
          }
        />
        <Row
          label="Preference"
          value={
            data.scheduling_preference === "prefer_game_days"
              ? "Prefer game days"
              : "Prefer off days"
          }
        />
      </ReviewSection>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <button
          onClick={handleGenerate}
          disabled={saving || generating || !data.start_date || !data.end_date}
          className="w-full rounded-xl bg-[#22C55E] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </span>
          ) : (
            "Generate schedule"
          )}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || generating || !data.start_date || !data.end_date}
          className="w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-50"
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : (
            "Save (don't generate)"
          )}
        </button>
      </div>
    </div>
  );
}
