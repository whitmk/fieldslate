// THE ONE WAY to build a Supabase client that is not tied to a session cookie
// (the anon readers behind the public token routes, and the service-role admin
// client). SERVER ONLY.
//
// WHY EVERY REQUEST IS no-store. Next 14 patches `fetch` and keeps responses
// in its Data Cache — a POST included, keyed by URL + body + headers — unless
// something in the request turns that off. A route handler that never reads
// cookies or headers turns nothing off, and `dynamic = "force-dynamic"` does
// NOT stop it: patch-fetch falls through to "auto cache" with revalidate=false
// (one year), and Vercel keeps that cache across deploys. supabase-js calls
// `rpc()` as a fetch POST, so the first answer for a token was the answer
// forever. Live 2026-10-08: the public league schedule served the copy read in
// the 24 minutes before Majors was locked — Majors "not published yet" — hours
// after the lock. The cookie-based server client escapes this only because
// reading cookies makes the request dynamic; a client with no session has no
// such escape, so the escape is built in here instead of left to luck.
//
// `cache: "no-store"` makes Next neither read nor write the Data Cache for the
// request, so entries saved before this fix are bypassed, not served.
//
// Never create a non-cookie client with `createClient` from
// "@supabase/supabase-js" anywhere else — `npm run sim:supabase-no-store`
// fails on one.

import { createClient } from "@supabase/supabase-js";

/** `fetch` with the Data Cache switched off for every request. */
export const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/** A session-less Supabase client whose every request bypasses Next's Data
 *  Cache. `key` is the anon key for token readers, the service-role key for
 *  the admin client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js's own default
export function createNoStoreClient<Database = any>(
  url: string,
  key: string,
) {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}
