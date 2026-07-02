// Canonical site origin — the single source of truth for every generated
// absolute URL (email links, upsell links, email image assets). MUST be the
// www host: the bare domain 307-redirects to www, and Stripe webhooks /
// Supabase auth callbacks are configured against www only. Some mail clients
// won't follow a redirect for embedded images, so emails must link www
// directly.
//
// Deliberately a hardcoded constant, not an env var: this is a
// production-only project (no staging), NEXT_PUBLIC_APP_URL was never set
// anywhere, and env-var indirection is exactly how the bare domain leaked
// into customer emails in the first place. No trailing slash — callers append
// paths starting with "/".
export const SITE_URL = "https://www.thefieldslate.com";
