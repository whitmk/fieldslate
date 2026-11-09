// The officials outbox's five emails (0124). Pure: the drain hands each row
// what the take attached (game, open spots, the claims, the link token) and
// gets back subject + html + text, or NULL when the row can't be described —
// the drain then fails the row ("unknown_kind"), never sends a blank email.
// Every person-supplied string is escaped in the html.
import type { BaseOutboxRow, RenderedEmail } from "@/lib/outbound-email/outbox-drain";
import { gameWhat, gameWhen, officialLinkUrl, type GameInfo } from "./page";

export type OfficialOutboxRow = BaseOutboxRow & {
  seasonName: string | null;
  officialName: string | null;
  youth: boolean;
  linkToken: string | null;
  game: GameInfo | null;
  spots: GameInfo[];
  claims: (GameInfo & { official_name: string | null })[];
};

export const OFFICIAL_EMAIL_KINDS = [
  "help_request",
  "claim_confirmed",
  "drop_confirmed",
  "drop_notice",
  "claims_digest",
] as const;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function gameLine(g: GameInfo): string {
  return `${gameWhen(g)} — ${g.role}${gameWhat(g) ? ` · ${gameWhat(g)}` : ""}`;
}

function assemble(subject: string, league: string, paras: string[], list: string[], link?: { url: string; label: string }): RenderedEmail {
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0C1F3F;max-width:600px">`,
    `<p style="font-size:12px;color:#6b7280;margin:0 0 12px">${esc(league)}</p>`,
    ...paras.map((p) => `<p style="font-size:15px;line-height:1.5">${esc(p)}</p>`),
    list.length ? `<ul style="font-size:15px;line-height:1.6;padding-left:18px">${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "",
    link
      ? `<p><a href="${esc(link.url)}" style="display:inline-block;background:#22C55E;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(link.label)}</a></p>`
      : "",
    `<p style="font-size:12px;color:#6b7280">Sent by FieldSlate for ${esc(league)}. Reply to this email to reach your league.</p>`,
    `</div>`,
  ].join("");
  const text = [
    league,
    "",
    ...paras,
    ...(list.length ? ["", ...list.map((l) => `- ${l}`)] : []),
    ...(link ? ["", `${link.label}: ${link.url}`] : []),
    "",
    `Sent by FieldSlate for ${league}. Reply to this email to reach your league.`,
  ].join("\n");
  return { subject, html, text };
}

export function renderOfficialEmail(row: OfficialOutboxRow): RenderedEmail | null {
  const league = row.leagueName?.trim() || "Your league";
  const name = row.officialName?.trim() || null;
  switch (row.kind) {
    case "help_request": {
      if (!row.linkToken || !/^[0-9a-f]{64}$/.test(row.linkToken) || !name) return null;
      const lead = row.youth
        ? `${league} needs officials. Here are open games ${name} can take:`
        : `${league} needs officials. Here are open games you can take:`;
      const paras = row.spots.length
        ? [lead]
        : [`${league} needs officials. Open the link to see the games that are open right now.`];
      paras.push(
        "Take any of them with the link below. It's private to " +
          (row.youth ? `${name} — ` : "you — ") +
          "anyone who has it can take or drop games, and any link we sent before no longer works.",
      );
      return assemble(
        row.youth ? `${league} needs officials — games ${name} can take` : `${league} needs officials`,
        league,
        paras,
        row.spots.map(gameLine),
        { url: officialLinkUrl(row.linkToken), label: "See open games" },
      );
    }
    case "claim_confirmed": {
      if (!row.game || !name) return null;
      return assemble(
        `You're on: ${gameWhen(row.game)}`,
        league,
        [row.youth ? `${name} is signed up for this game:` : "You're signed up for this game:",
         "You can drop it from your link until 48 hours before the game."],
        [gameLine(row.game)],
      );
    }
    case "drop_confirmed": {
      if (!row.game || !name) return null;
      return assemble(
        `Dropped: ${gameWhen(row.game)}`,
        league,
        [row.youth ? `${name} is no longer on this game:` : "You're no longer on this game:", "Your league has been told."],
        [gameLine(row.game)],
      );
    }
    case "drop_notice": {
      if (!row.game || !name) return null;
      return assemble(
        `${name} dropped ${gameWhen(row.game)}`,
        league,
        [`${name} dropped this game through their sign-up link. The spot is open again.`],
        [gameLine(row.game)],
      );
    }
    case "claims_digest": {
      if (row.claims.length === 0) return null;
      const n = row.claims.length;
      return assemble(
        n === 1 ? "Officials took 1 game" : `Officials took ${n} games`,
        league,
        [n === 1 ? "Since the last update, an official took this game:" : `Since the last update, officials took these ${n} games:`],
        row.claims.map((c) => `${c.official_name ?? "An official"}: ${gameLine(c)}`),
      );
    }
    default:
      return null;
  }
}
