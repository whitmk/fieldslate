// Turning a game day on or off, WITHOUT leaving its time window behind.
//
// THE BUG THIS EXISTS TO PREVENT. Both wizards used to remove a day from
// `playing_days` and keep its entry in `day_windows`, so a division could carry
// hours for a day it does not play. Nothing reads such an entry — every reader
// checks `playing_days` first — but a forgotten window is indistinguishable
// from a deliberate reservation, which makes "is Sunday reserved on purpose?"
// unanswerable from the data. 15 orphans existed in production when this
// landed; see docs/orphan-day-windows-2026-09-23.md.
//
// THE STASH, AND WHY IT IS NOT PART OF THE FORM DATA. Removing the window on
// disable would also throw away hours the admin typed, so the removed window is
// handed back to the caller to hold. It MUST live in the wizard CONTAINER's
// state, not in the step component (only the current step is mounted, so a trip
// to Review and back would lose it) and MUST NOT be merged into the wizard's
// data object: that object is what the review step saves and what the
// new-division draft writes to localStorage, and a stash inside it would
// persist the very orphan this removes. The sim asserts both.
//
// Precedence on enable — existing window, then stash, then the default. The
// existing-window arm is what keeps LEGACY orphans behaving exactly as they do
// today: re-enabling a day whose orphan is still in the saved settings restores
// those hours, unchanged. A stash entry can only exist for a day removed in
// this session, so the two can never both apply.
//
// Generic over the day type so the division wizard (`PlayingDay`) and the
// playoff wizard (its re-export of the same union) share ONE implementation.

export type TimeWindow = { start: string; end: string };

/** Windows removed during this wizard session, keyed by day. Session-only:
 *  never saved, never serialized into the draft. */
export type WindowStash<D extends string> = Partial<Record<D, TimeWindow>>;

export type ToggleDayResult<D extends string> = {
  playingDays: D[];
  dayWindows: Partial<Record<D, TimeWindow>>;
  stash: WindowStash<D>;
  /** True when the day is ON after the toggle — the caller expands its row. */
  enabled: boolean;
};

export function toggleDayWithWindows<D extends string>(
  playingDays: readonly D[],
  dayWindows: Partial<Record<D, TimeWindow>>,
  stash: WindowStash<D>,
  day: D,
  defaultWindow: TimeWindow,
): ToggleDayResult<D> {
  const isOn = playingDays.includes(day);

  if (isOn) {
    const nextWindows = { ...dayWindows };
    const removed = nextWindows[day];
    delete nextWindows[day];

    // Only stash something real. A day that somehow had no window leaves the
    // stash untouched rather than writing an undefined entry into it.
    const nextStash: WindowStash<D> = { ...stash };
    if (removed) nextStash[day] = { ...removed };
    else delete nextStash[day];

    return {
      playingDays: playingDays.filter((d) => d !== day),
      dayWindows: nextWindows,
      stash: nextStash,
      enabled: false,
    };
  }

  const restored = dayWindows[day] ?? stash[day] ?? defaultWindow;
  const nextStash: WindowStash<D> = { ...stash };
  delete nextStash[day];

  return {
    playingDays: [...playingDays, day],
    dayWindows: { ...dayWindows, [day]: { ...restored } },
    stash: nextStash,
    enabled: true,
  };
}
