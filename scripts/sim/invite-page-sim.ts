// Harness for the public interleague invite page
// (src/app/invite/[token]/page.tsx): golden markup of the ANONYMOUS partner's
// page (part G), the invite-response emails (part E), the SIGNED-IN branch
// (part S, Interleague Case A) and its pure decisions (part B).
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
// EMAILS (part E): the two invite-RESPONSE emails (host acceptance email +
// recipient confirmation) were lifted verbatim out of the anonymous accept
// route into src/lib/interleague/invite-response-emails.ts; their output for a
// fixed fixture is pinned in email-*.{html,txt}, recorded at the moment of the
// move. A later change to the builders must keep the anonymous rendering
// byte-identical.
//
// SIGNED-IN BRANCH (part S) and its DECISIONS (part B): rendered through the
// same page function with a fake signed-in user, a chainable fake `from()`
// (presence in `fakeTables` stands in for RLS visibility) and a stubbed
// next/headers cookie store. S1 identity bar / season picker / Accept
// DISABLED / plain footer / no anonymous copy; S2 `?anon=1` while signed in
// renders the anonymous page byte-identically; S3 a member of the SENDING org
// is refused; S4 no season → first-class empty state; S5 the status screens
// are unchanged for a signed-in user. Part B drives
// src/lib/interleague/signed-in-accept.ts directly: page mode, the
// name-match DEFAULT for division mapping, team filtering, every blocker
// kind, Accept enabled only when fully mapped, a payload with NO away_team_id,
// readiness, identity, host league name, error translation.
//
// RECORD=1 rewrites the goldens. That is legitimate ONLY on the capture commit
// (the pre-change tree). If part G fails later, the anonymous page changed —
// fix the page, do not re-record.
//
// MUTATION LOG 2026-09-28 (in-source mutants applied one at a time, run,
// reverted; "killed" = the TARGET tag failed, read on every run):
//   TM1 page branch taken without a user (signed-in reachable anonymously)
//       → G1:pending (+ every pending G tag)                     KILLED
//   TM2 acceptEnabled ignores the unmapped count                  → B5b KILLED
//   TM3 buildMemberPayload adds away_team_id                      → B6  KILLED
//   TM4 own-invite refusal removed                                → S3  KILLED
//   TM5 pageMode ignores ?anon=1                                  → S2  KILLED (+B1c)
//   TM6 signed-in pages render the first-season promo footer      → S1f KILLED
//       (first attempt was a NOOP: the line appears in BOTH signed-in
//       branches and the mutator replaced only a unique match)
//   TM7 gameBlockers drops the field requirement for games we host → B4c KILLED (+BV)
//   TM8 the Accept button is never disabled                       → S1e KILLED (+S4c, V3)
//       *** SURVIVED FIRST: S1e tested `includes("disabled")` on the button
//       tag, and the tag's Tailwind classes contain `disabled:opacity-50`,
//       so the assertion passed with the attribute removed. Re-keyed to the
//       rendered attribute (` disabled=""`). A vacuous assertion looks
//       exactly like a green one; the mutant is what exposed it. ***
//   TM9 the status screens get the promo footer                   → G3:accepted KILLED (+S5)
// SQL-side mutants (the wrapper RPC, host side not updated, away_team_id on
// the created ROW, atomicity under a lock) live in
// scripts/sim/signed-in-accept-rpc-sim.sql.
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
      return new FakeQuery(table);
    },
  };
}

// The signed-in branch reads, under the caller's RLS: organization_members,
// profiles, leagues (its own seasons, and the invite's season — visible iff
// the caller belongs to the SENDING org). Presence in `fakeTables` stands in
// for RLS visibility. Filters are applied literally (eq / in / is); order is
// ignored; `.maybeSingle()` returns the first row or null.
type Row = Record<string, unknown>;
export const fakeTables: Record<string, Row[]> = {};

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: ((r: Row) => boolean)[] = [];
  private mode: "list" | "single" = "list";
  constructor(private table: string) {}
  select() { return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); return this; }
  is(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  order() { return this; }
  maybeSingle() { this.mode = "single"; return this; }
  single() { this.mode = "single"; return this; }
  private run() {
    const rows = (fakeTables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    return this.mode === "list" ? { data: rows, error: null } : { data: rows[0] ?? null, error: null };
  }
  then<A, B>(
    res?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null,
    rej?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve(this.run()).then(res ?? undefined, rej ?? undefined);
  }
}

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const mod = Module as unknown as { _load: Loader };
const origLoad = mod._load;
mod._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (request === "@/lib/supabase/server") {
    return { createClient: makeFakeClient };
  }
  // getCurrentOrgId / getCurrentSeasonId read the org/season cookies.
  if (request === "next/headers") {
    return { cookies: () => ({ get: () => undefined, getAll: () => [], set: () => {} }) };
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
  try {
    const el = await PublicInvitePage(props);
    return renderToStaticMarkup(el as React.ReactElement);
  } catch (err) {
    return `RENDER ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const STATES = Object.keys(FIXTURES);

async function record() {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const state of STATES) {
    const html = await renderState(state);
    writeFileSync(join(GOLDEN_DIR, `${state}.html`), html + "\n");
    console.log(`  recorded ${state}.html (${html.length} bytes)`);
  }
  for (const [name, body] of Object.entries(await renderEmails())) {
    writeFileSync(join(GOLDEN_DIR, name), body + "\n");
    console.log(`  recorded ${name} (${body.length} bytes)`);
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
    // The promo line REPLACES the old footer copy on the two pending (form)
    // states, names the host league, keeps the signup link, and the old copy
    // is gone; every other state's footer is byte-identical.
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    if (state === "pending" || state === "pending-no-games") {
      ok(
        footer.includes("Jen Medici builds their schedule on FieldSlate") &&
          footer.includes("signup?promo=INTERLEAGUE") &&
          !footer.includes("Curious about FieldSlate"),
        `[G3:${state}] footer carries the host-league promo line and not the old copy`,
      );
    } else {
      ok(html === g, `[G3:${state}] footer byte-identical (no promo change here)`);
    }
  }
  ok(identical === STATES.length - 2, "[G4] exactly the two pending states moved, nothing else", `${identical}`);
  return { identical };
}


// ── Part E: the invite-response emails ──────────────────────────────────────

const EMAIL_RESPONSES = [
  { game_id: "g1", team_name: "Wildcats", action: "accept" as const, venue_name: null, proposed_scheduled_at: null },
  { game_id: "g2", team_name: "Wildcats", action: "accept" as const, venue_name: "Riverside A", proposed_scheduled_at: null },
  { game_id: "g3", team_name: "Bears", action: "counter" as const, venue_name: null, proposed_scheduled_at: "2026-10-25T10:00:00+00:00" },
  { game_id: "g4", team_name: "", action: "decline" as const, venue_name: null, proposed_scheduled_at: null },
];
const EMAIL_SCHEDULE_GAMES = [
  { id: "g1", scheduled_at: "2026-10-10T09:00:00+00:00", is_away: false, external_team_name: "Wildcats", proposed_venue_name: null, home_team: { name: "Dodgers" }, division: { name: "Majors" }, venue: { name: "Andrews", location: { name: "Monroe Complex" } } },
  { id: "g2", scheduled_at: "2026-10-17T11:00:00+00:00", is_away: true, external_team_name: "Wildcats", proposed_venue_name: "Riverside A", home_team: { name: "Red Sox" }, division: { name: "Majors" }, venue: null },
];
const EMAIL_COUNTERED = [
  { id: "g3", status: "pending_interleague" as const, scheduled_at: "2026-10-24T13:00:00+00:00", proposed_scheduled_at: "2026-10-25T10:00:00+00:00", proposed_venue_name: null, is_away: false, external_team_name: "Bears", home_team: { name: "Giants" }, division: { name: "Minors" }, venue: { name: "Polley Field", location: null } },
];

export async function renderEmails(opts: { partnerOnFieldSlate?: boolean } = {}) {
  const mod = await import("@/lib/interleague/invite-response-emails");
  const acceptanceParams = {
    senderName: "Jen Medici",
    orgName: "Westside Little League",
    seasonLabelDisplay: "SRALL · Fall 2026",
    responses: EMAIL_RESPONSES,
    total: 4,
    accepted: 2,
    countered: 1,
    declined: 1,
    dashboardUrl: "https://www.thefieldslate.com/dashboard/interleague",
  };
  const acceptance = mod.buildAcceptanceEmail(
    (opts.partnerOnFieldSlate ? { ...acceptanceParams, partnerOnFieldSlate: true } : acceptanceParams) as Parameters<
      typeof mod.buildAcceptanceEmail
    >[0],
  );
  const recipient = mod.buildRecipientConfirmationEmail({
    senderOrgName: "SRALL",
    orgName: "Westside Little League",
    seasonLabelDisplay: "SRALL · Fall 2026",
    games: EMAIL_SCHEDULE_GAMES,
    counteredCount: 1,
    counteredGames: EMAIL_COUNTERED,
    scheduleUrl: "https://www.thefieldslate.com/schedule/sched-abc",
  });
  return {
    "email-acceptance.html": acceptance.html,
    "email-acceptance.txt": acceptance.subject + "\n" + acceptance.text,
    "email-recipient.html": recipient.html,
    "email-recipient.txt": recipient.subject + "\n" + recipient.text,
  };
}

async function partE() {
  const out = await renderEmails();
  for (const [name, body] of Object.entries(out)) {
    const g = readFileSync(join(GOLDEN_DIR, name), "utf8").trimEnd();
    ok(body.trimEnd() === g, `[E1:${name}] anonymous response email byte-identical to the golden`);
  }
  // The signed-in (Case A) host email differs from the anonymous one by
  // exactly one added sentence, in the HTML and in the text.
  const flagged = await renderEmails({ partnerOnFieldSlate: true });
  const SENTENCE = "is on FieldSlate too";
  for (const name of ["email-acceptance.html", "email-acceptance.txt"] as const) {
    const a = out[name];
    const b = flagged[name];
    ok(b !== a && b.includes(SENTENCE) && !a.includes(SENTENCE), `[E2:${name}] the FieldSlate line appears only when flagged`);
    // Remove the flagged email's added block and it must equal the anonymous one.
    const stripped =
      name === "email-acceptance.html"
        ? b.replace(/\s*<p style="margin:0 0 18px;padding:10px 14px;background:#f0fdf4[\s\S]*?<\/p>/, "")
        : b.split("\n").filter((l) => !l.includes(SENTENCE)).join("\n");
    ok(stripped === a, `[E3:${name}] the FieldSlate line is the ONLY difference`, `${stripped.length} vs ${a.length}`);
  }
  ok(flagged["email-recipient.html"] === out["email-recipient.html"], "[E4] the recipient email ignores the flag");
}


// ── Part S: the SIGNED-IN branch (Interleague Case A) ───────────────────────
//
// Fixture: Jen Moreno, owner of "Westside Little League" (org id = her user
// id, the v1 org model), one active season, signed in. The invite is SRALL's
// (season-1). S3 makes season-1 visible to her — which under real RLS means
// she is a member of the sending org — and expects the refusal.

const JEN = { id: "user-jen", email: "jen@westside.example" };
function seedJen(opts: { seasons?: boolean; ownInvite?: boolean } = {}) {
  fakeTables.organization_members = [
    { org_id: "user-jen", user_id: "user-jen", role: "owner", added_at: "2026-01-01" },
  ];
  fakeTables.profiles = [
    { id: "user-jen", org_name: "Westside Little League", full_name: "Jen Moreno", email: JEN.email },
  ];
  fakeTables.leagues = [
    ...(opts.seasons === false
      ? []
      : [{ id: "ws-fall", name: "Westside", season: "Fall 2026", sport: "baseball", owner_id: "user-jen", archived_at: null }]),
    ...(opts.ownInvite
      ? [{ id: "season-1", name: "SRALL", season: "Fall 2026", sport: "baseball", owner_id: "host-org", archived_at: null }]
      : []),
  ];
}

async function partS() {
  const counters = { signedInRenders: 0, anonymousRenders: 0, acceptDisabledSeen: 0 };
  const anonymousPending = await renderState("pending");
  counters.anonymousRenders++;

  // S1 — signed in: identity bar, season picker, Accept disabled on first
  // render, plain footer (no first-season pitch to a customer), and NONE of
  // the anonymous form's copy.
  fake.signedInUser = JEN;
  seedJen();
  const s1 = await renderState("pending");
  counters.signedInRenders++;
  ok(!s1.startsWith("RENDER ERROR"), "[S1] signed-in page renders", s1.slice(0, 200));
  ok(s1.includes('data-testid="invite-identity-bar"'), "[S1a] identity bar rendered");
  ok(s1.includes("Signed in as Jen Moreno · Westside Little League"), "[S1b] identity line names the person and the org");
  ok(s1.includes('href="/invite/tok-pending?anon=1"') && s1.includes("Not you? Respond without signing in"), "[S1c] escape hatch links to ?anon=1");
  ok(s1.includes('id="signed-in-season"') && s1.includes("Westside · Fall 2026"), "[S1d] season picker lists her season");
  // The ATTRIBUTE (React renders `disabled=""`), not the word: the button's
  // Tailwind classes contain `disabled:opacity-50`, so a substring test passed
  // with the attribute removed — mutant TM8 survived until this was fixed.
  const isDisabled = (btn: string) => / disabled=""/.test(btn);
  const acceptBtn = s1.match(/<button[^>]*data-testid="signed-in-accept"[^>]*>/)?.[0] ?? "";
  ok(isDisabled(acceptBtn), "[S1e] Accept is DISABLED before anything is mapped", acceptBtn);
  if (isDisabled(acceptBtn)) counters.acceptDisabledSeen++;
  ok(s1.includes("FieldSlate · Scheduling for youth sports leagues.") && !s1.includes("20% off"), "[S1f] signed-in footer is plain — no first-season pitch");
  ok(!s1.includes("enter your team and either accept"), "[S1g] the anonymous form's intro is absent");
  ok(s1.includes("Looking forward to playing you this fall!"), "[S1h] the personal note still renders");
  ok(s1.includes("Games hosted by Westside Little League") && s1.includes("Pick the field you"), "[S1i] the game we host asks for our field");

  // S2 — signed in but ?anon=1: the ANONYMOUS page, byte-identical.
  const s2 = await renderState("pending", { anon: "1" });
  counters.anonymousRenders++;
  ok(s2 === anonymousPending, "[S2] ?anon=1 renders the anonymous page byte-identically while signed in");
  ok(stripFooter(s2) === stripFooter(golden("pending")), "[S2b] …and that is the pre-change golden outside the footer");

  // S3 — a member of the SENDING org is refused.
  seedJen({ ownInvite: true });
  const s3 = await renderState("pending");
  counters.signedInRenders++;
  ok(s3.includes('data-testid="own-invite-refusal"'), "[S3] own invite → refusal card");
  ok(!s3.includes('data-testid="signed-in-accept"'), "[S3b] …and no Accept button");
  ok(s3.includes('data-testid="invite-identity-bar"'), "[S3c] …with the identity bar (switch org / escape hatch)");

  // S4 — no season: the empty state is first-class, Accept disabled, hatch present.
  seedJen({ seasons: false });
  const s4 = await renderState("pending");
  counters.signedInRenders++;
  ok(s4.includes('data-testid="signed-in-empty-state"') && s4.includes("You don&#x27;t have a season yet"), "[S4] no season → empty state");
  ok(s4.includes('href="/dashboard/leagues/new"'), "[S4b] …links to create a season");
  const acceptBtn4 = s4.match(/<button[^>]*data-testid="signed-in-accept"[^>]*>/)?.[0] ?? "";
  ok(isDisabled(acceptBtn4), "[S4c] …Accept disabled");
  if (isDisabled(acceptBtn4)) counters.acceptDisabledSeen++;

  // S5 — the status screens are BEFORE the branch: a signed-in revisit of an
  // accepted invite is the same screen as anonymous, golden included.
  seedJen();
  for (const state of ["accepted", "declined", "superseded", "not-found"]) {
    const html = await renderState(state);
    ok(html === golden(state), `[S5:${state}] status screen unchanged for a signed-in user`);
  }

  fake.signedInUser = null;
  return counters;
}

// ── Part B: the pure decisions (src/lib/interleague/signed-in-accept.ts) ────

async function partB() {
  const L = await import("@/lib/interleague/signed-in-accept");
  const games = [GAME_HOME, GAME_HOME_NO_LOC, GAME_AWAY] as unknown as import("@/lib/interleague/signed-in-accept").HostGame[];
  const divisions = [
    { id: "ours-majors", name: "majors ", locked: false },
    { id: "ours-aa", name: "AA", locked: false },
    { id: "ours-locked", name: "Rookies", locked: true },
  ];
  const teams = [
    { id: "t1", name: "Wildcats", division_id: "ours-majors" },
    { id: "t2", name: "Bears", division_id: "ours-majors" },
    { id: "t3", name: "Hawks", division_id: "ours-aa" },
    { id: "t4", name: "Cubs", division_id: "ours-locked" },
  ];
  const kinds = new Set<string>();

  // page mode
  ok(L.pageMode(null, undefined) === "anonymous", "[B1] no user → anonymous");
  ok(L.pageMode("u", undefined) === "signed_in", "[B1b] user → signed in");
  ok(L.pageMode("u", "1") === "anonymous", "[B1c] user + ?anon=1 → anonymous");
  ok(L.pageMode("u", ["1"]) === "anonymous", "[B1d] array param handled");
  ok(L.pageMode("u", "0") === "signed_in", "[B1e] ?anon=0 is not the hatch");

  // division mapping: a DEFAULT by name, null when nothing matches
  ok(L.defaultDivisionMatch("Majors", divisions) === "ours-majors", "[B2] 'Majors' ↔ 'majors ' (case/space-insensitive)");
  ok(L.defaultDivisionMatch("Minors", divisions) === null, "[B2b] 'Minors' with no match → null (no inference)");
  const map = L.defaultDivisionMap(games, divisions);
  ok(map["d-majors"] === "ours-majors" && map["d-minors"] === null, "[B2c] map defaults per host division");
  ok(L.teamsForHostGame(games[0], map, teams).map((t) => t.id).join() === "t1,t2", "[B3] team dropdown filtered by the mapped division");
  ok(L.teamsForHostGame(games[1], map, teams).length === 0, "[B3b] unmapped host division → no teams offered");

  // blockers, one of each kind
  const c = (o: Partial<import("@/lib/interleague/signed-in-accept").GameChoice>) => ({ action: "accept" as const, team_id: null, venue_id: null, proposed_iso: "", ...o });
  const b1 = L.gameBlockers(games[1], c({}), map, divisions, teams);
  ok(b1.some((b) => b.kind === "division"), "[B4] unmapped division is a blocker");
  b1.forEach((b) => kinds.add(b.kind));
  const b2 = L.gameBlockers(games[0], c({}), map, divisions, teams);
  ok(b2.length === 1 && b2[0].kind === "team", "[B4b] mapped but no team → exactly the team blocker");
  b2.forEach((b) => kinds.add(b.kind));
  const b3 = L.gameBlockers(games[2], c({ team_id: "t1" }), map, divisions, teams);
  ok(b3.length === 1 && b3[0].kind === "venue", "[B4c] a game WE host with no field → the venue blocker");
  b3.forEach((b) => kinds.add(b.kind));
  const b4 = L.gameBlockers(games[0], c({ team_id: "t1", action: "counter", proposed_iso: "" }), map, divisions, teams);
  ok(b4.length === 1 && b4[0].kind === "time", "[B4d] a counter with no time → the time blocker");
  b4.forEach((b) => kinds.add(b.kind));
  const lockedMap = { ...map, "d-majors": "ours-locked" };
  const b5 = L.gameBlockers(games[0], c({ team_id: "t4" }), lockedMap, divisions, teams);
  ok(b5.length === 1 && b5[0].kind === "locked" && b5[0].message === "Rookies is locked. Unlock it to add a game.", "[B4e] accept into a locked division → the shared lock sentence", JSON.stringify(b5));
  b5.forEach((b) => kinds.add(b.kind));
  ok(L.gameBlockers(games[0], c({ team_id: "t4", action: "counter", proposed_iso: "2026-10-11T10:00" }), lockedMap, divisions, teams).length === 0, "[B4f] a counter writes nothing on our side, so the lock is not a blocker");
  ok(L.gameBlockers(games[2], c({ action: "decline" }), map, divisions, teams).length === 0, "[B4g] a declined game has no blockers");
  ok(L.gameBlockers(games[0], c({ team_id: "t3" }), map, divisions, teams).some((b) => b.kind === "team"), "[B4h] a team outside the mapped division does not count");

  // Accept enabled ONLY when every non-declined game is mapped
  const fullMap = { "d-majors": "ours-majors", "d-minors": "ours-aa" };
  const allMapped = {
    "g-home-1": c({ team_id: "t1" }),
    "g-home-2": c({ team_id: "t3" }),
    "g-away-1": c({ team_id: "t2", venue_id: "v1" }),
  };
  ok(L.acceptEnabled(games, allMapped, fullMap, divisions, teams, false) === true, "[B5] every game mapped → Accept enabled");
  ok(L.unmappedCount(games, allMapped, fullMap, divisions, teams) === 0, "[B5a] …and zero remaining");
  const oneUnmapped = { ...allMapped, "g-home-2": c({}) };
  ok(L.acceptEnabled(games, oneUnmapped, fullMap, divisions, teams, false) === false, "[B5b] ONE unmapped game → Accept disabled");
  ok(L.unmappedCount(games, oneUnmapped, fullMap, divisions, teams) === 1 && L.remainingLabel(1) === "1 game still needs a team, field or time", "[B5c] remaining count and label");
  ok(L.remainingLabel(3) === "3 games still need a team, field or time", "[B5d] plural label");
  ok(L.acceptEnabled(games, allMapped, fullMap, divisions, teams, true) === false, "[B5e] submitting → disabled");
  const allDeclined = Object.fromEntries(games.map((g) => [g.id, c({ action: "decline" })]));
  ok(L.acceptEnabled(games, allDeclined, fullMap, divisions, teams, false) === false, "[B5f] everything declined → disabled (use Decline this invite)");
  ok(L.acceptEnabled([], {}, {}, divisions, teams, false) === false, "[B5g] no games → disabled");

  // the payload: never an away_team_id, venue only when WE host, ISO counter time
  const payload = L.buildMemberPayload(games, {
    "g-home-1": c({ team_id: "t1", venue_id: "v-ignored" }),
    "g-home-2": c({ team_id: "t3", action: "counter", proposed_iso: "2026-10-18T10:00" }),
    "g-away-1": c({ team_id: "t2", venue_id: "v1" }),
  });
  const json = JSON.stringify(payload);
  ok(!json.includes("away_team_id"), "[B6] the payload has NO away_team_id anywhere — the other org's team is text, never a row");
  ok(payload[0].team_id === "t1" && payload[0].venue_id === undefined, "[B6b] a game the HOST hosts carries no venue of ours");
  ok(payload[2].venue_id === "v1", "[B6c] a game WE host carries our venue");
  ok(payload[1].action === "counter" && payload[1].proposed_scheduled_at === "2026-10-18T10:00:00+00:00", "[B6d] counter time in the +00:00 wall-clock shape");
  const declinedPayload = L.buildMemberPayload(games, { "g-home-1": c({ action: "decline", team_id: "t1" }) });
  ok(JSON.stringify(declinedPayload[0]) === JSON.stringify({ game_id: "g-home-1", action: "decline" }), "[B6e] a declined game sends only its id and action");

  // readiness + identity + host league name
  ok(L.readiness({ seasonCount: 0, divisions, teams }) === "no_season", "[B7] no season first");
  ok(L.readiness({ seasonCount: 1, divisions: [], teams }) === "no_divisions", "[B7b] then no divisions");
  ok(L.readiness({ seasonCount: 1, divisions, teams: [] }) === "no_teams", "[B7c] then no teams");
  ok(L.readiness({ seasonCount: 1, divisions, teams }) === "ready", "[B7d] ready");
  ok(L.identityLabel("Jen Moreno", "j@x", "Westside") === "Signed in as Jen Moreno · Westside", "[B8] identity label");
  ok(L.identityLabel(null, "j@x", "Westside") === "Signed in as j@x · Westside", "[B8b] falls back to the email");
  ok(L.hostLeagueName({ org_name: "SRALL", full_name: "Jen", email: "e" }) === "SRALL", "[B9] host league name prefers org_name");
  ok(L.hostLeagueName({ org_name: " ", full_name: "Jen Medici", email: "e" }) === "Jen Medici", "[B9b] …then the admin's name");
  ok(L.hostLeagueName(null) === "the host league", "[B9c] …then a literal");

  // error translation
  ok(L.memberErrorResponse("own_invite").status === 403, "[B10] own_invite → 403");
  ok(L.memberErrorResponse("host_games_changed").message.includes("Nothing was saved"), "[B10b] host_games_changed says nothing was saved");
  const lock = L.memberErrorResponse("division_locked: Majors is locked — unlock it to add games.");
  ok(lock.status === 409 && lock.message === "Majors is locked — unlock it to add games. Nothing was saved.", "[B10c] the 0082 trigger's refusal is translated with the shared helper", lock.message);
  ok(L.memberErrorResponse("something odd").message === "something odd", "[B10d] an unknown message passes through, never swallowed");

  ok(["division", "team", "venue", "time", "locked"].every((k) => kinds.has(k)), "[BV] every blocker kind was produced at least once", [...kinds].join());
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
  await partE();
  const sc = await partS();
  await partB();
  // Anti-vacuity: a signed-in render and an anonymous render each actually ran,
  // and Accept was actually observed disabled.
  ok(sc.signedInRenders > 0, "[V1] a signed-in page render happened", `${sc.signedInRenders}`);
  ok(sc.anonymousRenders > 0, "[V2] an anonymous page render happened", `${sc.anonymousRenders}`);
  ok(sc.acceptDisabledSeen > 0, "[V3] Accept was observed disabled", `${sc.acceptDisabledSeen}`);
  console.log(
    `invite-page-sim: ${checks} checks, ${fails} failures; ${g.identical}/${STATES.length} anonymous states fully identical (footer included); signed-in renders=${sc.signedInRenders} anonymous renders=${sc.anonymousRenders + STATES.length}; ${Date.now() - startedAt}ms`,
  );
  if (fails > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
