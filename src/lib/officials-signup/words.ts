// Every sentence of officials self-sign-up (0124), rendered VERBATIM by the
// official's page, the coordinator's screens and the emails. One place, so a
// refusal can't be worded two ways. Plain words; no internal keys reach a
// person.

// ── The official's page (/o/<token>) ───────────────────────────────────────
export const PAGE_TITLE = "Sign up for games";
export const PAGE_UNKNOWN = "This link isn't working. Ask your league for a new one.";
export const PAGE_LOAD_FAILED = "We couldn't load your games right now. Try again in a minute.";
export const PAGE_PRIVATE =
  "This link is private to you. Anyone who has it can take or drop games for you, so don't share it.";
export const signingUpFor = (name: string) => `Signing up for ${name}`;
export const MINE_HEADING = "Your games";
export const MINE_NONE = "You don't have any games coming up.";
export const OPEN_HEADING = "Open spots";
export const OPEN_NONE = "No open spots right now. Your league will email you when it needs help.";
export const OPEN_CANT_HEADING = "Open, but not for you";
export const SIGNED_UP_TAG = "Signed up";
export const TAKE = "Take this spot";
export const DROP = "Drop";
export const DROP_TITLE = "Drop this game?";
export const DROP_DETAIL = "Your league will be told right away, and the spot opens for someone else.";
export const DROP_CONFIRM = "Drop it";
export const changeClosed = (contact: string | null) =>
  `This game is less than 48 hours away. To change it, email ${contact ?? "your league"}.`;
export const assignedByLeague = (contact: string | null) =>
  `Your league assigned this game. To change it, email ${contact ?? "your league"}.`;

/** Why the official can't take an open spot — their own reason only. */
export const PROBLEM_LINES: Record<string, string> = {
  blackout: "You're unavailable that day.",
  time_conflict: "You have another game then.",
  outside_availability: "It's outside the times you said you're available.",
  over_weekly_limit: "You've reached your games-per-week limit.",
  coach_conflict: "You coach one of these teams.",
  conflict_of_interest: "You have a conflict with one of these teams.",
  division_not_allowed: "That division isn't one of yours.",
  already_on_game: "You're already on this game.",
};

// ── Claim and drop results ───────────────────────────────────────────────
export const CLAIMED = "You're on it. We emailed you a confirmation.";
export const DROPPED = "Dropped. Your league has been told.";
export const JUST_TAKEN = "Someone just took that spot.";
export const NOT_OPEN = "That spot isn't open anymore.";
export const STARTED = "That game has already started.";
export const TOO_MANY = "Too many sign-ups from this link in the last hour. Try again later.";
export const NOT_ON_LIST = "That game isn't on your list anymore.";
export const SOMETHING_WRONG = "Something went wrong. Nothing was saved. Try again.";

// ── The coordinator ───────────────────────────────────────────────────────
export const HELP_BUTTON = "Ask for help";
export const HELP_TITLE = "Ask officials to sign up";
export const HELP_DETAIL =
  "Each official you pick gets an email listing the open spots they can take, with a new private link. Their old link stops working.";
export const HELP_NO_EMAIL_HINT = "No email — add one to their profile";
export const HELP_SEND = (n: number) => (n === 1 ? "Email 1 official" : `Email ${n} officials`);
export const HELP_PICK_SOME = "Pick at least one official.";
export const helpSentLine = (n: number) =>
  n === 0 ? "Nobody was emailed." : n === 1 ? "Emailed 1 official." : `Emailed ${n} officials.`;
export const helpSkippedLine = (name: string, reason: string) =>
  reason === "no_email"
    ? `${name} wasn't emailed: no email address.`
    : reason === "recent"
      ? `${name} wasn't emailed: they were emailed for help in the last 24 hours.`
      : `${name} wasn't emailed.`;
export const HELP_OFF = "Turn on officials sign-up in Settings first.";
export const HELP_FAILED = "Couldn't send the emails. Nobody was emailed. Try again.";

export const CREATE_LINK = "Create new link (the old one stops working)";
export const LINK_CREATED = "New link made. The old one no longer works. Copy it and send it to them:";
export const LINK_COPY = "Copy";
export const LINK_COPIED = "Copied";
export const LINK_COPY_REFUSED = "Couldn't copy. Select the link above and copy it.";
export const LINK_FAILED = "Couldn't make a new link. The old one still works. Try again.";
export const LINK_OFF = "Turn on officials sign-up in Settings to make a link.";

export const DIVISIONS_LABEL = "Divisions they can work";
export const DIVISIONS_ALL = "All divisions";
export const DIVISIONS_SOME = "Only these divisions";
export const DIVISIONS_SAVED = "Divisions saved.";
export const DIVISIONS_FAILED = "Couldn't save the divisions. Nothing changed. Try again.";
export const PARENT_EMAIL_LABEL = "Parent or guardian email";
export const PARENT_EMAIL_HINT = "For an official under 18, use a parent's or guardian's email. Our emails go there.";

// ── Settings card ─────────────────────────────────────────────────────────
export const CARD_TITLE = "Officials sign-up";
export const CARD_INTRO =
  "Let your officials take open spots themselves through a private link. Spots come from locked divisions only.";
export const CARD_CONTACT_LABEL = "Officials contact email";
export const CARD_CONTACT_HINT =
  "Officials' replies go here, and so do the emails telling you an official dropped a game and the daily list of games officials took.";
export const CARD_ON = "Officials can sign up";
export const CARD_NEEDS_CONTACT = "Confirm an officials contact email first.";
export const CARD_NEEDS_ELITE = "Officials sign-up is part of the Elite plan.";
export const UPGRADE_BUTTON = "Upgrade to turn it on";
export const CARD_SAVED = "Saved.";

const SETTINGS_ERRORS: Record<string, string> = {
  invalid_email: "That isn't an email address we can send to.",
  contact_required: "Add an officials contact email first.",
  plan_required: "Officials sign-up is part of the Elite plan.",
  signup_off: "Turn on officials sign-up in Settings first.",
  division_not_in_season: "One of those divisions isn't in this season.",
};
/** A refusal from the admin functions, worded; anything unknown is generic. */
export function adminErrorLine(message: string | null | undefined, fallback: string): string {
  const key = Object.keys(SETTINGS_ERRORS).find((k) => (message ?? "").includes(k));
  return key ? SETTINGS_ERRORS[key] : fallback;
}
