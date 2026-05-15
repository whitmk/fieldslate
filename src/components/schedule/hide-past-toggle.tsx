"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Props {
  hidePast: boolean;
}

export function HidePastToggle({ hidePast }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    // Default is ON, so we only need a URL param when the user turns it OFF.
    if (hidePast) params.set("past", "1");
    else params.delete("past");
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
      <span className="text-gray-500">Hide past games</span>
      <button
        type="button"
        role="switch"
        aria-checked={hidePast}
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          hidePast ? "bg-[#22C55E]" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            hidePast ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
