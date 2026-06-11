"use client";

import { Printer } from "lucide-react";

/**
 * Toolbar print action for the schedule page. Mirrors the "Print Schedule"
 * button on the division schedule panel — same window.print() approach and
 * border-secondary styling; the dashboard layout already hides nav chrome via
 * print: classes, so this just opens the browser print dialog.
 */
export function SchedulePrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-[#0C1F3F] hover:text-[#0C1F3F] print:hidden"
    >
      <Printer className="h-4 w-4" />
      Print Schedule
    </button>
  );
}
