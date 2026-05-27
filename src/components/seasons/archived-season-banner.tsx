"use client";

// Amber "this season is archived" banner that sits below the page header on
// the season detail page. Clicking Unarchive opens the same modal the
// seasons list uses.

import { useState } from "react";
import { Archive } from "lucide-react";
import { UnarchiveSeasonModal } from "@/components/seasons/archive-modals";

interface Props {
  seasonId: string;
  seasonName: string;
  endDate: string | null;
}

export function ArchivedSeasonBanner({ seasonId, seasonName, endDate }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="flex items-start justify-between gap-3 rounded-lg border bg-[#FAEEDA] px-4 py-3.5"
        style={{ borderColor: "#EF9F27", borderWidth: "0.5px" }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[#EF9F27]/15">
            <Archive className="h-4 w-4 text-[#B36A05]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#7A4604]">
              This season is archived.
            </p>
            <p className="mt-0.5 text-xs text-[#7A4604]/85">
              Edits are still allowed but will affect historical reports.
              Unarchive to return it to active.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-shrink-0 rounded-lg border border-[#EF9F27] bg-white px-3 py-1.5 text-sm font-semibold text-[#B36A05] transition-colors hover:bg-[#FFF7EA]"
        >
          Unarchive
        </button>
      </div>
      {open && (
        <UnarchiveSeasonModal
          seasonId={seasonId}
          seasonName={seasonName}
          endDate={endDate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
