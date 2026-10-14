"use client";

// The Schedule page's "Daylight" filter (admin-only): `?daylight=1` shows only
// games flagged after or near sunset, so an admin can sweep the season in one
// view. It narrows what the list / calendar / week SHOW — never the shared
// games query and never the print region. Shown only while flags are on.

import { useRouter, useSearchParams } from "next/navigation";
import { Sunset, X } from "lucide-react";
import { daylightFilterLabel } from "@/lib/daylight/flags";

export function DaylightFilter({ active, count }: { active: boolean; count: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(on: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (on) params.set("daylight", "1");
    else params.delete("daylight");
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  if (active) {
    return (
      <button
        type="button"
        onClick={() => set(false)}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-900 hover:bg-amber-100"
        aria-label="Show all games"
      >
        <Sunset className="h-4 w-4" aria-hidden />
        {daylightFilterLabel(count)}
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => set(true)}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
      title="Show only games that end after or near sunset"
    >
      <Sunset className="h-4 w-4 text-amber-500" aria-hidden />
      Daylight
      {count > 0 && (
        <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">{count}</span>
      )}
    </button>
  );
}
