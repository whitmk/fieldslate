// Server-side pieces of the public volunteer routes (/api/volunteers/signup,
// /api/volunteers/manage). Pure apart from the injected fetch, so
// sim:volunteer-signup-page drives them.
//
// The routes FAIL CLOSED: no Turnstile secret or no hash salt configured →
// 503 and nothing reaches the database. The IP and the email reach the
// database only as sha256(salt | value) (the rate limits, 0121), kept up to
// 23 hours — the privacy policy says up to 24.
import { createHash } from "node:crypto";

export type PublicConfig = { turnstileSecret: string; hashSalt: string };

export function publicConfig(env: Record<string, string | undefined>): PublicConfig | null {
  const turnstileSecret = env.TURNSTILE_SECRET_KEY?.trim();
  const hashSalt = env.VOLUNTEER_HASH_SALT?.trim();
  if (!turnstileSecret || !hashSalt || hashSalt.length < 16) return null;
  return { turnstileSecret, hashSalt };
}

/** The caller's IP as Vercel reports it (first x-forwarded-for hop), or
 *  "unknown" — which then shares one rate-limit bucket. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function hashKey(salt: string, value: string): string {
  return createHash("sha256").update(`${salt}|${value}`).digest("hex");
}

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's answer, or false on anything else (a network error, a
 *  non-JSON reply, a missing token). Never throws. */
export async function verifyTurnstile(
  secret: string,
  token: string | null,
  ip: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const res = await fetchFn(TURNSTILE_VERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: unknown };
    return json.success === true;
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LINK_TOKEN = /^[0-9a-f]{64}$/;

export type ClaimBody = {
  gameId: string;
  roleId: string;
  forTeamId: string | null;
  divisionId: string;
  teamId: string;
  firstInitial: string;
  lastName: string;
  email: string;
  adult: boolean;
  confirmOverlap: boolean;
  turnstileToken: string;
};

/** The claim request body, shape-checked. Values are checked again by the
 *  database; this only refuses what isn't the right type. */
export function parseClaimBody(raw: unknown): ClaimBody | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof b[k] === "string" && (b[k] as string).length <= max ? (b[k] as string) : null);
  const id = (k: string) => (typeof b[k] === "string" && UUID.test(b[k] as string) ? (b[k] as string) : null);
  const gameId = id("gameId");
  const roleId = id("roleId");
  const divisionId = id("divisionId");
  const teamId = id("teamId");
  const forTeamId = b.forTeamId === null || b.forTeamId === undefined ? null : id("forTeamId");
  const firstInitial = str("firstInitial", 5);
  const lastName = str("lastName", 200);
  const email = str("email", 320);
  const turnstileToken = str("turnstileToken", 2048);
  if (!gameId || !roleId || !divisionId || !teamId || firstInitial === null || lastName === null || email === null || !turnstileToken) return null;
  if (b.forTeamId !== null && b.forTeamId !== undefined && forTeamId === null) return null;
  if (typeof b.adult !== "boolean" || (b.confirmOverlap !== undefined && typeof b.confirmOverlap !== "boolean")) return null;
  return {
    gameId, roleId, forTeamId, divisionId, teamId, firstInitial, lastName, email,
    adult: b.adult, confirmOverlap: b.confirmOverlap === true, turnstileToken,
  };
}

export function seasonParam(raw: string | null): string | null {
  return raw && UUID.test(raw) ? raw : null;
}
