// Times are stored as wall-clock UTC in the DB (e.g. "2025-09-13T09:00:00+00:00"
// means 9:00 AM local time). Read the date/time portions directly from the ISO
// string instead of converting through `new Date()`, which would apply a
// UTC→local offset and shift the displayed time.

export function fmtGameDate(iso: string): string {
  const [year, month, day] = iso.substring(0, 10).split("-").map(Number);
  // Construct a local-time noon Date so no date-line shift can occur.
  return new Date(year, month - 1, day, 12).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtGameTime(iso: string): string {
  const [hourStr, minStr] = iso.substring(11, 16).split(":");
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${min.toString().padStart(2, "0")} ${period}`;
}
