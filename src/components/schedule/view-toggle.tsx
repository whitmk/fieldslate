"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Props {
  view: "games" | "practices";
}

export function ViewToggle({ view }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(newView: "games" | "practices") {
    const params = new URLSearchParams();
    if (newView !== "games") params.set("view", newView);
    const division = searchParams.get("division");
    if (division) params.set("division", division);
    const qs = params.toString();
    router.push(`/dashboard/schedule${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1">
      {(["games", "practices"] as const).map((v) => (
        <button
          key={v}
          onClick={() => navigate(v)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-all ${
            view === v
              ? "bg-white text-[#0C1F3F] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {v === "games" ? "Games" : "Practices"}
        </button>
      ))}
    </div>
  );
}
