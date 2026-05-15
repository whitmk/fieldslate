"use client";

import { Printer } from "lucide-react";

export function ManualPrintButton() {
  return (
    <div className="flex justify-end print:hidden">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg bg-[#0C1F3F] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0C1F3F]/85"
      >
        <Printer className="h-4 w-4" />
        Open print dialog
      </button>
    </div>
  );
}
