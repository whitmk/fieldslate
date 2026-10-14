"use client";

// The ONE client-side source of daylight state for a surface: reads the
// league's settings (loadDaylight) and computes "today" in the league's
// timezone AFTER MOUNT — never during render, so server and browser markup
// match (CLAUDE.md, "Week-by-field view mode"). Until it arrives, nothing is
// flagged and no status line shows; an unreadable setting becomes the
// `error` state, which surfaces render as "Couldn't check daylight …".
//
// Server components (the Schedule page) call loadDaylight + todayInTimezone
// themselves and pass the same values down; every flag still comes from
// daylightFlag / slotDaylightFlag.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadDaylight } from "@/lib/daylight/load";
import {
  daylightFlag,
  daylightState,
  slotDaylightFlag,
  type DaylightFlag,
  type DaylightGame,
  type DaylightState,
} from "@/lib/daylight/flags";
import { todayInTimezone } from "@/lib/utils/org-today";

export type DaylightView = {
  /** Null until the read finishes. */
  state: DaylightState | null;
  today: string | null;
  flag: (game: DaylightGame) => DaylightFlag | null;
  slotFlag: (
    slot: { date: string; startTime: string },
    rawDuration: unknown,
    venue: { has_lights: boolean } | null,
  ) => DaylightFlag | null;
};

/** Build a view from known values (server-computed, or the hook's). */
export function daylightView(state: DaylightState | null, today: string | null): DaylightView {
  return {
    state,
    today,
    flag: (game) => (state && today ? daylightFlag(game, state, today) : null),
    slotFlag: (slot, rawDuration, venue) => (state ? slotDaylightFlag(slot, rawDuration, venue, state) : null),
  };
}

/** `leagueId` (a season) or `orgId`: the org's owner row holds the settings. */
export function useDaylight({ leagueId, orgId }: { leagueId?: string | null; orgId?: string | null }): DaylightView {
  const [state, setState] = useState<DaylightState | null>(null);
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId && !orgId) return;
    let stale = false;
    const supabase = createClient();
    void (async () => {
      let owner = orgId ?? null;
      if (!owner && leagueId) {
        const { data, error } = await supabase.from("leagues").select("owner_id").eq("id", leagueId).maybeSingle();
        owner = error ? null : ((data as { owner_id: string } | null)?.owner_id ?? null);
      }
      if (!owner) {
        if (!stale) setState(daylightState(null));
        return;
      }
      const load = await loadDaylight(supabase, owner);
      if (stale) return;
      let t: string | null = null;
      try {
        t = load.timezone ? todayInTimezone(load.timezone) : null;
      } catch {
        t = null;
      }
      // Without a "today" no flag can be judged: say so rather than flag past games.
      setState(t ? load.state : daylightState(null));
      setToday(t);
    })();
    return () => {
      stale = true;
    };
  }, [leagueId, orgId]);

  return daylightView(state, today);
}
