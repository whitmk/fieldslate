// Which outbox kinds have an email, and its words. EMPTY in 0120: nothing
// queues an email until 0121, and a row whose kind has no template fails as
// 'unknown_kind' and is never sent. Each later branch adds its kinds here,
// with the sentences in words.ts.
import type { RenderedEmail } from "./outbox-drain";

type Renderer = (payload: Record<string, unknown>, ctx: { leagueName: string | null }) => RenderedEmail | null;

const TEMPLATES: Record<string, Renderer> = {};

export function renderVolunteerEmail(
  kind: string,
  payload: Record<string, unknown>,
  ctx: { leagueName: string | null },
): RenderedEmail | null {
  const r = Object.prototype.hasOwnProperty.call(TEMPLATES, kind) ? TEMPLATES[kind] : undefined;
  return r ? r(payload, ctx) : null;
}
