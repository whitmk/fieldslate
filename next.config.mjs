/** @type {import('next').NextConfig} */
const nextConfig = {
  // Token-addressed pages and feeds are never for search engines: the URL is
  // the credential. The feed route also sets this header itself; the page
  // routes rely on this (and on never being linked from an indexed page).
  async headers() {
    const noIndex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/schedule/:path*", headers: noIndex },
      { source: "/invite/:path*", headers: noIndex },
      { source: "/reschedule/:path*", headers: noIndex },
      { source: "/calendar/:path*", headers: noIndex },
    ];
  },
};

export default nextConfig;
