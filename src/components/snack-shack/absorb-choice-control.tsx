"use client";

// The per-day LEFTOVER control. Rendered under a date whose window divides
// with a leftover under an hour: offers the three ways to absorb it, shows
// the stored choice with Undo, and says the choice is remembered. Writes
// `snack_shack_absorb_choices` directly under RLS; the parent reloads the
// derivation afterwards so the staleness notice reflects the new shape.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ABSORB_CHOICES, type AbsorbChoice, type DerivedWindow } from "@/lib/snack-shack/derive-shifts";

function fmtDur(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

const LABEL: Record<AbsorbChoice, string> = { first: "Add to first shift", last: "Add to last shift", split: "Split across all" };

interface Props {
  snackShackId: string;
  date: string;
  window: DerivedWindow;
  onChanged: () => void;
}

export function AbsorbChoiceControl({ snackShackId, date, window: w, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!w.absorbOffered) return null;

  async function choose(choice: AbsorbChoice | null) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const res = choice
      ? await supabase
          .from("snack_shack_absorb_choices")
          .upsert({ snack_shack_id: snackShackId, date, window_start: w.windowStart, choice } as never, {
            onConflict: "snack_shack_id,date,window_start",
          })
      : await supabase
          .from("snack_shack_absorb_choices")
          .delete()
          .eq("snack_shack_id", snackShackId)
          .eq("date", date)
          .eq("window_start", w.windowStart);
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    onChanged();
  }

  const stored = !w.absorbDefaulted && w.absorbApplied ? w.absorbApplied : null;
  const extended = w.shifts.filter((s) => s.extended);

  return (
    <div className="mt-1 flex flex-col gap-1.5 text-xs">
      {stored ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-green-800">
          <span>
            {LABEL[stored]}: {extended.map((s) => `${s.start}–${s.end} (${fmtDur(s.lengthMin)})`).join(", ")}. Remembered for this day — regenerating keeps it.
          </span>
          <button type="button" disabled={busy} onClick={() => choose(null)} className="font-semibold underline disabled:opacity-50">
            Undo
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-800">
          <span>
            The last shift would be only {fmtDur(w.leftoverMin)}; it is added to the last shift unless you choose otherwise.
          </span>
          {ABSORB_CHOICES.map((c) => (
            <button key={c} type="button" disabled={busy} onClick={() => choose(c)}
              className="rounded-md border border-amber-400 bg-white px-2 py-1 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              {LABEL[c]}
            </button>
          ))}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
      )}
      {error && <p className="text-red-600">Couldn&rsquo;t save the choice: {error}</p>}
    </div>
  );
}
