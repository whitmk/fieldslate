import type { Metadata } from "next";
import { ManagePageClient } from "@/components/volunteers/manage-page-client";
import { LINK_TOKEN } from "@/lib/volunteers/public-server";
import { MY_TITLE } from "@/lib/volunteers/words";

// The volunteer's own page (0121). A shell: the client fetches
// /api/volunteers/manage/<token> and posts cancel / keep there. Private to
// whoever holds the link: noindex, not framable, outside the middleware.
export const metadata: Metadata = {
  title: MY_TITLE,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ManagePage({ params }: { params: { token: string } }) {
  return <ManagePageClient token={LINK_TOKEN.test(params.token) ? params.token : null} />;
}
