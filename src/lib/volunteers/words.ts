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

// ── Volunteer emails (rendered by email-templates.ts) ────────────────────────
export const EMAIL_FOOTER_REPLY = (league: string) => `Questions? Reply to this email to reach ${league}.`;
export const EMAIL_FOOTER_BRAND = "Sent by FieldSlate for your league.";
export const EMAIL_MANAGE = "Change or cancel your sign-up";
export const EMAIL_MANAGE_NOTE = "Changes close 24 hours before the spot. After that, reply to this email.";
export const EMAIL_PICK_NEW = "Pick a new spot";
export const EMAIL_SPOTS_HEADING = (n: number) => (n === 1 ? "Your spot" : "Your spots");

export const EMAIL_SIGNUP_SUBJECT = (role: string, when: string) => `You're signed up: ${role}, ${when}`;
export const EMAIL_SIGNUP_LEAD = (league: string) => `Thanks for volunteering with ${league}. You're signed up for:`;
export const EMAIL_SIGNUP_MOVES = "If this game moves or rains out, we'll email you.";

export const EMAIL_ASSIGNED_SUBJECT = (league: string, role: string, when: string) => `${league} signed you up: ${role}, ${when}`;
export const EMAIL_ASSIGNED_LEAD = (league: string) => `A ${league} admin signed you up to volunteer for:`;

export const EMAIL_SELF_CANCEL_SUBJECT = (role: string, when: string) => `Canceled: ${role}, ${when}`;
export const EMAIL_SELF_CANCEL_LEAD = "You canceled this volunteer spot:";

export const EMAIL_ADMIN_CANCEL_SUBJECT = (role: string, when: string) => `Your volunteer spot was canceled: ${role}, ${when}`;
export const EMAIL_ADMIN_CANCEL_LEAD = (league: string) => `A ${league} admin canceled your sign-up for:`;

export const EMAIL_ROLE_CANCEL_SUBJECT = (role: string, when: string) => `Your volunteer spot was canceled: ${role}, ${when}`;
export const EMAIL_ROLE_CANCEL_LEAD = (league: string) => `${league} changed this volunteer role, so this spot no longer exists:`;

export const EMAIL_LOST_SUBJECT = (role: string, when: string) => `Your volunteer spot is gone: ${role}, ${when}`;
export const EMAIL_LOST_LEAD = "This game was removed from the schedule, so this spot no longer exists:";

export const EMAIL_MOVED_SUBJECT = (role: string) => `Game moved: your ${role} spot`;
export const EMAIL_MOVED_LEAD = "The game for your volunteer spot moved.";
export const EMAIL_MOVED_STILL = "You're still signed up. Can't make the new time? Cancel it, or keep it, from your sign-ups.";
export const EMAIL_NOW = "Now";
export const EMAIL_WAS = "Was";

export const EMAIL_RAINOUT_SUBJECT = (role: string, when: string) => `Rained out: your ${role} spot, ${when}`;
export const EMAIL_RAINOUT_LEAD = "This game was rained out:";
export const EMAIL_RAINOUT_HELD = "Your spot is held. When the game gets a new date, we'll email you to confirm.";

export const EMAIL_MAKEUP_SUBJECT = (role: string, when: string) => `Makeup set: your ${role} spot, ${when}`;
export const EMAIL_MAKEUP_LEAD = "The rained-out game has a new date. You're still signed up:";
export const EMAIL_MAKEUP_CANT = "Can't make the new date? Cancel from your sign-ups.";

export const EMAIL_BACK_ON_SUBJECT = (role: string, when: string) => `Back on: your ${role} spot, ${when}`;
export const EMAIL_BACK_ON_LEAD = "The game is back on at its original time. You're still signed up:";

export const EMAIL_REMINDER_SUBJECT = (n: number) => (n === 1 ? "Reminder: your volunteer spot" : `Reminder: your ${n} volunteer spots`);
export const EMAIL_REMINDER_LEAD = (league: string) => `A reminder from ${league} — you're signed up for:`;

// ── Public sign-up page (/v/<token>) ─────────────────────────────────────────
export const PUB_TITLE = "Volunteer sign-ups";
export const PUB_SUBTITLE = (season: string) => `${season} · pick an open spot`;
export const PUB_ALL = "All";
export const PUB_SIGN_UP = "Sign up";
export const PUB_TAKEN = "Taken";
export const PUB_ONE_SPOT_OPEN = "1 spot open";
export const PUB_SPOTS_OPEN = (open: number, of: number) => `${open} of ${of} spots open`;
export const PUB_TAG_MAY_MOVE = "May move";
export const PUB_TAG_RAINED_OUT = "Rained out";
export const PUB_FOOTER = "Spots move with the schedule. If a game changes, we email you. · Powered by FieldSlate";
export const PUB_NO_SPOTS = "No open spots right now. Check back later.";
export const PUB_NO_MATCH = "No spots match. Try another filter.";
export const PUB_BACK = "← All spots";
export const PUB_YOURE_SIGNING_UP = "You're signing up for";
export const PUB_DIVISION = "Division";
export const PUB_CHOOSE_DIVISION = "Choose a division";
export const PUB_TEAM = "Team";
export const PUB_CHOOSE_TEAM = "Choose your child's team";
export const PUB_FIRST_INITIAL = "First initial";
export const PUB_LAST_NAME = "Last name";
export const PUB_EMAIL = "Email";
export const PUB_EMAIL_NOTE = "We'll send a confirmation with a link to change or cancel.";
export const PUB_ADULT = "I'm 18 or older";
export const PUB_CONFIRM = "Confirm sign-up";
export const PUB_PRIVACY = "Only league admins see your name, team and email. Everyone else sees this spot as \"Taken.\"";
export const PUB_OVERLAP_TITLE = "This email already has a spot at an overlapping time";
export const PUB_OVERLAP_DETAIL = "Signing someone else up? That's fine, just confirm.";
export const PUB_OVERLAP_YES = "Yes, take both spots";
export const PUB_DONE_TITLE = "You're signed up";
export const PUB_DONE_EMAILED = (email: string) =>
  `We emailed ${email} a confirmation. Use the link in it to change or cancel. If this game moves or rains out, we'll email you.`;
export const PUB_ANOTHER = "Sign up for another spot";
export const PUB_SEASON = "Season";
export const PUB_NEED_DIVISION = "Choose a division.";
export const PUB_NEED_TEAM = "Choose a team.";
export const PUB_NEED_INITIAL = "Enter your first initial (one letter).";
export const PUB_NEED_LAST = "Enter your last name.";
export const PUB_NEED_EMAIL = "Enter one email address.";
export const PUB_NEED_ADULT = "Volunteers must be 18 or older.";
export const PUB_JUST_TAKEN = "Someone just took this spot. Pick another one.";
export const PUB_ALREADY = "This email already has this spot.";
export const PUB_WRONG_TEAM = "That team isn't in this season. Reload and try again.";
export const PUB_INVALID = "Check your name and email and try again.";
export const PUB_RATE_LIMITED = "Too many sign-ups from here just now. Wait a little and try again.";
export const PUB_CAPTCHA = "We couldn't confirm you're not a bot. Try again.";
export const PUB_SPOT_GONE = "This spot isn't open anymore. Pick another one.";
export const PUB_LINK_OFF = "This sign-up link isn't working right now. Ask your league for a new one.";
export const PUB_FAILED = "Couldn't sign you up. Nothing was saved — please try again.";
export const PUB_UNKNOWN = "This sign-up link isn't recognized. Ask your league for the current link.";
export const PUB_LOAD_FAILED = "We couldn't load the sign-up page right now. Please try again in a minute.";
export const PUB_UNAVAILABLE = "Sign-ups are temporarily unavailable. Please try again later.";

// ── The volunteer's own page (/v/m/<token>) ──────────────────────────────────
export const MY_TITLE = "My sign-ups";
export const MY_PRIVATE =
  "This page is private to you. Anyone with this link can change these sign-ups, so don't share it. Changes close 24 hours before each spot.";
export const MY_CLOSED = (contact: string | null) =>
  contact
    ? `Less than 24 hours away. Online changes are closed. To cancel, contact the league: ${contact}`
    : "Less than 24 hours away. Online changes are closed. To cancel, reply to any sign-up email.";
export const MY_MOVED_TAG = "Game moved";
export const MY_NOW = "Now";
export const MY_WAS = "Was";
export const MY_MOVED_STILL = "You're still signed up. Can't make the new time?";
export const MY_KEEP = "Keep it";
export const MY_CANCEL = "Cancel";
export const MY_RAINED_TAG = "Rained out";
export const MY_RAINED_HELD = "Your spot is held. When the game gets a new date, we'll email you to confirm.";
export const MY_MAY_MOVE_TAG = "May move";
export const MY_MORE = "Sign up for more spots";
export const MY_TOTAL = (n: number) => `Your total this season: ${n} spot${n === 1 ? "" : "s"}`;
export const MY_QUESTIONS = "Questions? Reply to any sign-up email to reach the league.";
export const MY_NONE = "You have no upcoming sign-ups.";
export const MY_CANCEL_TITLE = "Cancel this spot?";
export const MY_CANCEL_DETAIL = "We'll email you a confirmation. You can sign up again if a spot is still open.";
export const MY_CANCEL_CONFIRM = "Cancel spot";
export const MY_CANCELED = "Canceled. We emailed you a confirmation.";
export const MY_KEPT = "Kept. You're signed up for the new time.";
export const MY_GONE = "That spot isn't on your list anymore. Reload to see your sign-ups.";
export const MY_ACTION_FAILED = "Couldn't save that. Nothing changed — please try again.";
export const MY_UNKNOWN = "This link isn't recognized. Use the link in your most recent sign-up email.";
export const MY_LOAD_FAILED = "We couldn't load your sign-ups right now. Please try again in a minute.";
