"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { LayoutList, CalendarDays } from "lucide-react";

export type ViewMode = "list" | "calendar";

interface Props {
  mode: ViewMode;
}

export function ViewModeToggle({ mode }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(next: ViewMode) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.delete("mode");
    else params.set("mode", next);
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  const options: { id: ViewMode; label: string; icon: typeof LayoutList }[] = [
    { id: "list", label: "List", icon: LayoutList },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
  ];

  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1">
      {options.map((o) => {
        const Icon = o.icon;
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            onClick={() => navigate(o.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              active
                ? "bg-white text-[#0C1F3F] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
