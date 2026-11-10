import type { Metadata } from "next";
import { ConfirmEmailClient } from "./confirm-email-client";

// A league contact email's confirmation link (0126). The URL is the
// credential: never indexed, never sent as a referrer.
export const metadata: Metadata = {
  title: "Confirm contact email · FieldSlate",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page({ params }: { params: { token: string } }) {
  return <ConfirmEmailClient token={params.token} />;
}
