// The volunteer email's From and Reply-To and the outbox error text. Moved to
// src/lib/outbound-email/headers.ts (2026-11-09, shared with officials
// sign-up); re-exported here so volunteer code and sims read the same names.
export {
  EMAIL_MAX,
  EMAIL_SHAPE,
  FALLBACK_LEAGUE_NAME,
  bareFromAddress,
  isEmailShape,
  leagueFromHeader as volunteerFromHeader,
  safeDisplayName,
  safeReplyTo,
  scrubError,
} from "@/lib/outbound-email/headers";
