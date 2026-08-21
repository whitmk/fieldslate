"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { LayoutList, CalendarDays, Columns3 } from "lucide-react";
import { currentWeekStartLocal } from "@/lib/schedule/week-grid";

export type ViewMode = "list" | "calendar" | "week";

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
    // Week mode carries its own `?week=` companion param, the way calendar mode
    // carries `?month=`. Seed it HERE, in the browser: "which week is now"
    // depends on the viewer's timezone, and the server's clock is UTC. Without
    // this the grid still renders correctly — it just resolves the week itself
    // and rewrites the URL — but seeding avoids that extra navigation.
    if (next === "week") {
      if (!params.get("week")) params.set("week", currentWeekStartLocal());
    } else {
      params.delete("week");
    }
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  const options: { id: ViewMode; label: string; icon: typeof LayoutList }[] = [
    { id: "list", label: "List", icon: LayoutList },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "week", label: "Week by field", icon: Columns3 },
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
