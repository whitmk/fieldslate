"use client";

// The season page's banner for a season the auto-archive held open because
// it has volunteer sign-ups (0121 part 4, approved 2026-11-08). Neutral, not
// amber: nothing is wrong, the admin decides when. The button opens the same
// archive confirm every surface uses, which states the deletion and labels
// its button "Archive and delete sign-ups". Words: src/lib/seasons/volunteer-hold.ts.

import { useState } from "react";
import { Archive } from "lucide-react";
import { ArchiveSeasonModal } from "@/components/seasons/archive-modals";
import { holdBannerLine } from "@/lib/seasons/volunteer-hold";

interface Props {
  seasonId: string;
  seasonName: string;
  endDate: string | null;
}

export function VolunteerHoldBanner({ seasonId, seasonName, endDate }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gray-200/70">
            <Archive className="h-4 w-4 text-gray-600" />
          </div>
          <p className="text-sm text-gray-700">{holdBannerLine(endDate)}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-shrink-0 self-start rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-[#0C1F3F] transition-colors hover:bg-gray-100"
        >
          Archive season
        </button>
      </div>
      {open && <ArchiveSeasonModal seasonId={seasonId} seasonName={seasonName} onClose={() => setOpen(false)} />}
    </>
  );
}
