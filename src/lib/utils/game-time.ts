// Times are stored as wall-clock UTC in the DB (e.g. "2025-09-13T09:00:00+00:00"
// means 9:00 AM local time). Read the date/time portions directly from the ISO
// string instead of converting through `new Date()`, which would apply a
// UTC→local offset and shift the displayed time.
//
// Formatters here MUST be deterministic across server (Node) and browser so
// React hydration doesn't tear. `toLocaleDateString` can't guarantee that:
// it varies by the runtime's timezone (server is UTC, browser is user-local)
// and by the ICU/CLDR version shipped with Node vs. the browser ("Sep" vs.
// "Sept" being a well-known divergence). We format from the string parts
// directly and only use `Date` to compute the weekday — and we do that from
// year/month/day fields we set ourselves, which makes the result independent
// of the host timezone.

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtGameDate(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-").map(Number);
  // Noon local-time so DST shifts can't push us across a day boundary; getDay()
  // on a Date built from these fields is independent of the host timezone.
  const weekday = WEEKDAYS_SHORT[new Date(year, month - 1, day, 12).getDay()];
  return `${weekday}, ${MONTHS_SHORT[month - 1]} ${day}`;
}

export function fmtGameTime(iso: string): string {
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${min.toString().padStart(2, "0")} ${period}`;
}
