import { cn } from "@/lib/utils/cn";
import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  className?: string;
}

export function StatsCard({ title, value, description, icon: Icon, className }: StatsCardProps) {
  return (
    <div className={cn("rounded-xl border border-gray-100 bg-white p-6 shadow-sm", className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-[#0C1F3F]">{value}</p>
          {description && (
            <p className="mt-1 text-xs text-gray-400">{description}</p>
          )}
        </div>
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#0C1F3F]/6">
          <Icon className="h-5 w-5 text-[#0C1F3F]/50" />
        </div>
      </div>
    </div>
  );
}
