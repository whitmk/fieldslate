"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ORDERED_DAYS } from "@/components/divisions/wizard-types";
import { fmtDuration } from "./step-hours";
import type { SnackShackWizardData, DayCode } from "../wizard-types";

interface Props {
  data: SnackShackWizardData;
  existingId?: string;
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

export function StepReview({
  data,
  existingId,
  onEdit,
  onComplete,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      open_before_min: data.open_before_min,
      close_after_min: data.close_after_min,
      max_shift_min: data.max_shift_min,
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
    if (id) setDone(true);
  }

  const activeDayLabels = ORDERED_DAYS.filter((d) =>
    data.days_of_week.includes(d.key as DayCode),
  )
    .map((d) => d.label)
    .join(", ");

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
          <CheckCircle2 className="h-8 w-8 text-[#22C55E]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[#0C1F3F]">Settings saved</h3>
          <p className="mt-1 text-sm text-gray-500">
            Shifts are made from the game schedule. Use &ldquo;Generate shifts&rdquo; on the
            Snack Shack page — you&rsquo;ll see exactly what will change before anything is written.
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
          Confirm your Snack Shack settings. Shifts are generated from the page, with a preview first.
        </p>
      </div>

      <ReviewSection title="Date range" onEdit={() => onEdit(0)}>
        <Row label="Open" value={fmtDate(data.start_date)} />
        <Row label="Close" value={fmtDate(data.end_date)} />
      </ReviewSection>

      <ReviewSection title="Hours" onEdit={() => onEdit(1)}>
        <Row label="Opens" value={data.open_before_min === 0 ? "When the first game starts" : `${data.open_before_min} min before the first game`} />
        <Row label="Closes" value={data.close_after_min === 0 ? "When the last game ends" : `${data.close_after_min} min after the last game ends`} />
        <Row label="Longest shift" value={`${fmtDuration(data.max_shift_min)} (a leftover under an hour can extend a shift)`} />
        <Row label="Days open" value={activeDayLabels || "None selected"} />
      </ReviewSection>

      <ReviewSection title="Venues & preference" onEdit={() => onEdit(2)}>
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
          onClick={handleSave}
          disabled={saving || !data.start_date || !data.end_date || data.days_of_week.length === 0}
          className="w-full rounded-xl bg-[#22C55E] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : (
            "Save settings"
          )}
        </button>
      </div>
    </div>
  );
}
