"use client";

import { useRouter, useSearchParams } from "next/navigation";

export type ScheduleView = "games" | "practices" | "combined";

interface Props {
  view: ScheduleView;
}

const VIEWS: { id: ScheduleView; label: string }[] = [
  { id: "games", label: "Games" },
  { id: "practices", label: "Practices" },
  { id: "combined", label: "Combined" },
];

export function ViewToggle({ view }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(newView: ScheduleView) {
    const params = new URLSearchParams(searchParams.toString());
    if (newView === "games") params.delete("view");
    else params.set("view", newView);
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          onClick={() => navigate(v.id)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
            view === v.id
              ? "bg-white text-[#0C1F3F] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
