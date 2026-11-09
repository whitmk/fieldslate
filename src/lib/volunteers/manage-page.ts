// The volunteer's own page (/v/m/<token>) — every decision it shows, pure,
// so sim:volunteer-manage-page drives the same rules the page renders. The
// database decides (volunteer_manage_page / volunteer_cancel /
// volunteer_keep_spot, 0121); this reads their replies.
//
// Approved plan (2026-11-08) against docs/mockups/volunteer-signup/
// MySignups: the private-link note; each spot normal, "Game moved" (Now /
// Was, Keep it or Cancel), "Rained out" (held), or inside 24 hours (closed —
// contact the league); "Sign up for more spots" and the season total. No
// "Switch" (cut in v1).
import { emailWhen } from "./email-templates";
import * as W from "./words";

export type MyClaim = {
  claim_id: string;
  role_name: string;
  for_team_name: string | null;
  family_team_name: string | null;
  family_division_name: string | null;
  home_team_name: string;
  away_team_name: string | null;
  field: string | null;
  park: string | null;
  start: string;
  state: "open" | "may_move" | "rained_out" | "closed" | "none";
  was_start: string | null;
  was_field: string | null;
  can_change: boolean;
};
export type MyPage = {
  leagueName: string;
  contactEmail: string | null;
  signupToken: string | null;
  who: string;
  claims: MyClaim[];
};
export type MyReply = { kind: "ok"; page: MyPage } | { kind: "unknown" } | { kind: "error" };

export function readManageReply(raw: unknown): MyReply {
  if (!raw || typeof raw !== "object") return { kind: "error" };
  const r = raw as Record<string, unknown>;
  if (r.status === "unknown" || r.status === "plan") return { kind: "unknown" };
  if (r.status !== "ok" || !Array.isArray(r.claims) || typeof r.first_initial !== "string" || typeof r.last_name !== "string") {
    return { kind: "error" };
  }
  const claims = r.claims as MyClaim[];
  const fam = claims.find((c) => c.family_team_name);
  const team = fam ? [fam.family_division_name, fam.family_team_name].filter(Boolean).join(" ") : "";
  return {
    kind: "ok",
    page: {
      leagueName: typeof r.league_name === "string" && r.league_name.trim() ? r.league_name : "Your league",
      contactEmail: typeof r.contact_email === "string" ? r.contact_email : null,
      signupToken: typeof r.signup_token === "string" && /^[0-9a-f]{64}$/.test(r.signup_token) ? r.signup_token : null,
      who: [`${r.first_initial}. ${r.last_name}`, team].filter(Boolean).join(" · "),
      claims,
    },
  };
}

export function claimTitle(c: MyClaim): string {
  return c.for_team_name ? `${c.role_name} · ${c.for_team_name}` : c.role_name;
}

export function claimWhere(c: MyClaim, field: string | null = c.field): string {
  const game = c.away_team_name ? `${c.home_team_name} vs ${c.away_team_name}` : c.home_team_name;
  const place = field ? (c.park && field === c.field ? `${field} (${c.park})` : field) : "";
  return [game, place].filter(Boolean).join(" · ");
}

/** What a spot's card says and offers. Order matters: inside 24 hours, no
 *  online change at all (the database refuses one); a moved game offers
 *  Keep it and Cancel; a rained-out game is held; otherwise Cancel. */
export type ClaimView =
  | { kind: "closed"; line: string; tag: string | null }
  | { kind: "moved"; now: string; was: string; canKeep: true; canCancel: true }
  | { kind: "rained_out"; canCancel: true }
  | { kind: "normal"; tag: string | null; canCancel: true };

export function claimView(c: MyClaim, contact: string | null): ClaimView {
  const tag = c.state === "rained_out" ? W.MY_RAINED_TAG : c.state === "may_move" ? W.MY_MAY_MOVE_TAG : c.was_start ? W.MY_MOVED_TAG : null;
  if (!c.can_change) return { kind: "closed", line: W.MY_CLOSED(contact), tag };
  if (c.was_start) {
    const was = [emailWhen(c.was_start), c.was_field].filter(Boolean).join(" · ");
    return { kind: "moved", now: `${W.MY_NOW} ${emailWhen(c.start) ?? ""} · ${claimWhere(c)}`, was: `${W.MY_WAS} ${was}`, canKeep: true, canCancel: true };
  }
  if (c.state === "rained_out") return { kind: "rained_out", canCancel: true };
  return { kind: "normal", tag, canCancel: true };
}

export type ActionOutcome = { kind: "ok"; line: string } | { kind: "closed"; line: string } | { kind: "error"; line: string; reload: boolean };

export function cancelOutcome(raw: unknown, contact: string | null): ActionOutcome {
  const s = (raw && typeof raw === "object" ? (raw as Record<string, unknown>).status : null) ?? null;
  if (s === "canceled") return { kind: "ok", line: W.MY_CANCELED };
  if (s === "change_closed") {
    const c = (raw as Record<string, unknown>).contact_email;
    return { kind: "closed", line: W.MY_CLOSED(typeof c === "string" ? c : contact) };
  }
  if (s === "not_found") return { kind: "error", line: W.MY_GONE, reload: true };
  if (s === "unknown" || s === "plan") return { kind: "error", line: W.MY_UNKNOWN, reload: false };
  return { kind: "error", line: W.MY_ACTION_FAILED, reload: false };
}

export function keepOutcome(raw: unknown): ActionOutcome {
  const s = (raw && typeof raw === "object" ? (raw as Record<string, unknown>).status : null) ?? null;
  if (s === "kept") return { kind: "ok", line: W.MY_KEPT };
  if (s === "not_found") return { kind: "error", line: W.MY_GONE, reload: true };
  if (s === "unknown") return { kind: "error", line: W.MY_UNKNOWN, reload: false };
  return { kind: "error", line: W.MY_ACTION_FAILED, reload: false };
}
