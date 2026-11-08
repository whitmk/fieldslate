// Every fixed volunteer sentence an admin or a volunteer reads, in one place
// so Spanish can be added later in one file. Surfaces render these VERBATIM.
// (The public help page's questions live in help-faq.ts, same folder.)

// ── Settings → Volunteer sign-ups (0120) ─────────────────────────────────────
export const CARD_TITLE = "Volunteer sign-ups";
export const CARD_INTRO =
  "Families sign up for volunteer spots from one link: game-day roles and snack shack shifts. You see every name; everyone else sees a spot as Taken.";
export const ELITE_ONLY = "Volunteer sign-ups are available on Elite.";
export const UPGRADE_BUTTON = "Upgrade to turn it on";

export const CONTACT_TITLE = "League contact email";
export const CONTACT_DETAIL =
  "Every volunteer email replies to this address, and volunteers who need to change a spot within 24 hours are told to write here. Use an address your board checks.";
export const CONTACT_SAVE = "Save";
export const CONTACT_SAVED = "Saved.";
export const CONTACT_CLEARED = "Contact email removed.";

export const LINK_TITLE_ON = "Sign-up link is on";
export const LINK_TITLE_OFF = "Sign-up link is off";
export const LINK_DETAIL =
  "Turning it off stops new sign-ups. Turning it back on brings back the same link.";
export const LINK_NEEDS_CONTACT = "Add a league contact email to turn the link on.";
export const LINK_ON_NOTICE = "The sign-up link is on.";
export const LINK_OFF_NOTICE = "The sign-up link is off. New sign-ups are stopped.";

export const LINK_BLOCK_TITLE = "Link";
export const LINK_BLOCK_DETAIL = "Share it with families or put it on your league's website.";
/** Until the sign-up page ships (0121), the link opens nothing. Remove with it. */
export const LINK_NOT_BUILT_YET =
  "The sign-up page isn't built yet. This link won't open anything until it is.";
export const LINK_FIRST = "Save a contact email and turn the link on to get your link.";

export const RESET_TITLE = "Reset link";
export const RESET_DETAIL = "Makes a new link. The old one stops working right away.";
export const RESET_BUTTON = "Reset link…";
export const RESET_CONFIRM_TITLE = "Reset your volunteer sign-up link?";
export const RESET_CONFIRM_DETAIL =
  "The current link stops working. Anyone who saved it, and any website that links to it, will need the new link. Existing sign-ups are kept.";
export const RESET_CONFIRM_LABEL = "Reset link";
export const RESET_DONE = "New link made. Share the new link with families.";
export const RESET_FAILED = "Couldn't reset the link. Nothing changed — please try again.";

/** A refusal from 0120's admin functions, in words. Anything unrecognized is
 *  the generic sentence — never the raw database message. */
export function settingsErrorLine(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("invalid_email")) return "That doesn't look like one email address. Check it and try again.";
  if (m.includes("contact_required")) return "Turn the sign-up link off before removing the contact email.";
  if (m.includes("plan_required")) return "Your plan doesn't include volunteer sign-ups.";
  if (m.includes("feature_off")) return "Volunteer sign-ups aren't turned on for your league.";
  if (m.includes("not_authorized")) return "You don't have access to this league's settings.";
  return "Couldn't save. Nothing changed — please try again.";
}
