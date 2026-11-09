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

// ── Admin: volunteer roles (/dashboard/volunteers) ───────────────────────────
export const NAV_LABEL = "Volunteers";
export const ROLES_TITLE = "Volunteer roles";
export const WHO_SIGNED_UP_LINK = "Who signed up →";
export const NO_SEASON = "Create a season to set up volunteer roles.";
export const ROLES_READ_FAILED = "Couldn't load this season's volunteer roles. Nothing is shown rather than a partial list — try again.";

export const STRIP_TITLE = "Public sign-up link";
export const STRIP_DETAIL =
  "Post it on your league site or send it to families. Shows only roles with sign-ups on. Names are never shown, only \"Taken.\"";
export const STRIP_ON = "Link is on";
export const STRIP_OFF = "Link is off";
export const STRIP_COPY = "Copy link";
export const STRIP_COPIED = "Copied";
export const STRIP_OPEN = "Open ↗";
export const STRIP_SETTINGS = "Settings →";
export const STRIP_NO_LINK = "Turn the sign-up link on in Settings to share it.";

export const ROLES_TABLE_TITLE = "Roles this season";
export const ADD_ROLE = "+ Add role";
export const COL_ROLE = "Role";
export const COL_SLOTS = "Slots";
export const COL_DIVISIONS = "Divisions";
export const COL_SIGNUPS = "Sign-ups";
export const COL_FILLED = "Filled";
export const SIGNUPS_ON = "On";
export const SIGNUPS_OFF = "Off";
export const NO_ROLES = "No roles yet. Add one — for example GameChanger, field prep or announcer.";
export const FILLED_UNKNOWN = "Couldn't count";

export const UMPIRES_ROLE = "Umpires";
export const UMPIRES_SOURCE = "From the Umpires page roster";
export const UMPIRES_SLOTS = "Per division setting";
export const UMPIRES_SIGNUPS = "Assigned by admin";
export const UMPIRES_LINK = "Umpires page →";
export const UMPIRES_FOOTNOTE =
  "Umpires never use the public link. A later phase adds personal links for rostered umpires, so they can claim open slots they're eligible for.";

export const EDIT_ROLE_TITLE = (name: string) => `Edit role: ${name}`;
export const NEW_ROLE_TITLE = "Add a role";
export const FIELD_NAME = "Role name";
export const FIELD_KIND = "Slots are created";
export const KIND_PER_GAME = "Per game";
export const KIND_PER_GAME_DETAIL = "Like field prep or announcer. Home games only.";
export const KIND_PER_TEAM = "Per our team in the game";
export const KIND_PER_TEAM_DETAIL =
  "Two of our teams playing each other gets 2 slots. An interleague game gets 1, for our team only.";
export const KIND_LOCKED = "Can't change while people are signed up for this role.";
export const FIELD_SPOTS = "How many each";
export const FIELD_DIVISIONS = "Divisions";
export const FIELD_LEAD = "Starts before the game";
export const LEAD_DETAIL = "Minutes before the first pitch the spot starts (0–120). It ends when the game ends.";
export const FIELD_OPEN = "Open on the public sign-up link";
export const SAVE_ROLE = "Save role";
export const CANCEL = "Cancel";
export const DELETE_ROLE = "Delete role";
export const PARTNER_NOTE = "Games waiting on a partner league's answer get slots once they're agreed.";

/** A role refusal from save/delete_volunteer_role, in words. */
export function roleErrorLine(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("name_required")) return "Give the role a name.";
  if (m.includes("name_taken")) return "This season already has a role with that name.";
  if (m.includes("invalid_spots")) return "Choose 1 to 10 spots.";
  if (m.includes("invalid_lead")) return "Choose 0 to 120 minutes.";
  if (m.includes("invalid_kind")) return "Choose how slots are created.";
  if (m.includes("division_not_in_season")) return "One of those divisions isn't in this season. Reload and try again.";
  if (m.includes("kind_locked")) return KIND_LOCKED;
  if (m.includes("role_not_found")) return "This role was deleted. Reload to see the current roles.";
  if (m.includes("season_archived")) return "This season is archived.";
  return settingsErrorLine(m);
}

// ── Admin: who signed up (/dashboard/volunteers/signups) ─────────────────────
export const SIGNUPS_TITLE = "Who signed up";
export const BACK_TO_ROLES = "← Volunteer roles";
export const EXPORT_CSV = "Export CSV";
export const SIGNUPS_READ_FAILED =
  "Couldn't load this season's sign-ups. Nothing is shown rather than a list that could be missing someone — try again.";
export const SEE_WHO = "See who";
export const HIDE_WHO = "Hide";
export const FILTER_ALL_ROLES = "All roles";
export const FILTER_ALL_DIVISIONS = "All divisions";
export const SHOW_ALL = "Open and filled";
export const SHOW_OPEN = "Open only";
export const SHOW_FILLED = "Filled only";
export const COL_WHEN = "When";
export const COL_SPOT = "Spot";
export const COL_VOLUNTEER = "Volunteer";
export const COL_TEAM = "Team";
export const COL_EMAIL = "Email";
export const COL_FILLED_BY = "Filled by";
export const COL_ACTIONS = "Actions";
export const OPEN_SPOT = "Open";
export const BY_VOLUNTEER = "Volunteer";
export const BY_ADMIN = "Admin";
export const ASSIGN = "Assign";
export const CHANGE = "Change";
export const NO_UPCOMING = "No upcoming spots match these filters.";
export const PAST_TITLE = "Past spots: mark who didn't show";
export const PAST_DETAIL =
  "Everyone counts as showed up unless you tick No-show. Only on dates that have passed. Admin-only; volunteers aren't notified. Deleted at archive like everything else.";
export const NO_SHOW = "No-show";
export const NO_SHOW_FAILED = "Couldn't save the no-show. Try again.";
export const ASSIGN_TITLE = "Assign this spot";
export const ASSIGN_FAMILY_TEAM = "Family's team";
export const ASSIGN_PICK_TEAM = "Choose a team";
export const ASSIGN_FIRST_INITIAL = "First initial";
export const ASSIGN_LAST_NAME = "Last name";
export const ASSIGN_EMAIL = "Email";
export const ASSIGN_ADULT = "This volunteer is 18 or older";
export const ASSIGN_EMAIL_NOTE = "We'll email them a confirmation with a link to change or cancel.";
export const ASSIGN_ANYWAY = "Assign anyway";
export const CHANGE_TITLE = "Change this sign-up";
export const CHANGE_NOTIFY = "Email the volunteer that their spot was canceled";
export const CHANGE_CANCEL = "Cancel sign-up";
export const CHANGE_REASSIGN = "Cancel and assign someone else";
export const CHANGE_FAILED = "Couldn't cancel this sign-up. Nothing changed — try again.";
