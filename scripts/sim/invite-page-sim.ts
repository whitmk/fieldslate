// Golden-markup harness for the public interleague invite page
// (src/app/invite/[token]/page.tsx) — the ANONYMOUS partner's page.
//
// WHY THIS EXISTS: Case A (a signed-in FieldSlate league accepting an invite
// onto its own schedule) adds a branch to this page. The anonymous branch is
// load-bearing for every non-FieldSlate partner today, so its markup was
// captured from the PRE-CHANGE tree, in its own commit, BEFORE the page was
// touched — the reschedule-picker variant discipline. Every later change to
// the page must keep these goldens byte-identical (part G below).
//
// The ONE sanctioned difference: the footer promo line. The approved Case A
// scope REPLACES the existing "Curious about FieldSlate?" footer paragraph
// with new copy, so part G compares the page with the <footer> element
// stripped on BOTH sides and separately pins that the footer is the ONLY
// place the markup moved. Never widen the strip.
//
// HOW THE PAGE IS RENDERED OUTSIDE NEXT: the page is an async server
// component that reads the token payload through `createClient().rpc(...)`
// from "@/lib/supabase/server" (which imports next/headers). The harness
// intercepts that ONE module at the CJS loader (`Module._load`) and hands the
// page a fake client whose rpc() returns a fixture payload keyed by token.
// The page function is awaited to obtain its element tree, then rendered
// with renderToStaticMarkup. Nothing else is stubbed: next/link, lucide, the
// brand lockup and the InviteForm client component all render for real.
//
// STATES (one golden each, scripts/sim/fixtures/invite-page/<state>.html):
//   pending          the response form: personal note, home + away games
//   pending-no-games "No games proposed yet"
//   accepted         revisit screen WITH a schedule link and countered games
//   accepted-no-link revisit screen without a schedule token (pre-0090 rows)
//   declined         revisit screen
//   superseded       revisit screen
//   not-found        RPC returned null
//
// RECORD=1 rewrites the goldens. That is legitimate ONLY on the capture commit
// (the pre-change tree). If part G fails later, the anonymous page changed —
// fix the page, do not re-record.
//
// Run: npm run sim:invite-page   (TZ=UTC pinned in package.json)

import * as React from "react";
import Module from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;

if (process.env.TZ !== "UTC") {
  console.error("Run with TZ=UTC (npm run sim:invite-page).");
  process.exit(1);
}

let checks = 0;
let fails = 0;
function ok(cond: boolean, name: string, detail = "") {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Fixture payloads (the shape get_interleague_invite_by_token returns) ────

const GAME_HOME = {
  id: "g-home-1",
  scheduled_at: "2026-10-10T09:00:00+00:00",
  is_away: false,
  external_team_name: null,
  proposed_scheduled_at: null,
  proposed_venue_name: null,
  home_team: { name: "Dodgers" },
  division: { id: "d-majors", name: "Majors" },
  venue: { name: "Andrews", location: { name: "Monroe Complex" } },
};
const GAME_HOME_NO_LOC = {
  ...GAME_HOME,
  id: "g-home-2",
  scheduled_at: "2026-10-17T11:30:00+00:00",
  home_team: { name: "Giants" },
  division: { id: "d-minors", name: "Minors" },
  venue: { name: "Polley Field", location: null },
};
const GAME_AWAY = {
  id: "g-away-1",
  scheduled_at: "2026-10-24T13:00:00+00:00",
  is_away: true,
  external_team_name: null,
  proposed_scheduled_at: null,
  proposed_venue_name: null,
  home_team: { name: "Red Sox" },
  division: { id: "d-majors", name: "Majors" },
  venue: null,
};

function invite(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    token: "tok-" + status,
    status,
    personal_note: "Looking forward to playing you this fall!",
    created_at: "2026-09-01T10:00:00+00:00",
    updated_at: "2026-09-15T14:30:00+00:00",
    recipient_email: "admin@westside.example",
    schedule_token: null,
    ...extra,
  };
}

const BASE = {
  sender: { full_name: "Jen Medici", email: "jen@srall.example" },
  org: { id: "iorg-1", name: "Westside Little League" },
  season: {
    id: "season-1",
    name: "SRALL",
    season: "Fall 2026",
    start_date: "2026-09-05",
    end_date: "2026-11-14",
  },
  scheduled_game_count: 0,
  countered_game_count: 0,
};

export const FIXTURES: Record<string, unknown> = {
  pending: { ...BASE, invite: invite("pending"), games: [GAME_HOME, GAME_HOME_NO_LOC, GAME_AWAY] },
  "pending-no-games": {
    ...BASE,
    invite: invite("pending", { personal_note: null }),
    games: [],
  },
  accepted: {
    ...BASE,
    invite: invite("accepted", { schedule_token: "sched-abc" }),
    scheduled_game_count: 5,
    countered_game_count: 2,
    games: [],
  },
  "accepted-no-link": {
    ...BASE,
    invite: invite("accepted"),
    scheduled_game_count: 3,
    games: [],
  },
  declined: { ...BASE, invite: invite("declined"), games: [] },
  superseded: { ...BASE, invite: invite("superseded"), games: [] },
  "not-found": null,
};

// ── Loader hook: the fake server client ─────────────────────────────────────
//
// `createClient()` is the only thing the page takes from "@/lib/supabase/server".
// `rpc` is keyed by token so one client serves every state. `auth.getUser`
// answers "not signed in" unless a test sets `signedInUser` (the Case A
// branch, added later — the goldens are all recorded with user = null).

type FakeUser = { id: string; email: string } | null;
export const fake = {
  signedInUser: null as FakeUser,
  rpcCalls: [] as { fn: string; args: unknown }[],
  fromCalls: [] as string[],
};

function makeFakeClient() {
  return {
    rpc: async (fn: string, args: { p_token?: string }) => {
      fake.rpcCalls.push({ fn, args });
      if (fn !== "get_interleague_invite_by_token") {
        throw new Error(`fake client: unexpected rpc ${fn}`);
      }
      const key = (args.p_token ?? "").replace(/^tok-/, "");
      if (!(key in FIXTURES)) return { data: null, error: { message: "no fixture" } };
      return { data: FIXTURES[key], error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: fake.signedInUser }, error: null }),
    },
    from: (table: string) => {
      fake.fromCalls.push(table);
      throw new Error(`fake client: unexpected from(${table})`);
    },
  };
}

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (request === "@/lib/supabase/server") {
    return { createClient: makeFakeClient };
  }
  return origLoad.call(this, request, parent, isMain);
};

// ── Rendering ───────────────────────────────────────────────────────────────

const GOLDEN_DIR = join(__dirname, "fixtures", "invite-page");

async function renderState(state: string, searchParams?: Record<string, string>) {
  const { default: PublicInvitePage } = await import("@/app/invite/[token]/page");
  const props = { params: { token: `tok-${state}` }, searchParams } as unknown as Parameters<
    typeof PublicInvitePage
  >[0];
  const el = await PublicInvitePage(props);
  return renderToStaticMarkup(el as React.ReactElement);
}

const STATES = Object.keys(FIXTURES);

async function record() {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const state of STATES) {
    const html = await renderState(state);
    writeFileSync(join(GOLDEN_DIR, `${state}.html`), html + "\n");
    console.log(`  recorded ${state}.html (${html.length} bytes)`);
  }
}

function golden(state: string): string {
  return readFileSync(join(GOLDEN_DIR, `${state}.html`), "utf8").trimEnd();
}

/** The footer is the one element the Case A scope is allowed to change. */
function stripFooter(html: string): string {
  return html.replace(/<footer[\s\S]*?<\/footer>/, "<FOOTER/>");
}

// Part G — every anonymous state is byte-identical to its pre-change golden
// outside the footer, and the footer is the only thing that moved.
async function partG() {
  let identical = 0;
  for (const state of STATES) {
    const html = await renderState(state);
    const g = golden(state);
    const same = stripFooter(html) === stripFooter(g);
    ok(same, `[G1:${state}] anonymous page byte-identical outside <footer>`);
    if (html === g) identical++;
    ok(
      (html.match(/<footer/g) ?? []).length === 1 && (g.match(/<footer/g) ?? []).length === 1,
      `[G2:${state}] exactly one <footer> on both sides`,
    );
  }
  return { identical };
}

async function main() {
  const startedAt = Date.now();
  if (process.env.RECORD === "1") {
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
    await record();
    console.log(`Recorded ${STATES.length} goldens.`);
    return;
  }
  const g = await partG();
  console.log(
    `invite-page-sim: ${checks} checks, ${fails} failures; ${g.identical}/${STATES.length} states fully identical (footer included); ${Date.now() - startedAt}ms`,
  );
  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
