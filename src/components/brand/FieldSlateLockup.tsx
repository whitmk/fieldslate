import { FieldSlateMark } from "./FieldSlateMark";

/**
 * Full FieldSlate lockup — mark + "FieldSlate" wordmark.
 * Requires the Manrope font (weight 800) to be loaded. Falls back to
 * system-ui if Manrope isn't available.
 *
 * Variants:
 *   "dark"  — for navy/dark surfaces (white "Field" + green "Slate")
 *   "light" — for paper/white surfaces (navy "Field" + green-dk "Slate")
 *
 * Minimum lockup width: 120px.
 */
export function FieldSlateLockup({
  height = 40,
  variant = "light",
  className,
}: {
  height?: number;
  variant?: "dark" | "light";
  className?: string;
}) {
  const ink = variant === "dark" ? "#ffffff" : "#0b1c39";
  const accent = variant === "dark" ? "#22c55e" : "#16a34a";

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: height * 0.28,
      }}
    >
      <FieldSlateMark size={height * 1.2} variant={variant} />
      <span
        style={{
          fontFamily:
            "var(--font-manrope), Manrope, system-ui, -apple-system, 'Segoe UI', sans-serif",
          fontWeight: 800,
          fontSize: height * 0.78,
          letterSpacing: "-0.025em",
          lineHeight: 1,
        }}
      >
        <span style={{ color: ink }}>Field</span>
        <span style={{ color: accent }}>Slate</span>
      </span>
    </span>
  );
}
