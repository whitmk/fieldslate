// Every volunteer email the outbox sends (0121): kind → words. The drain
// hands each template the row's payload plus what the take attached (0121
// part 6): the spots as they are NOW, a manage link token where the email
// offers "change or cancel", and the league's sign-up link token when the
// link is on. Sentences live in words.ts. A template that can't describe its
// spot returns null — the drain fails the row ('unknown_kind') rather than
// send an email that says nothing. Never another volunteer's name.
import { SITE_URL } from "@/lib/site";
import type { RenderedEmail } from "./outbox-drain";
import * as W from "./words";

export type EmailSpot = {
  claim_id: string;
  role_name: string | null;
  for_team_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  field: string | null;
  park: string | null;
  start: string | null;
  state: string | null;
  was_start: string | null;
  was_field: string | null;
};

export type RenderCtx = {
  leagueName: string | null;
  spots?: EmailSpot[];
  manageToken?: string | null;
  signupToken?: string | null;
};

type Renderer = (payload: Record<string, unknown>, ctx: RenderCtx) => RenderedEmail | null;

const TOKEN = /^[0-9a-f]{64}$/;

export function manageUrl(token: string): string {
  return `${SITE_URL}/v/m/${token}`;
}
export function signupUrl(token: string): string {
  return `${SITE_URL}/v/${token}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "Sat, Mar 6 · 9:00 AM" from a wall clock (no zone, no instant). */
export function emailWhen(wall: string | null): string | null {
  const m = wall ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall) : null;
  if (!m) return null;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
  const h = +m[4];
  return `${day}, ${mon} ${+m[3]} · ${h % 12 === 0 ? 12 : h % 12}:${m[5]} ${h < 12 ? "AM" : "PM"}`;
}

/** The spot's role, with its team for a per-team role. */
export function spotTitle(s: EmailSpot): string | null {
  if (!s.role_name) return null;
  return s.for_team_name ? `${s.role_name} · ${s.for_team_name}` : s.role_name;
}

/** "Expos vs Pirates · Field 1 (Main Park)". */
export function spotWhere(s: EmailSpot, field: string | null = s.field): string {
  const game = s.home_team_name ? (s.away_team_name ? `${s.home_team_name} vs ${s.away_team_name}` : s.home_team_name) : "";
  const place = field ? (s.park && field === s.field ? `${field} (${s.park})` : field) : "";
  return [game, place].filter(Boolean).join(" · ");
}

type Block = { text: string; html: string };
const para = (t: string): Block => ({ text: t, html: `<p style="margin:0 0 12px">${esc(t)}</p>` });
const link = (label: string, url: string): Block => ({
  text: `${label}: ${url}`,
  html: `<p style="margin:0 0 12px"><a href="${esc(url)}" style="color:#0C1F3F;font-weight:600">${esc(label)}</a></p>`,
});
function spotBlock(s: EmailSpot, opts: { moved?: boolean } = {}): Block | null {
  const title = spotTitle(s);
  const when = emailWhen(s.start);
  if (!title || !when) return null;
  const lines = [title, opts.moved ? `${W.EMAIL_NOW}: ${when}` : when, spotWhere(s)].filter(Boolean);
  if (opts.moved && s.was_start) {
    const wasWhen = emailWhen(s.was_start);
    if (wasWhen) lines.push(`${W.EMAIL_WAS}: ${[wasWhen, s.was_field].filter(Boolean).join(" · ")}`);
  }
  return {
    text: lines.map((l, i) => (i === 0 ? l : `  ${l}`)).join("\n"),
    html: `<p style="margin:0 0 12px;padding:10px 12px;background:#f3f4f6;border-radius:8px"><strong>${esc(lines[0])}</strong>${lines
      .slice(1)
      .map((l) => `<br>${esc(l)}`)
      .join("")}</p>`,
  };
}

function assemble(subject: string, league: string, blocks: Block[]): RenderedEmail {
  const all = [...blocks, para(W.EMAIL_FOOTER_REPLY(league)), para(W.EMAIL_FOOTER_BRAND)];
  return {
    subject,
    text: all.map((b) => b.text).join("\n\n"),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:560px">${all
      .map((b) => b.html)
      .join("")}</div>`,
  };
}

const league = (ctx: RenderCtx) => ctx.leagueName?.trim() || "Your league";
const first = (ctx: RenderCtx): EmailSpot | null => (ctx.spots && ctx.spots.length > 0 ? ctx.spots[0] : null);
const manage = (ctx: RenderCtx): Block | null =>
  ctx.manageToken && TOKEN.test(ctx.manageToken) ? link(W.EMAIL_MANAGE, manageUrl(ctx.manageToken)) : null;
const pickNew = (ctx: RenderCtx): Block[] =>
  ctx.signupToken && TOKEN.test(ctx.signupToken) ? [link(W.EMAIL_PICK_NEW, signupUrl(ctx.signupToken))] : [];

/** One spot, a lead line, optional extra lines and links. Null when the spot
 *  can't be described, or a required manage link is missing. */
function single(
  ctx: RenderCtx,
  subject: (role: string, when: string) => string,
  lead: string,
  after: Block[],
  opts: { needManage?: boolean; moved?: boolean; pickNew?: boolean } = {},
): RenderedEmail | null {
  const s = first(ctx);
  const block = s ? spotBlock(s, { moved: opts.moved }) : null;
  if (!s || !block) return null;
  const m = manage(ctx);
  if (opts.needManage && !m) return null;
  const blocks = [para(lead), block, ...after];
  if (m && opts.needManage) blocks.push(m, para(W.EMAIL_MANAGE_NOTE));
  if (opts.pickNew) blocks.push(...pickNew(ctx));
  return assemble(subject(spotTitle(s)!, emailWhen(s.start)!), league(ctx), blocks);
}

const TEMPLATES: Record<string, Renderer> = {
  signup_confirmed: (_p, ctx) =>
    single(ctx, W.EMAIL_SIGNUP_SUBJECT, W.EMAIL_SIGNUP_LEAD(league(ctx)), [para(W.EMAIL_SIGNUP_MOVES)], { needManage: true }),
  admin_assigned: (_p, ctx) =>
    single(ctx, (r, w) => W.EMAIL_ASSIGNED_SUBJECT(league(ctx), r, w), W.EMAIL_ASSIGNED_LEAD(league(ctx)), [para(W.EMAIL_SIGNUP_MOVES)], {
      needManage: true,
    }),
  canceled_by_volunteer: (_p, ctx) => single(ctx, W.EMAIL_SELF_CANCEL_SUBJECT, W.EMAIL_SELF_CANCEL_LEAD, []),
  admin_canceled: (_p, ctx) =>
    single(ctx, W.EMAIL_ADMIN_CANCEL_SUBJECT, W.EMAIL_ADMIN_CANCEL_LEAD(league(ctx)), [], { pickNew: true }),
  shift_canceled: (_p, ctx) =>
    single(ctx, W.EMAIL_ROLE_CANCEL_SUBJECT, W.EMAIL_ROLE_CANCEL_LEAD(league(ctx)), [], { pickNew: true }),
  spot_lost: (_p, ctx) => single(ctx, W.EMAIL_LOST_SUBJECT, W.EMAIL_LOST_LEAD, [], { pickNew: true }),
  game_moved: (_p, ctx) =>
    single(ctx, (r) => W.EMAIL_MOVED_SUBJECT(r), W.EMAIL_MOVED_LEAD, [para(W.EMAIL_MOVED_STILL)], { needManage: true, moved: true }),
  rained_out: (_p, ctx) => single(ctx, W.EMAIL_RAINOUT_SUBJECT, W.EMAIL_RAINOUT_LEAD, [para(W.EMAIL_RAINOUT_HELD)], { needManage: true }),
  makeup_set: (_p, ctx) => single(ctx, W.EMAIL_MAKEUP_SUBJECT, W.EMAIL_MAKEUP_LEAD, [para(W.EMAIL_MAKEUP_CANT)], { needManage: true }),
  back_on: (_p, ctx) => single(ctx, W.EMAIL_BACK_ON_SUBJECT, W.EMAIL_BACK_ON_LEAD, [], { needManage: true }),
  reminder: (_p, ctx) => {
    const spots = (ctx.spots ?? []).map((s) => spotBlock(s)).filter((b): b is Block => b !== null);
    const m = manage(ctx);
    if (spots.length === 0 || !m) return null;
    return assemble(W.EMAIL_REMINDER_SUBJECT(spots.length), league(ctx), [
      para(W.EMAIL_REMINDER_LEAD(league(ctx))),
      ...spots,
      m,
      para(W.EMAIL_MANAGE_NOTE),
    ]);
  },
};

export function renderVolunteerEmail(kind: string, payload: Record<string, unknown>, ctx: RenderCtx): RenderedEmail | null {
  const r = Object.prototype.hasOwnProperty.call(TEMPLATES, kind) ? TEMPLATES[kind] : undefined;
  return r ? r(payload, ctx) : null;
}

/** The kinds that have an email — the sim checks every kind the database can
 *  queue is either here or deliberately not built yet. */
export const TEMPLATE_KINDS = Object.keys(TEMPLATES);
