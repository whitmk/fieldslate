import type { Metadata } from "next";
import { SignupPageClient } from "@/components/officials-signup/signup-page-client";
import { LINK_TOKEN } from "@/lib/officials-signup/page";
import { PAGE_TITLE } from "@/lib/officials-signup/words";

// An official's private sign-up page (0124). A shell: the client fetches
// /api/officials/signup/<token> and posts claim / drop there. Private to
// whoever holds the link: noindex, no referrer, not framable (the global
// frame rule), outside the middleware.
export const metadata: Metadata = {
  title: PAGE_TITLE,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OfficialSignupPage({ params }: { params: { token: string } }) {
  return <SignupPageClient token={LINK_TOKEN.test(params.token) ? params.token : null} />;
}
