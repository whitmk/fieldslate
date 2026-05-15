"use client";

import { useState } from "react";
import { BarChart2 } from "lucide-react";
import { PayReportModal } from "./pay-report-modal";
import type { SeasonPaySettings } from "./umpire-list";

interface Props {
  seasonPaySettings: SeasonPaySettings[];
}

export function PayReportButton({ seasonPaySettings }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F]"
      >
        <BarChart2 className="h-4 w-4" />
        Pay report
      </button>
      {open && (
        <PayReportModal
          seasonPaySettings={seasonPaySettings}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
