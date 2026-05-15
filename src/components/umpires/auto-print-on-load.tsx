"use client";

import { useEffect } from "react";

/**
 * Triggers the browser print dialog once after the page has loaded.
 * Used by /dashboard/umpires/print-all so the admin lands directly in
 * the print preview.
 */
export function AutoPrintOnLoad() {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
