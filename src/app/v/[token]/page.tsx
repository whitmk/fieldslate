import type { Metadata } from "next";
import { SignupPageClient } from "@/components/volunteers/signup-page-client";
import { LINK_TOKEN } from "@/lib/volunteers/public-server";
import { PUB_TITLE } from "@/lib/volunteers/words";

// The public volunteer sign-up page (0121). A shell: the client component
// fetches /api/volunteers/signup/<token>, which holds spot COUNTS only, and
// posts claims to /api/volunteers/signup/<token>/claim (Turnstile, hashed
// rate limits, the database decides). Not indexed, not framable (only /s/…
// is), outside the middleware matcher.
export const metadata: Metadata = {
  title: PUB_TITLE,
  robots: { index: false, follow: false },
};

export default function VolunteerSignupPage({ params }: { params: { token: string } }) {
  return (
    <SignupPageClient
      token={LINK_TOKEN.test(params.token) ? params.token : null}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
    />
  );
}
