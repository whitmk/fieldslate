// Sunset — the mockup's NOAA approximation (docs/mockups/practice-field-
// calculator.html, sunsetMin), with US daylight saving rules.
//
// Every date is a UTC-MIDNIGHT epoch value and every computation is UTC
// arithmetic, so the host's timezone never leaks in (the harness runs under
// three zones). The city carries its own standard offset and whether it
// observes DST — Arizona and Hawaii don't.
//
// SHARED (2026-10-14): the practice field calculator (src/lib/practice-planner)
// and the in-app daylight flags (src/lib/daylight) both import this file. One
// copy; never fork it.

import type { UsCity } from "./us-cities";

const DAY_MS = 864e5;

/** US rule: second Sunday in March up to the first Sunday in November. */
export function isUsDst(t: number): boolean {
  const y = new Date(t).getUTCFullYear();
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1));
    const off = (7 - first.getUTCDay()) % 7;
    return Date.UTC(y, month, 1 + off + 7 * (n - 1));
  };
  return t >= nthSunday(2, 2) && t < nthSunday(10, 1);
}

/** Local clock minutes after midnight of sunset on the date `t` (UTC midnight). */
export function sunsetMinutes(t: number, city: UsCity): number {
  const rad = Math.PI / 180;
  const y = new Date(t).getUTCFullYear();
  const N = Math.floor((t - Date.UTC(y, 0, 0)) / DAY_MS);
  const lngH = city.lon / 15;
  const tt = N + (18 - lngH) / 24;
  const M = 0.9856 * tt - 3.289;
  const L = (M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634 + 360) % 360;
  let RA = (Math.atan(0.91764 * Math.tan(L * rad)) / rad + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinD = 0.39782 * Math.sin(L * rad);
  const cosD = Math.cos(Math.asin(sinD));
  const cosH = (Math.cos(90.833 * rad) - sinD * Math.sin(city.lat * rad)) / (cosD * Math.cos(city.lat * rad));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad / 15;
  const T = H + RA - 0.06571 * tt - 6.622;
  const UT = (((T - lngH) % 24) + 24) % 24;
  let local = UT + city.utcOffset + (city.dst && isUsDst(t) ? 1 : 0);
  local = ((local % 24) + 24) % 24;
  return local * 60;
}

/**
 * When a window ending at `endMin` has daylight through its end, over the
 * season [start, end] (UTC-midnight dates, inclusive).
 *
 * - ok:      every day of the season
 * - from:    not at the start, every day from `from` on (spring)
 * - until:   at the start, through `until`, not after (fall)
 * - between: only from `from` through `until` (a season spanning summer)
 * - gap:     through `until`, then again from `from` (a season spanning winter)
 * - never:   no day of the season
 *
 * Sunset moves one way between the solstices, so the daylight days form at
 * most two runs; anything else is reported as the run edges it has.
 */
export type DaylightResult =
  | { kind: "ok" }
  | { kind: "from"; from: number }
  | { kind: "until"; until: number }
  | { kind: "between"; from: number; until: number }
  | { kind: "gap"; until: number; from: number }
  | { kind: "never" };

export function daylightFor(endMin: number, start: number, end: number, city: UsCity): DaylightResult {
  // Runs of consecutive daylight days.
  const runs: { from: number; until: number }[] = [];
  for (let t = start; t <= end; t += DAY_MS) {
    if (sunsetMinutes(t, city) >= endMin) {
      const last = runs[runs.length - 1];
      if (last && last.until === t - DAY_MS) last.until = t;
      else runs.push({ from: t, until: t });
    }
  }
  if (!runs.length) return { kind: "never" };
  const first = runs[0];
  const last = runs[runs.length - 1];
  const okAtStart = first.from === start;
  const okAtEnd = last.until === end;
  if (runs.length === 1 && okAtStart && okAtEnd) return { kind: "ok" };
  if (okAtStart && okAtEnd) return { kind: "gap", until: first.until, from: last.from };
  if (okAtEnd) return { kind: "from", from: last.from };
  if (okAtStart) return { kind: "until", until: first.until };
  return { kind: "between", from: first.from, until: last.until };
}
