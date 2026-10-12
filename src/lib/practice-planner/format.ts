// Formatting shared by the page and the copy text. No toLocale* anywhere:
// the page renders on the server and in the browser, and locale output is
// not guaranteed identical between them (a hydration mismatch tsc and
// next build both pass).

import { ALL_DAYS, DAY_SHORT } from "./constants";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "HH:MM" → minutes after midnight. Empty or malformed → 0 (the mockup's toMin). */
export function toMinutes(t: string): number {
  const [h, m] = (t || "0:0").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 1050 → "5:30pm", 1020 → "5pm". */
export function fmtTime(min: number): string {
  const m = Math.round(min);
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}${ap}`;
}

/** "2027-02-22" → UTC-midnight epoch ms. */
export function parseIsoDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = parseIsoDate(s);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** UTC-midnight epoch ms → "Feb 22". */
export function fmtDate(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Days as the page and print list them, Monday first: three or more in a row
 * collapse to a range, anything else is listed. [0..4] → "Mon–Fri",
 * [0, 2, 4] → "Mon, Wed, Fri", [0, 1, 3] → "Mon, Tue, Thu",
 * [0, 1, 2, 4, 5, 6] → "Mon–Wed, Fri–Sun". No wrap from Sunday to Monday.
 */
export function formatDayList(days: number[]): string {
  const sorted = ALL_DAYS.filter((k) => days.includes(k));
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${DAY_SHORT[sorted[i]]}–${DAY_SHORT[sorted[j]]}`);
    else for (let k = i; k <= j; k++) parts.push(DAY_SHORT[sorted[k]]);
    i = j + 1;
  }
  return parts.join(", ");
}

/** 1234 → "1,234". */
export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
