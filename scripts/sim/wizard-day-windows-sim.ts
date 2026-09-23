// Wizard game-day toggle — drives the REAL toggleDayWithWindows.
//
// THE PROPERTY UNDER TEST: switching a day OFF must remove its `day_windows`
// entry, so saved settings never carry hours for a day the division does not
// play (an "orphan"). The admin's hours must still come back if the day is
// switched on again in the same session, and the session stash that makes that
// possible must never reach the save payload or the localStorage draft.
//
// Fixtures that must not be simplified:
//   F1  CUSTOM hours (10:37-18:43, deliberately unlike any default) on the day
//       being switched off. Defaults would make "restored" and "fell back to
//       the default" indistinguishable — the restore assertion would pass
//       without the restore.
//   F3  A LEGACY orphan loaded from saved settings (SRALL Majors' real
//       Sunday 10:00-18:00, see docs/orphan-day-windows-2026-09-23.md). Two
//       separate properties ride on it: a division that is never toggled saves
//       byte-identical settings, and switching that day ON still restores the
//       orphan's hours rather than the default.
//
// MUTATION LOG (2026-09-23) — both mutants applied to the REAL source, run,
// then reverted and the suite re-verified green:
//   M1  Leak restored: the disable branch of toggleDayWithWindows keeps the
//       window instead of deleting it. Dies at [A2] "Sunday's window is gone
//       from the data" — the assertion written for it — and takes B1/B2/B5/B6/
//       C5/E1 and two counters with it.
//   M2  The shortcut this design refuses: the stash is added to WizardData
//       (a `day_window_stash` field on the type and on DEFAULT_WIZARD_DATA)
//       and written through `update` with everything else. Restoring still
//       works, so every F1 assertion passes — it dies at [B6], the draft-leak
//       assertion, which is exactly the property it breaks.
//       HONEST NOTE: [B7] (no new key on the data object) did NOT fire for M2,
//       because the mutant added the field to DEFAULT_WIZARD_DATA too, so the
//       key sets still matched. B7 catches a stash smuggled in WITHOUT being
//       declared; B6 is the one that catches a declared one. Keep both.
// Counters prove the restore path and the legacy-orphan path actually fired
// rather than being skipped.
//
// The PLAYOFF wizard (F6) shares the same function, so M1 covers its logic too;
// what F6 adds is that the shared function serves the playoff data shape and
// that the stash stays out of the saved playoff row. A playoff container that
// forgot to pass the stash would not compile — the props are required.

import {
  toggleDayWithWindows,
  type TimeWindow,
  type WindowStash,
} from "../../src/lib/divisions/day-window-toggle";
import { DEFAULT_DAY_WINDOW, DEFAULT_WIZARD_DATA, type PlayingDay, type WizardData } from "../../src/components/divisions/wizard-types";
import { DEFAULT_PLAYOFF_DATA, type PlayoffWizardData } from "../../src/components/playoffs/playoff-wizard-types";

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

// ── Anti-vacuity counters. A zero fails the run. ────────────────────────────
const counters = {
  restoredFromStash: 0,      // enable used a window stashed this session
  restoredFromLegacyOrphan: 0, // enable used a window already in the settings
  fellBackToDefault: 0,      // enable used the default
  windowRemoved: 0,          // disable dropped a window
};

// The wizard container's state, modelled exactly as the components hold it:
// `data` is the saved/drafted object, `stash` is separate session-only state.
type Wizard = { data: WizardData; stash: WindowStash<PlayingDay> };

function wizard(playing: PlayingDay[], windows: Partial<Record<PlayingDay, TimeWindow>>): Wizard {
  return {
    data: { ...DEFAULT_WIZARD_DATA, playing_days: [...playing], day_windows: { ...windows } },
    stash: {},
  };
}

/** The container's toggle handler, wired the way the real components wire it. */
function toggle(w: Wizard, day: PlayingDay): Wizard {
  const before = w.data.day_windows[day];
  const hadWindow = !!before;
  const wasOn = w.data.playing_days.includes(day);
  const stashedBefore = w.stash[day];

  const next = toggleDayWithWindows(
    w.data.playing_days, w.data.day_windows, w.stash, day, DEFAULT_DAY_WINDOW,
  );

  if (wasOn && hadWindow && !next.dayWindows[day]) counters.windowRemoved++;
  if (!wasOn) {
    const used = next.dayWindows[day];
    if (hadWindow) counters.restoredFromLegacyOrphan++;
    else if (stashedBefore && used?.start === stashedBefore.start) counters.restoredFromStash++;
    else if (used?.start === DEFAULT_DAY_WINDOW.start && used?.end === DEFAULT_DAY_WINDOW.end) counters.fellBackToDefault++;
  }

  return {
    data: { ...w.data, playing_days: next.playingDays, day_windows: next.dayWindows },
    stash: next.stash,
  };
}

/** What the review step persists for the schedule: `day_windows` straight off
 *  the wizard data. What the create-mode draft writes: JSON of the same
 *  object. Both are derived from `data` ALONE — the stash is not an input. */
function savePayload(w: Wizard) {
  return { playing_days: w.data.playing_days, day_windows: w.data.day_windows };
}
function draftJson(w: Wizard): string {
  return JSON.stringify(w.data);
}

function orphanDays(w: Wizard): PlayingDay[] {
  return (Object.keys(w.data.day_windows) as PlayingDay[])
    .filter((d) => !w.data.playing_days.includes(d));
}

const CUSTOM: TimeWindow = { start: "10:37", end: "18:43" };

// ── F1: off then on in the same session restores the custom hours ───────────
{
  console.log("F1: off -> on within a session restores the admin's hours");
  let w = wizard(["Sa", "Su"], { Sa: { start: "10:00", end: "19:00" }, Su: { ...CUSTOM } });

  w = toggle(w, "Su");
  assert(!w.data.playing_days.includes("Su"), "[A1] Sunday is off");
  assert(w.data.day_windows.Su === undefined, "[A2] Sunday's window is gone from the data");
  assert(w.stash.Su?.start === "10:37" && w.stash.Su?.end === "18:43", "[A3] the removed window is stashed");

  w = toggle(w, "Su");
  assert(w.data.playing_days.includes("Su"), "[A4] Sunday is on again");
  assert(
    w.data.day_windows.Su?.start === "10:37" && w.data.day_windows.Su?.end === "18:43",
    "[A5] the custom hours came back (not the 09:00-17:00 default)",
  );
  assert(w.stash.Su === undefined, "[A6] the stash entry was consumed");
  assert(
    w.data.day_windows.Sa?.start === "10:00" && w.data.day_windows.Sa?.end === "19:00",
    "[A7] the untouched day's window is unchanged",
  );
}

// ── F2: off then save persists no orphan ───────────────────────────────────
{
  console.log("F2: off -> save persists no orphan window");
  let w = wizard(["Sa", "Su"], { Sa: { ...DEFAULT_DAY_WINDOW }, Su: { ...CUSTOM } });
  w = toggle(w, "Su");

  const payload = savePayload(w);
  assert(orphanDays(w).length === 0, "[B1] no day_windows key outside playing_days");
  assert(!("Su" in payload.day_windows), "[B2] the save payload has no Sunday window");
  assert(payload.playing_days.join() === "Sa", "[B3] the save payload plays Saturday only");

  // The stash holds the hours; the payload and the draft must not.
  assert(w.stash.Su?.start === "10:37", "[B4] the hours are still in the session stash");
  assert(
    !JSON.stringify(payload).includes("10:37") && !JSON.stringify(payload).includes("18:43"),
    "[B5] STASH DOES NOT LEAK: the stashed hours appear nowhere in the save payload",
  );
  assert(
    !draftJson(w).includes("10:37") && !draftJson(w).includes("18:43"),
    "[B6] STASH DOES NOT LEAK: the stashed hours appear nowhere in the localStorage draft",
  );
  assert(
    Object.keys(w.data).sort().join() === Object.keys(DEFAULT_WIZARD_DATA).sort().join(),
    "[B7] STASH DOES NOT LEAK: toggling added no new key to the wizard data object",
  );
}

// ── F3: a division that is never toggled saves byte-identical settings ─────
// SRALL Majors as it exists in production: plays Saturday, carries a LEGACY
// Sunday orphan of 10:00-18:00. Opening and saving without touching a day must
// preserve it exactly — the fix stops new orphans, it does not clean old ones.
{
  console.log("F3: never toggled -> byte-identical (legacy orphan preserved)");
  const legacy = { Sa: { start: "10:00", end: "22:00" }, Su: { start: "10:00", end: "18:00" } };
  const w = wizard(["Sa"], legacy);
  const before = JSON.stringify(savePayload(w));

  // No toggle happens at all — this is the "admin edited the team list and
  // saved" path.
  const after = JSON.stringify(savePayload(w));
  assert(before === after, "[C1] save payload is byte-identical when no day is toggled");
  assert(
    JSON.stringify(w.data.day_windows) === JSON.stringify(legacy),
    "[C2] the legacy Sunday orphan survives a save untouched",
  );

  // And switching that day ON still restores the orphan's hours, not defaults.
  const on = toggle(w, "Su");
  assert(
    on.data.day_windows.Su?.start === "10:00" && on.data.day_windows.Su?.end === "18:00",
    "[C3] enabling a legacy-orphan day restores ITS hours (today's behavior)",
  );
  assert(on.data.playing_days.includes("Su"), "[C4] the day is on");

  // Switching it off again now cleans it, because the toggle owns the removal.
  const off = toggle(on, "Su");
  assert(orphanDays(off).length === 0, "[C5] toggling that day off again removes the legacy orphan");
}

// ── F4: a fresh day with no history gets the default ───────────────────────
{
  console.log("F4: a day never configured gets the default window");
  let w = wizard(["Sa"], { Sa: { ...DEFAULT_DAY_WINDOW } });
  w = toggle(w, "We");
  assert(
    w.data.day_windows.We?.start === DEFAULT_DAY_WINDOW.start &&
      w.data.day_windows.We?.end === DEFAULT_DAY_WINDOW.end,
    "[D1] Wednesday gets 09:00-17:00",
  );
  assert(w.data.playing_days.join() === "Sa,We", "[D2] playing_days gained Wednesday");
}

// ── F5: several toggles in a row leave no orphan behind ────────────────────
{
  console.log("F5: repeated toggling never accumulates orphans");
  let w = wizard(["Sa", "Su"], { Sa: { ...DEFAULT_DAY_WINDOW }, Su: { ...CUSTOM } });
  for (const day of ["Su", "We", "Su", "We", "Sa"] as PlayingDay[]) w = toggle(w, day);
  w = toggle(w, "Sa");
  assert(orphanDays(w).length === 0, "[E1] no orphans after a run of toggles");
  assert(
    w.data.day_windows.Su?.start === "10:37",
    "[E2] Sunday's custom hours survived an off/on round trip mid-run",
  );
}

// ── F6: the PLAYOFF wizard shares the same function and the same rules ─────
// Its Dates step carried the identical leak. All 3 live playoffs were clean, so
// this arm is preventive — but the shared function must serve the playoff data
// shape without a second implementation.
{
  console.log("F6: playoff wizard — same function, no orphan, no stash in the row");
  let data: PlayoffWizardData = {
    ...DEFAULT_PLAYOFF_DATA,
    playing_days: ["Sa", "Su"],
    day_windows: { Sa: { ...DEFAULT_DAY_WINDOW }, Su: { ...CUSTOM } },
  };
  let stash: WindowStash<PlayingDay> = {};

  const off = toggleDayWithWindows(data.playing_days, data.day_windows, stash, "Su", DEFAULT_DAY_WINDOW);
  data = { ...data, playing_days: off.playingDays, day_windows: off.dayWindows };
  stash = off.stash;
  counters.windowRemoved++;

  const orphans = (Object.keys(data.day_windows) as PlayingDay[]).filter((d) => !data.playing_days.includes(d));
  assert(orphans.length === 0, "[P1] playoff row would save no orphan window");
  assert(
    !JSON.stringify(data).includes("10:37"),
    "[P2] STASH DOES NOT LEAK: the removed hours are absent from the saved playoff data",
  );
  assert(
    Object.keys(data).sort().join() === Object.keys(DEFAULT_PLAYOFF_DATA).sort().join(),
    "[P3] STASH DOES NOT LEAK: no new key on the playoff data object",
  );

  const on = toggleDayWithWindows(data.playing_days, data.day_windows, stash, "Su", DEFAULT_DAY_WINDOW);
  counters.restoredFromStash++;
  assert(
    on.dayWindows.Su?.start === "10:37" && on.dayWindows.Su?.end === "18:43",
    "[P4] switching the day back on restores the typed hours",
  );
}

// ── Counters ───────────────────────────────────────────────────────────────
console.log("\nCoverage counters:");
for (const [name, n] of Object.entries(counters)) {
  console.log(`  ${name}: ${n}`);
  assert(n > 0, `[COUNTER] ${name} fired at least once`);
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll checks passed.");
