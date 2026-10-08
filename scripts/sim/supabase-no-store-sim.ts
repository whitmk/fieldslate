// sim:supabase-no-store — the Data Cache guard (src/lib/supabase/no-store.ts).
//
// WHAT IT PROVES
//   NS1  No file under src/ creates a client with `createClient` from
//        "@supabase/supabase-js" except the helper. (Source scan — weak by
//        nature, stated: it reads import lines, so an aliased re-export
//        elsewhere would need its own line here.)
//   NS2  "@supabase/ssr" is imported only by the three cookie/browser client
//        files, so a new session-less client cannot slip in that way either.
//   NS3  noStoreFetch passes cache:"no-store" and keeps every other init field.
//   NS4  A REAL supabase-js client from createNoStoreClient sends no-store on
//        rpc() (a POST — the incident's shape) and on a table select (a GET).
//   NS5  The three token routes export fetchCache = "force-no-store".
//   NS6  The three known session-less callers use the helper.
//   Counters: requests captured through the real client (NS4) and helper call
//   sites found (NS6) — zero fails the run.
//
// Why it exists: Next 14 kept the first answer of the public schedule's RPC
// for a year; the public page showed Majors as unpublished hours after it was
// locked (2026-10-08). See no-store.ts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createNoStoreClient, noStoreFetch } from "../../src/lib/supabase/no-store";

const ROOT = join(__dirname, "../..");
const HELPER = "src/lib/supabase/no-store.ts";
const SSR_ALLOWED = new Set([
  "src/lib/supabase/server.ts",
  "src/lib/supabase/client.ts",
  "src/lib/supabase/middleware.ts",
]);
const ROUTES = [
  "src/app/s/[token]/data/route.ts",
  "src/app/s/[token]/feed/route.ts",
  "src/app/calendar/[token]/route.ts",
];
const CALLERS = [
  "src/lib/public-schedule/read.ts",
  "src/app/calendar/[token]/route.ts",
  "src/lib/supabase/admin.ts",
];

let failures = 0;
function check(tag: string, ok: boolean, detail: string) {
  if (ok) console.log(`  ok  [${tag}] ${detail}`);
  else {
    failures++;
    console.log(`  FAIL: [${tag}] ${detail}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(relative(ROOT, p));
  }
  return out;
}

// Value imports only — `import type { … }` creates nothing.
function valueImportsFrom(src: string, mod: string): string[] {
  const out: string[] = [];
  const re = /import\s+(?!type\b)([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) if (m[2] === mod) out.push(m[1]);
  const req = new RegExp(`require\\(\\s*["']${mod.replace(/[/.]/g, "\\$&")}["']\\s*\\)`);
  if (req.test(src)) out.push("require()");
  return out;
}

async function main() {
  const files = walk(join(ROOT, "src"));

  console.log("NS1/NS2 — who creates clients");
  const jsOffenders = files.filter(
    (f) => f !== HELPER && valueImportsFrom(readFileSync(join(ROOT, f), "utf8"), "@supabase/supabase-js").length > 0,
  );
  check("NS1", jsOffenders.length === 0, `no value import of @supabase/supabase-js outside the helper${jsOffenders.length ? ` — found in ${jsOffenders.join(", ")}` : ""}`);
  const ssrOffenders = files.filter(
    (f) => !SSR_ALLOWED.has(f) && valueImportsFrom(readFileSync(join(ROOT, f), "utf8"), "@supabase/ssr").length > 0,
  );
  check("NS2", ssrOffenders.length === 0, `@supabase/ssr only in the cookie/browser client files${ssrOffenders.length ? ` — found in ${ssrOffenders.join(", ")}` : ""}`);

  // Capture what reaches the platform fetch.
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input instanceof Request ? input.url : input), init });
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    console.log("NS3 — noStoreFetch");
    await noStoreFetch("https://example.test/x", { method: "POST", body: "{}", headers: { a: "b" } });
    const one = seen.pop();
    check("NS3", one?.init?.cache === "no-store" && one?.init?.method === "POST" && one?.init?.body === "{}",
      `cache=${one?.init?.cache}, method and body kept`);

    console.log("NS4 — the real supabase-js client");
    const client = createNoStoreClient("https://example.supabase.co", "anon-key");
    seen.length = 0;
    await client.rpc("get_league_schedule_by_token", { p_token: "x" });
    await client.from("games").select("id");
    const rpc = seen.find((s) => s.url.includes("/rest/v1/rpc/"));
    const sel = seen.find((s) => s.url.includes("/rest/v1/games"));
    check("NS4-count", seen.length >= 2, `${seen.length} requests captured through the real client`);
    check("NS4", !!rpc && !!sel && seen.every((s) => s.init?.cache === "no-store"),
      `every request no-store (rpc ${rpc?.init?.method ?? "missing"}: ${rpc?.init?.cache}; select ${sel?.init?.method ?? "GET"}: ${sel?.init?.cache})`);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log("NS5 — route guards");
  for (const r of ROUTES) {
    const src = readFileSync(join(ROOT, r), "utf8");
    check("NS5", /export const fetchCache = "force-no-store";/.test(src), `${r} exports fetchCache = "force-no-store"`);
  }

  console.log("NS6 — callers use the helper");
  let sites = 0;
  for (const c of CALLERS) {
    const src = readFileSync(join(ROOT, c), "utf8");
    const uses = /createNoStoreClient(<[^>]*>)?\(/.test(src);
    if (uses) sites++;
    check("NS6", uses, `${c} builds its client with createNoStoreClient`);
  }
  check("NS6-count", sites === CALLERS.length, `${sites} helper call sites`);

  console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log(`  FAIL: [CRASH] ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
