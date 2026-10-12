// Formatting shared by the page and the copy text. No toLocale* anywhere:
// the page renders on the server and in the browser, and locale output is
// not guaranteed identical between them (a hydration mismatch tsc and
// next build both pass).

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

/** 1234 → "1,234". */
export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
