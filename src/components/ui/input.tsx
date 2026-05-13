import { cn } from "@/lib/utils/cn";
import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  variant?: "light" | "dark";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, variant = "light", ...props }, ref) => {
    const isDark = variant === "dark";
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={id}
            className={cn(
              "text-sm font-medium",
              isDark ? "text-white/70" : "text-gray-700"
            )}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            "h-11 w-full rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
            isDark
              ? "border-white/10 bg-[#1e3a5f] text-white placeholder:text-white/30 focus:border-[#22C55E]/60 focus:ring-[#22C55E]/20"
              : "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#22C55E] focus:ring-[#22C55E]/20",
            error && (isDark
              ? "border-red-400/50 focus:border-red-400 focus:ring-red-400/20"
              : "border-red-500 focus:border-red-500 focus:ring-red-500/20"),
            className
          )}
          {...props}
        />
        {error && (
          <p className={cn("text-xs", isDark ? "text-red-400" : "text-red-600")}>
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
