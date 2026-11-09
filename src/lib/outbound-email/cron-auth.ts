// The cron routes' gate: FAILS CLOSED. No CRON_SECRET configured → 503 and
// nothing runs; a wrong or missing bearer → 401. Constant-time compare.
import { timingSafeEqual } from "node:crypto";

export function bearerMatches(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Null when the request may run; else the status and message to answer. */
export function cronRefusal(secret: string | undefined, header: string | null): { status: number; error: string } | null {
  if (!secret) return { status: 503, error: "CRON_SECRET is not configured." };
  if (!bearerMatches(header, secret)) return { status: 401, error: "Unauthorized" };
  return null;
}
