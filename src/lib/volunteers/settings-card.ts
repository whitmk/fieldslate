// Settings → Volunteer sign-ups: what the card shows, decided here (pure) so
// sim:volunteer-email drives the same rules the card renders.
//
// The card exists ONLY for an org whose feature switch is on. Its read is
// `volunteer_admin_state` (0120); a failed read, a missing function (before
// 0120 is applied) or the switch off all mean NO CARD — real leagues never
// see the feature, and a transient error can't reveal it. The failure is
// logged on the server.
import { SITE_URL } from "@/lib/site";
import { LINK_NEEDS_CONTACT } from "./words";

export type VolunteerCardData = {
  elite: boolean;
  settings: { linkToken: string; linkEnabled: boolean; contactEmail: string | null } | null;
};

/** The admin_state reply → card data, or null for "no card". */
export function cardDataFromAdminState(raw: unknown): VolunteerCardData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.feature !== true) return null;
  const s = r.settings as Record<string, unknown> | null | undefined;
  let settings: VolunteerCardData["settings"] = null;
  if (s && typeof s === "object") {
    if (typeof s.link_token !== "string" || !/^[0-9a-f]{64}$/.test(s.link_token)) return null;
    settings = {
      linkToken: s.link_token,
      linkEnabled: s.link_enabled === true,
      contactEmail: typeof s.contact_email === "string" ? s.contact_email : null,
    };
  }
  return { elite: r.elite === true, settings };
}

export function volunteerSignupUrl(token: string): string {
  return `${SITE_URL}/v/${token}`;
}

/** Why the link switch can't be turned ON, or null when it can. Turning it
 *  OFF is always allowed. */
export function linkSwitchBlocked(state: { linkEnabled: boolean; savedContact: string | null }): string | null {
  if (state.linkEnabled) return null;
  return state.savedContact ? null : LINK_NEEDS_CONTACT;
}
