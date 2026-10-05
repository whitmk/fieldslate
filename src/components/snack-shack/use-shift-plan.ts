"use client";

// Loads the derivation inputs for one snack shack and computes the plan.
// Every read fails LOUD: `error` is set and `plan` is null; the page renders
// the error, never a confident empty preview.

import { useCallback, useEffect, useState } from "react";
import {
  loadShiftInputs,
  planFromInputs,
  type ShiftInputs,
  type SnackShackSettingsInput,
} from "@/lib/snack-shack/generate-shifts";
import type { RegeneratePlan } from "@/lib/snack-shack/regenerate-plan";

export type ShiftPlanState = {
  inputs: ShiftInputs | null;
  plan: RegeneratePlan | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

export function useShiftPlan(settings: SnackShackSettingsInput | null, orgId: string): ShiftPlanState {
  const [inputs, setInputs] = useState<ShiftInputs | null>(null);
  const [plan, setPlan] = useState<RegeneratePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // The settings identity + the parts of the rule that change the derivation.
  const key = settings
    ? [settings.id, settings.open_before_min, settings.close_after_min, settings.max_shift_min,
       JSON.stringify(settings.days_of_week), JSON.stringify(settings.home_venue_ids), settings.scheduling_preference,
       settings.shifts_generated_at ?? ""].join("|")
    : "";

  useEffect(() => {
    if (!settings) {
      setInputs(null);
      setPlan(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadShiftInputs(settings, orgId)
      .then((loaded) => {
        if (cancelled) return;
        setInputs(loaded);
        setPlan(planFromInputs(loaded));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setInputs(null);
        setPlan(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures every settings field the derivation reads
  }, [key, orgId, tick]);

  return { inputs, plan, error, loading, reload };
}
