import type { Metadata } from "next";
import { PublicBracketClient } from "@/components/public-bracket/public-bracket-client";
import { parseToken } from "@/lib/public-schedule/links";
import { DIVISION_ID_RE } from "@/lib/public-bracket/types";

// The public bracket page (0116). A shell: the client component fetches
// /s/<token>/bracket/<division>/data, which is where caching and the
// fail-closed answer live. Under /s, so it is framable by any site and left
// out of the middleware matcher, like the public schedule.

export const metadata: Metadata = {
  title: "Playoff bracket",
  robots: { index: false, follow: false },
};

export default function PublicBracketPage({
  params,
  searchParams,
}: {
  params: { token: string; division: string };
  searchParams: { embed?: string };
}) {
  return (
    <PublicBracketClient
      token={parseToken(params.token)}
      divisionId={DIVISION_ID_RE.test(params.division) ? params.division : null}
      embed={searchParams.embed === "1"}
    />
  );
}
