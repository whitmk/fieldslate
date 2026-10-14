// The ONE read of a league's daylight settings (0109): the org owner's
// profiles row — `sunset_city`, `daylight_flags_enabled`, and `timezone`
// (which decides "today", and the Settings mismatch warning). Every surface
// that shows a flag gets its state from here; a failed read is the `error`
// state ("Couldn't check daylight …"), never "no flags" in silence.
//
// It reads ONLY those three columns, on its own, so a failure here never
// takes another read on the same page down with it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { daylightState, type DaylightState } from "./flags";

export type DaylightLoad = {
  state: DaylightState;
  /** The league's timezone, or null if the read failed. */
  timezone: string | null;
  /** The raw stored values, for the Settings card. */
  sunsetCity: string | null;
  enabled: boolean;
};

export async function loadDaylight(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  orgId: string,
): Promise<DaylightLoad> {
  const { data, error } = await supabase
    .from("profiles")
    .select("sunset_city, daylight_flags_enabled, timezone")
    .eq("id", orgId)
    .maybeSingle();
  const row = data as { sunset_city: string | null; daylight_flags_enabled: boolean; timezone: string } | null;
  if (error || !row) {
    return { state: daylightState(null), timezone: null, sunsetCity: null, enabled: true };
  }
  return {
    state: daylightState({ sunsetCity: row.sunset_city, enabled: row.daylight_flags_enabled }),
    timezone: row.timezone,
    sunsetCity: row.sunset_city,
    enabled: row.daylight_flags_enabled,
  };
}
