import type { Metadata } from "next";
import { PublicScheduleClient } from "@/components/public-schedule/public-schedule-client";
import { parseToken } from "@/lib/public-schedule/links";

// The public league schedule (0105). A shell: the client component fetches
// /s/<token>/data, which is where caching and the fail-closed answer live
// (src/lib/public-schedule/links.ts). Framable by any site (next.config.mjs —
// the ONE route that is) and left out of the middleware matcher.

export const metadata: Metadata = {
  title: "Game schedule",
  robots: { index: false, follow: false },
};

export default function PublicSchedulePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { embed?: string };
}) {
  return (
    <PublicScheduleClient
      token={parseToken(params.token)}
      embed={searchParams.embed === "1"}
    />
  );
}
