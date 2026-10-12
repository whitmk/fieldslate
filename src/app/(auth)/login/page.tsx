import type { Metadata } from "next";
import { LoginPageClient } from "./login-page-client";

// Kept out of search results, but NOT blocked in robots.txt: a crawler has to
// be able to fetch the page to see this noindex. No canonical, by design.
// The form is a client component, so the metadata lives in this server page.
export const metadata: Metadata = {
  robots: { index: false },
};

export default function LoginPage() {
  return <LoginPageClient />;
}
