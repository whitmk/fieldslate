/** @type {import('next').NextConfig} */

// FRAMING. No page of this app may be shown inside another site's frame
// (clickjacking: a hostile page overlays our buttons and borrows a signed-in
// admin's clicks). Before this rule nothing set either header, so every page —
// login and the dashboard included — could be framed by anyone.
//
// The ONE exception is the public league schedule, /s/<token>, which leagues
// embed on their own websites. It gets `frame-ancestors *` and NO
// X-Frame-Options. The global rule's source excludes /s/ itself (a negative
// lookahead) rather than relying on a later rule to override it: X-Frame-Options
// has no "allow" value, and an engine that honoured a leftover DENY over the
// CSP would refuse the embed. The /s/ rule is listed after the global one.
//
// Adding a second frameable route is a deliberate decision: extend the
// lookahead AND add its own rule, and say why here.
const noFraming = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];
const embeddable = [{ key: "Content-Security-Policy", value: "frame-ancestors *" }];

const nextConfig = {
  // Token-addressed pages and feeds are never for search engines: the URL is
  // the credential. The feed route also sets this header itself; the page
  // routes rely on this (and on never being linked from an indexed page).
  async headers() {
    const noIndex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      // Every path except /s and /s/… (the public league schedule).
      { source: "/:path((?!s$|s/).*)", headers: noFraming },
      { source: "/s/:path*", headers: [...embeddable, ...noIndex] },
      { source: "/schedule/:path*", headers: noIndex },
      { source: "/invite/:path*", headers: noIndex },
      { source: "/reschedule/:path*", headers: noIndex },
      { source: "/calendar/:path*", headers: noIndex },
    ];
  },
};

export default nextConfig;
